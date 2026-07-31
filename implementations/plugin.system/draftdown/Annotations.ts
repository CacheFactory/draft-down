// @archigraph plugin.system.draftdown.annotations
// DraftDown.Text, DraftDown.Image, DraftDown.DimensionLinear, DraftDown.DimensionRadial,
// DraftDown.ConstructionLine, DraftDown.ConstructionPoint.
//
// We back these with the renderer's guide-line system + DraftDown's dimension store
// so they survive the lifecycle and integrate with the existing visual layer.

import type { IModelDocument } from '../../../src/core/interfaces';
import type { Vec3, Color } from '../../../src/core/types';
import { Entity, EntityContext } from './Entity';
import { Point3d, Vector3d } from './Geom';

/** Helper — generate a stable plugin-entity id. */
let nextAnnotId = 1;
function newAnnotId(prefix: string): string { return `${prefix}-${nextAnnotId++}-${Date.now().toString(36)}`; }

// ─── Construction Line ──────────────────────────────────────────

export class ConstructionLine extends Entity {
  static create(ctx: EntityContext, start: Point3d, end: Point3d): ConstructionLine {
    const id = newAnnotId('cline');
    const renderer = (ctx.doc as any).renderer ?? (window as any).draftdownRenderer;
    if (renderer?.addGuideLine) {
      renderer.addGuideLine(
        id,
        { x: start.x, y: start.y, z: start.z },
        { x: end.x, y: end.y, z: end.z },
        { r: 0.4, g: 0.4, b: 0.4, a: 1 } as Color,
        true, // dashed
        { depthTest: true, opacity: 0.7 },
      );
    }
    constructionLineRegistry.set(id, { start, end, ctx });
    return new ConstructionLine(id, ctx);
  }
  typename(): string { return 'ConstructionLine'; }

  get start(): Point3d { return constructionLineRegistry.get(this.entityID)?.start ?? new Point3d(); }
  get end(): Point3d { return constructionLineRegistry.get(this.entityID)?.end ?? new Point3d(); }
  /** ConstructionLine#direction */
  get direction(): Vector3d {
    const a = this.start; const b = this.end;
    return new Vector3d(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
  }
  get position(): Point3d { return this.start; }
  /** ConstructionLine#stipple — DraftDown construction lines are always dashed. */
  get stipple(): string { return '-'; }

  eraseInPlace(): void {
    const renderer = ((this.ctx.doc as any).renderer ?? (window as any).draftdownRenderer);
    renderer?.removeGuideLine?.(this.entityID);
    constructionLineRegistry.delete(this.entityID);
  }
}
const constructionLineRegistry = new Map<string, { start: Point3d; end: Point3d; ctx: EntityContext }>();

// ─── Construction Point ─────────────────────────────────────────

export class ConstructionPoint extends Entity {
  static create(ctx: EntityContext, p: Point3d): ConstructionPoint {
    const id = newAnnotId('cpoint');
    const renderer = (ctx.doc as any).renderer ?? (window as any).draftdownRenderer;
    if (renderer?.addGuideLine) {
      // Render as a tiny crosshair (3 segments) tagged with the same id.
      const e = 0.05;
      renderer.addGuideLine(`${id}-x`, { x: p.x - e, y: p.y, z: p.z }, { x: p.x + e, y: p.y, z: p.z }, { r: 0.3, g: 0.3, b: 0.3, a: 1 }, false);
      renderer.addGuideLine(`${id}-y`, { x: p.x, y: p.y - e, z: p.z }, { x: p.x, y: p.y + e, z: p.z }, { r: 0.3, g: 0.3, b: 0.3, a: 1 }, false);
      renderer.addGuideLine(`${id}-z`, { x: p.x, y: p.y, z: p.z - e }, { x: p.x, y: p.y, z: p.z + e }, { r: 0.3, g: 0.3, b: 0.3, a: 1 }, false);
    }
    constructionPointRegistry.set(id, { position: p });
    return new ConstructionPoint(id, ctx);
  }
  typename(): string { return 'ConstructionPoint'; }
  get position(): Point3d { return constructionPointRegistry.get(this.entityID)?.position ?? new Point3d(); }

