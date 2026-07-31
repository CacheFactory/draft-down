// @archigraph tool.zoom
// Zoom tool: drag up/down to zoom, Ctrl+drag a window to zoom into it,
// shift+click for zoom extents

import type { ToolMouseEvent } from '../../src/core/interfaces';
import type { Vec3 } from '../../src/core/types';
import { BaseTool } from '../tool.base/BaseTool';

export class ZoomTool extends BaseTool {
  readonly id = 'tool.zoom';
  readonly name = 'Zoom';
  readonly icon = 'zoom-in';
  readonly shortcut = 'Z';
  readonly category = 'navigate' as const;
  readonly cursor = 'zoom-in';

  private lastY = 0;
  /** Zoom-window drag state (Ctrl+drag). */
  private windowStart: { x: number; y: number } | null = null;
  private windowCurrent: { x: number; y: number } | null = null;

  activate(): void {
    super.activate();
    this.setStatus('Drag up/down to zoom. Ctrl+drag a window to zoom into it. Shift+click for Zoom Extents.');
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    if (event.shiftKey) {
      // Zoom extents
      const bbox = this.document.geometry.getBoundingBox();
      this.viewport.camera.fitToBox(bbox);
      this.setStatus('Zoomed to extents.');
      return;
    }

    if (event.ctrlKey) {
      // Zoom window: drag a rectangle, zoom to fit it
      this.windowStart = { x: event.screenX, y: event.screenY };
      this.windowCurrent = { ...this.windowStart };
      this.setPhase('dragging');
      this.setStatus('Drag to frame the area, release to zoom.');
      return;
    }

    this.lastY = event.screenY;
    this.setPhase('dragging');
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase !== 'dragging') return;

    if (this.windowStart) {
      this.windowCurrent = { x: event.screenX, y: event.screenY };
      return;
    }

    const dy = event.screenY - this.lastY;
    this.lastY = event.screenY;

    // Negative dy = dragging up = zoom in
    this.viewport.camera.zoom(-dy * 0.5);
  }

  onMouseUp(event: ToolMouseEvent): void {
    if (this.windowStart && this.windowCurrent) {
      this.applyZoomWindow(this.windowStart, this.windowCurrent);
      this.windowStart = null;
      this.windowCurrent = null;
    }
    this.setPhase('idle');
  }

  /** Rectangle for the viewport overlay while dragging a zoom window. */
  getDragBox(): { x: number; y: number; width: number; height: number; mode: string } | null {
    if (!this.windowStart || !this.windowCurrent) return null;
    const x = Math.min(this.windowStart.x, this.windowCurrent.x);
    const y = Math.min(this.windowStart.y, this.windowCurrent.y);
    return {
      x, y,
      width: Math.abs(this.windowCurrent.x - this.windowStart.x),
      height: Math.abs(this.windowCurrent.y - this.windowStart.y),
      mode: 'window',
    };
  }

  /** Fit the camera to the world-space region under the dragged rectangle:
   *  sample rays at the rect corners + center against the scene (ground-plane
   *  fallback) and fit the resulting bounding box. */
  private applyZoomWindow(a: { x: number; y: number }, b: { x: number; y: number }): void {
    if (Math.abs(a.x - b.x) < 8 || Math.abs(a.y - b.y) < 8) {
      this.setStatus('Zoom window too small — drag a larger area.');
      return;
    }
    const samples: Array<{ x: number; y: number }> = [
      a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y },
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    ];
    const points: Vec3[] = [];
    for (const sp of samples) {
      const hits = this.viewport.raycastScene?.(sp.x, sp.y) ?? [];
      if (hits.length > 0) {
        points.push(hits[0].point);
      } else {
        const ground = this.viewport.screenToWorld(sp.x, sp.y);
        if (ground) points.push(ground);
      }
    }
    if (points.length < 2) {
      this.setStatus('Nothing under the zoom window.');
      return;
    }
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const p of points) {
      min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
    }
    this.viewport.camera.fitToBox({ min, max });
    this.setStatus('Zoomed to window.');
  }

  getVCBLabel(): string { return ''; }
}
