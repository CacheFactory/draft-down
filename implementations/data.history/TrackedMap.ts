// @archigraph svc.history_manager
// Map subclass that records add/delete/modify deltas when a DeltaRecorder is active

import { DeltaRecorder } from './DeltaRecorder';

/**
 * A Map that intercepts mutations to capture deltas for undo/redo.
 *
 * Recording strategy:
 * - **delete**: recorded immediately (captures value before removal).
 * - **add** and **modify**: deferred to flushDeltas() at commit time.
 *   This ensures 'add' deltas capture the entity's *final* state (after all
 *   in-place mutations like half-edge linking), and 'modify' deltas catch
 *   both set()-based and in-place mutations.
 */
export class TrackedMap<K, V> extends Map<K, V> {
  private recorder: DeltaRecorder | null = null;
  private readonly mapName: string;
  private readonly cloneFn: (value: V) => V;

  /**
   * Snapshot of entity state at first access during recording.
   * Only populated for entities that existed before the transaction.
   */
  private beforeSnapshots: Map<K, V> | null = null;

  /** Keys of entities added during this recording session. */
  private addedKeys: Set<K> | null = null;

  constructor(mapName: string, cloneFn: (value: V) => V) {
    super();
    this.mapName = mapName;
    this.cloneFn = cloneFn;
  }

  setRecorder(recorder: DeltaRecorder | null): void {
    this.recorder = recorder;
    if (recorder) {
      this.beforeSnapshots = new Map();
      this.addedKeys = new Set();
    } else {
      this.beforeSnapshots = null;
      this.addedKeys = null;
    }
  }

  get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) this.snapshotIfNeeded(key, value);
    return value;
  }

  set(key: K, value: V): this {
    if (this.recorder && this.beforeSnapshots && this.addedKeys) {
      const existed = super.has(key);
      if (existed) {
        // Existing key — ensure we have a before-snapshot
        if (!this.beforeSnapshots.has(key) && !this.addedKeys.has(key)) {
          this.beforeSnapshots.set(key, this.cloneFn(super.get(key)!));
        }
      } else {
        // New key — track as added (delta emitted at flush time with final state)
        this.addedKeys.add(key);
      }
    }
    return super.set(key, value);
  }

  delete(key: K): boolean {
    if (this.recorder) {
      const existing = super.get(key);
      if (existing !== undefined) {
        if (this.addedKeys && this.addedKeys.has(key)) {
          // Added then deleted in same transaction — no net delta needed.
          this.addedKeys.delete(key);
        } else {
          // Record the PRE-TRANSACTION state, not the delete-time state.
          // An entity mutated earlier in the same transaction (e.g. a face
          // whose boundary gained intersection vertices before a split
          // deleted it) must be restored on undo WITHOUT those mutations —
          // the entities they reference (the new vertices) are themselves
          // removed by the undo, and restoring the delete-time state leaves
          // the face pointing at missing vertices.
          const preTransaction = this.beforeSnapshots?.get(key);
          this.recorder.record({
            op: 'delete',
            map: this.mapName,
            key: key as string,
            value: preTransaction !== undefined ? preTransaction : this.cloneFn(existing),
          });
          if (this.beforeSnapshots) this.beforeSnapshots.delete(key);
        }
      }
    }
    return super.delete(key);
  }

  // ── Iteration overrides ─────────────────────────────────────────
  // Map iterators bypass get(), so we must snapshot here too.

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    super.forEach((value, key) => {
      this.snapshotIfNeeded(key, value);
      callbackfn.call(thisArg, value, key, this);
    });
  }

  entries(): MapIterator<[K, V]> {
    const inner = super.entries();
    const self = this;
    return {
      next() {
        const result = inner.next();
        if (!result.done) {
          const [key, value] = result.value;
          self.snapshotIfNeeded(key, value);
        }
        return result;
      },
      [Symbol.iterator]() { return this; },
    } as MapIterator<[K, V]>;
  }

  values(): MapIterator<V> {
    const inner = super.entries();
    const self = this;
    return {
      next() {
        const result = inner.next();
        if (result.done) return { done: true, value: undefined } as IteratorResult<V>;
        const [key, value] = result.value;
        self.snapshotIfNeeded(key, value);
        return { done: false, value };
      },
      [Symbol.iterator]() { return this; },
    } as MapIterator<V>;
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  /** Snapshot a value on first access during recording (pre-existing entities only). */
  private snapshotIfNeeded(key: K, value: V): void {
    if (
      this.beforeSnapshots &&
      this.addedKeys &&
      !this.beforeSnapshots.has(key) &&
      !this.addedKeys.has(key)
    ) {
      this.beforeSnapshots.set(key, this.cloneFn(value));
    }
  }

  /**
   * Emit add and modify deltas at commit time.
   * - 'add' deltas use the entity's current (final) state.
   * - 'modify' deltas compare first-access snapshot vs current state.
   * Must be called before deactivating the recorder.
   */
  flushDeltas(): void {
    if (!this.recorder) return;

    // Emit 'add' deltas with final state
    if (this.addedKeys) {
      for (const key of this.addedKeys) {
        const current = super.get(key);
        if (current !== undefined) {
          this.recorder.record({
            op: 'add',
            map: this.mapName,
            key: key as string,
            value: this.cloneFn(current),
          });
        }
      }
    }

    // Emit 'modify' deltas for in-place mutations
    if (this.beforeSnapshots) {
      for (const [key, before] of this.beforeSnapshots) {
        const current = super.get(key);
        if (current === undefined) continue; // Deleted — already recorded

        const beforeJson = JSON.stringify(before);
        const afterJson = JSON.stringify(current);
        if (beforeJson !== afterJson) {
          this.recorder.record({
            op: 'modify',
            map: this.mapName,
            key: key as string,
            before,
            after: this.cloneFn(current),
          });
        }
      }
    }
  }
}
