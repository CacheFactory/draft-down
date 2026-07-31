// @archigraph tool.move
// Move tool: select face/edge, click origin, drag to destination with live preview.
// Modes (selectable via Parameters panel or hot keys):
//   Move      — translate selection
//   Copy      — Ctrl/Cmd during click, OR select Copy mode in the panel
//   Repeat    — after a copy commits, type "Nx" or "/N" in the VCB to array

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview, ToolEventNeeds } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { CURSOR_MOVE } from '../tool.base/cursors';
import { VertexTransformSession } from '../tool.base/VertexTransformSession';
import { cloneEntitiesFromIds } from '../tool.base/cloneGeometry';
import { getParametersStore } from '../plugin.system/draftdown/ParametersStore';

const MOVE_PARAMS_ID = 'tool.move.params';

type MoveMode = 'move' | 'copy';

export class MoveTool extends BaseTool {
  readonly id = 'tool.move';
  readonly name = 'Move';
  readonly icon = 'move';
  readonly shortcut = 'M';
  readonly category = 'modify' as const;
  readonly cursor = CURSOR_MOVE;

  private origin: Vec3 | null = null;
  private currentDest: Vec3 | null = null;
  private isCopy = false;
  private mode: MoveMode = 'move';
  /** Total number of copies to create per click in Copy mode (>=1). */
  private copies = 1;
  /** Vertices being moved + their pre-move positions. */
  private session = new VertexTransformSession(this.document.geometry);
  private lockedAxis: 'x' | 'y' | 'z' | null = null;

  // Post-copy array state — populated after a successful copy commit so the
  // user can type Nx or /N in the VCB to repeat the copy along the offset.
  private lastCopyOffset: Vec3 | null = null;
  private lastCopyOriginIds: string[] = [];   // original selection's entity ids (faces/edges)
  private lastCopyClonedFaceIds: string[] = [];
  private lastCopyClonedEdgeIds: string[] = [];
  private lastCopyClonedVertexIds: string[] = [];

  activate(): void {
    super.activate();
    this.reset();
    this.showParameters();
    if (!this.document.selection.isEmpty) {
      this.session.gather(this.resolveSelectedEntityIds());
      this.setStatus(`${this.session.size} vertices ready. ${this.modeHint()}`);
    } else {
      this.setStatus(`Select a face/edge, then click move origin. ${this.modeHint()}`);
    }
  }

  deactivate(): void {
    this.document.selection.setPreSelection(null);
    if (this.phase !== 'idle') {
      this.session.restore();
      this.abortTransaction();
      if (this.placementHooks) {
        this.placementHooks.onAbort?.();
        this.placementHooks = null;
      }
    }
    this.reset();
    getParametersStore().hide(MOVE_PARAMS_ID);
    super.deactivate();
  }

  private modeHint(): string {
    if (this.mode === 'copy') {
      return this.copies > 1
        ? `Mode: Copy × ${this.copies}. Hold Ctrl to toggle.`
        : 'Mode: Copy (Ctrl). Set Copies > 1 for an array.';
    }
    return 'Mode: Move. Hold Ctrl for Copy.';
  }

  private showParameters(): void {
    getParametersStore().show({
      id: MOVE_PARAMS_ID,
      title: 'Move',
      fields: [
        {
          kind: 'select',
          key: 'mode',
          label: 'Mode',
          default: this.mode,
          options: [
            { label: 'Move', value: 'move' },
            { label: 'Copy (Ctrl)', value: 'copy' },
          ],
          help: 'Hold Ctrl/Cmd at click to force Copy.',
        },
        {
          kind: 'integer',
          key: 'copies',
          label: 'Copies',
          default: this.copies,
          min: 1,
          max: 1000,
          help: 'Number of clones created per Copy click, evenly spaced along the offset.',
        },
      ],
      values: { mode: this.mode, copies: this.copies },
      onChange: (values) => {
        const nextMode: MoveMode = values.mode === 'copy' ? 'copy' : 'move';
        if (nextMode !== this.mode) {
          this.mode = nextMode;
        }
        const nextCopies = Math.max(1, Math.min(1000, Math.floor(Number(values.copies) || 1)));
        if (nextCopies !== this.copies) {
          this.copies = nextCopies;
        }
        this.setStatus(this.modeHint());
      },
    });
  }

