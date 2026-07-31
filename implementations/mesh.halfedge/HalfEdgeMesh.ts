// @archigraph engine.geometry
// Half-edge mesh data structure for B-Rep topology

import { v4 as uuid } from 'uuid';
import { IVertex, IEdge, IFace, IHalfEdge, IMesh } from '../../src/core/interfaces';
import { Vec3 } from '../../src/core/types';
import { vec3, EPSILON } from '../../src/core/math';
import { TrackedMap } from '../data.history/TrackedMap';
import { DeltaRecorder, cloneVertex, cloneEdge, cloneFace, cloneHalfEdge } from '../data.history/DeltaRecorder';

/**
 * Half-edge mesh data structure providing efficient topological queries.
 *
 * Invariants maintained:
 * - Every half-edge has a valid next and prev forming a closed loop around its face.
 * - Twin half-edges, when both present, point to each other.
 * - Each half-edge's originVertexId is the start vertex of the directed edge.
 * - twin.originVertexId === the end vertex of this half-edge (i.e. next vertex in face loop).
 */
export class HalfEdgeMesh {
  vertices: TrackedMap<string, IVertex> = new TrackedMap('vertices', cloneVertex);
  edges: TrackedMap<string, IEdge> = new TrackedMap('edges', cloneEdge);
  faces: TrackedMap<string, IFace> = new TrackedMap('faces', cloneFace);
  halfEdges: TrackedMap<string, IHalfEdge> = new TrackedMap('halfEdges', cloneHalfEdge);

  // Lookup acceleration: vertexId -> set of half-edge IDs originating from that vertex
  private vertexToHalfEdges: Map<string, Set<string>> = new Map();
  // edgeId -> pair of half-edge IDs (at most 2)
  private edgeToHalfEdges: Map<string, string[]> = new Map();

  // Monotonically increasing counter for face generation tracking
  private _faceGeneration = 0;

  // ─── Delta recording ──────────────────────────────────────────

  setRecorder(recorder: DeltaRecorder | null): void {
    this.vertices.setRecorder(recorder);
    this.edges.setRecorder(recorder);
    this.faces.setRecorder(recorder);
    this.halfEdges.setRecorder(recorder);
  }

  /**
   * Rebuild lookup maps (vertexToHalfEdges, edgeToHalfEdges) from halfEdges.
   * Called after undo/redo to restore derived state.
   */
  rebuildLookups(): void {
    this.vertexToHalfEdges.clear();
    this.edgeToHalfEdges.clear();

    // Initialize vertex lookup for all vertices
    for (const [vId] of this.vertices) {
      this.vertexToHalfEdges.set(vId, new Set());
    }

    // Initialize edge lookup for all edges
    for (const [eId] of this.edges) {
      this.edgeToHalfEdges.set(eId, []);
    }

    // Populate from half-edges
    for (const [heId, he] of this.halfEdges) {
      const vSet = this.vertexToHalfEdges.get(he.originVertexId);
      if (vSet) vSet.add(heId);

      const eList = this.edgeToHalfEdges.get(he.edgeId);
      if (eList) eList.push(heId);
    }
  }

  // ─── Vertex operations ──────────────────────────────────────────

  addVertex(position: Vec3): IVertex {
    const v: IVertex = {
      id: uuid(),
      position: vec3.clone(position),
      selected: false,
      hidden: false,
    };
    this.vertices.set(v.id, v);
    this.vertexToHalfEdges.set(v.id, new Set());
    return v;
  }

  removeVertex(id: string): void {
    this.vertices.delete(id);
    this.vertexToHalfEdges.delete(id);
  }

  // ─── Edge operations ────────────────────────────────────────────

  addEdge(v1Id: string, v2Id: string): IEdge {
    const e: IEdge = {
      id: uuid(),
      startVertexId: v1Id,
      endVertexId: v2Id,
      soft: false,
      smooth: false,
      selected: false,
      hidden: false,
      materialIndex: -1,
    };
    this.edges.set(e.id, e);
    this.edgeToHalfEdges.set(e.id, []);
    return e;
  }

  removeEdge(id: string): void {
    // Remove associated half-edges
    const heIds = this.edgeToHalfEdges.get(id);
    if (heIds) {
      for (const heId of heIds) {
        this.removeHalfEdgeInternal(heId);
      }
    }
    this.edgeToHalfEdges.delete(id);
    this.edges.delete(id);
  }

