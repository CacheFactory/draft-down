// @archigraph renderer.webgl
// WebGL renderer implementing IRenderer with Three.js

import * as THREE from 'three';
import { IRenderer, IRenderStats } from '../../src/core/interfaces';
import { Vec3, Color, RenderMode } from '../../src/core/types';
import { CameraController } from '../camera.main/CameraController';
import {
  createSelectionOutlineMaterial,
  createPreSelectionMaterial,
  SELECTION_COLOR,
  PRE_SELECTION_COLOR,
} from '../shader.selection/SelectionShader';
import { createXRayMaterial, createXRayWireframeMaterial } from '../shader.xray/XRayShader';

/** Maps entity IDs to their Three.js objects for picking and highlighting. */
type EntityObjectMap = Map<string, THREE.Object3D>;

/** Sky dome base radius — must exceed the perspective near plane; scaled up
 *  per-frame in orthographic views to cover the frustum. */
const SKY_DOME_RADIUS = 10;

export class WebGLRenderer implements IRenderer {
  private _renderer!: THREE.WebGLRenderer;
  private _scene: THREE.Scene;
  private _overlayScene: THREE.Scene;
  private _cameraController: CameraController;

  private _renderMode: RenderMode = 'shaded';
  private _animationFrameId: number | null = null;
  private _running = false;
  private _width = 1;
  private _height = 1;

  // Lighting
  private _ambientLight!: THREE.AmbientLight;
  private _sunLight!: THREE.DirectionalLight;

  // Overlays
  private _grid!: THREE.GridHelper;
  private _axes!: THREE.AxesHelper;
  private _gridVisible = true;
  private _axesVisible = true;

  // Guide lines
  private _guideLines: Map<string, THREE.Line> = new Map();
  private _guideLineData: Map<string, { start: Vec3; end: Vec3; color: Color; dashed: boolean }> = new Map();
  private _guideGroup: THREE.Group;

  // Selection
  private _selectionOutlines: THREE.Group;
  private _preSelectionOutline: THREE.Group;
  private _selectedEntityIds: Set<string> = new Set();
  private _preSelectionEntityIds: Set<string> = new Set();

  // Entity-to-object map (populated externally)
  private _entityObjects: EntityObjectMap = new Map();

  // Selection materials
  private _selectionMaterial: THREE.ShaderMaterial;
  private _preSelectionMaterial: THREE.ShaderMaterial;

  // Render mode material caches
  private _originalMaterials: Map<string, THREE.Material | THREE.Material[]> = new Map();

  // Raycaster
  private _raycaster: THREE.Raycaster;

  // GPU picking
  private _pickRenderTarget: THREE.WebGLRenderTarget | null = null;
  private _pickScene: THREE.Scene;
  private _pickOverlayScene: THREE.Scene;
  private _pickMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private _pickLineMaterials = new Map<string, THREE.LineBasicMaterial>(); // track line materials for disposal
  private _pickIdToEntity = new Map<number, string>(); // encoded color -> entityId
  private _pickEntityToId = new Map<string, number>(); // entityId -> encoded color
  private _nextPickId = 1;
  private _pickPixelBuffer = new Uint8Array(4);
  /** Pick aperture radius in CSS px — nearest hit within this box wins. */
  private static readonly PICK_APERTURE_RADIUS = 3;
  private _pickRegionBuffer = new Uint8Array(
    (WebGLRenderer.PICK_APERTURE_RADIUS * 2 + 1) ** 2 * 4,
  );
  private _pickSceneDirty = true;  // rebuild pick scene objects (entity added/removed)
  private _pickBufferDirty = true; // re-render pick buffer (camera moved)
  // Batched pick mesh (vertex-color encoded face IDs)
  private _batchedPickMesh: THREE.Mesh | null = null;
  private _batchedPickIdToFace: Map<number, string> = new Map();
  private _batchedFaceHighlightFn: ((faceId: string) => THREE.BufferGeometry | null) | null = null;
  // Temporary highlight meshes for batched faces
  private _batchedHighlights = new Map<string, THREE.Mesh>();
  // Geometry cache for batched face highlights — avoids re-creating geometry each hover
  private _batchedHighlightGeoCache = new Map<string, THREE.BufferGeometry>();
  // Camera movement detection — numeric comparison avoids string allocation per frame
  private _lastCamX = NaN;
  private _lastCamY = NaN;
  private _lastCamZ = NaN;
  private _lastCamQx = NaN;
  private _lastCamQy = NaN;
  private _lastCamQz = NaN;
  private _lastCamQw = NaN;
  private _lastCamP0 = NaN; // projectionMatrix[0] — encodes fov/aspect/ortho zoom
  private _lastCamP5 = NaN; // projectionMatrix[5]

  // Stats
  private _stats: IRenderStats = { fps: 0, frameTime: 0, drawCalls: 0, triangles: 0 };
  private _lastFrameTime = 0;
  private _frameCount = 0;
  private _fpsAccumulator = 0;
  private _lastFpsUpdate = 0;

  constructor(cameraController: CameraController) {
    this._cameraController = cameraController;
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0xd4d4d8);

    this._overlayScene = new THREE.Scene();

    this._guideGroup = new THREE.Group();
    this._guideGroup.name = 'guides';
    this._overlayScene.add(this._guideGroup);

    this._selectionOutlines = new THREE.Group();
    this._selectionOutlines.name = 'selection-outlines';
    this._overlayScene.add(this._selectionOutlines);

    this._preSelectionOutline = new THREE.Group();
    this._preSelectionOutline.name = 'pre-selection-outline';
    this._overlayScene.add(this._preSelectionOutline);

    this._selectionMaterial = createSelectionOutlineMaterial();
    this._preSelectionMaterial = createPreSelectionMaterial();

    this._raycaster = new THREE.Raycaster();
    this._raycaster.params.Line = { threshold: 0.1 };
    this._raycaster.params.Points = { threshold: 0.1 };

