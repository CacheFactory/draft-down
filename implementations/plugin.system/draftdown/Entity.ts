// @archigraph plugin.system.draftdown.entity
// DraftDown.Entity / Drawingelement / Vertex / Edge / Face / Curve wrappers.
//
// Each wrapper holds the entity ID and a reference to the parent Model so it can
// resolve the live mesh. Wrappers are thin & re-resolved lazily — long-lived
// references survive undo/redo as long as the underlying ID still exists.
//
// References:
//   
//   
//   
//   
//   

import type { IGeometryEngine, IModelDocument } from '../../../src/core/interfaces';
import type { IModelAPI } from '../../api.model/ModelAPI';
import type { Vec3 } from '../../../src/core/types';
import { Point3d, Vector3d, Transformation, BoundingBox } from './Geom';
import type { Material } from './Materials';
import type { Layer } from './Layers';
import type { AttributeStore, AttrValue } from './AttributeStore';
import { AttributeDictionary, AttributeDictionaries } from './AttributeDictionary';

/** Shared state every entity wrapper needs. */
export interface EntityContext {
  doc: IModelDocument;
  api: IModelAPI;
  /** Resolve a Material wrapper from a material id (or null for default). */
  resolveMaterial(id: string | null): Material | null;
  /** Document-level attribute store. */
  attributes: AttributeStore;
  /** Per-entity observer registry. */
  entityObservers: Map<string, Set<EntityObserver>>;
  /** Resolve a Layer wrapper by id (or null). */
  resolveLayer(id: string | null): Layer | null;
  /** Resolve the default layer (Layer0) wrapper. */
  defaultLayer(): Layer;
}

/** DraftDown.EntityObserver protocol. */
export interface EntityObserver {
  onChangeEntity?(entity: Entity): void;
  onEraseEntity?(entity: Entity): void;
}

/** DraftDown.Entity — base class for everything in the model. */
export abstract class Entity {
  constructor(public readonly entityID: string, protected ctx: EntityContext) {}

  get id(): string { return this.entityID; }

  /** Stable identifier surviving save/load. We use the engine ID directly. */
  get persistentId(): string { return this.entityID; }

  /** DraftDown.Entity#valid? */
  valid(): boolean {
    const g = this.ctx.doc.geometry;
    if (g.getVertex(this.entityID) || g.getEdge(this.entityID) || g.getFace(this.entityID)) return true;
    const e = this.ctx.doc.scene.getEntity(this.entityID);
    return !!e;
  }

  /** DraftDown.Entity#deleted? */
  deleted(): boolean { return !this.valid(); }

  /** Returns a string identifying this Entity's class — mirrors Ruby's class name. */
  abstract typename(): string;

  /** DraftDown.Entity#erase! */
  eraseInPlace(): void {
    this.notifyChange('erase');
    this.ctx.api.deleteEntities([this.entityID]);
  }

  /** Alias for DraftDown's `entity.erase!`. */
  erase(): void { this.eraseInPlace(); }

  /** DraftDown.Entity#==. */
  equals(other: Entity): boolean { return other?.entityID === this.entityID; }

  /** DraftDown.Entity#parent — Group / Model that owns this entity (null for top-level loose geom). */
  get parent(): Entity | { _isModel: true } {
    const e = this.ctx.doc.scene.getEntity(this.entityID);
    if (e?.parentId && e.parentId !== this.ctx.doc.scene.root.id) {
      const wrap = (this.ctx as any).resolveAnyEntity?.(e.parentId);
      if (wrap) return wrap;
    }
    return { _isModel: true };
  }

  /** DraftDown.Entity#model — the active model facade (lazy resolution). */
  get model(): unknown {
    return (this.ctx as any).getModel?.() ?? null;
  }

  /** DraftDown.Drawingelement#layer / layer= */
  get layer(): Layer {
    const e = this.ctx.doc.scene.getEntity(this.entityID);
    if (e?.layerId) {
      const l = this.ctx.resolveLayer(e.layerId);
      if (l) return l;
    }
    return this.ctx.defaultLayer();
  }
  set layer(layer: Layer | string | null) {
    const id = typeof layer === 'string' ? layer : layer?.id ?? null;
    if (id) {
      try { this.ctx.doc.scene.assignToLayer(this.entityID, id); }
      catch (e) { console.warn(`[Entity.layer=] assignToLayer ${this.entityID}→${id} failed (engine may not track loose geom):`, e); }
    }
    this.notifyChange('layer');
  }

