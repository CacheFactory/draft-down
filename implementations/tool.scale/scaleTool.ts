// @archigraph tool.scale
// Scale tool: shows bounding-box grips (corners + edge midpoints + center = 9).
// Click a grip, then drag to scale relative to the opposite grip.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview, ToolEventNeeds } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { CURSOR_SCALE } from '../tool.base/cursors';
import { VertexTransformSession } from '../tool.base/VertexTransformSession';
import { GripOverlay, GripItem } from '../tool.base/GripOverlay';

/** Which kind of grip: corner scales 2-axis, edge scales 1-axis, center scales uniform. */
type GripKind = 'corner' | 'edge' | 'center';

interface GripData {
  kind: GripKind;
  anchor: Vec3;      // opposite grip position (scale origin)
  /** Which axes to scale: null = all, otherwise only these axes are affected. */
  scaleAxes: ('x' | 'y' | 'z')[] | null;
}

export class ScaleTool extends BaseTool {
  readonly id = 'tool.scale';
  readonly name = 'Scale';
  readonly icon = 'scale';
  readonly shortcut = 'S';
  readonly category = 'modify' as const;
  readonly cursor = CURSOR_SCALE;

  /** Vertices being scaled + their pre-scale positions. */
  private session = new VertexTransformSession(this.document.geometry);
  private grips = new GripOverlay<GripData>(this.viewport, 'scale-grips');
  private activeGrip: GripItem<GripData> | null = null;
  private startDist = 0;
  private currentScale = 1;
  private bbCenter: Vec3 = { x: 0, y: 0, z: 0 };

  private bbLines: string[] = []; // guide line IDs for cleanup

  activate(): void {
    super.activate();
    this.reset();
    if (!this.document.selection.isEmpty) {
      this.session.gather(this.resolveSelectedEntityIds());
      if (this.session.size > 0) {
        this.showGrips();
        this.setStatus('Click a green grip to start scaling.');
      } else {
        this.setStatus('Select a face or edge first.');
      }
    } else {
      this.setStatus('Select a face or edge, then activate Scale.');
    }
  }

