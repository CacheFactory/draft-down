// @archigraph renderer.scene-bridge
// Synchronizes the geometry engine's B-Rep data with Three.js scene objects.

import * as THREE from 'three';
import { SpatialGrid } from '../engine.geometry/SpatialGrid';
import { Earcut } from 'three/src/extras/Earcut.js';
import type { IGeometryEngine, IFace, IEdge, ISceneManager, IMaterialManager } from '../../src/core/interfaces';
import { getSnapSettings, snapPointToGrid } from '../../src/core/snap-settings';
import type { WebGLRenderer } from './WebGLRenderer';
import type { SceneManager } from '../data.scene/SceneManager';

const _fadeTint = new THREE.Color(0.85, 0.85, 0.85);
const _selTint = new THREE.Color(0.24, 0.47, 1.0);

export class SceneBridge {
  private engine: IGeometryEngine;
  private sceneManager: SceneManager | null = null;
  private materialManager: IMaterialManager | null = null;
  private webglRenderer: WebGLRenderer;
  private scene: THREE.Scene;
  private overlayScene: THREE.Scene;

  // Maps geometry IDs to their Three.js parent objects (groups or lines)
  private faceGroups = new Map<string, THREE.Group>();
  private edgeLines = new Map<string, THREE.Line>();

  // Instanced cylinder tubes laid over each edge for visible thickness
  // (WebGL on macOS caps LineBasicMaterial.linewidth at 1px). One InstancedMesh
  // shared across all edges; slots are recycled when edges are removed.
  private edgeTubeMesh: THREE.InstancedMesh | null = null;
  private edgeTubeSlot = new Map<string, number>();
  private edgeTubeFreeSlots: number[] = [];
  private edgeTubeNextSlot = 0;
  private edgeTubeCapacity = 0;
  private static readonly EDGE_TUBE_RADIUS = 0.004;
  private static readonly EDGE_TUBE_INITIAL_CAPACITY = 4096;
  // Desired screen-pixel RADIUS of edge tubes (diameter is double this).
  // 0.6 ≈ 1.2px-wide edges — the classic modeler's thin-line look; 1.5 read as ~3px chunky.
  private static readonly EDGE_TUBE_TARGET_PX = 0.6;
  private _edgeTubeRadiusUniform: { value: number } = { value: 1.0 };
  private _edgeTubeTmpVec = new THREE.Vector3();
  private _edgeTubeTmpSize = new THREE.Vector2();
  // Scratch objects to avoid allocations in the per-edge update path.
  private _tubeUpVec = new THREE.Vector3(0, 0, 1);
  private _tubeDir = new THREE.Vector3();
  private _tubeMid = new THREE.Vector3();
  private _tubeQuat = new THREE.Quaternion();
  private _tubeScale = new THREE.Vector3();
  private _tubeMatrix = new THREE.Matrix4();

  // Materials
  private faceMaterial: THREE.MeshStandardMaterial;
  private hiddenEdgeMaterial: THREE.LineDashedMaterial;
  private backFaceMaterial: THREE.MeshStandardMaterial;
  private edgeMaterial: THREE.LineBasicMaterial;

  // Preview overlays
  private previewGroup: THREE.Group;
  private previewMaterial: THREE.LineDashedMaterial;

  // Texture cache (data URL -> THREE.Texture)
  private textureCache = new Map<string, THREE.Texture>();

  // Snap cursor marker
  private snapMarker: THREE.Group;
  private snapMarkerRing: THREE.Mesh;
  private snapMarkerDot: THREE.Mesh;
  private snapActive = false;
  private faceSnapMarker!: THREE.Group;
  /** Sticky hard-snap memory: holds the acquired snap while the cursor stays
   *  within 1.5× the snap radius (hysteresis against flicker). */
  private _stickySnap: { point: { x: number; y: number; z: number }; type: 'origin' | 'vertex' | 'midpoint' | 'intersection' | 'center' } | null = null;
  /** Last snap kind for callers that want to discriminate (origin/vertex/midpoint/center/edge/face/cursor). */
  private _lastSnapKind: 'origin' | 'vertex' | 'midpoint' | 'intersection' | 'center' | 'edge' | 'face' | 'cursor' | null = null;

  // Dirty tracking: vertex position hashes for edges, generation counter for faces
  private lastVertexPositions = new Map<string, string>();
  private lastFaceGeneration = new Map<string, number>();

  // Earcut triangulation cache: reuse tri indices when face topology unchanged
  private _faceTriCache = new Map<string, { generation: number; triIndices: number[]; vertCount: number }>();

  // Dirty vertex tracking: when set is populated, skip O(V) hash-based dirty detection
  private _dirtyVertexIds: Set<string> | null = null;
  // Vertex→face/edge adjacency for targeted iteration
  private _dirtyFaceIds: Set<string> | null = null;
  private _dirtyEdgeIds: Set<string> | null = null;

  // Batched mode: large model imported as single merged mesh.
  // sync() will only process NEW geometry added after the batch.
  private _batchedMode = false;
  private _batchedFaceIds = new Set<string>();
  private _batchedEdgeIds = new Set<string>();
  // GPU picking for batched faces: pick mesh + ID-to-face mapping
  private _batchedPickMesh: THREE.Mesh | null = null;
  private _batchedPickIdToFace = new Map<number, string>();
  // Face ID → triangle vertex range in the batched position buffer (for highlighting)
  private _batchedFaceTriRange = new Map<string, { start: number; count: number }>();
  private _batchedPositionBuffer: Float32Array | null = null;
  // Active (non-batched) faces — extracted from batch or newly created.
  // sync() only iterates these, never the full face map.
  private _activeFaceIds = new Set<string>();
  // Active (non-batched) edges — extracted from batch or newly created.
  private _activeEdgeIds = new Set<string>();
  // Temporary highlight overlay for batched face selection
  private _batchHighlight: THREE.Mesh | null = null;

