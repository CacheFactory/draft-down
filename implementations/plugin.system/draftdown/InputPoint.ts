// @archigraph plugin.system.draftdown.input-point
// DraftDown.InputPoint — an inference helper used by custom tools.
// Reference: 

import type { IViewport, IInferenceEngine, IGeometryEngine } from '../../../src/core/interfaces';
import type { Vec3, InferenceType, InferenceResult } from '../../../src/core/types';
import { Entity, EntityContext, Edge, Face, Vertex } from './Entity';
import { Point3d, Vector3d } from './Geom';

export class InputPoint {
  private _position: Point3d = new Point3d();
  private _depth = 0;
  private _displayed = false;
  private _degrees: number[] = [];
  private _vertex: Vertex | null = null;
  private _edge: Edge | null = null;
  private _face: Face | null = null;
  private _tooltip = '';
  private _inferenceType: InferenceType | null = null;

  constructor(private viewport: IViewport, private inference: IInferenceEngine, private geo: IGeometryEngine, private ctx: EntityContext) {}

  /** InputPoint#pick(view, x, y, inputpoint=nil) — runs picking + inference at (x,y). */
  pick(_view: unknown, x: number, y: number): boolean {
    const w = this.viewport.getWidth(); const h = this.viewport.getHeight();
    const ray = this.viewport.camera.screenToRay(x, y, w, h);
    const ctx = { recentPoints: [] as Vec3[], recentEdges: [] as { start: Vec3; end: Vec3 }[], axisLock: null as null | 'x' | 'y' | 'z', activeToolId: 'plugin.tool' };
    const inf: InferenceResult | null = this.inference.findInference({ x, y }, ray, ctx);
    if (inf) {
      this._position = new Point3d(inf.point.x, inf.point.y, inf.point.z);
      this._inferenceType = inf.type;
      this._tooltip = inf.tooltip ?? '';
    } else {
      // Fall back to nearest scene hit
      const hits = this.viewport.raycastScene(x, y);
      if (hits.length > 0) {
        this._position = new Point3d(hits[0].point.x, hits[0].point.y, hits[0].point.z);
        this._inferenceType = 'on-face';
        this._tooltip = '';
      } else {
        // No hit: extrapolate ray at depth 1
        this._position = new Point3d(ray.origin.x + ray.direction.x, ray.origin.y + ray.direction.y, ray.origin.z + ray.direction.z);
        this._inferenceType = null;
      }
    }
    // Resolve underlying entities at the picked point
    this.resolveEntities(x, y);
    this._displayed = true;
    return true;
  }

  /** InputPoint#position */
  position(): Point3d { return new Point3d(this._position); }
  /** InputPoint#depth */
  depth(): number { return this._depth; }
  /** InputPoint#displayed? */
  displayed(): boolean { return this._displayed; }

  /** InputPoint#tooltip */
  tooltip(): string { return this._tooltip; }

  /** InputPoint#degrees_of_freedom */
  degreesOfFreedom(): number[] { return this._degrees.slice(); }

  /** InputPoint#vertex / #edge / #face — underlying entities, if any. */
  vertex(): Vertex | null { return this._vertex; }
  edge(): Edge | null { return this._edge; }
  face(): Face | null { return this._face; }

  /** InputPoint#valid? */
  valid(): boolean { return this._displayed; }

  /** InputPoint#draw(view) — rendered automatically by the inference engine; no-op here. */
  draw(_view: unknown): void { /* SU semantics: draw the inference indicator */ }

  /** InputPoint#copy! / clear */
  copy(other: InputPoint): InputPoint {
    this._position = new Point3d(other._position); this._depth = other._depth; this._displayed = other._displayed;
    this._tooltip = other._tooltip; this._inferenceType = other._inferenceType;
    this._vertex = other._vertex; this._edge = other._edge; this._face = other._face;
    return this;
  }
  clear(): void { this._displayed = false; this._inferenceType = null; this._vertex = null; this._edge = null; this._face = null; }

  /** Underlying inference result type if any. */
  inferenceType(): InferenceType | null { return this._inferenceType; }

  /** InputPoint#instance_path — DraftDown has a flat hierarchy, return empty array. */
  instancePath(): Entity[] { return []; }

  // ── helpers ──────────────────────────────────────────────────

  private resolveEntities(x: number, y: number): void {
    const hits = this.viewport.raycastScene(x, y);
    this._vertex = null; this._edge = null; this._face = null;
    for (const h of hits) {
      if (this.geo.getFace(h.entityId)) { this._face = new Face(h.entityId, this.ctx); break; }
      if (this.geo.getEdge(h.entityId)) { this._edge = new Edge(h.entityId, this.ctx); }
      if (this.geo.getVertex(h.entityId)) { this._vertex = new Vertex(h.entityId, this.ctx); }
    }
  }

  /** Convenience: produce a Vector3d direction the user is constraining to. */
  direction(): Vector3d {
    if (this._inferenceType === 'on-axis-x') return new Vector3d(1, 0, 0);
    if (this._inferenceType === 'on-axis-y') return new Vector3d(0, 1, 0);
    if (this._inferenceType === 'on-axis-z') return new Vector3d(0, 0, 1);
    return new Vector3d();
  }
}