  // ─── Half-edge operations ───────────────────────────────────────

  addHalfEdge(originVertexId: string, edgeId: string, faceId: string | null): IHalfEdge {
    const he: IHalfEdge = {
      id: uuid(),
      originVertexId,
      twinId: null,
      nextId: '', // Must be set after creation
      prevId: '', // Must be set after creation
      faceId,
      edgeId,
    };
    this.halfEdges.set(he.id, he);

    const vSet = this.vertexToHalfEdges.get(originVertexId);
    if (vSet) vSet.add(he.id);

    const eList = this.edgeToHalfEdges.get(edgeId);
    if (eList) eList.push(he.id);

    return he;
  }

  private removeHalfEdgeInternal(heId: string): void {
    const he = this.halfEdges.get(heId);
    if (!he) return;

    // Remove from vertex lookup
    const vSet = this.vertexToHalfEdges.get(he.originVertexId);
    if (vSet) vSet.delete(heId);

    // Unlink twin
    if (he.twinId) {
      const twin = this.halfEdges.get(he.twinId);
      if (twin) twin.twinId = null;
    }

    this.halfEdges.delete(heId);
  }

  linkTwins(he1Id: string, he2Id: string): void {
    const he1 = this.halfEdges.get(he1Id);
    const he2 = this.halfEdges.get(he2Id);
    if (he1 && he2) {
      he1.twinId = he2Id;
      he2.twinId = he1Id;
    }
  }

  /**
   * Create a face from an ordered list of vertex IDs.
   * Automatically creates edges and half-edges, linking twins where possible.
   * Returns the created face, edges, and half-edges.
   */
  createFaceFromVertices(
    vertexIds: string[],
    findExistingEdge: (v1: string, v2: string) => IEdge | undefined,
  ): { face: IFace; newEdges: IEdge[]; halfEdgeIds: string[] } {
    const n = vertexIds.length;
    if (n < 3) throw new Error('A face requires at least 3 vertices');

    // Compute normal and plane
    const positions = vertexIds.map(id => {
      const v = this.vertices.get(id);
      if (!v) throw new Error(`Vertex ${id} not found`);
      return v.position;
    });
    const normal = this.computePolygonNormal(positions);
    const distance = vec3.dot(normal, positions[0]);

    // Compute area
    const area = this.computePolygonArea(positions, normal);

    const face: IFace = {
      id: uuid(),
      vertexIds: [...vertexIds],
      normal,
      plane: { normal, distance },
      materialIndex: -1,
      backMaterialIndex: -1,
      selected: false,
      hidden: false,
      area,
      generation: ++this._faceGeneration,
    };
    this.faces.set(face.id, face);

    const newEdges: IEdge[] = [];
    const halfEdgeIds: string[] = [];

    // Create half-edges for each edge of the face
    for (let i = 0; i < n; i++) {
      const v1 = vertexIds[i];
      const v2 = vertexIds[(i + 1) % n];

      // Find or create the edge
      let edge = findExistingEdge(v1, v2);
      if (!edge) {
        edge = this.addEdge(v1, v2);
        newEdges.push(edge);
      }

      // Create half-edge from v1 to v2 for this face
      const he = this.addHalfEdge(v1, edge.id, face.id);
      halfEdgeIds.push(he.id);
    }

    // Link next/prev in the face loop
    for (let i = 0; i < n; i++) {
      const he = this.halfEdges.get(halfEdgeIds[i])!;
      he.nextId = halfEdgeIds[(i + 1) % n];
      he.prevId = halfEdgeIds[(i - 1 + n) % n];
    }

    // Try to link twins with existing half-edges on the same edges
    for (let i = 0; i < n; i++) {
      const he = this.halfEdges.get(halfEdgeIds[i])!;
      const edgeHes = this.edgeToHalfEdges.get(he.edgeId);
      if (edgeHes) {
        for (const otherHeId of edgeHes) {
          if (otherHeId === he.id) continue;
          const otherHe = this.halfEdges.get(otherHeId);
          if (!otherHe) continue;
          // Twin means opposite direction on the same edge
          const v1 = he.originVertexId;
          const heNext = this.halfEdges.get(he.nextId);
          const v2 = heNext ? heNext.originVertexId : null;
          if (otherHe.originVertexId === v2) {
            // otherHe goes from v2 -> something; check it goes to v1
            const otherNext = this.halfEdges.get(otherHe.nextId);
            if (otherNext && otherNext.originVertexId === v1) {
              // This is a valid twin - but actually we just need to check origin
              // Twin's origin = this edge's end vertex
              this.linkTwins(he.id, otherHeId);
            } else if (!otherHe.twinId) {
              // Simpler check: same edge, opposite origin vertex
              this.linkTwins(he.id, otherHeId);
            }
          }
        }
      }
    }

    return { face, newEdges, halfEdgeIds };
  }

