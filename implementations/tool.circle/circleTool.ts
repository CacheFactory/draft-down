// @archigraph tool.circle
// Circle tool: click center, move for radius, creates polygon approximation

import type { Vec3, Plane } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { planeBasis } from '../tool.base/planeGeometry';
import { v4 as uuid } from 'uuid';

export class CircleTool extends BaseTool {
  readonly id = 'tool.circle';
  readonly name = 'Circle';
  readonly icon = 'circle';
  readonly shortcut = 'C';
  readonly category = 'draw' as const;
  readonly cursor = 'crosshair';

  private center: Vec3 | null = null;
  private drawPlane: Plane = { normal: { x: 0, y: 1, z: 0 }, distance: 0 };
  private segments = 24;
  private currentRadius = 0;

  activate(): void {
    super.activate();
    this.reset();
    this.setStatus(`Click to place center. Segments: ${this.segments}`);
  }

  deactivate(): void {
    if (this.phase !== 'idle') this.abortTransaction();
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    if (this.phase === 'idle') {
      const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
      if (!point) return;

      this.center = point;
      this.beginTransaction('Draw Circle');
      // Use the hovered face's plane if the user clicked on a face.
      this.drawPlane = this.getEffectiveDrawingPlane(event, this.center);
      this.setPhase('drawing');
      this.setStatus('Move to set radius, then click. Arrow keys change plane.');
    } else if (this.phase === 'drawing') {
      this.createCircle(this.currentRadius);
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase !== 'drawing' || !this.center) return;
    // Project onto the locked drawing plane (face plane if first click was on a face,
    // otherwise the axis plane), honoring a hard snap so the radius lands exactly
    // on the snapped point the indicator shows. screenToDrawingPlane would re-derive
    // from the cursor's current hit and snap back to the ground plane the moment the
    // cursor leaves the face.
    const point = this.getPlanePointHonoringSnap(event, this.drawPlane)
      ?? this.resolvePoint(event);
    if (!point) return;

    const projected = vec3.projectOnPlane(point, this.drawPlane);
    this.currentRadius = vec3.distance(this.center, projected);
    this.setVCBValue(this.formatDist(this.currentRadius));
  }

  onKeyDown(event: ToolKeyEvent): void {
    // Arrow keys change drawing plane
    if (this.handleArrowKeyPlane(event)) {
      if (this.center) {
        this.drawPlane = this.getDrawingPlane(this.center);
      }
      return;
    }

    if (event.key === 'Escape') {
      if (this.phase !== 'idle') this.abortTransaction();
      this.reset();
      this.setStatus(`Click to place center. Segments: ${this.segments}`);
    }
  }

  onVCBInput(value: string): void {
    if (this.tryRedoLastOp(value)) return;
    const trimmed = value.trim();

    // Check if it's a segment count (e.g., "24s")
    if (trimmed.endsWith('s')) {
      const segs = parseInt(trimmed.slice(0, -1), 10);
      if (!isNaN(segs) && segs >= 3) {
        this.segments = segs;
        this.setStatus(`Segments set to ${this.segments}`);
        return;
      }
    }

    if (this.phase !== 'drawing' || !this.center) return;

    const radius = this.parseDistance(value);
    if (isNaN(radius) || radius <= 0) return;

    this.createCircle(radius);
  }

  getVCBLabel(): string {
    return this.phase === 'drawing' ? 'Radius' : 'Sides';
  }

  getPreview(): ToolPreview | null {
    if (this.phase !== 'drawing' || !this.center || this.currentRadius <= 0) return null;

    const { tangent, bitangent } = planeBasis(this.drawPlane.normal);

    const points: Vec3[] = [];
    for (let i = 0; i < this.segments; i++) {
      const angle = (2 * Math.PI * i) / this.segments;
      const offset = vec3.add(
        vec3.mul(tangent, Math.cos(angle) * this.currentRadius),
        vec3.mul(bitangent, Math.sin(angle) * this.currentRadius),
      );
      points.push(vec3.add(this.center, offset));
    }

    return { polygon: points };
  }

  // ── Private ────────────────────────────────────────────

  private reset(): void {
    this.center = null;
    this.currentRadius = 0;
    this.setPhase('idle');
    this.setVCBValue('');
  }

  private createCircle(radius: number): void {
    if (!this.center || radius <= 0) return;

    // Segment chords must stay above the engine's weld tolerance (0.001) or
    // adjacent vertices weld onto each other's segments and the ring
    // degenerates (tiny blob at the center point instead of a circle).
    const chord = 2 * radius * Math.sin(Math.PI / this.segments);
    if (chord < 0.003) {
      this.abortTransaction();
      this.reset();
      this.setStatus(`Radius too small for ${this.segments} segments — increase the radius or reduce segments.`);
      return;
    }

    const vertexIds: string[] = [];

    // Compute local axes on the plane
    const { tangent, bitangent } = planeBasis(this.drawPlane.normal);

    for (let i = 0; i < this.segments; i++) {
      const angle = (2 * Math.PI * i) / this.segments;
      const offset = vec3.add(
        vec3.mul(tangent, Math.cos(angle) * radius),
        vec3.mul(bitangent, Math.sin(angle) * radius),
      );
      const point = vec3.add(this.center, offset);
      const vertex = this.document.geometry.createVertex(point);
      vertexIds.push(vertex.id);
    }

    // Create edges with intersection detection, grouped as a curve
    const curveId = uuid();
    for (let i = 0; i < this.segments; i++) {
      const next = (i + 1) % this.segments;
      const edges = this.document.geometry.createEdgeWithIntersection(vertexIds[i], vertexIds[next]);
      for (const edge of edges) edge.curveId = curveId;
    }

    // classic CAD coplanar merge: if the circle crosses existing faces, split
    // them along the ring instead of stacking a full circle face on top.
    const splits = this.document.geometry.splitFacesWithClosedRing(vertexIds);

    if (splits === 0) {
      // Explicitly create the face — autoCreateFaces BFS can't find loops
      // longer than its maxDepth, so we create it directly since we know
      // these vertices form a closed coplanar polygon.
      try {
        this.document.geometry.createFace(vertexIds);
      } catch (e) {
        console.warn('[CircleTool] createFace failed (likely edges split by intersections):', e);
      }
    }

    const center = { ...this.center };
    const plane = { normal: { ...this.drawPlane.normal }, distance: this.drawPlane.distance };

    this.commitTransaction();
    this.reset();
    this.setStatus(`Circle created. Click to place center, or type a radius to redo. Segments: ${this.segments}`);

    this.redoLastOp = (value: string) => {
      // Allow "32s" post-commit to rebuild with a different segment count
      let newRadius = radius;
      const trimmed = value.trim();
      if (trimmed.endsWith('s')) {
        const segs = parseInt(trimmed.slice(0, -1), 10);
        if (isNaN(segs) || segs < 3) return false;
        this.segments = segs;
      } else {
        const r = this.parseDistance(trimmed);
        if (isNaN(r) || r <= 0) return false;
        newRadius = r;
      }
      this.document.history.undo();
      this.center = { ...center };
      this.drawPlane = { normal: { ...plane.normal }, distance: plane.distance };
      this.beginTransaction('Draw Circle');
      this.createCircle(newRadius);
      return true;
    };
  }
}
