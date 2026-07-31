// @archigraph tool.rectangle
// Rectangle tool: click two corners, live preview, creates 4 edges and 1 face.
// Arrow keys change the drawing plane mid-draw.

import type { Vec3, Plane } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool, DRAWING_PLANES } from '../tool.base/BaseTool';
import { customAxes } from '../tool.axes/CustomAxes';

export class RectangleTool extends BaseTool {
  readonly id = 'tool.rectangle';
  readonly name = 'Rectangle';
  readonly icon = 'square';
  readonly shortcut = 'R';
  readonly category = 'draw' as const;
  readonly cursor = 'crosshair';

  private firstCorner: Vec3 | null = null;
  private drawPlane: Plane = { normal: { x: 0, y: 1, z: 0 }, distance: 0 };
  private currentCorner: Vec3 | null = null;
  // Store last screen position so we can recompute on plane change
  private lastScreenX = 0;
  private lastScreenY = 0;

  activate(): void {
    super.activate();
    this.reset();
    this.setStatus('Click to place first corner. Arrow keys change plane.');
  }

  deactivate(): void {
    if (this.phase !== 'idle') this.abortTransaction();
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.lastScreenX = event.screenX;
    this.lastScreenY = event.screenY;

    if (this.phase === 'idle') {
      // Prefer snapped point, then ray-plane, then ground plane
      const point = this.bestPoint(event);
      if (!point) return;

      this.firstCorner = point;
      this.beginTransaction('Draw Rectangle');
      // Lock to the hovered face's plane if the user clicked on a face;
      // otherwise fall back to the active axis-based plane.
      this.drawPlane = this.getEffectiveDrawingPlane(event, this.firstCorner);
      this.setPhase('drawing');
      this.setStatus('Move to size, click to place. Arrow keys change plane.');
    } else if (this.phase === 'drawing') {
      // Second corner: SAME resolution as the preview/snap indicator — a hard
      // snap wins (projected onto the locked plane), else plane raycast, then
      // the same proportion inference the preview showed. Anything else
      // commits geometry that differs from what the user saw.
      const point = this.resolveSecondCorner(event);
      if (!point) return;
      this.createRectangle(point);
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase !== 'drawing' || !this.firstCorner) return;
    this.lastScreenX = event.screenX;
    this.lastScreenY = event.screenY;

    const point = this.resolveSecondCorner(event);
    if (point) {
      this.currentCorner = point;
      const dims = this.computeDimensions();
      this.setVCBValue(`${this.formatDist(dims.w)}, ${this.formatDist(dims.h)}`);
    }
  }

  /** Resolve the second corner exactly as displayed: snap-honoring plane
   *  point; proportion inference only when NOT hard-snapped (a snap beats
   *  Square/Golden Section, like classic CAD tools). */
  private resolveSecondCorner(event: ToolMouseEvent): Vec3 | null {
    const point = this.getPlanePointHonoringSnap(event, this.drawPlane);
    if (!point) return null;
    if (this.isHardSnap(event)) {
      this.inferenceLabel = null;
      this.viewport.renderer.removeGuideLine(RectangleTool.PROPORTION_GUIDE_ID);
      return point;
    }
    return this.applyProportionInference(point);
  }

  /** classic CAD proportion inference: when the rectangle is close to a square
   *  or a golden section, snap to it exactly, show the dotted diagonal, and
   *  label the hint near the cursor. */
  private applyProportionInference(point: Vec3): Vec3 {
    this.inferenceLabel = null;
    this.viewport.renderer.removeGuideLine(RectangleTool.PROPORTION_GUIDE_ID);
    if (!this.firstCorner) return point;

    const { axis1, axis2 } = this.getPlaneAxes();
    const diag = vec3.sub(point, this.firstCorner);
    const d1 = vec3.dot(diag, axis1);
    const d2 = vec3.dot(diag, axis2);
    const w = Math.abs(d1);
    const h = Math.abs(d2);
    if (w < 0.05 || h < 0.05) return point;

    const PHI = 1.618033988749;
    const tol = 0.04 * Math.max(w, h);
    let newW = w, newH = h, label: string | null = null;

    if (Math.abs(w - h) < tol) {
      newW = newH = (w + h) / 2;
      label = 'Square';
    } else if (Math.abs(w - h * PHI) < tol) {
      newW = h * PHI;
      label = 'Golden Section';
    } else if (Math.abs(h - w * PHI) < tol) {
      newH = w * PHI;
      label = 'Golden Section';
    }
    if (!label) return point;

    const snapped = vec3.add(
      vec3.add(this.firstCorner, vec3.mul(axis1, newW * Math.sign(d1 || 1))),
      vec3.mul(axis2, newH * Math.sign(d2 || 1)),
    );
    this.inferenceLabel = label;
    this.viewport.renderer.addGuideLine(
      RectangleTool.PROPORTION_GUIDE_ID, this.firstCorner, snapped,
      { r: 0.35, g: 0.35, b: 0.35 }, true, { selectable: false, opacity: 0.7 },
    );
    return snapped;
  }

