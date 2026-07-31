// @archigraph plugin.system.draftdown.camera
// DraftDown.Camera — wraps the live ICameraController.
// Reference: 

import type { ICameraController } from '../../../src/core/interfaces';
import { Point3d, Vector3d } from './Geom';

export class Camera {
  constructor(private cam: ICameraController) {}

  /** Camera#eye — the camera position. */
  get eye(): Point3d { return new Point3d(this.cam.position.x, this.cam.position.y, this.cam.position.z); }
  set eye(p: Point3d) { this.cam.position.x = p.x; this.cam.position.y = p.y; this.cam.position.z = p.z; }

  /** Camera#target — the look-at point. */
  get target(): Point3d { return new Point3d(this.cam.target.x, this.cam.target.y, this.cam.target.z); }
  set target(p: Point3d) { this.cam.target.x = p.x; this.cam.target.y = p.y; this.cam.target.z = p.z; this.cam.lookAt(this.cam.target); }

  /** Camera#up */
  get up(): Vector3d { return new Vector3d(this.cam.up.x, this.cam.up.y, this.cam.up.z); }
  set up(v: Vector3d) { this.cam.up.x = v.x; this.cam.up.y = v.y; this.cam.up.z = v.z; }

  /** Camera#direction — unit vector eye → target. */
  get direction(): Vector3d {
    const e = this.cam.position; const t = this.cam.target;
    return new Vector3d(t.x - e.x, t.y - e.y, t.z - e.z).normalize();
  }

  /** Camera#fov — vertical field of view in degrees. */
  get fov(): number { return this.cam.fov; }
  set fov(v: number) { this.cam.fov = v; }

  /** Camera#aspect_ratio — best-effort 0 means follow viewport. */
  get aspectRatio(): number { return 0; }

  /** Camera#perspective? */
  perspective(): boolean { return this.cam.projection === 'perspective'; }
  /** Camera#perspective= */
  setPerspective(p: boolean): void { this.cam.setProjection(p ? 'perspective' : 'orthographic'); }

  /** Camera#height — orthographic camera height (model units). For perspective returns 0. */
  get height(): number {
    if (this.cam.projection !== 'orthographic') return 0;
    // Approximate: distance × tan(fov/2) × 2 (planar height at target).
    const d = new Vector3d(this.cam.target.x - this.cam.position.x, this.cam.target.y - this.cam.position.y, this.cam.target.z - this.cam.position.z).length;
    return 2 * d * Math.tan((this.cam.fov * Math.PI / 180) / 2);
  }
  set height(_h: number) { /* not directly settable; setting fov to match is non-trivial */ }

  /** Camera#image_width — render image width in pixels. Best-effort: 0 means viewport-driven. */
  get imageWidth(): number { return 0; }
  set imageWidth(_w: number) { /* no separate render-image surface yet */ }

  /** Camera#description */
  description = '';

  /**
   * Camera#set(eye, target, up)
   */
  set(eye: Point3d, target: Point3d, up: Vector3d): Camera {
    this.eye = eye; this.target = target; this.up = up;
    return this;
  }

  /** Camera#xaxis / yaxis / zaxis — orthonormal frame. */
  get zaxis(): Vector3d { return this.direction.reverse(); }
  get xaxis(): Vector3d { return this.up.cross(this.zaxis).normalize(); }
  get yaxis(): Vector3d { return this.zaxis.cross(this.xaxis).normalize(); }
}
