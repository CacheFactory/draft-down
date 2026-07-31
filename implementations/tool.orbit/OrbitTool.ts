// @archigraph tool.orbit
// Orbit tool: drag to orbit camera around the point under cursor.
// Like DraftDown: click sets the orbit pivot, drag rotates around it.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';

export class OrbitTool extends BaseTool {
  readonly id = 'tool.orbit';
  readonly name = 'Orbit';
  readonly icon = 'rotate-ccw';
  readonly shortcut = 'O';
  readonly category = 'navigate' as const;
  readonly cursor = 'grab';

  private lastX = 0;
  private lastY = 0;

  activate(): void {
    super.activate();
    this.setStatus('Click and drag to orbit. Pivots around point under cursor.');
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.lastX = event.screenX;
    this.lastY = event.screenY;
    this.setPhase('dragging');

    // Set orbit pivot to the point under cursor (no camera snap)
    const pivot = this.findPivotPoint(event);
    if (pivot) {
      // Use setOrbitPivot if available (doesn't snap the view)
      const cam = this.viewport.camera as any;
      if (cam.setOrbitPivot) {
        cam.setOrbitPivot(pivot);
      } else {
        cam.lookAt(pivot);
      }
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase !== 'dragging') return;

    const dx = event.screenX - this.lastX;
    const dy = event.screenY - this.lastY;
    this.lastX = event.screenX;
    this.lastY = event.screenY;

    this.viewport.camera.orbit(dx, dy);
  }

  onMouseUp(_event: ToolMouseEvent): void {
    this.setPhase('idle');
  }

  getVCBLabel(): string { return ''; }

  /**
   * Find the best 3D point to use as the orbit pivot.
   * Priority: 1) geometry under cursor, 2) ground plane, 3) plane at target distance
   */
  private findPivotPoint(event: ToolMouseEvent): Vec3 | null {
    // 1. Try raycasting against scene geometry
    const hits = this.viewport.raycastScene(event.screenX, event.screenY);
    if (hits.length > 0) {
      return hits[0].point;
    }

    // 2. Try ground plane intersection
    if (event.worldPoint) {
      return event.worldPoint;
    }

    // 3. Project cursor onto a plane perpendicular to the view direction,
    //    positioned at the current target distance from the camera.
    //    This ensures we always get a valid pivot even when looking away from ground.
    const cam = this.viewport.camera;
    const camPos = cam.position;
    const camTarget = cam.target;
    const viewDir = vec3.normalize(vec3.sub(camTarget, camPos));
    const targetDist = vec3.distance(camPos, camTarget);

    // Cast a ray from the screen point
    const ray = cam.screenToRay(
      event.screenX, event.screenY,
      this.viewport.getWidth(), this.viewport.getHeight()
    );

    // Intersect with a plane at target distance, facing the camera
    const planeNormal = vec3.negate(viewDir);
    const planePoint = vec3.add(camPos, vec3.mul(viewDir, targetDist));
    const denom = vec3.dot(ray.direction, planeNormal);
    if (Math.abs(denom) < 1e-10) return null;

    const t = vec3.dot(vec3.sub(planePoint, ray.origin), planeNormal) / denom;
    if (t < 0) return null;

    return vec3.add(ray.origin, vec3.mul(ray.direction, t));
  }
}
