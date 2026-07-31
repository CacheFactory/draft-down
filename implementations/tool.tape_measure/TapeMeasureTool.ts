// @archigraph tool.tape_measure
// Tape measure: three modes (Guide Line / Guide Point / Measure) cycled with
// Ctrl. Hovering an edge in idle phase shows that edge's length in the VCB.
// Click on an edge in Guide Line mode creates an infinite axis along it.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { CURSOR_TAPE } from '../tool.base/cursors';
import { getParametersStore } from '../plugin.system/draftdown/ParametersStore';

const TAPE_PARAMS_ID = 'tool.tape_measure.params';

type TapeMode = 'guide-line' | 'guide-point' | 'measure';

export class TapeMeasureTool extends BaseTool {
  readonly id = 'tool.tape_measure';
  readonly name = 'Tape Measure';
  readonly icon = 'ruler';
  readonly shortcut = 'T';
  readonly category = 'measure' as const;
  readonly cursor = CURSOR_TAPE;

  private startPoint: Vec3 | null = null;
  private currentPoint: Vec3 | null = null;
  private mode: TapeMode = 'guide-line';

  activate(): void {
    super.activate();
    this.reset();
    this.showParameters();
    this.setStatus(this.idleStatus());
  }

  deactivate(): void {
    this.reset();
    getParametersStore().hide(TAPE_PARAMS_ID);
    super.deactivate();
  }

  private modeHelp(mode: TapeMode): string {
    switch (mode) {
      case 'guide-line':
        return 'Guide Line — Click two points to drop a dashed construction line between them. Click an existing edge to extend it as an infinite axis. Press Ctrl to cycle modes.';
      case 'guide-point':
        return 'Guide Point — Click a start point, then a second point (or type a distance). A small 3-axis cross marker is placed at the endpoint. Press Ctrl to cycle modes.';
      case 'measure':
        return 'Measure — Click two points (or hover an edge) to read the distance. No geometry is created. Press Ctrl to cycle modes.';
    }
  }

  private showParameters(): void {
    getParametersStore().show({
      id: TAPE_PARAMS_ID,
      title: 'Tape Measure',
      fields: [
        {
          kind: 'select',
          key: 'mode',
          label: 'Mode',
          default: this.mode,
          options: [
            { label: 'Guide Line',  value: 'guide-line' },
            { label: 'Guide Point', value: 'guide-point' },
            { label: 'Measure',     value: 'measure' },
          ],
          help: this.modeHelp(this.mode),
        },
      ],
      values: { mode: this.mode },
      onChange: (values) => {
        const next: TapeMode = values.mode === 'measure' ? 'measure'
                             : values.mode === 'guide-point' ? 'guide-point'
                             : 'guide-line';
        if (next === this.mode) return;
        this.mode = next;
        // Re-render the panel so the mode-specific help replaces the previous text.
        this.showParameters();
        this.setStatus(this.phase === 'drawing' ? this.drawingStatus() : this.idleStatus());
      },
    });
  }

  /** Sync the panel's mode field + help text when the user cycles via Ctrl. */
  private syncPanelMode(): void {
    // Use show() rather than update() so the `help` text reflects the new mode.
    this.showParameters();
  }

  // ── Mode helpers ────────────────────────────────────────

  private modeLabel(): string {
    switch (this.mode) {
      case 'guide-line': return 'Guide Line';
      case 'guide-point': return 'Guide Point';
      case 'measure': return 'Measure';
    }
  }

  private cycleMode(): void {
    this.mode = this.mode === 'guide-line' ? 'guide-point'
              : this.mode === 'guide-point' ? 'measure'
              : 'guide-line';
    this.syncPanelMode();
    this.setStatus(this.phase === 'drawing' ? this.drawingStatus() : this.idleStatus());
  }

  private idleStatus(): string {
    return `Tape Measure (${this.modeLabel()}). Press Ctrl to cycle modes. Hover an edge to read its length.`;
  }
  private drawingStatus(): string {
    const m = this.modeLabel();
    if (this.mode === 'measure') return `${m}: click endpoint or type a distance to read.`;
    if (this.mode === 'guide-point') return `${m}: click endpoint or type a distance to place a guide point.`;
    return `${m}: click endpoint or type a distance to create a guide.`;
  }

  // ── Input ───────────────────────────────────────────────

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    // Guide-Line mode + click on an edge → infinite axis along that edge.
    // Matches the classic modeler's "click a line to extend its axis" behavior.
    if (this.phase === 'idle' && this.mode === 'guide-line' && event.hitEntityId) {
      const edge = this.document.geometry.getEdge(event.hitEntityId);
      if (edge) {
        const v1 = this.document.geometry.getVertex(edge.startVertexId);
        const v2 = this.document.geometry.getVertex(edge.endVertexId);
        if (v1 && v2) {
          this.createInfiniteAxis(v1.position, v2.position);
          this.setStatus(`Infinite axis created. ${this.idleStatus()}`);
          return;
        }
      }
    }