  /** DraftDown.Drawingelement#hidden? / hidden= */
  get hidden(): boolean {
    const g = this.ctx.doc.geometry;
    const v = g.getVertex(this.entityID); if (v) return !!v.hidden;
    const e = g.getEdge(this.entityID); if (e) return !!e.hidden;
    const f = g.getFace(this.entityID); if (f) return !!f.hidden;
    const ent = this.ctx.doc.scene.getEntity(this.entityID); return ent ? !ent.visible : false;
  }
  set hidden(v: boolean) {
    const g = this.ctx.doc.geometry;
    const ve = g.getVertex(this.entityID); if (ve) { ve.hidden = v; this.notifyChange('hidden'); return; }
    const ee = g.getEdge(this.entityID); if (ee) { ee.hidden = v; this.notifyChange('hidden'); return; }
    const fe = g.getFace(this.entityID); if (fe) { fe.hidden = v; this.notifyChange('hidden'); return; }
    const ent = this.ctx.doc.scene.getEntity(this.entityID); if (ent) { ent.visible = !v; this.notifyChange('hidden'); }
  }
  /** Inverse of `hidden`. */
  get visible(): boolean { return !this.hidden; }
  set visible(v: boolean) { this.hidden = !v; }

  /** DraftDown.Drawingelement#locked? / locked= */
  get locked(): boolean {
    const ent = this.ctx.doc.scene.getEntity(this.entityID);
    return !!ent?.locked;
  }
  set locked(v: boolean) {
    const ent = this.ctx.doc.scene.getEntity(this.entityID);
    if (ent) { ent.locked = v; this.notifyChange('locked'); }
  }

  /** DraftDown.Entity#bounds — full Geom::BoundingBox (with center/width/height/depth/diagonal). */
  get bounds(): BoundingBox {
    const bb = new BoundingBox();
    const g = this.ctx.doc.geometry;
    const f = g.getFace(this.entityID);
    if (f) {
      for (const v of g.getFaceVertices(this.entityID)) {
        bb.add(new Point3d(v.position.x, v.position.y, v.position.z));
      }
      return bb;
    }
    const e = g.getEdge(this.entityID);
    if (e) {
      const a = g.getVertex(e.startVertexId); const b = g.getVertex(e.endVertexId);
      if (a) bb.add(new Point3d(a.position.x, a.position.y, a.position.z));
      if (b) bb.add(new Point3d(b.position.x, b.position.y, b.position.z));
      return bb;
    }
    const v = g.getVertex(this.entityID);
    if (v) {
      bb.add(new Point3d(v.position.x, v.position.y, v.position.z));
      return bb;
    }
    return bb; // empty BoundingBox
  }

  // ── Attributes ────────────────────────────────────────────────

  /** DraftDown.Entity#attribute_dictionaries */
  get attributeDictionaries(): AttributeDictionaries {
    return new AttributeDictionaries(this.entityID, this.ctx.attributes);
  }

  /** DraftDown.Entity#attribute_dictionary(name, create=false) */
  attributeDictionary(name: string, create = false): AttributeDictionary | null {
    const dicts = this.attributeDictionaries;
    const existing = dicts.at(name);
    if (existing) return existing;
    if (!create) return null;
    // Create the dictionary by setting & removing a sentinel key, then return the wrapper.
    this.ctx.attributes.set(this.entityID, name, '__init__', null);
    this.ctx.attributes.delete(this.entityID, name, '__init__');
    this.ctx.attributes.set(this.entityID, name, '__dd_created__', true);
    return new AttributeDictionary(this.entityID, name, this.ctx.attributes);
  }

  /** DraftDown.Entity#set_attribute(dict, key, value) */
  setAttribute(dict: string, key: string, value: AttrValue): void {
    this.ctx.attributes.set(this.entityID, dict, key, value);
    this.notifyChange('attribute');
  }
  /** DraftDown.Entity#get_attribute(dict, key, default=nil) */
  getAttribute(dict: string, key: string, fallback?: AttrValue): AttrValue | undefined {
    return this.ctx.attributes.get(this.entityID, dict, key, fallback);
  }
  /** DraftDown.Entity#delete_attribute(dict, key=nil) — remove a key, or the whole dict if no key. */
  deleteAttribute(dict: string, key?: string): boolean {
    const ok = key === undefined ? this.ctx.attributes.deleteDict(this.entityID, dict)
                                  : this.ctx.attributes.delete(this.entityID, dict, key);
    if (ok) this.notifyChange('attribute');
    return ok;
  }

