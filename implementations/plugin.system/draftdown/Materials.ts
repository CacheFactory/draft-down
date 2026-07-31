// @archigraph plugin.system.draftdown.materials
// DraftDown.Materials and DraftDown.Material wrappers.
// References:
//   
//   

import type { MaterialDef, Color } from '../../../src/core/types';
import type { EntityContext } from './Entity';

/** DraftDown.Color — minimal helper. */
export class Color3 {
  r: number; g: number; b: number; a: number;
  constructor(r: number | string | { r: number; g: number; b: number; a?: number }, g = 0, b = 0, a = 255) {
    if (typeof r === 'object') {
      this.r = r.r; this.g = r.g; this.b = r.b; this.a = r.a ?? 255;
    } else if (typeof r === 'string') {
      // "#RRGGBB" or "rgb(r,g,b)"
      const m = r.match(/^#?([0-9a-f]{6})$/i);
      if (m) {
        this.r = parseInt(m[1].slice(0, 2), 16);
        this.g = parseInt(m[1].slice(2, 4), 16);
        this.b = parseInt(m[1].slice(4, 6), 16);
        this.a = 255;
      } else {
        this.r = 255; this.g = 255; this.b = 255; this.a = 255;
      }
    } else {
      this.r = r; this.g = g; this.b = b; this.a = a;
    }
  }
  toFloat(): Color { return { r: this.r / 255, g: this.g / 255, b: this.b / 255, a: this.a / 255 }; }
  toHex(): string {
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `#${h(this.r)}${h(this.g)}${h(this.b)}`;
  }
}

/** DraftDown.Material */
export class Material {
  constructor(public readonly id: string, private ctx: EntityContext) {}

  private get raw(): MaterialDef {
    const m = this.ctx.doc.materials.getMaterial(this.id);
    if (!m) throw new Error(`Material ${this.id} not found`);
    return m;
  }

  get name(): string { return this.raw.name; }
  set name(n: string) { this.ctx.doc.materials.updateMaterial(this.id, { name: n }); }

  /** DraftDown.Material#color — returns a Color3 in 0..255. */
  get color(): Color3 {
    const c = this.raw.color;
    return new Color3({ r: c.r * 255, g: c.g * 255, b: c.b * 255, a: (c.a ?? 1) * 255 });
  }
  set color(c: Color3 | Color | string) {
    let f: Color;
    if (c instanceof Color3) f = c.toFloat();
    else if (typeof c === 'string') f = new Color3(c).toFloat();
    else f = c;
    this.ctx.doc.materials.updateMaterial(this.id, { color: f });
  }

  /** DraftDown.Material#alpha — 0.0..1.0. */
  get alpha(): number { return this.raw.opacity; }
  set alpha(v: number) { this.ctx.doc.materials.updateMaterial(this.id, { opacity: v }); }

  /** DraftDown.Material#texture — DraftDown stores a URL/data path; return null if none. */
  get texture(): string | null { return this.raw.albedoMap ?? null; }
  set texture(path: string | null) {
    this.ctx.doc.materials.updateMaterial(this.id, { albedoMap: path ?? undefined });
  }
}

/** DraftDown.Materials */
export class Materials {
  constructor(private ctx: EntityContext) {}

  /** Number of materials. */
  get length(): number { return this.ctx.doc.materials.getAllMaterials().length; }
  get count(): number { return this.length; }
  get size(): number { return this.length; }

  /** DraftDown.Materials#each */
  each(fn: (m: Material) => void): void {
    for (const m of this.ctx.doc.materials.getAllMaterials()) fn(new Material(m.id, this.ctx));
  }

  /** DraftDown.Materials#[] — accepts an index or a name. */
  at(key: number | string): Material | null {
    const all = this.ctx.doc.materials.getAllMaterials();
    if (typeof key === 'number') return all[key] ? new Material(all[key].id, this.ctx) : null;
    const found = all.find(m => m.name === key);
    return found ? new Material(found.id, this.ctx) : null;
  }

  /** DraftDown.Materials#add(name) → Material */
  add(name: string, color?: Color3 | string): Material {
    const c = color instanceof Color3 ? color : new Color3(color ?? '#cccccc');
    const id = this.ctx.api.createMaterial(name, c.toFloat(), {});
    return new Material(id, this.ctx);
  }

  /** DraftDown.Materials#current — best-effort: most-recently-added material. */
  get current(): Material | null {
    const all = this.ctx.doc.materials.getAllMaterials();
    return all.length ? new Material(all[all.length - 1].id, this.ctx) : null;
  }

  /** DraftDown.Materials#purge_unused — remove materials not referenced by any face. */
  purgeUnused(): number {
    const g = this.ctx.doc.geometry;
    const used = new Set<string>();
    for (const f of g.getMesh().faces.values()) {
      const m = (f as any).materialId; if (m) used.add(m);
      const bm = (f as any).backMaterialId; if (bm) used.add(bm);
    }
    let removed = 0;
    for (const m of this.ctx.doc.materials.getAllMaterials()) {
      if (!used.has(m.id)) { this.ctx.doc.materials.removeMaterial(m.id); removed++; }
    }
    return removed;
  }

  /** DraftDown.Materials#remove(material) */
  remove(material: Material | string): boolean {
    const id = typeof material === 'string' ? material : material.id;
    if (!this.ctx.doc.materials.getMaterial(id)) return false;
    this.ctx.doc.materials.removeMaterial(id);
    this.emit('remove', id);
    return true;
  }

  /** DraftDown.Materials#unique_name — return a name not currently in use. */
  uniqueName(base: string): string {
    const used = new Set(this.ctx.doc.materials.getAllMaterials().map(m => m.name));
    let name = base; let i = 1;
    while (used.has(name)) name = `${base} #${i++}`;
    return name;
  }

  /** DraftDown.Materials#current — settable. */
  set current(mat: Material | null) { _currentMaterialId = mat?.id ?? null; }

  /** DraftDown.Materials#model */
  model(): unknown { return (this.ctx as any).getModel?.() ?? null; }

  /** DraftDown.Materials#add_observer / #remove_observer */
  addObserver(o: MaterialsObserver): void { materialsObservers.add(o); }
  removeObserver(o: MaterialsObserver): void { materialsObservers.delete(o); }

  private emit(kind: 'add' | 'remove' | 'change', id: string): void {
    const m = this.ctx.doc.materials.getMaterial(id);
    if (!m && kind !== 'remove') return;
    const wrap = m ? new Material(m.id, this.ctx) : null;
    for (const o of materialsObservers) {
      try {
        if (!wrap) continue;
        if (kind === 'add') o.onMaterialAdd?.(this, wrap);
        else if (kind === 'remove') o.onMaterialRemove?.(this, wrap);
        else o.onMaterialChange?.(this, wrap);
      } catch (e) { console.error(e); }
    }
  }
}

let _currentMaterialId: string | null = null;
export function getCurrentMaterialId(): string | null { return _currentMaterialId; }

export interface MaterialsObserver {
  onMaterialAdd?(materials: Materials, mat: Material): void;
  onMaterialChange?(materials: Materials, mat: Material): void;
  onMaterialRemove?(materials: Materials, mat: Material): void;
  onMaterialRefChange?(materials: Materials, mat: Material): void;
  onMaterialSetCurrent?(materials: Materials, mat: Material): void;
  onMaterialUndoRedo?(materials: Materials, mat: Material): void;
}

const materialsObservers = new Set<MaterialsObserver>();
