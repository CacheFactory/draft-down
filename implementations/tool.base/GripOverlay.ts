// @archigraph tool.base
// Clickable, camera-scaled box grips rendered in the overlay scene.
// Shared by Rotate (center handles) and Scale (bounding-box grips); any future
// tool that needs pickable 3D handles should reuse this instead of rolling its own.

import * as THREE from 'three';
import type { Vec3 } from '../../src/core/types';
import type { IViewport } from '../../src/core/interfaces';

export interface GripItem<T> {
  position: Vec3;
  mesh: THREE.Mesh;
  data: T;
}

export class GripOverlay<T = void> {
  private group: THREE.Group | null = null;
  private items: GripItem<T>[] = [];
  private hovered: GripItem<T> | null = null;

  constructor(
    private viewport: IViewport,
    private name: string,
    private baseColor = 0x00aa00,
    private hoverColor = 0xffff00,
  ) {}

  /** Remove any existing grips and start a fresh group in the overlay scene.
   *  Returns false when the renderer has no overlay scene (headless tests). */
  begin(): boolean {
    this.clear();
    const overlayScene = this.getOverlayScene();
    if (!overlayScene) return false;
    this.group = new THREE.Group();
    this.group.name = this.name;
    this.group.renderOrder = 999;
    overlayScene.add(this.group);
    return true;
  }

  add(position: Vec3, data: T): void {
    if (!this.group) return;
    // Unit box — scaled per-frame to constant screen size
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: this.baseColor, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position.x, position.y, position.z);
    mesh.renderOrder = 1000;
    mesh.raycast = () => {};
    this.group.add(mesh);
    this.items.push({ position, mesh, data });
  }

  get count(): number {
    return this.items.length;
  }

  /** Keep grips constant size on screen. Call on every mouse move. */
  scaleToCamera(): void {
    if (this.items.length === 0) return;
    const camera = (this.viewport.camera as any).getThreeCamera() as THREE.Camera;
    const camPos = camera.position;
    for (const item of this.items) {
      const dx = item.position.x - camPos.x;
      const dy = item.position.y - camPos.y;
      const dz = item.position.z - camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const s = Math.max(dist * 0.008, 0.01);
      item.mesh.scale.set(s, s, s);
    }
  }

  /** Nearest grip to a screen point within threshold pixels, or null. */
  findNearest(screenX: number, screenY: number, thresholdPx = 15): GripItem<T> | null {
    const camera = (this.viewport.camera as any).getThreeCamera() as THREE.Camera;
    const w = this.viewport.getWidth();
    const h = this.viewport.getHeight();
    let best: GripItem<T> | null = null;
    let bestDist = thresholdPx;
    for (const item of this.items) {
      const v = new THREE.Vector3(item.position.x, item.position.y, item.position.z);
      v.project(camera);
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - screenX, sy - screenY);
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  /** Hover-highlight the grip under the cursor; returns it (or null). */
  updateHover(screenX: number, screenY: number): GripItem<T> | null {
    const item = this.findNearest(screenX, screenY);
    if (item !== this.hovered) {
      if (this.hovered) this.setColor(this.hovered, this.baseColor);
      this.hovered = item;
      if (item) this.setColor(item, this.hoverColor);
    }
    return item;
  }

  setColor(item: GripItem<T>, color: number): void {
    (item.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  /** Move existing grips (index-aligned) to new positions. */
  setPositions(positions: Vec3[]): void {
    for (let i = 0; i < this.items.length && i < positions.length; i++) {
      const item = this.items[i];
      item.position = positions[i];
      item.mesh.position.set(positions[i].x, positions[i].y, positions[i].z);
    }
  }

  clear(): void {
    if (this.group) {
      const overlayScene = this.getOverlayScene();
      if (overlayScene) overlayScene.remove(this.group);
      this.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.group = null;
    }
    this.items = [];
    this.hovered = null;
  }

  private getOverlayScene(): THREE.Scene | undefined {
    return (this.viewport.renderer as any).getOverlayScene?.() as THREE.Scene | undefined;
  }
}