  // ── Observers ─────────────────────────────────────────────────

  /** DraftDown.Entity#add_observer */
  addObserver(observer: EntityObserver): void {
    let set = this.ctx.entityObservers.get(this.entityID);
    if (!set) { set = new Set(); this.ctx.entityObservers.set(this.entityID, set); }
    set.add(observer);
  }
  /** DraftDown.Entity#remove_observer */
  removeObserver(observer: EntityObserver): void {
    this.ctx.entityObservers.get(this.entityID)?.delete(observer);
  }

  /** Internal: broadcast a change event to per-entity observers. */
  notifyChange(_kind: string): void {
    const set = this.ctx.entityObservers.get(this.entityID);
    if (!set) return;
    for (const o of set) try { o.onChangeEntity?.(this); } catch (e) { console.error(e); }
  }
  notifyErase(): void {
    const set = this.ctx.entityObservers.get(this.entityID);
    if (!set) return;
    for (const o of set) try { o.onEraseEntity?.(this); } catch (e) { console.error(e); }
  }

  toString(): string { return `${this.typename()}(${this.entityID})`; }
}

/**
 * DraftDown.Vertex — a topological 3D point.
 */
export class Vertex extends Entity {
  typename(): string { return 'Vertex'; }

  /** DraftDown.Vertex#position — returns a NEW Point3d each call. */
  get position(): Point3d {
    const v = this.ctx.doc.geometry.getVertex(this.entityID);
    if (!v) throw new Error(`Vertex ${this.entityID} is deleted`);
    return new Point3d(v.position.x, v.position.y, v.position.z);
  }

  /** DraftDown.Vertex#position= — moves the underlying vertex (no transform recorded). */
  set position(p: Point3d) {
    const v = this.ctx.doc.geometry.getVertex(this.entityID);
    if (!v) throw new Error(`Vertex ${this.entityID} is deleted`);
    v.position.x = p.x; v.position.y = p.y; v.position.z = p.z;
  }

  /** DraftDown.Vertex#edges — all edges using this vertex. */
  get edges(): Edge[] {
    return this.ctx.doc.geometry.getVertexEdges(this.entityID).map(e => new Edge(e.id, this.ctx));
  }

  /** DraftDown.Vertex#faces — all faces using this vertex. */
  get faces(): Face[] {
    const g = this.ctx.doc.geometry;
    const set = new Map<string, Face>();
    for (const e of g.getVertexEdges(this.entityID)) {
      for (const f of g.getEdgeFaces(e.id)) set.set(f.id, new Face(f.id, this.ctx));
    }
    return Array.from(set.values());
  }

  /** DraftDown.Vertex#used_by? */
  usedBy(entity: Edge | Face): boolean {
    if (entity instanceof Edge) {
      const e = this.ctx.doc.geometry.getEdge(entity.id);
      return !!e && (e.startVertexId === this.entityID || e.endVertexId === this.entityID);
    }
    if (entity instanceof Face) {
      const f = this.ctx.doc.geometry.getFace(entity.id);
      return !!f && f.vertexIds.includes(this.entityID);
    }
    return false;
  }

  /** DraftDown.Vertex#common_edge — returns the edge between two vertices, if any. */
  commonEdge(other: Vertex): Edge | null {
    const e = this.ctx.doc.geometry.findEdgeBetween(this.entityID, other.entityID);
    return e ? new Edge(e.id, this.ctx) : null;
  }

  /** DraftDown.Vertex#loops — all face loops touching this vertex (best-effort: outer loops only). */
  get loops(): Array<{ vertices(): Vertex[]; edges(): Edge[] }> {
    return this.faces.map(f => {
      const outer = f.outerLoop();
      const verts = outer.vertices();
      const ctx = (this as any).ctx as EntityContext;
      const edgesFn = () => {
        const out: Edge[] = [];
        for (let i = 0; i < verts.length; i++) {
          const e = ctx.doc.geometry.findEdgeBetween(verts[i].id, verts[(i + 1) % verts.length].id);
          if (e) out.push(new Edge(e.id, ctx));
        }
        return out;
      };
      return { vertices: outer.vertices, edges: edgesFn };
    });
  }

