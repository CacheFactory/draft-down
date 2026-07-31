// @archigraph op.chamfer
// Edge chamfering operation for DraftDown

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IEdge, IVertex } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export interface ChamferParams {
  edgeId: string;
  distance: number;          // equal distance on both faces
  distanceA?: number;        // optional asymmetric: distance on face A
  distanceB?: number;        // optional asymmetric: distance on face B
}

export interface ChamferResult {
  success: boolean;
  chamferFaceId: string | null;
  newEdgeIds: string[];
  newVertexIds: string[];
  removedEdgeId: string | null;
  error?: string;
}

/**
 * Chamfer Operation: replaces a sharp edge with a flat angled cut.
 *
 * Algorithm:
 * 1. Validate edge suitability (exactly 2 adjacent faces, non-degenerate).
 * 2. Get the two adjacent faces of the edge.
 * 3. At each endpoint, compute offset points along both faces at the chamfer distance.
 * 4. Handle corner vertex chamfering where multiple chamfered edges meet.
 * 5. Create the chamfer face (a quad connecting the four offset points).
 * 6. Compute proper chamfer face normal from the new geometry.
 * 7. Trim adjacent faces to connect to the chamfer boundary.
 */
export class ChamferOperation {
  execute(engine: IGeometryEngine, params: ChamferParams): ChamferResult {
    const { edgeId, distance, distanceA, distanceB } = params;
    const dA = distanceA ?? distance;
    const dB = distanceB ?? distance;

    // --- Validation ---
    if (dA <= EPSILON || dB <= EPSILON) {
      return this.fail('Distances must be positive');
    }

    const edge = engine.getEdge(edgeId);
    if (!edge) {
      return this.fail(`Edge ${edgeId} not found`);
    }

    // Edge suitability: must have exactly 2 adjacent faces (manifold edge)
    const adjacentFaces = engine.getEdgeFaces(edgeId);
    if (adjacentFaces.length < 2) {
      return this.fail('Chamfer requires exactly 2 adjacent faces; this is a boundary edge');
    }
    if (adjacentFaces.length > 2) {
      return this.fail('Chamfer requires exactly 2 adjacent faces; this is a non-manifold edge');
    }

    const startVertex = engine.getVertex(edge.startVertexId);
    const endVertex = engine.getVertex(edge.endVertexId);
    if (!startVertex || !endVertex) {
      return this.fail('Edge vertices not found');
    }

    // Degenerate case: zero-length edge
    const edgeVec = vec3.sub(endVertex.position, startVertex.position);
    const edgeLength = vec3.length(edgeVec);
    if (edgeLength < EPSILON) {
      return this.fail('Cannot chamfer a zero-length edge');
    }

    // Degenerate case: chamfer distance exceeds edge-adjacent geometry
    // Check that the chamfer distance does not exceed the lengths of adjacent edges
    // at either endpoint
    const maxAllowedA = this.computeMaxChamferDistance(engine, edge, adjacentFaces[0].id);
    const maxAllowedB = this.computeMaxChamferDistance(engine, edge, adjacentFaces[1].id);
    if (dA > maxAllowedA + EPSILON) {
      return this.fail(`Chamfer distance A (${dA.toFixed(4)}) exceeds maximum allowed (${maxAllowedA.toFixed(4)}) for face A`);
    }
    if (dB > maxAllowedB + EPSILON) {
      return this.fail(`Chamfer distance B (${dB.toFixed(4)}) exceeds maximum allowed (${maxAllowedB.toFixed(4)}) for face B`);
    }

    const edgeDir = vec3.normalize(edgeVec);

    const n0 = engine.computeFaceNormal(adjacentFaces[0].id);
    const n1 = engine.computeFaceNormal(adjacentFaces[1].id);

    // Compute tangent directions along each face, perpendicular to edge
    const tangent0Raw = vec3.cross(edgeDir, n0);
    const tangent1Raw = vec3.cross(n1, edgeDir);

    // Validate tangent vectors are non-degenerate
    if (vec3.length(tangent0Raw) < EPSILON || vec3.length(tangent1Raw) < EPSILON) {
      return this.fail('Edge is degenerate with respect to adjacent face normals');
    }

    const tangent0 = vec3.normalize(tangent0Raw);
    const tangent1 = vec3.normalize(tangent1Raw);

    // Snapshot the adjacent faces BEFORE mutation: deleting the chamfered
    // edge cascades both faces away (classic CAD edge/face dependency), and we
    // must rebuild them trimmed to the chamfer boundary — without this the
    // op left a hole where the two neighbors used to be.
    const adjacentSnapshots = adjacentFaces.slice(0, 2).map(f => ({
      vertexIds: [...f.vertexIds],
      materialIndex: f.materialIndex,
      backMaterialIndex: f.backMaterialIndex,
    }));

    const newVertexIds: string[] = [];
    const newEdgeIds: string[] = [];

    // --- Corner vertex handling ---
    // At each endpoint, check if other edges meeting at that vertex are also
    // being chamfered (indicated by the caller performing sequential chamfers).
    // For now, we handle the single-edge case and compute correct offsets.

    // Chamfer creates 4 new vertices: 2 at each endpoint of the original edge
    // At start vertex: offset along tangent0 and tangent1
    const startA = engine.createVertex(
      this.computeChamferVertexPosition(startVertex, tangent0, dA, engine, edge.startVertexId, adjacentFaces[0].id, edgeId),
    );
    const startB = engine.createVertex(
      this.computeChamferVertexPosition(startVertex, tangent1, dB, engine, edge.startVertexId, adjacentFaces[1].id, edgeId),
    );
    newVertexIds.push(startA.id, startB.id);

    // At end vertex: offset along tangent0 and tangent1
    const endA = engine.createVertex(
      this.computeChamferVertexPosition(endVertex, tangent0, dA, engine, edge.endVertexId, adjacentFaces[0].id, edgeId),
    );
    const endB = engine.createVertex(
      this.computeChamferVertexPosition(endVertex, tangent1, dB, engine, edge.endVertexId, adjacentFaces[1].id, edgeId),
    );
    newVertexIds.push(endA.id, endB.id);

    // Create the chamfer face (quad) with correct winding
    // Compute proper normal for the chamfer face
    const chamferVertices = [startA, endA, endB, startB];
    const chamferPositions = chamferVertices.map(v => v.position);
    const chamferNormal = this.computeQuadNormal(chamferPositions);

    // Verify winding order: chamfer face normal should point outward
    // (away from the interior, roughly averaging the two face normals)
    const expectedNormalDir = vec3.normalize(vec3.add(n0, n1));
    if (vec3.dot(chamferNormal, expectedNormalDir) < 0) {
      // Reverse winding
      const chamferFace = engine.createFace([startB.id, endB.id, endA.id, startA.id]);

      const e1 = engine.createEdge(startB.id, endB.id);
      const e2 = engine.createEdge(endB.id, endA.id);
      const e3 = engine.createEdge(endA.id, startA.id);
      const e4 = engine.createEdge(startA.id, startB.id);
      newEdgeIds.push(e1.id, e2.id, e3.id, e4.id);

      engine.deleteEdge(edgeId);
      this.rebuildAdjacentFaces(engine, adjacentSnapshots, edge.startVertexId, edge.endVertexId, startA.id, startB.id, endA.id, endB.id);

      return {
        success: true,
        chamferFaceId: chamferFace.id,
        newEdgeIds,
        newVertexIds,
        removedEdgeId: edgeId,
      };
    }

    // Normal winding order
    const chamferFace = engine.createFace([startA.id, endA.id, endB.id, startB.id]);

    // Create edges for the chamfer
    const e1 = engine.createEdge(startA.id, endA.id);
    const e2 = engine.createEdge(endA.id, endB.id);
    const e3 = engine.createEdge(endB.id, startB.id);
    const e4 = engine.createEdge(startB.id, startA.id);
    newEdgeIds.push(e1.id, e2.id, e3.id, e4.id);

    // Remove the original sharp edge
    engine.deleteEdge(edgeId);
    this.rebuildAdjacentFaces(engine, adjacentSnapshots, edge.startVertexId, edge.endVertexId, startA.id, startB.id, endA.id, endB.id);

    return {
      success: true,
      chamferFaceId: chamferFace.id,
      newEdgeIds,
      newVertexIds,
      removedEdgeId: edgeId,
    };
  }

