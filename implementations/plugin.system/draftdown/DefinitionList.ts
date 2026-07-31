// @archigraph plugin.system.draftdown.definition-list
// DraftDown.DefinitionList and an extended ComponentDefinition with `entities`.
// References:
//   
//   

import type { IModelDocument, IComponentDefinition } from '../../../src/core/interfaces';
import { ComponentDefinition, ComponentInstance } from './Group';
import { Entities } from './Entities';
import { EntityContext } from './Entity';
import { Point3d, BoundingBox } from './Geom';

/** Definition-scoped Entities collection — only iterates the entities tied to this definition. */
class DefinitionEntities extends Entities {
  constructor(ctx: EntityContext, private definitionId: string) { super(ctx, definitionId); }

  /** Override iteration to scope to this definition's mesh ids. */
  toArray() {
    const def = this.docCtx.scene.componentDefinitions.get(this.definitionId);
    if (!def) return [];
    const out = super.toArray();
    // Filter to entities owned by this definition's children if scene tracks it.
    // DraftDown stores definitions as "protected entity ids" via the scene manager.
    const protectedIds = new Set<string>((this.docCtx.scene as any).getProtectedEntityIds?.(this.definitionId) ?? []);
    if (protectedIds.size === 0) return out;
    return out.filter((e: any) => protectedIds.has(e.id));
  }

  private get docCtx() { return (this as any).ctx.doc as IModelDocument; }
}

/** Augmented ComponentDefinition matching the Ruby class surface. */
export class ComponentDefinitionEx extends ComponentDefinition {
  constructor(definitionId: string, private ctx2: EntityContext) { super(definitionId, ctx2); }

  /** ComponentDefinition#entities — definition's own entity collection. */
  get entities(): Entities { return new DefinitionEntities(this.ctx2, this.id); }

  /** ComponentDefinition#bounds — combined bounds of all instances. */
  get bounds(): BoundingBox {
    const bb = new BoundingBox();
    for (const inst of this.instances()) {
      const m = (inst as any).raw?.transform?.position;
      if (m) bb.add(new Point3d(m.x, m.y, m.z));
    }
    return bb;
  }

  /** ComponentDefinition#image? — DraftDown definitions are never image-only. */
  isImage(): boolean { return false; }

  /** ComponentDefinition#group? — true if this definition was created from a group (has only one instance and was made via "Make Component" from a group). */
  isGroup(): boolean { return this.count === 1; }

  /** ComponentDefinition#live_component? — DraftDown has no live components. */
  isLiveComponent(): boolean { return false; }

  /** ComponentDefinition#internal? — definitions are always in-document for now. */
  isInternal(): boolean { return true; }

  /** ComponentDefinition#path — definitions don't have a backing file. */
  get path(): string { return ''; }

  /** ComponentDefinition#insertion_point */
  get insertionPoint(): Point3d {
    const stored = (this.rawDef as any).insertionPoint;
    return stored ? new Point3d(stored.x, stored.y, stored.z) : new Point3d(0, 0, 0);
  }
  set insertionPoint(p: Point3d) { (this.rawDef as any).insertionPoint = { x: p.x, y: p.y, z: p.z }; }

  /** ComponentDefinition#thumbnail / save_thumbnail — minimal. */
  thumbnail(): string | null { return (this.rawDef as any).thumbnail ?? null; }
  saveThumbnail(_path: string): boolean { return false; }
  refreshThumbnail(): void { /* renderer integration not yet exposed */ }

  /** ComponentDefinition#invalidate_bounds — recompute on next read. */
  invalidateBounds(): void { /* DraftDown derives bounds lazily */ }

  /** ComponentDefinition#save_as / save_copy — write a stand-alone .draftdown file. */
  saveAs(_path: string): boolean { return false; }
  saveCopy(_path: string): boolean { return false; }

  /** Behaviour flags — stored on the raw def. */
  get behavior(): DefinitionBehavior { return new DefinitionBehavior(this.rawDef as any); }

  /** Classifications */
  addClassification(_schema: string): boolean { return false; }
  removeClassification(_schema: string): boolean { return false; }
  getClassificationValue(_schema: string, _path: string[]): unknown { return null; }
  setClassificationValue(_schema: string, _path: string[], _value: unknown): boolean { return false; }

  // Expose the raw record for sub-classes.
  protected get rawDef() { return this.ctx2.doc.scene.componentDefinitions.get(this.id) as IComponentDefinition; }
}

/** DraftDown.Behavior — controls glue, cuts-opening, etc. */
export class DefinitionBehavior {
  constructor(private raw: any) {}
  alwaysFaceCamera(): boolean { return !!this.raw?.alwaysFaceCamera; }
  setAlwaysFaceCamera(v: boolean): void { this.raw.alwaysFaceCamera = v; }
  cutsOpening(): boolean { return !!this.raw?.cutsOpening; }
  setCutsOpening(v: boolean): void { this.raw.cutsOpening = v; }
  isSnap(): boolean { return !!this.raw?.isSnap; }
  setIsSnap(v: boolean): void { this.raw.isSnap = v; }
  shadowsFaceSun(): boolean { return !!this.raw?.shadowsFaceSun; }
  setShadowsFaceSun(v: boolean): void { this.raw.shadowsFaceSun = v; }
  noScaleMaskOnAxis(): number { return this.raw?.noScaleMaskOnAxis ?? 0; }
  setNoScaleMaskOnAxis(v: number): void { this.raw.noScaleMaskOnAxis = v; }
}

