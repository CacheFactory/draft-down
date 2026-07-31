// @archigraph svc.history_manager
// Delta-based undo/redo. Each transaction stores only what changed (add/delete/modify
// deltas), reducing both time and memory vs the previous snapshot approach.

import { v4 as uuid } from 'uuid';
import { SimpleEventEmitter } from '../../src/core/events';
import { ITransaction, IHistoryManager } from '../../src/core/interfaces';
import { Vec3 } from '../../src/core/types';
import { DeltaRecorder, DeltaTransaction, DeltaOp, GuideLineDelta, cloneVertex } from './DeltaRecorder';
import type { HalfEdgeMesh } from '../mesh.halfedge/HalfEdgeMesh';
import type { MaterialManager } from '../data.materials/MaterialManager';

/** Serializable dimension data for undo/redo (no Three.js objects). */
export interface DimensionDelta {
  id: string;
  startVertexId: string | null;
  endVertexId: string | null;
  startPoint: Vec3;
  endPoint: Vec3;
  offsetDir: Vec3;
  offsetDist: number;
  textPosition: Vec3;
  distance: number;
  guideLineIds: string[];
}

function debugLog(_msg: string): void {
  // Uncomment for debugging: console.warn(`[History] ${_msg}`);
}

type HistoryEvents = {
  'changed': [];
};

// ─── HistoryManager ────────────���─────────────────────────────────

export class HistoryManager implements IHistoryManager {
  maxSteps = 100;

  private undoStack: DeltaTransaction[] = [];
  private redoStack: DeltaTransaction[] = [];
  private activeTransaction: { id: string; name: string; timestamp: number; recorder: DeltaRecorder } | null = null;
  private emitter = new SimpleEventEmitter<HistoryEvents>();

  // References to tracked data sources
  private mesh: HalfEdgeMesh | null = null;
  private materials: MaterialManager | null = null;

  // Vertex position snapshots for tools that mutate positions directly (move/rotate/scale)
  private _vertexSnapshots: Map<string, Vec3> | null = null;

  // Dimension undo/redo support
  private _dimensionsBefore: Map<string, DimensionDelta> | null = null;
  private _onDimensionUndo: ((added: DimensionDelta[], removed: string[]) => void) | null = null;

  private _getDimensionSnapshot: (() => Map<string, DimensionDelta>) | null = null;

  // Guide line undo/redo support
  private _pendingGuideLines: GuideLineDelta[] = [];
  private _pendingGuideLineRemovals: GuideLineDelta[] = [];
  private _onGuideLineUndo: ((added: GuideLineDelta[], removed: string[]) => void) | null = null;

  /** Register callbacks for dimension undo/redo. */
  setDimensionHandlers(
    getSnapshot: () => Map<string, DimensionDelta>,
    onRestore: (added: DimensionDelta[], removed: string[]) => void,
  ): void {
    this._getDimensionSnapshot = getSnapshot;
    this._onDimensionUndo = onRestore;
  }

  /** Register callback for guide line undo/redo. */
  setGuideLineHandler(handler: (added: GuideLineDelta[], removed: string[]) => void): void {
    this._onGuideLineUndo = handler;
  }

  /** Record a guide line creation during a transaction. */
  recordGuideLine(guide: GuideLineDelta): void {
    this._pendingGuideLines.push(guide);
  }

  /** Record a guide line deletion during a transaction so undo can re-add it. */
  recordGuideLineRemoval(guide: GuideLineDelta): void {
    this._pendingGuideLineRemovals.push(guide);
  }

  /** Wire up the tracked data sources. Call after construction and after deserialize. */
  setTrackedSources(mesh: HalfEdgeMesh, materials: MaterialManager): void {
    this.mesh = mesh;
    this.materials = materials;
  }

  // ── Transaction lifecycle ────────────��───────────────────────

  beginTransaction(name: string): void {
    if (this.activeTransaction) {
      this.commitTransaction();
    }

    const recorder = new DeltaRecorder();

    // Activate recording on mesh + materials
    if (this.mesh) this.mesh.setRecorder(recorder);
    if (this.materials) this.materials.setRecorder(recorder);

    this.activeTransaction = {
      id: uuid(),
      name,
      timestamp: Date.now(),
      recorder,
    };

    // Auto-snapshot dimensions at begin time
    if (this._getDimensionSnapshot) {
      this._dimensionsBefore = this._getDimensionSnapshot();
    }

    debugLog(`beginTransaction "${name}" mesh: v=${this.mesh?.vertices.size} e=${this.mesh?.edges.size} f=${this.mesh?.faces.size} he=${this.mesh?.halfEdges.size}`);
  }

  /**
   * Snapshot vertex positions for tools that write v.position.x/y/z directly
   * without going through map.set(). Call immediately after beginTransaction.
   */
  snapshotVertices(vertexIds: string[]): void {
    if (!this.mesh) return;
    this._vertexSnapshots = new Map();
    for (const vid of vertexIds) {
      // Use Map.prototype.get to avoid triggering TrackedMap's get() snapshot.
      // These vertices are tracked explicitly via _vertexSnapshots instead.
      const v = Map.prototype.get.call(this.mesh.vertices, vid);
      if (v) {
        this._vertexSnapshots.set(vid, { x: v.position.x, y: v.position.y, z: v.position.z });
      }
    }
  }

