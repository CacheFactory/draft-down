// @archigraph tool.eraser
// Eraser tool: click on edges/faces to delete them. Hover highlights what will be deleted.

import type { ToolMouseEvent, ToolKeyEvent, ToolPreview, ToolEventNeeds } from '../../src/core/interfaces';
import { BaseTool } from '../tool.base/BaseTool';
import { CURSOR_ERASER } from '../tool.base/cursors';

export class EraserTool extends BaseTool {
  readonly id = 'tool.eraser';
  readonly name = 'Eraser';
  readonly icon = 'eraser';
  readonly shortcut = 'E';
  readonly category = 'modify' as const;
  readonly cursor = CURSOR_ERASER;

  private isDragging = false;

  activate(): void {
    super.activate();
    this.isDragging = false;
    // Activating the eraser with an active selection erases the selection
    // immediately (same code path as the Delete key, one undo step).
    const n = this.deleteSelectedEntities();
    if (n > 0) {
      this.setStatus(`Erased ${n} selected ${n === 1 ? 'entity' : 'entities'}. Click or drag to erase more.`);
    } else {
      this.setStatus('Click on edges or faces to delete them. Drag to erase multiple.');
    }
  }

  deactivate(): void {
    this.isDragging = false;
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    this.isDragging = true;
    this.eraseAtCursor(event);
  }

  onMouseMove(event: ToolMouseEvent): void {
    // Pre-selection highlight (show what will be erased)
    if (event.hitEntityId) {
      this.document.selection.setPreSelection(event.hitEntityId);
    } else {
      this.document.selection.setPreSelection(null);
    }

    // Erase while dragging
    if (this.isDragging) {
      this.eraseAtCursor(event);
    }
  }

  onMouseUp(_event: ToolMouseEvent): void {
    this.isDragging = false;
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      this.isDragging = false;
      this.setStatus('Click on edges or faces to delete them.');
    }
  }

  getVCBLabel(): string { return ''; }
  getPreview(): ToolPreview | null { return null; }

  getEventNeeds(): ToolEventNeeds {
    return { snap: false, raycast: false, edgeRaycast: true, liveSyncOnMove: false, mutatesOnClick: true };
  }

  private eraseAtCursor(event: ToolMouseEvent): void {
    if (!event.hitEntityId) return;

    // classic CAD eraser modifiers on edges: Ctrl = soften+smooth, Shift = hide.
    const edgeForModifier = this.document.geometry.getEdge(event.hitEntityId);
    if (edgeForModifier && (event.ctrlKey || event.shiftKey)) {
      this.beginTransaction(event.ctrlKey ? 'Soften Edge' : 'Hide Edge');
      if (event.ctrlKey) {
        edgeForModifier.soft = true;
        edgeForModifier.smooth = true;
        this.setStatus('Edge softened. (Shift = hide, plain click = erase)');
      } else {
        edgeForModifier.hidden = true;
        this.setStatus('Edge hidden. View > Hidden Geometry shows it dashed.');
      }
      this.document.selection.setPreSelection(null);
      this.commitTransaction();
      return;
    }

    this.beginTransaction('Erase');

    const face = this.document.geometry.getFace(event.hitEntityId);
    if (face) {
      this.document.geometry.deleteFace(event.hitEntityId, { rememberDeleted: true });
      this.setStatus('Face deleted.');
    } else {
      const edge = this.document.geometry.getEdge(event.hitEntityId);
      if (edge) {
        this.document.geometry.deleteEdge(event.hitEntityId);
        this.setStatus('Edge deleted.');
      }
    }

    this.document.selection.setPreSelection(null);
    this.commitTransaction();
  }
}