  deactivate(): void {
    if (this.phase !== 'idle') { this.session.restore(); this.abortTransaction(); }
    this.clearGrips();
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    if (this.phase === 'idle') {
      // If nothing selected yet, try clicking to select
      if (this.session.size === 0) {
        if (event.hitEntityId) {
          this.document.selection.select(event.hitEntityId);
          this.session.gather(this.resolveSelectedEntityIds());
          if (this.session.size > 0) {
            this.showGrips();
            this.setStatus('Click a green grip to start scaling.');
          }
        }
        return;
      }

      // Check if click is near a grip
      const grip = this.grips.findNearest(event.screenX, event.screenY);
      if (!grip) {
        this.setStatus('Click one of the green grips.');
        return;
      }

      this.activeGrip = grip;
      this.startDist = 0;
      this.session.snapshot();
      this.beginTransaction('Scale', [...this.session.vertexIds]);
      this.setPhase('drawing');
      this.setStatus('Drag to scale. Type factor and Enter for exact.');
    } else if (this.phase === 'drawing') {
      this.commitTransaction();
      this.clearGrips();
      this.session.gather(this.resolveSelectedEntityIds());
      this.showGrips();
      this.setPhase('idle');
      this.setStatus('Scale complete. Click a grip to scale again.');
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    // Keep grips at constant screen size
    this.grips.scaleToCamera();

    if (this.phase === 'idle') {
      // Highlight grip under cursor
      this.grips.updateHover(event.screenX, event.screenY);
      return;
    }

    if (this.phase !== 'drawing' || !this.activeGrip) return;
    const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;

    const anchor = this.activeGrip.data.anchor;
    const dist = vec3.distance(point, anchor);
    if (this.startDist === 0) {
      this.startDist = Math.max(vec3.distance(this.activeGrip.position, anchor), 0.01);
    }

    this.currentScale = dist / this.startDist;
    this.setVCBValue(this.currentScale.toFixed(3));
    this.applyScale(this.currentScale, anchor, this.activeGrip.data.scaleAxes);
    this.updateGripPositions();
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.phase !== 'idle') { this.session.restore(); this.abortTransaction(); }
      this.clearGrips();
      this.reset();
      this.setStatus('Scale cancelled.');
    }
  }

  onVCBInput(value: string): void {
    if (this.phase !== 'drawing' || !this.activeGrip) return;
    const factor = this.parseDistance(value);
    if (isNaN(factor) || factor <= 0) return;
    this.applyScale(factor, this.activeGrip.data.anchor, this.activeGrip.data.scaleAxes);
    this.commitTransaction();
    this.clearGrips();
    this.session.gather(this.resolveSelectedEntityIds());
    this.showGrips();
    this.setPhase('idle');
    this.setStatus('Scale complete.');
    this.setVCBValue('');
  }

  getVCBLabel(): string { return this.phase === 'drawing' ? 'Factor' : ''; }
  getPreview(): ToolPreview | null { return null; }

  getEventNeeds(): ToolEventNeeds {
    const isActive = this.phase === 'active' || this.phase === 'drawing';
    return { snap: isActive, raycast: isActive, edgeRaycast: false, liveSyncOnMove: isActive, mutatesOnClick: true };
  }

  // ── Private ────────────────────────────────────────────

  private reset(): void {
    this.session.clear();
    this.activeGrip = null;
    this.startDist = 0;
    this.currentScale = 1;
    this.setPhase('idle');
    this.setVCBValue('');
  }

  private applyScale(factor: number, anchor: Vec3, axes: ('x' | 'y' | 'z')[] | null): void {
    this._dirtyVertexIds = this.session.apply(orig => {
      const rel = vec3.sub(orig, anchor);
      if (axes) {
        return {
          x: axes.includes('x') ? anchor.x + rel.x * factor : orig.x,
          y: axes.includes('y') ? anchor.y + rel.y * factor : orig.y,
          z: axes.includes('z') ? anchor.z + rel.z * factor : orig.z,
        };
      }
      return vec3.add(anchor, vec3.mul(rel, factor));
    });
  }

  // ── Bounding Box & Grips ──────────────────────────────

  private showGrips(): void {
    const bb = this.session.bounds();
    const mn = bb.min;
    const mx = bb.max;
    this.bbCenter = bb.center;

    // Determine if this is essentially 2D (one axis has zero or near-zero extent)
    const dx = mx.x - mn.x;
    const dy = mx.y - mn.y;
    const dz = mx.z - mn.z;
    const threshold = 0.001;

    const flat2D = (dx < threshold ? 'x' : null) || (dy < threshold ? 'y' : null) || (dz < threshold ? 'z' : null);

    if (!this.grips.begin()) return;

    if (flat2D) {
      // 2D bounding box — 8 grips around perimeter + 1 center
      this.show2DGrips(mn, mx, flat2D);
    } else {
      // 3D bounding box — 8 corner grips + center
      this.show3DGrips(mn, mx);
    }

    // Draw bounding box edges as yellow guide lines
    this.drawBoundingBoxLines(mn, mx);

    // Scale grips to current camera distance
    this.grips.scaleToCamera();
  }

  private show2DGrips(mn: Vec3, mx: Vec3, flatAxis: string): void {
    // For a flat face, compute 4 corners and 4 edge midpoints.
    // Corners: scale both in-plane axes. Edge midpoints: scale only the
    // axis perpendicular to that edge (moves just that side).
    let corners: Vec3[];
    // The two in-plane axes, ordered so edges [0→1] and [2→3] are along axis1,
    // and edges [1→2] and [3→0] are along axis2.
    let axis1: 'x' | 'y' | 'z';
    let axis2: 'x' | 'y' | 'z';
    let bothAxes: ('x' | 'y' | 'z')[];

    if (flatAxis === 'y') {
      // XZ plane — corners go around in XZ
      const y = mn.y;
      corners = [
        { x: mn.x, y, z: mn.z }, { x: mx.x, y, z: mn.z },
        { x: mx.x, y, z: mx.z }, { x: mn.x, y, z: mx.z },
      ];
      axis1 = 'x'; axis2 = 'z'; bothAxes = ['x', 'z'];
    } else if (flatAxis === 'x') {
      // YZ plane
      const x = mn.x;
      corners = [
        { x, y: mn.y, z: mn.z }, { x, y: mx.y, z: mn.z },
        { x, y: mx.y, z: mx.z }, { x, y: mn.y, z: mx.z },
      ];
      axis1 = 'y'; axis2 = 'z'; bothAxes = ['y', 'z'];
    } else {
      // XY plane (flat on Z)
      const z = mn.z;
      corners = [
        { x: mn.x, y: mn.y, z }, { x: mx.x, y: mn.y, z },
        { x: mx.x, y: mx.y, z }, { x: mn.x, y: mx.y, z },
      ];
      axis1 = 'x'; axis2 = 'y'; bothAxes = ['x', 'y'];
    }

    // 4 corner grips — scale both in-plane axes from opposite corner
    for (let i = 0; i < 4; i++) {
      const opposite = corners[(i + 2) % 4];
      this.grips.add(corners[i], { kind: 'corner', anchor: opposite, scaleAxes: bothAxes });
    }

    // 4 edge midpoint grips — scale only the axis PERPENDICULAR to that edge.
    // Edges 0→1 and 2→3 run along axis1, so their midpoints scale axis2 only.
    // Edges 1→2 and 3→0 run along axis2, so their midpoints scale axis1 only.
    const edgeAxis: ('x' | 'y' | 'z')[][] = [[axis2], [axis1], [axis2], [axis1]];
    for (let i = 0; i < 4; i++) {
      const mid = vec3.lerp(corners[i], corners[(i + 1) % 4], 0.5);
      const oppMid = vec3.lerp(corners[(i + 2) % 4], corners[(i + 3) % 4], 0.5);
      this.grips.add(mid, { kind: 'edge', anchor: oppMid, scaleAxes: edgeAxis[i] });
    }

    // Center grip — uniform scale on all axes
    this.grips.add(this.bbCenter, { kind: 'center', anchor: this.bbCenter, scaleAxes: null });
  }

  private show3DGrips(mn: Vec3, mx: Vec3): void {
    // 8 corners of the 3D bounding box — scale all 3 axes
    const corners: Vec3[] = [
      { x: mn.x, y: mn.y, z: mn.z }, { x: mx.x, y: mn.y, z: mn.z },
      { x: mx.x, y: mn.y, z: mx.z }, { x: mn.x, y: mn.y, z: mx.z },
      { x: mn.x, y: mx.y, z: mn.z }, { x: mx.x, y: mx.y, z: mn.z },
      { x: mx.x, y: mx.y, z: mx.z }, { x: mn.x, y: mx.y, z: mx.z },
    ];

    for (let i = 0; i < 8; i++) {
      const opposite = corners[7 - i];
      this.grips.add(corners[i], { kind: 'corner', anchor: opposite, scaleAxes: ['x', 'y', 'z'] });
    }

    // Center grip — uniform
    this.grips.add(this.bbCenter, { kind: 'center', anchor: this.bbCenter, scaleAxes: null });
  }

  private drawBoundingBoxLines(mn: Vec3, mx: Vec3): void {
    const dx = mx.x - mn.x;
    const dy = mx.y - mn.y;
    const dz = mx.z - mn.z;
    const threshold = 0.001;
    const color = { r: 1, g: 1, b: 0 };
    const ts = Date.now();

    if (dy < threshold || dx < threshold || dz < threshold) {
      // Flat box — draw the 4 perimeter edges + dotted corner extensions
      let c: Vec3[];
      if (dy < threshold) {
        const y = mn.y;
        c = [
          { x: mn.x, y, z: mn.z }, { x: mx.x, y, z: mn.z },
          { x: mx.x, y, z: mx.z }, { x: mn.x, y, z: mx.z },
        ];
      } else if (dx < threshold) {
        const x = mn.x;
        c = [
          { x, y: mn.y, z: mn.z }, { x, y: mx.y, z: mn.z },
          { x, y: mx.y, z: mx.z }, { x, y: mn.y, z: mx.z },
        ];
      } else {
        const z = mn.z;
        c = [
          { x: mn.x, y: mn.y, z }, { x: mx.x, y: mn.y, z },
          { x: mx.x, y: mx.y, z }, { x: mn.x, y: mx.y, z },
        ];
      }
      for (let i = 0; i < 4; i++) {
        const id = `scale-bb-${ts}-${i}`;
        this.viewport.renderer.addGuideLine(id, c[i], c[(i + 1) % 4], color, false);
        this.bbLines.push(id);
      }
      for (let i = 0; i < 4; i++) {
        const dir = vec3.normalize(vec3.sub(c[i], this.bbCenter));
        const ext = vec3.add(c[i], vec3.mul(dir, 1.5));
        const id = `scale-ext-${ts}-${i}`;
        this.viewport.renderer.addGuideLine(id, c[i], ext, { r: 0.3, g: 0.3, b: 0.3 }, true);
        this.bbLines.push(id);
      }
    } else {
      // 3D box — 12 edges
      const c = [
        { x: mn.x, y: mn.y, z: mn.z }, { x: mx.x, y: mn.y, z: mn.z },
        { x: mx.x, y: mn.y, z: mx.z }, { x: mn.x, y: mn.y, z: mx.z },
        { x: mn.x, y: mx.y, z: mn.z }, { x: mx.x, y: mx.y, z: mn.z },
        { x: mx.x, y: mx.y, z: mx.z }, { x: mn.x, y: mx.y, z: mx.z },
      ];
      const edges = [
        [0,1],[1,2],[2,3],[3,0], // bottom
        [4,5],[5,6],[6,7],[7,4], // top
        [0,4],[1,5],[2,6],[3,7], // verticals
      ];
      for (let i = 0; i < edges.length; i++) {
        const id = `scale-bb-${ts}-${i}`;
        this.viewport.renderer.addGuideLine(id, c[edges[i][0]], c[edges[i][1]], color, false);
        this.bbLines.push(id);
      }
      // Extension lines from 8 corners
      for (let i = 0; i < 8; i++) {
        const dir = vec3.normalize(vec3.sub(c[i], this.bbCenter));
        const ext = vec3.add(c[i], vec3.mul(dir, 1.0));
        const id = `scale-ext-${ts}-${i}`;
        this.viewport.renderer.addGuideLine(id, c[i], ext, { r: 0.3, g: 0.3, b: 0.3 }, true);
        this.bbLines.push(id);
      }
    }
  }

  private updateGripPositions(): void {
    // Recompute bounding box from current (scaled) vertex positions
    const bb = this.session.bounds();
    const mn = bb.min;
    const mx = bb.max;
    this.bbCenter = bb.center;

    const dx = mx.x - mn.x;
    const dy = mx.y - mn.y;
    const dz = mx.z - mn.z;
    const threshold = 0.001;

    let positions: Vec3[];

    if (dy < threshold || dx < threshold || dz < threshold) {
      let c: Vec3[];
      if (dy < threshold) {
        const y = mn.y;
        c = [
          { x: mn.x, y, z: mn.z }, { x: mx.x, y, z: mn.z },
          { x: mx.x, y, z: mx.z }, { x: mn.x, y, z: mx.z },
        ];
      } else if (dx < threshold) {
        const x = mn.x;
        c = [
          { x, y: mn.y, z: mn.z }, { x, y: mx.y, z: mn.z },
          { x, y: mx.y, z: mx.z }, { x, y: mn.y, z: mx.z },
        ];
      } else {
        const z = mn.z;
        c = [
          { x: mn.x, y: mn.y, z }, { x: mx.x, y: mn.y, z },
          { x: mx.x, y: mx.y, z }, { x: mn.x, y: mx.y, z },
        ];
      }
      positions = [
        ...c,
        vec3.lerp(c[0], c[1], 0.5), vec3.lerp(c[1], c[2], 0.5),
        vec3.lerp(c[2], c[3], 0.5), vec3.lerp(c[3], c[0], 0.5),
        this.bbCenter,
      ];
    } else {
      const c = [
        { x: mn.x, y: mn.y, z: mn.z }, { x: mx.x, y: mn.y, z: mn.z },
        { x: mx.x, y: mn.y, z: mx.z }, { x: mn.x, y: mn.y, z: mx.z },
        { x: mn.x, y: mx.y, z: mn.z }, { x: mx.x, y: mx.y, z: mn.z },
        { x: mx.x, y: mx.y, z: mx.z }, { x: mn.x, y: mx.y, z: mx.z },
      ];
      positions = [...c, this.bbCenter];
    }

    this.grips.setPositions(positions);
  }

  private clearGrips(): void {
    this.grips.clear();
    // Remove bounding box guide lines
    for (const id of this.bbLines) {
      this.viewport.renderer.removeGuideLine(id);
    }
    this.bbLines = [];
    this.activeGrip = null;
  }
}
