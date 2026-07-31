// @archigraph engine.geometry
// Implementation of IGeometryEngine using half-edge B-Rep topology

import { v4 as uuid } from 'uuid';
import {
  IVertex, IEdge, IFace, IHalfEdge, IMesh, IGeometryEngine,
} from '../../src/core/interfaces';
import { Vec3, Ray, BoundingBox, Plane } from '../../src/core/types';
import { vec3, ray as rayUtil, bbox, EPSILON } from '../../src/core/math';
import { HalfEdgeMesh } from '../mesh.halfedge/HalfEdgeMesh';
import { SpatialGrid } from './SpatialGrid';

// ─── Binary format constants ────────────────────────────────────
const MAGIC = 0x534B4347; // 'SKCG'
const VERSION = 2;

// Vertex hit radius for raycasting (world units)
const VERTEX_HIT_RADIUS = 0.05;
// Geometric weld tolerance (world units = meters): distance at which a point
// is considered ON an existing vertex/segment during draw-time intersection,
// T-junction healing, and ring expansion. Coordinates reaching these paths
// come from snaps or exact math, so this can be tight — it MUST stay well
// below the smallest edge users draw (a 1" radius circle has ~6.6mm chords;
// the old 1cm tolerance welded adjacent circle vertices into degenerate rings).
const WELD_TOL = 0.001;
// Edge hit radius for raycasting (world units)
const EDGE_HIT_RADIUS = 0.02;

/**
 * Geometry engine implementing B-Rep via half-edge mesh topology.
 * All entity IDs are UUIDs. Float64 precision throughout.
 */
export class GeometryEngine implements IGeometryEngine {
  private mesh: HalfEdgeMesh;
  /** Lazy spatial index for large-model scans (snap, draw-time welds). */
  readonly spatialGrid = new SpatialGrid();

  /** Edge-count threshold above which scans go through the spatial grid. */
  static readonly GRID_THRESHOLD = 2000;

  /**
   * Optional guard: returns true if the given face/edge ID is in a protected component
   * and should NOT be intersected/split by new geometry.
   * Set by Application after scene manager is initialized.
   */
  isProtectedEntity: ((entityId: string) => boolean) | null = null;

  /**
   * Optional callback fired after a face is split into one or more children.
   * The parent's material assignment, layer, etc. live outside the engine, so
   * external managers (MaterialManager, SceneManager) hook this to carry that
   * state over to the children.
   */
  onFaceSplit: ((parentId: string, childIds: string[]) => void) | null = null;

  constructor() {
    this.mesh = new HalfEdgeMesh();
  }

  /** Expose internal mesh for delta-based undo/redo wiring. */
  getInternalMesh(): HalfEdgeMesh {
    return this.mesh;
  }

  // ─── Create operations ──────────────────────────────────────────

  createVertex(position: Vec3): IVertex {
    return this.mesh.addVertex(position);
  }

  /**
   * Ring layout of a face's vertexIds: the outer boundary plus one entry per
   * hole. holeStartIndices are offsets into vertexIds; each ring wraps onto
   * its own start — NEVER onto the next ring (treating vertexIds as one big
   * ring pairs a hole's last vertex with the outer ring's first, which is not
   * a real boundary segment).
   */
  private faceRings(face: IFace): Array<{ start: number; end: number }> {
    const n = face.vertexIds.length;
    const holes = face.holeStartIndices ?? [];
    const starts = [0, ...holes];
    return starts.map((start, i) => ({
      start,
      end: i + 1 < starts.length ? starts[i + 1] : n,
    }));
  }

  // ─── Intentionally-deleted face tracking ─────────────────────────
  // classic CAD semantics: deleting a face leaves a hole even though its edge
  // loop still closes. Without this, auto-face creation (autoCreateFaces /
  // tryAutoFaceForEdge) would immediately re-create the face. A suppressed
  // loop is healed when the user draws an edge between two of its vertices
  // (the classic CAD "retrace to re-form the face" gesture) or creates the
  // face explicitly. In-memory only — not serialized.
  private suppressedFaceLoops = new Map<string, Set<string>>();

  private static loopKey(vertexIds: string[]): string {
    return [...vertexIds].sort().join('|');
  }

  /** Forget suppressed loops containing BOTH vertices — the heal gesture. */
  private unsuppressLoopsContaining(v1Id: string, v2Id: string): void {
    for (const [key, verts] of this.suppressedFaceLoops) {
      if (verts.has(v1Id) && verts.has(v2Id)) {
        this.suppressedFaceLoops.delete(key);
      }
    }
  }

  createEdge(v1Id: string, v2Id: string): IEdge {
    // Guard: no self-edges
    if (v1Id === v2Id) throw new Error('Cannot create edge between a vertex and itself');

    const v1 = this.mesh.vertices.get(v1Id);
    const v2 = this.mesh.vertices.get(v2Id);
    if (!v1) throw new Error(`Vertex ${v1Id} not found`);
    if (!v2) throw new Error(`Vertex ${v2Id} not found`);

    // Drawing an edge between two vertices of an intentionally-deleted face's
    // loop (including retracing an existing boundary edge) heals the loop so
    // auto-face creation may re-form the face.
    this.unsuppressLoopsContaining(v1Id, v2Id);

    // Guard: no zero-length edges
    const dx = v1.position.x - v2.position.x;
    const dy = v1.position.y - v2.position.y;
    const dz = v1.position.z - v2.position.z;
    if (dx * dx + dy * dy + dz * dz < 1e-10) {
      throw new Error('Cannot create zero-length edge');
    }

    // Check if edge already exists
    const existing = this.mesh.findEdgeBetween(v1Id, v2Id);
    if (existing) return existing;

    return this.mesh.addEdge(v1Id, v2Id);
  }

  /**
   * Create an edge AND check if it completes a closed coplanar loop.
   * If so, automatically create a face. Call this from tools like LineTool
   * that want native auto-face behavior.
   */
  createEdgeWithAutoFace(v1Id: string, v2Id: string): IEdge {
    // Guard against self-edges or zero-length
    if (v1Id === v2Id) {
      // Return existing edge if any, otherwise throw
      const existing = this.mesh.findEdgeBetween(v1Id, v2Id);
      if (existing) return existing;
      throw new Error('Cannot create self-edge');
    }
    const v1 = this.mesh.vertices.get(v1Id);
    const v2 = this.mesh.vertices.get(v2Id);
    if (v1 && v2 && vec3.distanceSq(v1.position, v2.position) < 1e-10) {
      const existing = this.mesh.findEdgeBetween(v1Id, v2Id);
      if (existing) return existing;
      throw new Error('Cannot create zero-length edge');
    }

    // Check for face bisection BEFORE creating the edge
    const bisectedFaceId = this.findBisectedFace(v1Id, v2Id);

    const edge = this.createEdge(v1Id, v2Id);

    // If this edge bisects an existing face, split it
    if (bisectedFaceId) {
      this.splitFaceWithEdge(bisectedFaceId, v1Id, v2Id);
    }

    // Also try to auto-create new faces from closed loops
    this.autoCreateFaces(v1Id, v2Id);

    return edge;
  }