  commitTransaction(): ITransaction {
    if (!this.activeTransaction) {
      return { id: uuid(), name: '(empty)', timestamp: Date.now() };
    }

    const { id, name, timestamp, recorder } = this.activeTransaction;
    this.activeTransaction = null;

    // Flush in-place modifications detected via get()-time snapshots
    if (this.mesh) {
      this.mesh.vertices.flushDeltas();
      this.mesh.edges.flushDeltas();
      this.mesh.faces.flushDeltas();
      this.mesh.halfEdges.flushDeltas();
    }
    if (this.materials) {
      this.materials.faceAssignments.flushDeltas();
    }

    // Flush vertex position diffs for direct-mutation tools (move/rotate/scale)
    // These tools write v.position.x/y/z directly without even calling get() on
    // the TrackedMap — they hold cached references. The snapshotVertices() call
    // captured positions at begin time; diff against current positions now.
    if (this._vertexSnapshots && this.mesh) {
      for (const [vid, before] of this._vertexSnapshots) {
        const v = Map.prototype.get.call(this.mesh.vertices, vid);
        if (!v) continue;
        const after = v.position;
        if (before.x !== after.x || before.y !== after.y || before.z !== after.z) {
          recorder.record({
            op: 'modify',
            map: 'vertices',
            key: vid,
            before: cloneVertex({ ...v, position: before } as any),
            after: cloneVertex(v),
          });
        }
      }
      this._vertexSnapshots = null;
    }

    // Deactivate recording
    if (this.mesh) this.mesh.setRecorder(null);
    if (this.materials) this.materials.setRecorder(null);

    // Capture dimension after-state
    const dimAfter = this._getDimensionSnapshot ? this._getDimensionSnapshot() : undefined;
    const dimBefore = this._dimensionsBefore ?? undefined;
    this._dimensionsBefore = null;

    // Only store dimension snapshots if they actually changed
    const dimChanged = dimBefore && dimAfter && (dimBefore.size !== dimAfter.size ||
      [...dimAfter.keys()].some(k => !dimBefore.has(k)) ||
      [...dimBefore.keys()].some(k => !dimAfter.has(k)));

    // Capture guide lines (creations and deletions)
    const guideLines = this._pendingGuideLines.length > 0 ? [...this._pendingGuideLines] : undefined;
    this._pendingGuideLines = [];
    const guideLineRemovals = this._pendingGuideLineRemovals.length > 0 ? [...this._pendingGuideLineRemovals] : undefined;
    this._pendingGuideLineRemovals = [];

    const tx: DeltaTransaction = {
      id,
      name,
      timestamp,
      deltas: recorder.deltas,
      dimensionsBefore: dimChanged ? dimBefore : undefined,
      dimensionsAfter: dimChanged ? dimAfter : undefined,
      guideLines,
      guideLineRemovals,
    };

    debugLog(`commit "${name}": ${tx.deltas.length} deltas`);

    this.undoStack.push(tx);

    while (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }

    this.redoStack.length = 0;
    this.emitter.emit('changed');
    return { id: tx.id, name: tx.name, timestamp: tx.timestamp };
  }

  abortTransaction(): void {
    if (!this.activeTransaction) return;

    const { recorder } = this.activeTransaction;
    this.activeTransaction = null;

    // Flush deferred deltas so applyInverse has the complete picture
    if (this.mesh) {
      this.mesh.vertices.flushDeltas();
      this.mesh.edges.flushDeltas();
      this.mesh.faces.flushDeltas();
      this.mesh.halfEdges.flushDeltas();
    }
    if (this.materials) {
      this.materials.faceAssignments.flushDeltas();
    }

    // Deactivate recording
    if (this.mesh) this.mesh.setRecorder(null);
    if (this.materials) this.materials.setRecorder(null);

    // Apply inverse deltas to restore state
    this.applyInverse(recorder.deltas);

    // Rebuild derived lookups
    if (this.mesh) this.mesh.rebuildLookups();

    this._vertexSnapshots = null;
  }

  // ── Recording (no-op — deltas are captured automatically by TrackedMaps) ──

  recordAdd(_entityType: string, _entityId: string, _data: unknown): void {}
  recordRemove(_entityType: string, _entityId: string, _data: unknown): void {}
  recordModify(_entityType: string, _entityId: string, _before: unknown, _after: unknown): void {}

  // ── Undo / Redo ────────���─────────────────────────────────────