  /**
   * classic CAD two-tone faces: back sides render in the classic blue-gray so
   * inverted faces are instantly visible. Injected via gl_FrontFacing so a
   * single DoubleSide mesh per face keeps working (no extra draw calls).
   * Painted faces disable the tint (userData.painted set by applyMaterialDef).
   */
  static installFrontBackShader(mat: THREE.MeshStandardMaterial): void {
    mat.customProgramCacheKey = () => `frontback-${mat.userData.painted ? 1 : 0}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBackColor = { value: new THREE.Color(0x9fb8ce) };
      shader.uniforms.uUseBackColor = { value: mat.userData.painted ? 0.0 : 1.0 };
      mat.userData.shaderRef = shader;
      shader.fragmentShader =
        'uniform vec3 uBackColor;\nuniform float uUseBackColor;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n  if (uUseBackColor > 0.5 && !gl_FrontFacing) diffuseColor.rgb = uBackColor;',
        );
    };
  }

  /** View > Hidden Geometry: show soft/hidden edges dashed instead of
   *  omitting them. */
  showHiddenGeometry = false;

  /** Snap-detection spatial index for large models. */
  private snapGrid = new SpatialGrid();
  private static readonly SNAP_GRID_THRESHOLD = 2000;

  /** classic-CAD-style profile edges: edges bordering fewer than two faces
   *  (outlines, silhouettes of open geometry) render thicker. */
  profileEdgesEnabled = true;
  private static readonly PROFILE_EDGE_SCALE = 2.2;

  constructor(engine: IGeometryEngine, webglRenderer: WebGLRenderer) {
    this.engine = engine;
    this.webglRenderer = webglRenderer;
    this.scene = webglRenderer.getScene();
    this.overlayScene = webglRenderer.getOverlayScene();

    this.faceMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4f4f4, // classic CAD default front: near-white
      roughness: 0.7,
      metalness: 0.0,
      side: THREE.DoubleSide,
      flatShading: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    SceneBridge.installFrontBackShader(this.faceMaterial);

    // Back-face material no longer used — DoubleSide on faceMaterial handles both sides.
    // Kept for API compatibility but not added to scene.
    this.backFaceMaterial = new THREE.MeshStandardMaterial({
      color: 0x8888cc,
      roughness: 0.7,
      metalness: 0.0,
      side: THREE.BackSide,
    });

    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x111111,
      linewidth: 1,
    });

    this.hiddenEdgeMaterial = new THREE.LineDashedMaterial({
      color: 0x888888,
      dashSize: 0.08,
      gapSize: 0.06,
      linewidth: 1,
    });

    // Build the shared edge-tube InstancedMesh. Unit cylinder oriented along
    // +Z so a per-edge scale of (r, r, length) plus a quaternion-to-direction
    // gives a tube from start to end. The material has a `radiusScale` uniform
    // that the camera scales each frame to keep the tube ~1.5 screen pixels —
    // without that, world-space tubes go sub-pixel and disappear when zooming
    // out.
    const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
    tubeGeo.rotateX(Math.PI / 2); // length along +Z
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    this._edgeTubeRadiusUniform = { value: 1.0 };
    const uniformRef = this._edgeTubeRadiusUniform;
    tubeMat.onBeforeCompile = (shader) => {
      shader.uniforms.radiusScale = uniformRef;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float radiusScale;`)
        .replace(
          '#include <begin_vertex>',
          'vec3 transformed = vec3(position.x * radiusScale, position.y * radiusScale, position.z);',
        );
    };
    this.edgeTubeCapacity = SceneBridge.EDGE_TUBE_INITIAL_CAPACITY;
    this.edgeTubeMesh = new THREE.InstancedMesh(tubeGeo, tubeMat, this.edgeTubeCapacity);
    this.edgeTubeMesh.name = 'edge-tubes';
    this.edgeTubeMesh.frustumCulled = false;
    this.edgeTubeMesh.count = 0; // grow as edges are added
    // Tubes are non-raycastable — picking + selection still use the underlying
    // THREE.Line entries in edgeLines.
    this.edgeTubeMesh.raycast = () => { /* noop */ };
    this.edgeTubeMesh.onBeforeRender = (renderer, _scene, camera) => {
      this.updateEdgeTubeRadiusUniform(renderer, camera);
    };
    this.scene.add(this.edgeTubeMesh);

    this.previewMaterial = new THREE.LineDashedMaterial({
      color: 0x0066ff,
      linewidth: 2,
      dashSize: 0.3,
      gapSize: 0.15,
    });

    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'preview';
    this.previewGroup.renderOrder = 999;
    // Put preview on layer 1 so raycaster (layer 0 only) ignores it
    this.setNonRaycastable(this.previewGroup);
    this.scene.add(this.previewGroup);

    // Create snap cursor marker — a green ring + dot that appears at snap points
    this.snapMarker = new THREE.Group();
    this.snapMarker.name = 'snap-marker';
    this.snapMarker.visible = false;
    this.snapMarker.renderOrder = 1000;

    // Green dot at center
    const dotGeo = new THREE.SphereGeometry(0.1, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x00cc44, depthTest: false });
    this.snapMarkerDot = new THREE.Mesh(dotGeo, dotMat);
    this.snapMarker.add(this.snapMarkerDot);

    // Green ring around dot
    const ringGeo = new THREE.RingGeometry(0.18, 0.24, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00cc44, side: THREE.DoubleSide, depthTest: false });
    this.snapMarkerRing = new THREE.Mesh(ringGeo, ringMat);
    this.snapMarker.add(this.snapMarkerRing);

    // Snap marker is non-raycastable
    this.setNonRaycastable(this.snapMarker);
    this.scene.add(this.snapMarker);

    // Face-snap marker — a flat square outline that lies ON the hovered face,
    // oriented to its normal. Distinct from the camera-facing point/edge ring.
    this.faceSnapMarker = new THREE.Group();
    this.faceSnapMarker.name = 'face-snap-marker';
    this.faceSnapMarker.visible = false;
    this.faceSnapMarker.renderOrder = 1000;
    // Outline (line loop forming a square)
    const sq = 0.18;
    const fOutlineGeo = new THREE.BufferGeometry();
    fOutlineGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -sq, -sq, 0,   sq, -sq, 0,
       sq, -sq, 0,   sq,  sq, 0,
       sq,  sq, 0,  -sq,  sq, 0,
      -sq,  sq, 0,  -sq, -sq, 0,
    ], 3));
    const fOutlineMat = new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: false });
    const fOutline = new THREE.LineSegments(fOutlineGeo, fOutlineMat);
    this.faceSnapMarker.add(fOutline);
    // Diagonal cross inside the square
    const fCrossGeo = new THREE.BufferGeometry();
    fCrossGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -sq * 0.7, -sq * 0.7, 0,   sq * 0.7,  sq * 0.7, 0,
      -sq * 0.7,  sq * 0.7, 0,   sq * 0.7, -sq * 0.7, 0,
    ], 3));
    const fCrossMat = new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: false, transparent: true, opacity: 0.7 });
    const fCross = new THREE.LineSegments(fCrossGeo, fCrossMat);
    this.faceSnapMarker.add(fCross);
    this.setNonRaycastable(this.faceSnapMarker);
    this.scene.add(this.faceSnapMarker);
  }

  setSceneManager(sm: SceneManager): void {
    this.sceneManager = sm;
  }

  setMaterialManager(mm: IMaterialManager): void {
    this.materialManager = mm;
  }

  /**
   * Mark specific vertex IDs as dirty. When set, sync() uses adjacency
   * to iterate only affected faces/edges instead of all geometry.
   */
  markVerticesDirty(ids: Iterable<string>): void {
    if (!this._dirtyVertexIds) this._dirtyVertexIds = new Set();
    for (const id of ids) this._dirtyVertexIds.add(id);
  }

  /**
   * Resolve dirty vertices → dirty faces + dirty edges using the mesh's
   * vertex-to-half-edge adjacency. Falls back to full iteration if adjacency
   * is unavailable (bulk-imported meshes skip half-edge topology).
   */
  private resolveDirtyAdjacency(mesh: any): { dirtyFaceIds: Set<string>; dirtyEdgeIds: Set<string> } | null {
    if (!this._dirtyVertexIds || this._dirtyVertexIds.size === 0) return null;

    const dirtyFaceIds = new Set<string>();
    const dirtyEdgeIds = new Set<string>();

    // Use engine's getVertexFaces/getVertexEdgeIds if available
    const engine = this.engine as any;
    if (typeof engine.getVertexFaces === 'function' && typeof engine.getVertexEdgeIds === 'function') {
      for (const vid of this._dirtyVertexIds) {
        const faces: string[] = engine.getVertexFaces(vid);
        for (const fid of faces) dirtyFaceIds.add(fid);
        const edges: string[] = engine.getVertexEdgeIds(vid);
        for (const eid of edges) dirtyEdgeIds.add(eid);
      }
      return { dirtyFaceIds, dirtyEdgeIds };
    }

    // Fallback: scan all faces/edges for vertex membership
    for (const [faceId, face] of mesh.faces) {
      for (const vid of face.vertexIds) {
        if (this._dirtyVertexIds.has(vid)) {
          dirtyFaceIds.add(faceId);
          break;
        }
      }
    }
    for (const [edgeId, edge] of mesh.edges) {
      if (this._dirtyVertexIds.has(edge.startVertexId) || this._dirtyVertexIds.has(edge.endVertexId)) {
        dirtyEdgeIds.add(edgeId);
      }
    }
    return { dirtyFaceIds, dirtyEdgeIds };
  }

  private getTexture(dataUrl: string): THREE.Texture {
    let tex = this.textureCache.get(dataUrl);
    if (tex) return tex;
    tex = new THREE.TextureLoader().load(dataUrl);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textureCache.set(dataUrl, tex);
    return tex;
  }

  private applyMaterialDef(mat: THREE.MeshStandardMaterial, matDef: { color: { r: number; g: number; b: number }; opacity?: number; roughness?: number; metalness?: number; albedoMap?: string }): void {
    // A painted face shows its material on both sides (classic CAD shows the
    // back tint only on unpainted faces).
    if (!mat.userData.painted) {
      mat.userData.painted = true;
      const shaderRef = mat.userData.shaderRef;
      if (shaderRef?.uniforms?.uUseBackColor) shaderRef.uniforms.uUseBackColor.value = 0.0;
      else mat.needsUpdate = true;
    }
    mat.opacity = matDef.opacity ?? 1;
    mat.transparent = mat.opacity < 1;
    mat.roughness = matDef.roughness ?? 0.7;
    mat.metalness = matDef.metalness ?? 0;
    if (matDef.albedoMap) {
      // When using a texture map, set color to white so Three.js doesn't
      // multiply/darken the texture by the material color.
      mat.color.setRGB(1, 1, 1);
      mat.map = this.getTexture(matDef.albedoMap);
      mat.needsUpdate = true;
    } else {
      mat.color.setRGB(matDef.color.r, matDef.color.g, matDef.color.b);
      if (mat.map) {
        mat.map = null;
        mat.needsUpdate = true;
      }
    }
  }

  /**
   * Batched sync for large imports: merges ALL faces into a single BufferGeometry
   * and ALL edges into a single LineSegments, avoiding per-face overhead.
   * Returns the number of faces synced.
   */
  syncBatched(): number {
    this._batchedMode = true;
    this._batchedFaceIds.clear();
    this._batchedEdgeIds.clear();
    const mesh = this.engine.getMesh();

    // Record all current face/edge IDs as batched (sync() will skip these)
    mesh.faces.forEach((_, id) => this._batchedFaceIds.add(id));
    mesh.edges.forEach((_, id) => this._batchedEdgeIds.add(id));
    const faceCount = mesh.faces.size;
    const edgeCount = mesh.edges.size;

    console.log(`[syncBatched] Starting: ${faceCount} faces, ${edgeCount} edges`);

    // Remove any existing individual face/edge objects first
    for (const [id, group] of this.faceGroups) {
      this.scene.remove(group);
      group.traverse(child => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      this.webglRenderer.unregisterEntityObject(id);
    }
    this.faceGroups.clear();

    for (const [id, line] of this.edgeLines) {
      this.scene.remove(line);
      line.geometry.dispose();
      this.webglRenderer.unregisterEntityObject(id);
    }
    this.edgeLines.clear();

    // Remove previous batched mesh if any
    const oldBatch = this.scene.getObjectByName('batched-faces');
    if (oldBatch) {
      this.scene.remove(oldBatch);
      oldBatch.traverse(child => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }
    const oldEdgeBatch = this.scene.getObjectByName('batched-edges');
    if (oldEdgeBatch) {
      this.scene.remove(oldEdgeBatch);
      if (oldEdgeBatch instanceof THREE.LineSegments) oldEdgeBatch.geometry.dispose();
    }

    // --- Batch all faces into one merged BufferGeometry ---
    // First pass: earcut each face to get accurate triangle count
    interface FaceTriDatum {
      indices: number[];
      verts: Array<{ position: { x: number; y: number; z: number } }>;
      normal: { x: number; y: number; z: number };
      id: string;
      storedUVs: Array<{ u: number; v: number }> | undefined;
      matId: string;
      // UV projection axes for procedural fallback
      ux: number; uy: number; uz: number;
      vx: number; vy: number; vz: number;
      p0: { x: number; y: number; z: number };
    }
    const faceTriData: FaceTriDatum[] = [];
    let totalTriangles = 0;

    mesh.faces.forEach((face, id) => {
      const verts = this.engine.getFaceVertices(id);
      if (verts.length < 3) return;

      const n = face.normal;
      // Project to 2D for earcut
      const p0 = verts[0].position;
      const p1 = verts[1].position;
      let eux = p1.x - p0.x, euy = p1.y - p0.y, euz = p1.z - p0.z;
      const euLen = Math.sqrt(eux * eux + euy * euy + euz * euz) || 1;
      eux /= euLen; euy /= euLen; euz /= euLen;
      let evx = n.y * euz - n.z * euy, evy = n.z * eux - n.x * euz, evz = n.x * euy - n.y * eux;
      const evLen = Math.sqrt(evx * evx + evy * evy + evz * evz) || 1;
      evx /= evLen; evy /= evLen; evz /= evLen;

      const flat2d: number[] = [];
      for (const v of verts) {
        const dx = v.position.x - p0.x, dy = v.position.y - p0.y, dz = v.position.z - p0.z;
        flat2d.push(dx * eux + dy * euy + dz * euz, dx * evx + dy * evy + dz * evz);
      }
      const holeIndices = face.holeStartIndices && face.holeStartIndices.length > 0
        ? face.holeStartIndices : undefined;
      let indices = Earcut.triangulate(flat2d, holeIndices, 2);
      if (indices.length === 0) {
        indices = [];
        for (let i = 1; i < verts.length - 1; i++) indices.push(0, i, i + 1);
      }
      totalTriangles += indices.length / 3;

      const matDef = this.materialManager?.getFaceMaterial(id);
      const matId = matDef?.id || '__default__';
      const storedUVs = (face.uvs && face.uvs.length === verts.length) ? face.uvs : undefined;

      faceTriData.push({ indices, verts, normal: n, id, storedUVs, matId, ux: eux, uy: euy, uz: euz, vx: evx, vy: evy, vz: evz, p0 });
    });

    // Sort faces by material so we can create material groups
    const matIdOrder = new Map<string, number>();
    for (const d of faceTriData) {
      if (!matIdOrder.has(d.matId)) matIdOrder.set(d.matId, matIdOrder.size);
    }
    faceTriData.sort((a, b) => (matIdOrder.get(a.matId)! - matIdOrder.get(b.matId)!));

    const posArr = new Float32Array(totalTriangles * 3 * 3);
    const normArr = new Float32Array(totalTriangles * 3 * 3);
    const uvArr = new Float32Array(totalTriangles * 3 * 2);
    const pickColorArr = new Float32Array(totalTriangles * 3 * 3); // RGB pick colors per vertex
    let triOffset = 0;
    this._batchedPickIdToFace.clear();
    this._batchedFaceTriRange.clear();
    let pickId = 1; // 0 = background/no entity

    // Track material groups: { matId, startVertex, vertexCount }
    const matGroups: Array<{ matId: string; start: number; count: number }> = [];
    let currentMatId = '';
    let groupStart = 0;

    for (const datum of faceTriData) {
      const { indices, verts, normal: n, id, storedUVs, matId } = datum;

      // Track material group boundaries
      if (matId !== currentMatId) {
        if (currentMatId && triOffset > groupStart) {
          matGroups.push({ matId: currentMatId, start: groupStart, count: triOffset - groupStart });
        }
        currentMatId = matId;
        groupStart = triOffset;
      }

      // Encode this face's pick ID as RGB
      const pr = ((pickId >> 16) & 0xff) / 255;
      const pg = ((pickId >> 8) & 0xff) / 255;
      const pb = (pickId & 0xff) / 255;
      this._batchedPickIdToFace.set(pickId, id);
      pickId++;

      // Record triangle range for this face (vertex offset, vertex count)
      const faceVertStart = triOffset;
      const faceVertCount = indices.length;
      this._batchedFaceTriRange.set(id, { start: faceVertStart, count: faceVertCount });

      for (let i = 0; i < indices.length; i++) {
        const vi = indices[i];
        const v = verts[vi];
        const base3 = triOffset * 3;
        const base2 = triOffset * 2;
        posArr[base3] = v.position.x;
        posArr[base3 + 1] = v.position.y;
        posArr[base3 + 2] = v.position.z;
        normArr[base3] = n.x;
        normArr[base3 + 1] = n.y;
        normArr[base3 + 2] = n.z;
        pickColorArr[base3] = pr;
        pickColorArr[base3 + 1] = pg;
        pickColorArr[base3 + 2] = pb;

        if (storedUVs) {
          const uv = storedUVs[vi];
          uvArr[base2] = uv.u;
          uvArr[base2 + 1] = uv.v;
        } else {
          const dx = v.position.x - datum.p0.x;
          const dy = v.position.y - datum.p0.y;
          const dz = v.position.z - datum.p0.z;
          uvArr[base2] = dx * datum.ux + dy * datum.uy + dz * datum.uz;
          uvArr[base2 + 1] = dx * datum.vx + dy * datum.vy + dz * datum.vz;
        }

        triOffset++;
      }

      // Auto-assign to active layer
      if (this.sceneManager && !this.sceneManager.geometryLayerMap.has(id)) {
        this.sceneManager.geometryLayerMap.set(id, this.sceneManager.activeLayerId);
      }
    }
    // Close final material group
    if (currentMatId && triOffset > groupStart) {
      matGroups.push({ matId: currentMatId, start: groupStart, count: triOffset - groupStart });
    }

    console.log(`[syncBatched] Built ${totalTriangles} triangles, ${matGroups.length} material groups`);

    this._batchedPositionBuffer = posArr;

    const batchGeo = new THREE.BufferGeometry();
    batchGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    batchGeo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
    batchGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));

    // Add material groups if multiple materials
    const batchMaterials: THREE.MeshStandardMaterial[] = [];
    if (matGroups.length > 1) {
      for (let gi = 0; gi < matGroups.length; gi++) {
        const g = matGroups[gi];
        batchGeo.addGroup(g.start, g.count, gi);
        const mat = this.faceMaterial.clone();
        const matDef = this.materialManager?.getMaterial(g.matId);
        if (matDef) this.applyMaterialDef(mat, matDef);
        batchMaterials.push(mat);
      }
    } else {
      const mat = this.faceMaterial.clone();
      if (matGroups.length === 1) {
        const matDef = this.materialManager?.getMaterial(matGroups[0].matId);
        if (matDef) this.applyMaterialDef(mat, matDef);
      }
      batchMaterials.push(mat);
    }

    batchGeo.computeBoundingSphere();
    batchGeo.computeBoundingBox();

    console.log(`[syncBatched] Geometry buffer: ${posArr.length} floats, boundingSphere radius: ${batchGeo.boundingSphere?.radius.toFixed(1)}, bbox: ${JSON.stringify(batchGeo.boundingBox?.min)}-${JSON.stringify(batchGeo.boundingBox?.max)}`);

    const batchMesh = new THREE.Mesh(batchGeo, batchMaterials.length === 1 ? batchMaterials[0] : batchMaterials);
    batchMesh.name = 'batched-faces';
    batchMesh.castShadow = false;  // Shadows disabled for large batched meshes (doubles GPU work)
    batchMesh.receiveShadow = false;
    batchMesh.frustumCulled = false; // Large meshes can be incorrectly culled
    this.scene.add(batchMesh);

    // --- Build GPU pick mesh for batched faces (vertex colors encode face IDs) ---
    const pickGeo = new THREE.BufferGeometry();
    pickGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    pickGeo.setAttribute('color', new THREE.BufferAttribute(pickColorArr, 3));
    // Use a raw shader material to bypass Three.js color space conversions entirely
    const pickMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    pickMat.toneMapped = false;
    if (this._batchedPickMesh) {
      this._batchedPickMesh.geometry.dispose();
      (this._batchedPickMesh.material as THREE.Material).dispose();
    }
    this._batchedPickMesh = new THREE.Mesh(pickGeo, pickMat);
    this._batchedPickMesh.name = 'batched-pick';
    this._batchedPickMesh.frustumCulled = false;
    // Register with renderer so pick system knows about it
    this.webglRenderer.setBatchedPickMesh(this._batchedPickMesh, this._batchedPickIdToFace);
    this.webglRenderer.setBatchedFaceHighlightFn((faceId: string) => this.getBatchedFaceHighlightGeometry(faceId));

    console.log(`[syncBatched] GPU pick mesh built: ${this._batchedPickIdToFace.size} face IDs encoded`);

    // --- Batch edges into LineSegments (skip if too many — GPU can crash on huge draw calls) ---
    const MAX_BATCHED_EDGES = 200000; // ~400K vertices max in one draw call
    let edgeOffset = 0;

    if (edgeCount <= MAX_BATCHED_EDGES) {
      const edgePositions = new Float32Array(edgeCount * 2 * 3);

      mesh.edges.forEach((edge, id) => {
        const v1 = this.engine.getVertex(edge.startVertexId);
        const v2 = this.engine.getVertex(edge.endVertexId);
        if (!v1 || !v2) return;

        const base = edgeOffset * 3;
        edgePositions[base] = v1.position.x;
        edgePositions[base + 1] = v1.position.y;
        edgePositions[base + 2] = v1.position.z;
        edgePositions[base + 3] = v2.position.x;
        edgePositions[base + 4] = v2.position.y;
        edgePositions[base + 5] = v2.position.z;
        edgeOffset += 2;

        // Also write a tube instance for visible thickness. Skip for very
        // large meshes — the InstancedMesh draw call is fast, but slot
        // allocation + matrix writes for hundreds of thousands of edges is
        // wasteful; let the 1px batched lines handle those.
        if (edgeCount <= 50000) {
          this.updateEdgeTube(id, v1.position, v2.position);
        }

        if (this.sceneManager && !this.sceneManager.geometryLayerMap.has(id)) {
          this.sceneManager.geometryLayerMap.set(id, this.sceneManager.activeLayerId);
        }
      });

      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePositions.subarray(0, edgeOffset * 3), 3));
      const edgeBatch = new THREE.LineSegments(edgeGeo, this.edgeMaterial);
      edgeBatch.name = 'batched-edges';
      edgeBatch.frustumCulled = false;
      edgeBatch.raycast = () => {}; // Disable raycast on batched edges (too expensive)
      this.scene.add(edgeBatch);
    } else {
      console.log(`[syncBatched] Skipping ${edgeCount} edges (exceeds ${MAX_BATCHED_EDGES} limit — faces-only mode)`);
    }

    console.log(`[syncBatched] Done: ${totalTriangles} triangles, ${edgeOffset / 2} edges rendered`);
    return faceCount;
  }

  /** Create a temporary highlight mesh for a batched face (for selection/pre-selection). */
  getBatchedFaceHighlightGeometry(faceId: string): THREE.BufferGeometry | null {
    const range = this._batchedFaceTriRange.get(faceId);
    if (!range || !this._batchedPositionBuffer) return null;

    const { start, count } = range;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      positions[i] = this._batchedPositionBuffer[start * 3 + i];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /** Check if a face ID is part of the batched mesh. */
  isBatchedFace(faceId: string): boolean {
    return this._batchedFaceIds.has(faceId);
  }

  /** Check if an edge ID is part of the batched mesh. */
  isBatchedEdge(edgeId: string): boolean {
    return this._batchedEdgeIds.has(edgeId);
  }

  /** Check if batched mode is active. */
  get batchedMode(): boolean {
    return this._batchedMode;
  }

  /** Extract a face from the batch into a normal per-face mesh.
   *  NaN-masks the face's triangles in the batch buffer and creates a regular
   *  Three.js mesh so tools can interact with it normally.
   */
  extractFromBatch(faceId: string): void {
    if (!this._batchedFaceIds.has(faceId) || !this._batchedPositionBuffer) return;

    const batchMesh = this.scene.getObjectByName('batched-faces') as THREE.Mesh | undefined;
    if (!batchMesh) return;

    const range = this._batchedFaceTriRange.get(faceId);
    if (range) {
      // NaN-mask the face's triangles in the batch buffer
      const posBuffer = this._batchedPositionBuffer;
      const posAttr = batchMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const normAttr = batchMesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const uvAttr = batchMesh.geometry.getAttribute('uv') as THREE.BufferAttribute;

      for (let i = range.start * 3; i < (range.start + range.count) * 3; i++) {
        posBuffer[i] = NaN;
      }
      posAttr.needsUpdate = true;

      if (normAttr) {
        const normArr = normAttr.array as Float32Array;
        for (let i = range.start * 3; i < (range.start + range.count) * 3; i++) normArr[i] = NaN;
        normAttr.needsUpdate = true;
      }
      if (uvAttr) {
        const uvArr = uvAttr.array as Float32Array;
        for (let i = range.start * 2; i < (range.start + range.count) * 2; i++) uvArr[i] = 0;
        uvAttr.needsUpdate = true;
      }
    }

    // Remove from batch tracking
    this._batchedFaceIds.delete(faceId);
    this._batchedFaceTriRange.delete(faceId);

    // Create a normal per-face mesh
    const face = this.engine.getMesh().faces.get(faceId);
    if (face) {
      this.syncFace(faceId, face);
      this._activeFaceIds.add(faceId);
      this.lastFaceGeneration.set(faceId, face.generation);
    }
  }

  /** Extract an edge from the batch into a normal per-edge line.
   *  Removes it from batch tracking so sync() will manage it normally.
   */
  extractEdgeFromBatch(edgeId: string): void {
    if (!this._batchedEdgeIds.has(edgeId)) return;
    this._batchedEdgeIds.delete(edgeId);
    this._activeEdgeIds.add(edgeId);

    const edge = this.engine.getMesh().edges.get(edgeId);
    if (edge) {
      this.syncEdge(edgeId, edge);
    }
  }

  /** Get the Three.js scene (for exporters). */
  getScene(): THREE.Scene { return this.scene; }

  /** Full sync: rebuild Three.js scene from geometry engine state.
   *  @param force - If true, skip dirty tracking and rebuild everything (used after undo/redo).
   */
  sync(force?: boolean): void {
    const t0 = performance.now();
    const _ts: Record<string, number> = {};
    const _t = (label: string) => { _ts[label] = performance.now(); };
    const mesh = this.engine.getMesh();

    // Geometry is (potentially) changing — the GPU pick buffer must re-render
    // before the next pick. In-place vertex updates never re-register
    // entities, so without this, picking sees pre-edit geometry until the
    // camera moves.
    (this.webglRenderer as any).markPickBufferDirty?.();

    // In batched mode, only process NEW faces/edges (not part of original batch)
    if (!this._batchedMode) {
      // Remove any leftover batched geometry from a previous syncBatched() call
      const oldBatch = this.scene.getObjectByName('batched-faces');
      if (oldBatch) {
        this.scene.remove(oldBatch);
        oldBatch.traverse(child => {
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
      }
      const oldEdgeBatch = this.scene.getObjectByName('batched-edges');
      if (oldEdgeBatch) {
        this.scene.remove(oldEdgeBatch);
        if (oldEdgeBatch instanceof THREE.LineSegments) oldEdgeBatch.geometry.dispose();
      }
    }

    _t('batchDelete');
    // In batched mode, handle deleted/restored batched faces via buffer patching
    if (this._batchedMode && this._batchedPositionBuffer) {
      const batchMesh = this.scene.getObjectByName('batched-faces') as THREE.Mesh | undefined;
      if (batchMesh) {
        // Only scan for deleted batched faces when the mesh has fewer faces than expected.
        // Total expected = batched + active. If mesh.faces.size < that, some were deleted.
        const expectedFaces = this._batchedFaceIds.size + this._activeFaceIds.size;
        const missingCount = expectedFaces - mesh.faces.size;

        if (missingCount > 0 || force) {
          const posBuffer = this._batchedPositionBuffer;
          const posAttr = batchMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
          const normAttr = batchMesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
          const uvAttr = batchMesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
          let bufferDirty = false;

          // First check if deletions are from active faces (cheap — small set)
          const deletedActive: string[] = [];
          for (const id of this._activeFaceIds) {
            if (!mesh.faces.has(id)) deletedActive.push(id);
          }
          for (const id of deletedActive) this._activeFaceIds.delete(id);

          // Only scan batched faces if active deletions don't account for all missing
          const batchedMissing = missingCount - deletedActive.length;
          if (batchedMissing > 0 || force) {
            const deletedBatchedFaces: string[] = [];
            for (const id of this._batchedFaceIds) {
              if (!mesh.faces.has(id)) {
                deletedBatchedFaces.push(id);
                if (!force && deletedBatchedFaces.length >= batchedMissing) break;
              }
            }
            for (const id of deletedBatchedFaces) {
              const range = this._batchedFaceTriRange.get(id);
              if (range) {
                for (let i = range.start * 3; i < (range.start + range.count) * 3; i++) {
                  posBuffer[i] = NaN;
                }
                if (normAttr) {
                  const normArr = normAttr.array as Float32Array;
                  for (let i = range.start * 3; i < (range.start + range.count) * 3; i++) normArr[i] = NaN;
                  normAttr.needsUpdate = true;
                }
                if (uvAttr) {
                  const uvArr = uvAttr.array as Float32Array;
                  for (let i = range.start * 2; i < (range.start + range.count) * 2; i++) uvArr[i] = 0;
                  uvAttr.needsUpdate = true;
                }
                bufferDirty = true;
              }
              this._batchedFaceIds.delete(id);
              this._batchedFaceTriRange.delete(id);
            }

            if (bufferDirty) {
              posAttr.needsUpdate = true;
              console.log(`[sync] Removed ${deletedBatchedFaces.length} batched faces via NaN masking in ${(performance.now() - t0).toFixed(1)}ms`);
            }
          }
        }
      }

      // Fast path: if no active (extracted/new) faces exist and no individual meshes,
      // skip the iteration below entirely.
      // Skip fast path on force=true (undo/redo) since faces may have been restored.
      if (!force && this._activeFaceIds.size === 0 && this.faceGroups.size === 0 && this.edgeLines.size === 0) {
        this.syncComponentBoxes(mesh);
        console.log(`[SceneBridge.sync] ${(performance.now() - t0).toFixed(1)}ms (batched fast path), faces: ${mesh.faces.size}`);
        return;
      }
    }

    _t('newDetect');
    const liveFaceIds = new Set<string>();
    const liveEdgeIds = new Set<string>();

    // In batched mode, detect new/restored faces and edges not yet tracked
    if (this._batchedMode) {
      const totalFacesTracked = this._batchedFaceIds.size + this._activeFaceIds.size;
      if (force || mesh.faces.size > totalFacesTracked) {
        mesh.faces.forEach((_face, id) => {
          if (!this._batchedFaceIds.has(id) && !this._activeFaceIds.has(id)) {
            this._activeFaceIds.add(id);
          }
        });
      }
      const totalEdgesTracked = this._batchedEdgeIds.size + this._activeEdgeIds.size;
      if (force || mesh.edges.size > totalEdgesTracked) {
        mesh.edges.forEach((_edge, id) => {
          if (!this._batchedEdgeIds.has(id) && !this._activeEdgeIds.has(id)) {
            this._activeEdgeIds.add(id);
          }
        });
      }

      // Rebatch guard: when undo (force=true) restores many faces/edges that were
      // previously batched, those IDs aren't in `_batchedFaceIds` anymore (their
      // delete-time NaN-mask cleared the entry). Without this guard each restored
      // face would be rendered as an individual mesh — N draw calls = severe lag.
      // If active counts have ballooned past the rebatch threshold, do a full
      // syncBatched() rebuild so everything goes back into one merged geometry.
      const REBATCH_THRESHOLD = 200;
      if (force &&
          (this._activeFaceIds.size > REBATCH_THRESHOLD ||
           this._activeEdgeIds.size > REBATCH_THRESHOLD * 2)) {
        const dt = (performance.now() - t0).toFixed(1);
        console.log(`[SceneBridge.sync] Force=true with ${this._activeFaceIds.size} active faces / ${this._activeEdgeIds.size} active edges — rebatching to keep render fast (after ${dt}ms detect).`);
        // Reset active sets — syncBatched will repopulate _batchedFaceIds/_batchedEdgeIds
        // from the full mesh and dispose any individual face/edge objects.
        this._activeFaceIds.clear();
        this._activeEdgeIds.clear();
        this.syncBatched();
        this.syncComponentBoxes(mesh);
        console.log(`[SceneBridge.sync] ${(performance.now() - t0).toFixed(1)}ms (rebatched after force), faces: ${mesh.faces.size}`);
        return;
      }
    }

    // Determine which face IDs to iterate: in batched mode, only active faces;
    // otherwise all faces from the mesh.
    const allFaceIdsToSync = this._batchedMode
      ? this._activeFaceIds
      : new Set(mesh.faces.keys());

    // ── Dirty vertex fast path ──────────────────────────────────────
    // When dirty vertices are known (from tool calls) and not force-syncing,
    // resolve adjacency to iterate ONLY affected faces/edges.
    const dirtyAdj = (!force && this._dirtyVertexIds && this._dirtyVertexIds.size > 0)
      ? this.resolveDirtyAdjacency(mesh)
      : null;
    const hasDirtyTracking = dirtyAdj !== null;

    // Clear dirty vertices for next frame
    this._dirtyVertexIds = null;

    // If we have dirty tracking, narrow iteration to dirty faces/edges only
    const faceIdsToSync = hasDirtyTracking
      ? new Set([...dirtyAdj!.dirtyFaceIds].filter(id => allFaceIdsToSync.has(id)))
      : allFaceIdsToSync;
    const dirtyEdgeIds = hasDirtyTracking ? dirtyAdj!.dirtyEdgeIds : null;

    _t('vertexSnapshot');
    // Build vertex position snapshot for dirty detection (skip when force=true or dirty tracking active)
    const currentVertexPositions = new Map<string, string>();
    if (!force && !hasDirtyTracking) {
      const vertexIds = new Set<string>();
      for (const id of allFaceIdsToSync) {
        const face = mesh.faces.get(id);
        if (face) {
          for (const vid of face.vertexIds) vertexIds.add(vid);
        }
      }
      if (!this._batchedMode) {
        mesh.edges.forEach((edge) => {
          vertexIds.add(edge.startVertexId);
          vertexIds.add(edge.endVertexId);
        });
      } else {
        // Only check active (non-batched) edges — avoids O(all edges) scan
        for (const id of this._activeEdgeIds) {
          const edge = mesh.edges.get(id);
          if (edge) {
            vertexIds.add(edge.startVertexId);
            vertexIds.add(edge.endVertexId);
          }
        }
      }
      for (const vid of vertexIds) {
        const v = mesh.vertices.get(vid);
        if (v) currentVertexPositions.set(vid, `${v.position.x.toFixed(6)},${v.position.y.toFixed(6)},${v.position.z.toFixed(6)}`);
      }
    }

    _t('syncFaces');
    // Sync faces
    // When using dirty tracking, we sync ALL dirty faces unconditionally (skip per-vertex hash check)
    // and also mark all non-dirty faces as live (they haven't changed).
    if (hasDirtyTracking) {
      // All faces in allFaceIdsToSync are still live
      for (const id of allFaceIdsToSync) {
        if (mesh.faces.has(id)) liveFaceIds.add(id);
      }
      // Sync dirty faces — and ALSO any face whose generation has bumped without
      // its vertices moving (e.g., when cutHoleIfEnclosed appends hole vertexIds
      // to a host face). Without this catch the host face wouldn't re-triangulate
      // and the new shape would z-fight with it.
      const widenedDirty = new Set<string>(faceIdsToSync);
      for (const id of allFaceIdsToSync) {
        const face = mesh.faces.get(id);
        if (!face) continue;
        const lastGen = this.lastFaceGeneration.get(id);
        if (lastGen !== undefined && lastGen !== face.generation) widenedDirty.add(id);
      }
      for (const id of widenedDirty) {
        const face = mesh.faces.get(id);
        if (!face) continue;
        if (this.sceneManager && !this.sceneManager.geometryLayerMap.has(id)) {
          this.sceneManager.geometryLayerMap.set(id, this.sceneManager.activeLayerId);
        }
        this.syncFace(id, face);
        this.lastFaceGeneration.set(id, face.generation);
        const group = this.faceGroups.get(id);
        if (group) {
          group.visible = this.sceneManager ? this.sceneManager.isEntityVisible(id) : true;
        }
      }
    } else {
      for (const id of allFaceIdsToSync) {
        const face = mesh.faces.get(id);
        if (!face) continue;
        liveFaceIds.add(id);
        if (this.sceneManager && !this.sceneManager.geometryLayerMap.has(id)) {
          this.sceneManager.geometryLayerMap.set(id, this.sceneManager.activeLayerId);
        }
        const visible = this.sceneManager ? this.sceneManager.isEntityVisible(id) : true;

        if (!force) {
          const existing = this.faceGroups.get(id);
          if (existing) {
            const lastGen = this.lastFaceGeneration.get(id);
            const genClean = lastGen !== undefined && lastGen === face.generation;
            let posClean = true;
            if (genClean) {
              for (const vid of face.vertexIds) {
                if (currentVertexPositions.get(vid) !== this.lastVertexPositions.get(vid)) {
                  posClean = false;
                  break;
                }
              }
            }
            if (genClean && posClean) {
              existing.visible = visible;
              continue;
            }
          }
        }

        this.syncFace(id, face);
        this.lastFaceGeneration.set(id, face.generation);
        const group = this.faceGroups.get(id);
        if (group) group.visible = visible;
      }
    }

    _t('syncEdges');
    // Sync edges — in batched mode, only iterate active (non-batched) edges
    const edgeIterator = this._batchedMode
      ? this._activeEdgeIds
      : new Set(mesh.edges.keys());

    for (const id of edgeIterator) {
      const edge = mesh.edges.get(id);
      if (!edge) continue;
      liveEdgeIds.add(id);

      // Skip clean edges when dirty tracking is active
      if (hasDirtyTracking && dirtyEdgeIds && !dirtyEdgeIds.has(id)) continue;

      if (this.sceneManager && !this.sceneManager.geometryLayerMap.has(id)) {
        this.sceneManager.geometryLayerMap.set(id, this.sceneManager.activeLayerId);
      }
      const visible = this.sceneManager ? this.sceneManager.isEntityVisible(id) : true;

      if (!force && !hasDirtyTracking && this.edgeLines.has(id)) {
        const v1Hash = currentVertexPositions.get(edge.startVertexId);
        const v2Hash = currentVertexPositions.get(edge.endVertexId);
        if (v1Hash === this.lastVertexPositions.get(edge.startVertexId) &&
            v2Hash === this.lastVertexPositions.get(edge.endVertexId)) {
          const line = this.edgeLines.get(id)!;
          line.visible = visible;
          // Defensive: ensure the edge tube is present + at the correct slot.
          // If the tube's slot was released by a prior cleanup pass and the line
          // survived (rare race), this brings the tube back into sync.
          if (!this.edgeTubeSlot.has(id)) {
            const v1 = this.engine.getVertex(edge.startVertexId);
            const v2 = this.engine.getVertex(edge.endVertexId);
            if (v1 && v2) this.updateEdgeTube(id, v1.position, v2.position);
          }
          continue;
        }
      }

      this.syncEdge(id, edge);
      const line = this.edgeLines.get(id);
      if (line) line.visible = visible;
    }

    _t('cleanup');
    // Remove faces that no longer exist
    for (const [id, group] of this.faceGroups) {
      if (!liveFaceIds.has(id)) {
        this.scene.remove(group);
        group.traverse(child => {
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
        this.webglRenderer.unregisterEntityObject(id);
        this.faceGroups.delete(id);
        this._activeFaceIds.delete(id);
        this._faceTriCache.delete(id);
      }
    }

    // Remove edges that no longer exist
    for (const [id, line] of this.edgeLines) {
      if (!liveEdgeIds.has(id)) {
        this.scene.remove(line);
        line.geometry.dispose();
        this.webglRenderer.unregisterEntityObject(id);
        this.edgeLines.delete(id);
        this._activeEdgeIds.delete(id);
        this.releaseEdgeTube(id);
      }
    }

    // Update vertex position cache for next sync's dirty detection (skip when using dirty tracking)
    if (!hasDirtyTracking) {
      this.lastVertexPositions = currentVertexPositions;
    }

    _t('postSync');
    // Refresh edge highlight glow tube positions after vertex moves
    this.webglRenderer.refreshEdgeHighlightPositions();

    // Render component bounding boxes — pass dirty vertices for targeted updates
    this.syncComponentBoxes(mesh, hasDirtyTracking ? dirtyAdj!.dirtyFaceIds : undefined);
    // Dim entities outside the component being edited
    this.syncComponentDimming();
    _t('done');
    const syncedFaces = hasDirtyTracking ? faceIdsToSync.size : allFaceIdsToSync.size;
    const syncedEdges = hasDirtyTracking ? (dirtyEdgeIds?.size ?? 0) : edgeIterator.size;
    const keys = Object.keys(_ts);
    const sections = keys.map((k, i) => `${k}=${i > 0 ? (_ts[k] - _ts[keys[i-1]]).toFixed(1) : '0'}ms`).join(', ');
    console.log(`[SceneBridge.sync] ${(performance.now() - t0).toFixed(1)}ms | ${sections} | faces: ${syncedFaces}/${mesh.faces.size}, edges: ${syncedEdges}/${mesh.edges.size}, activeFaces: ${this._activeFaceIds.size}, activeEdges: ${this._activeEdgeIds.size}`);
  }

  private componentBoxes = new Map<string, THREE.LineSegments>();

  private syncComponentBoxes(mesh: any, dirtyFaceIds?: Set<string>): void {
    if (!this.sceneManager) return;

    const liveCompIds = new Set<string>();

    for (const [compId, comp] of this.sceneManager.components) {
      liveCompIds.add(compId);

      // When dirty tracking is active, skip components that have no dirty faces
      if (dirtyFaceIds) {
        let hasDirty = false;
        for (const eid of comp.entityIds) {
          if (dirtyFaceIds.has(eid)) { hasDirty = true; break; }
        }
        if (!hasDirty && this.componentBoxes.has(compId)) continue;
      }

      // Compute bounding box of all component vertices
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const seen = new Set<string>();

      for (const eid of comp.entityIds) {
        const face = mesh.faces.get(eid);
        if (face) {
          for (const vid of face.vertexIds) {
            if (seen.has(vid)) continue;
            seen.add(vid);
            const v = mesh.vertices.get(vid);
            if (!v) continue;
            minX = Math.min(minX, v.position.x); maxX = Math.max(maxX, v.position.x);
            minY = Math.min(minY, v.position.y); maxY = Math.max(maxY, v.position.y);
            minZ = Math.min(minZ, v.position.z); maxZ = Math.max(maxZ, v.position.z);
          }
        }
        const edge = mesh.edges.get(eid);
        if (edge) {
          for (const vid of [edge.startVertexId, edge.endVertexId]) {
            if (seen.has(vid)) continue;
            seen.add(vid);
            const v = mesh.vertices.get(vid);
            if (!v) continue;
            minX = Math.min(minX, v.position.x); maxX = Math.max(maxX, v.position.x);
            minY = Math.min(minY, v.position.y); maxY = Math.max(maxY, v.position.y);
            minZ = Math.min(minZ, v.position.z); maxZ = Math.max(maxZ, v.position.z);
          }
        }
      }

      if (!isFinite(minX)) continue;

      const pad = 0.05;
      minX -= pad; minY -= pad; minZ -= pad;
      maxX += pad; maxY += pad; maxZ += pad;

      const isEditing = this.sceneManager!.editingComponentId === compId;
      const boxColor = isEditing ? 0x2196f3 : 0x9c27b0;

      if (this.componentBoxes.has(compId)) {
        // Update existing box — reuse LineSegments, just update position and scale
        const existing = this.componentBoxes.get(compId)!;
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
        const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
        existing.position.set(cx, cy, cz);
        existing.scale.set(sx, sy, sz);
        (existing.material as THREE.LineBasicMaterial).color.setHex(boxColor);
      } else {
        // Create unit box geometry (1x1x1 centered at origin) — scale to fit
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const edges = new THREE.EdgesGeometry(boxGeo);
        boxGeo.dispose();
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
          color: boxColor, linewidth: 1, depthTest: false,
        }));
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
        const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
        line.position.set(cx, cy, cz);
        line.scale.set(sx, sy, sz);
        line.raycast = () => {};
        this.overlayScene.add(line);
        this.componentBoxes.set(compId, line);
      }
    }

    // Remove boxes for deleted components
    for (const [id, line] of this.componentBoxes) {
      if (!liveCompIds.has(id)) {
        this.overlayScene.remove(line);
        line.geometry.dispose();
        this.componentBoxes.delete(id);
      }
    }
  }

  private _lastDimmingCompId: string | null = '__init__';
  private _lastDimmingMemberCount = 0;

  /** When editing a component, dim faces/edges outside the component. */
  private syncComponentDimming(): void {
    if (!this.sceneManager) return;

    const editingId = this.sceneManager.editingComponentId;
    const comp = editingId ? this.sceneManager.components.get(editingId) : null;
    const memberIds = comp ? comp.entityIds : null;
    const memberCount = memberIds ? memberIds.size : 0;

    // Skip if dimming state hasn't changed (same component, same member count)
    if (editingId === this._lastDimmingCompId && memberCount === this._lastDimmingMemberCount) return;
    this._lastDimmingCompId = editingId;
    this._lastDimmingMemberCount = memberCount;

    if (editingId && memberIds) {
      // Fade non-member faces by tinting color toward white
      for (const [faceId, group] of this.faceGroups) {
        const isMember = memberIds.has(faceId);
        group.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (!isMember) {
              if (!(mat as any)._origColor) (mat as any)._origColor = mat.color.clone();
              mat.color.copy((mat as any)._origColor).lerp(_fadeTint, 0.8);
            } else if ((mat as any)._origColor) {
              mat.color.copy((mat as any)._origColor);
            }
          }
        });
      }
      // Fade non-member edges
      for (const [edgeId, line] of this.edgeLines) {
        const isMember = memberIds.has(edgeId);
        if (!isMember) {
          if (line.material === this.edgeMaterial) {
            line.material = this.edgeMaterial.clone();
          }
          (line.material as THREE.LineBasicMaterial).color.set(0xcccccc);
        } else {
          if (line.material !== this.edgeMaterial) {
            (line.material as THREE.Material).dispose();
            line.material = this.edgeMaterial;
          }
        }
      }
    } else {
      // Restore face colors
      for (const [, group] of this.faceGroups) {
        group.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if ((mat as any)._origColor) {
              mat.color.copy((mat as any)._origColor);
              delete (mat as any)._origColor;
            }
          }
        });
      }
      // Restore edge materials
      for (const [, line] of this.edgeLines) {
        if (line.material !== this.edgeMaterial) {
          (line.material as THREE.Material).dispose();
          line.material = this.edgeMaterial;
        }
      }
    }
  }

  /** Tint faces of a component with selection blue. Cheap: just adjusts material color. */
  private _tintedFaceIds = new Set<string>();

  tintComponentFaces(entityIds: Set<string>): void {
    this.clearComponentTint();
    for (const eid of entityIds) {
      const group = this.faceGroups.get(eid);
      if (!group) continue;
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          (mat as any)._preTintColor = mat.color.clone();
          mat.color.lerp(_selTint, 0.25);
        }
      });
      this._tintedFaceIds.add(eid);
    }
  }

  clearComponentTint(): void {
    for (const eid of this._tintedFaceIds) {
      const group = this.faceGroups.get(eid);
      if (!group) continue;
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if ((mat as any)._preTintColor) {
            mat.color.copy((mat as any)._preTintColor);
            delete (mat as any)._preTintColor;
          }
        }
      });
    }
    this._tintedFaceIds.clear();
  }

  private syncFace(id: string, face: IFace): void {
    const verts = this.engine.getFaceVertices(id);
    if (verts.length < 3) return;

    // Nudge vertex positions slightly along face normal to prevent z-fighting
    const n = face.normal;
    const nudge = this.faceNudge(id);
    const nx = n.x * nudge;
    const ny = n.y * nudge;
    const nz = n.z * nudge;

    // Use stored OBJ UVs when available, otherwise compute procedural UVs
    const hasStoredUVs = face.uvs && face.uvs.length === verts.length;

    // Compute UV basis for procedural UVs (or for earcut projection)
    const p0 = verts[0].position;
    const p1 = verts[1].position;
    let ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
    const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= uLen; uy /= uLen; uz /= uLen;
    let vx = n.y * uz - n.z * uy;
    let vy = n.z * ux - n.x * uz;
    let vz = n.x * uy - n.y * ux;
    const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    vx /= vLen; vy /= vLen; vz /= vLen;
    const uvScale = 1.0;

    // Check Earcut triangulation cache — reuse indices when topology unchanged
    // (move/scale/rotate don't change topology, only vertex positions)
    const cached = this._faceTriCache.get(id);
    let triIndices: number[];

    if (cached && cached.generation === face.generation && cached.vertCount === verts.length) {
      // Cache hit — reuse triangulation indices
      triIndices = cached.triIndices;
    } else {
      // Cache miss — triangulate and store
      const flat2d: number[] = [];
      for (const v of verts) {
        const dx = v.position.x - p0.x;
        const dy = v.position.y - p0.y;
        const dz = v.position.z - p0.z;
        flat2d.push(dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz);
      }
      const holeIndices = face.holeStartIndices && face.holeStartIndices.length > 0
        ? face.holeStartIndices : undefined;
      triIndices = Earcut.triangulate(flat2d, holeIndices, 2);

      if (triIndices.length === 0) {
        triIndices = [];
        for (let i = 1; i < verts.length - 1; i++) {
          triIndices.push(0, i, i + 1);
        }
      }

      this._faceTriCache.set(id, { generation: face.generation, triIndices, vertCount: verts.length });
    }

    // Try in-place buffer update when face mesh already exists and tri count matches
    const existingGroup = this.faceGroups.get(id);
    if (existingGroup) {
      let existingMesh: THREE.Mesh | null = null;
      existingGroup.traverse(child => {
        if (child instanceof THREE.Mesh && !existingMesh) existingMesh = child as THREE.Mesh;
      });

      if (existingMesh) {
        const geo = (existingMesh as THREE.Mesh).geometry;
        const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;

        if (posAttr && posAttr.count === triIndices.length) {
          // In-place update — write directly into existing Float32Arrays
          const posArr = posAttr.array as Float32Array;
          const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
          const normArr = normAttr.array as Float32Array;
          const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
          const uvArr = uvAttr.array as Float32Array;

          for (let i = 0; i < triIndices.length; i++) {
            const vi = triIndices[i];
            const v = verts[vi];
            const base3 = i * 3;
            const base2 = i * 2;
            posArr[base3] = v.position.x + nx;
            posArr[base3 + 1] = v.position.y + ny;
            posArr[base3 + 2] = v.position.z + nz;
            normArr[base3] = n.x;
            normArr[base3 + 1] = n.y;
            normArr[base3 + 2] = n.z;
            if (hasStoredUVs) {
              const uv = face.uvs![vi];
              uvArr[base2] = uv.u;
              uvArr[base2 + 1] = uv.v;
            } else {
              const dx = v.position.x - p0.x;
              const dy = v.position.y - p0.y;
              const dz = v.position.z - p0.z;
              uvArr[base2] = (dx * ux + dy * uy + dz * uz) * uvScale;
              uvArr[base2 + 1] = (dx * vx + dy * vy + dz * vz) * uvScale;
            }
          }

          posAttr.needsUpdate = true;
          normAttr.needsUpdate = true;
          uvAttr.needsUpdate = true;

          // Sync material if needed
          const matDef = this.materialManager?.getFaceMaterial(id);
          if (matDef) {
            const meshMat = (existingMesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
            const isHighlighted = meshMat.type === 'MeshBasicMaterial';
            if (isHighlighted) {
              const newMat = this.faceMaterial.clone();
              this.applyMaterialDef(newMat, matDef);
              this.webglRenderer.refreshHighlightOriginal(id, newMat);
            } else {
              this.applyMaterialDef(meshMat, matDef);
            }
          }
          return; // Done — no geometry allocation needed
        }
      }
    }

    // Full rebuild path — tri count changed or first creation
    const positions = new Float32Array(triIndices.length * 3);
    const normals = new Float32Array(triIndices.length * 3);
    const uvs = new Float32Array(triIndices.length * 2);

    for (let i = 0; i < triIndices.length; i++) {
      const vi = triIndices[i];
      const v = verts[vi];
      const base3 = i * 3;
      const base2 = i * 2;
      positions[base3] = v.position.x + nx;
      positions[base3 + 1] = v.position.y + ny;
      positions[base3 + 2] = v.position.z + nz;
      normals[base3] = n.x;
      normals[base3 + 1] = n.y;
      normals[base3 + 2] = n.z;
      if (hasStoredUVs) {
        const uv = face.uvs![vi];
        uvs[base2] = uv.u;
        uvs[base2 + 1] = uv.v;
      } else {
        const dx = v.position.x - p0.x;
        const dy = v.position.y - p0.y;
        const dz = v.position.z - p0.z;
        uvs[base2] = (dx * ux + dy * uy + dz * uz) * uvScale;
        uvs[base2 + 1] = (dx * vx + dy * vy + dz * vz) * uvScale;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const matDef = this.materialManager?.getFaceMaterial(id);

    if (existingGroup) {
      existingGroup.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          child.geometry = geometry;
          const meshMat = child.material as THREE.MeshStandardMaterial;
          if (matDef) {
            const isHighlighted = meshMat.type === 'MeshBasicMaterial';
            if (isHighlighted) {
              const newMat = this.faceMaterial.clone();
              this.applyMaterialDef(newMat, matDef);
              this.webglRenderer.refreshHighlightOriginal(id, newMat);
            } else {
              this.applyMaterialDef(meshMat, matDef);
            }
          }
        }
      });
    } else {
      const group = new THREE.Group();
      group.name = `face-${id}`;
      group.userData.entityId = id;
      group.userData.entityType = 'face';

      const meshMat = this.faceMaterial.clone();
      if (matDef) this.applyMaterialDef(meshMat, matDef);
      const mesh = new THREE.Mesh(geometry, meshMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.entityId = id;
      mesh.userData.entityType = 'face';

      group.add(mesh);

      this.scene.add(group);
      this.faceGroups.set(id, group);
      this.webglRenderer.registerEntityObject(id, mesh);
    }
  }

  private syncEdge(id: string, edge: IEdge): void {
    const v1 = this.engine.getVertex(edge.startVertexId);
    const v2 = this.engine.getVertex(edge.endVertexId);
    if (!v1 || !v2) return;

    // Soft/hidden edges are omitted (classic CAD), or shown dashed when
    // View > Hidden Geometry is on.
    const suppressed = !!(edge.soft || edge.hidden);
    const existing0 = this.edgeLines.get(id);
    if (suppressed) {
      if (existing0) {
        existing0.visible = this.showHiddenGeometry;
        if (this.showHiddenGeometry) {
          if (existing0.material !== this.hiddenEdgeMaterial) {
            existing0.material = this.hiddenEdgeMaterial;
            existing0.computeLineDistances();
          }
        }
      }
      this.releaseEdgeTube(id);
      if (!existing0 && this.showHiddenGeometry) {
        const pts = [
          new THREE.Vector3(v1.position.x, v1.position.y, v1.position.z),
          new THREE.Vector3(v2.position.x, v2.position.y, v2.position.z),
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geometry, this.hiddenEdgeMaterial);
        line.computeLineDistances();
        line.userData.entityId = id;
        line.userData.entityType = 'edge';
        this.scene.add(line);
        this.edgeLines.set(id, line);
      }
      return;
    }
    if (existing0 && existing0.material === this.hiddenEdgeMaterial) {
      // Un-softened/un-hidden: restore the solid material
      existing0.material = this.edgeMaterial;
      existing0.visible = true;
    }

    // Profile edges: outlines (bordering <2 faces) draw thicker, classic-CAD-style.
    const profileScale = this.profileEdgesEnabled &&
      this.engine.getEdgeFaces(id).length < 2
      ? SceneBridge.PROFILE_EDGE_SCALE : 1;

    const existing = this.edgeLines.get(id);
    if (existing) {
      // In-place buffer update — write directly into existing Float32Array
      const posAttr = existing.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (posAttr && posAttr.count === 2) {
        const arr = posAttr.array as Float32Array;
        arr[0] = v1.position.x; arr[1] = v1.position.y; arr[2] = v1.position.z;
        arr[3] = v2.position.x; arr[4] = v2.position.y; arr[5] = v2.position.z;
        posAttr.needsUpdate = true;
        this.updateEdgeTube(id, v1.position, v2.position, profileScale);
        return;
      }
      // Fallback: dispose and recreate if buffer layout changed
      existing.geometry.dispose();
      const points = [
        new THREE.Vector3(v1.position.x, v1.position.y, v1.position.z),
        new THREE.Vector3(v2.position.x, v2.position.y, v2.position.z),
      ];
      existing.geometry = new THREE.BufferGeometry().setFromPoints(points);
    } else {
      const points = [
        new THREE.Vector3(v1.position.x, v1.position.y, v1.position.z),
        new THREE.Vector3(v2.position.x, v2.position.y, v2.position.z),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, this.edgeMaterial);
      line.userData.entityId = id;
      line.userData.entityType = 'edge';
      this.scene.add(line);
      this.edgeLines.set(id, line);
      this.webglRenderer.registerEntityObject(id, line);
    }
    this.updateEdgeTube(id, v1.position, v2.position);
  }

  /** Allocate a tube slot for the edge if needed, then write its transform. */
  private updateEdgeTube(id: string, p1: { x: number; y: number; z: number }, p2: { x: number; y: number; z: number }, radiusScale = 1): void {
    if (!this.edgeTubeMesh) return;
    let slot = this.edgeTubeSlot.get(id);
    if (slot === undefined) {
      slot = this.edgeTubeFreeSlots.pop() ?? this.edgeTubeNextSlot++;
      if (slot >= this.edgeTubeCapacity) {
        this.growEdgeTubeCapacity(Math.max(slot + 1, this.edgeTubeCapacity * 2));
      }
      this.edgeTubeSlot.set(id, slot);
      if (this.edgeTubeMesh.count <= slot) this.edgeTubeMesh.count = slot + 1;
    }

    const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-8) {
      // Degenerate — collapse the instance so it's invisible.
      this._tubeMatrix.makeScale(0, 0, 0);
      this.edgeTubeMesh.setMatrixAt(slot, this._tubeMatrix);
      this.edgeTubeMesh.instanceMatrix.needsUpdate = true;
      return;
    }
    this._tubeMid.set((p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5, (p1.z + p2.z) * 0.5);
    this._tubeDir.set(dx / len, dy / len, dz / len);
    this._tubeQuat.setFromUnitVectors(this._tubeUpVec, this._tubeDir);
    const r = SceneBridge.EDGE_TUBE_RADIUS * radiusScale;
    this._tubeScale.set(r, r, len);
    this._tubeMatrix.compose(this._tubeMid, this._tubeQuat, this._tubeScale);
    this.edgeTubeMesh.setMatrixAt(slot, this._tubeMatrix);
    this.edgeTubeMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Per-frame uniform update so the tube radius stays ~constant in screen pixels
   * regardless of zoom. Cheap: one uniform write per frame.
   */
  private updateEdgeTubeRadiusUniform(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    // Textured mode mimics the old thin-line look — collapse the tubes so only
    // the underlying 1px THREE.Lines show through. Other modes get camera-scaled
    // tubes for consistently visible edges.
    const mode = (this.webglRenderer as any).getRenderMode?.();
    if (mode === 'textured') {
      this._edgeTubeRadiusUniform.value = 0;
      return;
    }
    const size = renderer.getSize(this._edgeTubeTmpSize);
    const height = size.y || 1;
    let worldPerPx = 0.001;
    if ((camera as any).isPerspectiveCamera) {
      const persp = camera as THREE.PerspectiveCamera;
      const fov = (persp.fov * Math.PI) / 180;
      // Distance from camera to a representative point (world origin works well
      // when the model sits near the origin; otherwise this is close enough).
      const camPos = this._edgeTubeTmpVec.setFromMatrixPosition(persp.matrixWorld);
      const dist = camPos.length();
      worldPerPx = (2 * Math.max(0.001, dist) * Math.tan(fov / 2)) / height;
    } else if ((camera as any).isOrthographicCamera) {
      const ortho = camera as THREE.OrthographicCamera;
      const viewHeight = (ortho.top - ortho.bottom) / Math.max(0.0001, ortho.zoom);
      worldPerPx = viewHeight / height;
    }
    const targetRadius = SceneBridge.EDGE_TUBE_TARGET_PX * worldPerPx;
    // The instance matrix bakes EDGE_TUBE_RADIUS into X/Y scale; the shader
    // uniform multiplies that, so the effective radius = base × uniform.
    this._edgeTubeRadiusUniform.value = Math.max(0.05, targetRadius / SceneBridge.EDGE_TUBE_RADIUS);
  }

  /** Release a tube slot when its edge is removed. */
  private releaseEdgeTube(id: string): void {
    if (!this.edgeTubeMesh) return;
    const slot = this.edgeTubeSlot.get(id);
    if (slot === undefined) return;
    this._tubeMatrix.makeScale(0, 0, 0);
    this.edgeTubeMesh.setMatrixAt(slot, this._tubeMatrix);
    this.edgeTubeMesh.instanceMatrix.needsUpdate = true;
    this.edgeTubeSlot.delete(id);
    this.edgeTubeFreeSlots.push(slot);
  }

  /** Grow the InstancedMesh capacity. New mesh inherits geometry + material; copy existing matrices. */
  private growEdgeTubeCapacity(newCapacity: number): void {
    if (!this.edgeTubeMesh) return;
    const oldMesh = this.edgeTubeMesh;
    const newMesh = new THREE.InstancedMesh(oldMesh.geometry, oldMesh.material, newCapacity);
    newMesh.name = oldMesh.name;
    newMesh.frustumCulled = false;
    newMesh.raycast = () => { /* noop */ };
    newMesh.count = oldMesh.count;
    // Copy existing matrices
    const tmp = new THREE.Matrix4();
    const copyCount = Math.min(oldMesh.count, newCapacity);
    for (let i = 0; i < copyCount; i++) {
      oldMesh.getMatrixAt(i, tmp);
      newMesh.setMatrixAt(i, tmp);
    }
    newMesh.instanceMatrix.needsUpdate = true;
    this.scene.remove(oldMesh);
    this.scene.add(newMesh);
    this.edgeTubeMesh = newMesh;
    this.edgeTubeCapacity = newCapacity;
  }

  // ── Preview rendering ──────────────────────────────────────────

  /** Show rubber-band line from a point to cursor. Optional color overrides
   *  the default preview blue (axis-inference colors the band red/green/blue). */
  setRubberBand(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, color?: { r: number; g: number; b: number }): void {
    this.clearRubberBand();
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const line = new THREE.Line(geometry, color ? this.getColoredPreviewMaterial(color) : this.previewMaterial);
    line.computeLineDistances();
    line.name = 'rubber-band';
    line.raycast = () => {}; // Non-raycastable
    this.previewGroup.add(line);
  }

  /** Cached dashed preview materials keyed by color (avoids per-frame material churn). */
  private _coloredPreviewMaterials = new Map<number, THREE.LineDashedMaterial>();

  private getColoredPreviewMaterial(color: { r: number; g: number; b: number }): THREE.LineDashedMaterial {
    const hex = (Math.round(color.r * 255) << 16) | (Math.round(color.g * 255) << 8) | Math.round(color.b * 255);
    let mat = this._coloredPreviewMaterials.get(hex);
    if (!mat) {
      mat = this.previewMaterial.clone();
      mat.color.setHex(hex);
      this._coloredPreviewMaterials.set(hex, mat);
    }
    return mat;
  }

  /** Show preview polygon outline (rectangle, circle, etc.). */
  setPreviewRect(corners: Array<{ x: number; y: number; z: number }>): void {
    this.clearPreviewEdges();
    if (corners.length < 2) return;

    const points = corners.map(c => new THREE.Vector3(c.x, c.y, c.z));
    points.push(points[0].clone()); // Close the loop

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, this.previewMaterial);
    line.computeLineDistances();
    line.name = 'preview-polygon';
    line.raycast = () => {}; // Non-raycastable
    this.previewGroup.add(line);
  }

  clearRubberBand(): void {
    const rb = this.previewGroup.getObjectByName('rubber-band');
    if (rb) {
      this.previewGroup.remove(rb);
      if (rb instanceof THREE.Line) rb.geometry.dispose();
    }
  }

  clearPreviewEdges(): void {
    const children = [...this.previewGroup.children];
    for (const child of children) {
      this.previewGroup.remove(child);
      if (child instanceof THREE.Line) child.geometry.dispose();
    }
  }

  // ── Snap cursor ─────────────────────────────────────────────────

  /**
   * Find the nearest vertex endpoint within snapRadius screen pixels.
   * Returns the snapped world point, or the original worldPoint if no snap.
   * Also positions the snap marker in the 3D scene.
   */
  /** World units per screen pixel at the given view depth. Orthographic
   *  scale depends only on the frustum size (zoom) — NOT camera distance;
   *  using a perspective heuristic there made the snap pre-filter reject
   *  vertices well inside the screen-space snap radius on zoomed-out
   *  ortho views (Top/Front drafting), killing point snapping on dense
   *  models. Perspective uses the actual FOV. */
  private worldUnitsPerPixel(camera: any, camDist: number, viewportHeight: number): number {
    const h = Math.max(1, viewportHeight);
    if (camera?.projection === 'orthographic' && typeof camera._orthoSize === 'number') {
      return (2 * camera._orthoSize) / h;
    }
    const fovDeg = typeof camera?.fov === 'number' ? camera.fov : 45;
    return (2 * camDist * Math.tan((fovDeg * Math.PI) / 360)) / h;
  }

  findSnapPoint(
    screenX: number, screenY: number,
    worldPoint: { x: number; y: number; z: number } | null,
    viewportWidth: number, viewportHeight: number,
    camera: any, // ICameraController
    snapRadiusPx: number = 15,
    hitFaceId: string | null = null,
    hitFacePoint: { x: number; y: number; z: number } | null = null,
  ): { x: number; y: number; z: number } | null {
    // Object snapping disabled: skip ALL detection. Face-plane points stay
    // exact (rounding would pull them off the face); free points still get
    // grid-snapped so the marker matches the committed geometry.
    if (!getSnapSettings().objectSnapEnabled) {
      if (worldPoint) {
        const p = hitFacePoint ?? snapPointToGrid(worldPoint);
        this.showCursorMarker(p, camera);
        return p;
      }
      this.hideSnapMarker();
      return worldPoint;
    }

    const mesh = this.engine.getMesh();
    if (mesh.vertices.size === 0) {
      // Even with an empty mesh, a face hit can still happen (e.g. component faces).
      if (hitFaceId && hitFacePoint && mesh.faces.has(hitFaceId)) {
        this.showFaceMarker(hitFacePoint, mesh.faces.get(hitFaceId)!.normal, camera);
        return hitFacePoint;
      }
      // First strokes in an empty document are free points too — grid-snap them
      if (worldPoint) {
        const p = snapPointToGrid(worldPoint);
        this.showCursorMarker(p, camera);
        return p;
      }
      this.hideSnapMarker();
      return worldPoint;
    }

    // Large meshes: collect snap candidates through the spatial grid along
    // the cursor ray instead of scanning (or skipping!) everything.
    let gridCandidates: { vertexIds: Set<string>; edgeIds: Set<string> } | null = null;
    if (mesh.vertices.size > SceneBridge.SNAP_GRID_THRESHOLD ||
        mesh.edges.size > SceneBridge.SNAP_GRID_THRESHOLD) {
      const gridRay = camera.screenToRay(screenX, screenY, viewportWidth, viewportHeight);
      if (gridRay) {
        this.snapGrid.ensureFresh(mesh);
        const camPos = camera.position || { x: 0, y: 10, z: 10 };
        const camDist = worldPoint ? Math.sqrt(
          (worldPoint.x - camPos.x) ** 2 + (worldPoint.y - camPos.y) ** 2 + (worldPoint.z - camPos.z) ** 2,
        ) : 30;
        // Pre-filter only — 2x safety margin; the precise screen-space
        // distance check afterwards provides the real 15px accuracy.
        const radius = Math.min(200, Math.max(0.05, this.worldUnitsPerPixel(camera, camDist, viewportHeight) * snapRadiusPx * 2));
        gridCandidates = this.snapGrid.queryRay(gridRay.origin, gridRay.direction, radius, camDist * 2);
      }
    }

    let bestDist = Infinity;
    let bestPoint: { x: number; y: number; z: number } | null = null;
    let bestType: 'origin' | 'vertex' | 'midpoint' | 'intersection' | 'center' | null = null;

    // World-origin snap (0,0,0) — high priority. Mimics the classic modeler's behavior:
    // when the cursor passes near the axis origin it snaps decisively so the
    // user can anchor geometry at the model's true origin.
    {
      const ORIGIN_SNAP_RADIUS = snapRadiusPx + 6; // a touch larger than vertex snap
      const sp = camera.worldToScreen({ x: 0, y: 0, z: 0 }, viewportWidth, viewportHeight);
      const dx = sp.x - screenX;
      const dy = sp.y - screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < ORIGIN_SNAP_RADIUS) {
        bestDist = dist;
        bestPoint = { x: 0, y: 0, z: 0 };
        bestType = 'origin';
      }
    }

    // For large meshes, use a camera-ray proximity pre-filter instead of
    // projecting every vertex to screen (which requires matrix multiplication).
    const useFastFilter = mesh.vertices.size > 1000;
    let rayOrigin: { x: number; y: number; z: number } | null = null;
    let rayDir: { x: number; y: number; z: number } | null = null;
    let maxWorldDist = 0;

    if (useFastFilter) {
      const ray = camera.screenToRay(screenX, screenY, viewportWidth, viewportHeight);
      if (ray) {
        rayOrigin = ray.origin;
        rayDir = ray.direction;
        // Estimate world-space snap radius from screen pixels
        const camPos = camera.position || { x: 0, y: 10, z: 10 };
        const camDist = worldPoint ? Math.sqrt(
          (worldPoint.x - camPos.x) ** 2 + (worldPoint.y - camPos.y) ** 2 + (worldPoint.z - camPos.z) ** 2
        ) : 20;
        // Pre-filter only — 2x safety margin over the true per-pixel scale
        maxWorldDist = this.worldUnitsPerPixel(camera, camDist, viewportHeight) * snapRadiusPx * 2;
      }
    }

    // Check vertex positions (grid candidates on large meshes)
    const margin = snapRadiusPx * 2;
    const scanVertices = (cb: (vertex: any) => void) => {
      if (gridCandidates) {
        for (const id of gridCandidates.vertexIds) {
          const v = mesh.vertices.get(id);
          if (v) cb(v);
        }
      } else {
        mesh.vertices.forEach(cb);
      }
    };
    scanVertices((vertex) => {
      // Fast 3D proximity filter for large meshes: skip vertices far from cursor ray
      if (useFastFilter && rayOrigin && rayDir) {
        const toVert = {
          x: vertex.position.x - rayOrigin.x,
          y: vertex.position.y - rayOrigin.y,
          z: vertex.position.z - rayOrigin.z,
        };
        const t = toVert.x * rayDir.x + toVert.y * rayDir.y + toVert.z * rayDir.z;
        if (t < 0) return; // Behind camera
        const closestOnRay = {
          x: rayOrigin.x + rayDir.x * t,
          y: rayOrigin.y + rayDir.y * t,
          z: rayOrigin.z + rayDir.z * t,
        };
        const dx3d = vertex.position.x - closestOnRay.x;
        const dy3d = vertex.position.y - closestOnRay.y;
        const dz3d = vertex.position.z - closestOnRay.z;
        if (dx3d * dx3d + dy3d * dy3d + dz3d * dz3d > maxWorldDist * maxWorldDist) return;
      }

      const screenPos = camera.worldToScreen(vertex.position, viewportWidth, viewportHeight);
      if (screenPos.x < -margin || screenPos.x > viewportWidth + margin ||
          screenPos.y < -margin || screenPos.y > viewportHeight + margin) return;
      const dx = screenPos.x - screenX;
      const dy = screenPos.y - screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < snapRadiusPx && dist < bestDist) {
        bestDist = dist;
        bestPoint = { ...vertex.position };
        bestType = 'vertex';
      }
    });

    // Check edge midpoints (grid candidates on large meshes)
    {
      const scanEdges = (cb: (edge: any) => void) => {
        if (gridCandidates) {
          for (const id of gridCandidates.edgeIds) {
            const e = mesh.edges.get(id);
            if (e) cb(e);
          }
        } else if (mesh.edges.size <= 2000) {
          mesh.edges.forEach(cb);
        }
      };
      scanEdges((edge) => {
        const v1 = mesh.vertices.get(edge.startVertexId);
        const v2 = mesh.vertices.get(edge.endVertexId);
        if (!v1 || !v2) return;

        const mid = {
          x: (v1.position.x + v2.position.x) / 2,
          y: (v1.position.y + v2.position.y) / 2,
          z: (v1.position.z + v2.position.z) / 2,
        };

        // Fast 3D proximity filter
        if (useFastFilter && rayOrigin && rayDir) {
          const toMid = { x: mid.x - rayOrigin.x, y: mid.y - rayOrigin.y, z: mid.z - rayOrigin.z };
          const t = toMid.x * rayDir.x + toMid.y * rayDir.y + toMid.z * rayDir.z;
          if (t < 0) return;
          const cx = rayOrigin.x + rayDir.x * t - mid.x;
          const cy = rayOrigin.y + rayDir.y * t - mid.y;
          const cz = rayOrigin.z + rayDir.z * t - mid.z;
          if (cx * cx + cy * cy + cz * cz > maxWorldDist * maxWorldDist) return;
        }

        const screenPos = camera.worldToScreen(mid, viewportWidth, viewportHeight);
        if (screenPos.x < -margin || screenPos.x > viewportWidth + margin ||
            screenPos.y < -margin || screenPos.y > viewportHeight + margin) return;
        const dx = screenPos.x - screenX;
        const dy = screenPos.y - screenY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < snapRadiusPx && dist < bestDist) {
          bestDist = dist;
          bestPoint = mid;
          bestType = 'midpoint';
        }
      });
    }

    // Guide POINTS (tape measure construction points): the cross marker's
    // segments share a midpoint — that midpoint is the guide point. Same
    // priority pool as vertex snaps.
    {
      const guides = this.webglRenderer.getConstructionGuides();
      const seen = new Set<string>();
      for (const g of guides) {
        if (!g.id.startsWith('guide-pt-')) continue;
        const baseId = g.id.replace(/-\d+$/, '');
        if (seen.has(baseId)) continue;
        seen.add(baseId);
        const p = {
          x: (g.start.x + g.end.x) / 2,
          y: (g.start.y + g.end.y) / 2,
          z: (g.start.z + g.end.z) / 2,
        };
        const screenPos = camera.worldToScreen(p, viewportWidth, viewportHeight);
        const dx = screenPos.x - screenX;
        const dy = screenPos.y - screenY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < snapRadiusPx && dist < bestDist) {
          bestDist = dist;
          bestPoint = p;
          bestType = 'vertex';
        }
      }
    }

    // Check circle/arc centers (classic CAD "Center" inference). Curve edges
    // share a curveId; three spread vertices of the curve give its
    // circumcenter. Skipped for large meshes like the other edge scans.
    if (mesh.edges.size <= 2000) {
      const curveVerts = new Map<string, Array<{ x: number; y: number; z: number }>>();
      mesh.edges.forEach((edge) => {
        const curveId = (edge as any).curveId as string | undefined;
        if (!curveId) return;
        const v = mesh.vertices.get(edge.startVertexId);
        if (!v) return;
        let arr = curveVerts.get(curveId);
        if (!arr) { arr = []; curveVerts.set(curveId, arr); }
        arr.push(v.position);
      });
      for (const [, pts] of curveVerts) {
        if (pts.length < 3) continue;
        const a = pts[0];
        const b = pts[Math.floor(pts.length / 3)];
        const c = pts[Math.floor((2 * pts.length) / 3)];
        const center = this.circumcenter3(a, b, c);
        if (!center) continue;

        const screenPos = camera.worldToScreen(center, viewportWidth, viewportHeight);
        const dx = screenPos.x - screenX;
        const dy = screenPos.y - screenY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < snapRadiusPx && dist < bestDist) {
          bestDist = dist;
          bestPoint = center;
          bestType = 'center';
        }
      }
    }

    // Check edge-edge intersection points (skip if too many edges — O(n²) is too expensive)
    if (mesh.edges.size <= 500) {
      const edgeArray = Array.from(mesh.edges.values());
      for (let i = 0; i < edgeArray.length; i++) {
        const e1 = edgeArray[i];
        const a1 = mesh.vertices.get(e1.startVertexId);
        const a2 = mesh.vertices.get(e1.endVertexId);
        if (!a1 || !a2) continue;

        for (let j = i + 1; j < edgeArray.length; j++) {
          const e2 = edgeArray[j];
          const b1 = mesh.vertices.get(e2.startVertexId);
          const b2 = mesh.vertices.get(e2.endVertexId);
          if (!b1 || !b2) continue;

          // Skip if edges share a vertex (they meet at an endpoint, already snappable)
          if (e1.startVertexId === e2.startVertexId || e1.startVertexId === e2.endVertexId ||
              e1.endVertexId === e2.startVertexId || e1.endVertexId === e2.endVertexId) continue;

          // Find closest point between two line segments
          const intersection = this.edgeEdgeIntersection(
            a1.position, a2.position, b1.position, b2.position
          );
          if (!intersection) continue;

          const screenPos = camera.worldToScreen(intersection, viewportWidth, viewportHeight);
          const dx = screenPos.x - screenX;
          const dy = screenPos.y - screenY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < snapRadiusPx && dist < bestDist) {
            bestDist = dist;
            bestPoint = intersection;
            bestType = 'intersection';
          }
        }
      }
    }

    // Sticky inference (classic CAD): once a hard snap is acquired, hold it while
    // the cursor stays near it — a reference you've shown interest in beats a
    // marginally-closer new candidate, and the marker doesn't flicker at the
    // snap-radius boundary.
    if (this._stickySnap) {
      const sp = camera.worldToScreen(this._stickySnap.point, viewportWidth, viewportHeight);
      const sdx = sp.x - screenX;
      const sdy = sp.y - screenY;
      const stickyDist = Math.sqrt(sdx * sdx + sdy * sdy);
      if (stickyDist < snapRadiusPx * 1.5) {
        const samePoint = bestPoint !== null &&
          Math.abs(bestPoint.x - this._stickySnap.point.x) < 1e-9 &&
          Math.abs(bestPoint.y - this._stickySnap.point.y) < 1e-9 &&
          Math.abs(bestPoint.z - this._stickySnap.point.z) < 1e-9;
        // Hold the sticky point unless a different candidate is decisively
        // closer (70% of the sticky distance) or none was found at all.
        if (!samePoint && (bestPoint === null || bestDist > stickyDist * 0.7)) {
          bestPoint = { ...this._stickySnap.point };
          bestType = this._stickySnap.type;
        }
      } else {
        this._stickySnap = null;
      }
    }

    // If we already found a point snap, use it (higher priority)
    if (bestPoint) {
      this._stickySnap = { point: { ...bestPoint }, type: bestType ?? 'vertex' };
      if ((bestType as string) === 'midpoint') this.showMidpointMarker(bestPoint, camera);
      else if ((bestType as string) === 'intersection') this.showIntersectionMarker(bestPoint, camera);
      else if ((bestType as string) === 'center') this.showCenterMarker(bestPoint, camera);
      else this.showSnapMarker(bestPoint, camera, bestType === 'origin' ? 'origin' : 'vertex');
      return bestPoint;
    }
    this._stickySnap = null;

    // On-edge snap: find the closest point on any edge to the cursor ray.
    // Lower priority than point snaps — only used when no point snap is found.
    // Skip for large meshes — too many edges to check per frame.
    const ray2 = (mesh.edges.size <= 2000 || gridCandidates)
      ? camera.screenToRay(screenX, screenY, viewportWidth, viewportHeight)
      : null;
    if (ray2) {
      let bestEdgeDist = Infinity;
      let bestEdgePoint: { x: number; y: number; z: number } | null = null;

      const scanEdgesForOnEdge = (cb: (edge: any) => void) => {
        if (gridCandidates) {
          for (const id of gridCandidates.edgeIds) {
            const e = mesh.edges.get(id);
            if (e) cb(e);
          }
        } else {
          mesh.edges.forEach(cb);
        }
      };
      scanEdgesForOnEdge((edge) => {
        const v1 = mesh.vertices.get(edge.startVertexId);
        const v2 = mesh.vertices.get(edge.endVertexId);
        if (!v1 || !v2) return;

        // Closest point between ray and edge segment
        const p = this.closestPointOnSegmentToRay(
          v1.position, v2.position, ray2.origin, ray2.direction,
        );
        if (!p) return;

        // Check screen distance
        const sp = camera.worldToScreen(p, viewportWidth, viewportHeight);
        const dx = sp.x - screenX;
        const dy = sp.y - screenY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < snapRadiusPx * 0.7 && dist < bestEdgeDist) {
          bestEdgeDist = dist;
          bestEdgePoint = p;
        }
      });

      // Guide LINES participate as on-line snaps (classic CAD "On Line") in the
      // same pool as edges — the closest wins.
      for (const g of this.webglRenderer.getConstructionGuides()) {
        if (g.id.startsWith('guide-pt-')) continue; // points handled above
        const p = this.closestPointOnSegmentToRay(
          g.start, g.end, ray2.origin, ray2.direction,
        );
        if (!p) continue;
        const sp = camera.worldToScreen(p, viewportWidth, viewportHeight);
        const dx = sp.x - screenX;
        const dy = sp.y - screenY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < snapRadiusPx * 0.7 && dist < bestEdgeDist) {
          bestEdgeDist = dist;
          bestEdgePoint = p;
        }
      }

      if (bestEdgePoint) {
        this.showOnEdgeMarker(bestEdgePoint, camera);
        return bestEdgePoint;
      }
    }

    // Face-snap fallback — when the cursor is on a face but no point/edge snap fired,
    // anchor the snap to the face hit point and indicate face-snap visually.
    if (hitFaceId && hitFacePoint) {
      const f = mesh.faces.get(hitFaceId);
      if (f) {
        this.showFaceMarker(hitFacePoint, f.normal, camera);
        return hitFacePoint;
      }
    }

    // No snap — a FREE point. Grid-snap it (no-op when disabled) BEFORE
    // showing the marker: indicator == geometry, so preview and commit land
    // exactly where the marker sits.
    if (worldPoint) {
      worldPoint = snapPointToGrid(worldPoint);
      this.showCursorMarker(worldPoint, camera);
    } else {
      this.hideSnapMarker();
    }
    return worldPoint;
  }

  /** Show a yellow face-snap marker on the hovered face, oriented to its normal. */
  private showFaceMarker(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }, camera: any): void {
    // Hide the regular point/edge marker.
    this.snapMarker.visible = false;

    this.faceSnapMarker.position.set(point.x, point.y, point.z);
    this.faceSnapMarker.visible = true;
    this.snapActive = true;
    this._lastSnapKind = 'face';

    // Orient the local +Z axis (the marker plane is in XY) to align with the face normal.
    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const z = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(z, n);
    this.faceSnapMarker.quaternion.copy(q);

    // Lift slightly toward the camera along the face normal so the marker doesn't z-fight.
    const camPos = camera.position || { x: 0, y: 10, z: 10 };
    const camOffset = {
      x: camPos.x - point.x,
      y: camPos.y - point.y,
      z: camPos.z - point.z,
    };
    const dot = camOffset.x * normal.x + camOffset.y * normal.y + camOffset.z * normal.z;
    const sign = dot >= 0 ? 1 : -1;
    const offset = 0.002;
    this.faceSnapMarker.position.x += normal.x * offset * sign;
    this.faceSnapMarker.position.y += normal.y * offset * sign;
    this.faceSnapMarker.position.z += normal.z * offset * sign;

    // Scale to camera distance so the indicator stays visually consistent.
    const dx = point.x - camPos.x, dy = point.y - camPos.y, dz = point.z - camPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const s = Math.max(dist * 0.06, 0.06);
    this.faceSnapMarker.scale.set(s, s, s);
  }

  /**
   * Find the closest point on a line segment (a->b) to a ray (origin + t*dir).
   * Returns the point on the segment, or null if too far.
   */
  private closestPointOnSegmentToRay(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    rayOrigin: { x: number; y: number; z: number },
    rayDir: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } | null {
    // Edge direction
    const edx = b.x - a.x, edy = b.y - a.y, edz = b.z - a.z;
    // w = a - rayOrigin
    const wx = a.x - rayOrigin.x, wy = a.y - rayOrigin.y, wz = a.z - rayOrigin.z;

    const aa = rayDir.x * rayDir.x + rayDir.y * rayDir.y + rayDir.z * rayDir.z;
    const bb = rayDir.x * edx + rayDir.y * edy + rayDir.z * edz;
    const cc = edx * edx + edy * edy + edz * edz;
    const dd = rayDir.x * wx + rayDir.y * wy + rayDir.z * wz;
    const ee = edx * wx + edy * wy + edz * wz;

    const denom = aa * cc - bb * bb;
    if (Math.abs(denom) < 1e-10) return null; // Parallel

    // s = parameter on edge segment (clamped to [0,1])
    let s = (bb * dd - aa * ee) / denom;
    s = Math.max(0, Math.min(1, s));

    // Skip if very close to endpoints (those are already handled by vertex snap)
    if (s < 0.05 || s > 0.95) return null;

    return {
      x: a.x + edx * s,
      y: a.y + edy * s,
      z: a.z + edz * s,
    };
  }

  /** Scale snap marker so it appears constant size on screen regardless of zoom. */
  private scaleMarkerToCamera(point: { x: number; y: number; z: number }, camera: any): void {
    const camPos = camera.position || { x: 0, y: 10, z: 10 };
    const dx = point.x - camPos.x;
    const dy = point.y - camPos.y;
    const dz = point.z - camPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Scale factor: keep marker visually prominent at any distance
    const s = Math.max(dist * 0.06, 0.06);
    this.snapMarker.scale.set(s, s, s);
  }

  /** Public hook for tools to show the green snap marker at a world point.
   *  Used by tools (e.g. Push/Pull) that snap along their own axis rather than
   *  through the standard findSnapPoint pipeline. */
  showInferenceMarker(point: { x: number; y: number; z: number }, camera: any): void {
    this.showSnapMarker(point, camera);
  }

  /** Show the green snap marker at a snapped endpoint (or the model origin). */
  private showSnapMarker(point: { x: number; y: number; z: number }, camera: any, kind: 'vertex' | 'origin' = 'vertex'): void {
    if (this.faceSnapMarker) this.faceSnapMarker.visible = false;
    this.snapMarker.position.set(point.x, point.y, point.z);
    this.snapMarker.visible = true;
    this.snapActive = true;
    this._lastSnapKind = kind;

    const camPos = camera.position;
    this.snapMarkerRing.lookAt(camPos.x, camPos.y, camPos.z);
    this.scaleMarkerToCamera(point, camera);

    (this.snapMarkerDot.material as THREE.MeshBasicMaterial).color.setHex(0x00cc44);
    (this.snapMarkerRing.material as THREE.MeshBasicMaterial).color.setHex(0x00cc44);
    this.snapMarkerRing.visible = true;
  }

  /** Show a dark marker at an edge-edge intersection snap. */
  private showIntersectionMarker(point: { x: number; y: number; z: number }, camera: any): void {
    if (this.faceSnapMarker) this.faceSnapMarker.visible = false;
    this.snapMarker.position.set(point.x, point.y, point.z);
    this.snapMarker.visible = true;
    this.snapActive = true;
    this._lastSnapKind = 'intersection';

    const camPos = camera.position;
    this.snapMarkerRing.lookAt(camPos.x, camPos.y, camPos.z);
    this.scaleMarkerToCamera(point, camera);

    (this.snapMarkerDot.material as THREE.MeshBasicMaterial).color.setHex(0xcc2222);
    (this.snapMarkerRing.material as THREE.MeshBasicMaterial).color.setHex(0x222222);
    this.snapMarkerRing.visible = true;
  }

  /** Show a cyan marker at an edge midpoint snap. */
  private showMidpointMarker(point: { x: number; y: number; z: number }, camera: any): void {
    if (this.faceSnapMarker) this.faceSnapMarker.visible = false;
    this.snapMarker.position.set(point.x, point.y, point.z);
    this.snapMarker.visible = true;
    this.snapActive = true;
    this._lastSnapKind = 'midpoint';

    const camPos = camera.position;
    this.snapMarkerRing.lookAt(camPos.x, camPos.y, camPos.z);
    this.scaleMarkerToCamera(point, camera);

    (this.snapMarkerDot.material as THREE.MeshBasicMaterial).color.setHex(0x00bbff);
    (this.snapMarkerRing.material as THREE.MeshBasicMaterial).color.setHex(0x00bbff);
    this.snapMarkerRing.visible = true;
  }

  /** Circumcenter of three 3D points (center of the circle through them). */
  private circumcenter3(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    c: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } | null {
    const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const w = {
      x: u.y * v.z - u.z * v.y,
      y: u.z * v.x - u.x * v.z,
      z: u.x * v.y - u.y * v.x,
    };
    const w2 = w.x * w.x + w.y * w.y + w.z * w.z;
    if (w2 < 1e-12) return null; // collinear
    const uu = u.x * u.x + u.y * u.y + u.z * u.z;
    const vv = v.x * v.x + v.y * v.y + v.z * v.z;
    // center = a + ( |v|² (w × u) + |u|² (v × w) ) / (2 |w|²)
    const wxu = { x: w.y * u.z - w.z * u.y, y: w.z * u.x - w.x * u.z, z: w.x * u.y - w.y * u.x };
    const vxw = { x: v.y * w.z - v.z * w.y, y: v.z * w.x - v.x * w.z, z: v.x * w.y - v.y * w.x };
    return {
      x: a.x + (vv * wxu.x + uu * vxw.x) / (2 * w2),
      y: a.y + (vv * wxu.y + uu * vxw.y) / (2 * w2),
      z: a.z + (vv * wxu.z + uu * vxw.z) / (2 * w2),
    };
  }

  /** Show a teal marker at a circle/arc center snap. */
  private showCenterMarker(point: { x: number; y: number; z: number }, camera: any): void {
    if (this.faceSnapMarker) this.faceSnapMarker.visible = false;
    this.snapMarker.position.set(point.x, point.y, point.z);
    this.snapMarker.visible = true;
    this.snapActive = true;
    this._lastSnapKind = 'center';

    const camPos = camera.position;
    this.snapMarkerRing.lookAt(camPos.x, camPos.y, camPos.z);
    this.scaleMarkerToCamera(point, camera);

    (this.snapMarkerDot.material as THREE.MeshBasicMaterial).color.setHex(0x00aa88);
    (this.snapMarkerRing.material as THREE.MeshBasicMaterial).color.setHex(0x00aa88);
    this.snapMarkerRing.visible = true;
  }

  /** Show a red marker at an on-edge snap point. */
  private showOnEdgeMarker(point: { x: number; y: number; z: number }, camera: any): void {
    if (this.faceSnapMarker) this.faceSnapMarker.visible = false;
    this.snapMarker.position.set(point.x, point.y, point.z);
    this.snapMarker.visible = true;
    this.snapActive = true;
    this._lastSnapKind = 'edge';

    const camPos = camera.position;
    this.snapMarkerRing.lookAt(camPos.x, camPos.y, camPos.z);
    this.scaleMarkerToCamera(point, camera);

    (this.snapMarkerDot.material as THREE.MeshBasicMaterial).color.setHex(0xff4444);
    (this.snapMarkerRing.material as THREE.MeshBasicMaterial).color.setHex(0xff4444);
    this.snapMarkerRing.visible = true;
  }

  /** Show a small blue marker at cursor position (no snap). */
  private showCursorMarker(point: { x: number; y: number; z: number }, camera: any): void {
    if (this.faceSnapMarker) this.faceSnapMarker.visible = false;
    this.snapMarker.position.set(point.x, point.y, point.z);
    this.snapMarker.visible = true;
    this.snapActive = false;
    this._lastSnapKind = 'cursor';

    const camPos = camera.position;
    this.snapMarkerRing.lookAt(camPos.x, camPos.y, camPos.z);
    this.scaleMarkerToCamera(point, camera);

    (this.snapMarkerDot.material as THREE.MeshBasicMaterial).color.setHex(0x3388ff);
    (this.snapMarkerRing.material as THREE.MeshBasicMaterial).color.setHex(0x3388ff);
    this.snapMarkerRing.visible = false;
  }

  hideSnapMarker(): void {
    this._stickySnap = null;
    this.snapMarker.visible = false;
    if (this.faceSnapMarker) this.faceSnapMarker.visible = false;
    this.snapActive = false;
    this._lastSnapKind = null;
  }

  get isSnapped(): boolean {
    return this.snapActive;
  }

  /** Last snap kind — used by tools that want to know if it was a face hover. */
  getLastSnapKind(): typeof this._lastSnapKind { return this._lastSnapKind; }

  /**
   * Find the intersection point of two 3D line segments, if they intersect
   * or nearly intersect (within tolerance). Returns null if no intersection.
   */
  /**
   * Compute a tiny deterministic normal-offset for a face to prevent
   * z-fighting between coplanar adjacent faces. Each face id hashes
   * to a unique micro-offset in the range [0.0001, 0.001].
   */
  private faceNudge(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    }
    // Map to [0.0001 .. 0.001] — invisible but enough to break depth ties
    return 0.0001 + (Math.abs(hash) % 900) * 0.000001;
  }

  private edgeEdgeIntersection(
    a1: { x: number; y: number; z: number }, a2: { x: number; y: number; z: number },
    b1: { x: number; y: number; z: number }, b2: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } | null {
    const TOLERANCE = 0.05;

    // Direction vectors
    const da = { x: a2.x - a1.x, y: a2.y - a1.y, z: a2.z - a1.z };
    const db = { x: b2.x - b1.x, y: b2.y - b1.y, z: b2.z - b1.z };
    const w = { x: a1.x - b1.x, y: a1.y - b1.y, z: a1.z - b1.z };

    const a = da.x * da.x + da.y * da.y + da.z * da.z;
    const b = da.x * db.x + da.y * db.y + da.z * db.z;
    const c = db.x * db.x + db.y * db.y + db.z * db.z;
    const d = da.x * w.x + da.y * w.y + da.z * w.z;
    const e = db.x * w.x + db.y * w.y + db.z * w.z;

    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-10) return null; // Parallel

    const s = (b * e - c * d) / denom;
    const t = (a * e - b * d) / denom;

    // Must be within segment bounds (0 to 1), with small tolerance
    if (s < -0.01 || s > 1.01 || t < -0.01 || t > 1.01) return null;

    // Points on each line closest to the other
    const pa = { x: a1.x + s * da.x, y: a1.y + s * da.y, z: a1.z + s * da.z };
    const pb = { x: b1.x + t * db.x, y: b1.y + t * db.y, z: b1.z + t * db.z };

    // Distance between closest points
    const dist = Math.sqrt(
      (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2 + (pa.z - pb.z) ** 2
    );

    if (dist > TOLERANCE) return null; // Too far apart

    // Return midpoint of the two closest points
    return {
      x: (pa.x + pb.x) / 2,
      y: (pa.y + pb.y) / 2,
      z: (pa.z + pb.z) / 2,
    };
  }

  /** Make an object and all its current children invisible to the raycaster. */
  private setNonRaycastable(obj: THREE.Object3D): void {
    obj.raycast = () => {}; // No-op raycast
    obj.traverse(child => {
      child.raycast = () => {};
    });
  }

  dispose(): void {
    this.clearPreviewEdges();
    // Remove all face groups and edge lines
    for (const [, group] of this.faceGroups) {
      this.scene.remove(group);
      group.traverse(child => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }
    for (const [, line] of this.edgeLines) {
      this.scene.remove(line);
      line.geometry.dispose();
    }
    this.faceGroups.clear();
    this.edgeLines.clear();
    this._faceTriCache.clear();
    this.faceMaterial.dispose();
    this.backFaceMaterial.dispose();
    this.edgeMaterial.dispose();
    this.previewMaterial.dispose();
    for (const [, m] of this._coloredPreviewMaterials) m.dispose();
    this._coloredPreviewMaterials.clear();
  }
}
