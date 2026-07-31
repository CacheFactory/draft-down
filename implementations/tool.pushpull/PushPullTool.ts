// @archigraph tool.pushpull
// Push/Pull tool: click a face, drag to extrude it into a 3D solid.
// Creates side faces + top cap. Like DraftDown's signature tool.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview, IFace, ToolEventNeeds } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { CURSOR_PUSHPULL } from '../tool.base/cursors';

export class PushPullTool extends BaseTool {
  readonly id = 'tool.pushpull';
  readonly name = 'Push/Pull';
  readonly icon = 'box';
  readonly shortcut = 'P';
  readonly category = 'modify' as const;
  readonly cursor = CURSOR_PUSHPULL;

  private selectedFaceId: string | null = null;
  private faceNormal: Vec3 | null = null;
  private faceAnchor: Vec3 | null = null;
  private startT = 0; // initial parametric position of cursor along the normal axis
  private currentDistance = 0;
  /** Distance of the most recent committed push/pull — double-click repeats it. */
  private lastCommittedDistance = 0;
  private lastClickTime = 0;
  /** Ctrl held at start: always extrude with new walls (leave the solid intact). */
  private forceNewWalls = false;
  /** The snapped axis parameter from the most recent mouseMove, if any. The
   *  commit path uses this so a click after a snap-active hover always lands at
   *  the same place the preview was showing. */
  private lastSnappedT: number | null = null;

  activate(): void {
    super.activate();
    this.reset();

    // DraftDown behavior: if a face is already selected, start Push/Pull on it
    const selectedIds = this.resolveSelectedEntityIds();
    if (selectedIds.length === 1) {
      const face = this.document.geometry.getFace(selectedIds[0]);
      if (face) {
        this.startOnFace(face, null);
        this.setStatus('Drag along the face normal to extrude, then click. Or type a distance.');
        return;
      }
    }

    this.setStatus('Click on a face to push/pull.');
  }

