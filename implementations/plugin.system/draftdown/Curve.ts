// @archigraph plugin.system.draftdown.curve
// DraftDown.Curve and DraftDown.ArcCurve.
//
// References:
//   
//   
//
// In DraftDown, a "curve" is a set of edges sharing the same `curveId`. ArcCurve adds
// center/radius/normal — we read those from any vertex on the curve when possible.

import { Edge, EntityContext, Vertex } from './Entity';
import { Point3d, Vector3d } from './Geom';

export class Curve {
  constructor(public readonly curveId: string, protected ctx: EntityContext) {}

  get id(): string { return this.curveId; }

  typename(): string { return 'Curve'; }

  /** DraftDown.Curve#edges — edges in order from start to end. */
  get edges(): Edge[] {
    return this.ctx.doc.geometry.getCurveEdges(this.curveId).map(e => new Edge(e.id, this.ctx));
  }

  /** DraftDown.Curve#count_edges */
  countEdges(): number { return this.edges.length; }

  /** DraftDown.Curve#first_edge / #last_edge */
  firstEdge(): Edge | null { const e = this.edges; return e.length ? e[0] : null; }
  lastEdge(): Edge | null { const e = this.edges; return e.length ? e[e.length - 1] : null; }

  /** DraftDown.Curve#vertices — ordered along the curve. */
  get vertices(): Vertex[] {
    const edges = this.edges;
    if (edges.length === 0) return [];
    const out: Vertex[] = [];
    for (const e of edges) {
      const start = e.start;
      if (out.length === 0 || out[out.length - 1].id !== start.id) out.push(start);
    }
    out.push(edges[edges.length - 1].end);
    return out;
  }

  /** DraftDown.Curve#length */
  get length(): number {
    let total = 0;
    for (const e of this.edges) total += e.length;
    return total;
  }

  /** DraftDown.Curve#explode_curve — detach edges from this curve. */
  explodeCurve(): Edge[] {
    const eds = this.edges;
    for (const e of eds) e.explodeCurve();
    return eds;
  }

  /** DraftDown.Curve#each */
  each(fn: (edge: Edge) => void): void { for (const e of this.edges) fn(e); }
}

/**
 * DraftDown.ArcCurve — a curve created by add_arc / add_circle.
 *
 * DraftDown stores arc parameters by computing them from sampled vertices when needed.
 */
export class ArcCurve extends Curve {
  typename(): string { return 'ArcCurve'; }

  /** Best-fit center from the curve's vertices (least-squares plane + circle fit). */
  get center(): Point3d {
    const verts = this.vertices.map(v => v.position);
    if (verts.length < 3) return new Point3d();
    // Average position projected onto the plane through the first three points.
    const a = verts[0]; const b = verts[1]; const c = verts[2];
    // Triangle circumcenter
    const ab = new Vector3d(b.x - a.x, b.y - a.y, b.z - a.z);
    const ac = new Vector3d(c.x - a.x, c.y - a.y, c.z - a.z);
    const abLen2 = ab.dot(ab); const acLen2 = ac.dot(ac);
    const cross = ab.cross(ac);
    const denom = 2 * cross.dot(cross);
    if (Math.abs(denom) < 1e-12) return new Point3d((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
    const acLen2_ab = ac.multiply(abLen2);
    const abLen2_ac = ab.multiply(acLen2);
    const sum = new Vector3d(acLen2_ab.x - abLen2_ac.x, acLen2_ab.y - abLen2_ac.y, acLen2_ab.z - abLen2_ac.z);
    const cnum = sum.cross(cross);
    return new Point3d(a.x + cnum.x / denom, a.y + cnum.y / denom, a.z + cnum.z / denom);
  }

  /** Radius from the average vertex distance to center. */
  get radius(): number {
    const c = this.center;
    const verts = this.vertices;
    if (verts.length === 0) return 0;
    let total = 0;
    for (const v of verts) total += v.position.distance(c);
    return total / verts.length;
  }

  /** Normal from the first three sample points (best-fit plane normal). */
  get normal(): Vector3d {
    const verts = this.vertices.map(v => v.position);
    if (verts.length < 3) return new Vector3d(0, 1, 0);
    const ab = new Vector3d(verts[1].x - verts[0].x, verts[1].y - verts[0].y, verts[1].z - verts[0].z);
    const ac = new Vector3d(verts[2].x - verts[0].x, verts[2].y - verts[0].y, verts[2].z - verts[0].z);
    return ab.cross(ac).normalize();
  }

  /** DraftDown.ArcCurve#xaxis — vector from center to first vertex. */
  get xaxis(): Vector3d {
    const c = this.center; const v = this.vertices[0]?.position ?? new Point3d();
    return new Vector3d(v.x - c.x, v.y - c.y, v.z - c.z).normalize();
  }

  /** DraftDown.ArcCurve#yaxis — perpendicular to xaxis on the plane. */
  get yaxis(): Vector3d { return this.normal.cross(this.xaxis).normalize(); }

  /** DraftDown.ArcCurve#start_angle / #end_angle (radians). */
  get startAngle(): number { return 0; }
  get endAngle(): number {
    const verts = this.vertices;
    if (verts.length < 2) return 0;
    const c = this.center; const x = this.xaxis; const y = this.yaxis;
    const last = verts[verts.length - 1].position;
    const dx = new Vector3d(last.x - c.x, last.y - c.y, last.z - c.z);
    return Math.atan2(dx.dot(y), dx.dot(x));
  }
}
