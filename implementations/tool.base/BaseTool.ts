// @archigraph tool.base
// Abstract base class for all DraftDown tools

import { Vec3, Plane, Color } from '../../src/core/types';
import type { ToolCategory, ToolPhase } from '../../src/core/types';
import type {
  ITool, ToolMouseEvent, ToolKeyEvent, ToolPreview, ToolEventNeeds,
  IModelDocument, IViewport, IInferenceEngine,
} from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { toInternal, toDisplay, formatDistance, getCurrentUnit, parseDistanceExpr } from '../../src/core/units';
import { snapPlanePointToGrid } from '../../src/core/snap-settings';
import { customAxes } from '../tool.axes/CustomAxes';
import { DrawingPlaneAxis, DRAWING_PLANES, getPlaneNormal, getPlaneLabelSuffix } from './drawingPlanes';
import { rayPlaneIntersect } from './planeGeometry';

// Re-exported so tools can keep importing everything from one module.
export { DRAWING_PLANES, getPlaneNormal, getPlaneLabelSuffix } from './drawingPlanes';
export type { DrawingPlaneAxis } from './drawingPlanes';

export abstract class BaseTool implements ITool {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly icon: string;
  abstract readonly shortcut: string;
  abstract readonly category: ToolCategory;
  abstract readonly cursor: string;

  protected document: IModelDocument;
  protected viewport: IViewport;
  protected inference: IInferenceEngine;

  protected phase: ToolPhase = 'idle';
  protected vcbValue: string = '';
  protected statusText: string = '';

  /** Current drawing plane axis, changeable with arrow keys. */
  protected drawingPlaneAxis: DrawingPlaneAxis = 'ground';

  /** Dirty vertex IDs from the last mutation — read by viewport for targeted sync. */
  _dirtyVertexIds: string[] | null = null;

  constructor(document: IModelDocument, viewport: IViewport, inference: IInferenceEngine) {
    this.document = document;
    this.viewport = viewport;
    this.inference = inference;
  }

  activate(): void {
    this.phase = 'idle';
    this.vcbValue = '';
    this.statusText = '';
    this.drawingPlaneAxis = 'ground';
    this.redoLastOp = null;
    const container = (globalThis as any).document?.querySelector?.('.viewport-container');
    if (container) container.style.cursor = this.cursor || 'crosshair';
  }

  deactivate(): void {
    this.phase = 'idle';
    this.vcbValue = '';
    this.statusText = '';
    this.fromPointRef = null;
    this.edgeExtensionRef = null;
    this.anchorInferCache = null;
    this.clearDirectionInference();
    // Reset cursor to crosshair (tools may set inline cursor styles)
    const container = (globalThis as any).document?.querySelector?.('.viewport-container');
    if (container) container.style.cursor = 'crosshair';
  }

  onMouseDown(_event: ToolMouseEvent): void {}
  onMouseMove(_event: ToolMouseEvent): void {}
  onMouseUp(_event: ToolMouseEvent): void {}
  onKeyDown(_event: ToolKeyEvent): void {}
  onKeyUp(_event: ToolKeyEvent): void {}
  onVCBInput(_value: string): void {}

  getStatusText(): string { return this.statusText; }
  getVCBLabel(): string { return ''; }
  getVCBValue(): string { return this.vcbValue; }
  getPreview(): ToolPreview | null { return null; }

  /**
   * Default event needs derived from tool category and phase.
   * Override in specific tools that differ from the default.
   */
  getEventNeeds(phase: ToolPhase): ToolEventNeeds {
    const isActive = phase === 'active' || phase === 'drawing';
    const isDrawOrMeasure = this.category === 'draw' || this.category === 'measure' || this.category === 'construct';
    return {
      snap: isDrawOrMeasure,  // Snap always on for draw/measure tools (first point too)
      // Raycast is needed in idle for draw tools too — the FIRST click must
      // know the face under the cursor so the shape's drawing plane locks to
      // that face (even when the cursor snaps to a vertex/edge on the face).
      raycast: isActive || isDrawOrMeasure,
      edgeRaycast: false,
      liveSyncOnMove: false,
      mutatesOnClick: this.category !== 'navigate',
    };
  }

  // ── Helpers ──────────────────────────────────────────────────

  protected setPhase(phase: ToolPhase): void {
    this.phase = phase;
  }

  protected setVCBValue(value: string): void {
    this.vcbValue = value;
  }

  protected setStatus(text: string): void {
    this.statusText = text;
  }

  /** Resolve the effective world point from an event, preferring inference snap. */
  protected resolvePoint(event: ToolMouseEvent): Vec3 | null {
    if (event.inference) return event.inference.point;
    return event.worldPoint;
  }

  /**
   * Standard point resolution for draw tools:
   * 1. If snapped (worldPoint matches a vertex), use it
   * 2. If axis locked, project ray onto locked axis
   * 3. Raycast onto drawing plane
   * 4. Fall back to ground plane worldPoint
   */
  protected getStandardDrawPoint(event: ToolMouseEvent, anchor?: Vec3): Vec3 | null {
    // Snapped worldPoint always wins
    if (event.worldPoint) return event.worldPoint;
    // Raycast onto drawing plane
    const planePoint = this.screenToDrawingPlane(event, anchor);
    if (planePoint) return planePoint;
    return null;
  }

