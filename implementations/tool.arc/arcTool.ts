// @archigraph tool.arc
// Arc tool: click start, click end, move to set bulge.
// Arrow keys lock to axis during point placement, change plane during bulge.

import type { Vec3, Plane } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool, DRAWING_PLANES } from '../tool.base/BaseTool';
import { v4 as uuid } from 'uuid';
import { getParametersStore } from '../plugin.system/draftdown/ParametersStore';

const ARC_PARAMS_ID = 'tool.arc';

/**
 * Arc kinds match DraftDown's four arc tools:
 *   two-point    — Arc / 2 Point Arc: pick start, pick end, drag bulge.
 *   three-point  — 3 Point Arc: arc passes through three picked points.
 *   pie          — Pie: like two-point, plus radial edges to the center → closed wedge.
 *   center       — Arc (center mode): pick center, pick start of arc, sweep to end.
 */
export type ArcMode = 'two-point' | 'three-point' | 'pie' | 'center';

export class ArcTool extends BaseTool {
  readonly id = 'tool.arc';
  readonly name = 'Arc';
  readonly icon = 'arc';
  readonly shortcut = 'A';
  readonly category = 'draw' as const;
  readonly cursor = 'crosshair';

  private startPoint: Vec3 | null = null;
  private endPoint: Vec3 | null = null;
  /** Third reference point: through-point (3pt mode), bulge point (2pt/pie), sweep target (center). */
  private thirdPoint: Vec3 | null = null;
  /** Center mode stores the picked center separately so we keep startPoint as the radius anchor. */
  private centerPoint: Vec3 | null = null;
  private drawPlane: Plane = { normal: { x: 0, y: 1, z: 0 }, distance: 0 };
  private segments = 12;
  private currentBulge = 0;
  private step: 0 | 1 | 2 = 0;
  private lastScreenX = 0;
  private lastScreenY = 0;
  private arcPoints: Vec3[] = []; // For preview
  private arcMode: ArcMode = 'two-point';

  activate(): void {
    super.activate();
    this.reset();
    this.showParameters();
    this.setStatus(this.statusForState());
  }

  deactivate(): void {
    if (this.step > 0) this.abortTransaction();
    this.reset();
    getParametersStore().hide(ARC_PARAMS_ID);
    super.deactivate();
  }

  /** Right-rail Parameters section that lets the user pick the arc kind + segment count. */
  private showParameters(): void {
    getParametersStore().show({
      id: ARC_PARAMS_ID,
      title: 'Arc',
      fields: [
        {
          kind: 'select',
          key: 'mode',
          label: 'Type',
          default: this.arcMode,
          options: [
            { label: '2-Point Arc (start, end, bulge)', value: 'two-point' },
            { label: '3-Point Arc (through three points)', value: 'three-point' },
            { label: 'Pie (closed wedge)', value: 'pie' },
            { label: 'Arc (center, start, end)', value: 'center' },
          ],
          help: 'Switching type cancels the current arc.',
        },
        {
          kind: 'integer',
          key: 'segments',
          label: 'Segments',
          default: this.segments,
          min: 2,
          max: 360,
          help: 'Or type "12s" in the VCB while drawing.',
        },
        {
          kind: 'slider',
          key: 'segmentsSlider',
          label: '',
          default: this.segments,
          min: 2,
          max: 48,
          step: 1,
        },
      ],
      values: { mode: this.arcMode, segments: this.segments, segmentsSlider: this.segments },
      onChange: (values, key) => {
        if (key === 'mode') {
          const next = String(values.mode) as ArcMode;
          if (next === this.arcMode) return;
          if (this.step > 0) this.abortTransaction();
          this.reset();
          this.arcMode = next;
          this.setStatus(this.statusForState());
          this.requestPreviewRefresh();
          return;
        }
        const raw = key === 'segmentsSlider' ? values.segmentsSlider : values.segments;
        const next = Math.max(2, Math.min(360, Math.floor(Number(raw) || 0)));
        if (!Number.isFinite(next) || next === this.segments) return;
        this.segments = next;
        getParametersStore().update(ARC_PARAMS_ID, { segments: next, segmentsSlider: Math.min(48, next) });
        this.requestPreviewRefresh();
      },
    });
  }