  eraseInPlace(): void {
    const renderer = ((this.ctx.doc as any).renderer ?? (window as any).draftdownRenderer);
    if (renderer?.removeGuideLine) {
      renderer.removeGuideLine(`${this.entityID}-x`);
      renderer.removeGuideLine(`${this.entityID}-y`);
      renderer.removeGuideLine(`${this.entityID}-z`);
    }
    constructionPointRegistry.delete(this.entityID);
  }
}
const constructionPointRegistry = new Map<string, { position: Point3d }>();

// ─── Text ───────────────────────────────────────────────────────

export class Text extends Entity {
  static create(ctx: EntityContext, text: string, position: Point3d, leader?: Vector3d): Text {
    const id = newAnnotId('text');
    textRegistry.set(id, { text, position, leader: leader ?? null });
    // Best-effort: emit a CustomEvent so renderer text overlay can subscribe.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('draftdown:text-add', { detail: { id, text, position, leader } }));
    }
    return new Text(id, ctx);
  }
  typename(): string { return 'Text'; }

  get text(): string { return textRegistry.get(this.entityID)?.text ?? ''; }
  set text(v: string) { const r = textRegistry.get(this.entityID); if (r) r.text = v; }

  get point(): Point3d { return textRegistry.get(this.entityID)?.position ?? new Point3d(); }
  set point(p: Point3d) { const r = textRegistry.get(this.entityID); if (r) r.position = p; }

  /** Text#has_leader? */
  hasLeader(): boolean { return !!textRegistry.get(this.entityID)?.leader; }
  get vector(): Vector3d | null { return textRegistry.get(this.entityID)?.leader ?? null; }
  set vector(v: Vector3d | null) { const r = textRegistry.get(this.entityID); if (r) r.leader = v; }

  /** Text#display_leader= — toggles a flag. */
  displayLeader(v: boolean): void { const r = textRegistry.get(this.entityID); if (r) (r as any).displayLeader = v; }

  eraseInPlace(): void {
    textRegistry.delete(this.entityID);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('draftdown:text-remove', { detail: { id: this.entityID } }));
  }
}
const textRegistry = new Map<string, { text: string; position: Point3d; leader: Vector3d | null }>();

// ─── Image ──────────────────────────────────────────────────────

export class Image extends Entity {
  static create(ctx: EntityContext, path: string, position: Point3d, width: number, height: number): Image {
    const id = newAnnotId('image');
    imageRegistry.set(id, { path, position, width, height, rotation: 0 });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('draftdown:image-add', { detail: { id, path, position, width, height } }));
    }
    return new Image(id, ctx);
  }
  typename(): string { return 'Image'; }

  get path(): string { return imageRegistry.get(this.entityID)?.path ?? ''; }
  get origin(): Point3d { return imageRegistry.get(this.entityID)?.position ?? new Point3d(); }
  set origin(p: Point3d) { const r = imageRegistry.get(this.entityID); if (r) r.position = p; }
  get width(): number { return imageRegistry.get(this.entityID)?.width ?? 0; }
  get height(): number { return imageRegistry.get(this.entityID)?.height ?? 0; }
  get pixelheight(): number { return this.height; }
  get pixelwidth(): number { return this.width; }
  /** Image#transformation — minimal: position-based. */
  get transformation(): unknown { return null; }

  eraseInPlace(): void {
    imageRegistry.delete(this.entityID);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('draftdown:image-remove', { detail: { id: this.entityID } }));
  }
}
const imageRegistry = new Map<string, { path: string; position: Point3d; width: number; height: number; rotation: number }>();

// ─── Dimension ──────────────────────────────────────────────────

