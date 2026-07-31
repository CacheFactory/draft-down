// @archigraph tool.protractor
// Protractor tool: measure angles and place construction guide lines.
// Click center → click baseline → move to measure → click to place guide.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3, radToDeg, degToRad } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';

export class ProtractorTool extends BaseTool {
  readonly id = 'tool.protractor';
  readonly name = 'Protractor';
  readonly icon = 'compass';
  readonly shortcut = 'Shift+P';
  readonly category = 'measure' as const;
  readonly cursor = 'crosshair';

  private center: Vec3 | null = null;
  private baselinePoint: Vec3 | null = null;
  private currentPoint: Vec3 | null = null;
  private currentAngle = 0;
  private step: 0 | 1 | 2 = 0;

  activate(): void {
    super.activate();
    this.reset();
    this.setStatus('Click to place protractor center.');
  }

  deactivate(): void {
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;

    if (this.step === 0) {
      this.center = point;
      this.step = 1;
      this.setPhase('drawing');
      this.setStatus('Click to set baseline direction.');
    } else if (this.step === 1) {
      this.baselinePoint = point;
      this.step = 2;
      this.setStatus('Move to measure angle. Click to place guide. Type degrees for exact.');
    } else if (this.step === 2) {
      this.placeGuide();
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;
    this.currentPoint = point;

    if (this.step === 2 && this.center && this.baselinePoint) {
      const baseDir = vec3.normalize(vec3.sub(this.baselinePoint, this.center));
      const curDir = vec3.normalize(vec3.sub(point, this.center));
      if (vec3.lengthSq(baseDir) > 0.001 && vec3.lengthSq(curDir) > 0.001) {
        this.currentAngle = radToDeg(vec3.angle(baseDir, curDir));
        this.setVCBValue(`${this.currentAngle.toFixed(1)}°`);
      }
    }
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      this.reset();
      this.setStatus('Click to place protractor center.');
    }
  }

  onVCBInput(value: string): void {
    if (this.step !== 2 || !this.center || !this.baselinePoint) return;

    const deg = parseFloat(value.replace('°', '').trim());
    if (isNaN(deg)) return;

    this.currentAngle = deg;

    // Compute the guide direction at the exact angle from the baseline
    const baseDir = vec3.normalize(vec3.sub(this.baselinePoint, this.center));
    const rad = degToRad(deg);

    // Rotate baseDir around Y axis by the angle (ground plane rotation)
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const guideDir: Vec3 = {
      x: baseDir.x * cos - baseDir.z * sin,
      y: baseDir.y,
      z: baseDir.x * sin + baseDir.z * cos,
    };

    this.beginTransaction('Protractor Guide');
    this.emitConstructionGuideLine(
      this.center, vec3.add(this.center, guideDir), { infinite: true },
    );
    this.commitTransaction();

    this.setStatus(`Guide placed at ${deg.toFixed(1)}°`);
    this.reset();
  }

  getVCBLabel(): string {
    return this.step === 2 ? 'Angle' : '';
  }

  getPreview(): ToolPreview | null {
    if (!this.center || !this.currentPoint) return null;

    const lines: Array<{ from: Vec3; to: Vec3 }> = [];

    if (this.step === 1) {
      // Show line from center to cursor (baseline preview)
      lines.push({ from: this.center, to: this.currentPoint });
    } else if (this.step === 2 && this.baselinePoint) {
      // Show baseline + current angle line
      lines.push({ from: this.center, to: this.baselinePoint });
      lines.push({ from: this.center, to: this.currentPoint });
    }

    return lines.length > 0 ? { lines } : null;
  }

  private placeGuide(): void {
    if (!this.center || !this.currentPoint) return;

    const dir = vec3.normalize(vec3.sub(this.currentPoint, this.center));
    if (vec3.lengthSq(dir) < 0.001) return;

    this.beginTransaction('Protractor Guide');
    this.emitConstructionGuideLine(
      this.center, vec3.add(this.center, dir), { infinite: true },
    );
    this.commitTransaction();

    this.setStatus(`Guide placed at ${this.currentAngle.toFixed(1)}°`);
    this.reset();
  }

  private reset(): void {
    this.center = null;
    this.baselinePoint = null;
    this.currentPoint = null;
    this.currentAngle = 0;
    this.step = 0;
    this.setPhase('idle');
    this.setVCBValue('');
  }
}