  /**
   * Begin a paste placement: the given vertices (freshly instantiated by the
   * caller inside a still-open 'Paste' transaction) follow the cursor from
   * `anchor` until the user clicks to place. The placing click commits the
   * transaction; Escape aborts it and the pasted geometry disappears —
   * matching the classic modeler's paste.
   */
  private placementHooks: { onCommit?: () => void; onAbort?: () => void } | null = null;

  beginPlacement(
    vertexIds: string[], anchor: Vec3,
    hooks?: { onCommit?: () => void; onAbort?: () => void },
  ): void {
    this.resetMoveState();
    this.placementHooks = hooks ?? null;
    this.session.setVertices(vertexIds);
    this.session.snapshot();
    this.origin = { ...anchor };
    this.currentDest = { ...anchor };
    this.isCopy = false;
    this.setPhase('drawing');
    this.setStatus('Click to place pasted geometry. Escape cancels.');
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    if (this.phase === 'idle') {
      // Auto-select if nothing selected
      if (this.document.selection.isEmpty && event.hitEntityId) {
        this.document.selection.select(event.hitEntityId);
      }
      if (this.document.selection.isEmpty) {
        this.setStatus('Nothing to move. Click on a face or edge first.');
        return;
      }

      // Resolve copy intent: panel mode OR live Ctrl modifier.
      this.isCopy = this.mode === 'copy' || event.ctrlKey;

      const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
      if (!point) return;

      this.beginTransaction(this.isCopy ? 'Copy' : 'Move', []);

      // For copy mode, clone the selection in-place; the clones become the
      // vertices we move (originals stay put).
      if (this.isCopy) {
        // Copying a single COMPONENT? The clone becomes a new INSTANCE of the
        // same family (classic CAD definitions): edits to one update all.
        const selIds = [...this.document.selection.state.entityIds];
        const sm = this.document.scene as any;
        this.copySourceComponentId =
          selIds.length === 1 && sm?.components?.has(selIds[0]) ? selIds[0] : null;

        const clone = this.cloneSelection();
        this.session.setVertices(clone.newVertexIds);
        this.lastCopyOriginIds = clone.sourceEntityIds;
        this.lastCopyClonedFaceIds = clone.newFaceIds;
        this.lastCopyClonedEdgeIds = clone.newEdgeIds;
        this.lastCopyClonedVertexIds = clone.newVertexIds;
        // (cloneSelectionFromIds already registered the clone as an instance)
      } else {
        this.session.gather(this.resolveSelectedEntityIds());
        // Clear any prior array state — a new plain move ends the array session.
        this.lastCopyOffset = null;
        this.lastCopyOriginIds = [];
        this.lastCopyClonedFaceIds = [];
        this.lastCopyClonedEdgeIds = [];
        this.lastCopyClonedVertexIds = [];
      }

      if (this.session.size === 0) {
        this.abortTransaction();
        this.reset();
        this.setStatus('No movable vertices found.');
        return;
      }

      this.origin = point;
      this.session.snapshot();
      this.setPhase('drawing');
      this.setStatus(`Drag to destination. ${this.isCopy ? '(Copy)' : ''}`);
    } else if (this.phase === 'drawing') {
      // Commit the move
      const offset = (this.isCopy && this.origin && this.currentDest)
        ? this.constrainToLockedAxis(vec3.sub(this.currentDest, this.origin))
        : null;

      // If Copy mode + copies > 1, spawn (copies-1) more clones at k·offset
      // within the same transaction so the array is one undo step.
      if (this.isCopy && offset && this.copies > 1 && this.lastCopyOriginIds.length > 0) {
        for (let k = 2; k <= this.copies; k++) {
          const clone = this.cloneSelectionFromIds(this.lastCopyOriginIds);
          if (clone.newVertexIds.length === 0) continue;
          this.translateVertices(clone.newVertexIds, vec3.mul(offset, k));
        }
      }

      this.lastCopyOffset = offset;
      // classic CAD autofold: a move that bends adjacent faces out of plane
      // folds them into triangles instead of leaving invalid polygons.
      if (!this.isCopy) {
        this.document.geometry.autofoldNonPlanarFaces([...this.session.vertexIds]);
      }
      // Capture the committed move for type-to-redo (plain moves only —
      // copies keep their Nx/array VCB workflow).
      const committedIds = [...this.session.vertexIds];
      const committedOffset = (!this.isCopy && this.origin && this.currentDest)
        ? this.constrainToLockedAxis(vec3.sub(this.currentDest, this.origin))
        : null;
      this.commitTransaction();
      if (this.placementHooks) {
        this.placementHooks.onCommit?.();
        this.placementHooks = null;
      }
      const wasCopy = this.isCopy;
      const totalCopies = this.copies;
      this.resetMoveState();
      if (!wasCopy && committedOffset && vec3.length(committedOffset) > 1e-9) {
        this.armMoveRedo(committedIds, committedOffset);
      }
      if (wasCopy) {
        if (totalCopies > 1) {
          this.setStatus(`Created ${totalCopies} copies. ${this.modeHint()}`);
        } else {
          this.setStatus(`Copy complete. Type Nx (e.g. 5x) for more, or /N to subdivide. ${this.modeHint()}`);
        }
      } else {
        this.setStatus(`Move complete. ${this.modeHint()}`);
      }
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase === 'idle') {
      // classic CAD: hovering highlights what a click would move
      if (event.hitEntityId && this.document.selection.isEmpty) {
        this.document.selection.setPreSelection(event.hitEntityId);
      } else if (this.document.selection.isEmpty) {
        this.document.selection.setPreSelection(null);
      }
      return;
    }
    if (this.phase !== 'drawing' || !this.origin) return;

    let point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;

    // classic-CAD-style inference on the move direction: auto axis snap with
    // colored guide, Shift to pin, parallel-to-edge. Mirror the manual arrow-key
    // lock into BaseTool.axisLock so the shared helper renders its guide too.
    this.axisLock = this.lockedAxis;
    point = this.applyDirectionInference(this.origin, point, event);

    this.currentDest = point;
    const offset = vec3.sub(point, this.origin);
    const lockedOffset = this.constrainToLockedAxis(offset);
    this.setVCBValue(this.formatDist(vec3.length(lockedOffset)));

    // Live preview: move vertices to new positions
    this.applyOffset(offset);
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.phase !== 'idle') {
        this.session.restore();
        this.abortTransaction();
      }
      if (this.placementHooks) {
        this.placementHooks.onAbort?.();
        this.placementHooks = null;
      }
      this.reset();
      this.setStatus(`Move cancelled. ${this.modeHint()}`);
      return;
    }

    // Arrow keys lock movement to a single axis (matches Line tool convention).
    let next: 'x' | 'y' | 'z' | null | undefined;
    if (event.key === 'ArrowUp') next = 'y';
    else if (event.key === 'ArrowRight') next = 'x';
    else if (event.key === 'ArrowLeft') next = 'z';
    else if (event.key === 'ArrowDown') next = null;
    if (next === undefined) return;

    this.lockedAxis = next;
    if (this.lockedAxis) {
      this.setStatus(`Locked to ${this.lockedAxis.toUpperCase()} axis. Press ↓ to unlock.`);
    } else {
      this.setStatus('Axis lock cleared.');
    }
    // Re-apply offset with the new lock so the live preview updates immediately.
    if (this.phase === 'drawing' && this.origin && this.currentDest) {
      this.applyOffset(vec3.sub(this.currentDest, this.origin));
    }
  }

  onVCBInput(value: string): void {
    const trimmed = value.trim();

    // Active drag → distance along current direction (existing behavior).
    if (this.phase === 'drawing' && this.origin && this.currentDest) {
      // Allow Nx / /N during an in-progress copy drag too: commit then array.
      const arrayMatch = trimmed.match(/^(\d+)\s*x$/i) ?? trimmed.match(/^\*\s*(\d+)$/);
      const divideMatch = trimmed.match(/^\/\s*(\d+)$/);
      if (this.isCopy && (arrayMatch || divideMatch)) {
        // Commit the in-progress copy at the current cursor, then array.
        const offset = this.constrainToLockedAxis(vec3.sub(this.currentDest, this.origin));
        this.applyOffset(offset);
        this.lastCopyOffset = offset;
        this.commitTransaction();
        this.resetMoveState();
        const n = parseInt((arrayMatch ?? divideMatch)![1], 10);
        if (arrayMatch) this.arrayRepeat(n);
        else this.arraySubdivide(n);
        return;
      }

      const dist = this.parseDistance(trimmed);
      if (isNaN(dist)) return;

      let dir: Vec3;
      if (this.lockedAxis) {
        const cursorOffset = vec3.sub(this.currentDest, this.origin);
        const sign = (this.lockedAxis === 'x' ? cursorOffset.x : this.lockedAxis === 'y' ? cursorOffset.y : cursorOffset.z) < 0 ? -1 : 1;
        dir = this.lockedAxis === 'x' ? { x: sign, y: 0, z: 0 }
            : this.lockedAxis === 'y' ? { x: 0, y: sign, z: 0 }
            : { x: 0, y: 0, z: sign };
      } else {
        dir = vec3.normalize(vec3.sub(this.currentDest, this.origin));
      }
      const offset = vec3.mul(dir, dist);
      this.applyOffset(offset);

      // Spawn additional copies for the array (same as in-commit logic above).
      if (this.isCopy && this.copies > 1 && this.lastCopyOriginIds.length > 0) {
        for (let k = 2; k <= this.copies; k++) {
          const clone = this.cloneSelectionFromIds(this.lastCopyOriginIds);
          if (clone.newVertexIds.length === 0) continue;
          this.translateVertices(clone.newVertexIds, vec3.mul(offset, k));
        }
      }

      if (this.isCopy && this.origin) {
        this.lastCopyOffset = offset;
      }
      if (!this.isCopy) {
        this.document.geometry.autofoldNonPlanarFaces([...this.session.vertexIds]);
      }
      this.commitTransaction();
      const wasCopy = this.isCopy;
      const totalCopies = this.copies;
      this.resetMoveState();
      this.setStatus(wasCopy
        ? (totalCopies > 1 ? `Created ${totalCopies} copies. ${this.modeHint()}` : 'Copy complete. Type Nx for more, or /N to subdivide.')
        : `Move complete. ${this.modeHint()}`);
      return;
    }

    // Idle phase: type-to-redo the last plain move with a new distance.
    if (this.tryRedoLastOp(trimmed)) return;

    // Idle phase, fresh from a copy → handle array commands.
    if (this.phase === 'idle' && this.lastCopyOffset) {
      const arrayMatch = trimmed.match(/^(\d+)\s*x$/i) ?? trimmed.match(/^\*\s*(\d+)$/);
      if (arrayMatch) {
        const n = parseInt(arrayMatch[1], 10);
        if (n >= 2) this.arrayRepeat(n);
        return;
      }
      const divideMatch = trimmed.match(/^\/\s*(\d+)$/);
      if (divideMatch) {
        const n = parseInt(divideMatch[1], 10);
        if (n >= 2) this.arraySubdivide(n);
        return;
      }
    }
  }

  getVCBLabel(): string {
    if (this.phase === 'drawing') return this.isCopy ? 'Distance (or Nx)' : 'Distance';
    if (this.lastCopyOffset) return 'Array (Nx or /N)';
    return '';
  }

  getEventNeeds(): ToolEventNeeds {
    const isActive = this.phase === 'active' || this.phase === 'drawing';
    // raycast in idle too — hover highlight needs to know what's under the cursor
    return { snap: isActive, raycast: true, edgeRaycast: false, liveSyncOnMove: isActive, mutatesOnClick: true };
  }

  getPreview(): ToolPreview | null {
    if (this.phase !== 'drawing' || !this.origin || !this.currentDest) return null;
    const offset = this.constrainToLockedAxis(vec3.sub(this.currentDest, this.origin));
    const to = vec3.add(this.origin, offset);
    return { lines: [{ from: this.origin, to, color: this.inferenceColor ?? undefined }] };
  }

  // ── Array / repeat ───────────────────────────────────────

  /** Make N total copies along the previous copy's offset. The first copy
   *  already exists (committed). We add N-1 more, each at k·offset. */
  private arrayRepeat(n: number): void {
    if (!this.lastCopyOffset || this.lastCopyOriginIds.length === 0) return;
    this.beginTransaction(`Array x${n}`, []);
    let created = 0;
    for (let k = 2; k <= n; k++) {
      const clone = this.cloneSelectionFromIds(this.lastCopyOriginIds);
      if (clone.newVertexIds.length === 0) continue;
      this.translateVertices(clone.newVertexIds, vec3.mul(this.lastCopyOffset, k));
      created++;
    }
    this.commitTransaction();
    this.setStatus(`Created ${created} additional ${created === 1 ? 'copy' : 'copies'} along offset.`);
    // Clear array state — fresh selection starts a new session.
    this.lastCopyOffset = null;
    this.lastCopyOriginIds = [];
    this.setVCBValue('');
  }

  /** Subdivide: replace the single first copy with N copies evenly spaced
   *  between the original and the destination. */
  private arraySubdivide(n: number): void {
    if (!this.lastCopyOffset || this.lastCopyOriginIds.length === 0) return;
    if (n < 2) return;
    this.beginTransaction(`Array /${n}`, []);

    // Move the existing first copy to offset/n (k=1).
    this.translateVertices(this.lastCopyClonedVertexIds, vec3.sub(
      vec3.mul(this.lastCopyOffset, 1 / n),
      this.lastCopyOffset,
    ));

    // Add k=2..n more copies.
    let created = 1;
    for (let k = 2; k <= n; k++) {
      const clone = this.cloneSelectionFromIds(this.lastCopyOriginIds);
      if (clone.newVertexIds.length === 0) continue;
      this.translateVertices(clone.newVertexIds, vec3.mul(this.lastCopyOffset, k / n));
      created++;
    }
    this.commitTransaction();
    this.setStatus(`Created ${created} copies subdividing the offset.`);
    this.lastCopyOffset = null;
    this.lastCopyOriginIds = [];
    this.setVCBValue('');
  }

  /** Arm type-to-redo: retyping a distance after a move re-applies it along
   *  the same direction with the new magnitude (negative reverses). */
  private armMoveRedo(vertexIds: string[], committedOffset: Vec3): void {
    const dir = vec3.normalize(committedOffset);
    this.redoLastOp = (value: string) => {
      const d = this.parseDistance(value);
      if (isNaN(d) || d === 0) return false;
      this.document.history.undo();
      this.beginTransaction('Move', vertexIds);
      this.session.setVertices(vertexIds);
      this.session.snapshot();
      const off = vec3.mul(dir, d);
      this._dirtyVertexIds = this.session.apply(o => vec3.add(o, off));
      this.document.geometry.autofoldNonPlanarFaces(vertexIds);
      this.commitTransaction();
      this.armMoveRedo(vertexIds, off);
      this.setStatus(`Move redone: ${this.formatDist(Math.abs(d))}.`);
      return true;
    };
  }

  private translateVertices(vertexIds: string[], offset: Vec3): void {
    const geo = this.document.geometry;
    for (const vid of vertexIds) {
      const v = geo.getVertex(vid);
      if (!v) continue;
      v.position.x += offset.x;
      v.position.y += offset.y;
      v.position.z += offset.z;
    }
    this._dirtyVertexIds = vertexIds;
  }

  // ── Cloning ──────────────────────────────────────────────

  private cloneSelection(): {
    sourceEntityIds: string[];
    newVertexIds: string[];
    newFaceIds: string[];
    newEdgeIds: string[];
  } {
    const ids = this.resolveSelectedEntityIds();
    return { ...this.cloneSelectionFromIds(ids), sourceEntityIds: [...ids] };
  }

  private cloneSelectionFromIds(entityIds: string[]): {
    newVertexIds: string[];
    newFaceIds: string[];
    newEdgeIds: string[];
  } {
    const clone = cloneEntitiesFromIds(this.document.geometry, entityIds);
    // Array clones of a component also become instances of its family.
    this.registerCloneAsInstance(clone.newFaceIds, clone.newEdgeIds);
    return clone;
  }

  /** If the copy source was a single component, wrap the cloned geometry in
   *  a new component registered as an instance of the source's family. */
  private copySourceComponentId: string | null = null;
  private registerCloneAsInstance(newFaceIds: string[], newEdgeIds: string[]): void {
    if (!this.copySourceComponentId) return;
    const sm = this.document.scene as any;
    const source = sm.components?.get(this.copySourceComponentId);
    if (!source) return;
    const newCompId = sm.createComponent(source.name, [...newFaceIds, ...newEdgeIds], { isGroup: source.isGroup });
    // Groups are one-offs: a copied group is its own thing (fresh family
    // from createComponent). Components join the source's family and start
    // at the same pose.
    if (!source.isGroup) {
      sm.linkInstanceToFamily(this.copySourceComponentId, newCompId);
      const clone = sm.components.get(newCompId);
      if (clone && source.quat) clone.quat = { ...source.quat };
    }
  }

  // ── State helpers ────────────────────────────────────────

  private reset(): void {
    this.resetMoveState();
    this.lastCopyOffset = null;
    this.lastCopyOriginIds = [];
    this.lastCopyClonedFaceIds = [];
    this.lastCopyClonedEdgeIds = [];
    this.lastCopyClonedVertexIds = [];
  }

  private resetMoveState(): void {
    this.origin = null;
    this.currentDest = null;
    this.isCopy = false;
    this.session.clear();
    this.lockedAxis = null;
    this.axisLock = null;
    this.clearDirectionInference();
    this.setPhase('idle');
    this.setVCBValue('');
  }

  private constrainToLockedAxis(offset: Vec3): Vec3 {
    if (!this.lockedAxis) return offset;
    return {
      x: this.lockedAxis === 'x' ? offset.x : 0,
      y: this.lockedAxis === 'y' ? offset.y : 0,
      z: this.lockedAxis === 'z' ? offset.z : 0,
    };
  }

  private applyOffset(offset: Vec3): void {
    const dx = this.lockedAxis && this.lockedAxis !== 'x' ? 0 : offset.x;
    const dy = this.lockedAxis && this.lockedAxis !== 'y' ? 0 : offset.y;
    const dz = this.lockedAxis && this.lockedAxis !== 'z' ? 0 : offset.z;
    this._dirtyVertexIds = this.session.apply(orig => ({
      x: orig.x + dx,
      y: orig.y + dy,
      z: orig.z + dz,
    }));
  }
}