  /**
   * Remove a face and its half-edges. Leaves edges and vertices intact.
   */
  removeFace(faceId: string): void {
    const face = this.faces.get(faceId);
    if (!face) return;

    // Find all half-edges belonging to this face
    const heIds: string[] = [];
    for (const [heId, he] of this.halfEdges) {
      if (he.faceId === faceId) {
        heIds.push(heId);
      }
    }

    // Remove half-edges from edge lookup, then delete
    for (const heId of heIds) {
      const he = this.halfEdges.get(heId)!;
      const eList = this.edgeToHalfEdges.get(he.edgeId);
      if (eList) {
        const idx = eList.indexOf(heId);
        if (idx >= 0) eList.splice(idx, 1);
      }
      this.removeHalfEdgeInternal(heId);
    }

    this.faces.delete(faceId);
  }

  // ─── Iteration utilities ────────────────────────────────────────

  /**
   * Iterate half-edges around a face (following next pointers).
   */
  *iterateFaceHalfEdges(faceId: string): IterableIterator<IHalfEdge> {
    // Find a starting half-edge for this face
    let startId: string | null = null;
    for (const [heId, he] of this.halfEdges) {
      if (he.faceId === faceId) {
        startId = heId;
        break;
      }
    }
    if (!startId) return;

    let current = this.halfEdges.get(startId)!;
    const first = current;
    do {
      yield current;
      current = this.halfEdges.get(current.nextId)!;
    } while (current && current.id !== first.id);
  }

  /**
   * Iterate half-edges originating from a vertex (fan around vertex).
   * Uses twin.next to walk around.
   */
  *iterateVertexHalfEdges(vertexId: string): IterableIterator<IHalfEdge> {
    const heSet = this.vertexToHalfEdges.get(vertexId);
    if (!heSet || heSet.size === 0) return;

    // Just yield all half-edges originating from this vertex
    for (const heId of heSet) {
      const he = this.halfEdges.get(heId);
      if (he) yield he;
    }
  }

  /**
   * Get all face IDs incident to a vertex (via half-edge adjacency).
   * For bulk-imported meshes without half-edges, falls back to scanning all faces.
   */
  getVertexFaces(vertexId: string): string[] {
    const heSet = this.vertexToHalfEdges.get(vertexId);
    if (heSet && heSet.size > 0) {
      const faceIds: string[] = [];
      const seen = new Set<string>();
      for (const heId of heSet) {
        const he = this.halfEdges.get(heId);
        if (he && he.faceId && !seen.has(he.faceId)) {
          seen.add(he.faceId);
          faceIds.push(he.faceId);
        }
      }
      return faceIds;
    }
    // Fallback for bulk-imported meshes: scan all faces
    const result: string[] = [];
    for (const [faceId, face] of this.faces) {
      if (face.vertexIds.includes(vertexId)) result.push(faceId);
    }
    return result;
  }

