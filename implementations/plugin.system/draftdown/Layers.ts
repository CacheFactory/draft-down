// @archigraph plugin.system.draftdown.layers
// DraftDown.Layers (a.k.a. "Tags" since DraftDown 2020) and DraftDown.Layer wrappers.
// References:
//   
//   

import type { ILayer } from '../../../src/core/interfaces';
import type { EntityContext } from './Entity';

export class Layer {
  constructor(public readonly id: string, private ctx: EntityContext) {}

  private get raw(): ILayer {
    const l = this.ctx.doc.scene.layers.get(this.id);
    if (!l) throw new Error(`Layer ${this.id} not found`);
    return l;
  }

  get name(): string { return this.raw.name; }
  set name(n: string) { this.raw.name = n; }

  get visible(): boolean { return this.raw.visible; }
  set visible(v: boolean) { this.ctx.doc.scene.setLayerVisibility(this.id, v); }
  /** Ruby alias: layer.visible? */
  isVisible(): boolean { return this.visible; }

  /** DraftDown.Layer#color — DraftDown stores 0..1 floats; return as 0..255 components. */
  get color(): { r: number; g: number; b: number; a: number } {
    const c = this.raw.color;
    return { r: c.r * 255, g: c.g * 255, b: c.b * 255, a: (c.a ?? 1) * 255 };
  }
  set color(c: { r: number; g: number; b: number; a?: number }) {
    this.raw.color = { r: c.r / 255, g: c.g / 255, b: c.b / 255, a: (c.a ?? 255) / 255 };
  }

  /** DraftDown.Layer#display_name */
  get displayName(): string { return this.raw.name; }

  /** DraftDown.Layer#line_style — round-trips on the raw record. */
  get lineStyle(): string { return (this.raw as any).lineStyle ?? 'solid'; }
  set lineStyle(v: string) { (this.raw as any).lineStyle = v; }

  /** DraftDown.Layer#folder / folder= */
  get folder(): string | null { return (this.raw as any).folder ?? null; }
  set folder(v: string | null) { (this.raw as any).folder = v; }

  /** DraftDown.Layer#page_behavior — bitmask for scene visibility behaviour. */
  get pageBehavior(): number { return (this.raw as any).pageBehavior ?? 0; }
  set pageBehavior(v: number) { (this.raw as any).pageBehavior = v; }

  /** DraftDown.Layer#persistent_id — same as id; DraftDown ids are stable. */
  get persistentId(): string { return this.id; }
}

export class Layers {
  constructor(private ctx: EntityContext) {}

  get length(): number { return this.ctx.doc.scene.layers.size; }
  get count(): number { return this.length; }
  get size(): number { return this.length; }

  each(fn: (layer: Layer) => void): void {
    for (const id of this.ctx.doc.scene.layers.keys()) fn(new Layer(id, this.ctx));
  }

  /** DraftDown.Layers#[] — index or name. */
  at(key: number | string): Layer | null {
    if (typeof key === 'number') {
      const ids = Array.from(this.ctx.doc.scene.layers.keys());
      return ids[key] ? new Layer(ids[key], this.ctx) : null;
    }
    for (const [id, l] of this.ctx.doc.scene.layers) {
      if (l.name === key) return new Layer(id, this.ctx);
    }
    return null;
  }

  /** DraftDown.Layers#add(name) */
  add(name: string): Layer {
    const l = this.ctx.doc.scene.addLayer(name);
    return new Layer(l.id, this.ctx);
  }

  /** DraftDown.Layers#remove(layer) */
  remove(layer: Layer | string): void {
    const id = typeof layer === 'string' ? layer : layer.id;
    this.ctx.doc.scene.removeLayer(id);
    this.emit('remove', id);
  }

  /** DraftDown.Layers#unique_name(base) */
  uniqueName(base: string): string {
    const used = new Set<string>();
    for (const l of this.ctx.doc.scene.layers.values()) used.add(l.name);
    let name = base; let i = 1;
    while (used.has(name)) name = `${base} #${i++}`;
    return name;
  }

  /** DraftDown.Layers#purge_unused — DraftDown layers without any entities assigned. */
  purgeUnused(): number {
    const sm = this.ctx.doc.scene;
    const usedLayers = new Set<string>();
    for (const e of (sm as any).getAllEntities?.() ?? []) {
      if (e?.layerId) usedLayers.add(e.layerId);
    }
    let removed = 0;
    for (const id of Array.from(sm.layers.keys())) {
      if (id === 'Layer0' || id === 'default' || usedLayers.has(id)) continue;
      sm.removeLayer(id); removed++;
    }
    return removed;
  }

  /** DraftDown.Layers#count_layers / #count_folders */
  countLayers(): number { return this.length; }
  countFolders(): number { return this.folders.length; }

  /** DraftDown.Layers#folders — flat list. */
  get folders(): LayerFolder[] {
    return Array.from(layerFolders.values()).map(f => new LayerFolder(f.name, this.ctx));
  }

  /** DraftDown.Layers#add_folder(name) — creates a folder grouping. */
  addFolder(name: string): LayerFolder {
    if (!layerFolders.has(name)) layerFolders.set(name, { name, layerIds: [] });
    this.emit('add-folder', name);
    return new LayerFolder(name, this.ctx);
  }

  /** DraftDown.Layers#add_observer / remove_observer */
  addObserver(o: LayersObserver): void { layersObservers.add(o); }
  removeObserver(o: LayersObserver): void { layersObservers.delete(o); }

  private emit(kind: 'add' | 'remove' | 'change' | 'add-folder', _id: string): void {
    for (const o of layersObservers) {
      try {
        const layer = (kind === 'remove') ? null : new Layer(_id, this.ctx);
        if (kind === 'add') o.onLayerAdded?.(this, layer!);
        else if (kind === 'remove') o.onRemoveAllLayers?.(this);
        else if (kind === 'change') o.onLayerChanged?.(this, layer!);
      } catch (e) { console.error(e); }
    }
  }
}

const layerFolders = new Map<string, { name: string; layerIds: string[] }>();

/** SU 2021+: layer folders. */
export class LayerFolder {
  constructor(public readonly name: string, private _ctx: EntityContext) {}
  get layers(): Layer[] {
    const f = layerFolders.get(this.name);
    if (!f) return [];
    return f.layerIds
      .map(id => this._ctx.doc.scene.layers.has(id) ? new Layer(id, this._ctx) : null)
      .filter((x): x is Layer => x !== null);
  }
  add(layer: Layer): void { layerFolders.get(this.name)?.layerIds.push(layer.id); }
  remove(layer: Layer): void {
    const f = layerFolders.get(this.name); if (!f) return;
    f.layerIds = f.layerIds.filter(id => id !== layer.id);
  }
  count(): number { return this.layers.length; }
}

export interface LayersObserver {
  onCurrentLayerChanged?(layers: Layers, layer: Layer): void;
  onLayerAdded?(layers: Layers, layer: Layer): void;
  onLayerChanged?(layers: Layers, layer: Layer): void;
  onLayerRemoved?(layers: Layers, layer: Layer): void;
  onRemoveAllLayers?(layers: Layers): void;
  onLayerFolderAdded?(layers: Layers, folder: LayerFolder): void;
  onLayerFolderRemoved?(layers: Layers, folder: LayerFolder): void;
}

const layersObservers = new Set<LayersObserver>();