  deactivate(): void {
    if (this.phase !== 'idle') this.abortTransaction();
    this.document.selection.setPreSelection(null);
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    if (this.phase === 'idle') {
      // Use hit entity from event (supports GPU pick for batched mode)
      if (event.hitEntityId) {
        const face = this.document.geometry.getFace(event.hitEntityId);
        if (face) {
          // classic CAD: double-click repeats the last push/pull distance on
          // whichever face you double-click.
          const now = Date.now();
          const isDoubleClick = (now - this.lastClickTime) < 400;
          this.lastClickTime = now;
          this.forceNewWalls = event.ctrlKey;
          if (isDoubleClick && Math.abs(this.lastCommittedDistance) > 1e-9) {
            this.startOnFace(face, null);
            this.currentDistance = this.lastCommittedDistance;
            this.commitExtrusion();
            return;
          }
          this.startOnFace(face, event);
          this.setStatus(this.forceNewWalls
            ? 'Drag to extrude (Ctrl: leaves the starting face). Click to commit.'
            : 'Drag along the face normal to set distance, then click to commit. Double-click repeats the last distance.');
          return;
        }
      }
      this.setStatus('No face found. Click directly on a face.');
    } else if (this.phase === 'drawing') {
      // If the most recent hover landed on a snap, commit to THAT snapped
      // value — the user clicked while the preview was showing the snap, so
      // the commit should match the preview, even if the click coordinates
      // drifted a couple of pixels out of the snap radius.
      if (this.lastSnappedT !== null) {
        // Snap path: absolute depth (face plane sits at tv=0, snap to vertex's tv).
        this.currentDistance = this.lastSnappedT;
      } else if (this.faceAnchor && this.faceNormal) {
        // No active snap — recompute from the click position so the commit
        // tracks the actual cursor exactly.
        const rawT = this.cursorAxisT(event.screenX, event.screenY, this.faceAnchor, this.faceNormal);
        if (rawT !== null) {
          const snap = this.findVertexAxisSnap(rawT, event.screenX, event.screenY);
          this.currentDistance = snap ? snap.t : rawT - this.startT;
        }
      }
      this.commitExtrusion();
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (this.phase === 'idle') {
      // Pre-selection highlight: show which face will be pushed/pulled
      if (event.hitEntityId) {
        const face = this.document.geometry.getFace(event.hitEntityId);
        if (face) {
          this.document.selection.setPreSelection(face.id);
          this.setViewportCursor(true);
          return;
        }
      }
      this.document.selection.setPreSelection(null);
      this.setViewportCursor(false);
      return;
    }

    if (this.phase !== 'drawing' || !this.faceNormal || !this.faceAnchor) return;

    // Project the cursor ray onto the face's normal axis (anchor + t·normal) and
    // measure how far the cursor's projection has moved from the click point.
    // This matches the classic CAD behavior: drag along the face's normal direction
    // = extrude along that normal. View angle / screen-Y are no longer involved,
    // so the sign isn't inverted when looking at the face from "below."
    const rawT = this.cursorAxisT(event.screenX, event.screenY, this.faceAnchor, this.faceNormal);
    if (rawT === null) return;

    // Inference snap: if another vertex's projection onto the same axis is
    // within screen-space tolerance of the cursor's axis point, snap to it.
    // Lets the user push/pull exactly to the depth of an existing vertex
    // (e.g. pull a face out to match the back of an adjacent box).
    //
    // Snap is an ABSOLUTE depth (relative to the face's own plane, which sits
    // at tv = 0 since faceAnchor is the face centroid). Unsnapped motion is a
    // RELATIVE delta from the click's startT. Mixing the two reference frames
    // off-sets the committed face by startT, so the snap reads must skip the
    // startT subtraction.
    const snap = this.findVertexAxisSnap(rawT, event.screenX, event.screenY);
    if (snap) {
      this.currentDistance = snap.t;
      this.lastSnappedT = snap.t;
    } else {
      this.currentDistance = rawT - this.startT;
      this.lastSnappedT = null;
    }

    // Visual feedback via the SceneBridge snap marker if available on the app
    // singleton. Tools don't carry a direct sceneBridge handle, so we fish it
    // through the window-exposed app reference; if it's not there, the status
    // text still communicates the snap.
    const app = (globalThis as any).window?.__debugApp;
    const sb = app?.sceneBridge;
    if (snap) {
      sb?.showInferenceMarker?.(snap.point, this.viewport.camera);
      this.setStatus(`Distance: ${this.formatDist(this.currentDistance)} — snapped to vertex. Click to commit.`);
    } else {
      sb?.hideSnapMarker?.();
      this.setStatus(`Distance: ${this.formatDist(this.currentDistance)}. Click to commit.`);
    }
    this.setVCBValue(this.formatDist(this.currentDistance));
  }

  /** Snap when the extruded face plane is about to land on (or has just passed
   *  through) a vertex. Two filters keep this from snapping to random distant
   *  vertices:
   *    1. The candidate must be in the direction the user is pulling.
   *    2. The candidate must lie laterally within the face's profile (its
   *       projection onto the face plane is inside the face's bounding circle).
   *  Within those candidates, the screen-space delta between the cursor's axis
   *  point and the vertex's projection onto the axis must be under SNAP_PX. */
  private findVertexAxisSnap(t: number, _screenX: number, _screenY: number): { t: number; point: Vec3 } | null {
    if (!this.faceAnchor || !this.faceNormal || !this.selectedFaceId) return null;
    const SNAP_PX = 14;
    const vw = this.viewport.getWidth();
    const vh = this.viewport.getHeight();
    const anchor = this.faceAnchor;
    const N = this.faceNormal;

    // Pull direction; if the user hasn't moved yet, allow either side.
    const dir = t - this.startT;
    const dirSign = Math.abs(dir) < 1e-6 ? 0 : (dir > 0 ? 1 : -1);

    // Compute the face's lateral "radius²" from centroid — the max squared
    // distance from the centroid to any face vertex (which all have tv = 0,
    // so they lie in the face plane). Vertices further out laterally than
    // this aren't within the extrusion profile.
    const faceVerts = this.document.geometry.getFaceVertices(this.selectedFaceId);
    let faceRadiusSq = 0;
    for (const fv of faceVerts) {
      const dx = fv.position.x - anchor.x;
      const dy = fv.position.y - anchor.y;
      const dz = fv.position.z - anchor.z;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > faceRadiusSq) faceRadiusSq = r2;
    }
    // Tiny margin so vertices on the boundary still snap.
    faceRadiusSq *= 1.05;

    const cursorAxisPoint = vec3.add(anchor, vec3.mul(N, t));
    const cursorScreen = this.viewport.camera.worldToScreen(cursorAxisPoint, vw, vh);

    const mesh = this.document.geometry.getMesh();
    if (mesh.vertices.size > 5000) return null;

    let best: { t: number; point: Vec3; dist: number } | null = null;
    for (const [, v] of mesh.vertices) {
      const dx = v.position.x - anchor.x;
      const dy = v.position.y - anchor.y;
      const dz = v.position.z - anchor.z;
      const tv = dx * N.x + dy * N.y + dz * N.z;

      // 1) Not on the start face's plane.
      if (Math.abs(tv - this.startT) < 1e-4) continue;
      // 2) Must be in the pull direction (only relevant once user has moved).
      if (dirSign !== 0 && Math.sign(tv - this.startT) !== dirSign) continue;
      // 3) Must lie within the face's lateral profile. Subtract the along-axis
      //    component to get the in-plane offset from the centroid.
      const lx = dx - tv * N.x;
      const ly = dy - tv * N.y;
      const lz = dz - tv * N.z;
      if (lx * lx + ly * ly + lz * lz > faceRadiusSq) continue;

      // 4) Screen-space proximity along the axis.
      const vertexAxisPoint = vec3.add(anchor, vec3.mul(N, tv));
      const vertexScreen = this.viewport.camera.worldToScreen(vertexAxisPoint, vw, vh);
      const sx = cursorScreen.x - vertexScreen.x;
      const sy = cursorScreen.y - vertexScreen.y;
      const dist = Math.sqrt(sx * sx + sy * sy);
      if (dist < SNAP_PX && (!best || dist < best.dist)) {
        best = { t: tv, point: { ...v.position }, dist };
      }
    }
    return best;
  }