  /** DraftDown.Vertex#curve_interior? — true if this vertex is interior to a Curve (an arc/circle). */
  curveInterior(): boolean {
    const edges = this.edges;
    if (edges.length !== 2) return false;
    const a = this.ctx.doc.geometry.getEdge(edges[0].id);
    const b = this.ctx.doc.geometry.getEdge(edges[1].id);
    if (!a || !b) return false;
    return !!a.curveId && a.curveId === b.curveId;
  }
}

/**
 * DraftDown.Edge — a straight line between two vertices.
 */
export class Edge extends Entity {
  typename(): string { return 'Edge'; }

  private get raw() {
    const e = this.ctx.doc.geometry.getEdge(this.entityID);
    if (!e) throw new Error(`Edge ${this.entityID} is deleted`);
    return e;
  }

  get start(): Vertex { return new Vertex(this.raw.startVertexId, this.ctx); }
  get end(): Vertex { return new Vertex(this.raw.endVertexId, this.ctx); }

  get vertices(): [Vertex, Vertex] { return [this.start, this.end]; }

  /** DraftDown.Edge#length — returns model-units length (no Length-class wrapping). */
  get length(): number { return this.ctx.doc.geometry.computeEdgeLength(this.entityID); }

  /** DraftDown.Edge#line — returns [Point3d, Vector3d] like Ruby's. */
  get line(): [Point3d, Vector3d] {
    const a = this.start.position; const b = this.end.position;
    return [a, a.vectorTo(b)];
  }

  /** DraftDown.Edge#faces — adjacent faces. */
  get faces(): Face[] {
    return this.ctx.doc.geometry.getEdgeFaces(this.entityID).map(f => new Face(f.id, this.ctx));
  }

  /** DraftDown.Edge#smooth?, #soft? */
  get smooth(): boolean { return !!this.raw.smooth; }
  set smooth(v: boolean) { this.raw.smooth = v; }
  get soft(): boolean { return !!this.raw.soft; }
  set soft(v: boolean) { this.raw.soft = v; }

  /** DraftDown.Edge#hidden? */
  get hidden(): boolean { return !!this.raw.hidden; }
  set hidden(v: boolean) { this.raw.hidden = v; }

  /** DraftDown.Edge#other_vertex — return the vertex at the other end. */
  otherVertex(v: Vertex): Vertex {
    const r = this.raw;
    if (r.startVertexId === v.id) return this.end;
    if (r.endVertexId === v.id) return this.start;
    throw new Error('Vertex is not on this edge');
  }

  /** DraftDown.Edge#used_by? */
  usedBy(entity: Vertex | Face): boolean {
    if (entity instanceof Vertex) {
      return this.raw.startVertexId === entity.id || this.raw.endVertexId === entity.id;
    }
    if (entity instanceof Face) {
      return this.faces.some(f => f.id === entity.id);
    }
    return false;
  }

  /** DraftDown.Edge#common_face. */
  commonFace(other: Edge): Face | null {
    const a = new Set(this.faces.map(f => f.id));
    for (const f of other.faces) if (a.has(f.id)) return f;
    return null;
  }

  /** DraftDown.Edge#curve — the parent ArcCurve, or null if this is a free edge. */
  get curve(): import('./Curve').Curve | null {
    const cid = this.raw.curveId;
    if (!cid) return null;
    const { Curve } = require('./Curve') as typeof import('./Curve');
    return new Curve(cid, this.ctx);
  }

  /** DraftDown.Edge#explode_curve — detach this edge from its parent curve. */
  explodeCurve(): Edge {
    if (this.raw.curveId) this.raw.curveId = undefined;
    return this;
  }

  /** DraftDown.Edge#find_faces — auto-create faces from any closed loops this edge participates in. */
  findFaces(): number {
    const before = this.ctx.doc.geometry.getMesh().faces.size;
    const e = this.raw;
    try {
      // Re-run auto-face detection by recreating the edge with auto-face semantics.
      const dup = this.ctx.doc.geometry.createEdgeWithAutoFace(e.startVertexId, e.endVertexId);
      // The edge will already exist; createEdgeWithAutoFace returns the existing one.
      void dup;
    } catch (e) { console.warn(`[Edge.findFaces] createEdgeWithAutoFace failed for ${this.entityID}:`, e); }
    return this.ctx.doc.geometry.getMesh().faces.size - before;
  }