  private requestPreviewRefresh(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('draftdown:tool-preview-changed', { detail: { toolId: this.id } }));
    }
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.lastScreenX = event.screenX;
    this.lastScreenY = event.screenY;

    if (this.arcMode === 'center') return this.onMouseDownCenter(event);
    if (this.arcMode === 'three-point') return this.onMouseDownThreePoint(event);
    // two-point + pie share the click flow; only commit differs.
    return this.onMouseDownTwoPoint(event);
  }

  // ── Two-Point (and Pie) ────────────────────────────────────────

  private onMouseDownTwoPoint(event: ToolMouseEvent): void {
    if (this.step === 0) {
      const point = event.worldPoint ?? this.screenToDrawingPlane(event);
      if (!point) return;
      this.startPoint = point;
      this.beginTransaction(this.arcMode === 'pie' ? 'Draw Pie' : 'Draw Arc');
      this.drawPlane = this.getEffectiveDrawingPlane(event, this.startPoint);
      this.step = 1;
      this.axisLock = null;
      this.setPhase('drawing');
      this.setStatus('Click to place end point. Arrow keys lock to axis.');
    } else if (this.step === 1) {
      let point = this.getPlanePointHonoringSnap(event, this.drawPlane);
      if (!point) return;
      if (this.axisLock && this.startPoint) point = this.applyAxisLock(point, this.startPoint);
      this.endPoint = point;
      this.drawPlane = this.computeArcPlane(this.startPoint!, point);
      this.step = 2;
      this.axisLock = null;
      this.setStatus('Move to set arc bulge, then click. Arrow keys change plane.');
    } else if (this.step === 2) {
      this.createArc();
    }
  }

  // ── Three-Point Arc ────────────────────────────────────────────

  private onMouseDownThreePoint(event: ToolMouseEvent): void {
    if (this.step === 0) {
      const point = event.worldPoint ?? this.screenToDrawingPlane(event);
      if (!point) return;
      this.startPoint = point;
      this.beginTransaction('Draw 3-Point Arc');
      this.drawPlane = this.getEffectiveDrawingPlane(event, this.startPoint);
      this.step = 1;
      this.setPhase('drawing');
      this.setStatus('Click second point on the arc.');
    } else if (this.step === 1) {
      const point = this.getPlanePointHonoringSnap(event, this.drawPlane);
      if (!point) return;
      this.thirdPoint = point; // "through" point
      this.step = 2;
      this.setStatus('Click end point.');
    } else if (this.step === 2) {
      const point = this.getPlanePointHonoringSnap(event, this.drawPlane);
      if (!point) return;
      this.endPoint = point;
      this.create3PointArc();
    }
  }

  // ── Center-mode Arc ────────────────────────────────────────────

  private onMouseDownCenter(event: ToolMouseEvent): void {
    if (this.step === 0) {
      const point = event.worldPoint ?? this.screenToDrawingPlane(event);
      if (!point) return;
      this.centerPoint = point;
      this.beginTransaction('Draw Center Arc');
      this.drawPlane = this.getEffectiveDrawingPlane(event, point);
      this.step = 1;
      this.setPhase('drawing');
      this.setStatus('Click to set radius and start angle.');
    } else if (this.step === 1) {
      const point = this.getPlanePointHonoringSnap(event, this.drawPlane);
      if (!point) return;
      this.startPoint = point;
      this.step = 2;
      this.setStatus('Click to set sweep end. Arrow keys change plane.');
    } else if (this.step === 2) {
      const point = this.getPlanePointHonoringSnap(event, this.drawPlane);
      if (!point) return;
      this.endPoint = point;
      this.createCenterArc();
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    this.lastScreenX = event.screenX;
    this.lastScreenY = event.screenY;

    if (this.arcMode === 'center') return this.onMouseMoveCenter(event);
    if (this.arcMode === 'three-point') return this.onMouseMoveThreePoint(event);

    if (this.step === 2 && this.startPoint && this.endPoint) {
      // Stay on the locked drawing plane regardless of where the cursor strays.
      const point = this.getPlanePointHonoringSnap(event, this.drawPlane)
        ?? this.resolvePoint(event);
      if (!point) return;

      const mid = vec3.lerp(this.startPoint, this.endPoint, 0.5);
      const chord = vec3.sub(this.endPoint, this.startPoint);
      const chordLen = vec3.length(chord);
      if (chordLen < 1e-10) return;

      const perpDir = vec3.normalize(vec3.cross(chord, this.drawPlane.normal));
      const toPoint = vec3.sub(point, mid);
      this.currentBulge = vec3.dot(toPoint, perpDir);
      this.setVCBValue(this.formatDist(Math.abs(this.currentBulge)));
      this.computePreviewPoints();
    } else if (this.step === 1 && this.startPoint) {
      let point = this.getPlanePointHonoringSnap(event, this.drawPlane)
        ?? this.resolvePoint(event);
      if (!point) return;
      if (this.axisLock) {
        const ray = this.viewport.camera.screenToRay(
          event.screenX, event.screenY,
          this.viewport.getWidth(), this.viewport.getHeight(),
        );
        point = this.projectRayOntoAxis(ray, this.startPoint, this.axisLock);
      }
      this.endPoint = point;
      this.setVCBValue(this.formatDist(vec3.distance(this.startPoint, point)));
    }
  }

  private onMouseMoveThreePoint(event: ToolMouseEvent): void {
    if (!this.startPoint) return;
    const point = this.getPlanePointHonoringSnap(event, this.drawPlane)
      ?? this.resolvePoint(event);
    if (!point) return;
    if (this.step === 1) {
      // Pre-fill the through-point as the cursor, draw a chord preview.
      this.thirdPoint = point;
      this.setVCBValue(this.formatDist(vec3.distance(this.startPoint, point)));
      this.arcPoints = [this.startPoint, point];
    } else if (this.step === 2 && this.thirdPoint) {
      this.endPoint = point;
      this.computeThreePointPreview();
    }
  }

  private onMouseMoveCenter(event: ToolMouseEvent): void {
    if (this.step === 1 && this.centerPoint) {
      const point = this.getPlanePointHonoringSnap(event, this.drawPlane)
        ?? this.resolvePoint(event);
      if (!point) return;
      this.startPoint = point;
      this.setVCBValue(this.formatDist(vec3.distance(this.centerPoint, point)));
      this.arcPoints = [this.centerPoint, point];
    } else if (this.step === 2 && this.centerPoint && this.startPoint) {
      const point = this.getPlanePointHonoringSnap(event, this.drawPlane)
        ?? this.resolvePoint(event);
      if (!point) return;
      this.endPoint = point;
      this.computeCenterPreview();
    }
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.step > 0) this.abortTransaction();
      this.reset();
      this.setStatus(this.statusForState());
      return;
    }

    if (this.step === 0 || this.step === 1) {
      // During point placement: arrow keys lock to axis
      if (this.handleArrowKeyAxisLock(event)) {
        this.setStatus(this.getAxisLockStatus());
        // Recompute preview from stored screen position
        if (this.step === 1 && this.startPoint && this.lastScreenX > 0) {
          const ray = this.viewport.camera.screenToRay(
            this.lastScreenX, this.lastScreenY,
            this.viewport.getWidth(), this.viewport.getHeight(),
          );
          if (this.axisLock) {
            this.endPoint = this.projectRayOntoAxis(ray, this.startPoint, this.axisLock);
          } else {
            // Unlock — project onto drawing plane
            const planePoint = this.screenToDrawingPlane(
              { screenX: this.lastScreenX, screenY: this.lastScreenY } as ToolMouseEvent,
              this.startPoint,
            );
            if (planePoint) this.endPoint = planePoint;
          }
        }
        this.requestPreviewRefresh();
      }
    } else if (this.step === 2) {
      // During the drag/bulge/sweep step, arrow keys change the drawing plane.
      // Works for all three drag modes (2-point, pie, center). The preview is
      // recomputed live from the stored cursor position so the user sees the
      // change immediately without having to move the mouse.
      if (this.handleArrowKeyPlane(event)) {
        const anchor = this.arcMode === 'center'
          ? (this.centerPoint ?? this.startPoint)
          : this.startPoint;
        if (anchor) this.drawPlane = this.getDrawingPlane(anchor);
        const info = DRAWING_PLANES[this.drawingPlaneAxis];
        this.setStatus(`Plane: ${info.label}. ${this.arcMode === 'center' ? 'Set sweep end.' : 'Set bulge.'}`);
        // Live re-project the cursor onto the new plane and rebuild the preview.
        if (this.lastScreenX > 0) {
          const onPlane = this.raycastOntoPlane(this.drawPlane, this.lastScreenX, this.lastScreenY);
          if (onPlane) {
            if (this.arcMode === 'center' && this.centerPoint && this.startPoint) {
              this.endPoint = onPlane;
              this.computeCenterPreview();
            } else if (this.startPoint && this.endPoint) {
              const mid = vec3.lerp(this.startPoint, this.endPoint, 0.5);
              const chord = vec3.sub(this.endPoint, this.startPoint);
              const chordLen = vec3.length(chord);
              if (chordLen > 1e-10) {
                const perpDir = vec3.normalize(vec3.cross(chord, this.drawPlane.normal));
                if (vec3.length(perpDir) > 1e-6) {
                  const toPoint = vec3.sub(onPlane, mid);
                  this.currentBulge = vec3.dot(toPoint, perpDir);
                  this.setVCBValue(this.formatDist(Math.abs(this.currentBulge)));
                  this.computePreviewPoints();
                }
              }
            }
          }
        }
        this.requestPreviewRefresh();
      }
    }
  }

  onVCBInput(value: string): void {
    const trimmed = value.trim();
    if (trimmed.endsWith('s')) {
      const segs = parseInt(trimmed.slice(0, -1), 10);
      if (!isNaN(segs) && segs >= 2 && segs <= 360) {
        this.segments = segs;
        getParametersStore().update(ARC_PARAMS_ID, { segments: segs, segmentsSlider: Math.min(48, segs) });
        this.setStatus(`Segments: ${this.segments}`);
        this.requestPreviewRefresh();
        return;
      }
    }
    if (this.arcMode === 'two-point' || this.arcMode === 'pie') {
      if (this.step === 2) {
        const bulge = this.parseDistance(value);
        if (isNaN(bulge)) return;
        this.currentBulge = bulge;
        this.createArc();
      }
    }
  }

  getVCBLabel(): string {
    if (this.step === 1) return 'Length';
    if (this.step === 2) return 'Bulge';
    return 'Sides';
  }

  getPreview(): ToolPreview | null {
    // Mode-specific previews
    if (this.arcMode === 'three-point') {
      if (this.step === 1 && this.startPoint && this.thirdPoint) {
        return { lines: [{ from: this.startPoint, to: this.thirdPoint }] };
      }
      if (this.step === 2 && this.arcPoints.length > 1) {
        return { polygon: this.arcPoints };
      }
      return null;
    }
    if (this.arcMode === 'center') {
      if (this.step === 1 && this.centerPoint && this.startPoint) {
        return { lines: [{ from: this.centerPoint, to: this.startPoint }] };
      }
      if (this.step === 2 && this.arcPoints.length > 1) {
        return { polygon: this.arcPoints };
      }
      return null;
    }

    // 2-point + pie share the existing preview path.
    if (this.step === 1 && this.startPoint && this.endPoint) {
      const lines: { from: Vec3; to: Vec3 }[] = [{ from: this.startPoint, to: this.endPoint }];
      if (this.axisLock) {
        const plane = this.computeArcPlane(this.startPoint, this.endPoint);
        const chord = vec3.sub(this.endPoint, this.startPoint);
        const chordLen = vec3.length(chord);
        if (chordLen > 1e-10) {
          const perpDir = vec3.normalize(vec3.cross(chord, plane.normal));
          const mid = vec3.lerp(this.startPoint, this.endPoint, 0.5);
          const hintLen = chordLen * 0.15;
          lines.push({ from: mid, to: vec3.add(mid, vec3.mul(perpDir, hintLen)) });
        }
      }
      return { lines };
    }
    if (this.step === 2 && this.arcPoints.length > 1) {
      return { polygon: this.arcPoints };
    }
    return null;
  }

  private reset(): void {
    this.startPoint = null;
    this.endPoint = null;
    this.thirdPoint = null;
    this.centerPoint = null;
    this.currentBulge = 0;
    this.step = 0;
    this.arcPoints = [];
    this.axisLock = null;
    this.setPhase('idle');
    this.setVCBValue('');
  }

  /** Status text for the current `(arcMode, step)`. */
  private statusForState(): string {
    if (this.arcMode === 'three-point') {
      if (this.step === 0) return 'Click to place start point.';
      if (this.step === 1) return 'Click second point on the arc.';
      return 'Click end point.';
    }
    if (this.arcMode === 'center') {
      if (this.step === 0) return 'Click to place center.';
      if (this.step === 1) return 'Click to set radius and start angle.';
      return 'Click to sweep arc end. Arrow keys change plane.';
    }
    if (this.arcMode === 'pie') {
      if (this.step === 0) return 'Pie: click to place start point.';
      if (this.step === 1) return 'Pie: click to place end point.';
      return 'Pie: move to set bulge, then click to commit closed wedge.';
    }
    if (this.step === 0) return 'Click to place start point. Arrow keys lock to axis.';
    if (this.step === 1) return 'Click to place end point. Arrow keys lock to axis.';
    return 'Move to set arc bulge, then click. Arrow keys change plane.';
  }

  /**
   * Compute an arc plane whose normal is NOT parallel to the chord.
   * If the current drawing plane works, use it. Otherwise pick a plane
   * that contains the chord and provides a valid perpendicular direction.
   */
  private computeArcPlane(start: Vec3, end: Vec3): Plane {
    const chord = vec3.sub(end, start);
    const chordLen = vec3.length(chord);
    if (chordLen < 1e-10) return this.getDrawingPlane(start);

    const chordDir = vec3.normalize(chord);

    // Try the current drawing plane first
    const currentNormal = this.getDrawingPlane(start).normal;
    const dot = Math.abs(vec3.dot(chordDir, currentNormal));
    if (dot < 0.95) {
      // Current plane normal is not parallel to chord — it works
      return this.getDrawingPlane(start);
    }

    // Chord is roughly parallel to the plane normal — pick a better plane.
    // Try standard axes and pick the one most perpendicular to the chord.
    const candidates: Vec3[] = [
      { x: 0, y: 1, z: 0 }, // ground/green
      { x: 1, y: 0, z: 0 }, // red
      { x: 0, y: 0, z: 1 }, // blue
    ];

    let bestNormal = candidates[0];
    let bestDot = 1;
    for (const n of candidates) {
      const d = Math.abs(vec3.dot(chordDir, n));
      if (d < bestDot) {
        bestDot = d;
        bestNormal = n;
      }
    }

    const distance = vec3.dot(start, bestNormal);
    return { normal: { ...bestNormal }, distance };
  }

  private computePreviewPoints(): void {
    if (!this.startPoint || !this.endPoint) return;
    const mid = vec3.lerp(this.startPoint, this.endPoint, 0.5);
    const chord = vec3.sub(this.endPoint, this.startPoint);
    const chordLen = vec3.length(chord);
    if (chordLen < 1e-10) return;
    const perpDir = vec3.normalize(vec3.cross(chord, this.drawPlane.normal));
    const arcMid = vec3.add(mid, vec3.mul(perpDir, this.currentBulge));

    this.arcPoints = [this.startPoint];
    for (let i = 1; i < this.segments; i++) {
      const t = i / this.segments;
      const a = vec3.lerp(this.startPoint, arcMid, t);
      const b = vec3.lerp(arcMid, this.endPoint, t);
      this.arcPoints.push(vec3.lerp(a, b, t));
    }
    this.arcPoints.push(this.endPoint);
  }

  /**
   * Compute the true circular center given a chord (start, end) and signed sagitta (bulge)
   * measured along the chord-perpendicular in the drawing plane. Used by pie mode to place
   * the radial closing edges correctly.
   */
  private computeArcCenter(start: Vec3, end: Vec3, bulge: number, planeNormal: Vec3): Vec3 {
    const mid = vec3.lerp(start, end, 0.5);
    const chord = vec3.sub(end, start);
    const c = vec3.length(chord);
    if (c < 1e-10 || Math.abs(bulge) < 1e-10) return mid;
    const perpDir = vec3.normalize(vec3.cross(chord, planeNormal));
    const s = Math.abs(bulge);
    const R = (c * c / 4 + s * s) / (2 * s);
    const sign = Math.sign(bulge);
    return vec3.add(mid, vec3.mul(perpDir, bulge - R * sign));
  }

  // findOrCreateVertex is now in BaseTool

  private createArc(): void {
    if (!this.startPoint || !this.endPoint) return;
    this.computePreviewPoints();

    const vertexIds: string[] = [];
    for (const p of this.arcPoints) {
      const v = this.findOrCreateVertex(p);
      vertexIds.push(v.id);
    }

    const curveId = uuid();
    for (let i = 0; i < vertexIds.length - 1; i++) {
      const edges = this.document.geometry.createEdgeWithIntersection(vertexIds[i], vertexIds[i + 1]);
      for (const edge of edges) edge.curveId = curveId;
    }
    // Per-segment intersection handling can't see the whole arc, so a face
    // the arc bisects isn't split correctly. Pass the full chain (endpoints
    // on the face boundary, interior points inside) to split it in two.
    this.document.geometry.splitFaceWithPath(vertexIds);

    if (this.arcMode === 'pie') {
      const center = this.computeArcCenter(this.startPoint, this.endPoint, this.currentBulge, this.drawPlane.normal);
      const centerVertex = this.findOrCreateVertex(center);
      // Two radial edges close the wedge.
      this.document.geometry.createEdge(vertexIds[vertexIds.length - 1], centerVertex.id);
      this.document.geometry.createEdge(centerVertex.id, vertexIds[0]);
      // Closed-loop face from center → arc points → back to center.
      const faceVerts = [centerVertex.id, ...vertexIds];
      try { this.document.geometry.createFace(faceVerts); }
      catch (e) { console.warn('[ArcTool.createArc] pie close-face creation failed (likely degenerate):', e); }
    }

    this.commitTransaction();
    this.reset();
    this.setStatus(this.arcMode === 'pie' ? 'Pie created. Click to place start point.' : 'Arc created. Click to place start point.');
  }

  // ── 3-point arc commit ────────────────────────────────────────

  private create3PointArc(): void {
    if (!this.startPoint || !this.thirdPoint || !this.endPoint) return;
    this.computeThreePointPreview();
    if (this.arcPoints.length < 2) return;

    const vertexIds: string[] = [];
    for (const p of this.arcPoints) {
      const v = this.findOrCreateVertex(p);
      vertexIds.push(v.id);
    }
    const curveId = uuid();
    for (let i = 0; i < vertexIds.length - 1; i++) {
      const edges = this.document.geometry.createEdgeWithIntersection(vertexIds[i], vertexIds[i + 1]);
      for (const edge of edges) edge.curveId = curveId;
    }
    // Split any face the whole arc bisects (see createArc)
    this.document.geometry.splitFaceWithPath(vertexIds);
    this.commitTransaction();
    this.reset();
    this.setStatus('3-Point Arc created. Click to place start point.');
  }

  /** Sample an arc that passes through three points (start, through, end). */
  private computeThreePointPreview(): void {
    if (!this.startPoint || !this.thirdPoint || !this.endPoint) return;
    const result = circumArcThroughThreePoints(this.startPoint, this.thirdPoint, this.endPoint);
    if (!result) {
      // Collinear → fall back to polyline
      this.arcPoints = [this.startPoint, this.thirdPoint, this.endPoint];
      return;
    }
    const { center, normal, startAngle, endAngle, radius } = result;
    this.arcPoints = sampleArc(center, normal, radius, startAngle, endAngle, this.segments);
  }

  // ── Center-mode commit ────────────────────────────────────────

  private createCenterArc(): void {
    if (!this.centerPoint || !this.startPoint || !this.endPoint) return;
    this.computeCenterPreview();
    if (this.arcPoints.length < 2) return;

    const vertexIds: string[] = [];
    for (const p of this.arcPoints) {
      const v = this.findOrCreateVertex(p);
      vertexIds.push(v.id);
    }
    const curveId = uuid();
    for (let i = 0; i < vertexIds.length - 1; i++) {
      const edges = this.document.geometry.createEdgeWithIntersection(vertexIds[i], vertexIds[i + 1]);
      for (const edge of edges) edge.curveId = curveId;
    }
    // Split any face the whole arc bisects (see createArc)
    this.document.geometry.splitFaceWithPath(vertexIds);
    this.commitTransaction();
    this.reset();
    this.setStatus('Arc created. Click to place center.');
  }

  private computeCenterPreview(): void {
    if (!this.centerPoint || !this.startPoint || !this.endPoint) return;
    const radius = vec3.distance(this.centerPoint, this.startPoint);
    if (radius < 1e-9) { this.arcPoints = []; return; }
    const normal = this.drawPlane.normal;
    const xAxis = vec3.normalize(vec3.sub(this.startPoint, this.centerPoint));
    const yAxis = vec3.normalize(vec3.cross(normal, xAxis));
    // Project endPoint into the (xAxis, yAxis) basis to get the sweep angle.
    const toEnd = vec3.sub(this.endPoint, this.centerPoint);
    const ex = vec3.dot(toEnd, xAxis);
    const ey = vec3.dot(toEnd, yAxis);
    let endAngle = Math.atan2(ey, ex);
    if (endAngle < 0) endAngle += Math.PI * 2;
    this.arcPoints = sampleArcByBasis(this.centerPoint, xAxis, yAxis, radius, 0, endAngle, this.segments);
  }
}

