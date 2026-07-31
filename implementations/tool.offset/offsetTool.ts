// @archigraph tool.offset
// Offset tool: click on face, drag to create inset/outset copy of edges with live preview.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview, IFace, ToolEventNeeds } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';

export class OffsetTool extends BaseTool {
  readonly id = 'tool.offset';
  readonly name = 'Offset';
  readonly icon = 'offset';
  readonly shortcut = 'F';
  readonly category = 'modify' as const;
  readonly cursor = 'crosshair';

  private selectedFace: IFace | null = null;
  private faceCenter: Vec3 | null = null;
  private startScreenY = 0;
  private currentDistance = 0;
  private offsetPoints: Vec3[] = [];

  activate(): void {
    super.activate();
    this.reset();

    // If a face is already selected, use it
    const ids = Array.from(this.document.selection.state.entityIds);
    if (ids.length === 1) {
      const face = this.document.geometry.getFace(ids[0]);
      if (face) {
        this.startOnFace(face, 0);
        this.setStatus('Move mouse to set offset distance, then click.');
        return;
      }
    }
    this.setStatus('Click on a face to offset its edges.');
  }

  deactivate(): void {
    if (this.phase !== 'idle') this.abortTransaction();
    this.reset(); super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    if (this.phase === 'idle') {
      if (!event.hitEntityId) { this.setStatus('Click on a face.'); return; }
      const face = this.document.geometry.getFace(event.hitEntityId);
      if (!face) { this.setStatus('Click on a face, not an edge.'); return; }
      this.startOnFace(face, event.screenY);
      this.setStatus('Move to set offset distance, click to commit.');
    } else if (this.phase === 'drawing') {
      this.commitOffset();
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase !== 'drawing' || !this.selectedFace) return;
    const deltaPixels = this.startScreenY - event.screenY;
    this.currentDistance = deltaPixels * 0.02;
    this.setVCBValue(this.formatDist(this.currentDistance));
    this.computeOffsetPoints();
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.phase !== 'idle') this.abortTransaction();
      this.reset(); this.setStatus('Offset cancelled.');
    }
  }

  onVCBInput(value: string): void {
    if (this.phase !== 'drawing') return;
    const dist = this.parseDistance(value);
    if (isNaN(dist)) return;
    this.currentDistance = dist;
    this.computeOffsetPoints();
    this.commitOffset();
  }

  getVCBLabel(): string { return this.phase === 'drawing' ? 'Distance' : ''; }

  getEventNeeds(): ToolEventNeeds {
    const isActive = this.phase === 'active' || this.phase === 'drawing';
    return { snap: isActive, raycast: isActive, edgeRaycast: false, liveSyncOnMove: isActive, mutatesOnClick: true };
  }

  getPreview(): ToolPreview | null {
    if (this.phase !== 'drawing' || this.offsetPoints.length < 3) return null;
    return { polygon: this.offsetPoints };
  }

  private reset(): void {
    this.selectedFace = null; this.faceCenter = null;
    this.startScreenY = 0; this.currentDistance = 0; this.offsetPoints = [];
    this.setPhase('idle'); this.setVCBValue('');
  }

  private startOnFace(face: IFace, screenY: number): void {
    this.selectedFace = face;
    this.startScreenY = screenY;
    this.currentDistance = 0;

    // Compute face center
    const verts = this.document.geometry.getFaceVertices(face.id);
    let center = vec3.zero();
    for (const v of verts) center = vec3.add(center, v.position);
    this.faceCenter = vec3.div(center, verts.length);

    this.beginTransaction('Offset');
    this.setPhase('drawing');
  }

  private computeOffsetPoints(): void {
    if (!this.selectedFace || !this.faceCenter) return;
    const verts = this.document.geometry.getFaceVertices(this.selectedFace.id);
    if (verts.length < 3) return;

    // Offset each vertex toward/away from face center
    this.offsetPoints = verts.map(v => {
      const toCenter = vec3.sub(this.faceCenter!, v.position);
      const dir = vec3.normalize(toCenter);
      return vec3.add(v.position, vec3.mul(dir, this.currentDistance));
    });
  }

  private commitOffset(): void {
    if (!this.selectedFace || this.offsetPoints.length < 3 || Math.abs(this.currentDistance) < 0.001) {
      this.abortTransaction(); this.reset();
      this.setStatus('Offset too small. Click a face.'); return;
    }

    const originalVerts = this.document.geometry.getFaceVertices(this.selectedFace.id);

    // Create offset vertices
    const newVertexIds: string[] = [];
    for (const p of this.offsetPoints) {
      const v = this.document.geometry.createVertex(p);
      newVertexIds.push(v.id);
    }

    // Create offset edges (inner loop)
    const n = newVertexIds.length;
    for (let i = 0; i < n; i++) {
      this.document.geometry.createEdge(newVertexIds[i], newVertexIds[(i + 1) % n]);
    }

    // Create connecting edges and faces between original and offset
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      this.document.geometry.createEdge(originalVerts[i].id, newVertexIds[i]);
      this.document.geometry.createFace([
        originalVerts[i].id, originalVerts[next].id,
        newVertexIds[next], newVertexIds[i],
      ]);
    }

    // Create inner face
    this.document.geometry.createFace(newVertexIds);

    // Delete original face (replaced by the offset ring + inner face)
    this.document.geometry.deleteFace(this.selectedFace.id);

    // Mark new vertices as dirty for targeted sync
    this._dirtyVertexIds = newVertexIds;

    this.commitTransaction(); this.reset();
    this.setStatus('Offset complete. Click a face to offset again.');
  }
}