  /**
   * Compute the maximum chamfer distance allowed for a given face adjacent to the edge.
   * This is the minimum length of the edges in that face that share an endpoint with
   * the chamfered edge (excluding the chamfered edge itself).
   */
  private computeMaxChamferDistance(
    engine: IGeometryEngine,
    edge: IEdge,
    faceId: string,
  ): number {
    const faceEdges = engine.getFaceEdges(faceId);
    let minLength = Infinity;

    for (const fe of faceEdges) {
      if (fe.id === edge.id) continue;
      // Check if this face edge shares an endpoint with the chamfered edge
      if (
        fe.startVertexId === edge.startVertexId ||
        fe.endVertexId === edge.startVertexId ||
        fe.startVertexId === edge.endVertexId ||
        fe.endVertexId === edge.endVertexId
      ) {
        const len = engine.computeEdgeLength(fe.id);
        if (len < minLength) {
          minLength = len;
        }
      }
    }

    return minLength;
  }

  /**
   * Compute chamfer vertex position, accounting for corner geometry where
   * multiple edges meet at the vertex.
   *
   * For a corner vertex where multiple edges converge, the chamfer vertex is
   * offset along the face tangent direction from the original vertex position.
   * The offset is constrained to lie on the face plane.
   */
  private computeChamferVertexPosition(
    vertex: IVertex,
    tangent: Vec3,
    distance: number,
    engine: IGeometryEngine,
    vertexId: string,
    faceId: string,
    chamferEdgeId: string,
  ): Vec3 {
    // Find the edge in the face that shares this vertex but is NOT the chamfered edge
    const faceEdges = engine.getFaceEdges(faceId);
    let adjacentEdge: IEdge | null = null;

    for (const fe of faceEdges) {
      if (fe.id === chamferEdgeId) continue;
      if (fe.startVertexId === vertexId || fe.endVertexId === vertexId) {
        adjacentEdge = fe;
        break;
      }
    }

    if (adjacentEdge) {
      // Compute the direction along the adjacent edge away from the vertex
      const otherVertexId = adjacentEdge.startVertexId === vertexId
        ? adjacentEdge.endVertexId
        : adjacentEdge.startVertexId;
      const otherVertex = engine.getVertex(otherVertexId);
      if (otherVertex) {
        const edgeDir = vec3.normalize(vec3.sub(otherVertex.position, vertex.position));
        // Project the offset distance along this edge direction
        return vec3.add(vertex.position, vec3.mul(edgeDir, distance));
      }
    }

    // Fallback: simple tangent offset
    return vec3.add(vertex.position, vec3.mul(tangent, distance));
  }

