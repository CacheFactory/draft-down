// @archigraph plugin.system.draftdown.entities
// DraftDown.Entities — the geometry collection for a Model or Group.
//
// Reference: 
//
// Every method that mutates geometry routes through ModelAPI so it gets a transaction
// and a scene sync. Reads go straight to the geometry engine.

import type { Vec3 } from '../../../src/core/types';
import type { IFace, IEdge, IVertex } from '../../../src/core/interfaces';
import { Entity, EntityContext, Vertex, Edge, Face } from './Entity';
import { Group, ComponentInstance, ComponentDefinition } from './Group';
import { Point3d, Vector3d, Transformation, Point3dLike, Vector3dLike } from './Geom';

export type AnyEntity = Entity | Group | ComponentInstance;

export interface EntitiesObserver {
  onElementAdded?(entities: Entities, entity: Entity): void;
  onElementModified?(entities: Entities, entity: Entity): void;
  onElementRemoved?(entities: Entities, entity_id: string): void;
  onContentsModified?(entities: Entities): void;
  onActiveSectionPlaneChanged?(entities: Entities): void;
}
type EntitiesObserverFn = EntitiesObserver;

function asVec3(p: Point3dLike): Vec3 {
  if (p instanceof Point3d) return p.toVec3();
  if (Array.isArray(p)) return { x: p[0] ?? 0, y: p[1] ?? 0, z: p[2] ?? 0 };
  return { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 };
}

/**
 * DraftDown.Entities — geometry collection.
 *
 * Constructed with an optional `parentGroupId` for scoped iteration; when null,
 * iterates over every face/edge/vertex in the active model.
 */
export class Entities {
  constructor(private ctx: EntityContext, private parentGroupId: string | null = null) {}

  // ─── Length / iteration ─────────────────────────────────────────

  get length(): number { return this.size; }
  get count(): number { return this.size; }
  get size(): number {
    const m = this.ctx.doc.geometry.getMesh();
    return m.faces.size + m.edges.size + m.vertices.size;
  }

  /** DraftDown.Entities#each — yields wrappers in face → edge → vertex order. */
  each(fn: (entity: AnyEntity) => void): void {
    for (const e of this.toArray()) fn(e);
  }

  /** Convert collection to a plain array of wrappers. */
  toArray(): AnyEntity[] {
    const out: AnyEntity[] = [];
    const m = this.ctx.doc.geometry.getMesh();
    for (const id of m.faces.keys()) out.push(new Face(id, this.ctx));
    for (const id of m.edges.keys()) out.push(new Edge(id, this.ctx));
    for (const id of m.vertices.keys()) out.push(new Vertex(id, this.ctx));
    return out;
  }

  /** DraftDown.Entities#at(index) — Ruby-style positional access. */
  at(index: number): AnyEntity | null {
    const arr = this.toArray();
    return arr[index] ?? null;
  }

  // ─── Add primitives ─────────────────────────────────────────────

  /**
   * DraftDown.Entities#add_line(point1, point2) → Edge
   * Or accept a single array of points to draw a polyline (same as Ruby's overload).
   */
  addLine(p1: Point3dLike, p2: Point3dLike): Edge;
  addLine(points: Point3dLike[]): Edge[];
  addLine(p1OrPts: Point3dLike | Point3dLike[], p2?: Point3dLike): Edge | Edge[] {
    // A "list of points" form: argument is an array AND first element is itself a Point3d / array / vector-like.
    if (Array.isArray(p1OrPts) && p1OrPts.length > 0 && typeof p1OrPts[0] !== 'number') {
      const pts = p1OrPts as Point3dLike[];
      const edges: Edge[] = [];
      for (let i = 0; i < pts.length - 1; i++) edges.push(this.addLine(pts[i], pts[i + 1]) as Edge);
      return edges;
    }
    if (p2 === undefined) throw new Error('addLine requires two points');
    const g = this.ctx.doc.geometry;
    const hist = this.ctx.doc.history;
    hist.beginTransaction('Add Line');
    try {
      const a = g.createVertex(asVec3(p1OrPts as Point3dLike));
      const b = g.createVertex(asVec3(p2));
      const e = g.createEdgeWithAutoFace(a.id, b.id);
      hist.commitTransaction();
      return new Edge(e.id, this.ctx);
    } catch (err) { hist.abortTransaction(); throw err; }
  }