  undo(): ITransaction | null {
    if (!this.canUndo) return null;

    const tx = this.undoStack.pop()!;
    debugLog(`undo "${tx.name}": ${tx.deltas.length} deltas`);
    this.applyInverse(tx.deltas);

    if (this.mesh) this.mesh.rebuildLookups();

    // Restore dimensions to before-state
    if (tx.dimensionsBefore && tx.dimensionsAfter && this._onDimensionUndo) {
      const added: DimensionDelta[] = [];
      const removed: string[] = [];
      for (const [id] of tx.dimensionsAfter) {
        if (!tx.dimensionsBefore.has(id)) removed.push(id as string);
      }
      for (const [id, dim] of tx.dimensionsBefore) {
        if (!tx.dimensionsAfter.has(id)) added.push(dim as DimensionDelta);
      }
      if (added.length > 0 || removed.length > 0) {
        this._onDimensionUndo(added, removed);
      }
    }

    // Undo guide line creations (remove them) and re-add removals.
    if (this._onGuideLineUndo) {
      const toAdd = tx.guideLineRemovals ?? [];
      const toRemove = tx.guideLines ? tx.guideLines.map(g => g.id) : [];
      if (toAdd.length || toRemove.length) {
        this._onGuideLineUndo(toAdd, toRemove);
      }
    }

    this.redoStack.push(tx);
    this.emitter.emit('changed');
    return { id: tx.id, name: tx.name, timestamp: tx.timestamp };
  }

  redo(): ITransaction | null {
    if (!this.canRedo) return null;

    const tx = this.redoStack.pop()!;
    this.applyForward(tx.deltas);

    if (this.mesh) this.mesh.rebuildLookups();

    // Restore dimensions to after-state
    if (tx.dimensionsBefore && tx.dimensionsAfter && this._onDimensionUndo) {
      const added: DimensionDelta[] = [];
      const removed: string[] = [];
      for (const [id] of tx.dimensionsBefore) {
        if (!tx.dimensionsAfter.has(id)) removed.push(id as string);
      }
      for (const [id, dim] of tx.dimensionsAfter) {
        if (!tx.dimensionsBefore.has(id)) added.push(dim as DimensionDelta);
      }
      if (added.length > 0 || removed.length > 0) {
        this._onDimensionUndo(added, removed);
      }
    }

    // Redo: re-create guide line additions, re-remove guide line removals.
    if (this._onGuideLineUndo) {
      const toAdd = tx.guideLines ?? [];
      const toRemove = tx.guideLineRemovals ? tx.guideLineRemovals.map(g => g.id) : [];
      if (toAdd.length || toRemove.length) {
        this._onGuideLineUndo(toAdd, toRemove);
      }
    }

    this.undoStack.push(tx);
    this.emitter.emit('changed');
    return { id: tx.id, name: tx.name, timestamp: tx.timestamp };
  }

  // ── Delta application ────���─────────────────────────────────

  private getMap(mapName: string): Map<string, unknown> | null {
    if (!this.mesh && !this.materials) return null;
    switch (mapName) {
      case 'vertices': return this.mesh?.vertices ?? null;
      case 'edges': return this.mesh?.edges ?? null;
      case 'faces': return this.mesh?.faces ?? null;
      case 'halfEdges': return this.mesh?.halfEdges ?? null;
      case 'faceAssignments': return this.materials?.faceAssignments ?? null;
      default: return null;
    }
  }

  /** Apply deltas in forward order (for redo). Uses Map.prototype to bypass TrackedMap recording. */
  private applyForward(deltas: DeltaOp[]): void {
    for (let i = 0; i < deltas.length; i++) {
      const d = deltas[i];
      const map = this.getMap(d.map);
      if (!map) continue;

      switch (d.op) {
        case 'add':
          Map.prototype.set.call(map, d.key, d.value);
          break;
        case 'delete':
          Map.prototype.delete.call(map, d.key);
          break;
        case 'modify':
          Map.prototype.set.call(map, d.key, d.after);
          break;
      }
    }
  }

  /** Apply inverse deltas in reverse order (for undo). Uses Map.prototype to bypass TrackedMap recording. */
  private applyInverse(deltas: DeltaOp[]): void {
    for (let i = deltas.length - 1; i >= 0; i--) {
      const d = deltas[i];
      const map = this.getMap(d.map);
      if (!map) continue;

      switch (d.op) {
        case 'add':
          // Inverse of add = delete
          Map.prototype.delete.call(map, d.key);
          break;
        case 'delete':
          // Inverse of delete = add back with original value
          Map.prototype.set.call(map, d.key, d.value);
          break;
        case 'modify':
          // Inverse of modify = restore before state
          Map.prototype.set.call(map, d.key, d.before);
          break;
      }
    }
  }

  // ── Accessors ────────────────────────────────────────────────

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoName(): string | null {
    if (this.undoStack.length === 0) return null;
    return this.undoStack[this.undoStack.length - 1].name;
  }

  get redoName(): string | null {
    if (this.redoStack.length === 0) return null;
    return this.redoStack[this.redoStack.length - 1].name;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.activeTransaction = null;
    this._vertexSnapshots = null;
    this.emitter.emit('changed');
  }

  // ── Events ─────────────────────────────────────────────────

  on(event: 'changed', handler: () => void): void {
    this.emitter.on(event, handler);
  }

  off(event: 'changed', handler: () => void): void {
    this.emitter.off(event, handler);
  }
}
