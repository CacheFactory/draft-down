// @archigraph tool.select
// Selection tool: single-click selects entity under cursor (point pick).
// Uses hitEntityId from event (raycasted by ViewportCanvas) for reliable detection.

import type { ToolMouseEvent, ToolKeyEvent, ToolEventNeeds } from '../../src/core/interfaces';
import type { Vec3 } from '../../src/core/types';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { dimensionStore } from '../tool.dimension/DimensionStore';

export class SelectTool extends BaseTool {
  readonly id = 'tool.select';
  readonly name = 'Select';
  readonly icon = 'cursor';
  readonly shortcut = 'Space';
  readonly category = 'modify' as const;
  readonly cursor = 'default';

  private dragStart: { x: number; y: number } | null = null;
  private currentDrag: { x: number; y: number } | null = null;
  private isDragging = false;
  private lastClickTime = 0;
  private lastClickEntityId: string | null = null;
  private clickStreak = 0;
  private readonly DOUBLE_CLICK_MS = 400;
  private readonly DRAG_THRESHOLD = 8;

  /** If dragging a dimension text, its ID. */
  private draggingDimId: string | null = null;

  /** Returns the drag box rectangle for visual rendering, or null if not dragging. */
  getDragBox(): { x: number; y: number; width: number; height: number; mode: 'window' | 'crossing' } | null {
    if (!this.isDragging || !this.dragStart || !this.currentDrag) return null;
    const x = Math.min(this.dragStart.x, this.currentDrag.x);
    const y = Math.min(this.dragStart.y, this.currentDrag.y);
    const width = Math.abs(this.currentDrag.x - this.dragStart.x);
    const height = Math.abs(this.currentDrag.y - this.dragStart.y);
    const mode = this.currentDrag.x >= this.dragStart.x ? 'window' : 'crossing';
    return { x, y, width, height, mode };
  }

  private setCursorPointer(isPointer: boolean): void {
    const container = document.querySelector('.viewport-container') as HTMLElement;
    if (container) {
      container.style.cursor = isPointer ? 'pointer' : 'crosshair';
    }
  }

  activate(): void {
    super.activate();
    this.setStatus('Click to select. Shift+click to add/remove.');
  }