    const point = this.getStandardDrawPoint(event, this.startPoint ?? undefined);
    if (!point) return;

    if (this.phase === 'idle') {
      this.startPoint = point;
      this.findOrCreateVertex(point);
      this.setPhase('drawing');
      this.setStatus(this.drawingStatus());
    } else if (this.phase === 'drawing') {
      // Constrain the click like the preview (axis / parallel inference)
      const constrained = this.startPoint
        ? this.applyDirectionInference(this.startPoint, point, event)
        : point;
      this.completeMeasurement(constrained);
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    let point = this.getStandardDrawPoint(event, this.startPoint ?? undefined);
    if (!point) return;

    if (this.phase === 'drawing' && this.startPoint) {
      // classic-CAD-style axis/parallel inference on the measure direction
      point = this.applyDirectionInference(this.startPoint, point, event);
      this.currentPoint = point;
      const dist = vec3.distance(this.startPoint, point);
      this.setVCBValue(this.formatDist(dist));
      return;
    }
    this.currentPoint = point;

    // Idle: hover over an edge → show its length in the VCB.
    if (this.phase === 'idle' && event.hitEntityId) {
      const edge = this.document.geometry.getEdge(event.hitEntityId);
      if (edge) {
        const v1 = this.document.geometry.getVertex(edge.startVertexId);
        const v2 = this.document.geometry.getVertex(edge.endVertexId);
        if (v1 && v2) {
          const dist = vec3.distance(v1.position, v2.position);
          this.setVCBValue(this.formatDist(dist));
          return;
        }
      }
    }
    this.setVCBValue('');
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      this.reset();
      this.setStatus(this.idleStatus());
      return;
    }
    if (event.key === 'Control' || event.key === 'Meta') {
      this.cycleMode();
      return;
    }
    this.handleArrowKeyPlane(event);
  }

  onVCBInput(value: string): void {
    if (this.phase !== 'drawing' || !this.startPoint || !this.currentPoint) return;
    const dist = this.parseDistance(value);
    if (isNaN(dist) || dist <= 0) return;

    const delta = vec3.sub(this.currentPoint, this.startPoint);
    if (vec3.length(delta) < 1e-10) return;
    const direction = vec3.normalize(delta);
    const endPoint = vec3.add(this.startPoint, vec3.mul(direction, dist));
    this.completeMeasurement(endPoint);
  }

  getVCBLabel(): string {
    if (this.phase === 'drawing') return 'Distance';
    return 'Length';
  }

  getPreview(): ToolPreview | null {
    if (this.phase !== 'drawing' || !this.startPoint || !this.currentPoint) return null;
    return { lines: [{ from: this.startPoint, to: this.currentPoint, color: this.inferenceColor ?? undefined }] };
  }

  // ── Helpers ─────────────────────────────────────────────

  private createInfiniteAxis(a: Vec3, b: Vec3): void {
    const dir = vec3.normalize(vec3.sub(b, a));
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 };
    const p1 = vec3.add(mid, vec3.mul(dir, -1));
    const p2 = vec3.add(mid, vec3.mul(dir, 1));
    this.emitGuideLine(p1, p2, 'Infinite Axis');
  }

  private completeMeasurement(endPoint: Vec3): void {
    if (!this.startPoint) return;

    const dist = vec3.distance(this.startPoint, endPoint);
    this.setVCBValue(this.formatDist(dist));
    this.setStatus(`Distance: ${this.formatDist(dist)} (${this.modeLabel()}).`);

    if (this.mode === 'measure') {
      // No geometry — just the reading.
      this.reset();
      return;
    }
    if (this.mode === 'guide-point') {
      this.emitGuidePoint(endPoint);
      this.reset();
      return;
    }
    // guide-line
    this.emitGuideLine(this.startPoint, endPoint, 'Tape Measure');
    this.reset();
  }

  private emitGuideLine(a: Vec3, b: Vec3, txName: string): void {
    this.beginTransaction(txName);
    // classic CAD guide lines are INFINITE — the two points give the direction.
    this.emitConstructionGuideLine(a, b, { infinite: true });
    this.commitTransaction();
  }

  private emitGuidePoint(p: Vec3): void {
    this.beginTransaction('Guide Point');
    this.emitConstructionGuidePoint(p);
    this.commitTransaction();
  }

  private reset(): void {
    this.startPoint = null;
    this.currentPoint = null;
    this.clearDirectionInference();
    this.setPhase('idle');
    this.setVCBValue('');
  }
}