  /**
   * Find an existing vertex at the given position, or create a new one.
   * Prevents duplicate vertices at the same location.
   */
  protected findOrCreateVertex(point: Vec3): { id: string } {
    const SNAP_DIST = 0.01;
    const mesh = this.document.geometry.getMesh();
    for (const [, v] of mesh.vertices) {
      if (vec3.distance(v.position, point) < SNAP_DIST) {
        return { id: v.id };
      }
    }
    return this.document.geometry.createVertex(point);
  }

  /** Parse VCB input as a distance expression and convert to internal (meters).
   *  Accepts unit suffixes (8'10", 21', 10in, 30cm, 1.5m, 1/2") — a bare
   *  number uses the current document unit. Returns NaN on failure. */
  protected parseDistance(value: string): number {
    return parseDistanceExpr(value, getCurrentUnit());
  }

  /** Parse VCB input as comma-separated distance expressions, converted to internal. */
  protected parseDimensions(value: string): number[] {
    return value.split(',').map(s => parseDistanceExpr(s, getCurrentUnit()));
  }

  /** Format an internal distance for VCB display in current units. */
  protected formatDist(internalValue: number): string {
    return formatDistance(internalValue, getCurrentUnit());
  }

  /**
   * Type-to-redo (classic CAD): right after committing, typing a new value in
   * the measurements box re-does the operation with that value — repeatedly,
   * until a new operation starts. Tools arm this after commit; it is cleared
   * when any new transaction begins.
   */
  protected redoLastOp: ((value: string) => boolean) | null = null;

  /** Route idle-phase VCB input into the armed redo. Call at the top of
   *  onVCBInput in tools that support type-to-redo. */
  protected tryRedoLastOp(value: string): boolean {
    if (this.phase !== 'idle' || !this.redoLastOp) return false;
    return this.redoLastOp(value);
  }

  /** Begin an undo transaction. Also snapshots dimension state.
   *  Pass snapshotVertexIds for tools that mutate vertex positions directly. */
  protected beginTransaction(name: string, snapshotVertexIds?: string[]): void {
    this.redoLastOp = null;
    // Geometry is about to change — anchor-derived inference dirs go stale.
    this.anchorInferCache = null;
    const { dimensionStore } = require('../tool.dimension/DimensionStore');
    dimensionStore.pushSnapshot();
    this.document.history.beginTransaction(name);
    if (snapshotVertexIds?.length) {
      (this.document.history as any).snapshotVertices(snapshotVertexIds);
    }
  }

  /** Commit the current undo transaction. */
  protected commitTransaction(): void {
    this.document.history.commitTransaction();
  }

  /** Abort the current undo transaction. */
  protected abortTransaction(): void {
    this.document.history.abortTransaction();
  }

  /** Check if an entity can be edited in the current context (respects components). */
  protected isEditable(entityId: string): boolean {
    const sm = this.document.scene as any;
    return sm?.isEntityEditable ? sm.isEntityEditable(entityId) : true;
  }