// ────────────────────────────────────────────────────────────────
// Arc helpers (pure functions — no this).
// ────────────────────────────────────────────────────────────────

interface CircumArc { center: Vec3; normal: Vec3; radius: number; startAngle: number; endAngle: number }

/**
 * Compute the unique arc passing through three points (start, mid, end).
 * Returns null when the points are collinear.
 */
function circumArcThroughThreePoints(p1: Vec3, p2: Vec3, p3: Vec3): CircumArc | null {
  const v1 = vec3.sub(p2, p1);
  const v2 = vec3.sub(p3, p1);
  const cross = vec3.cross(v1, v2);
  const crossLen = vec3.length(cross);
  if (crossLen < 1e-10) return null; // collinear

  const normal = vec3.normalize(cross);
  const v1Len2 = vec3.dot(v1, v1);
  const v2Len2 = vec3.dot(v2, v2);
  const denom = 2 * crossLen * crossLen;
  // Center = p1 + (|v2|² (v1·v1 - v1·v2) v1 + |v1|² (v2·v2 - v1·v2) v2) ... — use Cayley–Menger expansion:
  // Standard formula: center = p1 + ( |v2|²(v1.dot(v1)) - v2.dot(v2)*v1 ... ) — use a cleaner derivation:
  const a = vec3.dot(v1, v1);
  const b = vec3.dot(v1, v2);
  const c = vec3.dot(v2, v2);
  const u = (c * (a - b)) / denom;
  const w = (a * (c - b)) / denom;
  const center: Vec3 = vec3.add(p1, vec3.add(vec3.mul(v1, u), vec3.mul(v2, w)));
  const radius = vec3.distance(center, p1);

  const xAxis = vec3.normalize(vec3.sub(p1, center));
  const yAxis = vec3.normalize(vec3.cross(normal, xAxis));

  const angleOf = (p: Vec3): number => {
    const v = vec3.sub(p, center);
    let a = Math.atan2(vec3.dot(v, yAxis), vec3.dot(v, xAxis));
    if (a < 0) a += Math.PI * 2;
    return a;
  };
  const a1 = angleOf(p1); // == 0 by construction
  const a2 = angleOf(p2);
  const a3 = angleOf(p3);

  // Determine sweep that goes from a1 → a3 passing through a2.
  // Try CCW first.
  let startAngle = a1;
  let endAngle = a3;
  const ccw = sweepGoesThrough(a1, a3, a2, true);
  if (!ccw) {
    // Use CW: swap basis y-axis sign by negating endAngle range.
    return { center, normal: vec3.mul(normal, -1), radius, startAngle: a1 === 0 ? 0 : (Math.PI * 2 - a1), endAngle: (Math.PI * 2 - a3) };
  }
  return { center, normal, radius, startAngle, endAngle };
}