  /**
   * DraftDown.Entities#add_edges(*points) → [Edge]
   * In Ruby returns an array of Edges (one per consecutive pair).
   */
  addEdges(...points: Point3dLike[]): Edge[] {
    // Accept either spread arguments or a single array.
    let pts: Point3dLike[] = points;
    if (points.length === 1) {
      const first = points[0] as unknown;
      if (Array.isArray(first) && first.length > 0 && typeof first[0] !== 'number') {
        pts = first as Point3dLike[];
      }
    }
    if (pts.length < 2) return [];
    const edges: Edge[] = [];
    for (let i = 0; i < pts.length - 1; i++) edges.push(this.addLine(pts[i], pts[i + 1]) as Edge);
    return edges;
  }

  /**
   * DraftDown.Entities#add_face(*points) — accepts 3+ points OR an array of edges.
   * Returns a new Face.
   */
  addFace(...args: any[]): Face {
    let points: Point3dLike[];
    if (args.length === 1 && Array.isArray(args[0])) points = args[0];
    else points = args as Point3dLike[];
    if (points.length < 3) throw new Error('addFace requires at least 3 points');

    const g = this.ctx.doc.geometry;
    const hist = this.ctx.doc.history;
    hist.beginTransaction('Add Face');
    try {
      const vids: string[] = points.map(p => g.createVertex(asVec3(p)).id);
      // edges
      for (let i = 0; i < vids.length; i++) {
        const next = (i + 1) % vids.length;
        if (!g.findEdgeBetween(vids[i], vids[next])) g.createEdge(vids[i], vids[next]);
      }
      const f = g.createFace(vids);
      hist.commitTransaction();
      return new Face(f.id, this.ctx);
    } catch (err) { hist.abortTransaction(); throw err; }
  }

  /**
   * DraftDown.Entities#add_circle(center, normal, radius, numsegs=24) → [Edge]
   */
  addCircle(center: Point3dLike, normal: Vector3dLike, radius: number, numsegs = 24): Edge[] {
    const c = asVec3(center);
    const n = new Vector3d(normal).normalize();
    // build basis
    let u: Vector3d;
    if (Math.abs(n.y) > 0.9) u = n.cross(new Vector3d(1, 0, 0)).normalize();
    else u = n.cross(new Vector3d(0, 1, 0)).normalize();
    const v = n.cross(u).normalize();

    const g = this.ctx.doc.geometry;
    const hist = this.ctx.doc.history;
    hist.beginTransaction('Add Circle');
    try {
      const vids: string[] = [];
      for (let i = 0; i < numsegs; i++) {
        const a = (i / numsegs) * Math.PI * 2;
        const x = c.x + radius * (u.x * Math.cos(a) + v.x * Math.sin(a));
        const y = c.y + radius * (u.y * Math.cos(a) + v.y * Math.sin(a));
        const z = c.z + radius * (u.z * Math.cos(a) + v.z * Math.sin(a));
        vids.push(g.createVertex({ x, y, z }).id);
      }
      const edges: Edge[] = [];
      for (let i = 0; i < numsegs; i++) {
        const next = (i + 1) % numsegs;
        const e = g.createEdge(vids[i], vids[next]);
        edges.push(new Edge(e.id, this.ctx));
      }
      hist.commitTransaction();
      return edges;
    } catch (err) { hist.abortTransaction(); throw err; }
  }

  /**
   * DraftDown.Entities#add_ngon(center, normal, radius, numsides) → [Edge]
   */
  addNgon(center: Point3dLike, normal: Vector3dLike, radius: number, numsides = 6): Edge[] {
    return this.addCircle(center, normal, radius, numsides);
  }

  /**
   * DraftDown.Entities#add_arc(center, xaxis, normal, radius, startAngle, endAngle, numsegs=12) → [Edge]
   */
  addArc(
    center: Point3dLike, xaxis: Vector3dLike, normal: Vector3dLike,
    radius: number, startAngle: number, endAngle: number, numsegs = 12,
  ): Edge[] {
    const c = asVec3(center);
    const x = new Vector3d(xaxis).normalize();
    const z = new Vector3d(normal).normalize();
    const y = z.cross(x).normalize();

    const g = this.ctx.doc.geometry;
    const hist = this.ctx.doc.history;
    hist.beginTransaction('Add Arc');
    try {
      const vids: string[] = [];
      const span = endAngle - startAngle;
      for (let i = 0; i <= numsegs; i++) {
        const a = startAngle + (span * i) / numsegs;
        const px = c.x + radius * (x.x * Math.cos(a) + y.x * Math.sin(a));
        const py = c.y + radius * (x.y * Math.cos(a) + y.y * Math.sin(a));
        const pz = c.z + radius * (x.z * Math.cos(a) + y.z * Math.sin(a));
        vids.push(g.createVertex({ x: px, y: py, z: pz }).id);
      }
      const edges: Edge[] = [];
      for (let i = 0; i < numsegs; i++) edges.push(new Edge(g.createEdge(vids[i], vids[i + 1]).id, this.ctx));
      hist.commitTransaction();
      return edges;
    } catch (err) { hist.abortTransaction(); throw err; }
  }