  /**
   * Resolve selected entity IDs to actual face/edge IDs.
   * Component IDs are expanded to their member entity IDs.
   */
  protected resolveSelectedEntityIds(): string[] {
    const sm = this.document.scene as any;
    const result: string[] = [];
    for (const id of this.document.selection.state.entityIds) {
      // Check if it's a component ID
      if (sm?.components?.has(id)) {
        const comp = sm.components.get(id);
        if (comp) {
          for (const eid of comp.entityIds) result.push(eid);
        }
      } else {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * Get the current drawing plane based on the selected axis and an anchor point.
   * The plane passes through the anchor point with the axis normal.
   */
  protected getDrawingPlane(anchor: Vec3): Plane {
    const normal = getPlaneNormal(this.drawingPlaneAxis);
    const distance = vec3.dot(anchor, normal);
    return { normal: { ...normal }, distance };
  }

  /**
   * Drawing plane that prefers the face under the cursor when present.
   * If the event hit a face (passed through from GPU pick + raycast), use that
   * face's plane — this lets the user draw shapes ON that face, mirroring
   * DraftDown's "On Face" inference. Otherwise falls back to the axis-based plane.
   */
  protected getEffectiveDrawingPlane(event: ToolMouseEvent | undefined, anchor: Vec3): Plane {
    // Prefer the underlying face id (set even when hitEntityId resolves to a
    // component wrapper); fall back to hitEntityId for raw face hits.
    const candidateId = event?.hitFaceId ?? event?.hitEntityId ?? null;
    if (candidateId) {
      const face = this.document.geometry.getFace(candidateId);
      if (face) {
        // face.plane = { normal, distance } where normal·v = distance for v on plane.
        return { normal: { ...face.plane.normal }, distance: face.plane.distance };
      }
    }
    return this.getDrawingPlane(anchor);
  }

  /**
   * Handle arrow key presses to change drawing plane.
   * Returns true if an arrow key was handled.
   */
  protected handleArrowKeyPlane(event: ToolKeyEvent): boolean {
    let changed = false;
    switch (event.key) {
      case 'ArrowUp':
        this.drawingPlaneAxis = this.drawingPlaneAxis === 'green' ? 'ground' : 'green';
        changed = true;
        break;
      case 'ArrowRight':
        this.drawingPlaneAxis = this.drawingPlaneAxis === 'red' ? 'ground' : 'red';
        changed = true;
        break;
      case 'ArrowLeft':
        this.drawingPlaneAxis = this.drawingPlaneAxis === 'blue' ? 'ground' : 'blue';
        changed = true;
        break;
      case 'ArrowDown':
        this.drawingPlaneAxis = 'ground';
        changed = true;
        break;
    }

    if (changed) {
      const info = DRAWING_PLANES[this.drawingPlaneAxis];
      this.setStatus(`Drawing plane: ${info.label}${getPlaneLabelSuffix()}. ${this.statusText.replace(/Drawing plane:.*?\. /, '')}`);
    }
    return changed;
  }

  // ── Axis locking ────────────────────────────────────────────

  /** Current axis lock: 'x' | 'y' | 'z' | null */
  protected axisLock: 'x' | 'y' | 'z' | null = null;

  /**
   * Handle arrow keys for axis locking.
   * Up=Y (blue/vertical), Right=X (red), Left=Z (green), Down=unlock.
   * Returns true if an arrow key was handled.
   */
  protected handleArrowKeyAxisLock(event: ToolKeyEvent): boolean {
    switch (event.key) {
      case 'ArrowUp':
        this.axisLock = this.axisLock === 'y' ? null : 'y';
        break;
      case 'ArrowRight':
        this.axisLock = this.axisLock === 'x' ? null : 'x';
        break;
      case 'ArrowLeft':
        this.axisLock = this.axisLock === 'z' ? null : 'z';
        break;
      case 'ArrowDown':
        this.axisLock = null;
        break;
      default:
        return false;
    }
    return true;
  }

  /** Get a status string describing the current axis lock state. */
  protected getAxisLockStatus(): string {
    if (!this.axisLock) return 'Axis unlocked. Free movement.';
    const axisNames = { x: 'Red (X)', y: 'Blue (Y) — vertical', z: 'Green (Z)' };
    return `Locked to ${axisNames[this.axisLock]} axis.`;
  }

  /**
   * Apply axis lock: constrain the point to move only along the locked axis
   * from an anchor point. Respects custom axes orientation.
   */
  protected applyAxisLock(point: Vec3, anchor: Vec3): Vec3 {
    if (!this.axisLock) return point;
    const axisDir: Vec3 = customAxes.getAxisDirection(this.axisLock);
    const offset = vec3.sub(point, anchor);
    const projLen = vec3.dot(offset, axisDir);
    return vec3.add(anchor, vec3.mul(axisDir, projLen));
  }

  // ── Construction guides (persistent, snappable, undoable) ─────

  /** Create a persistent construction guide line. Infinite guides extend
   *  ±1000 along the a→b direction (classic CAD guides are infinite). The id
   *  prefix 'guide-' makes it snappable (On Line) and Delete Guides-able. */
  protected emitConstructionGuideLine(a: Vec3, b: Vec3, opts?: { infinite?: boolean }): void {
    let start = a, end = b;
    if (opts?.infinite) {
      const dir = vec3.normalize(vec3.sub(b, a));
      if (vec3.length(dir) < 1e-9) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      start = vec3.add(mid, vec3.mul(dir, -1000));
      end = vec3.add(mid, vec3.mul(dir, 1000));
    }
    const guideId = `guide-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const color = { r: 0, g: 0, b: 0 };
    this.viewport.renderer.addGuideLine(
      guideId, start, end, color, true,
      { linewidth: 2, selectable: true },
    );
    (this.document.history as any).recordGuideLine?.({
      id: guideId,
      start: { ...start },
      end: { ...end },
      color,
      dashed: true,
    });
  }

  /** Create a persistent construction guide POINT (3-axis cross marker).
   *  The 'guide-pt-' id prefix makes its midpoint a vertex-priority snap. */
  protected emitConstructionGuidePoint(p: Vec3): void {
    const baseId = `guide-pt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const color = { r: 0, g: 0, b: 0 };
    const SIZE = 0.05;
    const axes: Array<[Vec3, Vec3]> = [
      [{ x: p.x - SIZE, y: p.y, z: p.z }, { x: p.x + SIZE, y: p.y, z: p.z }],
      [{ x: p.x, y: p.y - SIZE, z: p.z }, { x: p.x, y: p.y + SIZE, z: p.z }],
      [{ x: p.x, y: p.y, z: p.z - SIZE }, { x: p.x, y: p.y, z: p.z + SIZE }],
    ];
    axes.forEach(([a, b], i) => {
      const id = `${baseId}-${i}`;
      this.viewport.renderer.addGuideLine(
        id, a, b, color, false,
        { linewidth: 2, selectable: true },
      );
      (this.document.history as any).recordGuideLine?.({
        id, start: { ...a }, end: { ...b }, color, dashed: false,
      });
    });
  }

  // ── Directional inference (classic-CAD-style) ───────────────────

  /** Label of the active directional inference ("On Red Axis", …). Shown near the cursor. */
  protected inferenceLabel: string | null = null;
  /** Color of the active directional inference — tools tint the rubber band with it. */
  protected inferenceColor: Color | null = null;
  /** Last directional inference, kept so holding Shift can pin it. */
  private lastDirInference: { dir: Vec3; label: string; color: Color } | null = null;

  private static readonly AXIS_GUIDE_ID = 'axis-inference-guide';
  private static readonly PARALLEL_GUIDE_ID = 'parallel-snap-guide';
  private static readonly FROM_POINT_GUIDE_ID = 'from-point-guide';
  private static readonly EXTENSION_GUIDE_ID = 'edge-extension-guide';

  /** Most recent hard-snapped point the user hovered while drawing — the
   *  classic CAD "From Point" reference. Dotted guides extend from it along the
   *  axes so new geometry can align with distant existing geometry. */
  private fromPointRef: Vec3 | null = null;
  /** Angle tolerance (~7°) for automatic axis inference. */
  private static readonly AXIS_INFERENCE_THRESHOLD = 0.12;
  /** Angle tolerance (~5°) for parallel-to-edge inference. */
  protected static readonly PARALLEL_THRESHOLD = 0.087;

  // classic CAD color language: BLUE is the vertical axis. DraftDown is Y-up,
  // so Y = blue and Z = green (internal x/y/z keys are unchanged).
  private static readonly AXIS_COLORS: Record<'x' | 'y' | 'z', Color> = {
    x: { r: 0.9, g: 0.1, b: 0.1 },   // red
    y: { r: 0.15, g: 0.35, b: 1.0 }, // blue — vertical
    z: { r: 0.0, g: 0.7, b: 0.2 },   // green
  };
  private static readonly AXIS_NAMES: Record<'x' | 'y' | 'z', string> = { x: 'Red', y: 'Blue', z: 'Green' };
  private static readonly PARALLEL_COLOR: Color = { r: 0.8, g: 0, b: 0.8 }; // magenta
  private static readonly TANGENT_COLOR: Color = { r: 0, g: 0.75, b: 0.75 }; // cyan
  private static readonly EXTENSION_COLOR: Color = { r: 0, g: 0.55, b: 0.55 }; // dark cyan

  /** Endpoints of the last hovered edge (on-edge snap) — linear inference can
   *  later snap onto that edge's infinite extension (classic CAD dotted
   *  extension line). */
  private edgeExtensionRef: { a: Vec3; b: Vec3 } | null = null;
  /** Cached perpendicular/tangent directions derived from the geometry at the
   *  current anchor — recomputed when the anchor changes. */
  private anchorInferCache: {
    anchor: Vec3;
    dirs: Array<{ dir: Vec3; label: string; color: Color }>;
  } | null = null;

  getInferenceLabel(): string | null { return this.inferenceLabel; }

  /**
   * classic-CAD-style directional inference for a point being placed relative to
   * an anchor (rubber-band end, move destination, measure endpoint):
   *  1. Hard point snaps (Origin/Endpoint/Midpoint/Intersection) always win.
   *  2. Manual axis lock (arrow keys) constrains to that axis.
   *  3. Holding Shift pins the current inference even as the cursor drifts.
   *  4. A direction within tolerance of a drawing axis snaps onto it
   *     (red/green/blue guide line + "On … Axis" label).
   *  5. Otherwise the direction can snap parallel to an existing edge
   *     (magenta guide + "Parallel to Edge").
   * Returns the constrained point and updates inferenceLabel/inferenceColor.
   */
  protected applyDirectionInference(
    anchor: Vec3, point: Vec3, event: ToolMouseEvent,
    opts?: { parallel?: boolean },
  ): Vec3 {
    // Hard point snaps win — never fight an explicit endpoint/midpoint snap.
    const k = event.snapKind;
    if (k === 'origin' || k === 'vertex' || k === 'midpoint' || k === 'intersection' || k === 'center') {
      // Remember it as a "From Point" reference for later alignment guides
      if (vec3.distance(point, anchor) > 0.01) {
        this.fromPointRef = { ...point };
      }
      this.clearDirectionInference();
      return point;
    }
    // On-edge snap is also hard (indicator == geometry) — and the hovered
    // edge becomes the reference for extension inference once the cursor
    // moves past its endpoints.
    if (k === 'edge') {
      this.rememberEdgeExtension(point);
      this.clearDirectionInference();
      return point;
    }

    // Manual axis lock (arrow keys) — explicit, beats automatic inference.
    if (this.axisLock) {
      const locked = this.applyAxisLock(point, anchor);
      this.setDirectionInference(
        anchor, customAxes.getAxisDirection(this.axisLock),
        `On ${BaseTool.AXIS_NAMES[this.axisLock]} Axis (locked)`,
        BaseTool.AXIS_COLORS[this.axisLock],
      );
      return locked;
    }

    const offset = vec3.sub(point, anchor);
    const len = vec3.length(offset);
    if (len < 0.01) {
      this.clearDirectionInference();
      return point;
    }

    // Shift pins the current inference (matches the classic modeler's Shift-to-lock).
    if (event.shiftKey && this.lastDirInference) {
      const held = this.lastDirInference;
      const projLen = vec3.dot(offset, held.dir);
      const p = vec3.add(anchor, vec3.mul(held.dir, projLen));
      this.setDirectionInference(anchor, held.dir, held.label, held.color);
      return p;
    }

    const dir = vec3.mul(offset, 1 / len);

    // Automatic axis inference: snap to the nearest drawing axis within tolerance.
    let bestAxis: 'x' | 'y' | 'z' | null = null;
    let bestAngle = BaseTool.AXIS_INFERENCE_THRESHOLD;
    for (const axis of ['x', 'y', 'z'] as const) {
      const axisDir = customAxes.getAxisDirection(axis);
      const dot = Math.abs(vec3.dot(dir, axisDir));
      const angle = Math.acos(Math.min(dot, 1));
      if (angle < bestAngle) {
        bestAngle = angle;
        bestAxis = axis;
      }
    }
    if (bestAxis) {
      let axisDir = customAxes.getAxisDirection(bestAxis);
      if (vec3.dot(dir, axisDir) < 0) axisDir = vec3.negate(axisDir);
      const projLen = vec3.dot(offset, axisDir);
      const snapped = vec3.add(anchor, vec3.mul(axisDir, projLen));
      const suffix = customAxes.isCustom ? ' (custom)' : '';
      this.setDirectionInference(
        anchor, axisDir,
        `On ${BaseTool.AXIS_NAMES[bestAxis]} Axis${suffix}`,
        BaseTool.AXIS_COLORS[bestAxis],
      );
      return snapped;
    }

    // Perpendicular-to-edge and tangent-at-vertex inference from the
    // geometry at the ANCHOR (the edge the rubber band starts on).
    for (const cand of this.getAnchorInferenceDirections(anchor)) {
      const d = vec3.dot(dir, cand.dir);
      const angle = Math.acos(Math.min(Math.abs(d), 1));
      if (angle < BaseTool.PARALLEL_THRESHOLD) {
        const alignedDir = d >= 0 ? cand.dir : vec3.negate(cand.dir);
        const projLen = vec3.dot(offset, alignedDir);
        const snapped = vec3.add(anchor, vec3.mul(alignedDir, projLen));
        this.setDirectionInference(anchor, alignedDir, cand.label, cand.color);
        return snapped;
      }
    }

    // Extension of a previously hovered edge: snap onto its infinite line
    // beyond the segment (classic CAD dotted extension).
    const ext = this.tryEdgeExtension(point);
    if (ext) {
      this.setDirectionInference(
        anchor, ext.dir, 'Extend Edge', BaseTool.EXTENSION_COLOR,
        { start: ext.from, end: ext.point, id: BaseTool.EXTENSION_GUIDE_ID },
      );
      return ext.point;
    }

    // "From Point" inference: align with the remembered reference point
    // along an axis (dotted guide from the reference to the cursor).
    const fromPoint = this.tryFromPointInference(point);
    if (fromPoint) {
      this.setDirectionInference(
        anchor, fromPoint.dir, 'From Point', fromPoint.color,
        { start: fromPoint.ref, end: fromPoint.point, id: BaseTool.FROM_POINT_GUIDE_ID },
      );
      return fromPoint.point;
    }

    // Parallel-to-edge inference.
    if (opts?.parallel !== false) {
      const par = this.tryParallelSnap(anchor, point);
      if (par) {
        this.setDirectionInference(
          anchor, par.dir, 'Parallel to Edge', BaseTool.PARALLEL_COLOR,
          { start: par.edgeStart, end: par.edgeEnd, id: BaseTool.PARALLEL_GUIDE_ID },
        );
        return par.snappedPoint;
      }
    }

    this.clearDirectionInference();
    return point;
  }

  /** Activate a directional inference: set label/color, draw its guide line.
   *  Default guide is the axis line through the anchor; parallel inference
   *  instead highlights the reference edge it matched. */
  private setDirectionInference(
    anchor: Vec3, dir: Vec3, label: string, color: Color,
    guide?: { start: Vec3; end: Vec3; id: string },
  ): void {
    this.inferenceLabel = label;
    this.inferenceColor = color;
    this.lastDirInference = { dir, label, color };

    this.viewport.renderer.removeGuideLine(BaseTool.AXIS_GUIDE_ID);
    this.viewport.renderer.removeGuideLine(BaseTool.PARALLEL_GUIDE_ID);
    this.viewport.renderer.removeGuideLine(BaseTool.FROM_POINT_GUIDE_ID);
    this.viewport.renderer.removeGuideLine(BaseTool.EXTENSION_GUIDE_ID);
    const HALF_LEN = 1000;
    const start = guide?.start ?? vec3.add(anchor, vec3.mul(dir, -HALF_LEN));
    const end = guide?.end ?? vec3.add(anchor, vec3.mul(dir, HALF_LEN));
    this.viewport.renderer.addGuideLine(
      guide?.id ?? BaseTool.AXIS_GUIDE_ID, start, end, color, true,
      { selectable: false, opacity: 0.6 },
    );
  }

  /** Drop any active directional inference: label, color, guides, Shift-pin state. */
  protected clearDirectionInference(): void {
    this.inferenceLabel = null;
    this.inferenceColor = null;
    this.lastDirInference = null;
    this.viewport.renderer.removeGuideLine(BaseTool.AXIS_GUIDE_ID);
    this.viewport.renderer.removeGuideLine(BaseTool.PARALLEL_GUIDE_ID);
    this.viewport.renderer.removeGuideLine(BaseTool.FROM_POINT_GUIDE_ID);
    this.viewport.renderer.removeGuideLine(BaseTool.EXTENSION_GUIDE_ID);
    // NOTE: fromPointRef intentionally survives — it's a remembered reference,
    // not an active inference. It clears on deactivate.
  }

  /** Remember the edge under an on-edge snap as the extension reference. */
  private rememberEdgeExtension(pointOnEdge: Vec3): void {
    const mesh = this.document.geometry.getMesh();
    if (mesh.edges.size > 2000) return;
    let best: { a: Vec3; b: Vec3 } | null = null;
    let bestDist = 1e-3;
    mesh.edges.forEach((edge) => {
      const v1 = mesh.vertices.get(edge.startVertexId);
      const v2 = mesh.vertices.get(edge.endVertexId);
      if (!v1 || !v2) return;
      const d = vec3.sub(v2.position, v1.position);
      const lenSq = vec3.dot(d, d);
      if (lenSq < 1e-12) return;
      const t = Math.max(0, Math.min(1, vec3.dot(vec3.sub(pointOnEdge, v1.position), d) / lenSq));
      const closest = vec3.add(v1.position, vec3.mul(d, t));
      const dist = vec3.distance(closest, pointOnEdge);
      if (dist < bestDist) {
        bestDist = dist;
        best = { a: { ...v1.position }, b: { ...v2.position } };
      }
    });
    if (best) this.edgeExtensionRef = best;
  }

  /** Snap onto the infinite extension of the remembered edge when the cursor
   *  is within ~8 screen px of it and BEYOND the segment's endpoints. */
  private tryEdgeExtension(
    point: Vec3,
  ): { point: Vec3; dir: Vec3; from: Vec3 } | null {
    const ref = this.edgeExtensionRef;
    if (!ref) return null;
    const d = vec3.sub(ref.b, ref.a);
    const lenSq = vec3.dot(d, d);
    if (lenSq < 1e-12) return null;
    const t = vec3.dot(vec3.sub(point, ref.a), d) / lenSq;
    // Only OUTSIDE the segment — inside, the on-edge snap already handles it.
    if (t >= -0.01 && t <= 1.01) return null;

    const proj = vec3.add(ref.a, vec3.mul(d, t));
    const w = this.viewport.getWidth();
    const h = this.viewport.getHeight();
    const cursorScreen = this.viewport.camera.worldToScreen(point, w, h);
    const projScreen = this.viewport.camera.worldToScreen(proj, w, h);
    const dx = projScreen.x - cursorScreen.x;
    const dy = projScreen.y - cursorScreen.y;
    if (dx * dx + dy * dy >= 64) return null;

    const dir = vec3.normalize(d);
    const from = t > 1 ? { ...ref.b } : { ...ref.a };
    return { point: proj, dir: t > 1 ? dir : vec3.negate(dir), from };
  }

  /** Perpendicular and tangent directions implied by the geometry at the
   *  anchor: edges the anchor sits on give perpendiculars (in each adjacent
   *  face's plane, or the ground plane for loose edges); arc endpoints give
   *  the tangent direction. Cached per anchor. */
  private getAnchorInferenceDirections(
    anchor: Vec3,
  ): Array<{ dir: Vec3; label: string; color: Color }> {
    const cache = this.anchorInferCache;
    if (cache && vec3.distance(cache.anchor, anchor) < 1e-9) return cache.dirs;

    const dirs: Array<{ dir: Vec3; label: string; color: Color }> = [];
    const geo = this.document.geometry;
    const mesh = geo.getMesh();
    if (mesh.edges.size <= 2000) {
      const pushUnique = (dir: Vec3, label: string, color: Color) => {
        for (const existing of dirs) {
          if (Math.abs(vec3.dot(existing.dir, dir)) > 0.9999) return;
        }
        dirs.push({ dir, label, color });
      };

      mesh.edges.forEach((edge) => {
        const v1 = mesh.vertices.get(edge.startVertexId);
        const v2 = mesh.vertices.get(edge.endVertexId);
        if (!v1 || !v2) return;
        const d = vec3.sub(v2.position, v1.position);
        const lenSq = vec3.dot(d, d);
        if (lenSq < 1e-12) return;

        const atStart = vec3.distance(anchor, v1.position) < 1e-6;
        const atEnd = vec3.distance(anchor, v2.position) < 1e-6;
        let onEdge = atStart || atEnd;
        if (!onEdge) {
          const t = vec3.dot(vec3.sub(anchor, v1.position), d) / lenSq;
          if (t > 0 && t < 1) {
            const closest = vec3.add(v1.position, vec3.mul(d, t));
            onEdge = vec3.distance(closest, anchor) < 1e-4;
          }
        }
        if (!onEdge) return;

        const edgeDir = vec3.normalize(d);

        // Tangent: anchor at the endpoint of a curve (arc/circle) segment —
        // continuing straight out of the arc is the tangent direction.
        if ((atStart || atEnd) && (edge as any).curveId) {
          const other = atStart ? v2.position : v1.position;
          const tangent = vec3.normalize(vec3.sub(anchor, other));
          if (vec3.length(tangent) > 1e-9) {
            pushUnique(tangent, 'Tangent at Vertex', BaseTool.TANGENT_COLOR);
          }
        }

        // Perpendicular in each adjacent face's plane; loose edges fall back
        // to the ground-plane perpendicular.
        const faces = geo.getEdgeFaces(edge.id);
        if (faces.length > 0) {
          for (const face of faces) {
            const perp = vec3.cross(edgeDir, face.normal);
            if (vec3.length(perp) > 1e-9) {
              pushUnique(vec3.normalize(perp), 'Perpendicular to Edge', BaseTool.PARALLEL_COLOR);
            }
          }
        } else {
          const perp = vec3.cross(edgeDir, { x: 0, y: 1, z: 0 });
          if (vec3.length(perp) > 1e-9) {
            pushUnique(vec3.normalize(perp), 'Perpendicular to Edge', BaseTool.PARALLEL_COLOR);
          }
        }
      });
    }

    this.anchorInferCache = { anchor: { ...anchor }, dirs };
    return dirs;
  }

  /** If the cursor lies near an axis line through the remembered reference
   *  point, snap onto that line (classic CAD "From Point"). Screen-space test
   *  (~8px) so it works at any zoom. */
  private tryFromPointInference(
    point: Vec3,
  ): { point: Vec3; ref: Vec3; dir: Vec3; color: Color } | null {
    const ref = this.fromPointRef;
    if (!ref) return null;
    if (vec3.distance(ref, point) < 0.01) return null;

    const w = this.viewport.getWidth();
    const h = this.viewport.getHeight();
    const cursorScreen = this.viewport.camera.worldToScreen(point, w, h);

    for (const axis of ['x', 'y', 'z'] as const) {
      const dir = customAxes.getAxisDirection(axis);
      const offset = vec3.sub(point, ref);
      const projLen = vec3.dot(offset, dir);
      const proj = vec3.add(ref, vec3.mul(dir, projLen));
      const projScreen = this.viewport.camera.worldToScreen(proj, w, h);
      const dx = projScreen.x - cursorScreen.x;
      const dy = projScreen.y - cursorScreen.y;
      if (dx * dx + dy * dy < 64) { // within 8px
        return { point: proj, ref: { ...ref }, dir, color: BaseTool.AXIS_COLORS[axis] };
      }
    }
    return null;
  }

  /**
   * Check if the line from anchor→point is roughly parallel to an existing
   * edge. If so, return the constrained point, the matched direction, and the
   * reference edge endpoints (for guide display).
   */
  protected tryParallelSnap(
    anchor: Vec3, point: Vec3,
  ): { snappedPoint: Vec3; dir: Vec3; edgeStart: Vec3; edgeEnd: Vec3 } | null {
    const offset = vec3.sub(point, anchor);
    const len = vec3.length(offset);
    if (len < 0.01) return null; // Too short to determine direction

    const dir = vec3.normalize(offset);
    const mesh = this.document.geometry.getMesh();

    // Skip parallel snap for large meshes to avoid per-frame lag
    if (mesh.edges.size > 2000) return null;

    let bestAngle = BaseTool.PARALLEL_THRESHOLD;
    let bestEdgeDir: Vec3 | null = null;
    let bestEdgeStart: Vec3 | null = null;
    let bestEdgeEnd: Vec3 | null = null;

    mesh.edges.forEach((edge) => {
      const v1 = mesh.vertices.get(edge.startVertexId);
      const v2 = mesh.vertices.get(edge.endVertexId);
      if (!v1 || !v2) return;

      const edgeVec = vec3.sub(v2.position, v1.position);
      const edgeLen = vec3.length(edgeVec);
      if (edgeLen < 0.01) return;

      const edgeDir = vec3.normalize(edgeVec);

      // Check parallelism (handle both directions)
      const dot = Math.abs(vec3.dot(dir, edgeDir));
      // dot ≈ 1 means parallel; angle = acos(dot)
      if (dot > 0.9996) return; // Already nearly exact — skip (acos would be ~0)
      const angle = Math.acos(Math.min(dot, 1.0));

      if (angle < bestAngle) {
        bestAngle = angle;
        // Choose direction that aligns with user's cursor direction
        bestEdgeDir = vec3.dot(dir, edgeDir) >= 0 ? edgeDir : vec3.negate(edgeDir);
        bestEdgeStart = { ...v1.position };
        bestEdgeEnd = { ...v2.position };
      }
    });

    if (!bestEdgeDir || !bestEdgeStart || !bestEdgeEnd) return null;

    // Constrain: project offset onto the parallel edge direction
    const projLen = vec3.dot(offset, bestEdgeDir);
    const snappedPoint = vec3.add(anchor, vec3.mul(bestEdgeDir, projLen));

    return { snappedPoint, dir: bestEdgeDir, edgeStart: bestEdgeStart, edgeEnd: bestEdgeEnd };
  }

  /**
   * Project a camera ray onto an axis line from an anchor point.
   * Returns the closest point on the axis to the ray.
   */
  protected projectRayOntoAxis(ray: { origin: Vec3; direction: Vec3 }, anchor: Vec3, axis: 'x' | 'y' | 'z'): Vec3 {
    const axisDir: Vec3 = customAxes.getAxisDirection(axis);
    const w = vec3.sub(anchor, ray.origin);
    const a = vec3.dot(ray.direction, ray.direction);
    const b = vec3.dot(ray.direction, axisDir);
    const c = vec3.dot(axisDir, axisDir);
    const d = vec3.dot(ray.direction, w);
    const e = vec3.dot(axisDir, w);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-10) return anchor;
    const s = (a * e - b * d) / denom;
    return vec3.add(anchor, vec3.mul(axisDir, s));
  }

  /**
   * Project a world point onto the current drawing plane.
   * If anchor is provided, the plane passes through the anchor.
   */
  protected projectOnDrawingPlane(point: Vec3, anchor?: Vec3): Vec3 {
    const plane = this.getDrawingPlane(anchor ?? { x: 0, y: 0, z: 0 });
    return vec3.projectOnPlane(point, plane);
  }

  /**
   * Cast a ray from screen coordinates and intersect with the axis-based drawing plane.
   * (Doesn't auto-pick face plane — once a tool starts drawing it stores its plane in
   * `this.drawPlane` and should call `raycastOntoPlane(this.drawPlane, ...)` to keep
   * projection on the locked face/axis plane regardless of where the cursor moves.)
   */
  protected screenToDrawingPlane(event: ToolMouseEvent, anchor?: Vec3): Vec3 | null {
    const plane = this.getDrawingPlane(anchor ?? { x: 0, y: 0, z: 0 });
    const p = this.raycastOntoPlane(plane, event.screenX, event.screenY);
    // Free point on an axis-aligned drawing plane → grid snap (no-op when
    // disabled or when the event carries a snap — hard snaps beat the grid)
    if (p && (event.snapKind === 'cursor' || event.snapKind == null)) {
      return snapPlanePointToGrid(p, plane.normal);
    }
    return p;
  }

  /**
   * Intersect a camera ray with an explicit plane. Used by shape tools to project
   * subsequent moves onto the plane they captured on first click (which may be a
   * face plane from getEffectiveDrawingPlane), regardless of where the cursor moves.
   */
  protected raycastOntoPlane(plane: Plane, screenX: number, screenY: number): Vec3 | null {
    const ray = this.viewport.camera.screenToRay(
      screenX, screenY,
      this.viewport.getWidth(), this.viewport.getHeight(),
    );
    return rayPlaneIntersect(ray, plane);
  }

  /** True when the event carries a hard POINT snap — the kinds the viewport
   *  shows a snap marker + label for (origin/endpoint/midpoint/intersection/
   *  on-edge). 'face' is a surface, 'cursor' is free — neither is a point. */
  protected isHardSnap(event: ToolMouseEvent): boolean {
    const k = event.snapKind;
    return k === 'origin' || k === 'vertex' || k === 'midpoint' ||
           k === 'intersection' || k === 'center' || k === 'edge';
  }

  /**
   * Resolve a point on a locked drawing plane using the SAME logic as the
   * snap indicator: when a hard point snap fired, the snapped point wins —
   * projected onto the plane if it lies off it, so the placed geometry lands
   * exactly under the marker the user sees. Otherwise the cursor is raycast
   * onto the plane. Tools sizing a shape (second corner, radius, arc points)
   * MUST use this instead of a raw raycastOntoPlane, or the committed
   * geometry diverges from the snap the viewport displayed.
   */
  protected getPlanePointHonoringSnap(event: ToolMouseEvent, plane: Plane): Vec3 | null {
    if (this.isHardSnap(event) && event.worldPoint) {
      return vec3.projectOnPlane(event.worldPoint, plane);
    }
    const p = this.raycastOntoPlane(plane, event.screenX, event.screenY);
    // Free point sizing a shape on a locked plane → grid snap. 'face' snaps
    // are excluded (surface points must stay exact); snapPlanePointToGrid
    // additionally no-ops on non-axis-aligned (face/custom-axes) planes.
    if (p && (event.snapKind === 'cursor' || event.snapKind == null)) {
      return snapPlanePointToGrid(p, plane.normal);
    }
    return p;
  }
}
