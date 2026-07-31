// @archigraph plugin.system.draftdown.view
// DraftDown.View — the live drawable surface. Tools draw rubber-band overlays here.
//
// Reference: 
//
// Tool-overlay drawing is implemented on top of DraftDown's `IRenderer.addGuideLine`
// API. Each draw call emits one or more "transient" guide lines tagged with a
// `dd:tool-overlay:<n>` ID; `invalidate()` clears them.

import type { IViewport, IRenderer } from '../../../src/core/interfaces';
import type { Vec3, Color, Ray } from '../../../src/core/types';
import { Point3d, Vector3d } from './Geom';
import { Camera } from './Camera';

let nextOverlayId = 0;
const overlayLifetime = new Set<string>();

export class View {
  constructor(private viewport: IViewport) {}

  /** View#camera */
  get camera(): Camera { return new Camera(this.viewport.camera); }

  /** View#vpwidth / vpheight */
  get vpwidth(): number { return this.viewport.getWidth(); }
  get vpheight(): number { return this.viewport.getHeight(); }
  /** View#center — center of the viewport in pixels. */
  get center(): { x: number; y: number } { return { x: this.vpwidth / 2, y: this.vpheight / 2 }; }

  // ─── Drawing primitives ─────────────────────────────────────────

  private _drawingColor: Color = { r: 0, g: 0, b: 0, a: 1 };
  private _lineWidth = 1;
  private _lineStipple = '';

  /** View#drawing_color= */
  set drawingColor(c: Color | string) { this._drawingColor = parseColor(c); }
  get drawingColor(): Color { return { ...this._drawingColor }; }

  /** View#line_width= */
  set lineWidth(w: number) { this._lineWidth = w; }
  get lineWidth(): number { return this._lineWidth; }

  /** View#line_stipple= — supports ``"" | "-" | "." | "_" | "-."`` like DraftDown. */
  set lineStipple(s: string) { this._lineStipple = s; }
  get lineStipple(): string { return this._lineStipple; }

  /** View#draw(primitive, *points) — primitive is GL_POINTS|GL_LINES|GL_LINE_STRIP|GL_LINE_LOOP. */
  draw(primitive: 'points' | 'lines' | 'line_strip' | 'line_loop', points: Point3d[] | Vec3[]): View {
    const pts = points.map(p => p instanceof Point3d ? { x: p.x, y: p.y, z: p.z } : p);
    if (pts.length < 2 && primitive !== 'points') return this;
    const r = this.renderer;
    if (!r) return this;
    const dashed = this._lineStipple !== '';
    const opts = { depthTest: true, opacity: this._drawingColor.a ?? 1 };
    if (primitive === 'lines') {
      for (let i = 0; i + 1 < pts.length; i += 2) this.addOverlay(r, pts[i], pts[i + 1], dashed, opts);
    } else if (primitive === 'line_strip') {
      for (let i = 0; i + 1 < pts.length; i++) this.addOverlay(r, pts[i], pts[i + 1], dashed, opts);
    } else if (primitive === 'line_loop') {
      for (let i = 0; i + 1 < pts.length; i++) this.addOverlay(r, pts[i], pts[i + 1], dashed, opts);
      this.addOverlay(r, pts[pts.length - 1], pts[0], dashed, opts);
    } else if (primitive === 'points') {
      for (const p of pts) {
        // Render a tiny cross (3 line segments) per point.
        const e = 0.04;
        this.addOverlay(r, { x: p.x - e, y: p.y, z: p.z }, { x: p.x + e, y: p.y, z: p.z }, dashed, opts);
        this.addOverlay(r, { x: p.x, y: p.y - e, z: p.z }, { x: p.x, y: p.y + e, z: p.z }, dashed, opts);
        this.addOverlay(r, { x: p.x, y: p.y, z: p.z - e }, { x: p.x, y: p.y, z: p.z + e }, dashed, opts);
      }
    }
    return this;
  }

  /** View#draw_line(p1, p2, [p3, p4, ...]) — alternating endpoints. */
  drawLine(...points: Point3d[]): View { return this.draw('lines', points); }
  /** View#draw_polyline */
  drawPolyline(...points: Point3d[]): View { return this.draw('line_strip', points); }
  /** View#draw_points */
  drawPoints(points: Point3d[]): View { return this.draw('points', points); }

  /** View#draw_2d(primitive, screenPoints) — converts screen → world via inverse pickray. */
  draw2d(primitive: 'points' | 'lines' | 'line_strip' | 'line_loop', screenPoints: { x: number; y: number }[]): View {
    const ws: Point3d[] = [];
    for (const sp of screenPoints) {
      const ray = this.viewport.camera.screenToRay(sp.x, sp.y, this.vpwidth, this.vpheight);
      // Project at distance 1 from the camera origin.
      ws.push(new Point3d(ray.origin.x + ray.direction.x, ray.origin.y + ray.direction.y, ray.origin.z + ray.direction.z));
    }
    return this.draw(primitive, ws);
  }