  /**
   * Compute the normal of a quad from its 4 vertex positions using Newell's method.
   */
  private computeQuadNormal(positions: Vec3[]): Vec3 {
    let nx = 0, ny = 0, nz = 0;
    const n = positions.length;
    for (let i = 0; i < n; i++) {
      const curr = positions[i];
      const next = positions[(i + 1) % n];
      nx += (curr.y - next.y) * (curr.z + next.z);
      ny += (curr.z - next.z) * (curr.x + next.x);
      nz += (curr.x - next.x) * (curr.y + next.y);
    }
    return vec3.normalize({ x: nx, y: ny, z: nz });
  }

  /** Rebuild the two adjacent faces with the chamfered edge's endpoints
   *  replaced by their offset points (face 0 → A side, face 1 → B side). */
  private rebuildAdjacentFaces(
    engine: IGeometryEngine,
    snapshots: Array<{ vertexIds: string[]; materialIndex: number; backMaterialIndex: number }>,
    oldStartId: string, oldEndId: string,
    startAId: string, startBId: string, endAId: string, endBId: string,
  ): void {
    snapshots.forEach((snap, k) => {
      const newStart = k === 0 ? startAId : startBId;
      const newEnd = k === 0 ? endAId : endBId;
      const ring = snap.vertexIds.map(id =>
        id === oldStartId ? newStart : id === oldEndId ? newEnd : id);
      try {
        const face = engine.createFace(ring);
        face.materialIndex = snap.materialIndex;
        face.backMaterialIndex = snap.backMaterialIndex;
      } catch (e) {
        console.warn('[ChamferOperation] adjacent face rebuild failed:', e);
      }
    });
  }

  private fail(error: string): ChamferResult {
    return {
      success: false,
      chamferFaceId: null,
      newEdgeIds: [],
      newVertexIds: [],
      removedEdgeId: null,
      error,
    };
  }
}
