// @archigraph tool.line
// Line drawing tool: click to place points, rubber-band preview, auto-face creation.
// Arrow keys lock to axis: Up=Y (blue/vertical), Right=X (red), Left=Z (green), Down=unlock.

import type { Vec3, Plane } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { CURSOR_PENCIL } from '../tool.base/cursors';

export class LineTool extends BaseTool {
  readonly id = 'tool.line';
  readonly name = 'Line';
  readonly icon = 'pencil';
  readonly shortcut = 'L';
  readonly category = 'draw' as const;
  readonly cursor = CURSOR_PENCIL;

  private points: Vec3[] = [];
  private vertexIds: string[] = [];
  private currentPoint: Vec3 | null = null;
  private lastScreenX = 0;
  private lastScreenY = 0;
  /** Locked drawing plane after the first click hits a face. Null = no lock. */
  private lockedFacePlane: Plane | null = null;

  activate(): void {
    super.activate();
    this.reset();
    this.setStatus('Click to place first point. Arrow keys lock to axis.');
  }

  deactivate(): void {
    if (this.points.length > 1) {
      // createEdgeWithIntersection already handles face splitting via autoCreateFaces
      this.commitTransaction();
    } else if (this.points.length === 1) {
      this.abortTransaction();
    }
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    const rawPoint = this.getDrawPoint(event);
    if (!rawPoint) return;
    // Constrain the click the same way the preview was constrained (axis lock,
    // auto axis inference, parallel snap) so the commit matches what was shown.
    const point = this.points.length > 0
      ? this.applyDirectionInference(this.points[this.points.length - 1], rawPoint, event)
      : rawPoint;

    if (this.phase === 'idle') {
      this.beginTransaction('Draw Line');
      const vertex = this.findOrCreateVertex(point);
      this.points.push(point);
      this.vertexIds.push(vertex.id);
      this.setPhase('drawing');
      this.axisLock = null;
      // If the first click landed on a face, lock subsequent points onto that
      // face's plane (matches DraftDown behavior — line drawing on a face stays
      // on the face even when the cursor strays off it).
      if (event.hitFaceId) {
        const face = this.document.geometry.getFace(event.hitFaceId);
        if (face) {
          this.lockedFacePlane = { normal: { ...face.plane.normal }, distance: face.plane.distance };
        }
      }
      this.setStatus('Click next point. Arrow keys: Up=Y, Right=X, Left=Z, Down=free.');
    } else if (this.phase === 'drawing') {
      const vertex = this.findOrCreateVertex(point);
      const prevId = this.vertexIds[this.vertexIds.length - 1];

      // Guard: don't create zero-length edge (clicked same point twice)
      if (vertex.id === prevId) return;

      this.vertexIds.push(vertex.id);

      try {
        this.document.geometry.createEdgeWithIntersection(prevId, vertex.id);
      } catch (e) {
        console.warn('[LineTool] createEdgeWithIntersection failed (degenerate, dropping last vertex):', e);
        this.vertexIds.pop();
        return;
      }

      this.points.push(point);
      this.axisLock = null; // Reset lock after placing point

      if (this.points.length >= 3 && vec3.distance(point, this.points[0]) < 0.01) {
        this.tryCreateFace();
        this.commitTransaction();
        this.reset();
        this.setStatus('Loop closed. Click to start a new line.');
        return;
      }

      this.updateVCBFromSegment();
      this.setStatus('Click next point. Arrow keys: Up=Y, Right=X, Left=Z, Down=free.');
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    this.lastScreenX = event.screenX;
    this.lastScreenY = event.screenY;

    const rawPoint = this.getDrawPoint(event);
    if (!rawPoint) return;

    // Directional inference: manual axis lock, automatic axis snap (colored
    // guide + "On … Axis"), or parallel-to-edge snap — anchored at the last point.
    if (this.phase === 'drawing' && this.points.length > 0) {
      const anchor = this.points[this.points.length - 1];
      this.currentPoint = this.applyDirectionInference(anchor, rawPoint, event);
      const dist = vec3.distance(anchor, this.currentPoint);
      this.setVCBValue(this.formatDist(dist));
    } else {
      this.currentPoint = rawPoint;
      this.clearDirectionInference();
    }
  }

  onMouseUp(_event: ToolMouseEvent): void {}

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.phase === 'drawing' && this.points.length > 1) {
        this.commitTransaction();
      } else if (this.phase === 'drawing') {
        this.abortTransaction();
      }
      this.reset();
      this.setStatus('Click to place first point.');
      return;
    }

    if (event.key === 'Enter') {
      if (this.phase === 'drawing' && this.points.length > 1) {
        this.commitTransaction();
      }
      this.reset();
      this.setStatus('Click to place first point.');
      return;
    }

    // Arrow keys lock to axis
    if (!this.handleArrowKeyAxisLock(event)) return;

    this.setStatus(this.getAxisLockStatus());

    // Immediately recompute currentPoint from stored screen position
    if (this.points.length > 0 && this.lastScreenX > 0) {
      const anchor = this.points[this.points.length - 1];
      const ray = this.viewport.camera.screenToRay(
        this.lastScreenX, this.lastScreenY,
        this.viewport.getWidth(), this.viewport.getHeight(),
      );

      if (this.axisLock) {
        this.currentPoint = this.projectRayOntoAxis(ray, anchor, this.axisLock);
      } else {
        // Unlock — project onto ground plane
        const n = { x: 0, y: 1, z: 0 };
        const denom = vec3.dot(ray.direction, n);
        if (Math.abs(denom) > 1e-10) {
          const t = -ray.origin.y / denom;
          if (t > 0) {
            this.currentPoint = vec3.add(ray.origin, vec3.mul(ray.direction, t));
          }
        }
      }
    }
  }

  onVCBInput(value: string): void {
    if (this.phase !== 'drawing' || this.points.length === 0) return;

    const lastPoint = this.points[this.points.length - 1];
    const parts = this.parseDimensions(value);

    let targetPoint: Vec3;

    if (parts.length === 3 && parts.every(n => !isNaN(n))) {
      targetPoint = vec3.add(lastPoint, vec3.create(parts[0], parts[1], parts[2]));
    } else if (parts.length === 2 && parts.every(n => !isNaN(n))) {
      targetPoint = vec3.add(lastPoint, vec3.create(parts[0], 0, parts[1]));
    } else {
      const dist = this.parseDistance(value);
      if (isNaN(dist)) return;

      let dir: Vec3;

      if (this.axisLock) {
        // Use the locked axis direction (respects custom axes)
        const { customAxes } = require('../tool.axes/CustomAxes');
        dir = customAxes.getAxisDirection(this.axisLock);
        // Use the sign from currentPoint to determine positive/negative direction
        if (this.currentPoint) {
          const delta = vec3.sub(this.currentPoint, lastPoint);
          const component = vec3.dot(delta, dir);
          if (component < 0) dir = vec3.negate(dir);
        }
      } else if (this.currentPoint) {
        // Use the preview line direction (cursor direction)
        dir = vec3.normalize(vec3.sub(this.currentPoint, lastPoint));
        if (vec3.lengthSq(dir) < 1e-10) return;
      } else {
        return; // No direction available
      }

      targetPoint = vec3.add(lastPoint, vec3.mul(dir, dist));
    }

    const vertex = this.findOrCreateVertex(targetPoint);
    this.vertexIds.push(vertex.id);
    const prevId = this.vertexIds[this.vertexIds.length - 2];
    this.document.geometry.createEdgeWithIntersection(prevId, vertex.id);
    this.points.push(targetPoint);

    if (this.points.length >= 3 && vec3.distance(targetPoint, this.points[0]) < 0.01) {
      this.tryCreateFace();
      this.commitTransaction();
      this.reset();
      this.setStatus('Loop closed.');
    } else {
      this.updateVCBFromSegment();
    }
  }

  getVCBLabel(): string {
    return this.phase === 'drawing' ? 'Length' : '';
  }

  getPreview(): ToolPreview | null {
    if (this.phase !== 'drawing' || this.points.length === 0 || !this.currentPoint) return null;
    const lastPoint = this.points[this.points.length - 1];
    // Rubber band takes the inference color (red/green/blue on axis, magenta parallel)
    return { lines: [{ from: lastPoint, to: this.currentPoint, color: this.inferenceColor ?? undefined }] };
  }

  // ── Private ────────────────────────────────────────────

  private getDrawPoint(event: ToolMouseEvent): Vec3 | null {
    const anchor = this.points.length > 0 ? this.points[this.points.length - 1] : undefined;

    // If axis-locked, project the camera ray onto the locked axis
    if (this.axisLock && anchor) {
      const ray = this.viewport.camera.screenToRay(
        event.screenX, event.screenY,
        this.viewport.getWidth(), this.viewport.getHeight(),
      );
      return this.projectRayOntoAxis(ray, anchor, this.axisLock);
    }

    // Locked face plane (set when the first click landed on a face).
    // Prefer the snapped worldPoint when it lies ON that plane (e.g. snapping
    // to a vertex on the face) — otherwise raycast cursor onto the locked plane.
    if (this.lockedFacePlane) {
      if (event.worldPoint && this.pointOnPlane(event.worldPoint, this.lockedFacePlane, 0.01)) {
        return event.worldPoint;
      }
      const onPlane = this.raycastOntoPlane(this.lockedFacePlane, event.screenX, event.screenY);
      if (onPlane) return onPlane;
    }

    // Use snapped worldPoint if available (includes vertices AND midpoints)
    if (event.worldPoint) return event.worldPoint;

    // Fallback: raycast onto drawing plane
    const planePoint = this.screenToDrawingPlane(event, anchor);
    if (planePoint) return planePoint;

    return null;
  }

  private pointOnPlane(p: Vec3, plane: Plane, tol: number): boolean {
    const d = p.x * plane.normal.x + p.y * plane.normal.y + p.z * plane.normal.z;
    return Math.abs(d - plane.distance) < tol;
  }

  private reset(): void {
    this.points = [];
    this.vertexIds = [];
    this.currentPoint = null;
    this.axisLock = null;
    this.lockedFacePlane = null;
    this.clearDirectionInference();
    this.setPhase('idle');
    this.setVCBValue('');
  }

  private updateVCBFromSegment(): void {
    if (this.points.length >= 2) {
      const a = this.points[this.points.length - 2];
      const b = this.points[this.points.length - 1];
      this.setVCBValue(this.formatDist(vec3.distance(a, b)));
    }
  }

  private tryCreateFace(): void {
    if (this.vertexIds.length < 3) return;
    const uniqueIds = this.vertexIds.slice(0, -1);
    if (this.document.geometry.checkCoplanar(uniqueIds)) {
      try {
        this.document.geometry.createFace(uniqueIds);
      } catch (e) { console.warn('[LineTool.tryCreateFace] createFace failed:', e); }
    }
  }

  // Parallel + axis inference now live in BaseTool.applyDirectionInference.
}
