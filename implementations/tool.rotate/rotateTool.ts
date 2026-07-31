// @archigraph tool.rotate
// Rotate tool: shows protractor-style handles on selection bounding box.
// Arrow keys lock rotation axis (Up=green/Y, Right=red/X, Left=blue/Z).
// Click handle → drag to rotate with live preview. Type degrees for exact angle.
// Ctrl at the center/start-angle click rotates a COPY (classic CAD); after a
// copy commits, typing xN in the VCB makes a radial array (N total copies at
// k·angle) and /N subdivides the rotation into N evenly-spaced copies.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview, ToolEventNeeds } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { CURSOR_ROTATE } from '../tool.base/cursors';
import { VertexTransformSession } from '../tool.base/VertexTransformSession';
import { cloneEntitiesFromIds } from '../tool.base/cloneGeometry';
import { GripOverlay } from '../tool.base/GripOverlay';
import { planeBasis } from '../tool.base/planeGeometry';

export class RotateTool extends BaseTool {
  readonly id = 'tool.rotate';
  readonly name = 'Rotate';
  readonly icon = 'rotate';
  readonly shortcut = 'Q';
  readonly category = 'modify' as const;
  readonly cursor = CURSOR_ROTATE;

  private center: Vec3 | null = null;
  private startAngleRef: Vec3 | null = null;
  private currentAngle = 0;
  private step: 0 | 1 | 2 = 0;
  /** Vertices being rotated + their pre-rotation positions. */
  private session = new VertexTransformSession(this.document.geometry);
  private rotationAxis: Vec3 = { x: 0, y: 1, z: 0 };
  private axisName: 'green' | 'red' | 'blue' | 'face' = 'green';
  /** Face id the protractor is currently oriented to (hover), if any. */
  private orientedFaceId: string | null = null;
  /** Ctrl at the center/start-angle click → rotate a copy, originals stay. */
  private isCopy = false;

  // Post-copy radial-array state: typing xN or /N in the VCB right after a
  // copy-rotate commits builds the array around the same center/axis.
  private lastRotate: { angle: number; center: Vec3; axis: Vec3 } | null = null;
  private lastRotateSourceIds: string[] = [];
  private lastRotateClonedVertexIds: string[] = [];

  // Handles & visual overlay
  private handles = new GripOverlay<string>(this.viewport, 'rotate-handles');
  private protractorLines: string[] = [];

  // ── Lifecycle ─────────────────────────────────────────

  activate(): void {
    super.activate();
    this.reset();
    if (!this.document.selection.isEmpty) {
      this.session.gather(this.resolveSelectedEntityIds());
      if (this.session.size > 0) {
        this.showHandles();
        this.setStatus(`Click a handle to set rotation center. Arrow keys change axis (${this.axisLabel()}).`);
      } else {
        this.setStatus('Select a face or edge first.');
      }
    } else {
      this.setStatus('Select geometry, then activate Rotate.');
    }
  }

  deactivate(): void {
    if (this.step > 0) { this.session.restore(); this.abortTransaction(); }
    this.clearHandles();
    this.reset();
    super.deactivate();
  }

  // ── Mouse events ──────────────────────────────────────

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;