  /**
   * Get all edge IDs incident to a vertex (returns string IDs).
   */
  getVertexEdgeIds(vertexId: string): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const heSet = this.vertexToHalfEdges.get(vertexId);
    if (heSet && heSet.size > 0) {
      for (const heId of heSet) {
        const he = this.halfEdges.get(heId);
        if (he && !seen.has(he.edgeId)) {
          seen.add(he.edgeId);
          result.push(he.edgeId);
        }
      }
    }
    // Also check edges directly (for edges without half-edges, e.g. bulk import)
    for (const [edgeId, edge] of this.edges) {
      if ((edge.startVertexId === vertexId || edge.endVertexId === vertexId) && !seen.has(edgeId)) {
        seen.add(edgeId);
        result.push(edgeId);
      }
    }
    return result;
  }

  /**
   * Get all edges incident to a vertex.
   */
  getVertexEdges(vertexId: string): IEdge[] {
    const result: IEdge[] = [];
    const seen = new Set<string>();
    for (const he of this.iterateVertexHalfEdges(vertexId)) {
      if (!seen.has(he.edgeId)) {
        seen.add(he.edgeId);
        const edge = this.edges.get(he.edgeId);
        if (edge) result.push(edge);
      }
    }
    // Also check edges directly (for edges without half-edges)
    for (const [, edge] of this.edges) {
      if ((edge.startVertexId === vertexId || edge.endVertexId === vertexId) && !seen.has(edge.id)) {
        seen.add(edge.id);
        result.push(edge);
      }
    }
    return result;
  }

  /**
   * Get faces adjacent to an edge.
   */
  getEdgeFaces(edgeId: string): IFace[] {
    const heIds = this.edgeToHalfEdges.get(edgeId);
    if (!heIds) return [];
    const faces: IFace[] = [];
    const seen = new Set<string>();
    for (const heId of heIds) {
      const he = this.halfEdges.get(heId);
      if (he && he.faceId && !seen.has(he.faceId)) {
        seen.add(he.faceId);
        const face = this.faces.get(he.faceId);
        if (face) faces.push(face);
      }
    }
    return faces;
  }

  /**
   * Get all edges of a face.
   */
  getFaceEdges(faceId: string): IEdge[] {
    const edges: IEdge[] = [];
    const seen = new Set<string>();
    for (const he of this.iterateFaceHalfEdges(faceId)) {
      if (!seen.has(he.edgeId)) {
        seen.add(he.edgeId);
        const edge = this.edges.get(he.edgeId);
        if (edge) edges.push(edge);
      }
    }
    return edges;
  }

  /**
   * Get ordered vertices of a face.
   */
  getFaceVertices(faceId: string): IVertex[] {
    const face = this.faces.get(faceId);
    if (!face) return [];
    const verts: IVertex[] = [];
    for (const vId of face.vertexIds) {
      const v = this.vertices.get(vId);
      if (v) verts.push(v);
    }
    return verts;
  }

  /**
   * Get faces sharing an edge with the given face.
   */
  getConnectedFaces(faceId: string): IFace[] {
    const result: IFace[] = [];
    const seen = new Set<string>();
    seen.add(faceId);
    for (const he of this.iterateFaceHalfEdges(faceId)) {
      if (he.twinId) {
        const twin = this.halfEdges.get(he.twinId);
        if (twin && twin.faceId && !seen.has(twin.faceId)) {
          seen.add(twin.faceId);
          const face = this.faces.get(twin.faceId);
          if (face) result.push(face);
        }
      }
      // Also check other half-edges on the same edge
      const edgeHes = this.edgeToHalfEdges.get(he.edgeId);
      if (edgeHes) {
        for (const otherHeId of edgeHes) {
          const otherHe = this.halfEdges.get(otherHeId);
          if (otherHe && otherHe.faceId && !seen.has(otherHe.faceId)) {
            seen.add(otherHe.faceId);
            const face = this.faces.get(otherHe.faceId);
            if (face) result.push(face);
          }
        }
      }
    }
    return result;
  }

  // ─── Edge splitting ─────────────────────────────────────────────

  /**
   * Split an edge at a given position, creating a new vertex and two new edges.
   * Updates half-edges and faces accordingly.
   * Returns the new vertex.
   */
  splitEdge(edgeId: string, position: Vec3): IVertex {
    const newVertex = this.addVertex(position);
    this.splitEdgeAtVertex(edgeId, newVertex.id);
    return newVertex;
  }

  /**
   * Split an edge at an EXISTING vertex while preserving half-edge topology:
   * each half-edge on the edge is split in two, dependent faces gain the
   * vertex in their boundary, and edge→face adjacency stays intact — so a
   * face still dies (classic-CAD-style) when one of the halves is later deleted.
   * Returns the two replacement edges.
   */
  splitEdgeAtVertex(edgeId: string, vertexId: string): { edge1: IEdge; edge2: IEdge } {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new Error(`Edge ${edgeId} not found`);
    // Degenerate: splitting at an endpoint is a no-op.
    if (vertexId === edge.startVertexId || vertexId === edge.endVertexId) {
      return { edge1: edge, edge2: edge };
    }

    // Create two new edges: (start, v) and (v, end). Reuse an existing edge
    // between the pair when one is already there (e.g. a drawn rectangle's
    // side lying exactly on the boundary being split) — otherwise the split
    // would stack a duplicate collinear edge on top of it.
    const existing1 = this.findEdgeBetween(edge.startVertexId, vertexId);
    const edge1 = existing1 ?? this.addEdge(edge.startVertexId, vertexId);
    if (!existing1) {
      edge1.soft = edge.soft;
      edge1.smooth = edge.smooth;
      edge1.curveId = edge.curveId;
    }

    const existing2 = this.findEdgeBetween(vertexId, edge.endVertexId);
    const edge2 = existing2 ?? this.addEdge(vertexId, edge.endVertexId);
    if (!existing2) {
      edge2.soft = edge.soft;
      edge2.smooth = edge.smooth;
      edge2.curveId = edge.curveId;
    }

    // Update half-edges: for each half-edge on this edge, split it into two
    const heIds = this.edgeToHalfEdges.get(edgeId);
    if (heIds) {
      const hesToSplit = [...heIds];
      for (const heId of hesToSplit) {
        const he = this.halfEdges.get(heId);
        if (!he) continue;

        // Determine direction: does he go start->end or end->start?
        const goesForward = he.originVertexId === edge.startVertexId;

        // Create a new half-edge for the second segment
        const newHe = this.addHalfEdge(
          vertexId,
          goesForward ? edge2.id : edge1.id,
          he.faceId,
        );

        // Update original half-edge to reference the first segment
        he.edgeId = goesForward ? edge1.id : edge2.id;

        // Re-register he in the new edge's half-edge list
        const newEdgeId = he.edgeId;
        const newEdgeHes = this.edgeToHalfEdges.get(newEdgeId);
        if (newEdgeHes && !newEdgeHes.includes(he.id)) {
          newEdgeHes.push(he.id);
        }

        // Link next/prev: insert newHe between he and he.next
        newHe.nextId = he.nextId;
        newHe.prevId = he.id;
        const oldNext = this.halfEdges.get(he.nextId);
        if (oldNext) oldNext.prevId = newHe.id;
        he.nextId = newHe.id;

        // Update face vertexIds if applicable (skip if the caller already
        // inserted the vertex into this face's boundary)
        if (he.faceId) {
          const face = this.faces.get(he.faceId);
          if (face && !face.vertexIds.includes(vertexId)) {
            const originIdx = face.vertexIds.indexOf(he.originVertexId);
            if (originIdx >= 0) {
              // Insert new vertex after origin in the vertex list
              face.vertexIds.splice(originIdx + 1, 0, vertexId);
              // holeStartIndices are positions INTO vertexIds — shift any
              // ring start at or after the insertion point, or the hole
              // markers land on outer vertices and the topology corrupts.
              if (face.holeStartIndices?.length) {
                face.holeStartIndices = face.holeStartIndices.map(
                  hi => hi > originIdx ? hi + 1 : hi,
                );
              }
            }
          }
        }
      }
    }

    // Remove the old edge record directly. Its half-edges were re-linked to
    // the new edges above — going through removeEdge would delete them and
    // orphan the dependent faces.
    this.edgeToHalfEdges.delete(edgeId);
    this.edges.delete(edgeId);

    return { edge1, edge2 };
  }

  /**
   * Split a face along a line between two of its vertices, creating two new faces.
   * The original face is removed.
   * Returns the two new faces.
   */
  splitFace(
    faceId: string,
    v1Id: string,
    v2Id: string,
    findExistingEdge: (a: string, b: string) => IEdge | undefined,
  ): [IFace, IFace] {
    const face = this.faces.get(faceId);
    if (!face) throw new Error(`Face ${faceId} not found`);

    const vIds = face.vertexIds;
    const idx1 = vIds.indexOf(v1Id);
    const idx2 = vIds.indexOf(v2Id);
    if (idx1 < 0 || idx2 < 0) throw new Error('Vertices must belong to the face');
    if (idx1 === idx2) throw new Error('Vertices must be different');

    // Build two loops
    const lo = Math.min(idx1, idx2);
    const hi = Math.max(idx1, idx2);

    const loop1 = vIds.slice(lo, hi + 1);
    const loop2 = [...vIds.slice(hi), ...vIds.slice(0, lo + 1)];

    if (loop1.length < 3 || loop2.length < 3) {
      throw new Error('Split would produce a degenerate face');
    }

    // Remove original face
    this.removeFace(faceId);

    // Create two new faces
    const result1 = this.createFaceFromVertices(loop1, findExistingEdge);
    const result2 = this.createFaceFromVertices(loop2, findExistingEdge);

    return [result1.face, result2.face];
  }

  // ─── Validation ─────────────────────────────────────────────────

  /**
   * Validate all half-edge invariants. Returns an array of error messages.
   */
  validate(): string[] {
    const errors: string[] = [];

    for (const [heId, he] of this.halfEdges) {
      // Check next/prev exist
      if (!this.halfEdges.has(he.nextId)) {
        errors.push(`HalfEdge ${heId}: nextId ${he.nextId} does not exist`);
      }
      if (!this.halfEdges.has(he.prevId)) {
        errors.push(`HalfEdge ${heId}: prevId ${he.prevId} does not exist`);
      }

      // Check next.prev === this
      const next = this.halfEdges.get(he.nextId);
      if (next && next.prevId !== heId) {
        errors.push(`HalfEdge ${heId}: next.prev !== this`);
      }

      // Check prev.next === this
      const prev = this.halfEdges.get(he.prevId);
      if (prev && prev.nextId !== heId) {
        errors.push(`HalfEdge ${heId}: prev.next !== this`);
      }

      // Check twin symmetry
      if (he.twinId) {
        const twin = this.halfEdges.get(he.twinId);
        if (!twin) {
          errors.push(`HalfEdge ${heId}: twinId ${he.twinId} does not exist`);
        } else if (twin.twinId !== heId) {
          errors.push(`HalfEdge ${heId}: twin.twin !== this`);
        }
      }

      // Check origin vertex exists
      if (!this.vertices.has(he.originVertexId)) {
        errors.push(`HalfEdge ${heId}: originVertexId ${he.originVertexId} does not exist`);
      }

      // Check edge exists
      if (!this.edges.has(he.edgeId)) {
        errors.push(`HalfEdge ${heId}: edgeId ${he.edgeId} does not exist`);
      }

      // Check face exists (if not boundary)
      if (he.faceId && !this.faces.has(he.faceId)) {
        errors.push(`HalfEdge ${heId}: faceId ${he.faceId} does not exist`);
      }
    }

    // Check face loops are closed
    for (const [faceId] of this.faces) {
      let count = 0;
      const maxIter = 1000;
      for (const _he of this.iterateFaceHalfEdges(faceId)) {
        count++;
        if (count > maxIter) {
          errors.push(`Face ${faceId}: half-edge loop appears infinite`);
          break;
        }
      }
    }

    return errors;
  }

  // ─── Geometry utilities ─────────────────────────────────────────

  computePolygonNormal(positions: Vec3[]): Vec3 {
    // Newell's method for robust normal computation
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

  computePolygonArea(positions: Vec3[], normal: Vec3): number {
    // Shoelace formula projected onto dominant axis plane
    if (positions.length < 3) return 0;
    let area = vec3.zero();
    const p0 = positions[0];
    for (let i = 1; i < positions.length - 1; i++) {
      const cross = vec3.cross(
        vec3.sub(positions[i], p0),
        vec3.sub(positions[i + 1], p0),
      );
      area = vec3.add(area, cross);
    }
    return Math.abs(vec3.dot(area, normal)) * 0.5;
  }

  /**
   * Find an edge between two vertices (in either direction).
   */
  findEdgeBetween(v1Id: string, v2Id: string): IEdge | undefined {
    for (const [, edge] of this.edges) {
      if (
        (edge.startVertexId === v1Id && edge.endVertexId === v2Id) ||
        (edge.startVertexId === v2Id && edge.endVertexId === v1Id)
      ) {
        return edge;
      }
    }
    return undefined;
  }

  /**
   * Export the mesh state as an IMesh.
   */
  toMesh(): IMesh {
    // Return internal maps directly (read-only access assumed).
    // Copying 800K+ entries per call was a major perf bottleneck (~300ms per sync).
    return {
      vertices: this.vertices,
      edges: this.edges,
      faces: this.faces,
      halfEdges: this.halfEdges,
    };
  }

  /**
   * Deep clone the entire mesh.
   */
  clone(): HalfEdgeMesh {
    const mesh = new HalfEdgeMesh();

    // Use Map.prototype.set to bypass TrackedMap recording during clone
    const rawV = Map.prototype.set.bind(mesh.vertices);
    const rawE = Map.prototype.set.bind(mesh.edges);
    const rawF = Map.prototype.set.bind(mesh.faces);
    const rawH = Map.prototype.set.bind(mesh.halfEdges);

    for (const [id, v] of this.vertices) {
      rawV(id, { ...v, position: vec3.clone(v.position) });
      mesh.vertexToHalfEdges.set(id, new Set(this.vertexToHalfEdges.get(id)));
    }
    for (const [id, e] of this.edges) {
      rawE(id, { ...e });
      mesh.edgeToHalfEdges.set(id, [...(this.edgeToHalfEdges.get(id) || [])]);
    }
    for (const [id, f] of this.faces) {
      rawF(id, {
        ...f,
        vertexIds: [...f.vertexIds],
        normal: vec3.clone(f.normal),
        plane: { normal: vec3.clone(f.plane.normal), distance: f.plane.distance },
      });
    }
    for (const [id, he] of this.halfEdges) {
      rawH(id, { ...he });
    }

    return mesh;
  }

  // ─── Bulk import (fast path) ──────────────────────────────────

  /**
   * Fast bulk add for large model import. Uses numeric counter IDs instead of
   * UUIDs and skips half-edge topology entirely. Returns vertex ID array
   * matching the input order.
   */
  bulkAdd(
    positions: Array<{ x: number; y: number; z: number }>,
    faceIndices: number[][],
    edgePairs: [number, number][], // pre-deduped [vertexIdx1, vertexIdx2] pairs
  ): { vertexIds: string[]; faceIds: string[] } {
    // Bypass delta recording during bulk import — this is file load, not user edits.
    // bulkAdd uses Map.prototype.set directly to skip TrackedMap overhead.
    const rawVertexSet = Map.prototype.set.bind(this.vertices);
    const rawEdgeSet = Map.prototype.set.bind(this.edges);
    const rawFaceSet = Map.prototype.set.bind(this.faces);

    let counter = this.vertices.size + this.edges.size + this.faces.size;

    // 1. Vertices — simple numeric IDs, inline position (no clone)
    const vertexIds: string[] = new Array(positions.length);
    for (let i = 0; i < positions.length; i++) {
      const id = `v${counter++}`;
      rawVertexSet(id, {
        id,
        position: { x: positions[i].x, y: positions[i].y, z: positions[i].z },
        selected: false,
        hidden: false,
      });
      this.vertexToHalfEdges.set(id, new Set());
      vertexIds[i] = id;
    }

    // 2. Edges from pre-deduped pairs (vertex indices → resolved IDs)
    for (let i = 0; i < edgePairs.length; i++) {
      const id = `e${counter++}`;
      rawEdgeSet(id, {
        id,
        startVertexId: vertexIds[edgePairs[i][0]],
        endVertexId: vertexIds[edgePairs[i][1]],
        soft: false,
        smooth: false,
        selected: false,
        hidden: false,
        materialIndex: -1,
      });
      this.edgeToHalfEdges.set(id, []);
    }

    // 3. Faces — compute normals via Newell's method, skip half-edges
    const faceIds: string[] = [];
    for (const indices of faceIndices) {
      const n = indices.length;
      const vIds = new Array(n);
      let nx = 0, ny = 0, nz = 0;

      // Resolve IDs and fetch positions in one pass
      for (let i = 0; i < n; i++) {
        vIds[i] = vertexIds[indices[i]];
      }

      for (let i = 0; i < n; i++) {
        const curr = this.vertices.get(vIds[i])!.position;
        const next = this.vertices.get(vIds[(i + 1) % n])!.position;
        nx += (curr.y - next.y) * (curr.z + next.z);
        ny += (curr.z - next.z) * (curr.x + next.x);
        nz += (curr.x - next.x) * (curr.y + next.y);
      }
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const normal = { x: nx / len, y: ny / len, z: nz / len };
      const p0 = this.vertices.get(vIds[0])!.position;

      const id = `f${counter++}`;
      rawFaceSet(id, {
        id,
        vertexIds: vIds,
        normal,
        plane: { normal, distance: normal.x * p0.x + normal.y * p0.y + normal.z * p0.z },
        materialIndex: -1,
        backMaterialIndex: -1,
        selected: false,
        hidden: false,
        area: 0,
        generation: ++this._faceGeneration,
      });
      faceIds.push(id);
    }

    return { vertexIds, faceIds };
  }
}