  /** DraftDown.Edge#reversed_in?(face) — true if the edge runs against the face's vertex order. */
  reversedIn(face: Face): boolean {
    const f = this.ctx.doc.geometry.getFace(face.id);
    if (!f) return false;
    const verts = f.vertexIds;
    const idx = verts.indexOf(this.raw.startVertexId);
    if (idx < 0) return false;
    const next = verts[(idx + 1) % verts.length];
    return next !== this.raw.endVertexId;
  }

  /** DraftDown.Edge#split(point) — split this edge at the given point. Returns the new vertex's edge. */
  split(point: Point3d | { x: number; y: number; z: number }): Edge {
    const g = this.ctx.doc.geometry;
    const e = this.raw;
    const v1 = g.getVertex(e.startVertexId)!;
    const v2 = g.getVertex(e.endVertexId)!;
    const nv = g.createVertex({ x: point.x, y: point.y, z: point.z });
    const e1 = g.createEdge(v1.id, nv.id);
    const e2 = g.createEdge(nv.id, v2.id);
    g.deleteEdge(this.entityID);
    void e1;
    return new Edge(e2.id, this.ctx);
  }

  /** DraftDown.Edge#material */
  get material(): import('./Materials').Material | null {
    return this.ctx.resolveMaterial((this.raw as any).materialId ?? null);
  }
  set material(mat: import('./Materials').Material | string | null) {
    const id = typeof mat === 'string' ? mat : mat?.id ?? null;
    if (id) (this.raw as any).materialId = id;
    else delete (this.raw as any).materialId;
    this.notifyChange('material');
  }

  /** DraftDown.Edge#all_connected — every entity connected by edge graph. */
  allConnected(): Entity[] {
    const seen = new Set<string>(); const out: Entity[] = [];
    const g = this.ctx.doc.geometry;
    const queue: string[] = [this.entityID];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const e = g.getEdge(id);
      if (e) {
        out.push(new Edge(id, this.ctx));
        const v1Edges = g.getVertexEdges(e.startVertexId).map(x => x.id);
        const v2Edges = g.getVertexEdges(e.endVertexId).map(x => x.id);
        for (const nid of [...v1Edges, ...v2Edges]) if (!seen.has(nid)) queue.push(nid);
        for (const f of g.getEdgeFaces(id)) if (!seen.has(f.id)) { seen.add(f.id); out.push(new Face(f.id, this.ctx)); }
      }
    }
    return out;
  }
}

/**
 * DraftDown.Face — a planar polygon.
 */
export class Face extends Entity {
  typename(): string { return 'Face'; }

  private get raw() {
    const f = this.ctx.doc.geometry.getFace(this.entityID);
    if (!f) throw new Error(`Face ${this.entityID} is deleted`);
    return f;
  }

  /** DraftDown.Face#area — model-units squared. */
  get area(): number { return this.ctx.doc.geometry.computeFaceArea(this.entityID); }

  /** DraftDown.Face#normal */
  get normal(): Vector3d {
    const n = this.ctx.doc.geometry.computeFaceNormal(this.entityID);
    return new Vector3d(n.x, n.y, n.z);
  }

  /** DraftDown.Face#vertices */
  get vertices(): Vertex[] {
    return this.ctx.doc.geometry.getFaceVertices(this.entityID).map(v => new Vertex(v.id, this.ctx));
  }

  /** DraftDown.Face#edges */
  get edges(): Edge[] {
    return this.ctx.doc.geometry.getFaceEdges(this.entityID).map(e => new Edge(e.id, this.ctx));
  }

  /** DraftDown.Face#material / #material= */
  get material(): Material | null { return this.ctx.resolveMaterial(this.materialId); }
  set material(mat: Material | string | null) {
    const id = typeof mat === 'string' ? mat : mat?.id ?? null;
    if (id === null) return;
    this.ctx.api.setFaceMaterial([this.entityID], id);
  }

  /** DraftDown.Face#back_material / #back_material= */
  get backMaterial(): Material | null { return this.ctx.resolveMaterial(this.backMaterialId); }
  set backMaterial(mat: Material | string | null) {
    const id = typeof mat === 'string' ? mat : mat?.id ?? null;
    if (id === null) return;
    const matMgr: any = this.ctx.doc.materials;
    matMgr.applyToFace?.(this.entityID, id, true);
  }

  /** DraftDown.Face#pushpull(distance, copy=false) */
  pushpull(distance: number, _copy = false): void {
    this.ctx.api.extrudeFace(this.entityID, distance);
  }