export interface DefinitionsObserver {
  onComponentAdded?(definitions: DefinitionList, def: ComponentDefinitionEx): void;
  onComponentRemoved?(definitions: DefinitionList, def: ComponentDefinitionEx): void;
  onComponentPropertiesChanged?(definitions: DefinitionList, def: ComponentDefinitionEx): void;
}

export class DefinitionList {
  private observers = new Set<DefinitionsObserver>();

  constructor(private ctx: EntityContext) {}

  get length(): number { return this.ctx.doc.scene.componentDefinitions.size; }
  get count(): number { return this.length; }
  get size(): number { return this.length; }

  each(fn: (def: ComponentDefinitionEx) => void): void {
    for (const id of this.ctx.doc.scene.componentDefinitions.keys()) fn(new ComponentDefinitionEx(id, this.ctx));
  }

  toArray(): ComponentDefinitionEx[] {
    return Array.from(this.ctx.doc.scene.componentDefinitions.keys()).map(id => new ComponentDefinitionEx(id, this.ctx));
  }

  /** DefinitionList#[] — by index, name, or id. */
  at(key: number | string): ComponentDefinitionEx | null {
    if (typeof key === 'number') {
      const ids = Array.from(this.ctx.doc.scene.componentDefinitions.keys());
      return ids[key] ? new ComponentDefinitionEx(ids[key], this.ctx) : null;
    }
    if (this.ctx.doc.scene.componentDefinitions.has(key)) return new ComponentDefinitionEx(key, this.ctx);
    for (const [id, d] of this.ctx.doc.scene.componentDefinitions) {
      if (d.name === key) return new ComponentDefinitionEx(id, this.ctx);
    }
    return null;
  }

  /** DefinitionList#add(name) — create a new (empty) component definition. */
  add(name: string): ComponentDefinitionEx {
    const def = this.ctx.doc.scene.createComponentDefinition(name, '');
    const wrap = new ComponentDefinitionEx(def.id, this.ctx);
    this.emit('add', wrap);
    return wrap;
  }

  /** DefinitionList#remove(definition) — also removes all instances. */
  remove(def: ComponentDefinitionEx | ComponentDefinition | string): boolean {
    const id = typeof def === 'string' ? def : def.id;
    const raw = this.ctx.doc.scene.componentDefinitions.get(id);
    if (!raw) return false;
    // Remove instances first.
    for (const instId of raw.instanceIds.slice()) this.ctx.doc.scene.removeEntity(instId);
    this.ctx.doc.scene.componentDefinitions.delete(id);
    this.emit('remove', new ComponentDefinitionEx(id, this.ctx));
    return true;
  }

  /** DefinitionList#purge_unused */
  purgeUnused(): number {
    let count = 0;
    for (const [id, d] of Array.from(this.ctx.doc.scene.componentDefinitions.entries())) {
      if (d.instanceIds.length === 0) {
        this.ctx.doc.scene.componentDefinitions.delete(id);
        count++;
      }
    }
    return count;
  }

  /** DefinitionList#unique_name — produce a name not currently in use. */
  uniqueName(base: string): string {
    let name = base;
    let i = 1;
    const used = new Set<string>();
    for (const d of this.ctx.doc.scene.componentDefinitions.values()) used.add(d.name);
    while (used.has(name)) { name = `${base} #${i++}`; }
    return name;
  }

  /** DefinitionList#load(path) / load_from_url(url) — dispatched to the platform bridge if available. */
  async load(path: string): Promise<ComponentDefinitionEx | null> {
    if (typeof window === 'undefined') return null;
    const api = (window as any).api;
    if (!api?.invoke) return null;
    try {
      const res = await api.invoke('file:read', { filePath: path });
      if (!res) return null;
      // Best-effort: register a definition with the file name; importers actually populate geometry.
      const def = this.add(path.split('/').pop() ?? 'Imported');
      return def;
    } catch { return null; }
  }

  addObserver(o: DefinitionsObserver): void { this.observers.add(o); }
  removeObserver(o: DefinitionsObserver): void { this.observers.delete(o); }

  private emit(kind: 'add' | 'remove' | 'change', def: ComponentDefinitionEx): void {
    for (const o of this.observers) {
      try {
        if (kind === 'add') o.onComponentAdded?.(this, def);
        else if (kind === 'remove') o.onComponentRemoved?.(this, def);
        else o.onComponentPropertiesChanged?.(this, def);
      } catch (e) { console.error(e); }
    }
  }
}