    if (this.step === 0) {
      // If nothing selected, try clicking to select
      if (this.session.size === 0) {
        if (event.hitEntityId) {
          this.document.selection.select(event.hitEntityId);
          this.session.gather(this.resolveSelectedEntityIds());
          if (this.session.size > 0) {
            this.showHandles();
            this.setStatus(`Click a handle to set rotation center. Arrow keys change axis (${this.axisLabel()}).`);
          }
        }
        return;
      }

      // Check if a handle was clicked
      const handle = this.handles.findNearest(event.screenX, event.screenY);
      if (handle) {
        this.center = { ...handle.position };
      } else {
        // Click on arbitrary point as center
        this.center = point;
      }

      this.isCopy = event.ctrlKey;
      this.beginTransaction(this.isCopy ? 'Rotate Copy' : 'Rotate', this.isCopy ? [] : [...this.session.vertexIds]);
      if (this.isCopy) this.switchSessionToClones();
      this.session.snapshot();
      this.clearHandles();
      this.drawProtractor();
      this.step = 1;
      this.setPhase('drawing');
      this.setStatus(this.isCopy
        ? 'Click to set start angle reference. (Copy)'
        : 'Click to set start angle reference. Hold Ctrl to rotate a copy.');
    } else if (this.step === 1) {
      // Ctrl pressed late (classic CAD allows toggling before rotation starts):
      // no rotation has been applied yet, so switch to clones now.
      if (event.ctrlKey && !this.isCopy) {
        this.isCopy = true;
        this.switchSessionToClones();
        this.session.snapshot();
      }
      this.startAngleRef = point;
      this.step = 2;
      this.setStatus(`Drag to rotate. Type degrees for exact angle.${this.isCopy ? ' (Copy)' : ''}`);
    } else if (this.step === 2) {
      this.clearProtractor();
      this.finishRotate(this.currentAngle);
    }
  }

  /** Commit the active rotation, arming the radial-array VCB when copying. */
  private finishRotate(angle: number): void {
    // Instance transform tracking: rotating a whole component records the
    // rotation so sibling-instance propagation can reproduce its pose.
    if (!this.isCopy && Math.abs(angle) > 1e-9) {
      const selIds = [...this.document.selection.state.entityIds];
      const sm = this.document.scene as any;
      if (selIds.length === 1 && sm?.components?.has(selIds[0]) && sm.accumulateComponentRotation) {
        const half = angle / 2;
        const sinH = Math.sin(half);
        sm.accumulateComponentRotation(selIds[0], {
          x: this.rotationAxis.x * sinH,
          y: this.rotationAxis.y * sinH,
          z: this.rotationAxis.z * sinH,
          w: Math.cos(half),
        });
      }
    }
    const wasCopy = this.isCopy;
    const center = this.center ? { ...this.center } : null;
    const axis = { ...this.rotationAxis };
    const clonedVertexIds = [...this.session.vertexIds];
    this.commitTransaction();
    this.reset();
    if (wasCopy && center && Math.abs(angle) > 1e-9) {
      this.lastRotate = { angle, center, axis };
      this.lastRotateClonedVertexIds = clonedVertexIds;
      this.setStatus('Copy rotated. Type Nx (e.g. 6x) for a radial array, or /N to subdivide.');
    } else {
      this.lastRotate = null;
      this.lastRotateSourceIds = [];
      this.setStatus('Rotation complete.');
    }
    this.session.gather(this.resolveSelectedEntityIds());
    if (this.session.size > 0) this.showHandles();
  }

  /** Replace the session's originals with fresh clones (originals stay put). */
  private switchSessionToClones(): void {
    const sourceIds = this.resolveSelectedEntityIds();
    const clone = cloneEntitiesFromIds(this.document.geometry, sourceIds);
    this.lastRotateSourceIds = [...sourceIds];
    this.session.setVertices(clone.newVertexIds);
  }

  onMouseMove(event: ToolMouseEvent): void {
    // Keep handles at constant screen size
    this.handles.scaleToCamera();

    if (this.step === 0) {
      // Highlight handle under cursor
      this.handles.updateHover(event.screenX, event.screenY);
      // classic CAD: the protractor orients to the face under the cursor
      if (event.hitFaceId && event.hitFaceId !== this.orientedFaceId && this.session.size > 0) {
        const face = this.document.geometry.getFace(event.hitFaceId);
        if (face) {
          this.orientedFaceId = event.hitFaceId;
          this.rotationAxis = vec3.normalize({ ...face.normal });
          this.axisName = 'face';
          this.showHandles();
          this.setStatus('Protractor on hovered face. Arrow keys lock a world axis. Click a handle to set center.');
        }
      }
      return;
    }

    if (this.step !== 2 || !this.center || !this.startAngleRef) return;
    const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;

    const v1 = vec3.normalize(vec3.sub(this.startAngleRef, this.center));
    const v2 = vec3.normalize(vec3.sub(point, this.center));
    const dot = Math.max(-1, Math.min(1, vec3.dot(v1, v2)));
    const cross = vec3.cross(v1, v2);
    const sign = vec3.dot(cross, this.rotationAxis) >= 0 ? 1 : -1;
    this.currentAngle = sign * Math.acos(dot);
    this.setVCBValue(`${(this.currentAngle * 180 / Math.PI).toFixed(1)}°`);
    this.applyRotation(this.currentAngle);
  }

  // ── Keyboard events ───────────────────────────────────

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.step > 0) { this.session.restore(); this.abortTransaction(); this.clearProtractor(); }
      this.clearHandles();
      this.reset();
      this.session.gather(this.resolveSelectedEntityIds());
      if (this.session.size > 0) this.showHandles();
      this.setStatus('Rotation cancelled.');
      return;
    }

    // Arrow keys change rotation axis (toggle behavior: press again to reset to green/Y)
    this.orientedFaceId = null;
    const prevAxis = this.axisName;
    switch (event.key) {
      case 'ArrowUp':
        this.setAxis(prevAxis === 'green' ? 'green' : 'green');
        break;
      case 'ArrowRight':
        this.setAxis(prevAxis === 'red' ? 'green' : 'red');
        break;
      case 'ArrowLeft':
        this.setAxis(prevAxis === 'blue' ? 'green' : 'blue');
        break;
      case 'ArrowDown':
        this.setAxis('green');
        break;
      default:
        return;
    }

    // If we're in step 0, refresh handles for new axis
    if (this.step === 0 && this.session.size > 0) {
      this.showHandles();
      this.setStatus(`Rotation axis: ${this.axisLabel()}. Click a handle to set center.`);
    } else if (this.step >= 1) {
      // If mid-rotation, update the protractor visual and re-apply
      this.clearProtractor();
      this.drawProtractor();
      if (this.step === 2) {
        this.applyRotation(this.currentAngle);
      }
      this.setStatus(`Rotation axis: ${this.axisLabel()}. ${this.step === 1 ? 'Click start angle.' : 'Drag to rotate.'}`);
    }
  }

  // ── VCB ───────────────────────────────────────────────

  onVCBInput(value: string): void {
    const trimmed = value.trim();

    // Idle + fresh from a copy-rotate → radial array commands.
    if (this.step === 0 && this.lastRotate) {
      const arrayMatch = trimmed.match(/^(\d+)\s*x$/i) ?? trimmed.match(/^\*\s*(\d+)$/);
      if (arrayMatch) {
        const n = parseInt(arrayMatch[1], 10);
        if (n >= 2) this.radialArrayRepeat(n);
        return;
      }
      const divideMatch = trimmed.match(/^\/\s*(\d+)$/);
      if (divideMatch) {
        const n = parseInt(divideMatch[1], 10);
        if (n >= 2) this.radialArraySubdivide(n);
        return;
      }
    }

    if (this.step !== 2) return;
    // Angle, not a distance — no length-unit conversion.
    const deg = parseFloat(trimmed.replace('°', ''));
    if (isNaN(deg)) return;
    const angle = deg * Math.PI / 180;
    this.applyRotation(angle);
    this.clearProtractor();
    this.finishRotate(angle);
  }

  // ── Radial arrays ─────────────────────────────────────

  /** xN: N total copies around the center — the first exists; add N-1 more
   *  at k·angle (fresh clones of the ORIGINALS, rotated k steps). */
  private radialArrayRepeat(n: number): void {
    if (!this.lastRotate || this.lastRotateSourceIds.length === 0) return;
    const { angle, center, axis } = this.lastRotate;
    this.beginTransaction(`Radial Array x${n}`, []);
    let created = 0;
    for (let k = 2; k <= n; k++) {
      const clone = cloneEntitiesFromIds(this.document.geometry, this.lastRotateSourceIds);
      if (clone.newVertexIds.length === 0) continue;
      this.rotateVerticesBy(clone.newVertexIds, angle * k, center, axis);
      created++;
    }
    this.commitTransaction();
    this.setStatus(`Created ${created} additional ${created === 1 ? 'copy' : 'copies'} around the center.`);
    this.lastRotate = null;
    this.lastRotateSourceIds = [];
    this.lastRotateClonedVertexIds = [];
    this.setVCBValue('');
  }

  /** /N: divide the committed rotation into N evenly-spaced copies — move the
   *  existing copy to angle/N, then add copies at 2·angle/N .. angle. */
  private radialArraySubdivide(n: number): void {
    if (!this.lastRotate || this.lastRotateSourceIds.length === 0 || n < 2) return;
    const { angle, center, axis } = this.lastRotate;
    this.beginTransaction(`Radial Array /${n}`, []);

    // Rotations about the same axis compose additively: shifting the existing
    // copy from angle to angle/n means rotating it by (angle/n − angle).
    this.rotateVerticesBy(this.lastRotateClonedVertexIds, angle / n - angle, center, axis);

    let created = 1;
    for (let k = 2; k <= n; k++) {
      const clone = cloneEntitiesFromIds(this.document.geometry, this.lastRotateSourceIds);
      if (clone.newVertexIds.length === 0) continue;
      this.rotateVerticesBy(clone.newVertexIds, angle * k / n, center, axis);
      created++;
    }
    this.commitTransaction();
    this.setStatus(`Created ${created} copies subdividing the rotation.`);
    this.lastRotate = null;
    this.lastRotateSourceIds = [];
    this.lastRotateClonedVertexIds = [];
    this.setVCBValue('');
  }

  /** Rodrigues-rotate the CURRENT positions of the given vertices. */
  private rotateVerticesBy(vertexIds: string[], angle: number, center: Vec3, axis: Vec3): void {
    const geo = this.document.geometry;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (const vid of vertexIds) {
      const v = geo.getVertex(vid);
      if (!v) continue;
      const rel = vec3.sub(v.position, center);
      const d = vec3.dot(rel, axis);
      const cr = vec3.cross(axis, rel);
      const rot = vec3.add(vec3.add(vec3.mul(rel, cos), vec3.mul(cr, sin)), vec3.mul(axis, d * (1 - cos)));
      const p = vec3.add(center, rot);
      v.position.x = p.x; v.position.y = p.y; v.position.z = p.z;
    }
    this._dirtyVertexIds = vertexIds;
  }

  getVCBLabel(): string {
    if (this.step === 2) return 'Angle';
    if (this.lastRotate) return 'Array (Nx or /N)';
    return '';
  }
  getPreview(): ToolPreview | null { return null; }

  getEventNeeds(): ToolEventNeeds {
    const isActive = this.phase === 'active' || this.phase === 'drawing';
    // raycast in idle too — the protractor orients to the hovered face
    return { snap: isActive, raycast: true, edgeRaycast: false, liveSyncOnMove: isActive, mutatesOnClick: true };
  }

  // ── Axis management ───────────────────────────────────

  private setAxis(name: 'green' | 'red' | 'blue'): void {
    this.axisName = name;
    switch (name) {
      case 'green': this.rotationAxis = { x: 0, y: 1, z: 0 }; break;
      case 'red':   this.rotationAxis = { x: 1, y: 0, z: 0 }; break;
      case 'blue':  this.rotationAxis = { x: 0, y: 0, z: 1 }; break;
    }
  }

  private axisLabel(): string {
    // classic CAD color language: blue = vertical (Y in this Y-up app)
    switch (this.axisName) {
      case 'green': return 'Blue (Y)';
      case 'red':   return 'Red (X)';
      case 'blue':  return 'Green (Z)';
      case 'face':  return 'Hovered face';
    }
  }

  // ── State management ──────────────────────────────────

  private reset(): void {
    this.orientedFaceId = null;
    this.center = null;
    this.startAngleRef = null;
    this.currentAngle = 0;
    this.step = 0;
    this.isCopy = false;
    this.session.clear();
    this.setPhase('idle');
    this.setVCBValue('');
  }

  private applyRotation(angle: number): void {
    if (!this.center) return;
    const center = this.center;
    const cos = Math.cos(angle), sin = Math.sin(angle), ax = this.rotationAxis;
    this._dirtyVertexIds = this.session.apply(orig => {
      const rel = vec3.sub(orig, center);
      const d = vec3.dot(rel, ax);
      const cr = vec3.cross(ax, rel);
      const rot = vec3.add(vec3.add(vec3.mul(rel, cos), vec3.mul(cr, sin)), vec3.mul(ax, d * (1 - cos)));
      return vec3.add(center, rot);
    });
  }

  // ── Handle system ─────────────────────────────────────

  private showHandles(): void {
    if (!this.handles.begin()) return;

    const bb = this.session.bounds();
    const mn = bb.min, mx = bb.max, ct = bb.center;

    // Place handles at bounding box center + face centers + edge midpoints
    // depending on the rotation axis
    const handlePositions: Array<{ pos: Vec3; label: string }> = [];

    // Center handle (always present)
    handlePositions.push({ pos: ct, label: 'center' });

    // Face center handles perpendicular to rotation axis
    if (this.axisName === 'green' || this.axisName === 'face') {
      // Rotating around Y: put handles on XZ face centers + corners
      handlePositions.push({ pos: { x: mn.x, y: ct.y, z: ct.z }, label: '-X face' });
      handlePositions.push({ pos: { x: mx.x, y: ct.y, z: ct.z }, label: '+X face' });
      handlePositions.push({ pos: { x: ct.x, y: ct.y, z: mn.z }, label: '-Z face' });
      handlePositions.push({ pos: { x: ct.x, y: ct.y, z: mx.z }, label: '+Z face' });
      // Corners in XZ plane at mid Y
      handlePositions.push({ pos: { x: mn.x, y: ct.y, z: mn.z }, label: 'corner' });
      handlePositions.push({ pos: { x: mx.x, y: ct.y, z: mn.z }, label: 'corner' });
      handlePositions.push({ pos: { x: mx.x, y: ct.y, z: mx.z }, label: 'corner' });
      handlePositions.push({ pos: { x: mn.x, y: ct.y, z: mx.z }, label: 'corner' });
    } else if (this.axisName === 'red') {
      // Rotating around X: put handles on YZ face centers + corners
      handlePositions.push({ pos: { x: ct.x, y: mn.y, z: ct.z }, label: '-Y face' });
      handlePositions.push({ pos: { x: ct.x, y: mx.y, z: ct.z }, label: '+Y face' });
      handlePositions.push({ pos: { x: ct.x, y: ct.y, z: mn.z }, label: '-Z face' });
      handlePositions.push({ pos: { x: ct.x, y: ct.y, z: mx.z }, label: '+Z face' });
      handlePositions.push({ pos: { x: ct.x, y: mn.y, z: mn.z }, label: 'corner' });
      handlePositions.push({ pos: { x: ct.x, y: mx.y, z: mn.z }, label: 'corner' });
      handlePositions.push({ pos: { x: ct.x, y: mx.y, z: mx.z }, label: 'corner' });
      handlePositions.push({ pos: { x: ct.x, y: mn.y, z: mx.z }, label: 'corner' });
    } else {
      // Rotating around Z: put handles on XY face centers + corners
      handlePositions.push({ pos: { x: mn.x, y: ct.y, z: ct.z }, label: '-X face' });
      handlePositions.push({ pos: { x: mx.x, y: ct.y, z: ct.z }, label: '+X face' });
      handlePositions.push({ pos: { x: ct.x, y: mn.y, z: ct.z }, label: '-Y face' });
      handlePositions.push({ pos: { x: ct.x, y: mx.y, z: ct.z }, label: '+Y face' });
      handlePositions.push({ pos: { x: mn.x, y: mn.y, z: ct.z }, label: 'corner' });
      handlePositions.push({ pos: { x: mx.x, y: mn.y, z: ct.z }, label: 'corner' });
      handlePositions.push({ pos: { x: mx.x, y: mx.y, z: ct.z }, label: 'corner' });
      handlePositions.push({ pos: { x: mn.x, y: mx.y, z: ct.z }, label: 'corner' });
    }

    for (const { pos, label } of handlePositions) {
      this.handles.add(pos, label);
    }

    // Draw axis line through center
    const axisExtent = Math.max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z) * 0.8;
    const axLine1 = vec3.add(ct, vec3.mul(this.rotationAxis, axisExtent));
    const axLine2 = vec3.add(ct, vec3.mul(this.rotationAxis, -axisExtent));
    const axColor = this.axisName === 'red' ? { r: 0.8, g: 0, b: 0 }
                  : this.axisName === 'blue' ? { r: 0, g: 0.7, b: 0.2 }   // Z = green
                  : this.axisName === 'face' ? { r: 0.3, g: 0.3, b: 0.3 } // face normal
                  : { r: 0.15, g: 0.35, b: 1 };                           // Y = blue (vertical)
    const ts = Date.now();
    const axId = `rotate-axis-${ts}`;
    this.viewport.renderer.addGuideLine(axId, axLine1, axLine2, axColor, true);
    this.protractorLines.push(axId);

    this.handles.scaleToCamera();
  }

  // ── Protractor visual ─────────────────────────────────

  private drawProtractor(): void {
    if (!this.center) return;
    const ts = Date.now();

    // Draw rotation axis through center
    const axisExtent = 2.0;
    const axLine1 = vec3.add(this.center, vec3.mul(this.rotationAxis, axisExtent));
    const axLine2 = vec3.add(this.center, vec3.mul(this.rotationAxis, -axisExtent));
    const axColor = this.axisName === 'red' ? { r: 0.8, g: 0, b: 0 }
                  : this.axisName === 'blue' ? { r: 0, g: 0.7, b: 0.2 }   // Z = green
                  : this.axisName === 'face' ? { r: 0.3, g: 0.3, b: 0.3 } // face normal
                  : { r: 0.15, g: 0.35, b: 1 };                           // Y = blue (vertical)
    const axId = `rotate-protractor-axis-${ts}`;
    this.viewport.renderer.addGuideLine(axId, axLine1, axLine2, axColor, false);
    this.protractorLines.push(axId);

    // Draw a circle (protractor) in the rotation plane
    const radius = 1.0;
    const segments = 36;
    const { tangent, bitangent } = planeBasis(this.rotationAxis);

    const circleColor = { r: 0.5, g: 0.5, b: 0.5 };
    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      const p1 = vec3.add(this.center, vec3.add(vec3.mul(tangent, Math.cos(a1) * radius), vec3.mul(bitangent, Math.sin(a1) * radius)));
      const p2 = vec3.add(this.center, vec3.add(vec3.mul(tangent, Math.cos(a2) * radius), vec3.mul(bitangent, Math.sin(a2) * radius)));
      const id = `rotate-circle-${ts}-${i}`;
      this.viewport.renderer.addGuideLine(id, p1, p2, circleColor, true);
      this.protractorLines.push(id);
    }
  }

  private clearProtractor(): void {
    for (const id of this.protractorLines) {
      this.viewport.renderer.removeGuideLine(id);
    }
    this.protractorLines = [];
  }

  private clearHandles(): void {
    this.handles.clear();
    this.clearProtractor();
  }
}