  /** DraftDown.Face#reverse! — flips the face normal by reversing vertex order. */
  reverseInPlace(): Face {
    const f = this.ctx.doc.geometry.getFace(this.entityID);
    if (!f) return this;
    f.vertexIds = f.vertexIds.slice().reverse();
    f.normal = { x: -f.normal.x, y: -f.normal.y, z: -f.normal.z };
    f.generation++;
    return this;
  }

  /** Plane as [a, b, c, d] (matches DraftDown). */
  get plane(): [number, number, number, number] {
    const p = this.raw.plane;
    return [p.normal.x, p.normal.y, p.normal.z, p.distance];
  }

  /** DraftDown.Face#outer_loop — best-effort: returns vertices of the outer boundary. */
  outerLoop(): { vertices(): Vertex[] } {
    const verts = this.vertices;
    return { vertices: () => verts };
  }

  /** DraftDown.Face#classify_point — 1=inside, 2=on vertex, 4=on edge, 8=outside, 16=not in plane. */
  classifyPoint(p: Point3d): number {
    const [a, b, c, d] = this.plane;
    const dist = a * p.x + b * p.y + c * p.z + d;
    if (Math.abs(dist) > 1e-5) return 16;

    const verts = this.vertices;
    for (const v of verts) if (v.position.distance(p) < 1e-6) return 2;

    // Edge test
    const g = this.ctx.doc.geometry;
    for (let i = 0; i < verts.length; i++) {
      const a2 = verts[i].position; const b2 = verts[(i + 1) % verts.length].position;
      const seg = new Vector3d(b2.x - a2.x, b2.y - a2.y, b2.z - a2.z);
      const ap = new Vector3d(p.x - a2.x, p.y - a2.y, p.z - a2.z);
      const segLenSq = seg.dot(seg);
      if (segLenSq < 1e-12) continue;
      const t = ap.dot(seg) / segLenSq;
      if (t < -1e-6 || t > 1 + 1e-6) continue;
      const proj = new Vector3d(a2.x + seg.x * t, a2.y + seg.y * t, a2.z + seg.z * t);
      const dx = proj.x - p.x, dy = proj.y - p.y, dz = proj.z - p.z;
      if (Math.hypot(dx, dy, dz) < 1e-6) return 4;
    }
    void g;

    // Inside test (project onto best 2D axes)
    const n = this.normal;
    const absX = Math.abs(n.x); const absY = Math.abs(n.y); const absZ = Math.abs(n.z);
    let proj2: { x: number; y: number }[];
    let proj2p: { x: number; y: number };
    if (absZ >= absX && absZ >= absY) { proj2 = verts.map(v => ({ x: v.position.x, y: v.position.y })); proj2p = { x: p.x, y: p.y }; }
    else if (absY >= absX) { proj2 = verts.map(v => ({ x: v.position.x, y: v.position.z })); proj2p = { x: p.x, y: p.z }; }
    else { proj2 = verts.map(v => ({ x: v.position.y, y: v.position.z })); proj2p = { x: p.y, y: p.z }; }
    let wn = 0;
    for (let i = 0; i < proj2.length; i++) {
      const a3 = proj2[i]; const b3 = proj2[(i + 1) % proj2.length];
      if (a3.y <= proj2p.y) { if (b3.y > proj2p.y && ((b3.x - a3.x) * (proj2p.y - a3.y) - (proj2p.x - a3.x) * (b3.y - a3.y)) > 0) wn++; }
      else if (b3.y <= proj2p.y && ((b3.x - a3.x) * (proj2p.y - a3.y) - (proj2p.x - a3.x) * (b3.y - a3.y)) < 0) wn--;
    }
    return wn !== 0 ? 1 : 8;
  }

  // Internal: live material id strings (used by getters).
  private get materialId(): string | null { return (this.raw as any).materialId ?? null; }
  private get backMaterialId(): string | null { return (this.raw as any).backMaterialId ?? null; }