  /** Closest-point parametric t for an axis (anchor + t·dir) given a cursor ray. */
  private cursorAxisT(screenX: number, screenY: number, anchor: Vec3, axis: Vec3): number | null {
    const ray = this.viewport.camera.screenToRay(
      screenX, screenY,
      this.viewport.getWidth(), this.viewport.getHeight(),
    );
    // Closest point between two lines: ray (O + s·D) and axis (A + t·N).
    // Solve for t. d = N · (O - A) - (N · D)(D · (O - A)) / (D · D - (N · D)²·...)
    // Use the standard formula:
    //   t = [(N · D)(D · w) − (D · D)(N · w)] / [(N · D)² − (N · N)(D · D)]
    // where w = O - A.
    const D = ray.direction, O = ray.origin, A = anchor, N = axis;
    const wx = O.x - A.x, wy = O.y - A.y, wz = O.z - A.z;
    const NN = N.x * N.x + N.y * N.y + N.z * N.z;
    const DD = D.x * D.x + D.y * D.y + D.z * D.z;
    const ND = N.x * D.x + N.y * D.y + N.z * D.z;
    const Dw = D.x * wx + D.y * wy + D.z * wz;
    const Nw = N.x * wx + N.y * wy + N.z * wz;
    const denom = ND * ND - NN * DD;
    if (Math.abs(denom) < 1e-10) return null;
    return (ND * Dw - DD * Nw) / denom;
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      if (this.phase !== 'idle') this.abortTransaction();
      this.reset();
      this.setStatus('Click on a face to push/pull.');
    }
  }

  onVCBInput(value: string): void {
    if (this.tryRedoLastOp(value)) return;
    if (this.phase !== 'drawing') return;

    const dist = this.parseDistance(value);
    if (isNaN(dist) || dist === 0) return;

    this.currentDistance = dist;
    this.commitExtrusion();
  }

  getVCBLabel(): string {
    return this.phase === 'drawing' ? 'Distance' : '';
  }

  getEventNeeds(): ToolEventNeeds {
    return { snap: false, raycast: false, edgeRaycast: false, liveSyncOnMove: false, mutatesOnClick: true };
  }

  getPreview(): ToolPreview | null {
    if (this.phase !== 'drawing' || !this.selectedFaceId || !this.faceNormal || Math.abs(this.currentDistance) < 0.001) return null;

    const verts = this.document.geometry.getFaceVertices(this.selectedFaceId);
    if (verts.length < 3) return null;

    const offset = vec3.mul(this.faceNormal, this.currentDistance);

    // Show the top face outline at the extruded position
    const topPoints = verts.map(v => vec3.add(v.position, offset));

    // Also show vertical guide lines from original to extruded
    const lines = verts.map(v => ({
      from: v.position,
      to: vec3.add(v.position, offset),
    }));

    return { polygon: topPoints, lines };
  }

  // ── Private ────────────────────────────────────────────

  /** Newell's method — compute normal from current vertex positions */
  private computeNormalFromPositions(positions: Vec3[]): Vec3 {
    const n: Vec3 = { x: 0, y: 0, z: 0 };
    const len = positions.length;
    for (let i = 0; i < len; i++) {
      const curr = positions[i];
      const next = positions[(i + 1) % len];
      n.x += (curr.y - next.y) * (curr.z + next.z);
      n.y += (curr.z - next.z) * (curr.x + next.x);
      n.z += (curr.x - next.x) * (curr.y + next.y);
    }
    return vec3.normalize(n);
  }

  private setViewportCursor(isPointer: boolean): void {
    // globalThis-guarded: tools are also instantiated in headless tests
    const container = (globalThis as any).document?.querySelector?.('.viewport-container');
    if (container) {
      container.style.cursor = isPointer ? this.cursor : 'crosshair';
    }
  }

  private startOnFace(face: IFace, event: ToolMouseEvent | null): void {
    this.selectedFaceId = face.id;

    // Recompute normal from current vertex positions — the stored face.normal
    // may be stale if vertices were moved by rotate/move/scale tools.
    const verts = this.document.geometry.getFaceVertices(face.id);
    let normal: Vec3;
    let centroid: Vec3 = { x: 0, y: 0, z: 0 };
    if (verts.length >= 3) {
      const positions = verts.map(v => v.position);
      normal = this.computeNormalFromPositions(positions);
      for (const p of positions) { centroid.x += p.x; centroid.y += p.y; centroid.z += p.z; }
      centroid.x /= positions.length; centroid.y /= positions.length; centroid.z /= positions.length;
    } else {
      normal = vec3.clone(face.normal);
    }
    const len = vec3.length(normal);
    if (len > 0) normal = vec3.div(normal, len);
    this.faceNormal = normal;
    this.faceAnchor = centroid;

    // Capture the cursor's initial parametric position along the normal axis so
    // currentDistance starts at zero regardless of where on the face the user clicked.
    if (event) {
      const t = this.cursorAxisT(event.screenX, event.screenY, centroid, normal);
      this.startT = t ?? 0;
    } else {
      this.startT = 0;
    }
    this.currentDistance = 0;
    this.lastSnappedT = null;
    this.beginTransaction('Push/Pull');
    this.setPhase('drawing');
  }

  private reset(): void {
    this.forceNewWalls = false;
    this.selectedFaceId = null;
    this.faceNormal = null;
    this.faceAnchor = null;
    this.startT = 0;
    this.currentDistance = 0;
    this.lastSnappedT = null;
    this.setPhase('idle');
    this.setVCBValue('');
  }

  /**
   * Check if a face already has side walls on ALL edges — meaning it's
   * part of an existing 3D solid from a previous push/pull. Only then
   * should we move vertices instead of creating new geometry.
   *
   * DraftDown behavior: the first push/pull always creates new side faces.
   * Only subsequent push/pulls on the same face (which now has side walls)
   * will stretch existing walls by moving vertices.
   */
  private hasSideWalls(faceId: string, normal: Vec3): boolean {
    const faceEdges = this.document.geometry.getFaceEdges(faceId);
    if (faceEdges.length === 0) return false;

    // The face only stretch-moves (3D mode) when it is a true cap of a solid:
    // EVERY boundary edge must have a perpendicular adjacent wall. A face with
    // only some walled edges (e.g. one triangle of a divided cube face) must
    // extrude new geometry instead — stretching would drag the shared
    // vertices and deform the neighbors.
    for (const edge of faceEdges) {
      const adjacentFaces = this.document.geometry.getEdgeFaces(edge.id);
      let hasPerpWall = false;
      for (const adj of adjacentFaces) {
        if (adj.id === faceId) continue;
        const adjVerts = this.document.geometry.getFaceVertices(adj.id);
        let adjNormal = adj.normal;
        if (adjVerts.length >= 3) {
          adjNormal = this.computeNormalFromPositions(adjVerts.map(v => v.position));
        }
        // Perpendicular wall: dot product with push direction ≈ 0.
        if (Math.abs(vec3.dot(adjNormal, normal)) < 0.3) { hasPerpWall = true; break; }
      }
      if (!hasPerpWall) return false;
    }
    return true;
  }

  /** True when another face occupies the same plane and touches this face's
   *  boundary (shares a vertex, or hosts it as a hole ring) — i.e. the face
   *  is a sub-region of a larger planar arrangement, not an isolated face. */
  private isCoplanarEmbedded(face: IFace): boolean {
    const geo = this.document.geometry;
    const mesh = geo.getMesh();
    if (mesh.faces.size > 5000) return false;
    const n = this.faceNormal!;
    const verts = geo.getFaceVertices(face.id);
    if (verts.length === 0) return false;
    const d = vec3.dot(n, verts[0].position);
    const boundary = new Set(face.vertexIds);

    for (const [otherId, other] of mesh.faces) {
      if (otherId === face.id) continue;
      const otherVerts = geo.getFaceVertices(otherId);
      if (otherVerts.length === 0) continue;
      let coplanar = true;
      for (const v of otherVerts) {
        if (Math.abs(vec3.dot(n, v.position) - d) > 1e-3) { coplanar = false; break; }
      }
      if (!coplanar) continue;
      // Touching: shares a boundary vertex (covers hole-host faces too, since
      // hole rings live in the host's vertexIds)
      for (const vid of other.vertexIds) {
        if (boundary.has(vid)) return true;
      }
    }
    return false;
  }

  /** If the freshly created cap face landed on a PRE-EXISTING coplanar face
   *  (push-through), remove the membrane: createFace's containment check has
   *  already punched the hole in the larger face, so deleting the cap leaves
   *  an opening. When the landing face has the exact same boundary, both are
   *  removed (the planes merge away). */
  private removeMembraneIfLandedOnFace(capId: string): void {
    const geo = this.document.geometry;
    const mesh = geo.getMesh();
    const cap = geo.getFace(capId);
    if (!cap) return;
    const capVerts = geo.getFaceVertices(capId);
    if (capVerts.length < 3) return;
    const n = vec3.normalize(cap.normal);
    const d = vec3.dot(n, capVerts[0].position);
    const posKey = (p: { x: number; y: number; z: number }) =>
      `${p.x.toFixed(4)}|${p.y.toFixed(4)}|${p.z.toFixed(4)}`;
    const capPositions = new Set(capVerts.map(v => posKey(v.position)));

    for (const [otherId, other] of mesh.faces) {
      if (otherId === capId) continue;
      if (otherId === this.selectedFaceId) continue;
      const otherVerts = geo.getFaceVertices(otherId);
      if (otherVerts.length < 3) continue;
      const on = vec3.normalize(other.normal);
      if (Math.abs(vec3.dot(n, on)) < 0.999) continue;
      let coplanar = true;
      for (const v of otherVerts) {
        if (Math.abs(vec3.dot(n, v.position) - d) > 1e-3) { coplanar = false; break; }
      }
      if (!coplanar) continue;

      // Exact same boundary → both faces vanish (volume merged through)
      const outerEnd = other.holeStartIndices?.[0] ?? other.vertexIds.length;
      const otherOuter = otherVerts.slice(0, outerEnd);
      const sameLoop = otherOuter.length === capVerts.length &&
        otherOuter.every(v => capPositions.has(posKey(v.position)));
      if (sameLoop) {
        geo.deleteFace(otherId);
        geo.deleteFace(capId);
        return;
      }

      // Landed inside a larger face → hole was punched by createFace's
      // containment pass; drop the membrane to leave the opening.
      if (other.holeStartIndices?.length) {
        geo.deleteFace(capId);
        return;
      }

      // Cap touches the landing face's boundary (a door, not a window):
      // split the landing face along the cap's ring, then remove both the
      // matching region and the cap — leaving the opening.
      const ring = cap.vertexIds.slice(0, cap.holeStartIndices?.[0] ?? cap.vertexIds.length);
      for (let r = 0; r < ring.length; r++) {
        (geo as any).splitFaceWithPath?.([...ring.slice(r), ...ring.slice(0, r)]);
      }
      // Find the split-off region whose outer ring matches the cap positions
      for (const [fid2, f2] of mesh.faces) {
        if (fid2 === capId) continue;
        const v2 = geo.getFaceVertices(fid2);
        const outer2 = v2.slice(0, f2.holeStartIndices?.[0] ?? v2.length);
        if (outer2.length !== capVerts.length) continue;
        if (outer2.every(v => capPositions.has(posKey(v.position)))) {
          geo.deleteFace(fid2);
          geo.deleteFace(capId);
          return;
        }
      }
      return;
    }
  }

  /** Exact-collapse detection for the move-vertices path: every pushed vertex
   *  would land on an existing vertex of one opposite face with a matching
   *  loop. Deletes the pushed face + swept geometry, keeping the opposite
   *  face. Returns true when the collapse happened. */
  private tryCollapseOntoOppositeFace(
    faceVertices: Array<{ id: string; position: Vec3 }>, offset: Vec3,
  ): boolean {
    const geo = this.document.geometry;
    const mesh = geo.getMesh();
    if (mesh.vertices.size > 5000) return false;

    const posKey = (p: Vec3) => `${p.x.toFixed(4)}|${p.y.toFixed(4)}|${p.z.toFixed(4)}`;
    const existing = new Map<string, string>();
    const movedIds = new Set(faceVertices.map(v => v.id));
    for (const [vid, v] of mesh.vertices) {
      if (!movedIds.has(vid)) existing.set(posKey(v.position), vid);
    }

    const landedIds: string[] = [];
    for (const v of faceVertices) {
      const target = vec3.add(v.position, offset);
      const hit = existing.get(posKey(target));
      if (!hit) return false;
      landedIds.push(hit);
    }

    // The landed vertices must form a single existing face (the opposite cap)
    const landedSet = new Set(landedIds);
    let opposite: string | null = null;
    for (const [fid, f] of mesh.faces) {
      if (fid === this.selectedFaceId) continue;
      if (f.vertexIds.length !== landedIds.length) continue;
      if (f.vertexIds.every(vid => landedSet.has(vid))) { opposite = fid; break; }
    }
    if (!opposite) return false;

    // Delete the swept volume: removing the pushed face's vertices cascades
    // through its boundary edges and side walls. The opposite face survives.
    for (const v of [...faceVertices]) {
      geo.deleteVertex(v.id);
    }
    return true;
  }

  /** Snap the commit distance onto a parallel face plane when within
   *  tolerance (1% of the travel, min 5mm). Mirrors classic CAD committing the
   *  inferred depth even when the cursor drifted off the inference. */
  private snapDistanceToParallelPlanes(distance: number): number {
    if (!this.faceAnchor || !this.faceNormal || Math.abs(distance) < 1e-9) return distance;
    const geo = this.document.geometry;
    const mesh = geo.getMesh();
    if (mesh.faces.size > 5000) return distance;

    const n = this.faceNormal;
    const tol = Math.max(0.005, Math.abs(distance) * 0.02);
    let best = distance;
    let bestDelta = tol;

    for (const [fid, f] of mesh.faces) {
      if (fid === this.selectedFaceId) continue;
      if (Math.abs(vec3.dot(vec3.normalize(f.normal), n)) < 0.999) continue;
      const verts = geo.getFaceVertices(fid);
      if (verts.length < 3) continue;
      // Plane offset along the push axis, relative to the anchor
      const t = vec3.dot(vec3.sub(verts[0].position, this.faceAnchor), n);
      if (Math.abs(t) < 1e-9) continue; // own plane
      if (Math.sign(t) !== Math.sign(distance)) continue;
      const delta = Math.abs(distance - t);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = t;
      }
    }
    return best;
  }

  private commitExtrusion(): void {
    if (!this.selectedFaceId || !this.faceNormal || Math.abs(this.currentDistance) < 1e-10) {
      this.abortTransaction();
      this.reset();
      this.setStatus('Push/Pull cancelled (zero distance). Click on a face.');
      return;
    }

    const faceVertices = this.document.geometry.getFaceVertices(this.selectedFaceId);
    if (faceVertices.length < 3) {
      this.abortTransaction();
      this.reset();
      this.setStatus('Invalid face. Click on a face to push/pull.');
      return;
    }

    // Commit-time plane landing: if the pushed face would stop just short of
    // (or just past) a parallel face's plane, snap the distance exactly onto
    // it. Otherwise a hand-dragged push that misses the depth inference by a
    // hair leaves a sliver — the tunnel reads as "two faces over the door".
    this.currentDistance = this.snapDistanceToParallelPlanes(this.currentDistance);

    const offset = vec3.mul(this.faceNormal, this.currentDistance);

    const face = this.document.geometry.getFace(this.selectedFaceId);
    if (!face) {
      this.abortTransaction();
      this.reset();
      return;
    }

    // A face sharing its plane with other geometry (the other half of a
    // divided face, a pane in a wall) must NEVER stretch-move its vertices —
    // they're shared with the siblings and the whole arrangement would drag.
    const embedded = this.isCoplanarEmbedded(face);

    if (!this.forceNewWalls && !embedded && this.hasSideWalls(this.selectedFaceId, this.faceNormal)) {
      // classic CAD collapse: pushing the face EXACTLY onto the solid's opposite
      // face removes the volume — the pushed face, its walls, and the swept
      // edges all vanish, leaving the opposite face flat.
      if (this.tryCollapseOntoOppositeFace(faceVertices, offset)) {
        this.lastCommittedDistance = this.currentDistance;
        this.commitTransaction();
        this.document.selection.clear();
        this.reset();
        this.setStatus('Volume collapsed.');
        return;
      }
      // 3D mode: just move existing vertices, side walls stretch automatically
      for (const v of faceVertices) {
        v.position = vec3.add(v.position, offset);
      }
    } else {
      // 2D mode: extrude — create side walls and top cap
      // Build vertex map: original ID → extruded vertex ID. WELD onto any
      // existing vertex at the landing position: extruding flush against
      // existing geometry (e.g. the second half of a divided face pulled to
      // the same height) must stitch into it, not build a coincident-but-
      // disconnected copy (duplicate membranes, doubled edges). Tolerance is
      // tight — snapDistanceToParallelPlanes makes flush landings exact —
      // so tiny legitimate extrusions never weld onto their own base.
      const WELD_EPS = 1e-6;
      const mesh = this.document.geometry.getMesh();
      const vertexMap = new Map<string, string>();
      for (const v of faceVertices) {
        const newPos = vec3.add(v.position, offset);
        let landedId: string | null = null;
        for (const [vid, existing] of mesh.vertices) {
          if (vec3.distance(existing.position, newPos) < WELD_EPS) { landedId = vid; break; }
        }
        vertexMap.set(v.id, landedId ?? this.document.geometry.createVertex(newPos).id);
      }

      // Split vertexIds into separate loops (outer boundary + holes)
      const allVertexIds = face.vertexIds;
      const holeStarts = face.holeStartIndices && face.holeStartIndices.length > 0
        ? [...face.holeStartIndices].sort((a, b) => a - b)
        : [];
      const loopBounds = [0, ...holeStarts, allVertexIds.length];
      const loops: string[][] = [];
      for (let li = 0; li < loopBounds.length - 1; li++) {
        loops.push(allVertexIds.slice(loopBounds[li], loopBounds[li + 1]));
      }

      // Create side walls for each loop
      for (let li = 0; li < loops.length; li++) {
        const loop = loops[li];
        const isHole = li > 0;

        for (let i = 0; i < loop.length; i++) {
          const next = (i + 1) % loop.length;
          const bottomA = loop[i];
          const bottomB = loop[next];
          const topA = vertexMap.get(bottomA)!;
          const topB = vertexMap.get(bottomB)!;

          this.document.geometry.createEdge(bottomA, topA);
          this.document.geometry.createEdge(topA, topB);
          if (i === loop.length - 1) {
            this.document.geometry.createEdge(bottomB, topB);
          }

          // Reverse winding for holes so normals face into the opening
          if (isHole) {
            this.document.geometry.createFace([bottomA, topA, topB, bottomB]);
          } else {
            this.document.geometry.createFace([bottomA, bottomB, topB, topA]);
          }
        }
      }

      // Create the top cap face (outer loop only, then append holes)
      const outerLoop = loops[0];
      const topCapOuter = outerLoop.map(vid => vertexMap.get(vid)!);
      const topFace = this.document.geometry.createFace(topCapOuter);

      if (loops.length > 1) {
        for (let li = 1; li < loops.length; li++) {
          const holeStart = topFace.vertexIds.length;
          const topHoleVerts = loops[li].map(vid => vertexMap.get(vid)!);
          topFace.vertexIds.push(...topHoleVerts);
          if (!topFace.holeStartIndices) topFace.holeStartIndices = [];
          topFace.holeStartIndices.push(holeStart);
        }
        topFace.generation = Date.now();
      }

      if (embedded) {
        this.document.geometry.deleteFace(face.id);
      }

      // classic CAD push-through: when the moved face lands on another face's
      // plane, the surrounding face gets a hole (createFace's containment
      // check punched it) and the membrane is removed — leaving an opening.
      this.removeMembraneIfLandedOnFace(topFace.id);
    }

    const committedFaceId = this.selectedFaceId;
    const committedSign = this.currentDistance < 0 ? -1 : 1;
    this.lastCommittedDistance = this.currentDistance;

    this.commitTransaction();
    this.document.selection.clear();
    this.reset();
    this.setStatus('Push/Pull complete! Type a distance to redo, or click another face.');

    this.redoLastOp = (value: string) => {
      const d = this.parseDistance(value);
      if (isNaN(d) || d === 0) return false;
      const newDistance = d < 0 ? d : d * committedSign;
      this.document.history.undo();
      const face = this.document.geometry.getFace(committedFaceId!);
      if (!face) return false;
      this.startOnFace(face, null); // begins a fresh transaction
      this.currentDistance = newDistance;
      this.commitExtrusion();      // commits, resets, re-arms redo
      return true;
    };
  }
}
