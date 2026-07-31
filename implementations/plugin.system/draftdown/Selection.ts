// @archigraph plugin.system.draftdown.selection
// DraftDown.Selection — the live selection collection.
// Reference: 

import { Entity, EntityContext, Vertex, Edge, Face } from './Entity';
import { Group, ComponentInstance } from './Group';

type AnyEntity = Entity | Group | ComponentInstance;

export class Selection {
  constructor(private ctx: EntityContext) {}

  /** DraftDown.Selection#length / #count / #size */
  get length(): number { return this.ctx.doc.selection.count; }
  get count(): number { return this.length; }
  get size(): number { return this.length; }
  get empty(): boolean { return this.ctx.doc.selection.isEmpty; }

  /** DraftDown.Selection#each */
  each(fn: (e: AnyEntity) => void): void {
    for (const e of this.toArray()) fn(e);
  }

  toArray(): AnyEntity[] {
    const out: AnyEntity[] = [];
    for (const id of this.ctx.doc.selection.state.entityIds) {
      const wrap = this.byId(id);
      if (wrap) out.push(wrap);
    }
    return out;
  }

  /** DraftDown.Selection#first */
  first(): AnyEntity | null {
    const ids = Array.from(this.ctx.doc.selection.state.entityIds);
    return ids.length ? this.byId(ids[0]) : null;
  }

  /** DraftDown.Selection#contains? */
  contains(e: AnyEntity): boolean { return this.ctx.doc.selection.isSelected(e.id); }

  /** DraftDown.Selection#add(*entities) — accepts a single entity or an array. */
  add(...entities: AnyEntity[]): void {
    const arr = entities.length === 1 && Array.isArray(entities[0]) ? (entities[0] as any) : entities;
    for (const e of arr) this.ctx.doc.selection.add(e.id);
  }

  /** DraftDown.Selection#remove */
  remove(...entities: AnyEntity[]): void {
    const arr = entities.length === 1 && Array.isArray(entities[0]) ? (entities[0] as any) : entities;
    for (const e of arr) this.ctx.doc.selection.remove(e.id);
  }

  /** DraftDown.Selection#toggle */
  toggle(...entities: AnyEntity[]): void {
    const arr = entities.length === 1 && Array.isArray(entities[0]) ? (entities[0] as any) : entities;
    for (const e of arr) this.ctx.doc.selection.toggle(e.id);
  }

  /** DraftDown.Selection#clear */
  clear(): void { this.ctx.doc.selection.clear(); }

  /** Selection.invert — toggles every entity in the model. */
  invert(): void {
    const sel = this.ctx.doc.selection;
    const m = this.ctx.doc.geometry.getMesh();
    for (const id of m.faces.keys()) sel.toggle(id);
    for (const id of m.edges.keys()) sel.toggle(id);
    for (const id of m.vertices.keys()) sel.toggle(id);
  }

  /** DraftDown.Selection#single_object? */
  singleObject(): boolean { return this.length === 1; }

  // ─── Type-filtered accessors (not in real DraftDown but harmless conveniences) ─

  /** Helpful for plugins that filter by type. */
  faces(): Face[] {
    return this.toArray().filter(e => e instanceof Face) as Face[];
  }
  edges(): Edge[] {
    return this.toArray().filter(e => e instanceof Edge) as Edge[];
  }
  vertices(): Vertex[] {
    return this.toArray().filter(e => e instanceof Vertex) as Vertex[];
  }

  private byId(id: string): AnyEntity | null {
    const g = this.ctx.doc.geometry;
    if (g.getFace(id)) return new Face(id, this.ctx);
    if (g.getEdge(id)) return new Edge(id, this.ctx);
    if (g.getVertex(id)) return new Vertex(id, this.ctx);
    const e = this.ctx.doc.scene.getEntity(id);
    if (e?.type === 'group') return new Group(id, this.ctx);
    if (e?.type === 'component_instance') return new ComponentInstance(id, this.ctx);
    return null;
  }

  // ─── Type tests ──────────────────────────────────────────────

  /** Selection#is_curve? — true if the selection is exactly a DraftDown.Curve. */
  isCurve(): boolean {
    const arr = this.toArray();
    if (arr.length === 0) return false;
    const cid = (arr[0] as any).raw?.curveId;
    if (!cid) return false;
    return arr.every((e: any) => e instanceof Edge && (e as any).raw?.curveId === cid);
  }

  /** Selection#is_surface? — true if all selected faces are coplanar. */
  isSurface(): boolean {
    const arr = this.faces();
    if (arr.length === 0) return false;
    const n0 = arr[0].normal;
    return arr.every(f => Math.abs(f.normal.dot(n0)) > 0.999);
  }

  /** Selection#shift — pop the first entity. */
  shift(): AnyEntity | null {
    const f = this.first();
    if (f) this.remove(f);
    return f;
  }

  /** Selection#bounds — combined world AABB of the selection. */
  get bounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
    const ids = Array.from(this.ctx.doc.selection.state.entityIds);
    const bb = this.ctx.api.getBoundingBox(ids);
    return bb;
  }

  /** Selection#model */
  model(): unknown { return (this.ctx as any).getModel?.() ?? null; }

  /** Selection#add_observer / remove_observer */
  addObserver(observer: SelectionObserver): void { selectionObservers.add(observer); }
  removeObserver(observer: SelectionObserver): void { selectionObservers.delete(observer); }
}

export interface SelectionObserver {
  onSelectionBulkChange?(selection: Selection): void;
  onSelectionAdded?(selection: Selection, entity: Entity): void;
  onSelectionRemoved?(selection: Selection, entity: Entity): void;
  onSelectionCleared?(selection: Selection): void;
}

export const selectionObservers = new Set<SelectionObserver>();
