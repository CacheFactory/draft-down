// @archigraph tool.pan
// Pan tool: drag to pan camera

import type { ToolMouseEvent } from '../../src/core/interfaces';
import { BaseTool } from '../tool.base/BaseTool';

export class PanTool extends BaseTool {
  readonly id = 'tool.pan';
  readonly name = 'Pan';
  readonly icon = 'hand';
  readonly shortcut = 'H';
  readonly category = 'navigate' as const;
  readonly cursor = 'grab';

  private lastX = 0;
  private lastY = 0;

  activate(): void {
    super.activate();
    this.setStatus('Click and drag to pan.');
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.lastX = event.screenX;
    this.lastY = event.screenY;
    this.setPhase('dragging');
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase !== 'dragging') return;

    const dx = event.screenX - this.lastX;
    const dy = event.screenY - this.lastY;
    this.lastX = event.screenX;
    this.lastY = event.screenY;

    this.viewport.camera.pan(dx, dy);
  }

  onMouseUp(_event: ToolMouseEvent): void {
    this.setPhase('idle');
  }

  getVCBLabel(): string { return ''; }
}