  /**
   * DraftDown.Entities#add_curve(*points) — open polyline-as-curve.
   */
  addCurve(...points: Point3dLike[]): Edge[] {
    let pts: Point3dLike[] = points;
    if (points.length === 1) {
      const first = points[0] as unknown;
      if (Array.isArray(first) && first.length > 0 && typeof first[0] !== 'number') {
        pts = first as Point3dLike[];
      }
    }
    return this.addEdges(...pts);
  }

  // ─── Add containers ──────────────────────────────────────────────

  /**
   * DraftDown.Entities#add_group(*entities) — wraps existing entities or creates an empty group.
   */
  addGroup(...entities: AnyEntity[]): Group {
    if (entities.length === 1 && Array.isArray(entities[0])) entities = entities[0] as any;
    const ids = entities.map(e => e.id);
    const id = this.ctx.api.createGroup('Group', ids);
    return new Group(id, this.ctx);
  }

  /** DraftDown.Entities#add_instance(definition, transformation) */
  addInstance(definition: ComponentDefinition, transformation: Transformation): ComponentInstance {
    const sm: any = this.ctx.doc.scene;
    const inst = sm.placeComponentInstance?.(definition.id, {
      position: transformation.origin.toVec3(),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    if (!inst) throw new Error('Could not place instance');
    return new ComponentInstance(inst.id, this.ctx);
  }

  // ─── Erase / transform ──────────────────────────────────────────

  /** DraftDown.Entities#erase_entities(entities). */
  eraseEntities(entities: AnyEntity[] | AnyEntity): void {
    const arr = Array.isArray(entities) ? entities : [entities];
    this.ctx.api.deleteEntities(arr.map(e => e.id));
  }

  /** DraftDown.Entities#transform_entities(transformation, entities). */
  transformEntities(t: Transformation, entities: AnyEntity[]): void {
    const ids = entities.map(e => e.id);
    // If purely a translation, fast path through ModelAPI.moveEntities.
    const o = t.origin;
    const purelyTranslation =
      Math.abs(t.matrix[0] - 1) < 1e-9 && Math.abs(t.matrix[5] - 1) < 1e-9 && Math.abs(t.matrix[10] - 1) < 1e-9 &&
      Math.abs(t.matrix[1]) < 1e-9 && Math.abs(t.matrix[2]) < 1e-9 &&
      Math.abs(t.matrix[4]) < 1e-9 && Math.abs(t.matrix[6]) < 1e-9 &&
      Math.abs(t.matrix[8]) < 1e-9 && Math.abs(t.matrix[9]) < 1e-9;
    if (purelyTranslation) {
      this.ctx.api.moveEntities(ids, { x: o.x, y: o.y, z: o.z });
      return;
    }
    // General path: mutate vertex positions in-place inside a transaction.
    const g = this.ctx.doc.geometry;
    const hist = this.ctx.doc.history;
    hist.beginTransaction('Transform Entities');
    try {
      const vids = new Set<string>();
      for (const id of ids) {
        const f = g.getFace(id);
        if (f) { for (const vid of f.vertexIds) vids.add(vid); continue; }
        const e = g.getEdge(id);
        if (e) { vids.add(e.startVertexId); vids.add(e.endVertexId); continue; }
        if (g.getVertex(id)) vids.add(id);
      }
      for (const vid of vids) {
        const v = g.getVertex(vid);
        if (!v) continue;
        const p = t.apply(new Point3d(v.position.x, v.position.y, v.position.z));
        v.position.x = p.x; v.position.y = p.y; v.position.z = p.z;
      }
      hist.commitTransaction();
    } catch (err) { hist.abortTransaction(); throw err; }
  }

  /** DraftDown.Entities#fill_from_mesh / #add_faces_from_mesh — pour a Geom::PolygonMesh into the model. */
  fillFromMesh(mesh: import('./Geom').PolygonMesh, _weld = true, _smoothFlags = 0, _frontMaterial?: unknown, _backMaterial?: unknown): number {
    return this.addFacesFromMesh(mesh);
  }
  addFacesFromMesh(mesh: import('./Geom').PolygonMesh): number {
    const g = this.ctx.doc.geometry;
    const hist = this.ctx.doc.history;
    hist.beginTransaction('Add Faces From Mesh');
    try {
      const verts: { x: number; y: number; z: number }[] = [];
      for (let i = 1; i <= mesh.countPoints(); i++) {
        const p = mesh.pointAt(i)!; verts.push({ x: p.x, y: p.y, z: p.z });
      }
      const polys: number[][] = [];
      for (let i = 1; i <= mesh.countPolygons(); i++) {
        const poly = mesh.polygonAt(i);
        if (poly) polys.push(poly.map(idx => Math.abs(idx) - 1));
      }
      const result = g.bulkImport(verts, polys);
      hist.commitTransaction();
      return result.faceIds.length;
    } catch (err) { hist.abortTransaction(); throw err; }
  }

  /**
   * DraftDown.Entities#intersect_with(recurse, transformation, entities, transformation2, hidden, intersect_with_array)
   * — projects the supplied entities onto this collection's geometry, creating new edges
   *   wherever surfaces meet.
   *
   * Production-grade intersection is delegated to the Manifold-based boolean engine via
   * ModelAPI.booleanIntersect, then we extract the resulting edges. For most plugin uses
   * (slicing planes through bodies) this gives the correct result.
   */
  async intersectWith(
    _recurse: boolean,
    _transformation: import('./Geom').Transformation | null,
    entities: AnyEntity[],
    _transformation2: import('./Geom').Transformation | null,
    _hidden: boolean,
    intersectWithArray: AnyEntity[],
  ): Promise<Edge[]> {
    const ids = intersectWithArray.concat(entities).map(e => e.id);
    const result = await this.ctx.api.booleanIntersect(ids, intersectWithArray.map(e => e.id));
    return result.edgeIds.map(id => new Edge(id, this.ctx));
  }

  /** DraftDown.Entities#clear! — erase every entity. */
  clearAll(): void {
    const m = this.ctx.doc.geometry.getMesh();
    const ids: string[] = [];
    for (const id of m.faces.keys()) ids.push(id);
    for (const id of m.edges.keys()) ids.push(id);
    for (const id of m.vertices.keys()) ids.push(id);
    if (ids.length === 0) return;
    this.ctx.api.deleteEntities(ids);
  }

  /** DraftDown.Entities#parent — owning Group/Model. */
  get parent(): unknown {
    if (!this.parentGroupId) return (this.ctx as any).getModel?.() ?? null;
    return new Group(this.parentGroupId, this.ctx);
  }
  /** DraftDown.Entities#model. */
  get model(): unknown { return (this.ctx as any).getModel?.() ?? null; }

  // ─── New entity producers ────────────────────────────────────

  /** DraftDown.Entities#add_3d_text(string, alignment, font, bold, italic, letter_height, tolerance, z, filled, extrusion) */
  add3dText(
    text: string,
    _alignment: number = 0,
    _font: string = 'Arial',
    _bold = false,
    _italic = false,
    letterHeight = 1,
    _tolerance = 0,
    z = 0,
    filled = true,
    extrusion = 0,
  ): import('./Annotations').Text {
    const { Text } = require('./Annotations') as typeof import('./Annotations');
    void filled; void extrusion;
    return Text.create(this.ctx, text, new Point3d(0, z, 0));
  }

  /** DraftDown.Entities#add_text(text, position, vector?) */
  addText(text: string, position: Point3d | { x: number; y: number; z: number }, vector?: import('./Geom').Vector3d): import('./Annotations').Text {
    const { Text } = require('./Annotations') as typeof import('./Annotations');
    return Text.create(this.ctx, text, new Point3d(position.x, position.y, position.z), vector);
  }

  /** DraftDown.Entities#add_image(path, point, width, height, rotation=0) */
  addImage(path: string, point: Point3d | { x: number; y: number; z: number }, width: number, height: number): import('./Annotations').Image {
    const { Image } = require('./Annotations') as typeof import('./Annotations');
    return Image.create(this.ctx, path, new Point3d(point.x, point.y, point.z), width, height);
  }

  /** DraftDown.Entities#add_cline(start, end, stipple='') / (start, vector) */
  addCline(start: Point3d, endOrDir: Point3d | import('./Geom').Vector3d, _stipple = '-'): import('./Annotations').ConstructionLine {
    const { ConstructionLine } = require('./Annotations') as typeof import('./Annotations');
    let end: Point3d;
    if ((endOrDir as any).x !== undefined && (endOrDir as any).y !== undefined && (endOrDir as any).z !== undefined && !(endOrDir instanceof Point3d)) {
      const v = endOrDir as import('./Geom').Vector3d;
      end = new Point3d(start.x + v.x * 1000, start.y + v.y * 1000, start.z + v.z * 1000);
    } else {
      end = endOrDir as Point3d;
    }
    return ConstructionLine.create(this.ctx, start, end);
  }

  /** DraftDown.Entities#add_cpoint(point) */
  addCpoint(p: Point3d | { x: number; y: number; z: number }): import('./Annotations').ConstructionPoint {
    const { ConstructionPoint } = require('./Annotations') as typeof import('./Annotations');
    return ConstructionPoint.create(this.ctx, new Point3d(p.x, p.y, p.z));
  }

  /** DraftDown.Entities#add_dimension_linear(start, end, offsetVector) */
  addDimensionLinear(start: Point3d, end: Point3d, offset: import('./Geom').Vector3d): import('./Annotations').DimensionLinear {
    const { DimensionLinear } = require('./Annotations') as typeof import('./Annotations');
    return DimensionLinear.create(this.ctx, start, end, offset);
  }
  /** DraftDown.Entities#add_dimension_radial(arcOrCircleEdge, leaderVector) */
  addDimensionRadial(edge: Edge, leader: import('./Geom').Vector3d): import('./Annotations').DimensionRadial {
    const { DimensionRadial } = require('./Annotations') as typeof import('./Annotations');
    return DimensionRadial.create(this.ctx, edge.id, leader);
  }
  /** DraftDown.Entities#add_section_plane(point, normal) */
  addSectionPlane(point: Point3d, normal: import('./Geom').Vector3d, name?: string): import('./SectionPlane').SectionPlane {
    const { SectionPlane } = require('./SectionPlane') as typeof import('./SectionPlane');
    return SectionPlane.create(this.ctx, point, normal, name);
  }

  /** DraftDown.Entities#active_section_plane — first active section. */
  activeSectionPlane(): import('./SectionPlane').SectionPlane | null {
    const { getActiveSectionPlane } = require('./SectionPlane') as typeof import('./SectionPlane');
    return getActiveSectionPlane(this.ctx);
  }
  /** DraftDown.Entities#clear_section_planes */
  clearSectionPlanes(): void {
    const { clearAllSectionPlanes } = require('./SectionPlane') as typeof import('./SectionPlane');
    clearAllSectionPlanes(this.ctx);
  }

  // ─── Observers ───────────────────────────────────────────────

  private static observerSets = new Map<Entities, Set<EntitiesObserverFn>>();
  addObserver(observer: EntitiesObserverFn): void {
    let s = Entities.observerSets.get(this); if (!s) { s = new Set(); Entities.observerSets.set(this, s); }
    s.add(observer);
  }
  removeObserver(observer: EntitiesObserverFn): void {
    Entities.observerSets.get(this)?.delete(observer);
  }

  // ─── Lookup helpers (DraftDown-specific, but useful for plugins) ─

  /** Resolve any entity id to a wrapper (Face/Edge/Vertex/Group/...). */
  byId(id: string): AnyEntity | null {
    const g = this.ctx.doc.geometry;
    if (g.getFace(id)) return new Face(id, this.ctx);
    if (g.getEdge(id)) return new Edge(id, this.ctx);
    if (g.getVertex(id)) return new Vertex(id, this.ctx);
    const e = this.ctx.doc.scene.getEntity(id);
    if (e?.type === 'group') return new Group(id, this.ctx);
    if (e?.type === 'component_instance') return new ComponentInstance(id, this.ctx);
    // Annotations & section planes live in side-tables.
    const { findAnnotationById } = require('./Annotations') as typeof import('./Annotations');
    const a = findAnnotationById(id, this.ctx); if (a) return a as AnyEntity;
    const { findSectionById } = require('./SectionPlane') as typeof import('./SectionPlane');
    const s = findSectionById(id, this.ctx); if (s) return s as AnyEntity;
    return null;
  }
}