  private static readonly PROPORTION_GUIDE_ID = 'rect-proportion-guide';

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.phase !== 'idle') this.abortTransaction();
      this.reset();
      this.setStatus('Click to place first corner. Arrow keys change plane.');
      return;
    }

    // Arrow keys change the drawing plane
    if (this.handleArrowKeyPlane(event)) {
      if (this.firstCorner) {
        // The plane passes through the firstCorner point
        this.drawPlane = this.getDrawingPlane(this.firstCorner);
        // Clear current corner — user needs to move mouse to set it on the new plane
        this.currentCorner = null;
        // Try to recompute from stored screen position
        const point = this.raycastDrawingPlane(this.lastScreenX, this.lastScreenY);
        if (point) this.currentCorner = point;
      }
      const info = DRAWING_PLANES[this.drawingPlaneAxis];
      this.setStatus(`Plane: ${info.label}. Move to size, click to place.`);
    }
  }

  onVCBInput(value: string): void {
    if (this.tryRedoLastOp(value)) return;
    if (this.phase !== 'drawing' || !this.firstCorner) return;
    const dims = this.parseDimensions(value);
    if (dims.length < 2 || dims.some(n => isNaN(n))) return;
    const [width, height] = dims;
    const corner = this.computeOppositeCorner(width, height);
    this.createRectangle(corner);
  }

  getVCBLabel(): string {
    return this.phase === 'drawing' ? 'Dimensions' : '';
  }

  getPreview(): ToolPreview | null {
    if (this.phase !== 'drawing' || !this.firstCorner || !this.currentCorner) return null;
    const dims = this.computeDimensions();
    // Don't show preview if degenerate (would look like a triangle/line)
    if (dims.w < 0.001 || dims.h < 0.001) {
      // Show just a line from firstCorner to currentCorner
      return { lines: [{ from: this.firstCorner, to: this.currentCorner }] };
    }
    const corners = this.computeCorners(this.firstCorner, this.currentCorner);
    return { polygon: corners };
  }

  // ── Private ────────────────────────────────────────────

  private reset(): void {
    this.inferenceLabel = null;
    this.viewport.renderer.removeGuideLine(RectangleTool.PROPORTION_GUIDE_ID);
    this.firstCorner = null;
    this.currentCorner = null;
    this.drawPlane = this.getDrawingPlane({ x: 0, y: 0, z: 0 });
    this.setPhase('idle');
    this.setVCBValue('');
  }

  /** Get the best world point: snapped > ray-on-plane > ground plane. */
  private bestPoint(event: ToolMouseEvent): Vec3 | null {
    // 1. Snapped point (from getToolEvent's snap detection)
    if (event.worldPoint) return event.worldPoint;
    // 2. Ray-plane intersection
    return this.raycastDrawingPlane(event.screenX, event.screenY);
  }

  /** Raycast from screen coordinates onto the current drawing plane. */
  private raycastDrawingPlane(screenX: number, screenY: number): Vec3 | null {
    return this.raycastOntoPlane(this.drawPlane, screenX, screenY);
  }

  /** Recompute currentCorner from stored screen position and current plane. */
  private updateCurrentCorner(): void {
    const point = this.raycastDrawingPlane(this.lastScreenX, this.lastScreenY);
    if (point) {
      this.currentCorner = point;
      const dims = this.computeDimensions();
      this.setVCBValue(`${this.formatDist(dims.w)}, ${this.formatDist(dims.h)}`);
    }
  }

  /** Get two orthogonal axes on the current drawing plane, respecting custom axes. */
  private getPlaneAxes(): { axis1: Vec3; axis2: Vec3 } {
    const n = this.drawPlane.normal;

    if (customAxes.isCustom) {
      const ca = customAxes.current!;
      // Pick the two custom axes that are most perpendicular to the plane normal
      const dotX = Math.abs(vec3.dot(n, ca.xAxis));
      const dotY = Math.abs(vec3.dot(n, ca.yAxis));
      const dotZ = Math.abs(vec3.dot(n, ca.zAxis));

      if (dotY >= dotX && dotY >= dotZ) {
        // Normal is closest to custom Y — use custom X and Z
        return { axis1: { ...ca.xAxis }, axis2: { ...ca.zAxis } };
      } else if (dotX >= dotY && dotX >= dotZ) {
        // Normal is closest to custom X — use custom Z and Y
        return { axis1: { ...ca.zAxis }, axis2: { ...ca.yAxis } };
      } else {
        // Normal is closest to custom Z — use custom X and Y
        return { axis1: { ...ca.xAxis }, axis2: { ...ca.yAxis } };
      }
    }

    // Axis-aligned planes: pick world axes that lie in the plane.
    if (Math.abs(n.y) > 0.9) {
      return { axis1: { x: 1, y: 0, z: 0 }, axis2: { x: 0, y: 0, z: 1 } };
    } else if (Math.abs(n.x) > 0.9) {
      return { axis1: { x: 0, y: 0, z: 1 }, axis2: { x: 0, y: 1, z: 0 } };
    } else if (Math.abs(n.z) > 0.9) {
      return { axis1: { x: 1, y: 0, z: 0 }, axis2: { x: 0, y: 1, z: 0 } };
    }
    // Arbitrary plane (e.g. snapped to a slanted face): build two orthogonal
    // axes that LIE IN the plane. World axes here wouldn't — corners would get
    // pushed off the plane along world directions.
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const ref: Vec3 = (ax <= ay && ax <= az) ? { x: 1, y: 0, z: 0 }
                    : (ay <= az) ? { x: 0, y: 1, z: 0 }
                    : { x: 0, y: 0, z: 1 };
    const axis1 = vec3.normalize(vec3.cross(n, ref));
    const axis2 = vec3.normalize(vec3.cross(n, axis1));
    return { axis1, axis2 };
  }

  private computeCorners(p1: Vec3, p3: Vec3): Vec3[] {
    const { axis1, axis2 } = this.getPlaneAxes();
    const diag = vec3.sub(p3, p1);
    const d1 = vec3.dot(diag, axis1);
    const d2 = vec3.dot(diag, axis2);
    const p2 = vec3.add(p1, vec3.mul(axis1, d1));
    const p4 = vec3.add(p1, vec3.mul(axis2, d2));
    return [p1, p2, p3, p4];
  }

  private computeOppositeCorner(width: number, height: number): Vec3 {
    if (!this.firstCorner) return { x: 0, y: 0, z: 0 };
    const { axis1, axis2 } = this.getPlaneAxes();

    // Use the cursor direction to determine sign of each dimension
    let sign1 = 1, sign2 = 1;
    if (this.currentCorner && this.firstCorner) {
      const diag = vec3.sub(this.currentCorner, this.firstCorner);
      if (vec3.dot(diag, axis1) < 0) sign1 = -1;
      if (vec3.dot(diag, axis2) < 0) sign2 = -1;
    }

    return vec3.add(
      vec3.add(this.firstCorner, vec3.mul(axis1, width * sign1)),
      vec3.mul(axis2, height * sign2),
    );
  }

  private computeDimensions(): { w: number; h: number } {
    if (!this.firstCorner || !this.currentCorner) return { w: 0, h: 0 };
    const { axis1, axis2 } = this.getPlaneAxes();
    const diag = vec3.sub(this.currentCorner, this.firstCorner);
    return {
      w: Math.abs(vec3.dot(diag, axis1)),
      h: Math.abs(vec3.dot(diag, axis2)),
    };
  }

  private createRectangle(oppositeCorner: Vec3): void {
    if (!this.firstCorner) return;

    const corners = this.computeCorners(this.firstCorner, oppositeCorner);
    const [p1, p2, p3, p4] = corners;

    // Check the rectangle has non-zero width AND height (not degenerate)
    const { axis1, axis2 } = this.getPlaneAxes();
    const diag = vec3.sub(oppositeCorner, this.firstCorner);
    const w = Math.abs(vec3.dot(diag, axis1));
    const h = Math.abs(vec3.dot(diag, axis2));
    if (w < 0.001 || h < 0.001) {
      this.abortTransaction();
      this.reset();
      this.setStatus('Rectangle too small. Click to place first corner.');
      return;
    }

    const v1 = this.findOrCreateVertex(p1);
    const v2 = this.findOrCreateVertex(p2);
    const v3 = this.findOrCreateVertex(p3);
    const v4 = this.findOrCreateVertex(p4);

    // Use createEdgeWithIntersection to detect and split existing face boundaries
    this.document.geometry.createEdgeWithIntersection(v1.id, v2.id);
    this.document.geometry.createEdgeWithIntersection(v2.id, v3.id);
    this.document.geometry.createEdgeWithIntersection(v3.id, v4.id);
    this.document.geometry.createEdgeWithIntersection(v4.id, v1.id);

    // classic CAD coplanar merge: a rectangle that crosses or touches existing
    // faces splits them along its outline (door on a wall, overlapping
    // rectangles, …). The engine expands the corner ring with the
    // intersection vertices created above and splits every crossed face,
    // so faces on the same plane never overlap.
    this.document.geometry.splitFacesWithClosedRing([v1.id, v2.id, v3.id, v4.id]);

    // Capture enough to re-do this rectangle with newly typed dimensions
    const anchor = { ...this.firstCorner };
    const plane = { normal: { ...this.drawPlane.normal }, distance: this.drawPlane.distance };
    const dirHint = { ...oppositeCorner };

    this.commitTransaction();
    this.reset();
    this.setStatus('Rectangle created. Click to place first corner. Type W,H to redo.');

    this.redoLastOp = (value: string) => {
      const dims = this.parseDimensions(value);
      if (dims.length < 2 || dims.some(n => isNaN(n) || n <= 0)) return false;
      this.document.history.undo();
      this.firstCorner = { ...anchor };
      this.drawPlane = { normal: { ...plane.normal }, distance: plane.distance };
      this.currentCorner = { ...dirHint }; // preserves the original diagonal direction
      this.beginTransaction('Draw Rectangle');
      this.createRectangle(this.computeOppositeCorner(dims[0], dims[1]));
      return true;
    };
  }
}
