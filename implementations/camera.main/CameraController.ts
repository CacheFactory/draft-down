// @archigraph renderer.camera-controller
// Camera controller with orbit, pan, zoom, and standard views

import * as THREE from 'three';
import { ICameraController } from '../../src/core/interfaces';
import { Vec3, Vec2, Ray, BoundingBox, Matrix4, ProjectionType } from '../../src/core/types';

/** Duration in ms for animated view transitions. */
const TRANSITION_DURATION = 400;

/** Standard camera distance for named views. */
const STANDARD_DISTANCE = 20;

interface ViewPreset {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  projection: ProjectionType;
}

const VIEW_PRESETS: Record<string, ViewPreset> = {
  front: {
    position: { x: 0, y: 0, z: STANDARD_DISTANCE },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    projection: 'orthographic',
  },
  back: {
    position: { x: 0, y: 0, z: -STANDARD_DISTANCE },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    projection: 'orthographic',
  },
  left: {
    position: { x: -STANDARD_DISTANCE, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    projection: 'orthographic',
  },
  right: {
    position: { x: STANDARD_DISTANCE, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    projection: 'orthographic',
  },
  top: {
    position: { x: 0, y: STANDARD_DISTANCE, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: -1 },
    projection: 'orthographic',
  },
  bottom: {
    position: { x: 0, y: -STANDARD_DISTANCE, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    projection: 'orthographic',
  },
  iso: {
    position: { x: 14, y: 14, z: 14 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    projection: 'perspective',
  },
};

export class CameraController implements ICameraController {
  position: Vec3 = { x: 10, y: 10, z: 10 };
  target: Vec3 = { x: 0, y: 0, z: 0 };
  up: Vec3 = { x: 0, y: 1, z: 0 };
  fov: number = 45;
  projection: ProjectionType = 'perspective';
  near: number = 0.1;
  far: number = 10000;

  private _perspectiveCamera: THREE.PerspectiveCamera;
  private _orthographicCamera: THREE.OrthographicCamera;
  private _orthoSize: number = 15;

  // Transition animation state
  private _transitioning = false;
  private _transitionStart = 0;
  private _transitionFrom: { position: Vec3; target: Vec3; up: Vec3 } | null = null;
  private _transitionTo: { position: Vec3; target: Vec3; up: Vec3 } | null = null;

  constructor() {
    this._perspectiveCamera = new THREE.PerspectiveCamera(this.fov, 1, this.near, this.far);
    this._orthographicCamera = new THREE.OrthographicCamera(-15, 15, 15, -15, this.near, this.far);
    this._syncCameras();
  }

  /** Returns the active Three.js camera based on current projection mode. */
  getThreeCamera(): THREE.Camera {
    return this.projection === 'perspective' ? this._perspectiveCamera : this._orthographicCamera;
  }

  /** Update aspect ratio (call on resize). */
  updateAspect(aspect: number): void {
    this._perspectiveCamera.aspect = aspect;
    this._perspectiveCamera.updateProjectionMatrix();

    const halfH = this._orthoSize;
    const halfW = halfH * aspect;
    this._orthographicCamera.left = -halfW;
    this._orthographicCamera.right = halfW;
    this._orthographicCamera.top = halfH;
    this._orthographicCamera.bottom = -halfH;
    this._orthographicCamera.updateProjectionMatrix();
  }

  /** Call every frame to drive transition animations. */
  update(): void {
    if (this._transitioning && this._transitionFrom && this._transitionTo) {
      const elapsed = performance.now() - this._transitionStart;
      let t = Math.min(elapsed / TRANSITION_DURATION, 1.0);
      // Ease in-out cubic
      t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      this.position = lerpVec3(this._transitionFrom.position, this._transitionTo.position, t);
      this.target = lerpVec3(this._transitionFrom.target, this._transitionTo.target, t);
      this.up = normalizeVec3(lerpVec3(this._transitionFrom.up, this._transitionTo.up, t));

      if (t >= 1.0) {
        this._transitioning = false;
        this._transitionFrom = null;
        this._transitionTo = null;
      }
    }
    this._syncCameras();
  }

  orbit(deltaX: number, deltaY: number): void {
    const offset = subVec3(this.position, this.target);
    const spherical = cartesianToSpherical(offset);

    spherical.theta -= deltaX * 0.005;
    spherical.phi -= deltaY * 0.005;

    // Clamp phi to avoid flipping
    spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi));

    const newOffset = sphericalToCartesian(spherical);
    this.position = addVec3(this.target, newOffset);
    this._syncCameras();
  }

  pan(deltaX: number, deltaY: number): void {
    const camera = this.getThreeCamera();
    const eye = subVec3(this.position, this.target);
    const distance = lengthVec3(eye);

    // Scale pan speed with distance
    const panSpeed = distance * 0.002;

    // Get camera right and up vectors
    const right = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    const mat = new THREE.Matrix4().lookAt(
      vec3ToThree(this.position),
      vec3ToThree(this.target),
      vec3ToThree(this.up),
    );
    right.setFromMatrixColumn(mat, 0);
    camUp.setFromMatrixColumn(mat, 1);

    const panOffset = {
      x: -right.x * deltaX * panSpeed + camUp.x * deltaY * panSpeed,
      y: -right.y * deltaX * panSpeed + camUp.y * deltaY * panSpeed,
      z: -right.z * deltaX * panSpeed + camUp.z * deltaY * panSpeed,
    };

    this.position = addVec3(this.position, panOffset);
    this.target = addVec3(this.target, panOffset);
    this._syncCameras();
  }

  zoom(delta: number): void {
    this.zoomToward(delta, null);
  }

  /**
   * Zoom toward a specific world point. If no point given, zooms toward the target.
   * The camera and target both move toward the point, so the zoom feels
   * centered on the cursor position.
   */
  zoomToward(delta: number, worldPoint: Vec3 | null): void {
    if (this.projection === 'perspective') {
      // Multiplicative zoom factor — never stalls regardless of distance
      const factor = Math.pow(1.15, delta);

      if (worldPoint) {
        // Zoom toward cursor: scale the vector from worldPoint to camera
        // Camera moves toward/away from worldPoint, target follows proportionally
        const camToPoint = subVec3(worldPoint, this.position);
        const targetToPoint = subVec3(worldPoint, this.target);

        // New positions = worldPoint - (worldPoint - old) * (1/factor)
        this.position = subVec3(worldPoint, scaleVec3(camToPoint, 1 / factor));
        this.target = subVec3(worldPoint, scaleVec3(targetToPoint, 1 / factor));
      } else {
        // Zoom toward orbit target: scale orbit distance
        const offset = subVec3(this.position, this.target);
        this.position = addVec3(this.target, scaleVec3(offset, 1 / factor));
      }
    } else {
      // Orthographic: scale frustum AND shift the view so that `worldPoint`
      // stays at the same screen pixel. Without the shift the cursor's world
      // point drifts as you scroll, defeating zoom-to-cursor in top/side views.
      const factor = 1 - delta * 0.2;            // < 1 = zoom in (size shrinks)
      const newSize = Math.max(0.1, Math.min(1000, this._orthoSize * factor));
      const realFactor = newSize / this._orthoSize;
      this._orthoSize = newSize;

      if (worldPoint) {
        // newTarget = worldPoint + (target - worldPoint) * factor
        // → shift = (1 - factor) * (worldPoint - target)
        const shift = scaleVec3(subVec3(worldPoint, this.target), 1 - realFactor);
        this.position = addVec3(this.position, shift);
        this.target = addVec3(this.target, shift);
      }
    }
    this._syncCameras();
  }

  setView(name: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'): void {
    const preset = VIEW_PRESETS[name];
    if (!preset) return;

    this._transitionFrom = {
      position: { ...this.position },
      target: { ...this.target },
      up: { ...this.up },
    };
    this._transitionTo = {
      position: { ...preset.position },
      target: { ...preset.target },
      up: { ...preset.up },
    };
    this._transitionStart = performance.now();
    this._transitioning = true;
    this.projection = preset.projection;
  }

  /** Animate to an arbitrary camera pose (scene tabs, walk tools). */
  animateTo(position: Vec3, target: Vec3): void {
    this._transitionFrom = {
      position: { ...this.position },
      target: { ...this.target },
      up: { ...this.up },
    };
    this._transitionTo = {
      position: { ...position },
      target: { ...target },
      up: { x: 0, y: 1, z: 0 },
    };
    this._transitionStart = performance.now();
    this._transitioning = true;
  }

  setProjection(type: ProjectionType): void {
    this.projection = type;
    this._syncCameras();
  }

  lookAt(target: Vec3): void {
    this.target = { ...target };
    this._syncCameras();
  }

  /**
   * Change the orbit pivot point without changing the camera's current view.
   * The camera position and orientation stay the same — only the center
   * of rotation changes for subsequent orbit() calls.
   */
  setOrbitPivot(pivot: Vec3): void {
    this.target = { ...pivot };
    // Don't call _syncCameras — we want to keep the current view direction.
    // The next orbit() call will rotate around this new pivot.
  }

  fitToBox(box: BoundingBox): void {
    const center: Vec3 = {
      x: (box.min.x + box.max.x) / 2,
      y: (box.min.y + box.max.y) / 2,
      z: (box.min.z + box.max.z) / 2,
    };

    const size = {
      x: box.max.x - box.min.x,
      y: box.max.y - box.min.y,
      z: box.max.z - box.min.z,
    };

    const maxDim = Math.max(size.x, size.y, size.z);
    const fitDistance = maxDim / (2 * Math.tan((this.fov * Math.PI) / 360));
    const padding = 1.2;
    // For orthographic mode, fitToBox must scale the frustum, not just position.
    if (this.projection === 'orthographic') {
      this._orthoSize = Math.max(0.1, (maxDim / 2) * padding);
      this._syncCameras();
    }

    const direction = normalizeVec3(subVec3(this.position, this.target));

    this._transitionFrom = {
      position: { ...this.position },
      target: { ...this.target },
      up: { ...this.up },
    };
    this._transitionTo = {
      position: addVec3(center, scaleVec3(direction, fitDistance * padding)),
      target: center,
      up: { ...this.up },
    };
    this._transitionStart = performance.now();
    this._transitioning = true;

    if (this.projection === 'orthographic') {
      this._orthoSize = (maxDim * padding) / 2;
    }
  }

  screenToRay(screenX: number, screenY: number, width: number, height: number): Ray {
    const ndc = new THREE.Vector2(
      (screenX / width) * 2 - 1,
      -(screenY / height) * 2 + 1,
    );

    const camera = this.getThreeCamera();
    if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);

    return {
      origin: {
        x: raycaster.ray.origin.x,
        y: raycaster.ray.origin.y,
        z: raycaster.ray.origin.z,
      },
      direction: {
        x: raycaster.ray.direction.x,
        y: raycaster.ray.direction.y,
        z: raycaster.ray.direction.z,
      },
    };
  }

  worldToScreen(point: Vec3, width: number, height: number): Vec2 {
    const camera = this.getThreeCamera();
    const vec = new THREE.Vector3(point.x, point.y, point.z);
    vec.project(camera);

    return {
      x: ((vec.x + 1) / 2) * width,
      y: ((-vec.y + 1) / 2) * height,
    };
  }

  getViewMatrix(): Matrix4 {
    const camera = this.getThreeCamera();
    camera.updateMatrixWorld();
    return camera.matrixWorldInverse.elements.slice() as unknown as Matrix4;
  }

  getProjectionMatrix(aspect: number): Matrix4 {
    this.updateAspect(aspect);
    const camera = this.getThreeCamera();
    return camera.projectionMatrix.elements.slice() as unknown as Matrix4;
  }

  private _syncCameras(): void {
    const pos = vec3ToThree(this.position);
    const tgt = vec3ToThree(this.target);
    const u = vec3ToThree(this.up);

    this._perspectiveCamera.position.copy(pos);
    this._perspectiveCamera.up.copy(u);
    this._perspectiveCamera.lookAt(tgt);
    this._perspectiveCamera.fov = this.fov;
    this._perspectiveCamera.near = this.near;
    this._perspectiveCamera.far = this.far;
    this._perspectiveCamera.updateProjectionMatrix();

    this._orthographicCamera.position.copy(pos);
    this._orthographicCamera.up.copy(u);
    this._orthographicCamera.lookAt(tgt);
    this._orthographicCamera.near = this.near;
    this._orthographicCamera.far = this.far;
    // Re-apply the current ortho frustum from _orthoSize. Without this, zoom() in
    // ortho mode (top/front/side views) mutates _orthoSize but the visible frustum
    // never updates. Aspect is preserved from the last `updateAspect` call.
    const aspect = this._orthographicCamera.right > this._orthographicCamera.left
      ? (this._orthographicCamera.right - this._orthographicCamera.left) /
        Math.max(1e-6, this._orthographicCamera.top - this._orthographicCamera.bottom)
      : 1;
    const halfH = this._orthoSize;
    const halfW = halfH * aspect;
    this._orthographicCamera.left = -halfW;
    this._orthographicCamera.right = halfW;
    this._orthographicCamera.top = halfH;
    this._orthographicCamera.bottom = -halfH;
    this._orthographicCamera.updateProjectionMatrix();
  }
}

// ─── Vec3 helpers ──────────────────────────────────────────────────

function vec3ToThree(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVec3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function lengthVec3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = lengthVec3(v);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

interface Spherical {
  radius: number;
  theta: number;
  phi: number;
}

function cartesianToSpherical(v: Vec3): Spherical {
  const radius = lengthVec3(v);
  if (radius === 0) return { radius: 0, theta: 0, phi: Math.PI / 2 };
  return {
    radius,
    theta: Math.atan2(v.x, v.z),
    phi: Math.acos(Math.max(-1, Math.min(1, v.y / radius))),
  };
}

function sphericalToCartesian(s: Spherical): Vec3 {
  return {
    x: s.radius * Math.sin(s.phi) * Math.sin(s.theta),
    y: s.radius * Math.cos(s.phi),
    z: s.radius * Math.sin(s.phi) * Math.cos(s.theta),
  };
}