  /** View#draw_text — rendered as a single overlay line; text content is best-effort skipped. */
  drawText(_position: Point3d, _text: string): View {
    // No glyph renderer in the overlay layer; skip silently. Tools requiring text use the
    // dimension/text overlay system in the main scene.
    return this;
  }

  /** Set/clear a tooltip on the viewport. */
  set tooltip(text: string) {
    if (typeof document !== 'undefined') {
      const el = document.querySelector('canvas') as HTMLCanvasElement | null;
      if (el) el.title = text;
    }
  }

  /** View#invalidate — clear all overlays. */
  invalidate(): View {
    const r = this.renderer; if (!r) return this;
    for (const id of overlayLifetime) r.removeGuideLine(id);
    overlayLifetime.clear();
    return this;
  }

  /** View#refresh — force a render. */
  refresh(): View { this.renderer?.render(); return this; }

  /** View#zoom(factor). */
  zoom(factor: number): View { this.viewport.camera.zoom(factor); return this; }
  /** View#zoom_extents */
  zoomExtents(): View { this.viewport.camera.fitToBox(this.viewport.camera ? { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } } : { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }); return this; }

  /** View#field_of_view (degrees). */
  get fieldOfView(): number { return this.viewport.camera.fov; }
  set fieldOfView(v: number) { this.viewport.camera.fov = v; }

  /** View#pickray(x, y) — returns Ray as [Point3d, Vector3d]. */
  pickray(x: number, y: number): [Point3d, Vector3d] {
    const r = this.viewport.camera.screenToRay(x, y, this.vpwidth, this.vpheight);
    return [new Point3d(r.origin.x, r.origin.y, r.origin.z), new Vector3d(r.direction.x, r.direction.y, r.direction.z)];
  }

  /** View#pick_helper — returns a fresh PickHelper for this view. */
  pickHelper(): import('./PickHelper').PickHelper {
    const { PickHelper } = require('./PickHelper') as typeof import('./PickHelper');
    return new PickHelper(this.viewport);
  }

  /** View#guess_target — point in front of the camera at unit distance. */
  guessTarget(): Point3d { const c = this.camera; return c.target; }

  /** View#write_image(path, width, height, antialias, compression) — best-effort. */
  writeImage(_options: { filename: string; width?: number; height?: number; antialias?: boolean; compression?: number }): boolean {
    // Capture to data URL, then dispatch via window.api.invoke if available.
    if (typeof document === 'undefined') return false;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return false;
    try {
      const data = canvas.toDataURL('image/png');
      // Store on window for plugins to access; actual file save needs IPC.
      (window as any).__draftdownLastImage = data;
      return true;
    } catch { return false; }
  }

  /** View#show_frame / View#animation= — minimal hook for animation observers. */
  showFrame(_delay = 0): void { this.refresh(); }

  /** View#last_refresh_time / View#average_refresh_time — render stats. */
  get lastRefreshTime(): number { return this.renderer?.getStats().frameTime ?? 0; }
  get averageRefreshTime(): number { return this.renderer?.getStats().frameTime ?? 0; }

  /** View#lock_inference / View#line_inference — stored on the viewport for the active tool. */
  lockInference(_input1?: unknown, _input2?: unknown): View {
    // Tools read the stored lock from window; we expose a simple hook.
    (window as any).__draftdownInferenceLock = { ts: Date.now() };
    return this;
  }
  lineInference(): null { return null; }

  /** View#add_observer / remove_observer */
  addObserver(observer: ViewObserver): void { viewObservers.add(observer); }
  removeObserver(observer: ViewObserver): void { viewObservers.delete(observer); }

  // ── Internal ─────────────────────────────────────────────────

  private get renderer(): IRenderer | null {
    try { return this.viewport.renderer; } catch { return null; }
  }

  private addOverlay(r: IRenderer, a: Vec3, b: Vec3, dashed: boolean, opts: { depthTest?: boolean; opacity?: number }): void {
    const id = `dd:tool-overlay:${nextOverlayId++}`;
    overlayLifetime.add(id);
    r.addGuideLine(id, a, b, this._drawingColor, dashed, opts);
  }
}

export interface ViewObserver {
  onViewChanged?(view: View): void;
}

export const viewObservers = new Set<ViewObserver>();

function parseColor(c: Color | string): Color {
  if (typeof c === 'string') {
    const m = c.match(/^#?([0-9a-f]{6})$/i);
    if (m) return { r: parseInt(m[1].slice(0, 2), 16) / 255, g: parseInt(m[1].slice(2, 4), 16) / 255, b: parseInt(m[1].slice(4, 6), 16) / 255, a: 1 };
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  return { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 };
}