  deactivate(): void {
    super.deactivate();
    this.dragStart = null;
    this.currentDrag = null;
    this.isDragging = false;
    this.setCursorPointer(false);
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    this.dragStart = { x: event.screenX, y: event.screenY };
    this.isDragging = false;
    this.setPhase('active');

    // Double/triple-click detection (consecutive clicks on the same entity)
    const now = Date.now();
    const isWithinWindow = (now - this.lastClickTime) < this.DOUBLE_CLICK_MS;
    if (isWithinWindow && event.hitEntityId && event.hitEntityId === this.lastClickEntityId) {
      this.clickStreak++;
    } else {
      this.clickStreak = 1;
    }
    this.lastClickEntityId = event.hitEntityId ?? null;
    const isDoubleClick = isWithinWindow && this.clickStreak === 2;
    const isTripleClick = isWithinWindow && this.clickStreak >= 3;
    this.lastClickTime = now;

    if (isDoubleClick && event.hitEntityId) {
      // Double-click on a component → enter component editing mode
      const sm = this.document.scene as any;
      if (sm?.components?.has(event.hitEntityId)) {
        sm.enterComponent(event.hitEntityId);
        const comp = sm.components.get(event.hitEntityId);
        this.document.selection.clear();
        this.setStatus(`Editing component "${comp?.name ?? 'Component'}". Press Escape to exit.`);
        this.setPhase('idle');
        this.dragStart = null;
        window.dispatchEvent(new CustomEvent('geometry-changed'));
        return;
      }
      const entity = this.document.scene.getEntity(event.hitEntityId);
      if (entity && (entity.type === 'group' || entity.type === 'component_instance')) {
        this.document.scene.enterGroup(event.hitEntityId);
        this.setStatus('Editing group. Press Escape to exit.');
        this.setPhase('idle');
        this.dragStart = null;
        return;
      }
    }

    // Dimension click: select it (drag starts on mouse move if threshold exceeded)
    if (event.hitEntityId && dimensionStore.isDimensionEntity(event.hitEntityId)) {
      this.draggingDimId = event.hitEntityId;
      if (event.shiftKey) {
        this.document.selection.toggle(event.hitEntityId);
      } else {
        this.document.selection.clear();
        this.document.selection.add(event.hitEntityId);
      }
      this.setStatus('Selected dimension. Press Delete to remove, or drag to reposition.');
      return;
    }

    // classic CAD click depth on raw geometry:
    //   double-click face = face + bounding edges; double-click edge = edge +
    //   adjacent faces; triple-click = everything connected.
    if ((isDoubleClick || isTripleClick) && event.hitEntityId) {
      const geo = this.document.geometry;
      const isFace = !!geo.getFace(event.hitEntityId);
      const isEdge = !!geo.getEdge(event.hitEntityId);
      if (isFace || isEdge) {
        const sel = this.document.selection;
        if (!event.shiftKey) sel.clear();
        if (isTripleClick) {
          for (const id of this.collectConnected(event.hitEntityId)) sel.add(id);
          this.setStatus(`Selected ${sel.count} connected entities.`);
        } else if (isFace) {
          sel.add(event.hitEntityId);
          for (const edge of geo.getFaceEdges(event.hitEntityId)) sel.add(edge.id);
          this.setStatus('Selected face and bounding edges. Triple-click for all connected.');
        } else {
          sel.add(event.hitEntityId);
          for (const face of geo.getEdgeFaces(event.hitEntityId)) sel.add(face.id);
          this.setStatus('Selected edge and adjacent faces. Triple-click for all connected.');
        }
        this.dragStart = null;
        return;
      }
    }

    // Instant point-pick using the pre-computed raycast hit
    if (event.hitEntityId) {
      // When editing a component, only allow selecting entities within it
      const sm = this.document.scene as any;
      if (sm?.editingComponentId && !sm.components?.has(event.hitEntityId)) {
        // It's a raw entity (not a component) — check if it's editable in current context
        if (sm.isEntityEditable && !sm.isEntityEditable(event.hitEntityId)) {
          if (!event.shiftKey) this.document.selection.clear();
          this.setStatus('Click geometry inside the component, or press Escape to exit.');
          return;
        }
      }

      // Expand to full curve if the clicked edge belongs to one
      const idsToSelect = this.expandCurve(event.hitEntityId);
      if (event.shiftKey) {
        console.log('[selectTool] shift+click toggle', { hitEntityId: event.hitEntityId, idsToSelect, alreadySelected: idsToSelect.map(id => this.document.selection.isSelected(id)) });
        for (const id of idsToSelect) this.document.selection.toggle(id);
        console.log('[selectTool] after toggle', Array.from(this.document.selection.state.entityIds));
      } else {
        this.document.selection.clear();
        for (const id of idsToSelect) this.document.selection.add(id);
      }
      const count = this.document.selection.count;
      if (count === 1) {
        this.setStatus(`Selected ${this.getEntityTypeLabel(event.hitEntityId)}. Shift+click to add more.`);
      } else {
        this.setStatus(`${count} entities selected. Shift+click to add/remove.`);
      }
    } else if (!event.shiftKey) {
      this.document.selection.clear();
      this.setStatus('Click to select. Shift+click to add/remove.');
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    // Dragging a dimension — constrained to perpendicular of measurement line
    if (this.draggingDimId) {
      const dim = dimensionStore.get(this.draggingDimId);
      if (dim && event.worldPoint) {
        // Project cursor onto the offset direction to get new offset distance
        const toCursor = vec3.sub(event.worldPoint, dim.startPoint);
        const newOffsetDist = vec3.dot(toCursor, dim.offsetDir);

        // Reposition dimension (sprite, compute new positions)
        const positions = dimensionStore.reposition(this.draggingDimId, newOffsetDist);
        if (positions) {
          // Update all guide lines
          const ids = dim.guideLineIds;
          const dimColor = { r: 0.2, g: 0.2, b: 0.2 };
          const tickSize = 0.08;

          // ids[0] = ext1, ids[1] = ext2, ids[2] = main, ids[3] = tick1, ids[4] = tick2
          if (ids.length >= 5) {
            this.viewport.renderer.addGuideLine(ids[0], positions.extStart1, positions.dimStart, dimColor, true);
            this.viewport.renderer.addGuideLine(ids[1], positions.extStart2, positions.dimEnd, dimColor, true);
            this.viewport.renderer.addGuideLine(ids[2], positions.dimStart, positions.dimEnd, dimColor, false);

            const tick1a = vec3.add(positions.dimStart, vec3.mul(positions.offsetDir, tickSize));
            const tick1b = vec3.add(positions.dimStart, vec3.mul(positions.offsetDir, -tickSize));
            this.viewport.renderer.addGuideLine(ids[3], tick1a, tick1b, dimColor, false);

            const tick2a = vec3.add(positions.dimEnd, vec3.mul(positions.offsetDir, tickSize));
            const tick2b = vec3.add(positions.dimEnd, vec3.mul(positions.offsetDir, -tickSize));
            this.viewport.renderer.addGuideLine(ids[4], tick2a, tick2b, dimColor, false);
          }
        }
      }
      return;
    }

    if (this.phase === 'idle') {
      // Pre-selection highlight + cursor change
      if (event.hitEntityId) {
        // When editing a component, skip pre-selection for entities outside it
        const sm2 = this.document.scene as any;
        if (sm2?.editingComponentId && !sm2.components?.has(event.hitEntityId) &&
            sm2.isEntityEditable && !sm2.isEntityEditable(event.hitEntityId)) {
          this.document.selection.setPreSelection(null);
          this.setCursorPointer(false);
        } else if (dimensionStore.isDimensionEntity(event.hitEntityId)) {
          // Show move cursor for dimension entities
          this.setCursorPointer(true);
        } else {
          // Expand to full curve for pre-selection highlight
          const ids = this.expandCurve(event.hitEntityId);
          this.document.selection.setPreSelection(ids[0]);
          // Highlight all curve edges via the renderer
          if (ids.length > 1) {
            for (let i = 1; i < ids.length; i++) {
              this.document.selection.addPreSelection(ids[i]);
            }
          }
          this.setCursorPointer(true);
        }
      } else {
        this.document.selection.setPreSelection(null);
        this.setCursorPointer(false);
      }
      return;
    }

    // Check if drag started (for box select)
    if (this.dragStart && !this.isDragging) {
      const dx = event.screenX - this.dragStart.x;
      const dy = event.screenY - this.dragStart.y;
      if (Math.abs(dx) > this.DRAG_THRESHOLD || Math.abs(dy) > this.DRAG_THRESHOLD) {
        this.isDragging = true;
        this.setPhase('dragging');
        this.setStatus('Release to complete box selection.');
      }
    }

    // Update drag box position
    if (this.isDragging && this.dragStart) {
      this.currentDrag = { x: event.screenX, y: event.screenY };
    }
  }

  onMouseUp(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    // Finish dimension drag
    if (this.draggingDimId) {
      this.setStatus('Dimension text repositioned.');
      this.draggingDimId = null;
      this.setPhase('idle');
      return;
    }

    if (this.isDragging && this.dragStart) {
      const x = Math.min(this.dragStart.x, event.screenX);
      const y = Math.min(this.dragStart.y, event.screenY);
      const width = Math.abs(event.screenX - this.dragStart.x);
      const height = Math.abs(event.screenY - this.dragStart.y);

      if (!event.shiftKey) {
        this.document.selection.clear();
      }

      // Box select: project all entity centers to screen and check containment
      const vw = this.viewport.getWidth();
      const vh = this.viewport.getHeight();
      const mesh = this.document.geometry.getMesh();

      // Check faces
      for (const [faceId, face] of mesh.faces) {
        const verts = face.vertexIds.map(vid => mesh.vertices.get(vid)).filter(Boolean);
        if (verts.length === 0) continue;
        let cx = 0, cy = 0, cz = 0;
        for (const v of verts) { cx += v!.position.x; cy += v!.position.y; cz += v!.position.z; }
        const center = { x: cx / verts.length, y: cy / verts.length, z: cz / verts.length };
        const screen = this.viewport.camera.worldToScreen(center, vw, vh);
        if (screen.x >= x && screen.x <= x + width && screen.y >= y && screen.y <= y + height) {
          this.document.selection.add(faceId);
        }
      }

      // Check edges
      for (const [edgeId, edge] of mesh.edges) {
        const v1 = mesh.vertices.get(edge.startVertexId);
        const v2 = mesh.vertices.get(edge.endVertexId);
        if (!v1 || !v2) continue;
        const mid = { x: (v1.position.x + v2.position.x) / 2, y: (v1.position.y + v2.position.y) / 2, z: (v1.position.z + v2.position.z) / 2 };
        const screen = this.viewport.camera.worldToScreen(mid, vw, vh);
        if (screen.x >= x && screen.x <= x + width && screen.y >= y && screen.y <= y + height) {
          this.document.selection.add(edgeId);
        }
      }

      this.setStatus(`${this.document.selection.count} entities selected.`);
    }

    this.dragStart = null;
    this.currentDrag = null;
    this.isDragging = false;
    this.setPhase('idle');
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      const sm = this.document.scene as any;
      if (sm?.editingComponentId) {
        sm.exitComponent();
        this.document.selection.clear();
        this.setStatus('Exited component editing.');
        window.dispatchEvent(new CustomEvent('geometry-changed'));
      } else if (this.document.scene.editingContext.activeGroupId) {
        this.document.scene.exitGroup();
        this.setStatus('Exited group editing.');
      } else {
        this.document.selection.clear();
        this.setStatus('Selection cleared.');
      }
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      const n = this.deleteSelectedEntities();
      if (n > 0) this.setStatus(`Deleted ${n} entities.`);
    }
  }

