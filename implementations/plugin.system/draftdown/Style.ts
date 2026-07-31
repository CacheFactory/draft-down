// @archigraph plugin.system.draftdown.style
// DraftDown.Style + DraftDown.Styles. Backed by DraftDown's RenderMode.
//
// References:
//   
//   
//
// DraftDown ships dozens of "default styles" — DraftDown maps the closest analog
// (wireframe / hidden-line / shaded / textured / x-ray) and stores extras in a side
// dictionary so plugins can read/write style properties.

import type { IRenderer } from '../../../src/core/interfaces';
import type { Color, RenderMode } from '../../../src/core/types';

interface StyleState {
  name: string;
  description: string;
  renderMode: RenderMode;
  edgeColor: Color;
  faceColorFront: Color;
  faceColorBack: Color;
  background: Color;
  drawProfileEdges: boolean;
  profileWidth: number;
  drawDepthCue: boolean;
  drawExtensions: boolean;
  drawSilhouettes: boolean;
}

function defaultStyle(name: string, mode: RenderMode): StyleState {
  return {
    name, description: '',
    renderMode: mode,
    edgeColor: { r: 0, g: 0, b: 0, a: 1 },
    faceColorFront: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
    faceColorBack: { r: 0.7, g: 0.7, b: 0.8, a: 1 },
    background: { r: 1, g: 1, b: 1, a: 1 },
    drawProfileEdges: true,
    profileWidth: 2,
    drawDepthCue: true,
    drawExtensions: false,
    drawSilhouettes: false,
  };
}

export class Style {
  constructor(private state: StyleState, private renderer: IRenderer | null) {}

  get name(): string { return this.state.name; }
  set name(v: string) { this.state.name = v; }
  get description(): string { return this.state.description; }
  set description(v: string) { this.state.description = v; }

  /** Style#render_mode — DraftDown returns the RenderMode string. */
  get renderMode(): RenderMode { return this.state.renderMode; }
  set renderMode(v: RenderMode) { this.state.renderMode = v; this.renderer?.setRenderMode?.(v); }

  /** Style#display_property(key) / set_property(key, value) — covers everything else. */
  property(key: string): unknown {
    return (this.state as any)[key] ?? null;
  }
  setProperty(key: string, value: unknown): boolean {
    if (Object.prototype.hasOwnProperty.call(this.state, key)) { (this.state as any)[key] = value; return true; }
    (this.state as any)[key] = value; return true;
  }

  /** Activates this style — pushes its render mode + colors into the renderer. */
  activate(): Style { this.renderer?.setRenderMode?.(this.state.renderMode); return this; }
}

export class Styles {
  private byName = new Map<string, StyleState>();
  private active: string;

  constructor(private renderer: IRenderer | null) {
    const seed: Array<[string, RenderMode]> = [
      ['Default Style', 'shaded'],
      ['Wireframe', 'wireframe'],
      ['Hidden Line', 'hiddenLine'],
      ['Shaded', 'shaded'],
      ['Shaded with Textures', 'textured'],
      ['X-Ray', 'xray'],
    ];
    for (const [name, mode] of seed) this.byName.set(name, defaultStyle(name, mode));
    this.active = 'Default Style';
  }

  get length(): number { return this.byName.size; }
  get count(): number { return this.length; }
  get size(): number { return this.length; }

  each(fn: (s: Style) => void): void {
    for (const s of this.byName.values()) fn(new Style(s, this.renderer));
  }

  toArray(): Style[] { return Array.from(this.byName.values()).map(s => new Style(s, this.renderer)); }

  /** Styles#[] — by index or name. */
  at(key: number | string): Style | null {
    if (typeof key === 'number') {
      const arr = Array.from(this.byName.values());
      return arr[key] ? new Style(arr[key], this.renderer) : null;
    }
    const s = this.byName.get(key);
    return s ? new Style(s, this.renderer) : null;
  }

  /** Styles#add_style(path, activate=false) — name-only stub for now. */
  addStyle(name: string, activate = false): Style {
    if (!this.byName.has(name)) this.byName.set(name, defaultStyle(name, 'shaded'));
    const s = new Style(this.byName.get(name)!, this.renderer);
    if (activate) this.selectedStyle = s;
    return s;
  }

  /** Styles#selected_style / Styles#active_style */
  get selectedStyle(): Style { return new Style(this.byName.get(this.active)!, this.renderer); }
  set selectedStyle(s: Style | string) {
    const name = typeof s === 'string' ? s : s.name;
    if (this.byName.has(name)) { this.active = name; this.byName.get(name)!.renderMode && this.renderer?.setRenderMode?.(this.byName.get(name)!.renderMode); }
  }

  /** Styles#purge_unused — DraftDown styles are all in-use; no-op. */
  purgeUnused(): number { return 0; }

  /** Styles#update_selected_style — re-capture from renderer. */
  updateSelectedStyle(): Style {
    const s = this.byName.get(this.active)!;
    if (this.renderer?.getRenderMode) s.renderMode = this.renderer.getRenderMode();
    return new Style(s, this.renderer);
  }
}
