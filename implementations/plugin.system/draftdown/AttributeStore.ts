// @archigraph plugin.system.draftdown.attribute-store
// Document-level attribute persistence used by DraftDown.Entity#set_attribute /
// #get_attribute. Real DraftDown persists attributes per-entity, surviving save/load
// and undo/redo. We mirror that with a side-table keyed by entity ID, attached to
// the DraftDown module so it survives `setActiveModel(...)` swaps.
//
// Attributes are limited to JSON-safe values — same as DraftDown's accepted types
// (Numeric, String, Boolean, Length, Array, Hash) minus references.

export type AttrValue =
  | string
  | number
  | boolean
  | null
  | AttrValue[]
  | { [k: string]: AttrValue };

interface DictMap { [dictName: string]: { [key: string]: AttrValue } }

/** Per-document attribute table. */
export class AttributeStore {
  private byEntity = new Map<string, DictMap>();
  private byEntityVer = new Map<string, number>();
  /** Subscribers — receive {entityId, dict, key, value, oldValue}. */
  private listeners = new Set<(ev: AttrEvent) => void>();

  get(entityId: string, dict: string, key: string, fallback: AttrValue | undefined = undefined): AttrValue | undefined {
    const dicts = this.byEntity.get(entityId);
    if (!dicts) return fallback;
    const d = dicts[dict];
    if (!d) return fallback;
    return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : fallback;
  }

  set(entityId: string, dict: string, key: string, value: AttrValue): void {
    let dicts = this.byEntity.get(entityId);
    if (!dicts) { dicts = {}; this.byEntity.set(entityId, dicts); }
    let d = dicts[dict];
    if (!d) { d = {}; dicts[dict] = d; }
    const oldValue = d[key];
    d[key] = value;
    this.byEntityVer.set(entityId, (this.byEntityVer.get(entityId) ?? 0) + 1);
    this.emit({ entityId, dict, key, value, oldValue, kind: oldValue === undefined ? 'add' : 'change' });
  }

  delete(entityId: string, dict: string, key: string): boolean {
    const dicts = this.byEntity.get(entityId);
    if (!dicts) return false;
    const d = dicts[dict];
    if (!d) return false;
    if (!Object.prototype.hasOwnProperty.call(d, key)) return false;
    const oldValue = d[key];
    delete d[key];
    if (Object.keys(d).length === 0) delete dicts[dict];
    if (Object.keys(dicts).length === 0) this.byEntity.delete(entityId);
    this.emit({ entityId, dict, key, value: undefined, oldValue, kind: 'remove' });
    return true;
  }

  deleteDict(entityId: string, dict: string): boolean {
    const dicts = this.byEntity.get(entityId);
    if (!dicts || !dicts[dict]) return false;
    delete dicts[dict];
    if (Object.keys(dicts).length === 0) this.byEntity.delete(entityId);
    this.emit({ entityId, dict, key: '*', value: undefined, oldValue: undefined, kind: 'remove' });
    return true;
  }

  /** All dictionary names for an entity. */
  dictionaryNames(entityId: string): string[] {
    const dicts = this.byEntity.get(entityId);
    return dicts ? Object.keys(dicts) : [];
  }

  /** All keys in a dictionary for an entity. */
  keys(entityId: string, dict: string): string[] {
    const d = this.byEntity.get(entityId)?.[dict];
    return d ? Object.keys(d) : [];
  }

  /** Snapshot for serialization. */
  serialize(): Record<string, DictMap> {
    const out: Record<string, DictMap> = {};
    for (const [id, dicts] of this.byEntity) out[id] = JSON.parse(JSON.stringify(dicts));
    return out;
  }

  load(data: Record<string, DictMap> | undefined | null): void {
    this.byEntity.clear();
    if (!data) return;
    for (const id of Object.keys(data)) this.byEntity.set(id, JSON.parse(JSON.stringify(data[id])));
  }

  /** Bump the entity ID after a remap (e.g., after deserialize). */
  reassign(oldId: string, newId: string): void {
    if (oldId === newId) return;
    const v = this.byEntity.get(oldId);
    if (!v) return;
    this.byEntity.set(newId, v);
    this.byEntity.delete(oldId);
  }

  on(fn: (ev: AttrEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private emit(ev: AttrEvent): void {
    for (const fn of this.listeners) try { fn(ev); } catch (e) { console.error(e); }
  }
}

export interface AttrEvent {
  entityId: string;
  dict: string;
  key: string;
  value: AttrValue | undefined;
  oldValue: AttrValue | undefined;
  kind: 'add' | 'change' | 'remove';
}