export class DimensionLinear extends Entity {
  static create(ctx: EntityContext, start: Point3d, end: Point3d, offset: Vector3d, value?: string): DimensionLinear {
    const id = newAnnotId('dim');
    dimensionRegistry.set(id, { kind: 'linear', start, end, offset, value: value ?? '', text: value ?? '' });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('draftdown:dim-add', { detail: { id, kind: 'linear', start, end, offset } }));
    }
    return new DimensionLinear(id, ctx);
  }
  typename(): string { return 'DimensionLinear'; }

  get start(): Point3d { return dimensionRegistry.get(this.entityID)!.start as Point3d; }
  get end(): Point3d { return dimensionRegistry.get(this.entityID)!.end as Point3d; }
  get offsetVector(): Vector3d { return dimensionRegistry.get(this.entityID)!.offset as Vector3d; }
  get text(): string {
    const r = dimensionRegistry.get(this.entityID)!;
    return r.text || `${this.start.distance(this.end).toFixed(3)}`;
  }
  set text(v: string) { dimensionRegistry.get(this.entityID)!.text = v; }

  eraseInPlace(): void {
    dimensionRegistry.delete(this.entityID);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('draftdown:dim-remove', { detail: { id: this.entityID } }));
  }
}

export class DimensionRadial extends Entity {
  static create(ctx: EntityContext, edgeId: string, leader: Vector3d, value?: string): DimensionRadial {
    const id = newAnnotId('dim');
    dimensionRegistry.set(id, { kind: 'radial', edgeId, leader, value: value ?? '', text: value ?? '' });
    return new DimensionRadial(id, ctx);
  }
  typename(): string { return 'DimensionRadial'; }
  get edgeId(): string { return (dimensionRegistry.get(this.entityID) as any).edgeId; }
  get leader(): Vector3d { return (dimensionRegistry.get(this.entityID) as any).leader; }
  get text(): string { return dimensionRegistry.get(this.entityID)!.text; }
  set text(v: string) { dimensionRegistry.get(this.entityID)!.text = v; }
  eraseInPlace(): void { dimensionRegistry.delete(this.entityID); }
}
const dimensionRegistry = new Map<string, any>();

/** Iterate all annotations (used by Entities.toArray() / .each / .clear!). */
export function listAllAnnotations(ctx: EntityContext): Entity[] {
  const out: Entity[] = [];
  for (const id of constructionLineRegistry.keys()) out.push(new ConstructionLine(id, ctx));
  for (const id of constructionPointRegistry.keys()) out.push(new ConstructionPoint(id, ctx));
  for (const id of textRegistry.keys()) out.push(new Text(id, ctx));
  for (const id of imageRegistry.keys()) out.push(new Image(id, ctx));
  for (const id of dimensionRegistry.keys()) {
    const r = dimensionRegistry.get(id);
    if (r.kind === 'linear') out.push(new DimensionLinear(id, ctx));
    else if (r.kind === 'radial') out.push(new DimensionRadial(id, ctx));
  }
  return out;
}
export function clearAllAnnotations(): void {
  constructionLineRegistry.clear();
  constructionPointRegistry.clear();
  textRegistry.clear();
  imageRegistry.clear();
  dimensionRegistry.clear();
}
/** Used by Entities.byId to look up annotations. */
export function findAnnotationById(id: string, ctx: EntityContext): Entity | null {
  if (constructionLineRegistry.has(id)) return new ConstructionLine(id, ctx);
  if (constructionPointRegistry.has(id)) return new ConstructionPoint(id, ctx);
  if (textRegistry.has(id)) return new Text(id, ctx);
  if (imageRegistry.has(id)) return new Image(id, ctx);
  const dim = dimensionRegistry.get(id);
  if (dim) return dim.kind === 'linear' ? new DimensionLinear(id, ctx) : new DimensionRadial(id, ctx);
  return null;
}
