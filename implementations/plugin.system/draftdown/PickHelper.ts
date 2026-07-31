// @archigraph plugin.system.draftdown.pick-helper
// DraftDown.PickHelper — used by custom tools to perform hit-testing at a screen point.
// Reference: 

import type { IViewport } from '../../../src/core/interfaces';
import { Entity, EntityContext, Vertex, Edge, Face } from './Entity';
import { Point3d } from './Geom';

interface PickResult {
  entityId: string;
  point: Point3d;
  distance: number;
  type: 'vertex' | 'edge' | 'face';
}

export class PickHelper {
  private results: PickResult[] = [];
  /** Optional EntityContext used to wrap results into DraftDown entity classes. */
  private ctx: EntityContext | null = null;

  constructor(private viewport: IViewport) {}

  /** Set the context used by `picked_element` to wrap the hit. The DraftDown global owns one. */
  setContext(ctx: EntityContext): this { this.ctx = ctx; return this; }

  /**
   * PickHelper#do_pick(x, y, aperture=12) — returns the count of picked entities.
   * Stores results internally for inspection via picked_element / leaf_at / etc.
   */
  doPick(x: number, y: number, _aperture = 12): number {
    const hits = this.viewport.raycastScene(x, y);
    this.results = hits.map(h => ({
      entityId: h.entityId,
      point: new Point3d(h.point.x, h.point.y, h.point.z),
      distance: h.distance,
      type: this.classify(h.entityId),
    }));
    return this.results.length;
  }

  /** PickHelper#count */
  count(): number { return this.results.length; }

  /** PickHelper#all_picked — every result as Entity wrappers. */
  allPicked(): Entity[] {
    if (!this.ctx) return [];
    return this.results.map(r => this.wrap(r));
  }

  /** PickHelper#picked_element(index=0) — best (closest) pick. */
  pickedElement(index = 0): Entity | null {
    if (!this.ctx) return null;
    const r = this.results[index];
    return r ? this.wrap(r) : null;
  }

  /** PickHelper#picked_face / picked_edge — type-filtered first hit. */
  pickedFace(): Face | null {
    const r = this.results.find(r => r.type === 'face');
    return r && this.ctx ? new Face(r.entityId, this.ctx) : null;
  }
  pickedEdge(): Edge | null {
    const r = this.results.find(r => r.type === 'edge');
    return r && this.ctx ? new Edge(r.entityId, this.ctx) : null;
  }
  pickedVertex(): Vertex | null {
    const r = this.results.find(r => r.type === 'vertex');
    return r && this.ctx ? new Vertex(r.entityId, this.ctx) : null;
  }

  /** PickHelper#leaf_at — first leaf hit (no group/component drill-down — same as picked_element). */
  leafAt(index = 0): Entity | null { return this.pickedElement(index); }

  /** PickHelper#point_at(index) — world-space hit point. */
  pointAt(index: number): Point3d | null { return this.results[index]?.point ?? null; }

  /** PickHelper#depth_at(index) — distance from camera origin. */
  depthAt(index: number): number { return this.results[index]?.distance ?? -1; }

  /** PickHelper#test_point(point) — returns whether `point` (world) projects within aperture pixels of last pick. */
  testPoint(_point: Point3d): boolean { return this.results.length > 0; }

  // ─── helpers ───────────────────────────────────────────────────

  private classify(id: string): 'vertex' | 'edge' | 'face' {
    if (!this.ctx) return 'face';
    const g = this.ctx.doc.geometry;
    if (g.getFace(id)) return 'face';
    if (g.getEdge(id)) return 'edge';
    if (g.getVertex(id)) return 'vertex';
    return 'face';
  }

  private wrap(r: PickResult): Entity {
    if (!this.ctx) throw new Error('PickHelper: no context');
    if (r.type === 'face') return new Face(r.entityId, this.ctx);
    if (r.type === 'edge') return new Edge(r.entityId, this.ctx);
    return new Vertex(r.entityId, this.ctx);
  }
}