  /** DraftDown.Face#loops — outer loop + any inner (hole) loops. */
  get loops(): Array<{ vertices(): Vertex[]; edges(): Edge[]; outer(): boolean }> {
    const out: Array<{ vertices(): Vertex[]; edges(): Edge[]; outer(): boolean }> = [];
    const f = this.raw;
    const all = this.vertices;
    const holeStarts = (f.holeStartIndices ?? []) as number[];
    if (holeStarts.length === 0) {
      out.push({ vertices: () => all, edges: () => this.edges, outer: () => true });
      return out;
    }
    // Slice loops by holeStartIndices.
    const ranges: Array<[number, number]> = [];
    let start = 0;
    for (const h of holeStarts) { ranges.push([start, h]); start = h; }
    ranges.push([start, all.length]);
    let isOuter = true;
    for (const [a, b] of ranges) {
      const loopVerts = all.slice(a, b);
      out.push({
        vertices: () => loopVerts,
        edges: () => {
          const eids: Edge[] = [];
          for (let i = 0; i < loopVerts.length; i++) {
            const e = this.ctx.doc.geometry.findEdgeBetween(
              loopVerts[i].id, loopVerts[(i + 1) % loopVerts.length].id);
            if (e) eids.push(new Edge(e.id, this.ctx));
          }
          return eids;
        },
        outer: () => isOuter,
      });
      isOuter = false;
    }
    return out;
  }

  /** DraftDown.Face#followme(path) — sweep this face along an array of edges. */
  followme(pathEdges: Edge[] | Edge): import('./Entities').AnyEntity[] {
    const arr = Array.isArray(pathEdges) ? pathEdges : [pathEdges];
    const ids = arr.map(e => e.id);
    const result = this.ctx.api.sweep(this.entityID, ids, true);
    const wrap: import('./Entities').AnyEntity[] = [];
    for (const fid of result.faceIds) wrap.push(new Face(fid, this.ctx));
    for (const eid of result.edgeIds) wrap.push(new Edge(eid, this.ctx));
    return wrap;
  }

  /**
   * DraftDown.Face#position_material(material, points, on_front=true) — minimal UV mapping.
   * Stores per-vertex UVs computed from the supplied 4-point planar mapping.
   */
  positionMaterial(material: import('./Materials').Material | string, points: Point3d[], onFront = true): Face {
    const matId = typeof material === 'string' ? material : material.id;
    void onFront;
    const f = this.raw;
    if (points.length >= 4) {
      // points[0..3] = uv corners pinned to face vertex 0..3 (or first 4 verts available).
      const uvs: Array<{ u: number; v: number }> = [];
      for (let i = 0; i < f.vertexIds.length; i++) {
        const idx = i % 4;
        // map relative to bounding rect of supplied points
        uvs.push({ u: idx === 1 || idx === 2 ? 1 : 0, v: idx === 2 || idx === 3 ? 1 : 0 });
      }
      f.uvs = uvs;
    }
    if (matId) this.ctx.api.setFaceMaterial([this.entityID], matId);
    this.notifyChange('material');
    return this;
  }

  /** DraftDown.Face#material_application_type — best-effort: 'face' or 'none'. */
  materialApplicationType(): 'face' | 'none' { return this.materialId ? 'face' : 'none'; }

  /** DraftDown.Face#all_connected — every entity reachable from this face. */
  allConnected(): Entity[] {
    const seen = new Set<string>([this.entityID]);
    const out: Entity[] = [this];
    const g = this.ctx.doc.geometry;
    const queue: string[] = [...g.getFaceEdges(this.entityID).map(e => e.id)];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const e = g.getEdge(id);
      if (e) {
        out.push(new Edge(id, this.ctx));
        for (const f of g.getEdgeFaces(id)) if (!seen.has(f.id)) {
          seen.add(f.id); out.push(new Face(f.id, this.ctx));
          for (const fe of g.getFaceEdges(f.id)) if (!seen.has(fe.id)) queue.push(fe.id);
        }
        // Continue walking via vertex incidence.
        for (const ve of g.getVertexEdges(e.startVertexId)) if (!seen.has(ve.id)) queue.push(ve.id);
        for (const ve of g.getVertexEdges(e.endVertexId)) if (!seen.has(ve.id)) queue.push(ve.id);
      }
    }
    return out;
  }
}

/**
 * Generic wrapper used when we encounter an entity ID that doesn't match Vertex/Edge/Face
 * (e.g., a guide line or text). Mirrors DraftDown.Drawingelement's minimal surface so plugins
 * iterating `entities.each` don't crash on unexpected types.
 */
export class Drawingelement extends Entity {
  constructor(id: string, ctx: EntityContext, private kind: string) { super(id, ctx); }
  typename(): string { return this.kind; }
  valid(): boolean { return true; }
}
