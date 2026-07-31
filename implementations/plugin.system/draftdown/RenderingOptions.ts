// @archigraph plugin.system.draftdown.rendering-options
// DraftDown.RenderingOptions — keyed property bag controlling render-time look.
// Reference: 
//
// DraftDown exposes ~80 keys (BackgroundColor, DrawHorizon, ConstructionColor, …).
// We seed sensible defaults and map a handful of keys to the live IRenderer where
// it makes sense (e.g. DrawGrid → setGridVisible). All other keys round-trip through
// the dictionary and broadcast `'changed'` events so plugins can react.

import type { IRenderer } from '../../../src/core/interfaces';
import type { Color } from '../../../src/core/types';

const DEFAULTS: Record<string, unknown> = {
  BackgroundColor: { r: 1, g: 1, b: 1, a: 1 },
  BandColor: { r: 0.6, g: 0.7, b: 0.9, a: 1 },
  ConstructionColor: { r: 0, g: 0, b: 0, a: 1 },
  DepthQueEdges: 4,
  DepthQueWidth: 1,
  DisplayColorByLayer: false,
  DisplayDims: true,
  DisplayFog: false,
  DisplayInstanceAxes: true,
  DisplaySectionPlanes: true,
  DisplaySectionCuts: true,
  DisplaySketchAxes: true,
  DisplayText: true,
  DisplayWatermarks: false,
  DrawGrid: true,
  DrawDepthQue: true,
  DrawHidden: false,
  DrawHorizon: true,
  DrawLineEnds: false,
  DrawProfilesOnly: false,
  DrawSilhouettes: false,
  DrawUnderground: false,
  EdgeColorMode: 0,
  EdgeDisplayMode: 0,
  EdgeType: 0,
  ExtendEdges: false,
  ExtendLines: 0,
  FaceBackColor: { r: 0.6, g: 0.6, b: 0.7, a: 1 },
  FaceColorMode: 0,
  FaceFrontColor: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
  FogColor: { r: 0.8, g: 0.8, b: 0.85, a: 1 },
  FogEndDist: 200,
  FogStartDist: 50,
  FogUseBkColor: false,
  ForegroundColor: { r: 0, g: 0, b: 0, a: 1 },
  GroundColor: { r: 0.78, g: 0.74, b: 0.65, a: 1 },
  GroundTransparency: 100,
  HideConstructionGeometry: false,
  HighlightColor: { r: 0.0, g: 0.5, b: 1.0, a: 1 },
  InactiveHidden: false,
  InstanceHidden: false,
  JitterEdges: false,
  LineExtension: 0,
  LockedColor: { r: 0.6, g: 0.0, b: 0.0, a: 1 },
  ModelTransparency: false,
  RenderMode: 1,
  RenderStyle: 0,
  SectionActiveColor: { r: 1, g: 0, b: 1, a: 1 },
  SectionCutDrawEdges: true,
  SectionCutFilled: false,
  SectionCutWidth: 3,
  SectionDefaultCutColor: { r: 0, g: 0, b: 0, a: 1 },
  SectionDefaultFillColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
  SectionInactiveColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
  ShowViewName: false,
  SkyColor: { r: 0.6, g: 0.7, b: 0.9, a: 1 },
  SilhouetteWidth: 1,
  Texture: true,
  Transparency: false,
  TransparencySort: 0,
};

export interface RenderingOptionsObserver {
  onRenderingOptionsChanged?(opts: RenderingOptions, key: string): void;
}

export class RenderingOptions {
  private store = new Map<string, unknown>();
  private observers = new Set<RenderingOptionsObserver>();

  constructor(private renderer: IRenderer | null) {
    for (const k of Object.keys(DEFAULTS)) this.store.set(k, DEFAULTS[k]);
  }

  /** RenderingOptions#[] */
  get(key: string): unknown { return this.store.has(key) ? this.store.get(key) : null; }
  /** RenderingOptions#[]= */
  set(key: string, value: unknown): boolean {
    this.store.set(key, value);
    this.applySideEffects(key, value);
    this.emit(key);
    return true;
  }
  /** RenderingOptions#each_pair / .each */
  each(fn: (key: string, value: unknown) => void): void { for (const [k, v] of this.store) fn(k, v); }
  eachPair(fn: (key: string, value: unknown) => void): void { this.each(fn); }
  /** RenderingOptions#keys */
  keys(): string[] { return Array.from(this.store.keys()); }
  /** RenderingOptions#count */
  count(): number { return this.store.size; }

  /** RenderingOptions#add_observer / remove_observer */
  addObserver(o: RenderingOptionsObserver): void { this.observers.add(o); }
  removeObserver(o: RenderingOptionsObserver): void { this.observers.delete(o); }

  private applySideEffects(key: string, value: unknown): void {
    if (!this.renderer) return;
    if (key === 'DrawGrid') this.renderer.setGridVisible(!!value);
    else if (key === 'DisplaySketchAxes') this.renderer.setAxesVisible(!!value);
  }

  private emit(key: string): void {
    for (const o of this.observers) try { o.onRenderingOptionsChanged?.(this, key); } catch (e) { console.error(e); }
  }
}

export interface ShadowInfoObserver {
  onShadowInfoChanged?(info: ShadowInfo, key: string): void;
}

/**
 * DraftDown.ShadowInfo — the same key/value bag pattern as RenderingOptions but for sun + geo.
 * DraftDown does not render shadows, so values round-trip without affecting the renderer.
 */
export class ShadowInfo {
  private store = new Map<string, unknown>();
  private observers = new Set<ShadowInfoObserver>();

  constructor() {
    const defaults: Record<string, unknown> = {
      City: '',
      Country: '',
      DaylightSavings: false,
      DisplayOnAllFaces: true,
      DisplayOnGroundPlane: true,
      DisplayShadows: false,
      EdgesCastShadows: false,
      Latitude: 40.7128,
      Longitude: -74.006,
      LightAndDark: 0.4,
      NorthAngle: 0,
      ShadowTime: new Date().toISOString(),
      ShadowTime_time_t: Math.floor(Date.now() / 1000),
      TZOffset: -5,
      UseSunForAllShading: false,
    };
    for (const k of Object.keys(defaults)) this.store.set(k, defaults[k]);
  }

  get(key: string): unknown { return this.store.has(key) ? this.store.get(key) : null; }
  set(key: string, value: unknown): boolean { this.store.set(key, value); this.emit(key); return true; }
  each(fn: (key: string, value: unknown) => void): void { for (const [k, v] of this.store) fn(k, v); }
  eachPair(fn: (key: string, value: unknown) => void): void { this.each(fn); }
  keys(): string[] { return Array.from(this.store.keys()); }
  count(): number { return this.store.size; }

  addObserver(o: ShadowInfoObserver): void { this.observers.add(o); }
  removeObserver(o: ShadowInfoObserver): void { this.observers.delete(o); }

  private emit(key: string): void {
    for (const o of this.observers) try { o.onShadowInfoChanged?.(this, key); } catch (e) { console.error(e); }
  }
}
