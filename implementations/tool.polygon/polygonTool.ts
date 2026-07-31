// @archigraph tool.polygon
// Polygon tool: click center, move for radius, creates regular polygon. Arrow keys change plane.

import type { Vec3, Plane } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool, DRAWING_PLANES } from '../tool.base/BaseTool';
import { planeBasis } from '../tool.base/planeGeometry';
import { getParametersStore } from '../plugin.system/draftdown/ParametersStore';

const POLYGON_PARAMS_ID = 'tool.polygon';

export class PolygonTool extends BaseTool {
  readonly id = 'tool.polygon';
  readonly name = 'Polygon';
  readonly icon = 'hexagon';
  readonly shortcut = 'G';
  readonly category = 'draw' as const;
  readonly cursor = 'crosshair';

  private center: Vec3 | null = null;
  private drawPlane: Plane = { normal: { x: 0, y: 1, z: 0 }, distance: 0 };
  private sides = 6;
  private currentRadius = 0;
  private lastScreenX = 0;
  private lastScreenY = 0;

  activate(): void {
    super.activate();
    this.reset();
    this.showParameters();
    this.setStatus(`Click to place center. Sides: ${this.sides}. Arrow keys change plane.`);
  }

  deactivate(): void {
    if (this.phase !== 'idle') this.abortTransaction();
    this.reset();
    getParametersStore().hide(POLYGON_PARAMS_ID);
    super.deactivate();
  }

  /** Mount the right-rail Parameters section so the user can pick the side count. */
  private showParameters(): void {
    getParametersStore().show({
      id: POLYGON_PARAMS_ID,
      title: 'Polygon',
      fields: [
        {
          kind: 'integer',
          key: 'sides',
          label: 'Sides',
          default: this.sides,
          min: 3,
          max: 100,
          help: 'Number of edges (3–100). Or type "8s" in the VCB while drawing.',
        },
        {
          kind: 'slider',
          key: 'sidesSlider',
          label: '',
          default: this.sides,
          min: 3,
          max: 24,
          step: 1,
        },
      ],
      values: { sides: this.sides, sidesSlider: this.sides },
      onChange: (values, key) => {
        const raw = key === 'sidesSlider' ? values.sidesSlider : values.sides;
        const next = Math.max(3, Math.min(100, Math.floor(Number(raw) || 0)));
        if (!Number.isFinite(next) || next < 3) return;
        if (next === this.sides) return;
        this.sides = next;
        // Keep both controls in sync
        getParametersStore().update(POLYGON_PARAMS_ID, { sides: next, sidesSlider: Math.min(24, next) });
        this.setStatus(this.phase === 'drawing'
          ? `Move to set radius. Sides: ${this.sides}.`
          : `Click to place center. Sides: ${this.sides}. Arrow keys change plane.`);
        // Force a preview refresh so the rubber-band reflects the new side count.
        this.requestPreviewRefresh();
      },
    });
  }