  getVCBLabel(): string { return ''; }

  getEventNeeds(): ToolEventNeeds {
    return { snap: false, raycast: false, edgeRaycast: true, liveSyncOnMove: false, mutatesOnClick: false };
  }

  private expandCurve(entityId: string): string[] {
    const edge = this.document.geometry.getEdge(entityId);
    if (edge?.curveId) {
      const curveEdges = this.document.geometry.getCurveEdges(edge.curveId);
      if (curveEdges.length > 1) {
        return curveEdges.map(e => e.id);
      }
    }
    return [entityId];
  }

  private getEntityTypeLabel(entityId: string): string {
    if (dimensionStore.isDimensionEntity(entityId)) return 'dimension';
    const sm = this.document.scene as any;
    if (sm?.components?.has(entityId)) {
      const comp = sm.components.get(entityId);
      return `component "${comp?.name ?? 'Component'}"`;
    }
    if (this.document.geometry.getFace(entityId)) return 'face';
    if (this.document.geometry.getEdge(entityId)) return 'edge';
    const entity = this.document.scene.getEntity(entityId);
    if (entity) return entity.type;
    return 'entity';
  }

  /** BFS over shared vertices: every face and edge connected to the start
   *  entity (classic CAD triple-click). */
  private collectConnected(startId: string): string[] {
    const geo = this.document.geometry as any;
    const result = new Set<string>();
    const seenVerts = new Set<string>();
    const vertQueue: string[] = [];

    const pushEntity = (id: string) => {
      if (result.has(id)) return;
      result.add(id);
      const face = geo.getFace(id);
      if (face) {
        for (const vid of face.vertexIds) {
          if (!seenVerts.has(vid)) { seenVerts.add(vid); vertQueue.push(vid); }
        }
        return;
      }
      const edge = geo.getEdge(id);
      if (edge) {
        for (const vid of [edge.startVertexId, edge.endVertexId]) {
          if (!seenVerts.has(vid)) { seenVerts.add(vid); vertQueue.push(vid); }
        }
      }
    };

    pushEntity(startId);
    let guard = 0;
    while (vertQueue.length > 0 && guard++ < 100000) {
      const vid = vertQueue.pop()!;
      for (const eid of geo.getVertexEdgeIds?.(vid) ?? []) pushEntity(eid);
      for (const fid of geo.getVertexFaces?.(vid) ?? []) pushEntity(fid);
    }
    return [...result];
  }
}