function sweepGoesThrough(start: number, end: number, mid: number, ccw: boolean): boolean {
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const s = norm(start); const e = norm(end); const m = norm(mid);
  if (ccw) {
    if (s <= e) return m >= s && m <= e;
    return m >= s || m <= e;
  } else {
    if (s >= e) return m <= s && m >= e;
    return m <= s || m >= e;
  }
}

function sampleArc(center: Vec3, normal: Vec3, radius: number, startAngle: number, endAngle: number, segments: number): Vec3[] {
  const xAxis: Vec3 = Math.abs(normal.y) < 0.9
    ? vec3.normalize(vec3.cross(normal, { x: 0, y: 1, z: 0 }))
    : vec3.normalize(vec3.cross(normal, { x: 1, y: 0, z: 0 }));
  const yAxis = vec3.normalize(vec3.cross(normal, xAxis));
  return sampleArcByBasis(center, xAxis, yAxis, radius, startAngle, endAngle, segments);
}

function sampleArcByBasis(center: Vec3, xAxis: Vec3, yAxis: Vec3, radius: number, startAngle: number, endAngle: number, segments: number): Vec3[] {
  let span = endAngle - startAngle;
  if (Math.abs(span) < 1e-10) return [];
  // Always sample in the direction of `span`.
  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = startAngle + span * t;
    const x = vec3.mul(xAxis, radius * Math.cos(a));
    const y = vec3.mul(yAxis, radius * Math.sin(a));
    out.push(vec3.add(center, vec3.add(x, y)));
  }
  return out;
}
