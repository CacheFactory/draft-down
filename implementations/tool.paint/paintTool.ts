// @archigraph tool.paint
// Paint bucket tool: apply materials to faces

import type { ToolMouseEvent, ToolKeyEvent, ToolEventNeeds } from '../../src/core/interfaces';
import { BaseTool } from '../tool.base/BaseTool';
import { CURSOR_PAINT } from '../tool.base/cursors';

export class PaintTool extends BaseTool {
  readonly id = 'tool.paint';
  readonly name = 'Paint Bucket';
  readonly icon = 'paint-bucket';
  readonly shortcut = 'B';
  readonly category = 'modify' as const;
  readonly cursor = CURSOR_PAINT;

  activeMaterialId: string | null = null;

  activate(): void {
    super.activate();
    // Arm the bucket with a material so first-time painting just works
    // (the classic modeler's bucket is never empty). The materials panel/browser can
    // change it; sampling (Shift+click) can too.
    if (!this.activeMaterialId) {
      const mats = this.document.materials.getAllMaterials();
      const first = mats.find(m => m.id !== '__default__');
      if (first) this.activeMaterialId = first.id;
    }
    const current = this.activeMaterialId
      ? this.document.materials.getMaterial(this.activeMaterialId)?.name ?? 'material'
      : 'none';
    this.setStatus(`Paint: ${current}. Click a face to paint. Alt+click samples. Shift+click replaces all matching.`);
  }

  deactivate(): void {
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    const faceId = event.hitEntityId;
    if (!faceId) return;
    const face = this.document.geometry.getFace(faceId);
    if (!face) return;

    // classic CAD modifier parity: Alt = sample (eyedropper),
    // Shift = replace every face carrying the clicked face's material.
    if (event.altKey) {
      const mat = this.document.materials.getFaceMaterial(faceId);
      this.activeMaterialId = mat.id;
      this.setStatus(`Sampled material: ${mat.name}`);
      return;
    }

    if (!this.activeMaterialId) {
      this.setStatus('No material selected. Alt+click to sample a material first.');
      return;
    }

    this.beginTransaction('Paint');

    if (event.shiftKey) {
      // Replace all faces that share the clicked face's current material
      const currentMat = this.document.materials.getFaceMaterial(faceId);
      const allFaces = this.document.geometry.getMesh().faces;
      allFaces.forEach((f, id) => {
        const fMat = this.document.materials.getFaceMaterial(id);
        if (fMat.id === currentMat.id) {
          this.document.materials.applyToFace(id, this.activeMaterialId!);
        }
      });
    } else {
      // Apply to single face
      this.document.materials.applyToFace(faceId, this.activeMaterialId);
    }

    this.commitTransaction();
  }

  onMouseMove(event: ToolMouseEvent): void {
    // Highlight face under cursor
    if (event.hitEntityId) {
      const face = this.document.geometry.getFace(event.hitEntityId);
      if (face) {
        this.document.selection.setPreSelection(event.hitEntityId);
        return;
      }
    }
    this.document.selection.setPreSelection(null);
  }

  getVCBLabel(): string { return ''; }

  getEventNeeds(): ToolEventNeeds {
    return { snap: false, raycast: false, edgeRaycast: true, liveSyncOnMove: false, mutatesOnClick: true };
  }
}
