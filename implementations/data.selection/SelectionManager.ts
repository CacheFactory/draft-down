// @archigraph svc.selection_manager
// Selection state management with mode, hover, and box selection

import { SimpleEventEmitter } from '../../src/core/events';
import { EntityType, SelectionMode } from '../../src/core/types';
import {
  ISelectionState, ISelectionManager, ISceneManager, IGeometryEngine,
} from '../../src/core/interfaces';

// ─── Event map ───────────────────────────────────────────────────

type SelectionEvents = {
  'changed': [];
  'pre-selection-changed': [string | null];
};

// ─── SelectionManager ────────────────────────────────────────────

export class SelectionManager implements ISelectionManager {
  private _state: ISelectionState;
  private _extraPreSelectionIds = new Set<string>();
  private emitter = new SimpleEventEmitter<SelectionEvents>();
  private sceneManager: ISceneManager;
  private geometryEngine: IGeometryEngine | null;

  constructor(sceneManager: ISceneManager, geometryEngine?: IGeometryEngine) {
    this._state = {
      mode: 'object',
      entityIds: new Set(),
      preSelectionId: null,
    };
    this.sceneManager = sceneManager;
    this.geometryEngine = geometryEngine ?? null;
  }

  // ── Accessors ────────────────────────────────────────────────

  get state(): Readonly<ISelectionState> {
    return this._state;
  }

  get isEmpty(): boolean {
    return this._state.entityIds.size === 0;
  }

  get count(): number {
    return this._state.entityIds.size;
  }

  // ── Selection operations ─────────────────────────────────────

  select(entityId: string): void {
    this._state.entityIds.clear();
    this._state.entityIds.add(entityId);
    this.emitter.emit('changed');
  }

  add(entityId: string): void {
    this._state.entityIds.add(entityId);
    this.emitter.emit('changed');
  }

  remove(entityId: string): void {
    if (this._state.entityIds.delete(entityId)) {
      this.emitter.emit('changed');
    }
  }

  toggle(entityId: string): void {
    if (this._state.entityIds.has(entityId)) {
      this._state.entityIds.delete(entityId);
    } else {
      this._state.entityIds.add(entityId);
    }
    this.emitter.emit('changed');
  }

  selectAll(): void {
    const entities = this.sceneManager.getAllEntities();
    this._state.entityIds.clear();
    for (const entity of entities) {
      if (entity.id !== (this.sceneManager.root as { id: string }).id) {
        this._state.entityIds.add(entity.id);
      }
    }
    this.emitter.emit('changed');
  }

  clear(): void {
    if (this._state.entityIds.size === 0) return;
    this._state.entityIds.clear();
    this.emitter.emit('changed');
  }

  selectConnected(entityId: string): void {
    if (!this.geometryEngine) return;

    const visited = new Set<string>();
    const queue: string[] = [entityId];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Try to find connected geometry via the geometry engine
      const face = this.geometryEngine.getFace(current);
      if (face) {
        const connected = this.geometryEngine.getConnectedFaces(current);
        for (const cf of connected) {
          if (!visited.has(cf.id)) queue.push(cf.id);
        }
        // Also add the face's edges and vertices
        const edges = this.geometryEngine.getFaceEdges(current);
        for (const e of edges) {
          if (!visited.has(e.id)) queue.push(e.id);
        }
        const verts = this.geometryEngine.getFaceVertices(current);
        for (const v of verts) {
          if (!visited.has(v.id)) queue.push(v.id);
        }
        continue;
      }

      const edge = this.geometryEngine.getEdge(current);
      if (edge) {
        const faces = this.geometryEngine.getEdgeFaces(current);
        for (const f of faces) {
          if (!visited.has(f.id)) queue.push(f.id);
        }
        // Add start/end vertices
        if (!visited.has(edge.startVertexId)) queue.push(edge.startVertexId);
        if (!visited.has(edge.endVertexId)) queue.push(edge.endVertexId);
        continue;
      }

      const vertex = this.geometryEngine.getVertex(current);
      if (vertex) {
        const vertexEdges = this.geometryEngine.getVertexEdges(current);
        for (const ve of vertexEdges) {
          if (!visited.has(ve.id)) queue.push(ve.id);
        }
      }
    }

    for (const id of visited) {
      this._state.entityIds.add(id);
    }
    this.emitter.emit('changed');
  }

  /**
   * Box selection.
   * - 'window' mode: only entities fully inside the rectangle are selected.
   * - 'crossing' mode: entities that intersect the rectangle are selected.
   *
   * Actual screen-space hit testing requires renderer cooperation.
   * This implementation stores the rect and mode so a higher-level system
   * (viewport / renderer) can resolve which entities fall within the box
   * and call add() for each. For now we iterate scene entities as a stub.
   */
  selectInBox(
    rect: { x: number; y: number; width: number; height: number },
    mode: 'window' | 'crossing',
  ): void {
    // In a full implementation the viewport would project every entity's
    // bounding box to screen space and compare against rect.
    // Here we provide the plumbing; concrete hit-testing is deferred to
    // the rendering layer which will call add()/select() per entity.
    //
    // Emit changed so listeners know a box-select cycle completed.
    this.emitter.emit('changed');
  }

  // ── Mode & pre-selection ─────────────────────────────────────

  setMode(mode: SelectionMode): void {
    if (this._state.mode === mode) return;
    this._state.mode = mode;
    this.clear();
  }

  setPreSelection(entityId: string | null): void {
    this._state.preSelectionId = entityId;
    this._extraPreSelectionIds.clear();
    this.emitter.emit('pre-selection-changed', entityId);
  }

  addPreSelection(entityId: string): void {
    this._extraPreSelectionIds.add(entityId);
    this.emitter.emit('pre-selection-changed', entityId);
  }

  /** Returns all pre-selected entity IDs (primary + extras). */
  getPreSelectionIds(): string[] {
    const ids: string[] = [];
    if (this._state.preSelectionId) ids.push(this._state.preSelectionId);
    for (const id of this._extraPreSelectionIds) ids.push(id);
    return ids;
  }

  isSelected(entityId: string): boolean {
    return this._state.entityIds.has(entityId);
  }

  getSelectedByType(type: EntityType): string[] {
    const result: string[] = [];
    for (const id of this._state.entityIds) {
      const entity = this.sceneManager.getEntity(id);
      if (entity && entity.type === type) {
        result.push(id);
      }
    }
    return result;
  }

  // ── Events ───────────────────────────────────────────────────

  on(event: 'changed' | 'pre-selection-changed', handler: (...args: unknown[]) => void): void {
    this.emitter.on(event, handler as never);
  }

  off(event: 'changed' | 'pre-selection-changed', handler: (...args: unknown[]) => void): void {
    this.emitter.off(event, handler as never);
  }
}