    this._pickScene = new THREE.Scene();
    this._pickScene.background = new THREE.Color(0x000000); // black = no entity
    this._pickOverlayScene = new THREE.Scene();
  }

  /** Whether picking is available (per-entity objects or batched pick mesh). */
  hasEntityObjects(): boolean {
    return this._entityObjects.size > 0 || this._batchedPickMesh !== null;
  }

  /** Returns the main Three.js scene for external manipulation. */
  getScene(): THREE.Scene {
    return this._scene;
  }

  /** Returns the overlay scene (grid, axes, guides, selections). */
  getOverlayScene(): THREE.Scene {
    return this._overlayScene;
  }

  /** Force a pick-buffer re-render on the next gpuPick. SceneBridge calls
   *  this after geometry sync: vertex positions update in-place (shared
   *  buffers), so entity registration never fires and the pick buffer would
   *  otherwise keep showing pre-edit geometry until the camera moves. */
  markPickBufferDirty(): void {
    this._pickBufferDirty = true;
  }

  /** Register an entity's Three.js object for picking/highlighting. */
  registerEntityObject(entityId: string, object: THREE.Object3D): void {
    object.userData.entityId = entityId;
    this._entityObjects.set(entityId, object);
    // Incremental: add to pick scene directly instead of full rebuild
    this._addToPickScene(entityId, object);
    this._pickBufferDirty = true;
  }

  /** Unregister an entity's Three.js object. */
  unregisterEntityObject(entityId: string): void {
    // The entity may be deleted WHILE highlighted (eraser removes the hovered
    // edge, Delete removes the selection). The restore path looks the object
    // up by id and silently skips missing entities, orphaning the glow tube
    // right where the erased edge was — purge the artifacts here instead.
    this._removeHighlightArtifactsById(entityId);
    this._preSelectionEntityIds.delete(entityId);
    this._selectedEntityIds.delete(entityId);
    this._entityObjects.delete(entityId);
    // Incremental: remove from pick scene directly instead of full rebuild
    this._removeFromPickScene(entityId);
    this._pickBufferDirty = true;
  }

  /** Remove highlight leftovers (face overlays, material swap, glow tube) for
   *  an entity by id — works even after the entity object itself is gone. */
  private _removeHighlightArtifactsById(id: string): void {
    const overlays = this._faceHighlightOverlays.get(id);
    if (overlays) {
      for (const ov of overlays) ov.parent?.remove(ov);
      this._faceHighlightOverlays.delete(id);
    }
    this._removeBatchedHighlight(id);
    const saved = this._highlightedObjects.get(id);
    if (saved) {
      (saved.obj as any).material = saved.origMaterial;
      if ((saved.obj as any).__glowTube) {
        this._returnGlowTube((saved.obj as any).__glowTube);
        delete (saved.obj as any).__glowTube;
      }
      this._highlightedObjects.delete(id);
    }
  }

  /** Register a function to create highlight geometry for a batched face. */
  setBatchedFaceHighlightFn(fn: (faceId: string) => THREE.BufferGeometry | null): void {
    this._batchedFaceHighlightFn = fn;
  }

  /** Register a batched pick mesh with vertex-color-encoded face IDs for GPU picking. */
  setBatchedPickMesh(mesh: THREE.Mesh, pickIdToFace: Map<number, string>): void {
    this._batchedPickMesh = mesh;
    this._batchedPickIdToFace = pickIdToFace;
    // Ensure per-entity pick IDs don't collide with batched pick IDs
    this._nextPickId = Math.max(this._nextPickId, pickIdToFace.size + 1);
    this._pickSceneDirty = true;
    this._pickBufferDirty = true;
  }

  initialize(canvas: HTMLCanvasElement, width: number, height: number): void {
    this._width = width;
    this._height = height;

    this._renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      stencil: true, // section-cut fill uses stencil capping
    });
    this._renderer.setSize(width, height);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.autoClear = false;
    this._renderer.localClippingEnabled = true;
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.0;

    this._setupLighting();
    this._setupGrid();
    this._setupAxes();

    // GPU picking render target (1:1 pixel ratio for accurate reads)
    this._pickRenderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    this._cameraController.updateAspect(width / height);
  }

  dispose(): void {
    this.stopRenderLoop();
    this._clearBatchedHighlights();
    // Dispose cached highlight geometries
    for (const [, geo] of this._batchedHighlightGeoCache) geo.dispose();
    this._batchedHighlightGeoCache.clear();
    if (this._batchedPickMesh) {
      this._batchedPickMesh.geometry.dispose();
      (this._batchedPickMesh.material as THREE.Material).dispose();
      this._batchedPickMesh = null;
    }
    this._guideLines.forEach((line) => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this._guideLines.clear();
    this._guideLineData.clear();
    this._selectionMaterial.dispose();
    this._preSelectionMaterial.dispose();
    this._pickRenderTarget?.dispose();
    this._pickMaterials.forEach(m => m.dispose());
    this._pickMaterials.clear();
    this._pickLineMaterials.forEach(m => m.dispose());
    this._pickLineMaterials.clear();
    // Dispose glow tube pool
    this._glowTubeGeo?.dispose();
    this._glowSelMat.dispose();
    this._glowPreSelMat.dispose();
    this._glowTubePool.length = 0;
    this._renderer.dispose();
  }

  // ── GPU Picking ─────────────────────────────────────────────────

  /** Mark the pick buffer as needing re-render (call after scene changes). */
  invalidatePick(): void {
    this._pickSceneDirty = true;
    this._pickBufferDirty = true;
  }

  /** Encode an entity ID as a unique color for GPU picking. */
  private getPickId(entityId: string): number {
    let id = this._pickEntityToId.get(entityId);
    if (id !== undefined) return id;
    id = this._nextPickId++;
    this._pickEntityToId.set(entityId, id);
    this._pickIdToEntity.set(id, entityId);
    return id;
  }

  /** Convert a pick ID to raw RGB floats (0-1 range, no color space conversion). */
  private pickIdToRGB(id: number): [number, number, number] {
    return [
      ((id >> 16) & 0xff) / 255,
      ((id >> 8) & 0xff) / 255,
      (id & 0xff) / 255,
    ];
  }

  /** Vertex shader shared by all pick materials. */
  private static readonly PICK_VERT = `
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  /** Fragment shader shared by all pick materials. */
  private static readonly PICK_FRAG = `
    uniform vec3 pickColor;
    void main() {
      gl_FragColor = vec4(pickColor, 1.0);
    }
  `;

  // Track pick objects by entity ID for incremental add/remove
  private _pickObjectsByEntity = new Map<string, THREE.Object3D[]>();

  /** Incrementally add a single entity to the pick scene. */
  private _addToPickScene(entityId: string, obj: THREE.Object3D): void {
    // If pick scene hasn't been built yet, just mark dirty for initial full build
    if (this._pickSceneDirty) return;

    const pickId = this.getPickId(entityId);
    const [r, g, b] = this.pickIdToRGB(pickId);
    const pickMat = new THREE.ShaderMaterial({
      uniforms: { pickColor: { value: new THREE.Vector3(r, g, b) } },
      vertexShader: WebGLRenderer.PICK_VERT,
      fragmentShader: WebGLRenderer.PICK_FRAG,
      side: THREE.DoubleSide,
    });

    const added: THREE.Object3D[] = [];

    if (obj instanceof THREE.Mesh) {
      const pickMesh = new THREE.Mesh(obj.geometry, pickMat);
      pickMesh.matrixAutoUpdate = false;
      pickMesh.matrix.copy(obj.matrixWorld);
      pickMesh.visible = obj.visible;
      pickMesh.userData._pickEntityId = entityId;
      this._pickScene.add(pickMesh);
      added.push(pickMesh);
    } else if (obj instanceof THREE.Line) {
      const pickLine = new THREE.Line(obj.geometry, pickMat);
      pickLine.matrixAutoUpdate = false;
      pickLine.matrix.copy(obj.matrixWorld);
      pickLine.visible = obj.visible;
      pickLine.userData._pickEntityId = entityId;
      this._pickOverlayScene.add(pickLine);
      added.push(pickLine);
    } else if (obj instanceof THREE.Group) {
      obj.traverse(child => {
        if (child instanceof THREE.Mesh && child !== (obj as THREE.Object3D)) {
          const pickMesh = new THREE.Mesh(child.geometry, pickMat);
          pickMesh.matrixAutoUpdate = false;
          pickMesh.matrix.copy(child.matrixWorld);
          pickMesh.visible = child.visible;
          pickMesh.userData._pickEntityId = entityId;
          this._pickScene.add(pickMesh);
          added.push(pickMesh);
        }
      });
    }

    if (added.length > 0) {
      this._pickObjectsByEntity.set(entityId, added);
    }
  }

  /** Incrementally remove a single entity from the pick scene. */
  private _removeFromPickScene(entityId: string): void {
    const objects = this._pickObjectsByEntity.get(entityId);
    if (objects) {
      for (const obj of objects) {
        if (obj.parent === this._pickScene) this._pickScene.remove(obj);
        else if (obj.parent === this._pickOverlayScene) this._pickOverlayScene.remove(obj);
        if ((obj as THREE.Mesh).material) {
          ((obj as THREE.Mesh).material as THREE.Material).dispose();
        }
      }
      this._pickObjectsByEntity.delete(entityId);
    }
  }

  /** Rebuild the pick scene by cloning geometry with pick-color materials. */
  private rebuildPickScene(): void {
    const t0 = performance.now();
    // Dispose previous pick scene objects (geometry is shared, don't dispose it; but remove references)
    for (const child of [...this._pickScene.children]) {
      this._pickScene.remove(child);
    }
    for (const child of [...this._pickOverlayScene.children]) {
      this._pickOverlayScene.remove(child);
    }
    // Dispose old pick materials (ShaderMaterials are created fresh each rebuild)
    this._pickMaterials.forEach(m => m.dispose());
    this._pickMaterials.clear();
    this._pickLineMaterials.forEach(m => m.dispose());
    this._pickLineMaterials.clear();
    // Clear incremental tracking — full rebuild replaces everything
    for (const [, objs] of this._pickObjectsByEntity) {
      for (const o of objs) {
        if ((o as THREE.Mesh).material) ((o as THREE.Mesh).material as THREE.Material).dispose();
      }
    }
    this._pickObjectsByEntity.clear();

    // Clone main scene objects with raw ShaderMaterial pick colors (bypasses color management)
    this._entityObjects.forEach((obj, entityId) => {
      const pickId = this.getPickId(entityId);
      const [r, g, b] = this.pickIdToRGB(pickId);

      // Create ShaderMaterial with raw pick color uniform
      const pickMat = new THREE.ShaderMaterial({
        uniforms: { pickColor: { value: new THREE.Vector3(r, g, b) } },
        vertexShader: WebGLRenderer.PICK_VERT,
        fragmentShader: WebGLRenderer.PICK_FRAG,
        side: THREE.DoubleSide,
      });

      const added: THREE.Object3D[] = [];

      if (obj instanceof THREE.Mesh) {
        const pickMesh = new THREE.Mesh(obj.geometry, pickMat);
        pickMesh.matrixAutoUpdate = false;
        pickMesh.matrix.copy(obj.matrixWorld);
        pickMesh.visible = obj.visible;
        pickMesh.userData._pickEntityId = entityId;
        this._pickScene.add(pickMesh);
        added.push(pickMesh);
      } else if (obj instanceof THREE.Line) {
        const pickLine = new THREE.Line(obj.geometry, pickMat);
        pickLine.matrixAutoUpdate = false;
        pickLine.matrix.copy(obj.matrixWorld);
        pickLine.visible = obj.visible;
        pickLine.userData._pickEntityId = entityId;
        this._pickOverlayScene.add(pickLine);
        added.push(pickLine);
      }

      // Handle groups (face groups contain a mesh child)
      if (obj.parent && obj.parent.userData.entityId === entityId) {
        // Already handled the mesh directly
      } else if (obj instanceof THREE.Group) {
        obj.traverse(child => {
          if (child instanceof THREE.Mesh && child !== (obj as any)) {
            const pickMesh = new THREE.Mesh(child.geometry, pickMat);
            pickMesh.matrixAutoUpdate = false;
            pickMesh.matrix.copy(child.matrixWorld);
            pickMesh.visible = child.visible;
            pickMesh.userData._pickEntityId = entityId;
            this._pickScene.add(pickMesh);
            added.push(pickMesh);
          }
        });
      }

      if (added.length > 0) {
        this._pickObjectsByEntity.set(entityId, added);
      }
    });

    // Add batched pick mesh if available (vertex colors encode face IDs)
    if (this._batchedPickMesh) {
      this._pickScene.add(this._batchedPickMesh);
    }

    if (performance.now() - t0 > 50) {
      console.warn(`[rebuildPickScene] slow: ${(performance.now() - t0).toFixed(1)}ms, ${this._entityObjects.size} entities`);
    }
  }

  /** Render the pick buffer and read the pixel at (screenX, screenY).
   *  Returns the entity ID under the cursor, or null. */
  gpuPick(screenX: number, screenY: number): string | null {
    if (!this._pickRenderTarget || !this._renderer) return null;

    const camera = this._cameraController.getThreeCamera();
    camera.updateMatrixWorld(true);

    // Rebuild pick scene objects only when entities are added/removed
    if (this._pickSceneDirty) {
      this.rebuildPickScene();
      this._pickSceneDirty = false;
      this._pickBufferDirty = true; // must re-render after rebuild
    }

    // Re-render pick buffer when camera moved or scene rebuilt
    if (this._pickBufferDirty) {
      const t0_pick = performance.now();
      const currentRT = this._renderer.getRenderTarget();
      const currentToneMapping = this._renderer.toneMapping;
      const currentOutputColorSpace = this._renderer.outputColorSpace;

      this._renderer.toneMapping = THREE.NoToneMapping;
      this._renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

      this._renderer.setRenderTarget(this._pickRenderTarget);
      this._renderer.clear(true, true, true);
      this._renderer.render(this._pickScene, camera);
      this._renderer.clearDepth();
      this._renderer.render(this._pickOverlayScene, camera);

      this._renderer.setRenderTarget(currentRT);
      this._renderer.toneMapping = currentToneMapping;
      this._renderer.outputColorSpace = currentOutputColorSpace;

      this._pickBufferDirty = false;
      const dt_pick = performance.now() - t0_pick;
      if (dt_pick > 5) console.warn(`[gpuPick] pick buffer re-render took ${dt_pick.toFixed(1)}ms`);
    }

    // Read an aperture around the cursor instead of a single pixel.
    // The pick target is CSS-resolution (not DPR-scaled), so a 1px edge line
    // or a thin face sliver can rasterize just off the cursor's pixel — the
    // single-pixel read made select/push-pull "sometimes" miss what the user
    // is visibly hovering. Center pixel wins; otherwise the nearest non-
    // background pixel within the aperture does.
    // Note: WebGL Y is flipped relative to screen Y.
    const R = WebGLRenderer.PICK_APERTURE_RADIUS;
    const size = R * 2 + 1;
    const cx = Math.max(0, Math.min(this._width - 1, Math.floor(screenX)));
    const cy = Math.max(0, Math.min(this._height - 1, Math.floor(this._height - screenY)));
    const x0 = Math.max(0, Math.min(this._width - size, cx - R));
    const y0 = Math.max(0, Math.min(this._height - size, cy - R));

    this._renderer.readRenderTargetPixels(
      this._pickRenderTarget, x0, y0, size, size, this._pickRegionBuffer,
    );

    const idAt = (px: number, py: number): number => {
      const i = ((py - y0) * size + (px - x0)) * 4;
      return (this._pickRegionBuffer[i] << 16) |
             (this._pickRegionBuffer[i + 1] << 8) |
             this._pickRegionBuffer[i + 2];
    };

    let pickId = idAt(cx, cy);
    if (pickId === 0) {
      let bestDist = Infinity;
      for (let py = y0; py < y0 + size; py++) {
        for (let px = x0; px < x0 + size; px++) {
          const id = idAt(px, py);
          if (id === 0) continue;
          const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
          if (d < bestDist) {
            bestDist = d;
            pickId = id;
          }
        }
      }
    }

    if (pickId === 0) return null; // Background (no entity)

    // Check batched face pick IDs first, then per-entity pick IDs
    const batchedFace = this._batchedPickIdToFace.get(pickId);
    if (batchedFace) return batchedFace;

    return this._pickIdToEntity.get(pickId) || null;
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._renderer.setSize(width, height);
    this._pickRenderTarget?.setSize(width, height);
    this._pickBufferDirty = true;
    this._cameraController.updateAspect(width / height);
  }

  // Performance logging — throttled to once per second
  private _lastPerfLog = 0;
  private _perfFrameCount = 0;
  private _perfMainTotal = 0;
  private _perfOverlayTotal = 0;
  private _perfUpdateTotal = 0;

  /**
   * Render one frame at `scale`× the current resolution and return it as a
   * data URL (offscreen supersampling for image/PDF export). The canvas is
   * restored to its live size afterwards.
   */
  captureImage(scale = 2, mime: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.92): string {
    const w = this._width, h = this._height;
    try {
      this.resize(Math.round(w * scale), Math.round(h * scale));
      this.render();
      return this._renderer.domElement.toDataURL(mime, quality);
    } finally {
      this.resize(w, h);
      this.render();
    }
  }

  render(): void {
    const startTime = performance.now();

    const t0 = performance.now();
    this._cameraController.update();
    const camera = this._cameraController.getThreeCamera();

    // Sky dome rides the camera: only view DIRECTION affects its shading,
    // so the horizon stays put under pans/orbits/walks.
    if (this._skyDome?.visible) {
      this._skyDome.position.copy(camera.position);
      // Orthographic views project parallel rays, so sitting inside the dome
      // no longer fills the frame — the sphere's silhouette shows as a circle.
      // Scale it past the frustum's half-diagonal. The gradient shades by the
      // raw local vertex position, so scaling doesn't shift the horizon.
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
        const oc = camera as THREE.OrthographicCamera;
        const halfW = (oc.right - oc.left) / (2 * oc.zoom);
        const halfH = (oc.top - oc.bottom) / (2 * oc.zoom);
        const scale = (Math.hypot(halfW, halfH) / SKY_DOME_RADIUS) * 1.05;
        this._skyDome.scale.setScalar(Math.max(1, scale));
      } else {
        this._skyDome.scale.setScalar(1);
      }
    }
    const tUpdate = performance.now() - t0;

    // Mark pick buffer dirty when the camera VIEW changes (numeric compare,
    // no allocation). Position alone is not enough: orthographic zoom only
    // changes the projection matrix, and in-place rotation only changes the
    // quaternion — both left a stale pick buffer, so select/push-pull picked
    // entities at their pre-zoom screen locations.
    const pos = camera.position;
    const quat = camera.quaternion;
    const proj = camera.projectionMatrix.elements;
    if (pos.x !== this._lastCamX || pos.y !== this._lastCamY || pos.z !== this._lastCamZ ||
        quat.x !== this._lastCamQx || quat.y !== this._lastCamQy ||
        quat.z !== this._lastCamQz || quat.w !== this._lastCamQw ||
        proj[0] !== this._lastCamP0 || proj[5] !== this._lastCamP5) {
      this._lastCamX = pos.x;
      this._lastCamY = pos.y;
      this._lastCamZ = pos.z;
      this._lastCamQx = quat.x;
      this._lastCamQy = quat.y;
      this._lastCamQz = quat.z;
      this._lastCamQw = quat.w;
      this._lastCamP0 = proj[0];
      this._lastCamP5 = proj[5];
      this._pickBufferDirty = true;
    }

    this._renderer.clear(true, true, true);

    // Render main scene
    const t1 = performance.now();
    this._renderer.render(this._scene, camera);
    const tMain = performance.now() - t1;

    // Render overlay scene on top (no depth clear)
    this._renderer.clearDepth();
    const t2 = performance.now();
    this._renderer.render(this._overlayScene, camera);
    const tOverlay = performance.now() - t2;

    // Perf accumulation (no logging — use stats overlay instead)
    this._perfFrameCount++;
    this._perfMainTotal += tMain;
    this._perfOverlayTotal += tOverlay;
    this._perfUpdateTotal += tUpdate;
    if (startTime - this._lastPerfLog >= 1000) {
      this._perfFrameCount = 0;
      this._perfMainTotal = 0;
      this._perfOverlayTotal = 0;
      this._perfUpdateTotal = 0;
      this._lastPerfLog = startTime;
    }

    // Stats tracking
    const frameTime = performance.now() - startTime;
    this._stats.frameTime = frameTime;
    this._frameCount++;
    this._fpsAccumulator += frameTime;

    const now = performance.now();
    if (now - this._lastFpsUpdate >= 1000) {
      this._stats.fps = Math.round(this._frameCount / ((now - this._lastFpsUpdate) / 1000));
      this._frameCount = 0;
      this._fpsAccumulator = 0;
      this._lastFpsUpdate = now;
    }

    const info = this._renderer.info;
    this._stats.drawCalls = info.render.calls;
    this._stats.triangles = info.render.triangles;
  }

  startRenderLoop(): void {
    if (this._running) return;
    this._running = true;
    this._lastFpsUpdate = performance.now();
    this._frameCount = 0;

    const loop = (): void => {
      if (!this._running) return;
      this.render();
      this._animationFrameId = requestAnimationFrame(loop);
    };
    this._animationFrameId = requestAnimationFrame(loop);
  }

  stopRenderLoop(): void {
    this._running = false;
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  setRenderMode(mode: RenderMode): void {
    if (mode === this._renderMode) return;

    // Restore original materials before switching
    this._restoreOriginalMaterials();
    this._renderMode = mode;
    this._applyRenderMode();
  }

  getRenderMode(): RenderMode {
    return this._renderMode;
  }

  // Reusable NDC vector for pick() — avoids allocation per call
  private _pickNdc = new THREE.Vector2();

  pick(screenX: number, screenY: number): { entityId: string; point: Vec3 } | null {
    const ndc = this._pickNdc.set(
      (screenX / this._width) * 2 - 1,
      -(screenY / this._height) * 2 + 1,
    );

    const camera = this._cameraController.getThreeCamera();
    this._raycaster.setFromCamera(ndc, camera);

    const intersects = this._raycaster.intersectObjects(this._scene.children, true);

    for (const hit of intersects) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData.entityId) {
          return {
            entityId: obj.userData.entityId,
            point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
          };
        }
        obj = obj.parent;
      }
    }

    return null;
  }

  getStats(): IRenderStats {
    return this._stats;
  }

  setSelectionHighlight(entityIds: string[]): void {
    // Short-circuit: if same set of IDs, skip all work
    if (entityIds.length === this._selectedEntityIds.size) {
      let same = true;
      for (const id of entityIds) {
        if (!this._selectedEntityIds.has(id)) { same = false; break; }
      }
      if (same) { return; }
    }

    const t0 = performance.now();
    // Restore previously highlighted objects
    this._restoreHighlighted();
    const dtRestore = performance.now() - t0;
    // Remove old batched highlights
    this._clearBatchedHighlights();
    this._selectedEntityIds = new Set(entityIds);

    let applied = 0, batched = 0;
    for (const id of entityIds) {
      const obj = this._entityObjects.get(id);
      if (obj) {
        this._applyHighlight(obj, 'selection');
        applied++;
      } else {
        // Try batched face highlight
        this._addBatchedHighlight(id, 'selection');
        batched++;
      }
    }
    const dt = performance.now() - t0;
    if (dt > 2) console.warn(`[setSelectionHighlight] ${dt.toFixed(1)}ms — restore: ${dtRestore.toFixed(1)}ms, applied: ${applied}, batched: ${batched}`);
  }

  setPreSelectionHighlight(entityId: string | null): void {
    this.setPreSelectionHighlightMulti(entityId ? [entityId] : []);
  }

  setPreSelectionHighlightMulti(entityIds: string[]): void {
    // Short-circuit: if same set of IDs, skip all work
    if (entityIds.length === this._preSelectionEntityIds.size) {
      let same = true;
      for (const id of entityIds) {
        if (!this._preSelectionEntityIds.has(id)) { same = false; break; }
      }
      if (same) { return; }
    }

    const t0 = performance.now();
    // Restore previous pre-selection entities
    let restored = 0;
    for (const prevId of this._preSelectionEntityIds) {
      if (!entityIds.includes(prevId)) {
        const prevObj = this._entityObjects.get(prevId);
        if (prevObj && !this._selectedEntityIds.has(prevId)) {
          this._restoreObject(prevObj);
          restored++;
        } else if (!prevObj) {
          // Entity was deleted while pre-selected — drop its glow/overlays.
          this._removeHighlightArtifactsById(prevId);
        }
        // Remove batched highlight for deselected entities
        this._removeBatchedHighlight(prevId);
      }
    }
    const dtRestore = performance.now() - t0;

    this._preSelectionEntityIds = new Set(entityIds);

    let applied = 0;
    for (const id of entityIds) {
      if (!this._selectedEntityIds.has(id)) {
        const obj = this._entityObjects.get(id);
        if (obj) {
          this._applyHighlight(obj, 'preselection');
          applied++;
        } else {
          // Try batched face highlight
          this._addBatchedHighlight(id, 'preselection');
        }
      }
    }
    const dt = performance.now() - t0;
    if (dt > 2) console.warn(`[setPreSelectionHighlight] ${dt.toFixed(1)}ms — restore: ${dtRestore.toFixed(1)}ms (${restored}), applied: ${applied}, total ids: ${entityIds.length}`);
  }

  // Selection highlight materials
  private _selHighlightFace = new THREE.MeshBasicMaterial({
    color: 0x3388ff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  private _selHighlightEdge = new THREE.LineBasicMaterial({
    color: 0x00aaff,
    linewidth: 5,
  });

  private _preSelHighlightFace = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  private _preSelHighlightEdge = new THREE.LineBasicMaterial({
    color: 0x2266dd,
    linewidth: 5,
  });

  // Store original materials for restoration (used for edge Line meshes only).
  private _highlightedObjects = new Map<string, { obj: THREE.Object3D; origMaterial: THREE.Material | THREE.Material[] }>();

  // Face highlights: overlay meshes added on top so the underlying texture stays visible.
  private _faceHighlightOverlays = new Map<string, THREE.Mesh[]>();

  // Reusable vectors for highlight calculations (avoid allocation per call)
  private _hlP1 = new THREE.Vector3();
  private _hlP2 = new THREE.Vector3();
  private _hlDir = new THREE.Vector3();
  private _hlMid = new THREE.Vector3();

  // Glow tube pool: reuse geometry + material instead of creating new ones each hover
  private _glowTubePool: THREE.Mesh[] = [];
  private _glowTubeGeo: THREE.CylinderGeometry | null = null;
  private _glowSelMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.7, depthTest: false });
  private _glowPreSelMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.7, depthTest: false });

  private _getGlowTube(): THREE.Mesh {
    const pooled = this._glowTubePool.pop();
    if (pooled) return pooled;
    // Create shared geometry once (unit cylinder, will be scaled per-edge)
    if (!this._glowTubeGeo) {
      this._glowTubeGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
      this._glowTubeGeo.rotateX(Math.PI / 2);
    }
    const tube = new THREE.Mesh(this._glowTubeGeo, this._glowSelMat);
    tube.raycast = () => {}; // Non-raycastable
    return tube;
  }

  private _returnGlowTube(tube: THREE.Mesh): void {
    this._overlayScene.remove(tube);
    this._glowTubePool.push(tube);
  }

  private _applyHighlight(obj: THREE.Object3D, mode: 'selection' | 'preselection'): void {
    const id = obj.userData.entityId;
    if (!id) return;

    if (obj instanceof THREE.Mesh) {
      // Render a translucent overlay mesh on top instead of swapping the material,
      // so the underlying texture stays visible through the highlight tint.
      if (this._faceHighlightOverlays.has(id)) return;
      const overlays: THREE.Mesh[] = [];
      const mat = mode === 'selection' ? this._selHighlightFace : this._preSelHighlightFace;

      const addOverlay = (mesh: THREE.Mesh) => {
        const overlay = new THREE.Mesh(mesh.geometry, mat);
        overlay.renderOrder = (mesh.renderOrder || 0) + 1;
        overlay.frustumCulled = mesh.frustumCulled;
        overlay.raycast = () => {};
        overlay.position.copy(mesh.position);
        overlay.quaternion.copy(mesh.quaternion);
        overlay.scale.copy(mesh.scale);
        (mesh.parent ?? this._scene).add(overlay);
        overlays.push(overlay);
      };

      addOverlay(obj);
      // Also overlay sibling meshes in the same group (front+back face meshes)
      if (obj.parent && obj.parent !== this._scene) {
        obj.parent.traverse(child => {
          if (child !== obj && child instanceof THREE.Mesh && !overlays.some(o => o.geometry === child.geometry)) {
            addOverlay(child);
          }
        });
      }
      this._faceHighlightOverlays.set(id, overlays);
    } else if (obj instanceof THREE.Line) {
      // Highlight edges by swapping material + adding a reusable glow tube
      if (!this._highlightedObjects.has(id)) {
        this._highlightedObjects.set(id, { obj, origMaterial: obj.material as THREE.Material });
      }
      obj.material = mode === 'selection' ? this._selHighlightEdge : this._preSelHighlightEdge;

      // Add a tube mesh along the edge for visible thickness (reuse from pool)
      const positions = (obj.geometry as THREE.BufferGeometry).getAttribute('position');
      if (positions && positions.count >= 2) {
        this._hlP1.set(positions.getX(0), positions.getY(0), positions.getZ(0));
        this._hlP2.set(positions.getX(1), positions.getY(1), positions.getZ(1));
        this._hlDir.subVectors(this._hlP2, this._hlP1);
        const len = this._hlDir.length();
        if (len > 0.001) {
          // Scale tube radius by camera distance so highlight looks constant on screen
          this._hlMid.addVectors(this._hlP1, this._hlP2).multiplyScalar(0.5);
          const camPos = this._cameraController.getThreeCamera().position;
          const camDist = this._hlMid.distanceTo(camPos);
          const tubeRadius = Math.max(camDist * 0.003, 0.005);

          const tube = this._getGlowTube();
          tube.material = mode === 'selection' ? this._glowSelMat : this._glowPreSelMat;
          tube.name = `edge-glow-${id}`;
          tube.position.copy(this._hlMid);
          tube.scale.set(tubeRadius, tubeRadius, len);
          tube.lookAt(this._hlP2);
          (obj as any).__glowTube = tube;
          this._overlayScene.add(tube);
        }
      }
    }
  }

  /** Update glow tube positions for all highlighted edges (call after vertex positions change). */
  refreshEdgeHighlightPositions(): void {
    for (const [id, saved] of this._highlightedObjects) {
      if (!(saved.obj instanceof THREE.Line)) continue;
      const tube = (saved.obj as any).__glowTube as THREE.Mesh | undefined;
      if (!tube) continue;

      const positions = (saved.obj.geometry as THREE.BufferGeometry).getAttribute('position');
      if (!positions || positions.count < 2) continue;

      this._hlP1.set(positions.getX(0), positions.getY(0), positions.getZ(0));
      this._hlP2.set(positions.getX(1), positions.getY(1), positions.getZ(1));
      this._hlDir.subVectors(this._hlP2, this._hlP1);
      const len = this._hlDir.length();
      if (len > 0.001) {
        this._hlMid.addVectors(this._hlP1, this._hlP2).multiplyScalar(0.5);
        const camPos = this._cameraController.getThreeCamera().position;
        const camDist = this._hlMid.distanceTo(camPos);
        const tubeRadius = Math.max(camDist * 0.003, 0.005);

        tube.position.copy(this._hlMid);
        tube.scale.set(tubeRadius, tubeRadius, len);
        tube.lookAt(this._hlP2);
      }
    }
  }

  /** Update the saved original material for a highlighted object.
   *  Call this after syncFace changes a face's material while it's highlighted. */
  refreshHighlightOriginal(entityId: string, newMaterial: THREE.Material | THREE.Material[]): void {
    const saved = this._highlightedObjects.get(entityId);
    if (saved) {
      saved.origMaterial = newMaterial;
    }
  }

  private _restoreObject(obj: THREE.Object3D): void {
    const id = obj.userData.entityId;
    if (!id) return;

    // Remove face highlight overlays (textures stay visible since materials were never swapped).
    const overlays = this._faceHighlightOverlays.get(id);
    if (overlays) {
      for (const ov of overlays) ov.parent?.remove(ov);
      this._faceHighlightOverlays.delete(id);
    }

    const saved = this._highlightedObjects.get(id);
    if (saved && (saved.obj instanceof THREE.Mesh || saved.obj instanceof THREE.Line)) {
      (saved.obj as any).material = saved.origMaterial;
      // Return glow tube to pool instead of disposing
      if ((saved.obj as any).__glowTube) {
        this._returnGlowTube((saved.obj as any).__glowTube);
        delete (saved.obj as any).__glowTube;
      }
      this._highlightedObjects.delete(id);
    }

    // Restore parent group children too
    if (obj.parent && obj.parent !== this._scene) {
      obj.parent.traverse(child => {
        const childSaved = this._highlightedObjects.get(child.uuid);
        if (childSaved && (childSaved.obj instanceof THREE.Mesh || childSaved.obj instanceof THREE.Line)) {
          (childSaved.obj as any).material = childSaved.origMaterial;
          this._highlightedObjects.delete(child.uuid);
        }
      });
    }
  }

  /** Add a temporary highlight mesh for a batched face. */
  private _addBatchedHighlight(faceId: string, mode: 'selection' | 'preselection'): void {
    if (!this._batchedFaceHighlightFn || this._batchedHighlights.has(faceId)) return;
    // Use cached geometry if available, otherwise create and cache
    let geo = this._batchedHighlightGeoCache.get(faceId);
    if (!geo) {
      const created = this._batchedFaceHighlightFn(faceId);
      if (!created) return;
      geo = created;
      this._batchedHighlightGeoCache.set(faceId, geo);
    }
    const mat = mode === 'selection' ? this._selHighlightFace : this._preSelHighlightFace;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `batched-highlight-${faceId}`;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    this._scene.add(mesh);
    this._batchedHighlights.set(faceId, mesh);
  }

  /** Remove a specific batched highlight mesh. */
  private _removeBatchedHighlight(faceId: string): void {
    const mesh = this._batchedHighlights.get(faceId);
    if (mesh) {
      this._scene.remove(mesh);
      // Don't dispose geometry — it's cached in _batchedHighlightGeoCache
      this._batchedHighlights.delete(faceId);
    }
  }

  /** Remove all batched highlight meshes. */
  private _clearBatchedHighlights(): void {
    for (const [, mesh] of this._batchedHighlights) {
      this._scene.remove(mesh);
      // Don't dispose geometry — cached
    }
    this._batchedHighlights.clear();
  }

  private _restoreHighlighted(): void {
    // Remove all face highlight overlays
    for (const [, overlays] of this._faceHighlightOverlays) {
      for (const ov of overlays) ov.parent?.remove(ov);
    }
    this._faceHighlightOverlays.clear();

    for (const [, { obj, origMaterial }] of this._highlightedObjects) {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        (obj as any).material = origMaterial;
      }
      // Return glow tubes to pool instead of disposing
      if ((obj as any).__glowTube) {
        this._returnGlowTube((obj as any).__glowTube);
        delete (obj as any).__glowTube;
      }
    }
    this._highlightedObjects.clear();
  }

  addGuideLine(id: string, start: Vec3, end: Vec3, color: Color, dashed?: boolean, opts?: { depthTest?: boolean; renderOrder?: number; opacity?: number; linewidth?: number; selectable?: boolean }): void {
    this.removeGuideLine(id);

    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(start.x, start.y, start.z),
      new THREE.Vector3(end.x, end.y, end.z),
    ]);

    let material: THREE.Material;
    const threeColor = new THREE.Color(color.r, color.g, color.b);
    const depthTest = opts?.depthTest ?? true;
    const transparent = (opts?.opacity !== undefined && opts.opacity < 1);
    const linewidth = opts?.linewidth ?? 1;

    if (dashed) {
      material = new THREE.LineDashedMaterial({
        color: threeColor,
        dashSize: 0.2,
        gapSize: 0.1,
        linewidth,
        depthTest,
        transparent,
        opacity: opts?.opacity ?? 1,
      });
    } else {
      material = new THREE.LineBasicMaterial({
        color: threeColor,
        linewidth,
        depthTest,
        transparent,
        opacity: opts?.opacity ?? 1,
      });
    }

    const line = new THREE.Line(geometry, material);
    if (dashed) line.computeLineDistances();
    line.name = `guide-${id}`;
    if (opts?.renderOrder !== undefined) line.renderOrder = opts.renderOrder;

    // When selectable, register the line as an entity object so it shows up in
    // the GPU pick buffer and the existing selection / highlight pipeline.
    if (opts?.selectable) {
      line.userData.entityId = id;
      line.userData.isGuideLine = true;
      this.registerEntityObject(id, line);
    }

    this._guideLines.set(id, line);
    this._guideLineData.set(id, {
      start: { x: start.x, y: start.y, z: start.z },
      end: { x: end.x, y: end.y, z: end.z },
      color: { r: color.r, g: color.g, b: color.b },
      dashed: !!dashed,
    });
    this._guideGroup.add(line);
  }

  /** Returns true if the given id is a guide line. Used by select tool to
   *  route Delete to the right path. */
  // ── Shadows (classic CAD sun) ────────────────────────────────────

  private _shadowGround: THREE.Mesh | null = null;
  private _shadowsOn = false;

  /** Toggle classic-CAD-style sun shadows: a ground shadow-catcher plane plus
   *  the directional sun casting. Faces already cast; the catcher makes the
   *  shadows visible on the ground plane. */
  setShadowsEnabled(on: boolean): void {
    this._shadowsOn = on;
    this._sunLight.castShadow = on;
    if (on && !this._shadowGround) {
      const geo = new THREE.PlaneGeometry(2000, 2000);
      const mat = new THREE.ShadowMaterial({ opacity: 0.28 });
      const ground = new THREE.Mesh(geo, mat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.002; // under the grid, avoids z-fighting
      ground.receiveShadow = true;
      ground.raycast = () => { /* not pickable */ };
      this._scene.add(ground);
      this._shadowGround = ground;
    }
    if (this._shadowGround) this._shadowGround.visible = on;
  }

  get shadowsEnabled(): boolean { return this._shadowsOn; }

  /** Position the sun from day-of-year + local solar hour + latitude
   *  (the classic modeler's date/time shadow sliders). Standard solar geometry. */
  setSunPosition(dayOfYear: number, hour: number, latitudeDeg = 40): void {
    const rad = Math.PI / 180;
    const decl = 23.45 * rad * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365);
    const lat = latitudeDeg * rad;
    const hourAngle = 15 * (hour - 12) * rad;
    const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const azi = Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
    );
    // Sun direction: altitude above horizon, azimuth from north (+z toward south)
    const R = 100;
    const y = Math.max(0.05, Math.sin(alt)) * R;
    const horiz = Math.cos(alt) * R;
    this._sunLight.position.set(
      Math.sin(azi) * horiz,
      y,
      Math.cos(azi) * horiz,
    );
  }

  private _skyDome: THREE.Mesh | null = null;

  /**
   * classic-CAD-style sky/ground background (or back to solid). Implemented as
   * a camera-following dome shaded by VIEW DIRECTION — the blue/tan
   * transition sits exactly where the view ray is horizontal, so it stays on
   * the horizon as the camera orbits/pans/tilts. (A screen-space gradient
   * texture just sticks to the glass.)
   */
  setBackgroundMode(mode: 'solid' | 'sky'): void {
    const scene = this.getScene();
    if (mode === 'solid') {
      if (this._skyDome) this._skyDome.visible = false;
      scene.background = new THREE.Color(0xf0f0f0);
      return;
    }

    if (!this._skyDome) {
      const geo = new THREE.SphereGeometry(SKY_DOME_RADIUS, 32, 24);
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color('#9cc3e8') },
          skyHorizon: { value: new THREE.Color('#dfeaf4') },
          groundHorizon: { value: new THREE.Color('#e8e4da') },
          ground: { value: new THREE.Color('#d5cfc2') },
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = position; // dome is centered on the camera → local pos = view dir
            // Pin to the far plane so the dome is behind everything at any size
            vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = clip.xyww;
          }
        `,
        fragmentShader: `
          varying vec3 vDir;
          uniform vec3 zenith;
          uniform vec3 skyHorizon;
          uniform vec3 groundHorizon;
          uniform vec3 ground;
          void main() {
            float h = normalize(vDir).y;
            vec3 color;
            if (h >= 0.0) {
              color = mix(skyHorizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
            } else {
              color = mix(groundHorizon, ground, pow(clamp(-h, 0.0, 1.0), 0.5));
            }
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      });
      const dome = new THREE.Mesh(geo, mat);
      dome.name = 'sky-dome';
      dome.frustumCulled = false;
      dome.renderOrder = -1000; // draw first, behind everything
      dome.raycast = () => { /* not pickable */ };
      scene.add(dome);
      this._skyDome = dome;
    }
    this._skyDome.visible = true;
    scene.background = null;
  }

  isGuideLine(id: string): boolean {
    return this._guideLines.has(id);
  }

  /** Persistent construction guides (selectable: true — tool-created guide
   *  lines/points, NOT ephemeral inference guides). Used by snap detection
   *  and Edit > Delete Guides. userData.isGuideLine is only set on
   *  selectable guides, which is exactly the persistent set. */
  getConstructionGuides(): Array<{ id: string; start: Vec3; end: Vec3 }> {
    const out: Array<{ id: string; start: Vec3; end: Vec3 }> = [];
    this._guideLines.forEach((line, id) => {
      if (!line.userData.isGuideLine) return;
      const d = this._guideLineData.get(id);
      if (d) out.push({ id, start: d.start, end: d.end });
    });
    return out;
  }

  /** Returns the GuideLineDelta for a registered guide line (for undo). */
  getGuideLineData(id: string): { start: Vec3; end: Vec3; color: Color; dashed: boolean } | null {
    return this._guideLineData.get(id) ?? null;
  }

  removeGuideLine(id: string): void {
    const line = this._guideLines.get(id);
    if (line) {
      if (line.userData.isGuideLine) {
        this.unregisterEntityObject(id);
      }
      this._guideGroup.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this._guideLines.delete(id);
      this._guideLineData.delete(id);
    }
  }

  clearGuideLines(): void {
    this._guideLines.forEach((line, id) => {
      if (line.userData.isGuideLine) this.unregisterEntityObject(id);
      this._guideGroup.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this._guideLines.clear();
    this._guideLineData.clear();
  }

  setGridVisible(visible: boolean): void {
    this._gridVisible = visible;
    this._grid.visible = visible;
  }

  /** Set the visible grid's major spacing (meters); sub-grid follows at 1/10. */
  setGridSpacing(meters: number): void {
    if (!(meters > 0)) return;
    const mat = (this._grid as any)?.material as THREE.ShaderMaterial | undefined;
    if (!mat?.uniforms?.gridSpacing) return;
    mat.uniforms.gridSpacing.value = meters;
    if (mat.uniforms.subGridSpacing) mat.uniforms.subGridSpacing.value = meters / 10;
  }

  setAxesVisible(visible: boolean): void {
    this._axesVisible = visible;
    this._axes.visible = visible;
  }

  // Reusable objects for section plane (avoid allocation per call)
  private _sectionNormal = new THREE.Vector3();
  private _sectionPoint = new THREE.Vector3();
  private _sectionPlane = new THREE.Plane();

  private _activeSection: { point: Vec3; normal: Vec3 } | null = null;
  private _sectionCapGroup: THREE.Group | null = null;

  /** Active section plane (for scene tabs to capture/restore). */
  getSectionPlane(): { point: Vec3; normal: Vec3 } | null {
    return this._activeSection ? {
      point: { ...this._activeSection.point },
      normal: { ...this._activeSection.normal },
    } : null;
  }

  setSectionPlane(plane: { point: Vec3; normal: Vec3 } | null): void {
    this._activeSection = plane ? { point: { ...plane.point }, normal: { ...plane.normal } } : null;
    this._clearSectionCaps();
    if (!plane) {
      // Clear clipping on all scene materials
      this._scene.traverse((obj) => {
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material as THREE.Material;
          if (Array.isArray(mat)) {
            mat.forEach(m => { m.clippingPlanes = []; });
          } else {
            mat.clippingPlanes = [];
          }
        }
      });
      return;
    }

    const { point, normal } = plane;
    const n = this._sectionNormal.set(normal.x, normal.y, normal.z).normalize();
    const constant = -n.dot(this._sectionPoint.set(point.x, point.y, point.z));
    const clipPlane = this._sectionPlane.set(n, constant);

    this._scene.traverse((obj) => {
      if ((obj as THREE.Mesh).material) {
        const mat = (obj as THREE.Mesh).material as THREE.Material;
        if (Array.isArray(mat)) {
          mat.forEach(m => { m.clippingPlanes = [clipPlane]; });
        } else {
          mat.clippingPlanes = [clipPlane];
        }
      }
    });

    this._buildSectionCaps(clipPlane, plane);
  }

  /** Rebuild the stencil cap meshes — call after geometry changes while a
   *  section is active so the fill tracks the model. */
  refreshSectionCaps(): void {
    if (!this._activeSection) return;
    this.setSectionPlane(this._activeSection);
  }

  private _clearSectionCaps(): void {
    if (this._sectionCapGroup) {
      this._scene.remove(this._sectionCapGroup);
      this._sectionCapGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach(m => m.dispose());
        }
        // Plane quad owns its geometry; stencil meshes share face geometries.
        if (mesh.userData.ownsGeometry) mesh.geometry?.dispose();
      });
      this._sectionCapGroup = null;
    }
  }

  /** Stencil capping (three.js clipping_stencil technique): render clipped
   *  solids' back faces incrementing stencil and front faces decrementing —
   *  where stencil ≠ 0 the plane cuts through an interior. A quad on the
   *  section plane painted only where stencil ≠ 0 becomes the cut fill. */
  private _buildSectionCaps(clipPlane: THREE.Plane, plane: { point: Vec3; normal: Vec3 }): void {
    const group = new THREE.Group();
    group.name = 'section-caps';

    const makeStencilMat = (side: THREE.Side, op: THREE.StencilOp) => {
      const mat = new THREE.MeshBasicMaterial();
      mat.depthWrite = false;
      mat.depthTest = false;
      mat.colorWrite = false;
      mat.stencilWrite = true;
      mat.stencilFunc = THREE.AlwaysStencilFunc;
      mat.side = side;
      mat.stencilFail = op;
      mat.stencilZFail = op;
      mat.stencilZPass = op;
      mat.clippingPlanes = [clipPlane];
      return mat;
    };

    // Stencil writers share the face meshes' geometry (no copies)
    this._scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh instanceof THREE.Mesh)) return;
      if (mesh.userData.entityType !== 'face' && obj.parent?.userData?.entityType !== 'face') return;
      const front = new THREE.Mesh(mesh.geometry, makeStencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp));
      const back = new THREE.Mesh(mesh.geometry, makeStencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp));
      front.renderOrder = 1;
      back.renderOrder = 1;
      front.raycast = () => { /* not pickable */ };
      back.raycast = () => { /* not pickable */ };
      group.add(front, back);
    });

    // The fill quad on the section plane, visible only where stencil ≠ 0
    const quadGeo = new THREE.PlaneGeometry(2000, 2000);
    const quadMat = new THREE.MeshStandardMaterial({
      color: 0x555555, // classic-CAD-style dark section fill
      metalness: 0,
      roughness: 1,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
      side: THREE.DoubleSide,
    });
    const quad = new THREE.Mesh(quadGeo, quadMat);
    quad.userData.ownsGeometry = true;
    quad.raycast = () => { /* not pickable */ };
    const n2 = new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z).normalize();
    quad.position.set(plane.point.x, plane.point.y, plane.point.z);
    quad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n2);
    quad.renderOrder = 2;
    quad.onAfterRender = (renderer) => { renderer.clearStencil(); };
    group.add(quad);

    this._scene.add(group);
    this._sectionCapGroup = group;
  }

  // ─── Private ───────────────────────────────────────────────────

  private _setupLighting(): void {
    this._ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this._scene.add(this._ambientLight);

    this._sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    this._sunLight.position.set(50, 80, 50);
    this._sunLight.castShadow = true;
    this._sunLight.shadow.mapSize.width = 2048;
    this._sunLight.shadow.mapSize.height = 2048;
    this._sunLight.shadow.camera.left = -50;
    this._sunLight.shadow.camera.right = 50;
    this._sunLight.shadow.camera.top = 50;
    this._sunLight.shadow.camera.bottom = -50;
    this._sunLight.shadow.camera.near = 0.1;
    this._sunLight.shadow.camera.far = 200;
    this._sunLight.shadow.bias = -0.005;
    this._scene.add(this._sunLight);

    // Hemisphere light for softer fill
    const hemiLight = new THREE.HemisphereLight(0xb1e1ff, 0xb97a20, 0.3);
    this._scene.add(hemiLight);
  }

  private _setupGrid(): void {
    // Infinite grid using a shader on a large plane
    const gridVertexShader = `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const gridFragmentShader = `
      varying vec3 vWorldPos;
      uniform float gridSpacing;
      uniform float subGridSpacing;
      uniform vec3 gridColor;
      uniform vec3 subGridColor;
      uniform float fadeDistance;

      float gridLine(float coord, float spacing, float lineWidth) {
        float d = abs(fract(coord / spacing - 0.5) - 0.5) * spacing;
        return 1.0 - smoothstep(0.0, lineWidth, d);
      }

      void main() {
        float dist = length(vWorldPos.xz);
        float fade = 1.0 - smoothstep(fadeDistance * 0.3, fadeDistance, dist);
        if (fade < 0.01) discard;

        float lineWidth = 0.02;
        float mainLine = max(
          gridLine(vWorldPos.x, gridSpacing, lineWidth),
          gridLine(vWorldPos.z, gridSpacing, lineWidth)
        );
        float subLine = max(
          gridLine(vWorldPos.x, subGridSpacing, lineWidth * 0.5),
          gridLine(vWorldPos.z, subGridSpacing, lineWidth * 0.5)
        );

        float alpha = max(mainLine * 0.4, subLine * 0.15) * fade;
        if (alpha < 0.01) discard;

        vec3 color = mainLine > 0.01 ? gridColor : subGridColor;
        gl_FragColor = vec4(color, alpha);
      }
    `;

    const gridMaterial = new THREE.ShaderMaterial({
      vertexShader: gridVertexShader,
      fragmentShader: gridFragmentShader,
      uniforms: {
        gridSpacing: { value: 1.0 },
        subGridSpacing: { value: 0.1 },
        gridColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        subGridColor: { value: new THREE.Vector3(0.7, 0.7, 0.7) },
        fadeDistance: { value: 50.0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const gridGeometry = new THREE.PlaneGeometry(1000, 1000);
    gridGeometry.rotateX(-Math.PI / 2); // Lay flat on XZ plane
    this._grid = new THREE.Mesh(gridGeometry, gridMaterial) as any;
    this._grid.renderOrder = -1;
    (this._grid as any).raycast = () => {}; // Non-raycastable
    this._overlayScene.add(this._grid);
  }

  private _setupAxes(): void {
    this._axes = new THREE.AxesHelper(50);
    // classic CAD color language: blue = vertical. DraftDown is Y-up, so
    // X = red, Y = blue, Z = green (AxesHelper default is X/Y/Z = R/G/B).
    this._axes.setColors(
      new THREE.Color(0xdd2222), // X — red
      new THREE.Color(0x2255ee), // Y — blue (vertical)
      new THREE.Color(0x22aa33), // Z — green
    );
    this._axes.renderOrder = 0;
    this._overlayScene.add(this._axes);
  }

  private _clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    }
  }

  private _addOutlineClone(
    source: THREE.Object3D,
    parent: THREE.Group,
    material: THREE.ShaderMaterial,
  ): void {
    source.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const clone = new THREE.Mesh(child.geometry, material);
        clone.position.copy(child.position);
        clone.rotation.copy(child.rotation);
        clone.scale.copy(child.scale);
        child.updateWorldMatrix(true, false);
        clone.applyMatrix4(child.matrixWorld);
        parent.add(clone);
      }
    });
  }

  private _restoreOriginalMaterials(): void {
    this._originalMaterials.forEach((mat, uuid) => {
      const obj = this._scene.getObjectByProperty('uuid', uuid);
      if (obj && obj instanceof THREE.Mesh) {
        obj.material = mat;
      }
    });
    this._originalMaterials.clear();
  }

  private _applyRenderMode(): void {
    this._scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;

      // Store original material
      if (!this._originalMaterials.has(obj.uuid)) {
        this._originalMaterials.set(obj.uuid, obj.material);
      }

      switch (this._renderMode) {
        case 'wireframe':
          obj.material = new THREE.MeshBasicMaterial({
            color: 0x333333,
            wireframe: true,
          });
          break;

        case 'hiddenLine': {
          // Solid white fill + wireframe overlay
          const fillMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          const wireMat = new THREE.MeshBasicMaterial({
            color: 0x333333,
            wireframe: true,
          });
          obj.material = [fillMat, wireMat];
          break;
        }

        case 'shaded':
          // Restore originals (already handled by _restoreOriginalMaterials)
          // If no original, use default standard material
          if (!this._originalMaterials.has(obj.uuid)) {
            obj.material = new THREE.MeshStandardMaterial({
              color: 0xd9d9d9,
              roughness: 0.7,
              metalness: 0.0,
              side: THREE.DoubleSide,
            });
          }
          break;

        case 'textured':
          // Keep original materials (with textures) or use standard
          if (!this._originalMaterials.has(obj.uuid)) {
            obj.material = new THREE.MeshStandardMaterial({
              color: 0xd9d9d9,
              roughness: 0.7,
              metalness: 0.0,
              side: THREE.DoubleSide,
            });
          }
          break;

        case 'xray':
          obj.material = createXRayMaterial();
          break;
      }
    });
  }
}