  /**
   * Create an edge from v1 to v2, detecting intersections with existing face boundary edges.
   * At each intersection, a new vertex is created, the boundary edge is split, and the face
   * boundary is updated. After all intersections are processed, edges are created between
   * consecutive intersection points, and faces are split/auto-created.
   * This is the core DraftDown behavior for drawing on existing geometry.
   */
  createEdgeWithIntersection(v1Id: string, v2Id: string): IEdge[] {
    const v1 = this.mesh.vertices.get(v1Id);
    const v2 = this.mesh.vertices.get(v2Id);
    if (!v1 || !v2) throw new Error('Vertex not found');
    if (v1Id === v2Id) throw new Error('Cannot create self-edge');

    // T-junction healing at draw time: an endpoint landing in the MIDDLE of
    // an existing edge must split that edge — classic CAD behavior. Without
    // this, a line drawn across a face-less loop (deleted face) ends ON the
    // loop's edges without connecting to them, so no sub-loop can close and
    // no face forms. (When a face exists, splitFaceWithPath used to mask
    // this by inserting the endpoints into the face boundary.)
    this.splitEdgesThroughVertex(v1Id);
    this.splitEdgesThroughVertex(v2Id);

    const p1 = v1.position;
    const p2 = v2.position;

    // Collect intersection points along the segment p1→p2
    const intersections: Array<{ t: number; vertexId: string }> = [];

    // Test EVERY existing edge — not just face boundary edges. classic CAD
    // semantics: a drawn edge splits any edge it crosses, loose lines
    // included. Without this, a rectangle crossing loose edges never gets
    // shared vertices at the crossings, so no region loop can close and no
    // face forms. Snapshot IDs: splits add new half-edges mid-iteration.
    // Large models go through the spatial grid instead of a full scan.
    let edgeIds: string[];
    if (this.mesh.edges.size > GeometryEngine.GRID_THRESHOLD) {
      this.spatialGrid.ensureFresh(this.mesh as any);
      const segMin = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), z: Math.min(p1.z, p2.z) };
      const segMax = { x: Math.max(p1.x, p2.x), y: Math.max(p1.y, p2.y), z: Math.max(p1.z, p2.z) };
      edgeIds = [...this.spatialGrid.queryAABBEdges(segMin, segMax, 0.1)];
    } else {
      edgeIds = [...this.mesh.edges.keys()];
    }
    const bbMinX = Math.min(p1.x, p2.x) - 0.1, bbMaxX = Math.max(p1.x, p2.x) + 0.1;
    const bbMinY = Math.min(p1.y, p2.y) - 0.1, bbMaxY = Math.max(p1.y, p2.y) + 0.1;
    const bbMinZ = Math.min(p1.z, p2.z) - 0.1, bbMaxZ = Math.max(p1.z, p2.z) + 0.1;

    for (const edgeId of edgeIds) {
      // Skip edges in protected components
      if (this.isProtectedEntity?.(edgeId)) continue;

      const edge = this.mesh.edges.get(edgeId);
      if (!edge) continue;
      const vaId = edge.startVertexId;
      const vbId = edge.endVertexId;

      // Skip edges that share a vertex with the new edge
      if (vaId === v1Id || vaId === v2Id || vbId === v1Id || vbId === v2Id) continue;

      const va = this.mesh.vertices.get(vaId);
      const vb = this.mesh.vertices.get(vbId);
      if (!va || !vb) continue;

      // Fast bbox rejection against the new segment
      if ((va.position.x < bbMinX && vb.position.x < bbMinX) ||
          (va.position.x > bbMaxX && vb.position.x > bbMaxX) ||
          (va.position.y < bbMinY && vb.position.y < bbMinY) ||
          (va.position.y > bbMaxY && vb.position.y > bbMaxY) ||
          (va.position.z < bbMinZ && vb.position.z < bbMinZ) ||
          (va.position.z > bbMaxZ && vb.position.z > bbMaxZ)) {
        continue;
      }

      const result = this.segmentIntersect2D(p1, p2, va.position, vb.position);
      if (!result) continue;

      // Check if there's already an intersection vertex nearby
      const intPoint = vec3.add(p1, vec3.mul(vec3.sub(p2, p1), result.t1));
      let existingId: string | null = null;
      for (const int of intersections) {
        const existing = this.mesh.vertices.get(int.vertexId);
        if (existing && vec3.distance(existing.position, intPoint) < 0.01) {
          existingId = int.vertexId;
          break;
        }
      }
      // Also check existing vertices
      if (!existingId) {
        for (const [vid, vert] of this.mesh.vertices) {
          if (vec3.distance(vert.position, intPoint) < 0.01) {
            existingId = vid;
            break;
          }
        }
      }

      const intVertexId = existingId ?? this.mesh.addVertex(intPoint).id;

      if (!existingId) {
        // Split the crossed edge at this point. splitEdgeAtVertex keeps the
        // half-edge topology intact (re-links face half-edges to the two new
        // edges and inserts the vertex into dependent faces' boundaries), so
        // deleting either half later still deletes the face — classic CAD behavior.
        this.mesh.splitEdgeAtVertex(edgeId, intVertexId);
        this.insertVertexIntoAdjacentFaceBoundaries(vaId, vbId, intVertexId);
      }

      // Avoid duplicate intersections at the same t
      if (!intersections.some(x => Math.abs(x.t - result.t1) < 1e-6)) {
        intersections.push({ t: result.t1, vertexId: intVertexId });
      }
    }

    // Detect existing vertices that lie ON the new segment (line-through-point).
    // Drawing a line through an existing vertex must split the line at that vertex,
    // creating a chain v1 → V → v2 instead of a single edge that ignores the midpoint.
    // Hot path: scalar math + segment bbox prune to avoid Vec3 allocations on large meshes.
    const tScan0 = performance.now();
    const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
    const segLenSq = dx * dx + dy * dy + dz * dz;
    if (segLenSq > 1e-12) {
      const onSegTolSq = WELD_TOL * WELD_TOL;
      const tEpsilon = 1e-4;
      const minX = Math.min(p1.x, p2.x) - 0.01, maxX = Math.max(p1.x, p2.x) + 0.01;
      const minY = Math.min(p1.y, p2.y) - 0.01, maxY = Math.max(p1.y, p2.y) + 0.01;
      const minZ = Math.min(p1.z, p2.z) - 0.01, maxZ = Math.max(p1.z, p2.z) + 0.01;
      const protect = this.isProtectedEntity;
      let vertexEntries: Iterable<[string, IVertex]>;
      if (this.mesh.vertices.size > GeometryEngine.GRID_THRESHOLD) {
        this.spatialGrid.ensureFresh(this.mesh as any);
        const ids = this.spatialGrid.queryAABBVertices(
          { x: minX, y: minY, z: minZ }, { x: maxX, y: maxY, z: maxZ }, 0.05,
        );
        const list: Array<[string, IVertex]> = [];
        for (const id of ids) {
          const v = this.mesh.vertices.get(id);
          if (v) list.push([id, v]);
        }
        vertexEntries = list;
      } else {
        vertexEntries = this.mesh.vertices;
      }
      for (const [vid, vert] of vertexEntries) {
        if (vid === v1Id || vid === v2Id) continue;
        const px = vert.position.x, py = vert.position.y, pz = vert.position.z;
        if (px < minX || px > maxX || py < minY || py > maxY || pz < minZ || pz > maxZ) continue;
        // Skip vertices inside protected components — they must never become chain junctions.
        if (protect && protect(vid)) continue;
        const ex = px - p1.x, ey = py - p1.y, ez = pz - p1.z;
        const t = (ex * dx + ey * dy + ez * dz) / segLenSq;
        if (t <= tEpsilon || t >= 1 - tEpsilon) continue;
        const cx = p1.x + t * dx, cy = p1.y + t * dy, cz = p1.z + t * dz;
        const ddx = px - cx, ddy = py - cy, ddz = pz - cz;
        if (ddx * ddx + ddy * ddy + ddz * ddz >= onSegTolSq) continue;
        // Skip if we already have an intersection at this parameter
        let dup = false;
        for (let k = 0; k < intersections.length; k++) {
          if (Math.abs(intersections[k].t - t) < 1e-6) { dup = true; break; }
        }
        if (!dup) intersections.push({ t, vertexId: vid });
      }
    }

    // Sort intersections by parameter t along the new edge
    intersections.sort((a, b) => a.t - b.t);

    // Build the chain of vertices: v1 → int1 → int2 → ... → v2
    const chain = [v1Id, ...intersections.map(i => i.vertexId), v2Id];

    // Create edges along the chain
    const createdEdges: IEdge[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      if (chain[i] === chain[i + 1]) continue;
      try {
        const edge = this.createEdge(chain[i], chain[i + 1]);
        createdEdges.push(edge);
      } catch (e) {
        console.warn(`[GeometryEngine.createEdgeWithIntersection] createEdge ${chain[i]}→${chain[i+1]} failed, reusing existing if any:`, e);
        const existing = this.mesh.findEdgeBetween(chain[i], chain[i + 1]);
        if (existing) createdEdges.push(existing);
      }
    }

    // Use splitFaceWithPath to handle vertices that lie on face boundary edges.
    // This splits those boundary edges, inserts the vertices into face boundaries,
    // and splits any bisected faces. This is the proven approach used by arc tools.
    const tSplit0 = performance.now();
    this.splitFaceWithPath(chain);
    const tSplit = performance.now() - tSplit0;

    // Also run auto-face detection for each segment to find closed loops
    const tAuto0 = performance.now();
    for (let i = 0; i < chain.length - 1; i++) {
      if (chain[i] === chain[i + 1]) continue;
      this.autoCreateFaces(chain[i], chain[i + 1]);
    }
    const tAuto = performance.now() - tAuto0;
    const tScan = (tSplit0 - tScan0);
    if (tSplit > 50 || tAuto > 50 || tScan > 50) {
      console.warn(`[createEdgeWithIntersection] slow: scan=${tScan.toFixed(1)}ms split=${tSplit.toFixed(1)}ms auto=${tAuto.toFixed(1)}ms · faces=${this.mesh.faces.size} verts=${this.mesh.vertices.size} chain=${chain.length}`);
    }

    return createdEdges;
  }

  /**
   * Insert a vertex into faces that reference the va→vb boundary but had no
   * half-edges on the split edge (splitEdgeAtVertex already handled the
   * linked ones — for those, va/vb are no longer adjacent). Ring-aware:
   * pairs never wrap across a hole boundary, and any hole start indices
   * after the insertion point must shift.
   */
  private insertVertexIntoAdjacentFaceBoundaries(vaId: string, vbId: string, newVertexId: string): void {
    for (const [, f] of this.mesh.faces) {
      const fv = f.vertexIds;
      let inserted = false;
      for (const ring of this.faceRings(f)) {
        for (let j = ring.start; j < ring.end && !inserted; j++) {
          const nextJ = j + 1 < ring.end ? j + 1 : ring.start;
          if ((fv[j] === vaId && fv[nextJ] === vbId) || (fv[j] === vbId && fv[nextJ] === vaId)) {
            fv.splice(j + 1, 0, newVertexId);
            if (f.holeStartIndices?.length) {
              f.holeStartIndices = f.holeStartIndices.map(hi => hi > j ? hi + 1 : hi);
            }
            inserted = true;
          }
        }
        if (inserted) break;
      }
    }
  }

  /**
   * T-junction healing: if the vertex lies strictly WITHIN an existing edge
   * (a drawn endpoint landed mid-edge), split that edge at the vertex so
   * loops passing through it can close into faces. Tight tolerance (WELD_TOL) —
   * snapped points land exactly on the edge.
   */
  private splitEdgesThroughVertex(vertexId: string): void {
    const v = this.mesh.vertices.get(vertexId);
    if (!v) return;
    const p = v.position;
    let edgeIdsToCheck: string[];
    if (this.mesh.edges.size > GeometryEngine.GRID_THRESHOLD) {
      this.spatialGrid.ensureFresh(this.mesh as any);
      edgeIdsToCheck = [...this.spatialGrid.queryAABBEdges(p, p, 0.05)];
    } else {
      edgeIdsToCheck = [...this.mesh.edges.keys()];
    }
    for (const edgeId of edgeIdsToCheck) {
      if (this.isProtectedEntity?.(edgeId)) continue;
      const edge = this.mesh.edges.get(edgeId);
      if (!edge) continue;
      if (edge.startVertexId === vertexId || edge.endVertexId === vertexId) continue;
      const a = this.mesh.vertices.get(edge.startVertexId);
      const b = this.mesh.vertices.get(edge.endVertexId);
      if (!a || !b) continue;

      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const dz = b.position.z - a.position.z;
      const lenSq = dx * dx + dy * dy + dz * dz;
      if (lenSq < 1e-12) continue;
      const t = ((p.x - a.position.x) * dx + (p.y - a.position.y) * dy + (p.z - a.position.z) * dz) / lenSq;
      // Absolute interior margin (like insertOnBoundaryVertices): the vertex
      // must sit at least WELD_TOL inside BOTH endpoints, regardless of edge
      // length — relative epsilons scale wrongly on long edges.
      const edgeLen = Math.sqrt(lenSq);
      const along = t * edgeLen;
      if (along <= WELD_TOL || along >= edgeLen - WELD_TOL) continue;
      const cx = a.position.x + t * dx, cy = a.position.y + t * dy, cz = a.position.z + t * dz;
      const ddx = p.x - cx, ddy = p.y - cy, ddz = p.z - cz;
      if (ddx * ddx + ddy * ddy + ddz * ddz >= WELD_TOL * WELD_TOL) continue;

      const vaId = edge.startVertexId, vbId = edge.endVertexId;
      this.mesh.splitEdgeAtVertex(edgeId, vertexId);
      this.insertVertexIntoAdjacentFaceBoundaries(vaId, vbId, vertexId);
    }
  }

  /**
   * 2D segment-segment intersection (ignoring Y axis, using X and Z).
   * Returns { t1, t2 } parameters along each segment, or null if no intersection.
   * Both t1 and t2 must be in (epsilon, 1-epsilon) for a proper crossing.
   */
  private segmentIntersect2D(
    a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3
  ): { t1: number; t2: number } | null {
    // Use the plane with the largest projected area for numerical stability
    const aNorm = vec3.cross(vec3.sub(a2, a1), vec3.sub(b2, b1));
    const absX = Math.abs(aNorm.x), absY = Math.abs(aNorm.y), absZ = Math.abs(aNorm.z);

    let u1: number, v1_: number, u2: number, v2_: number;
    let u3: number, v3: number, u4: number, v4: number;

    if (absY >= absX && absY >= absZ) {
      // Project onto XZ plane (most common for ground-plane geometry)
      u1 = a1.x; v1_ = a1.z; u2 = a2.x; v2_ = a2.z;
      u3 = b1.x; v3 = b1.z; u4 = b2.x; v4 = b2.z;
    } else if (absX >= absZ) {
      // Project onto YZ plane
      u1 = a1.y; v1_ = a1.z; u2 = a2.y; v2_ = a2.z;
      u3 = b1.y; v3 = b1.z; u4 = b2.y; v4 = b2.z;
    } else {
      // Project onto XY plane
      u1 = a1.x; v1_ = a1.y; u2 = a2.x; v2_ = a2.y;
      u3 = b1.x; v3 = b1.y; u4 = b2.x; v4 = b2.y;
    }

    const d1u = u2 - u1, d1v = v2_ - v1_;
    const d2u = u4 - u3, d2v = v4 - v3;

    const denom = d1u * d2v - d1v * d2u;
    if (Math.abs(denom) < 1e-10) return null; // Parallel or collinear

    const du = u3 - u1, dv = v3 - v1_;
    const t1 = (du * d2v - dv * d2u) / denom;
    const t2 = (du * d1v - dv * d1u) / denom;

    const EPS = 0.001;
    if (t1 < EPS || t1 > 1 - EPS || t2 < EPS || t2 > 1 - EPS) return null;

    // Verify the segments are coplanar (within tolerance)
    const int3d_a = vec3.add(a1, vec3.mul(vec3.sub(a2, a1), t1));
    const int3d_b = vec3.add(b1, vec3.mul(vec3.sub(b2, b1), t2));
    if (vec3.distance(int3d_a, int3d_b) > 0.1) return null; // Not coplanar

    return { t1, t2 };
  }

  /**
   * Find a face whose boundary contains both v1 and v2 (but they're not adjacent).
   * This means the new edge would bisect the face.
   */
  private findBisectedFace(v1Id: string, v2Id: string): string | null {
    for (const [faceId, face] of this.mesh.faces) {
      // Skip faces in protected components
      if (this.isProtectedEntity?.(faceId)) continue;

      const verts = face.vertexIds;
      const idx1 = verts.indexOf(v1Id);
      const idx2 = verts.indexOf(v2Id);

      if (idx1 === -1 || idx2 === -1) continue;
      if (verts.length < 4) continue; // Can't split a triangle

      // Check they're NOT adjacent (adjacent = splitting would create a degenerate face)
      const n = verts.length;
      const diff = Math.abs(idx1 - idx2);
      if (diff === 1 || diff === n - 1) continue; // Adjacent vertices

      return faceId;
    }
    return null;
  }

  /**
   * Split a face into two faces along two boundary vertices.
   * Optionally includes interior path vertices (for arc/path splitting).
   * Both v1Id and v2Id must be on the face's boundary.
   */
  private splitFaceAtBoundary(
    faceId: string, v1Id: string, v2Id: string, pathInterior: string[] = [],
  ): boolean {
    const face = this.mesh.faces.get(faceId);
    if (!face) return false;
    // Holed faces can't be split with the simple two-sides construction —
    // vertexIds mixes outer + hole rings, so side slices would capture hole
    // vertices as boundary and produce corrupt children. Leave the face
    // intact rather than corrupt it.
    if (face.holeStartIndices?.length) return false;

    // Snapshot parent material + UV info BEFORE the face is deleted, so the
    // children created from the split inherit the texture/material.
    const parentMaterialIndex = face.materialIndex;
    const parentBackMaterialIndex = face.backMaterialIndex;
    const parentUvByVertex = new Map<string, { u: number; v: number }>();
    if (face.uvs && face.uvs.length === face.vertexIds.length) {
      for (let i = 0; i < face.vertexIds.length; i++) {
        parentUvByVertex.set(face.vertexIds[i], face.uvs[i]);
      }
    }
    const uvAffine = parentUvByVertex.size >= 3
      ? this.fitUVAffine(parentUvByVertex)
      : null;

    const verts = face.vertexIds;
    const idx1 = verts.indexOf(v1Id);
    const idx2 = verts.indexOf(v2Id);
    if (idx1 === -1 || idx2 === -1) return false;

    const n = verts.length;
    const diff = Math.abs(idx1 - idx2);
    // Adjacent endpoints can't be split by a plain chord (the "chord" IS the
    // boundary edge between them) — but a path WITH interior vertices entering
    // and exiting through the same boundary edge (e.g. an arch drawn on one
    // edge) splits the face into the arch region and the remainder.
    if ((diff === 1 || diff === n - 1) && pathInterior.length === 0) return false;

    const lo = Math.min(idx1, idx2);
    const hi = Math.max(idx1, idx2);
    const isV1Lo = idx1 <= idx2;

    // Boundary side 1: vertices from lo to hi (inclusive)
    const side1: string[] = [];
    for (let i = lo; i <= hi; i++) side1.push(verts[i]);

    // Boundary side 2: vertices from hi to lo (wrapping)
    const side2: string[] = [];
    for (let i = hi; i !== lo; i = (i + 1) % n) side2.push(verts[i]);
    side2.push(verts[lo]);

    let faceA: string[];
    let faceB: string[];

    if (diff === 1 || diff === n - 1) {
      // Ring-adjacent endpoints + interior path (arch on a single edge).
      // faceA = the arch: boundary segment first→second, then the path
      // walked back from second's end to first's. faceB = the remainder of
      // the ring closed by the path walked the other way.
      const firstIdx = diff === 1 ? lo : hi;   // ring-order first of the pair
      const secondIdx = diff === 1 ? hi : lo;
      const first = verts[firstIdx];
      const second = verts[secondIdx];
      const interiorFromSecond = second === v2Id
        ? pathInterior.slice().reverse()
        : pathInterior.slice();
      const interiorFromFirst = first === v1Id
        ? pathInterior.slice()
        : pathInterior.slice().reverse();
      faceA = [first, second, ...interiorFromSecond];
      faceB = [second];
      for (let i = (secondIdx + 1) % n; i !== firstIdx; i = (i + 1) % n) faceB.push(verts[i]);
      faceB.push(first, ...interiorFromFirst);
    } else if (pathInterior.length === 0) {
      // Simple edge split — no interior vertices
      faceA = side1;
      faceB = side2;
    } else if (isV1Lo) {
      faceA = [...side1, ...pathInterior.slice().reverse()];
      faceB = [verts[lo], ...pathInterior, verts[hi]];
      for (let i = (hi + 1) % n; i !== lo; i = (i + 1) % n) faceB.push(verts[i]);
    } else {
      // v1 (path start) is at the HIGHER ring index: side1 runs lo→hi and ends
      // at the path start, so appending the interior start→end closes faceA.
      // faceB is the OTHER boundary side (hi→wrap→lo, i.e. side2) closed by
      // walking the interior back end→start. The previous code appended
      // side1's vertices to faceB instead, producing a self-crossing polygon
      // and leaving the parent face behind for one arc direction.
      faceA = [...side1, ...pathInterior.slice()];
      faceB = [...side2, ...pathInterior.slice().reverse()];
    }

    this.deleteFace(faceId);
    const childIds: string[] = [];

    const inheritFromParent = (childFace: IFace, requestedVerts: string[]) => {
      childFace.materialIndex = parentMaterialIndex;
      childFace.backMaterialIndex = parentBackMaterialIndex;
      // Build UVs aligned to childFace.vertexIds (createFace may have de-duped).
      if (parentUvByVertex.size === 0) return;
      const childUvs: Array<{ u: number; v: number }> = [];
      for (const vid of childFace.vertexIds) {
        const direct = parentUvByVertex.get(vid);
        if (direct) { childUvs.push(direct); continue; }
        if (uvAffine) {
          const v = this.mesh.vertices.get(vid);
          if (v) { childUvs.push(uvAffine(v.position)); continue; }
        }
        return; // Can't fully populate UVs — skip rather than ship broken mapping
      }
      childFace.uvs = childUvs;
    };

    if (faceA.length >= 3) {
      try {
        const newFace = this.createFace(faceA);
        inheritFromParent(newFace, faceA);
        childIds.push(newFace.id);
      } catch (e) { console.warn('[GeometryEngine.splitFaceWithPath] faceA createFace failed:', e); }
    }
    if (faceB.length >= 3) {
      try {
        const newFace = this.createFace(faceB);
        inheritFromParent(newFace, faceB);
        childIds.push(newFace.id);
      } catch (e) { console.warn('[GeometryEngine.splitFaceWithPath] faceB createFace failed:', e); }
    }
    if (childIds.length > 0) this.onFaceSplit?.(faceId, childIds);
    return true;
  }

  /**
   * Build a function that maps any 3D position on a face to UV by fitting an
   * affine transform from 3 known (vertex position, UV) pairs. Uses 2D
   * barycentric coords on the parent face's plane.
   */
  private fitUVAffine(
    uvByVertex: Map<string, { u: number; v: number }>,
  ): ((p: Vec3) => { u: number; v: number }) | null {
    const entries: Array<{ p: Vec3; uv: { u: number; v: number } }> = [];
    for (const [vid, uv] of uvByVertex) {
      const v = this.mesh.vertices.get(vid);
      if (v) entries.push({ p: v.position, uv });
      if (entries.length >= 3) break;
    }
    if (entries.length < 3) return null;
    // Pick three non-collinear anchors. If the first three are collinear, search further.
    let a = entries[0], b = entries[1], c = entries[2];
    if (entries.length > 3) {
      const cross0 = vec3.cross(vec3.sub(b.p, a.p), vec3.sub(c.p, a.p));
      if (vec3.length(cross0) < 1e-8) {
        for (let i = 3; i < entries.length; i++) {
          const trial = entries[i];
          const cross = vec3.cross(vec3.sub(b.p, a.p), vec3.sub(trial.p, a.p));
          if (vec3.length(cross) >= 1e-8) { c = trial; break; }
        }
      }
    }
    const ab = vec3.sub(b.p, a.p);
    const ac = vec3.sub(c.p, a.p);
    const dot00 = vec3.dot(ab, ab);
    const dot01 = vec3.dot(ab, ac);
    const dot11 = vec3.dot(ac, ac);
    const det = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(det) < 1e-12) return null;
    const invDet = 1 / det;
    const dub = b.uv.u - a.uv.u, dvb = b.uv.v - a.uv.v;
    const duc = c.uv.u - a.uv.u, dvc = c.uv.v - a.uv.v;
    return (p: Vec3) => {
      const ap = vec3.sub(p, a.p);
      const dot0p = vec3.dot(ab, ap);
      const dot1p = vec3.dot(ac, ap);
      const s = (dot11 * dot0p - dot01 * dot1p) * invDet;
      const t = (dot00 * dot1p - dot01 * dot0p) * invDet;
      return { u: a.uv.u + s * dub + t * duc, v: a.uv.v + s * dvb + t * dvc };
    };
  }

  /** Split a face along an edge between two boundary vertices. */
  private splitFaceWithEdge(faceId: string, v1Id: string, v2Id: string): void {
    this.splitFaceAtBoundary(faceId, v1Id, v2Id);
  }

  /**
   * After a new edge (v1, v2) is created, search for closed loops in the edge graph.
   * If a loop is found and all vertices are coplanar, create a face automatically.
   * This is the core DraftDown behavior: closing a loop of edges creates a face.
   */
  /**
   * Public hook to try auto-face detection on an existing edge — used after
   * deletions to close coplanar loops that the user uncovered. Idempotent: if
   * a face already exists for the loop, this no-ops.
   */
  tryAutoFaceForEdge(edgeId: string): void {
    const edge = this.mesh.edges.get(edgeId);
    if (!edge) return;
    this.autoCreateFaces(edge.startVertexId, edge.endVertexId);
  }

  private autoCreateFaces(v1Id: string, v2Id: string): void {
    // On large imported meshes the BFS exploration + per-loop face-creation
    // becomes O(V × deg^maxDepth). Each line-tool click invokes this per edge,
    // so a 5000-face import freezes the UI for several seconds. Bail out —
    // auto-face creation is a hand-drawing convenience; users on large models
    // can still draw lines/edges and use boolean ops to compose faces.
    if (this.mesh.faces.size > 1000) return;

    // Find short coplanar loops that include the new edge.
    // BFS from v2 to v1 through other edges, collecting paths.
    // Hard caps to prevent exponential blow-up: real face loops are short.
    const maxDepth = 8;
    const maxExplore = 5000; // total queue dequeues
    const maxLoopsFound = 200;

    const tBfs0 = performance.now();
    let exploreCount = 0;
    let truncated = false;

    const findAllLoops = (startId: string, targetId: string): string[][] => {
      const loops: string[][] = [];
      const queue: Array<{ vertexId: string; path: string[] }> = [
        { vertexId: startId, path: [startId] },
      ];

      while (queue.length > 0) {
        if (++exploreCount > maxExplore) { truncated = true; break; }
        if (loops.length > maxLoopsFound) { truncated = true; break; }
        const { vertexId, path } = queue.shift()!;
        if (path.length > maxDepth) continue;

        const edges = this.mesh.getVertexEdges(vertexId);
        for (const edge of edges) {
          if ((edge.startVertexId === v1Id && edge.endVertexId === v2Id) ||
              (edge.startVertexId === v2Id && edge.endVertexId === v1Id)) {
            continue;
          }

          const neighborId = edge.startVertexId === vertexId ? edge.endVertexId : edge.startVertexId;

          if (neighborId === targetId && path.length >= 2) {
            loops.push([...path, targetId]);
            continue;
          }

          if (!path.includes(neighborId)) {
            queue.push({ vertexId: neighborId, path: [...path, neighborId] });
          }
        }
      }
      return loops;
    };

    const loops = findAllLoops(v2Id, v1Id);
    const tBfs = performance.now() - tBfs0;
    if (tBfs > 50 || truncated) {
      console.warn(`[autoCreateFaces] BFS slow: ${tBfs.toFixed(1)}ms · explore=${exploreCount} loops=${loops.length} truncated=${truncated} faces=${this.mesh.faces.size} verts=${this.mesh.vertices.size}`);
    }

    // Sort by length (shortest first) — minimal loops are the real faces
    loops.sort((a, b) => a.length - b.length);

    const tProc0 = performance.now();
    let processed = 0, created = 0;
    for (const loop of loops) {
      processed++;
      if (loop.length < 3) continue;
      // Skip loops whose face the user intentionally deleted — the hole stays
      // until they retrace an edge or create the face explicitly.
      if (this.suppressedFaceLoops.has(GeometryEngine.loopKey(loop))) continue;
      if (!this.checkCoplanar(loop)) continue;

      // Check that no face already exists with these exact vertices
      let exists = false;
      for (const [, face] of this.mesh.faces) {
        if (face.vertexIds.length === loop.length) {
          const faceSet = new Set(face.vertexIds);
          if (loop.every(v => faceSet.has(v))) { exists = true; break; }
        }
      }
      if (exists) continue;

      // MINIMAL LOOP CHECK 1: skip if any two non-adjacent loop vertices
      // have an unprotected edge between them (a "chord").
      // Protected (component) edges don't count as chords.
      let hasChord = false;
      for (let i = 0; i < loop.length && !hasChord; i++) {
        for (let j = i + 2; j < loop.length; j++) {
          if (i === 0 && j === loop.length - 1) continue;
          const chord = this.mesh.findEdgeBetween(loop[i], loop[j]);
          if (chord && !this.isProtectedEntity?.(chord.id)) {
            hasChord = true;
            break;
          }
        }
      }
      if (hasChord) continue;

      // MINIMAL LOOP CHECK 2: skip if any coplanar vertex with edges lies
      // geometrically inside the loop polygon. Such a vertex means the loop
      // encloses smaller faces and is not minimal.
      if (this.loopContainsInteriorVertex(loop)) continue;

      // OVERLAP CHECK: skip loops that PARTIALLY overlap an existing coplanar
      // face — classic CAD never stacks faces on the same plane. The crossed
      // face gets split by splitFacesWithClosedRing instead, and its children
      // cover this loop's region. Fully-enclosed loops are still allowed:
      // they become holes via cutHoleIfEnclosed.
      if (this.loopPartiallyOverlapsExistingFace(loop)) continue;

      try {
        const newFace = this.createFace(loop);
        created++;
        // Check if this new face is entirely inside an existing coplanar face.
        // If so, cut a hole in the outer face.
        this.cutHoleIfEnclosed(newFace.id, loop);
      } catch (e) {
        console.warn('[GeometryEngine.autoCreateFaces] createFace/hole-punch failed for loop', loop, e);
      }
    }
    const tProc = performance.now() - tProc0;
    if (tProc > 50) {
      console.warn(`[autoCreateFaces] per-loop processing slow: ${tProc.toFixed(1)}ms · loops=${loops.length} processed=${processed} created=${created}`);
    }
  }

  /**
   * If a newly created face (with given vertex loop) is entirely enclosed within
   * another coplanar face, add a hole to the enclosing face (mutate in place).
   */
  private cutHoleIfEnclosed(newFaceId: string, holeLoop: string[]): void {
    const newFace = this.mesh.faces.get(newFaceId);
    if (!newFace) return;

    // Guard: this is an O(F) scan with O(holeN × outerN) per face. On large
    // imported models (thousands of faces) it dominates draw-tool latency.
    // Hand-drawing onto an existing face is the primary use case — that flow
    // typically lives in small models. Bail out for big meshes; the user can
    // explicitly punch holes via boolean ops if needed.
    if (this.mesh.faces.size > 1000) return;

    const holeNormal = newFace.normal;

    // Get positions for the hole vertices
    const holePositions = holeLoop.map(id => this.mesh.vertices.get(id)?.position).filter(Boolean) as Vec3[];
    if (holePositions.length < 3) return;

    // Pre-compute the new face's bounding box for a fast rejection test.
    let nbMinX = Infinity, nbMinY = Infinity, nbMinZ = Infinity;
    let nbMaxX = -Infinity, nbMaxY = -Infinity, nbMaxZ = -Infinity;
    for (const p of holePositions) {
      if (p.x < nbMinX) nbMinX = p.x; if (p.y < nbMinY) nbMinY = p.y; if (p.z < nbMinZ) nbMinZ = p.z;
      if (p.x > nbMaxX) nbMaxX = p.x; if (p.y > nbMaxY) nbMaxY = p.y; if (p.z > nbMaxZ) nbMaxZ = p.z;
    }

    // Compute plane of the hole
    const planeDist = vec3.dot(holeNormal, holePositions[0]);

    for (const [faceId, face] of this.mesh.faces) {
      if (faceId === newFaceId) continue;
      if (this.isProtectedEntity?.(faceId)) continue;

      // Check coplanarity
      const dot = Math.abs(
        face.normal.x * holeNormal.x + face.normal.y * holeNormal.y + face.normal.z * holeNormal.z
      );
      if (dot < 0.99) continue;

      // Check that the outer face's plane matches
      const outerVert0 = this.mesh.vertices.get(face.vertexIds[0]);
      if (!outerVert0) continue;
      const outerPlaneDist = vec3.dot(holeNormal, outerVert0.position);
      if (Math.abs(outerPlaneDist - planeDist) > 0.05) continue;

      // The hole vertices must NOT be part of the outer face's boundary
      const outerVertSet = new Set(face.vertexIds);
      if (holeLoop.some(v => outerVertSet.has(v))) continue;

      // Check that ALL hole vertices are inside the outer face's polygon
      // Only check against the outer boundary (before any existing holes)
      const outerBoundaryEnd = face.holeStartIndices?.[0] ?? face.vertexIds.length;
      const outerBoundaryVerts = face.vertexIds.slice(0, outerBoundaryEnd);
      const outerPositions = outerBoundaryVerts.map(id => this.mesh.vertices.get(id)?.position).filter(Boolean) as Vec3[];
      if (outerPositions.length < 3) continue;

      // Fast 3D bounding-box rejection — skip faces that don't even contain
      // the new face's bbox.
      let oMinX = Infinity, oMinY = Infinity, oMinZ = Infinity;
      let oMaxX = -Infinity, oMaxY = -Infinity, oMaxZ = -Infinity;
      for (const p of outerPositions) {
        if (p.x < oMinX) oMinX = p.x; if (p.y < oMinY) oMinY = p.y; if (p.z < oMinZ) oMinZ = p.z;
        if (p.x > oMaxX) oMaxX = p.x; if (p.y > oMaxY) oMaxY = p.y; if (p.z > oMaxZ) oMaxZ = p.z;
      }
      if (nbMinX < oMinX - 1e-6 || nbMinY < oMinY - 1e-6 || nbMinZ < oMinZ - 1e-6 ||
          nbMaxX > oMaxX + 1e-6 || nbMaxY > oMaxY + 1e-6 || nbMaxZ > oMaxZ + 1e-6) {
        continue;
      }

      const v01 = vec3.sub(outerPositions[1], outerPositions[0]);
      const axisU = vec3.normalize(v01);
      const axisV = vec3.normalize(vec3.cross(holeNormal, axisU));

      const outerPoly2D = outerPositions.map(p => ({
        u: vec3.dot(vec3.sub(p, outerPositions[0]), axisU),
        v: vec3.dot(vec3.sub(p, outerPositions[0]), axisV),
      }));

      let allInside = true;
      for (const hp of holePositions) {
        const pu = vec3.dot(vec3.sub(hp, outerPositions[0]), axisU);
        const pv = vec3.dot(vec3.sub(hp, outerPositions[0]), axisV);
        let inside = false;
        for (let i = 0, j = outerPoly2D.length - 1; i < outerPoly2D.length; j = i++) {
          const ui = outerPoly2D[i].u, vi = outerPoly2D[i].v;
          const uj = outerPoly2D[j].u, vj = outerPoly2D[j].v;
          if (((vi > pv) !== (vj > pv)) &&
              (pu < (uj - ui) * (pv - vi) / (vj - vi) + ui)) {
            inside = !inside;
          }
        }
        if (!inside) { allInside = false; break; }
      }

      if (!allInside) continue;

      // Found an enclosing face — replace its record (so TrackedMap captures
      // the change as a modify delta and undo can restore the original
      // vertexIds + holeStartIndices when the hole vertices get deleted).
      const holeStart = face.vertexIds.length;
      const updatedFace: IFace = {
        ...face,
        vertexIds: [...face.vertexIds, ...holeLoop],
        holeStartIndices: [...(face.holeStartIndices ?? []), holeStart],
        generation: Date.now(),
      };
      this.mesh.faces.set(faceId, updatedFace);

      return; // Only one enclosing face expected
    }
  }

  /**
   * Check if a candidate face loop contains any vertex in its interior.
   * Projects the loop and all coplanar vertices onto the loop's 2D plane,
   * then uses a ray-casting point-in-polygon test.
   */
  private loopContainsInteriorVertex(loop: string[]): boolean {
    if (loop.length < 3) return false;

    const positions = loop.map(id => {
      const v = this.mesh.vertices.get(id);
      return v ? v.position : null;
    });
    if (positions.some(p => !p)) return false;
    const pos = positions as Vec3[];

    // Compute loop plane normal via Newell's method — the first three
    // vertices are often COLLINEAR (a corner plus an intersection vertex on
    // the same straight side), and a cross-product normal from them is zero,
    // which used to silently skip this check and let overlapping faces
    // through.
    const normal = this.mesh.computePolygonNormal(pos);
    if (vec3.length(normal) < 1e-8) return false;
    const planeDist = vec3.dot(normal, pos[0]);

    // Build 2D projection axes on the plane from the first non-degenerate edge
    let axisU: Vec3 | null = null;
    for (let i = 1; i < pos.length && !axisU; i++) {
      const e = vec3.sub(pos[i], pos[0]);
      if (vec3.length(e) > 1e-8) axisU = vec3.normalize(e);
    }
    if (!axisU) return false;
    const axisV = vec3.normalize(vec3.cross(normal, axisU));

    // Project loop vertices to 2D
    const loopSet = new Set(loop);
    const poly2D = pos.map(p => ({
      u: vec3.dot(vec3.sub(p, pos[0]), axisU),
      v: vec3.dot(vec3.sub(p, pos[0]), axisV),
    }));

    // Check all mesh vertices not in the loop
    for (const [vid, vert] of this.mesh.vertices) {
      if (loopSet.has(vid)) continue;

      // Must be coplanar
      const distToPlane = Math.abs(vec3.dot(normal, vert.position) - planeDist);
      if (distToPlane > 0.05) continue;

      // Must have at least one edge (isolated vertices don't matter)
      const vertEdges = this.mesh.getVertexEdges(vid);
      if (vertEdges.length === 0) continue;

      // Skip vertices that only belong to protected components — they shouldn't
      // prevent face creation for unprotected geometry
      if (this.isProtectedEntity) {
        const allProtected = vertEdges.every(e => this.isProtectedEntity!(e.id));
        if (allProtected) continue;
      }

      // Project to 2D and do point-in-polygon test (ray casting)
      const pu = vec3.dot(vec3.sub(vert.position, pos[0]), axisU);
      const pv = vec3.dot(vec3.sub(vert.position, pos[0]), axisV);

      let inside = false;
      for (let i = 0, j = poly2D.length - 1; i < poly2D.length; j = i++) {
        const ui = poly2D[i].u, vi = poly2D[i].v;
        const uj = poly2D[j].u, vj = poly2D[j].v;
        if (((vi > pv) !== (vj > pv)) &&
            (pu < (uj - ui) * (pv - vi) / (vj - vi) + ui)) {
          inside = !inside;
        }
      }

      if (inside && this.interiorVertexDisqualifiesLoop(vid, loopSet)) return true;
    }

    return false;
  }

  /**
   * An interior vertex only disqualifies a candidate face loop when it is
   * part of real enclosed structure: a path CROSSING the loop (≥2 contacts
   * with the loop boundary — the loop would need splitting), an enclosed
   * sub-loop (cycle), or edges that already bear faces (the loop would
   * re-cover split children). A dangling tree hanging inside the loop with
   * at most one boundary contact does NOT disqualify — classic CAD forms the
   * face underneath a dangling edge.
   */
  private interiorVertexDisqualifiesLoop(startId: string, loopSet: Set<string>): boolean {
    const visited = new Set<string>([startId]);
    const visitedEdges = new Set<string>();
    const contacts = new Set<string>();
    const queue = [startId];
    let steps = 0;
    while (queue.length > 0) {
      if (++steps > 500) return true; // too large to verify — be conservative
      const vid = queue.pop()!;
      for (const edge of this.mesh.getVertexEdges(vid)) {
        if (visitedEdges.has(edge.id)) continue;
        visitedEdges.add(edge.id);
        if (this.mesh.getEdgeFaces(edge.id).length > 0) return true;
        const nid = edge.startVertexId === vid ? edge.endVertexId : edge.startVertexId;
        if (loopSet.has(nid)) {
          contacts.add(nid);
          if (contacts.size >= 2) return true; // crossing path
          continue;
        }
        if (visited.has(nid)) return true; // cycle — enclosed sub-loop
        visited.add(nid);
        queue.push(nid);
      }
    }
    return false;
  }

  /**
   * Insert any of the given vertices that lie ON this face's boundary edges
   * into the face's vertexIds (splitting the underlying edges to keep the
   * half-edge topology intact) and keep uvs aligned so the parent's texture
   * mapping survives later splits. Returns the updated boundary vertex list.
   */
  private insertOnBoundaryVertices(face: IFace, candidateIds: string[]): string[] {
    const verts = [...face.vertexIds];
    const hasParentUvs = !!(face.uvs && face.uvs.length === face.vertexIds.length);
    const uvs: Array<{ u: number; v: number }> | null = hasParentUvs ? [...face.uvs!] : null;

    for (const checkId of candidateIds) {
      if (verts.includes(checkId)) continue;

      const checkVert = this.mesh.vertices.get(checkId);
      if (!checkVert) continue;

      let inserted = false;
      for (let i = 0; i < verts.length && !inserted; i++) {
        const nextI = (i + 1) % verts.length;
        const va = this.mesh.vertices.get(verts[i]);
        const vb = this.mesh.vertices.get(verts[nextI]);
        if (!va || !vb) continue;

        const edgeDir = vec3.sub(vb.position, va.position);
        const edgeLen = vec3.length(edgeDir);
        if (edgeLen < 1e-10) continue;

        const toPoint = vec3.sub(checkVert.position, va.position);
        const t = vec3.dot(toPoint, edgeDir) / (edgeLen * edgeLen);
        // ABSOLUTE-margin interior check. The old relative slop (t up to
        // 1.01) let collinear points centimeters BEYOND a long edge's
        // endpoint pass (1% of a 4m edge = 4cm; the unclamped projection
        // distance is 0 for collinear points), splicing them into the
        // boundary past a corner and corrupting the ring with phantom edges.
        const along = t * edgeLen;
        if (along < WELD_TOL || along > edgeLen - WELD_TOL) continue;

        const closest = vec3.add(va.position, vec3.mul(edgeDir, t));
        // Weld tolerance, NOT a loose proximity: with the old 0.05 (5cm),
        // every vertex of a small shape near the boundary got spliced into
        // the host face's ring, corrupting it. Snapped/computed points land
        // exactly on the edge.
        if (vec3.distance(closest, checkVert.position) < WELD_TOL) {
          verts.splice(i + 1, 0, checkId);
          if (uvs) {
            const tc = Math.max(0, Math.min(1, t));
            const uvA = uvs[i], uvB = uvs[nextI];
            uvs.splice(i + 1, 0, {
              u: uvA.u + (uvB.u - uvA.u) * tc,
              v: uvA.v + (uvB.v - uvA.v) * tc,
            });
          }

          // The original edge was between verts[i] and the vertex now at i+2
          // Use modular indexing to handle the wrapping edge case
          const nextAfterInsert = (i + 2) % verts.length;
          const existingEdge = this.mesh.findEdgeBetween(verts[i], verts[nextAfterInsert]);
          if (existingEdge) {
            // Topology-preserving split: keeps the face's half-edges linked
            // to the two new edges so edge deletion still cascades to faces.
            this.mesh.splitEdgeAtVertex(existingEdge.id, checkId);
          }
          inserted = true;
        }
      }
    }

    face.vertexIds = verts;
    if (uvs && uvs.length === verts.length) face.uvs = uvs;
    return verts;
  }

  /**
   * True if the loop PARTIALLY overlaps an existing coplanar face — some of
   * it inside the face, some outside, or its edges properly crossing the
   * face's boundary. Fully-enclosed loops (hole punching) and loops merely
   * sharing boundary vertices/edges do NOT count.
   */
  private loopPartiallyOverlapsExistingFace(loop: string[]): boolean {
    const pos: Vec3[] = [];
    for (const id of loop) {
      const v = this.mesh.vertices.get(id);
      if (!v) return false;
      pos.push(v.position);
    }
    if (pos.length < 3) return false;
    const loopNormal = this.mesh.computePolygonNormal(pos);
    if (vec3.length(loopNormal) < 1e-8) return false;

    for (const [faceId, face] of this.mesh.faces) {
      if (this.isProtectedEntity?.(faceId)) continue;

      const outerEnd = face.holeStartIndices?.[0] ?? face.vertexIds.length;
      const outerIds = face.vertexIds.slice(0, outerEnd);
      const outer: Vec3[] = [];
      let missing = false;
      for (const vid of outerIds) {
        const v = this.mesh.vertices.get(vid);
        if (!v) { missing = true; break; }
        outer.push(v.position);
      }
      if (missing || outer.length < 3) continue;

      const faceNormal = this.mesh.computePolygonNormal(outer);
      if (vec3.length(faceNormal) < 1e-8) continue;
      if (Math.abs(vec3.dot(loopNormal, faceNormal)) < 0.99) continue;
      const planeDist = vec3.dot(faceNormal, outer[0]);
      if (Math.abs(vec3.dot(faceNormal, pos[0]) - planeDist) > 0.05) continue;

      // Loop vertices straddling the face boundary → partial overlap.
      let insideCount = 0, outsideCount = 0;
      const outerIdSet = new Set(outerIds);
      for (let i = 0; i < loop.length; i++) {
        if (outerIdSet.has(loop[i])) continue; // shared boundary vertex
        const c = this.classifyPointOnFace(pos[i], outer, faceNormal, planeDist);
        if (c === 'I') insideCount++;
        else if (c === 'O') outsideCount++;
      }
      if (insideCount > 0 && outsideCount > 0) return true;

      // Loop edges properly crossing the face's boundary edges (crossings
      // that were never split into shared vertices) → partial overlap.
      for (let i = 0; i < loop.length; i++) {
        const aId1 = loop[i], aId2 = loop[(i + 1) % loop.length];
        for (let j = 0; j < outerIds.length; j++) {
          const bId1 = outerIds[j], bId2 = outerIds[(j + 1) % outerIds.length];
          if (aId1 === bId1 || aId1 === bId2 || aId2 === bId1 || aId2 === bId2) continue;
          if (this.segmentIntersect2D(
            pos[i], pos[(i + 1) % loop.length], outer[j], outer[(j + 1) % outerIds.length],
          )) return true;
        }
      }
    }
    return false;
  }

  /**
   * Split any face that is bisected by a path of vertices (e.g., an arc from A to B).
   * If the first and last vertex of the path are both on a face boundary,
   * that face is split into two: one side includes the path, the other side
   * includes the remaining boundary vertices.
   */
  splitFaceWithPath(pathVertexIds: string[]): void {
    if (pathVertexIds.length < 2) return;

    // Same guard as autoCreateFaces: on large meshes the per-edge full-face
    // scan freezes the tool. Skip — boolean ops handle face splitting on big
    // models, and hand-drawing-into-face is a small-model workflow.
    if (this.mesh.faces.size > 1000) return;

    // Collect face IDs first to avoid mutating the map during iteration
    const faceIds = [...this.mesh.faces.keys()];

    for (const faceId of faceIds) {
      // Skip faces in protected components
      if (this.isProtectedEntity?.(faceId)) continue;

      const face = this.mesh.faces.get(faceId);
      if (!face) continue;

      // Holed faces: the boundary-insertion and two-sides split below assume
      // a single ring; running them on outer+hole vertexIds corrupts the
      // hole bookkeeping. Skip — splitting holed faces isn't supported yet.
      if (face.holeStartIndices?.length) continue;

      const verts = this.insertOnBoundaryVertices(face, pathVertexIds);

      // Find the first and last path vertices that are on this face's boundary.
      // The line may extend beyond the face, so the chain endpoints may not be
      // on the boundary — we need to find the actual entry/exit points.
      let splitStart: string | null = null;
      let splitEnd: string | null = null;
      let splitStartIdx = -1;
      let splitEndIdx = -1;

      for (let i = 0; i < pathVertexIds.length; i++) {
        if (verts.includes(pathVertexIds[i])) {
          if (splitStart === null) {
            splitStart = pathVertexIds[i];
            splitStartIdx = i;
          }
          splitEnd = pathVertexIds[i];
          splitEndIdx = i;
        }
      }

      if (!splitStart || !splitEnd || splitStart === splitEnd) continue;

      // Extract the interior path vertices between splitStart and splitEnd
      const pathInterior = pathVertexIds.slice(splitStartIdx + 1, splitEndIdx);

      // If the interior path already lies entirely ON this face's boundary,
      // the path doesn't cross the face's interior — there is nothing to
      // split. This happens for child faces created by an earlier split or
      // by auto-face detection whose boundary IS the path (re-splitting them
      // would construct a degenerate doubled-path face).
      if (pathInterior.length > 0 && pathInterior.every(v => verts.includes(v))) continue;

      // The path must genuinely bisect THIS face: every interior vertex has
      // to sit on the face's plane, strictly inside its boundary. Sharing
      // two boundary vertices is NOT enough — a push/pull cap ring touches
      // each prism wall at two corners, and splitting the wall with the
      // cap's out-of-plane interior would replace a valid quad with a bent
      // face threading the solid's interior (a face with edge-less sides).
      const boundaryPositions: Vec3[] = [];
      let missingVert = false;
      for (const vid of verts) {
        const v = this.mesh.vertices.get(vid);
        if (!v) { missingVert = true; break; }
        boundaryPositions.push(v.position);
      }
      if (missingVert || boundaryPositions.length < 3) continue;
      const faceNormal = this.mesh.computePolygonNormal(boundaryPositions);
      if (vec3.length(faceNormal) < 1e-8) continue;
      const planeDist = vec3.dot(faceNormal, boundaryPositions[0]);
      let bisectsInterior = true;
      if (pathInterior.length === 0) {
        // Bare chord: it must cross the face's interior (midpoint strictly
        // inside). Rejects chords along an existing boundary edge and chords
        // spanning a concavity outside the face.
        const a = this.mesh.vertices.get(splitStart);
        const b = this.mesh.vertices.get(splitEnd);
        if (!a || !b) continue;
        const mid = {
          x: (a.position.x + b.position.x) / 2,
          y: (a.position.y + b.position.y) / 2,
          z: (a.position.z + b.position.z) / 2,
        };
        bisectsInterior = this.classifyPointOnFace(mid, boundaryPositions, faceNormal, planeDist) === 'I';
      } else {
        for (const vid of pathInterior) {
          if (verts.includes(vid)) continue; // welded onto the boundary
          const v = this.mesh.vertices.get(vid);
          if (!v || this.classifyPointOnFace(v.position, boundaryPositions, faceNormal, planeDist) !== 'I') {
            bisectsInterior = false;
            break;
          }
        }
      }
      if (!bisectsInterior) continue;

      this.splitFaceAtBoundary(faceId, splitStart, splitEnd, pathInterior);
      // Don't return — continue checking other faces
    }
  }

  /**
   * classic CAD coplanar-merge semantics for closed shape outlines (rectangle,
   * circle, polygon): faces on the same plane must never overlap. Given the
   * ring of vertices a shape tool just drew, split EVERY existing face the
   * ring crosses, using the ring's edge-intersection vertices as entry/exit
   * points and its corners inside the face as the interior split path.
   *
   * This handles what per-segment splitFaceWithPath cannot: a ring that
   * enters a face at an intersection vertex, passes through one or more
   * corners INSIDE the face, and exits at another intersection vertex.
   * Ring vertices OUTSIDE the face are ignored (never treated as a split
   * path — doing so is what corrupted faces under the old rotation hack).
   *
   * Call AFTER the ring's edges exist (created via createEdgeWithIntersection
   * so crossings already have vertices). Returns the number of face splits
   * performed — 0 means the ring touched nothing (callers like the circle
   * tool may then safely create the full ring face themselves).
   */
  splitFacesWithClosedRing(ringVertexIds: string[]): number {
    if (ringVertexIds.length < 3) return 0;
    // Same guard as autoCreateFaces/splitFaceWithPath: hand-drawing flow only.
    if (this.mesh.faces.size > 1000) return 0;

    const ring = this.expandRingWithOnSegmentVertices(ringVertexIds);

    // Each pass performs at most one split (topology changes invalidate the
    // scan), so loop until stable. Bounded: every split consumes one
    // boundary→interior→boundary run of the ring.
    let guard = ring.length * 4 + 8;
    let splitCount = 0;
    let didSplit = true;
    while (didSplit && guard-- > 0) {
      didSplit = false;
      for (const faceId of [...this.mesh.faces.keys()]) {
        if (this.isProtectedEntity?.(faceId)) continue;
        const face = this.mesh.faces.get(faceId);
        // Holed faces can't be split (same limitation as splitFaceWithPath).
        if (!face || face.holeStartIndices?.length) continue;
        if (this.splitFaceWithRing(faceId, ring)) { didSplit = true; splitCount++; break; }
      }
    }

    // Regions of the ring OUTSIDE the faces it crossed only close into loops
    // once the splits above exist. Let auto-face detection pick them up.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (a !== b) this.autoCreateFaces(a, b);
    }

    return splitCount;
  }

  /**
   * Expand a corner ring with existing vertices lying ON its segments —
   * the edge-edge intersection vertices createEdgeWithIntersection made when
   * the ring's edges were drawn across existing geometry.
   */
  private expandRingWithOnSegmentVertices(ringVertexIds: string[]): string[] {
    const out: string[] = [];
    const n = ringVertexIds.length;
    for (let i = 0; i < n; i++) {
      const aId = ringVertexIds[i];
      const bId = ringVertexIds[(i + 1) % n];
      out.push(aId);
      const a = this.mesh.vertices.get(aId);
      const b = this.mesh.vertices.get(bId);
      if (!a || !b) continue;

      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const dz = b.position.z - a.position.z;
      const segLenSq = dx * dx + dy * dy + dz * dz;
      if (segLenSq < 1e-12) continue;

      const onSeg: Array<{ t: number; id: string }> = [];
      for (const [vid, vert] of this.mesh.vertices) {
        if (vid === aId || vid === bId) continue;
        if (this.isProtectedEntity?.(vid)) continue;
        const ex = vert.position.x - a.position.x;
        const ey = vert.position.y - a.position.y;
        const ez = vert.position.z - a.position.z;
        const t = (ex * dx + ey * dy + ez * dz) / segLenSq;
        if (t <= 1e-4 || t >= 1 - 1e-4) continue;
        const cx = a.position.x + t * dx, cy = a.position.y + t * dy, cz = a.position.z + t * dz;
        const ddx = vert.position.x - cx, ddy = vert.position.y - cy, ddz = vert.position.z - cz;
        if (ddx * ddx + ddy * ddy + ddz * ddz < WELD_TOL * WELD_TOL) onSeg.push({ t, id: vid });
      }
      onSeg.sort((p, q) => p.t - q.t);
      for (const s of onSeg) {
        if (out[out.length - 1] !== s.id) out.push(s.id);
      }
    }
    return out;
  }

  /**
   * Try to split one face along the given (expanded) ring. Classifies each
   * ring vertex against the face — on its boundary, strictly inside, or
   * outside — and splits along the first boundary→inside…→boundary run
   * (or a boundary→boundary chord whose midpoint crosses the interior).
   * Returns true if a split happened (the face was replaced by children).
   */
  private splitFaceWithRing(faceId: string, ring: string[]): boolean {
    const face = this.mesh.faces.get(faceId);
    if (!face) return false;

    // Pull ring vertices sitting ON boundary edges into the boundary first,
    // so they classify as boundary vertices below.
    const verts = this.insertOnBoundaryVertices(face, ring);
    if (verts.length < 3) return false;

    const positions: Vec3[] = [];
    for (const vid of verts) {
      const v = this.mesh.vertices.get(vid);
      if (!v) return false;
      positions.push(v.position);
    }
    const normal = this.mesh.computePolygonNormal(positions);
    if (vec3.length(normal) < 1e-8) return false;
    const planeDist = vec3.dot(normal, positions[0]);

    // B = on the face boundary, I = strictly inside, O = outside/off-plane
    const cls: Array<'B' | 'I' | 'O'> = ring.map(vid => {
      if (verts.includes(vid)) return 'B';
      const v = this.mesh.vertices.get(vid);
      if (!v) return 'O';
      return this.classifyPointOnFace(v.position, positions, normal, planeDist);
    });

    const n = ring.length;
    for (let i = 0; i < n; i++) {
      if (cls[i] !== 'B') continue;

      // boundary → inside… → boundary run
      if (cls[(i + 1) % n] === 'I') {
        const interior: string[] = [];
        let j = (i + 1) % n;
        while (cls[j] === 'I' && interior.length < n) {
          interior.push(ring[j]);
          j = (j + 1) % n;
        }
        if (cls[j] === 'B' && ring[j] !== ring[i] &&
            this.splitFaceAtBoundary(faceId, ring[i], ring[j], interior)) {
          return true;
        }
      }

      // boundary → boundary chord that cuts through the interior
      if (cls[(i + 1) % n] === 'B' && ring[(i + 1) % n] !== ring[i]) {
        const aId = ring[i], bId = ring[(i + 1) % n];
        const a = this.mesh.vertices.get(aId);
        const b = this.mesh.vertices.get(bId);
        if (!a || !b || !this.mesh.findEdgeBetween(aId, bId)) continue;
        const mid = vec3.mul(vec3.add(a.position, b.position), 0.5);
        if (this.classifyPointOnFace(mid, positions, normal, planeDist) !== 'I') continue;
        if (this.splitFaceAtBoundary(faceId, aId, bId, [])) return true;
      }
    }
    return false;
  }

  /**
   * Classify a point against a face's outer polygon: 'B' if it lies on the
   * boundary (within tolerance), 'I' if strictly inside, 'O' otherwise
   * (outside or off-plane). Tolerances match the rest of the engine (0.05).
   */
  private classifyPointOnFace(
    p: Vec3, outer: Vec3[], normal: Vec3, planeDist: number,
  ): 'B' | 'I' | 'O' {
    if (Math.abs(vec3.dot(normal, p) - planeDist) > 0.05) return 'O';

    // Near a boundary edge → boundary, not interior (a degenerate split
    // through an on-edge point corrupts the face).
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length];
      const d = vec3.sub(b, a);
      const lenSq = vec3.dot(d, d);
      if (lenSq < 1e-12) continue;
      const t = Math.max(0, Math.min(1, vec3.dot(vec3.sub(p, a), d) / lenSq));
      const closest = vec3.add(a, vec3.mul(d, t));
      // In-plane proximity must be TIGHT: with the old 0.05 (5cm), every
      // vertex of a small circle near a face edge classified as boundary,
      // producing chord-splits that duplicated the host face. Matches the
      // insertOnBoundaryVertices weld tolerance.
      if (vec3.distance(closest, p) < WELD_TOL) return 'B';
    }

    // 2D projection + ray-cast point-in-polygon
    let axisU: Vec3 | null = null;
    for (let i = 1; i < outer.length && !axisU; i++) {
      const e = vec3.sub(outer[i], outer[0]);
      if (vec3.length(e) > 1e-8) axisU = vec3.normalize(e);
    }
    if (!axisU) return 'O';
    const axisV = vec3.normalize(vec3.cross(normal, axisU));

    const pu = vec3.dot(vec3.sub(p, outer[0]), axisU);
    const pv = vec3.dot(vec3.sub(p, outer[0]), axisV);
    let inside = false;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const ui = vec3.dot(vec3.sub(outer[i], outer[0]), axisU);
      const vi = vec3.dot(vec3.sub(outer[i], outer[0]), axisV);
      const uj = vec3.dot(vec3.sub(outer[j], outer[0]), axisU);
      const vj = vec3.dot(vec3.sub(outer[j], outer[0]), axisV);
      if (((vi > pv) !== (vj > pv)) && (pu < (uj - ui) * (pv - vi) / (vj - vi) + ui)) {
        inside = !inside;
      }
    }
    return inside ? 'I' : 'O';
  }

  createFace(vertexIds: string[]): IFace {
    // Guard: remove duplicate consecutive vertices
    const cleaned: string[] = [];
    for (let i = 0; i < vertexIds.length; i++) {
      const prev = i === 0 ? vertexIds[vertexIds.length - 1] : vertexIds[i - 1];
      if (vertexIds[i] !== prev) cleaned.push(vertexIds[i]);
    }
    vertexIds = cleaned;

    if (vertexIds.length < 3) {
      throw new Error('A face requires at least 3 unique vertices');
    }

    // Guard: no duplicate vertices in face
    const uniqueSet = new Set(vertexIds);
    if (uniqueSet.size < 3) {
      throw new Error('A face requires at least 3 unique vertices');
    }

    // Explicitly creating a face overrides any "intentionally deleted" memory
    // of the same loop.
    this.suppressedFaceLoops.delete(GeometryEngine.loopKey(vertexIds));

    // Validate all vertices exist
    for (const vId of vertexIds) {
      if (!this.mesh.vertices.has(vId)) {
        throw new Error(`Vertex ${vId} not found`);
      }
    }

    // Check if a face with these exact vertices already exists.
    // Even when it does, run cutHoleIfEnclosed in case the face was created
    // moments ago by autoCreateFaces' BFS (which would have already attempted
    // the hole punch — cutHoleIfEnclosed is idempotent so re-running is safe).
    const vertSet = new Set(vertexIds);
    for (const [, existing] of this.mesh.faces) {
      if (existing.vertexIds.length === vertexIds.length ||
          existing.vertexIds.slice(0, existing.holeStartIndices?.[0] ?? existing.vertexIds.length).length === vertexIds.length) {
        const existSet = new Set(existing.vertexIds);
        if (vertexIds.every(v => existSet.has(v))) {
          try { this.cutHoleIfEnclosed(existing.id, vertexIds); } catch (e) { console.warn('[GeometryEngine.createFace] cutHoleIfEnclosed (existing) failed:', e); }
          return existing; // Face already exists, return it
        }
      }
    }

    // Reject degenerate rings: a path that doubles back on itself (distinct
    // vertex IDs at repeated positions — e.g. a sub-tolerance shape whose
    // vertices welded onto each other's segments) encloses no area and must
    // not become a face.
    const ringPositions = vertexIds.map(id => this.mesh.vertices.get(id)!.position);
    const ringNormal = this.mesh.computePolygonNormal(ringPositions);
    const ringArea = this.mesh.computePolygonArea(ringPositions, ringNormal);
    if (!(ringArea > 1e-10)) {
      throw new Error('Cannot create zero-area face (degenerate ring)');
    }

    const { face } = this.mesh.createFaceFromVertices(
      vertexIds,
      (v1, v2) => this.mesh.findEdgeBetween(v1, v2),
    );

    // If this new face is fully enclosed within an existing coplanar face,
    // punch a hole in the enclosing face so the two don't z-fight.
    // This is what DraftDown does when you draw a circle/rectangle/polygon ON
    // an existing face.
    try { this.cutHoleIfEnclosed(face.id, vertexIds); } catch (e) { console.warn('[GeometryEngine.createFace] cutHoleIfEnclosed (new) failed:', e); }

    return face;
  }

  // ─── Autofold (classic CAD) ─────────────────────────────────────────

  /**
   * classic CAD autofold: after vertices move, any adjacent face whose vertices
   * are no longer coplanar is split into triangles fanned around the moved
   * vertex, folding the surface instead of leaving an invalid non-planar
   * polygon. Fold edges are marked soft+smooth (the classic modeler's autofold look).
   * Returns the number of faces folded.
   */
  autofoldNonPlanarFaces(movedVertexIds: string[]): number {
    const moved = new Set(movedVertexIds);
    const affectedFaces = new Set<string>();
    for (const vid of movedVertexIds) {
      for (const fid of this.mesh.getVertexFaces(vid)) affectedFaces.add(fid);
    }

    let folded = 0;
    for (const faceId of affectedFaces) {
      const face = this.mesh.faces.get(faceId);
      if (!face) continue;
      if (face.holeStartIndices?.length) continue; // holed faces unsupported
      const verts = face.vertexIds;
      if (verts.length < 4) continue; // triangles are always planar

      const positions: Vec3[] = [];
      let missing = false;
      for (const vid of verts) {
        const v = this.mesh.vertices.get(vid);
        if (!v) { missing = true; break; }
        positions.push(v.position);
      }
      if (missing) continue;

      // Non-planarity vs the Newell best-fit plane. Tolerance is absolute:
      // visible folds are millimeters+, and float noise is far below 0.1mm.
      const normal = this.mesh.computePolygonNormal(positions);
      if (vec3.length(normal) < 1e-9) continue;
      const d = vec3.dot(normal, positions[0]);
      let maxDist = 0;
      for (const p of positions) {
        maxDist = Math.max(maxDist, Math.abs(vec3.dot(normal, p) - d));
      }
      if (maxDist < 1e-4) continue;

      // Fan around a moved vertex on this face (the fold radiates from the
      // vertex the user dragged); fall back to vertex 0.
      let pivotIdx = verts.findIndex(vid => moved.has(vid));
      if (pivotIdx < 0) pivotIdx = 0;

      const n = verts.length;
      const parentMaterialIndex = face.materialIndex;
      const parentBackMaterialIndex = face.backMaterialIndex;
      const preexistingEdges = new Set<string>();
      for (let i = 0; i < n; i++) {
        const e = this.mesh.findEdgeBetween(verts[i], verts[(i + 1) % n]);
        if (e) preexistingEdges.add(e.id);
      }

      this.deleteFace(faceId);
      const childIds: string[] = [];
      for (let k = 1; k < n - 1; k++) {
        const a = verts[pivotIdx];
        const b = verts[(pivotIdx + k) % n];
        const c = verts[(pivotIdx + k + 1) % n];
        try {
          const tri = this.createFace([a, b, c]);
          tri.materialIndex = parentMaterialIndex;
          tri.backMaterialIndex = parentBackMaterialIndex;
          childIds.push(tri.id);
          // Fold diagonals (new edges) are soft+smooth
          for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
            const e = this.mesh.findEdgeBetween(p, q);
            if (e && !preexistingEdges.has(e.id)) {
              e.soft = true;
              e.smooth = true;
            }
          }
        } catch (err) {
          console.warn('[GeometryEngine.autofold] triangle failed:', err);
        }
      }
      if (childIds.length > 0) {
        this.onFaceSplit?.(faceId, childIds);
        folded++;
      }
    }
    return folded;
  }

  // ─── Face orientation (classic CAD Reverse Faces / Orient Faces) ───

  /** Flip a face's winding: reverse each ring of vertexIds (outer + holes
   *  independently), negate the stored normal/plane, and keep uvs aligned.
   *  Half-edge loops are left as-is — the codebase treats vertexIds as the
   *  source of truth for rendering, areas, and splits; half-edges only serve
   *  undirected adjacency (delete cascades), which reversal doesn't affect. */
  reverseFace(faceId: string): void {
    const face = this.mesh.faces.get(faceId);
    if (!face) return;

    const rings = this.faceRings(face);
    const newVertexIds: string[] = [];
    const newUvs: Array<{ u: number; v: number }> | null =
      face.uvs && face.uvs.length === face.vertexIds.length ? [] : null;
    for (const ring of rings) {
      for (let i = ring.end - 1; i >= ring.start; i--) {
        newVertexIds.push(face.vertexIds[i]);
        if (newUvs) newUvs.push(face.uvs![i]);
      }
    }

    const updated: IFace = {
      ...face,
      vertexIds: newVertexIds,
      normal: { x: -face.normal.x, y: -face.normal.y, z: -face.normal.z },
      plane: {
        normal: { x: -face.plane.normal.x, y: -face.plane.normal.y, z: -face.plane.normal.z },
        distance: -face.plane.distance,
      },
      generation: Date.now(),
    };
    if (newUvs) updated.uvs = newUvs;
    this.mesh.faces.set(faceId, updated);
  }

  /** Orient all faces connected to the seed so their windings are mutually
   *  consistent (classic CAD Orient Faces): two faces sharing an edge are
   *  consistent when they traverse that edge in OPPOSITE directions. BFS from
   *  the seed, reversing neighbors that disagree. */
  orientFaces(seedFaceId: string): number {
    if (!this.mesh.faces.has(seedFaceId)) return 0;

    // Build edge(vertex-pair) → faces index with per-face traversal direction.
    const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const edgeFaces = new Map<string, Array<{ faceId: string; forward: boolean }>>();
    const indexFace = (faceId: string) => {
      const f = this.mesh.faces.get(faceId);
      if (!f) return;
      for (const ring of this.faceRings(f)) {
        for (let i = ring.start; i < ring.end; i++) {
          const j = i + 1 < ring.end ? i + 1 : ring.start;
          const a = f.vertexIds[i], b = f.vertexIds[j];
          const key = pairKey(a, b);
          let arr = edgeFaces.get(key);
          if (!arr) { arr = []; edgeFaces.set(key, arr); }
          // Drop any stale entry for this face, then record current direction
          const existing = arr.findIndex(e => e.faceId === faceId);
          if (existing >= 0) arr.splice(existing, 1);
          arr.push({ faceId, forward: a < b });
        }
      }
    };
    for (const fid of this.mesh.faces.keys()) indexFace(fid);

    const visited = new Set<string>([seedFaceId]);
    const queue = [seedFaceId];
    let reversedCount = 0;
    while (queue.length > 0) {
      const fid = queue.shift()!;
      const f = this.mesh.faces.get(fid);
      if (!f) continue;
      for (const ring of this.faceRings(f)) {
        for (let i = ring.start; i < ring.end; i++) {
          const j = i + 1 < ring.end ? i + 1 : ring.start;
          const a = f.vertexIds[i], b = f.vertexIds[j];
          const key = pairKey(a, b);
          const myForward = a < b;
          for (const entry of edgeFaces.get(key) ?? []) {
            if (entry.faceId === fid || visited.has(entry.faceId)) continue;
            visited.add(entry.faceId);
            // Consistent = opposite traversal of the shared edge
            if (entry.forward === myForward) {
              this.reverseFace(entry.faceId);
              indexFace(entry.faceId); // re-index with flipped directions
              reversedCount++;
            }
            queue.push(entry.faceId);
          }
        }
      }
    }
    return reversedCount;
  }

  // ─── Bulk import (fast path — skips per-entity topology checks) ──

  /**
   * Import pre-parsed OBJ geometry in bulk. Uses numeric IDs (not UUIDs),
   * hash-based edge dedup, and skips half-edge topology for maximum speed.
   * Returns the vertex IDs array (0-indexed, matching input order).
   */
  bulkImport(
    vertices: Vec3[],
    faces: number[][],
    standaloneEdges?: [number, number][],
    faceHoleStarts?: (number[] | undefined)[],
  ): { vertexIds: string[]; faceIds: string[] } {
    // For very large models (>10K faces), skip edge extraction to save ~30%+ memory.
    // These models use batched rendering (view-only, no per-entity selection).
    const SKIP_EDGES_THRESHOLD = 10000;
    const skipEdges = faces.length > SKIP_EDGES_THRESHOLD;

    // Clean faces and collect unique edge pairs (by vertex index)
    const edgeSet = skipEdges ? null : new Set<number>();
    const edgeKey = (a: number, b: number) => a < b ? a * 2000000 + b : b * 2000000 + a;
    const edgePairs: [number, number][] = [];

    const cleanedFaces: number[][] = [];
    // Track which input face indices survive cleaning (for UV/material mapping)
    const survivingInputIndices: number[] = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const faceIndices = faces[fi];
      if (faceIndices.length < 3) continue;
      let valid = true;
      const cleaned: number[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < faceIndices.length; i++) {
        const idx = faceIndices[i];
        if (idx < 0 || idx >= vertices.length) { valid = false; break; }
        const prev = i === 0 ? faceIndices[faceIndices.length - 1] : faceIndices[i - 1];
        if (idx !== prev && !seen.has(idx)) {
          cleaned.push(idx);
          seen.add(idx);
        }
      }
      if (!valid || cleaned.length < 3) continue;

      // Skip non-planar faces: compute normal from first 3 vertices, then check
      // that all remaining vertices lie within tolerance of that plane.
      const p0 = vertices[cleaned[0]], p1 = vertices[cleaned[1]], p2 = vertices[cleaned[2]];
      const e1x = p1.x - p0.x, e1y = p1.y - p0.y, e1z = p1.z - p0.z;
      const e2x = p2.x - p0.x, e2y = p2.y - p0.y, e2z = p2.z - p0.z;
      let fnx = e1y * e2z - e1z * e2y;
      let fny = e1z * e2x - e1x * e2z;
      let fnz = e1x * e2y - e1y * e2x;
      const flen = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
      if (flen < 1e-10) continue; // degenerate triangle
      fnx /= flen; fny /= flen; fnz /= flen;
      const fd = fnx * p0.x + fny * p0.y + fnz * p0.z;

      let planar = true;
      for (let i = 3; i < cleaned.length; i++) {
        const pi = vertices[cleaned[i]];
        const dist = Math.abs(fnx * pi.x + fny * pi.y + fnz * pi.z - fd);
        if (dist > 0.01) { planar = false; break; }
      }
      if (!planar) continue;

      cleanedFaces.push(cleaned);
      survivingInputIndices.push(fi);

      if (!skipEdges) {
        // Create edges per loop (outer + holes) to avoid bridge edges
        const holes = faceHoleStarts?.[fi];
        if (holes && holes.length > 0) {
          // Build loop boundaries: [0, hole0, hole1, ..., cleaned.length]
          const loopStarts = [0, ...holes, cleaned.length];
          for (let li = 0; li < loopStarts.length - 1; li++) {
            const start = loopStarts[li];
            const end = loopStarts[li + 1];
            for (let i = start; i < end; i++) {
              const a = cleaned[i];
              const b = cleaned[i + 1 < end ? i + 1 : start];
              const k = edgeKey(a, b);
              if (!edgeSet!.has(k)) { edgeSet!.add(k); edgePairs.push([a, b]); }
            }
          }
        } else {
          for (let i = 0; i < cleaned.length; i++) {
            const a = cleaned[i], b = cleaned[(i + 1) % cleaned.length];
            const k = edgeKey(a, b);
            if (!edgeSet!.has(k)) { edgeSet!.add(k); edgePairs.push([a, b]); }
          }
        }
      }
    }

    if (!skipEdges && standaloneEdges) {
      for (const [a, b] of standaloneEdges) {
        if (a >= 0 && b >= 0 && a < vertices.length && b < vertices.length) {
          const k = edgeKey(a, b);
          if (!edgeSet!.has(k)) { edgeSet!.add(k); edgePairs.push([a, b]); }
        }
      }
    }

    if (skipEdges) {
      console.log(`[bulkImport] Skipping edge creation for ${faces.length} faces (view-only mode, saves ~30% memory)`);
    }

    // Fast bulk add to mesh — numeric IDs, no UUIDs, no half-edges
    const result = this.mesh.bulkAdd(vertices, cleanedFaces, edgePairs);
    // Expose survivingInputIndices on the result for UV/material mapping
    (result as any).survivingInputIndices = survivingInputIndices;
    return result;
  }

  // ─── Delete operations ──────────────────────────────────────────

  deleteVertex(id: string): void {
    // Remove all edges connected to this vertex
    const edges = this.mesh.getVertexEdges(id);
    for (const edge of edges) {
      this.deleteEdge(edge.id);
    }
    this.mesh.removeVertex(id);
  }

  deleteEdge(id: string): void {
    // classic CAD behavior: a face cannot outlive its bounding edges.
    // Fast path: faces linked via half-edge adjacency.
    const faces = this.mesh.getEdgeFaces(id);
    for (const face of faces) {
      this.deleteFace(face.id);
    }

    // Fallback: faces whose boundary uses this edge's endpoints consecutively
    // but lost their half-edge links (geometry created before splits preserved
    // topology, or deserialized documents). Without this, such faces would
    // survive the deletion of an edge they depend on.
    const edge = this.mesh.edges.get(id);
    if (edge && this.mesh.faces.size <= 10000) {
      const { startVertexId: a, endVertexId: b } = edge;
      for (const faceId of [...this.mesh.faces.keys()]) {
        const f = this.mesh.faces.get(faceId);
        if (!f) continue;
        const fv = f.vertexIds;
        // Ring-aware pair scan — a flat (i+1)%length wrap pairs a hole's last
        // vertex with the outer ring's first, falsely deleting the face when
        // an unrelated edge connects those two vertices.
        let deleted = false;
        for (const ring of this.faceRings(f)) {
          for (let i = ring.start; i < ring.end && !deleted; i++) {
            const j = i + 1 < ring.end ? i + 1 : ring.start;
            if ((fv[i] === a && fv[j] === b) || (fv[i] === b && fv[j] === a)) {
              this.deleteFace(faceId);
              deleted = true;
            }
          }
          if (deleted) break;
        }
      }
    }

    this.mesh.removeEdge(id);
  }

  /**
   * Remove a face and its half-edges, leaving edges and vertices.
   * If this face was a hole in an enclosing face, the hole stays (like a window).
   *
   * Pass `rememberDeleted: true` for USER-INTENT deletions (select/eraser/API
   * delete): the face's loop is then suppressed so auto-face creation doesn't
   * immediately re-create it from the still-closed edge loop. Internal
   * replace-flows (split/extrude/subdivide/…) must NOT set it.
   */
  deleteFace(id: string, opts?: { rememberDeleted?: boolean }): void {
    if (opts?.rememberDeleted) {
      const face = this.mesh.faces.get(id);
      if (face) {
        const boundary = face.holeStartIndices?.length
          ? face.vertexIds.slice(0, face.holeStartIndices[0])
          : face.vertexIds;
        this.suppressedFaceLoops.set(GeometryEngine.loopKey(boundary), new Set(boundary));
      }
    }
    this.mesh.removeFace(id);
  }

  // ─── Get operations ─────────────────────────────────────────────

  getVertex(id: string): IVertex | undefined {
    return this.mesh.vertices.get(id);
  }

  getEdge(id: string): IEdge | undefined {
    return this.mesh.edges.get(id);
  }

  getFace(id: string): IFace | undefined {
    return this.mesh.faces.get(id);
  }

  // ─── Topology queries ──────────────────────────────────────────

  getVertexEdges(vertexId: string): IEdge[] {
    return this.mesh.getVertexEdges(vertexId);
  }

  /** Get face IDs incident to a vertex (for dirty-tracking adjacency). */
  getVertexFaces(vertexId: string): string[] {
    return this.mesh.getVertexFaces(vertexId);
  }

  /** Get edge IDs incident to a vertex (for dirty-tracking adjacency). */
  getVertexEdgeIds(vertexId: string): string[] {
    return this.mesh.getVertexEdgeIds(vertexId);
  }

  getEdgeFaces(edgeId: string): IFace[] {
    return this.mesh.getEdgeFaces(edgeId);
  }

  getFaceEdges(faceId: string): IEdge[] {
    return this.mesh.getFaceEdges(faceId);
  }

  getFaceVertices(faceId: string): IVertex[] {
    return this.mesh.getFaceVertices(faceId);
  }

  getConnectedFaces(faceId: string): IFace[] {
    return this.mesh.getConnectedFaces(faceId);
  }

  findEdgeBetween(v1Id: string, v2Id: string): IEdge | undefined {
    return this.mesh.findEdgeBetween(v1Id, v2Id);
  }

  getCurveEdges(curveId: string): IEdge[] {
    const edges: IEdge[] = [];
    for (const [, edge] of this.mesh.edges) {
      if (edge.curveId === curveId) edges.push(edge);
    }
    return edges;
  }

  // ─── Geometry computations ─────────────────────────────────────

  checkCoplanar(vertexIds: string[]): boolean {
    if (vertexIds.length <= 3) return true;

    const positions = vertexIds.map(id => {
      const v = this.mesh.vertices.get(id);
      if (!v) throw new Error(`Vertex ${id} not found`);
      return v.position;
    });

    // Newell's method over ALL vertices. A plane fit from the first 3 points
    // breaks when they happen to be collinear (e.g. a bisection midpoint
    // sitting between two corners): the degenerate cross product made this
    // check pass UNCONDITIONALLY, letting wildly non-planar loops through
    // auto-face creation as bent faces threading a solid's interior.
    const normal = this.mesh.computePolygonNormal(positions);
    if (vec3.length(normal) < EPSILON) return false; // zero-area ring — never a face

    const d = vec3.dot(normal, positions[0]);
    for (let i = 1; i < positions.length; i++) {
      const dist = Math.abs(vec3.dot(normal, positions[i]) - d);
      if (dist > 0.05) return false; // Practical tolerance for hand-drawn geometry
    }

    return true;
  }

  computeFaceNormal(faceId: string): Vec3 {
    const face = this.mesh.faces.get(faceId);
    if (!face) throw new Error(`Face ${faceId} not found`);

    const positions = this.collectFacePositionsAndPrune(face, faceId);
    if (positions.length < 3) return { x: 0, y: 1, z: 0 };
    return this.mesh.computePolygonNormal(positions);
  }

  computeFaceArea(faceId: string): number {
    const face = this.mesh.faces.get(faceId);
    if (!face) throw new Error(`Face ${faceId} not found`);

    this.collectFacePositionsAndPrune(face, faceId);

    // Hole-aware: area = outer ring − Σ hole rings. Feeding the whole
    // vertexIds list (outer + holes) into the shoelace formula fans bogus
    // triangles between rings.
    let total = 0;
    let first = true;
    for (const ring of this.faceRings(face)) {
      const positions: Vec3[] = [];
      for (let i = ring.start; i < ring.end; i++) {
        const v = this.mesh.vertices.get(face.vertexIds[i]);
        if (v) positions.push(v.position);
      }
      if (positions.length < 3) { first = false; continue; }
      const normal = this.mesh.computePolygonNormal(positions);
      const ringArea = this.mesh.computePolygonArea(positions, normal);
      total += first ? ringArea : -ringArea;
      first = false;
    }
    return Math.max(0, total);
  }

  /**
   * Resolve a face's vertexIds to live positions. If any vertex has been
   * deleted (e.g., the host face still references hole vertices that an undo
   * removed), prune them in-place + adjust holeStartIndices + bump generation
   * so the renderer re-triangulates. Returns valid positions in stored order.
   */
  private collectFacePositionsAndPrune(face: IFace, faceId: string): Vec3[] {
    const valid: Vec3[] = [];
    const validIds: string[] = [];
    const removalMask: boolean[] = new Array(face.vertexIds.length);
    let removedAny = false;
    for (let i = 0; i < face.vertexIds.length; i++) {
      const v = this.mesh.vertices.get(face.vertexIds[i]);
      if (v) {
        valid.push(v.position);
        validIds.push(face.vertexIds[i]);
        removalMask[i] = false;
      } else {
        removalMask[i] = true;
        removedAny = true;
      }
    }
    if (removedAny) {
      console.warn(`[GeometryEngine] face ${faceId} referenced ${face.vertexIds.length - valid.length} deleted vertex(es); pruning.`);
      // Recompute holeStartIndices to point at the same logical loop boundaries
      // after removed vertices are dropped.
      let newHoles: number[] | undefined;
      if (face.holeStartIndices && face.holeStartIndices.length > 0) {
        const survivors: number[] = [];
        for (const h of face.holeStartIndices) {
          let keptBefore = 0;
          for (let i = 0; i < h; i++) if (!removalMask[i]) keptBefore++;
          // Only keep this hole boundary if there's at least 3 vertices remaining for that loop's region.
          survivors.push(keptBefore);
        }
        // Drop any holes whose loop is now smaller than 3 vertices.
        const filtered: number[] = [];
        for (let i = 0; i < survivors.length; i++) {
          const start = survivors[i];
          const end = i < survivors.length - 1 ? survivors[i + 1] : validIds.length;
          if (end - start >= 3) filtered.push(start);
        }
        newHoles = filtered.length ? filtered : undefined;
      }
      face.vertexIds = validIds;
      face.holeStartIndices = newHoles;
      face.generation = Date.now();
    }
    return valid;
  }

  computeEdgeLength(edgeId: string): number {
    const edge = this.mesh.edges.get(edgeId);
    if (!edge) throw new Error(`Edge ${edgeId} not found`);

    const v1 = this.mesh.vertices.get(edge.startVertexId);
    const v2 = this.mesh.vertices.get(edge.endVertexId);
    if (!v1 || !v2) throw new Error('Edge vertices not found');

    return vec3.distance(v1.position, v2.position);
  }

  // ─── Raycasting ─────────────────────────────────────────────────

  raycast(r: Ray): Array<{ entityId: string; point: Vec3; distance: number; type: 'vertex' | 'edge' | 'face' }> {
    const hits: Array<{ entityId: string; point: Vec3; distance: number; type: 'vertex' | 'edge' | 'face' }> = [];
    const dir = vec3.normalize(r.direction);
    const normalizedRay: Ray = { origin: r.origin, direction: dir };

    // Test vertices
    for (const [, vertex] of this.mesh.vertices) {
      if (vertex.hidden) continue;
      const dist = rayUtil.distanceToPoint(normalizedRay, vertex.position);
      if (dist < VERTEX_HIT_RADIUS) {
        const proj = vec3.dot(vec3.sub(vertex.position, r.origin), dir);
        if (proj > 0) {
          hits.push({
            entityId: vertex.id,
            point: vec3.clone(vertex.position),
            distance: proj,
            type: 'vertex',
          });
        }
      }
    }

    // Test edges
    for (const [, edge] of this.mesh.edges) {
      if (edge.hidden) continue;
      const v1 = this.mesh.vertices.get(edge.startVertexId);
      const v2 = this.mesh.vertices.get(edge.endVertexId);
      if (!v1 || !v2) continue;

      const hit = this.rayEdgeIntersect(normalizedRay, v1.position, v2.position);
      if (hit && hit.distance > 0 && hit.closestDist < EDGE_HIT_RADIUS) {
        hits.push({
          entityId: edge.id,
          point: hit.point,
          distance: hit.distance,
          type: 'edge',
        });
      }
    }

    // Test faces
    for (const [, face] of this.mesh.faces) {
      if (face.hidden) continue;
      const hit = this.rayFaceIntersect(normalizedRay, face);
      if (hit) {
        hits.push({
          entityId: face.id,
          point: hit.point,
          distance: hit.distance,
          type: 'face',
        });
      }
    }

    // Sort by distance
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  /**
   * Ray-edge closest approach test.
   */
  private rayEdgeIntersect(
    r: Ray,
    p1: Vec3,
    p2: Vec3,
  ): { point: Vec3; distance: number; closestDist: number } | null {
    const d = vec3.sub(p2, p1);
    const w = vec3.sub(r.origin, p1);
    const a = vec3.dot(r.direction, r.direction); // 1 if normalized
    const b = vec3.dot(r.direction, d);
    const c = vec3.dot(d, d);
    const dd = vec3.dot(r.direction, w);
    const e = vec3.dot(d, w);

    const denom = a * c - b * b;
    if (Math.abs(denom) < EPSILON) return null; // Parallel

    let tRay = (b * e - c * dd) / denom;
    let tEdge = (a * e - b * dd) / denom;

    // Clamp edge parameter
    tEdge = Math.max(0, Math.min(1, tEdge));
    // Recompute ray parameter for clamped edge point
    tRay = vec3.dot(vec3.sub(vec3.add(p1, vec3.mul(d, tEdge)), r.origin), r.direction);

    if (tRay < 0) return null;

    const rayPoint = vec3.add(r.origin, vec3.mul(r.direction, tRay));
    const edgePoint = vec3.add(p1, vec3.mul(d, tEdge));
    const closestDist = vec3.distance(rayPoint, edgePoint);

    return { point: edgePoint, distance: tRay, closestDist };
  }

  /**
   * Ray-face intersection using Moller-Trumbore for triangulated fan.
   */
  private rayFaceIntersect(
    r: Ray,
    face: IFace,
  ): { point: Vec3; distance: number } | null {
    const positions = face.vertexIds.map(id => {
      const v = this.mesh.vertices.get(id);
      return v ? v.position : null;
    });
    if (positions.some(p => p === null)) return null;
    const pts = positions as Vec3[];

    if (pts.length < 3) return null;

    // Fan triangulation from vertex 0
    let closestHit: { point: Vec3; distance: number } | null = null;

    for (let i = 1; i < pts.length - 1; i++) {
      const hit = this.rayTriangleIntersect(r, pts[0], pts[i], pts[i + 1]);
      if (hit && (!closestHit || hit.distance < closestHit.distance)) {
        closestHit = hit;
      }
    }

    return closestHit;
  }

  /**
   * Moller-Trumbore ray-triangle intersection.
   */
  private rayTriangleIntersect(
    r: Ray,
    v0: Vec3,
    v1: Vec3,
    v2: Vec3,
  ): { point: Vec3; distance: number } | null {
    const edge1 = vec3.sub(v1, v0);
    const edge2 = vec3.sub(v2, v0);
    const h = vec3.cross(r.direction, edge2);
    const a = vec3.dot(edge1, h);

    if (Math.abs(a) < EPSILON) return null; // Ray parallel to triangle

    const f = 1.0 / a;
    const s = vec3.sub(r.origin, v0);
    const u = f * vec3.dot(s, h);
    if (u < 0.0 || u > 1.0) return null;

    const q = vec3.cross(s, edge1);
    const v = f * vec3.dot(r.direction, q);
    if (v < 0.0 || u + v > 1.0) return null;

    const t = f * vec3.dot(edge2, q);
    if (t < EPSILON) return null; // Intersection behind ray origin

    const point = vec3.add(r.origin, vec3.mul(r.direction, t));
    return { point, distance: t };
  }

  // ─── Bounding box ──────────────────────────────────────────────

  getBoundingBox(): BoundingBox {
    let box = bbox.empty();
    for (const [, vertex] of this.mesh.vertices) {
      box = bbox.expandByPoint(box, vertex.position);
    }
    return box;
  }

  // ─── Mesh access ───────────────────────────────────────────────

  getMesh(): IMesh {
    return this.mesh.toMesh();
  }

  // ─── Clone ─────────────────────────────────────────────────────

  clone(): IGeometryEngine {
    const engine = new GeometryEngine();
    engine.mesh = this.mesh.clone();
    return engine;
  }

  // ─── Serialization ─────────────────────────────────────────────

  /**
   * Binary format:
   * [MAGIC: u32] [VERSION: u32]
   * [numVertices: u32] [numEdges: u32] [numFaces: u32] [numHalfEdges: u32]
   *
   * Vertices: for each vertex:
   *   [idLength: u16] [id: utf8 bytes] [x: f64] [y: f64] [z: f64]
   *   [selected: u8] [hidden: u8]
   *
   * Edges: for each edge:
   *   [idLength: u16] [id: utf8] [startIdLen: u16] [startId: utf8]
   *   [endIdLen: u16] [endId: utf8] [soft: u8] [smooth: u8]
   *   [selected: u8] [hidden: u8] [materialIndex: i32]
   *
   * Faces: for each face:
   *   [idLength: u16] [id: utf8] [numVerts: u32]
   *   for each vert: [idLen: u16] [id: utf8]
   *   [nx: f64] [ny: f64] [nz: f64] [planeDist: f64]
   *   [materialIndex: i32] [backMaterialIndex: i32]
   *   [selected: u8] [hidden: u8] [area: f64]
   *
   * HalfEdges: for each halfEdge:
   *   [idLen: u16] [id: utf8]
   *   [originIdLen: u16] [originId: utf8]
   *   [hasTwin: u8] [twinIdLen: u16] [twinId: utf8] (if hasTwin)
   *   [nextIdLen: u16] [nextId: utf8]
   *   [prevIdLen: u16] [prevId: utf8]
   *   [hasFace: u8] [faceIdLen: u16] [faceId: utf8] (if hasFace)
   *   [edgeIdLen: u16] [edgeId: utf8]
   */
  serialize(): ArrayBuffer {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    const pushU8 = (val: number) => {
      const buf = new Uint8Array(1);
      buf[0] = val;
      chunks.push(buf);
      totalSize += 1;
    };

    const pushU16 = (val: number) => {
      const buf = new ArrayBuffer(2);
      new DataView(buf).setUint16(0, val, true);
      chunks.push(new Uint8Array(buf));
      totalSize += 2;
    };

    const pushU32 = (val: number) => {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setUint32(0, val, true);
      chunks.push(new Uint8Array(buf));
      totalSize += 4;
    };

    const pushI32 = (val: number) => {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setInt32(0, val, true);
      chunks.push(new Uint8Array(buf));
      totalSize += 4;
    };

    const pushF64 = (val: number) => {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, val, true);
      chunks.push(new Uint8Array(buf));
      totalSize += 8;
    };

    const pushString = (str: string) => {
      const encoded = encoder.encode(str);
      pushU16(encoded.length);
      chunks.push(encoded);
      totalSize += encoded.length;
    };

    // Header
    pushU32(MAGIC);
    pushU32(VERSION);
    pushU32(this.mesh.vertices.size);
    pushU32(this.mesh.edges.size);
    pushU32(this.mesh.faces.size);
    pushU32(this.mesh.halfEdges.size);

    // Vertices
    for (const [, v] of this.mesh.vertices) {
      pushString(v.id);
      pushF64(v.position.x);
      pushF64(v.position.y);
      pushF64(v.position.z);
      pushU8(v.selected ? 1 : 0);
      pushU8(v.hidden ? 1 : 0);
    }

    // Edges
    for (const [, e] of this.mesh.edges) {
      pushString(e.id);
      pushString(e.startVertexId);
      pushString(e.endVertexId);
      pushU8(e.soft ? 1 : 0);
      pushU8(e.smooth ? 1 : 0);
      pushU8(e.selected ? 1 : 0);
      pushU8(e.hidden ? 1 : 0);
      pushI32(e.materialIndex);
      pushU8(e.curveId ? 1 : 0);
      if (e.curveId) pushString(e.curveId);
    }

    // Faces
    for (const [, f] of this.mesh.faces) {
      pushString(f.id);
      pushU32(f.vertexIds.length);
      for (const vId of f.vertexIds) {
        pushString(vId);
      }
      pushF64(f.normal.x);
      pushF64(f.normal.y);
      pushF64(f.normal.z);
      pushF64(f.plane.distance);
      pushI32(f.materialIndex);
      pushI32(f.backMaterialIndex);
      pushU8(f.selected ? 1 : 0);
      pushU8(f.hidden ? 1 : 0);
      pushF64(f.area);
      const holes = f.holeStartIndices || [];
      pushU32(holes.length);
      for (const hi of holes) pushU32(hi);
      // UVs (texture coordinates from OBJ import)
      const uvs = f.uvs || [];
      pushU32(uvs.length);
      for (const uv of uvs) {
        pushF64(uv.u);
        pushF64(uv.v);
      }
    }

    // Half-edges
    for (const [, he] of this.mesh.halfEdges) {
      pushString(he.id);
      pushString(he.originVertexId);
      pushU8(he.twinId ? 1 : 0);
      if (he.twinId) pushString(he.twinId);
      pushString(he.nextId);
      pushString(he.prevId);
      pushU8(he.faceId ? 1 : 0);
      if (he.faceId) pushString(he.faceId);
      pushString(he.edgeId);
    }

    // Concatenate all chunks
    const result = new ArrayBuffer(totalSize);
    const view = new Uint8Array(result);
    let offset = 0;
    for (const chunk of chunks) {
      view.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  deserialize(data: ArrayBuffer): void {
    const decoder = new TextDecoder();
    const view = new DataView(data);
    const bytes = new Uint8Array(data);
    let offset = 0;

    const readU8 = (): number => {
      const val = view.getUint8(offset);
      offset += 1;
      return val;
    };

    const readU16 = (): number => {
      const val = view.getUint16(offset, true);
      offset += 2;
      return val;
    };

    const readU32 = (): number => {
      const val = view.getUint32(offset, true);
      offset += 4;
      return val;
    };

    const readI32 = (): number => {
      const val = view.getInt32(offset, true);
      offset += 4;
      return val;
    };

    const readF64 = (): number => {
      const val = view.getFloat64(offset, true);
      offset += 8;
      return val;
    };

    const readString = (): string => {
      const len = readU16();
      const str = decoder.decode(bytes.slice(offset, offset + len));
      offset += len;
      return str;
    };

    // Header
    const magic = readU32();
    if (magic !== MAGIC) throw new Error('Invalid geometry data: bad magic number');
    const version = readU32();
    if (version !== 1 && version !== 2) throw new Error(`Unsupported geometry version: ${version}`);

    const numVertices = readU32();
    const numEdges = readU32();
    const numFaces = readU32();
    const numHalfEdges = readU32();

    // Clear existing mesh
    this.mesh = new HalfEdgeMesh();

    // Vertices
    for (let i = 0; i < numVertices; i++) {
      const id = readString();
      const x = readF64();
      const y = readF64();
      const z = readF64();
      const selected = readU8() === 1;
      const hidden = readU8() === 1;

      const v: IVertex = { id, position: { x, y, z }, selected, hidden };
      this.mesh.vertices.set(id, v);
    }

    // Edges
    for (let i = 0; i < numEdges; i++) {
      const id = readString();
      const startVertexId = readString();
      const endVertexId = readString();
      const soft = readU8() === 1;
      const smooth = readU8() === 1;
      const selected = readU8() === 1;
      const hidden = readU8() === 1;
      const materialIndex = readI32();

      const hasCurveId = readU8() === 1;
      const curveId = hasCurveId ? readString() : undefined;

      const e: IEdge = { id, startVertexId, endVertexId, soft, smooth, selected, hidden, materialIndex };
      if (curveId) e.curveId = curveId;
      this.mesh.edges.set(id, e);
    }

    // Faces
    for (let i = 0; i < numFaces; i++) {
      const id = readString();
      const numVerts = readU32();
      const vertexIds: string[] = [];
      for (let j = 0; j < numVerts; j++) {
        vertexIds.push(readString());
      }
      const nx = readF64();
      const ny = readF64();
      const nz = readF64();
      const planeDist = readF64();
      const materialIndex = readI32();
      const backMaterialIndex = readI32();
      const selected = readU8() === 1;
      const hidden = readU8() === 1;
      const area = readF64();
      const numHoles = readU32();
      const holeStartIndices: number[] = [];
      for (let j = 0; j < numHoles; j++) holeStartIndices.push(readU32());

      // UVs (version 2+)
      let uvs: Array<{ u: number; v: number }> | undefined;
      if (version >= 2) {
        const numUVs = readU32();
        if (numUVs > 0) {
          uvs = [];
          for (let j = 0; j < numUVs; j++) {
            uvs.push({ u: readF64(), v: readF64() });
          }
        }
      }

      const normal: Vec3 = { x: nx, y: ny, z: nz };
      const f: IFace = {
        id, vertexIds, normal,
        plane: { normal: { ...normal }, distance: planeDist },
        materialIndex, backMaterialIndex, selected, hidden, area,
        generation: 0,
      };
      if (holeStartIndices.length > 0) f.holeStartIndices = holeStartIndices;
      if (uvs) f.uvs = uvs;
      this.mesh.faces.set(id, f);
    }

    // Half-edges
    for (let i = 0; i < numHalfEdges; i++) {
      const id = readString();
      const originVertexId = readString();
      const hasTwin = readU8() === 1;
      const twinId = hasTwin ? readString() : null;
      const nextId = readString();
      const prevId = readString();
      const hasFace = readU8() === 1;
      const faceId = hasFace ? readString() : null;
      const edgeId = readString();

      const he: IHalfEdge = { id, originVertexId, twinId, nextId, prevId, faceId, edgeId };
      this.mesh.halfEdges.set(id, he);
    }
  }
}
