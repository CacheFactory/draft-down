// @archigraph renderer.viewport
// Viewport: owns canvas, renderer, and camera; handles resize and coordinate transforms

import * as THREE from 'three';
import { IViewport, IRenderer, ICameraController } from '../../src/core/interfaces';
import { Vec3, Vec2, RenderMode, ProjectionType } from '../../src/core/types';
import { WebGLRenderer } from '../renderer.webgl/WebGLRenderer';
import { CameraController } from '../camera.main/CameraController';

export class Viewport implements IViewport {
  renderer: IRenderer;
  camera: ICameraController;

  private _webglRenderer: WebGLRenderer;
  private _cameraController: CameraController;
  private _canvas: HTMLCanvasElement | null = null;
  private _container: HTMLElement | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _gridVisible = true;
  private _axesVisible = true;
  private _width = 1;
  private _height = 1;

  constructor() {
    this._cameraController = new CameraController();
    this._webglRenderer = new WebGLRenderer(this._cameraController);
    this.renderer = this._webglRenderer;
    this.camera = this._cameraController;
  }

  initialize(container: HTMLElement): void {
    this._container = container;

    this._canvas = document.createElement('canvas');
    this._canvas.style.display = 'block';
    this._canvas.tabIndex = 0;
    container.appendChild(this._canvas);

    const rect = container.getBoundingClientRect();
    this._width = rect.width;
    this._height = rect.height;

    this._webglRenderer.initialize(this._canvas, this._width, this._height);

    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this._width = width;
          this._height = height;
          this._webglRenderer.resize(width, height);
        }
      }
    });
    this._resizeObserver.observe(container);

    this._webglRenderer.startRenderLoop();
  }

  dispose(): void {
    this._webglRenderer.stopRenderLoop();
    this._webglRenderer.dispose();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._canvas && this._container) {
      this._container.removeChild(this._canvas);
      this._canvas = null;
    }
    this._container = null;
  }

  setRenderMode(mode: RenderMode): void { this._webglRenderer.setRenderMode(mode); }
  setProjection(type: ProjectionType): void { this._cameraController.setProjection(type); }

  toggleGrid(): void {
    this._gridVisible = !this._gridVisible;
    this._webglRenderer.setGridVisible(this._gridVisible);
  }

  setGridSpacing(meters: number): void {
    this._webglRenderer.setGridSpacing(meters);
  }

  toggleAxes(): void {
    this._axesVisible = !this._axesVisible;
    this._webglRenderer.setAxesVisible(this._axesVisible);
  }

  screenToWorld(screenX: number, screenY: number): Vec3 | null {
    const ray = this._cameraController.screenToRay(screenX, screenY, this._width, this._height);
    if (Math.abs(ray.direction.y) < 1e-10) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    return {
      x: ray.origin.x + ray.direction.x * t,
      y: ray.origin.y + ray.direction.y * t,
      z: ray.origin.z + ray.direction.z * t,
    };
  }

  worldToScreen(point: Vec3): Vec2 {
    return this._cameraController.worldToScreen(point, this._width, this._height);
  }

  /** Reusable raycaster — avoids allocating a new one per call. */
  private _raycaster = new THREE.Raycaster();
  private _ndcVec = new THREE.Vector2();

  raycastScene(
    screenX: number,
    screenY: number,
  ): Array<{ entityId: string; point: Vec3; distance: number }> {
    const w = this._width;
    const h = this._height;

    const camera = this._cameraController.getThreeCamera();
    (camera as any).updateProjectionMatrix?.();
    camera.updateMatrixWorld(true);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    this._ndcVec.set((screenX / w) * 2 - 1, -(screenY / h) * 2 + 1);

    // Set up raycaster with adaptive line threshold
    const camTarget = (this._cameraController as any).target || { x: 0, y: 0, z: 0 };
    const camDist = camera.position.distanceTo(new THREE.Vector3(camTarget.x, camTarget.y, camTarget.z));
    let pixelSize: number;
    if (camera instanceof THREE.PerspectiveCamera) {
      const vFov = (camera.fov * Math.PI) / 180;
      pixelSize = (2 * camDist * Math.tan(vFov / 2)) / h;
    } else {
      const orthoH = ((camera as THREE.OrthographicCamera).top - (camera as THREE.OrthographicCamera).bottom);
      pixelSize = orthoH / h;
    }
    const threshold = Math.max(0.01, pixelSize * 10);
    this._raycaster.params.Line = { threshold };
    this._raycaster.params.Points = { threshold };
    this._raycaster.setFromCamera(this._ndcVec, camera);

    // Raycast main scene (faces and edges are both in the main scene).
    const scene = this._webglRenderer.getScene();

    (this._raycaster as any).firstHitOnly = false;
    const allIntersects = this._raycaster.intersectObjects(scene.children, true);

    const faceHits: Array<{ entityId: string; point: Vec3; distance: number }> = [];
    const edgeHits: Array<{ entityId: string; point: Vec3; distance: number }> = [];
    const seenIds = new Set<string>();

    for (const hit of allIntersects) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData.entityId) {
          const eid = obj.userData.entityId as string;
          if (!seenIds.has(eid)) {
            seenIds.add(eid);
            const hitData = {
              entityId: eid,
              point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
              distance: hit.distance,
            };
            if (hit.object instanceof THREE.Line) {
              edgeHits.push(hitData);
            } else {
              faceHits.push(hitData);
            }
          }
          break;
        }
        obj = obj.parent;
      }
      // Stop early once we have at least one of each
      if (edgeHits.length > 0 && faceHits.length > 0) break;
    }

    if (edgeHits.length > 0) {
      return [...edgeHits, ...faceHits];
    }
    return faceHits;
  }

  /** Lightweight raycast: edges only in the main scene.
   *  Collects Line objects first to avoid raycasting face meshes.
   *  Use together with GPU pick for faces to get full coverage without blocking. */
  raycastEdgesOnly(
    screenX: number,
    screenY: number,
  ): Array<{ entityId: string; point: Vec3; distance: number }> {
    const w = this._width;
    const h = this._height;

    const camera = this._cameraController.getThreeCamera();
    (camera as any).updateProjectionMatrix?.();
    camera.updateMatrixWorld(true);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    this._ndcVec.set((screenX / w) * 2 - 1, -(screenY / h) * 2 + 1);

    // Adaptive line threshold
    const camTarget = (this._cameraController as any).target || { x: 0, y: 0, z: 0 };
    const camDist = camera.position.distanceTo(new THREE.Vector3(camTarget.x, camTarget.y, camTarget.z));
    let pixelSize: number;
    if (camera instanceof THREE.PerspectiveCamera) {
      const vFov = (camera.fov * Math.PI) / 180;
      pixelSize = (2 * camDist * Math.tan(vFov / 2)) / h;
    } else {
      const orthoH = ((camera as THREE.OrthographicCamera).top - (camera as THREE.OrthographicCamera).bottom);
      pixelSize = orthoH / h;
    }
    const threshold = Math.max(0.01, pixelSize * 10);
    this._raycaster.params.Line = { threshold };
    this._raycaster.params.Points = { threshold };
    this._raycaster.setFromCamera(this._ndcVec, camera);

    // Collect only edge Line objects from main scene to avoid raycasting face meshes
    const scene = this._webglRenderer.getScene();
    const edgeLines: THREE.Object3D[] = [];
    for (const child of scene.children) {
      if (child instanceof THREE.Line && child.userData.entityType === 'edge') {
        edgeLines.push(child);
      }
    }
    const edgeIntersects = this._raycaster.intersectObjects(edgeLines, false);

    const hits: Array<{ entityId: string; point: Vec3; distance: number }> = [];
    for (const hit of edgeIntersects) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData.entityId) {
          const eid = obj.userData.entityId as string;
          hits.push({
            entityId: eid,
            point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
            distance: hit.distance,
          });
          break;
        }
        obj = obj.parent;
      }
      if (hits.length > 0) break; // only need closest
    }
    return hits;
  }

  getWidth(): number { return this._width; }
  getHeight(): number { return this._height; }

  getCanvas(): HTMLCanvasElement | null { return this._canvas; }
  getWebGLRenderer(): WebGLRenderer { return this._webglRenderer; }
  getCameraController(): CameraController { return this._cameraController; }
}