  /** Nudge the host to re-query getPreview() so the rubber-band updates. */
  private requestPreviewRefresh(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('draftdown:tool-preview-changed', { detail: { toolId: this.id } }));
    }
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.lastScreenX = event.screenX;
    this.lastScreenY = event.screenY;

    if (this.phase === 'idle') {
      const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
      if (!point) return;
      this.center = point;
      this.beginTransaction('Draw Polygon');
      // Use the hovered face's plane if the user clicked on a face.
      this.drawPlane = this.getEffectiveDrawingPlane(event, this.center);
      this.setPhase('drawing');
      this.setStatus('Move to set radius, then click. Arrow keys change plane.');
    } else if (this.phase === 'drawing') {
      this.createPolygon(this.currentRadius);
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase !== 'drawing' || !this.center) return;
    this.lastScreenX = event.screenX;
    this.lastScreenY = event.screenY;

    // Project onto the locked drawing plane (face plane if first click hit a
    // face), honoring a hard snap so the radius lands exactly on the snapped
    // point the indicator shows.
    const point = this.getPlanePointHonoringSnap(event, this.drawPlane)
      ?? this.resolvePoint(event);
    if (!point) return;

    const projected = vec3.projectOnPlane(point, this.drawPlane);
    this.currentRadius = vec3.distance(this.center, projected);
    this.setVCBValue(this.formatDist(this.currentRadius));
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.phase !== 'idle') this.abortTransaction();
      this.reset();
      this.setStatus(`Click to place center. Sides: ${this.sides}. Arrow keys change plane.`);
      return;
    }
    if (this.handleArrowKeyPlane(event)) {
      if (this.center) this.drawPlane = this.getDrawingPlane(this.center);
      const info = DRAWING_PLANES[this.drawingPlaneAxis];
      this.setStatus(`Plane: ${info.label}. Move to set radius.`);
    }
  }

  onVCBInput(value: string): void {
    if (this.tryRedoLastOp(value)) return;
    const trimmed = value.trim();
    if (trimmed.endsWith('s')) {
      const s = parseInt(trimmed.slice(0, -1), 10);
      if (!isNaN(s) && s >= 3 && s <= 100) {
        this.sides = s;
        // Mirror the change into the Parameters panel.
        getParametersStore().update(POLYGON_PARAMS_ID, { sides: s, sidesSlider: Math.min(24, s) });
        this.setStatus(`Sides: ${this.sides}`);
        this.requestPreviewRefresh();
        return;
      }
    }
    if (this.phase !== 'drawing' || !this.center) return;
    const radius = this.parseDistance(value);
    if (isNaN(radius) || radius <= 0) return;
    this.createPolygon(radius);
  }

  getVCBLabel(): string {
    return this.phase === 'drawing' ? 'Radius' : 'Sides';
  }

  getPreview(): ToolPreview | null {
    if (this.phase !== 'drawing' || !this.center || this.currentRadius <= 0) return null;
    return { polygon: this.computePoints(this.currentRadius) };
  }

  private reset(): void {
    this.center = null;
    this.currentRadius = 0;
    this.setPhase('idle');
    this.setVCBValue('');
  }

  private computePoints(radius: number): Vec3[] {
    if (!this.center) return [];
    const { tangent, bitangent } = planeBasis(this.drawPlane.normal);

    const points: Vec3[] = [];
    for (let i = 0; i < this.sides; i++) {
      const angle = (2 * Math.PI * i) / this.sides;
      const offset = vec3.add(
        vec3.mul(tangent, Math.cos(angle) * radius),
        vec3.mul(bitangent, Math.sin(angle) * radius),
      );
      points.push(vec3.add(this.center, offset));
    }
    return points;
  }

  private createPolygon(radius: number): void {
    if (!this.center || radius <= 0) return;

    // Side length must stay above the engine's weld tolerance (0.001) or
    // adjacent vertices weld onto each other's segments and the ring
    // degenerates into a zero-area blob.
    const side = 2 * radius * Math.sin(Math.PI / this.sides);
    if (side < 0.003) {
      this.abortTransaction();
      this.reset();
      this.setStatus(`Radius too small for ${this.sides} sides — increase the radius or reduce sides.`);
      return;
    }

    const points = this.computePoints(radius);
    const vertexIds: string[] = [];
    for (const p of points) {
      const v = this.document.geometry.createVertex(p);
      vertexIds.push(v.id);
    }
    for (let i = 0; i < this.sides; i++) {
      const next = (i + 1) % this.sides;
      this.document.geometry.createEdgeWithIntersection(vertexIds[i], vertexIds[next]);
    }

    // classic CAD coplanar merge: if the polygon crosses existing faces, split
    // them along the ring instead of stacking a full polygon face on top.
    const splits = this.document.geometry.splitFacesWithClosedRing(vertexIds);

    if (splits === 0) {
      try {
        this.document.geometry.createFace(vertexIds);
      } catch (e) {
        console.warn('[PolygonTool] createFace failed (likely edges split by intersections):', e);
      }
    }

    const center = { ...this.center };
    const plane = { normal: { ...this.drawPlane.normal }, distance: this.drawPlane.distance };

    this.commitTransaction();
    this.reset();
    this.setStatus(`Polygon created. Sides: ${this.sides}. Type a radius (or Ns) to redo.`);

    this.redoLastOp = (value: string) => {
      let newRadius = radius;
      const trimmed = value.trim();
      if (trimmed.endsWith('s')) {
        const sd = parseInt(trimmed.slice(0, -1), 10);
        if (isNaN(sd) || sd < 3 || sd > 100) return false;
        this.sides = sd;
      } else {
        const r = this.parseDistance(trimmed);
        if (isNaN(r) || r <= 0) return false;
        newRadius = r;
      }
      this.document.history.undo();
      this.center = { ...center };
      this.drawPlane = { normal: { ...plane.normal }, distance: plane.distance };
      this.beginTransaction('Draw Polygon');
      this.createPolygon(newRadius);
      return true;
    };
  }
}
