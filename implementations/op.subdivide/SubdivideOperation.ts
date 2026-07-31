// @archigraph op.subdivide
// Mesh subdivision operation for DraftDown

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IFace, IVertex, IEdge } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';

export type SubdivisionMethod = 'catmull-clark' | 'midpoint';

/** Maximum allowed subdivision iterations to prevent runaway geometry explosion. */
const MAX_ITERATIONS = 5;

/** Default face count warning threshold. */
const DEFAULT_FACE_COUNT_LIMIT = 100_000;

export interface SubdivideParams {
  faceIds: string[];           // faces to subdivide (empty = all faces)
  method?: SubdivisionMethod;  // default: 'midpoint'
  iterations?: number;         // default: 1, max: 5
  faceCountLimit?: number;     // max output faces before aborting (default: 100000)
}

export interface SubdivideResult {
  success: boolean;
  newFaceIds: string[];
  newEdgeIds: string[];
  newVertexIds: string[];
  removedFaceIds: string[];
  iterationsPerformed: number;
  warning?: string;
  error?: string;
}

/**
 * Subdivide Operation: splits faces into smaller sub-faces.
 *
 * Supports two methods:
 * - midpoint: split each edge at its midpoint, connect midpoints to form sub-faces
 * - catmull-clark: smooth subdivision with face points, edge points, and updated
 *   vertex positions. Respects boundary edges and crease edges (edge.soft === false).
 */
export class SubdivideOperation {
  execute(engine: IGeometryEngine, params: SubdivideParams): SubdivideResult {
    const {
      faceIds,
      method = 'midpoint',
      iterations: requestedIterations = 1,
      faceCountLimit = DEFAULT_FACE_COUNT_LIMIT,
    } = params;

    // Clamp iterations
    const iterations = Math.max(1, Math.min(MAX_ITERATIONS, requestedIterations));
    const wasIterationsClamped = requestedIterations > MAX_ITERATIONS;

    let currentFaceIds = faceIds.length > 0
      ? [...faceIds]
      : Array.from(engine.getMesh().faces.keys());

    const allNewFaceIds: string[] = [];
    const allNewEdgeIds: string[] = [];
    const allNewVertexIds: string[] = [];
    const allRemovedFaceIds: string[] = [];
    let iterationsPerformed = 0;

    for (let iter = 0; iter < iterations; iter++) {
      // Face count limit check: estimate output face count
      // Midpoint on quads: 4x, on triangles: 4x. Catmull-Clark: ~4x for quads.
      const estimatedOutputFaces = currentFaceIds.length * 4;
      if (allNewFaceIds.length + estimatedOutputFaces > faceCountLimit) {
        return {
          success: true,
          newFaceIds: allNewFaceIds,
          newEdgeIds: allNewEdgeIds,
          newVertexIds: allNewVertexIds,
          removedFaceIds: allRemovedFaceIds,
          iterationsPerformed,
          warning: `Stopped after ${iterationsPerformed} iteration(s): next iteration would exceed face count limit of ${faceCountLimit} (estimated ${allNewFaceIds.length + estimatedOutputFaces} faces)`,
        };
      }

      let result: SubdivideResult;

      if (method === 'catmull-clark') {
        result = this.catmullClark(engine, currentFaceIds);
      } else {
        result = this.midpointSubdivide(engine, currentFaceIds);
      }

      if (!result.success) {
        return result;
      }

      allNewFaceIds.push(...result.newFaceIds);
      allNewEdgeIds.push(...result.newEdgeIds);
      allNewVertexIds.push(...result.newVertexIds);
      allRemovedFaceIds.push(...result.removedFaceIds);
      iterationsPerformed++;

      // Next iteration works on newly created faces
      currentFaceIds = result.newFaceIds;
    }

    const warning = wasIterationsClamped
      ? `Iterations clamped from ${requestedIterations} to ${MAX_ITERATIONS}`
      : undefined;

    return {
      success: true,
      newFaceIds: allNewFaceIds,
      newEdgeIds: allNewEdgeIds,
      newVertexIds: allNewVertexIds,
      removedFaceIds: allRemovedFaceIds,
      iterationsPerformed,
      warning,
    };
  }

  /**
   * Simple midpoint subdivision: for each face, create a center vertex and
   * split each edge at its midpoint, then connect to form sub-faces.
   *
   * For a triangle ABC with midpoints Mab, Mbc, Mca:
   *   -> 4 triangles: (A, Mab, Mca), (Mab, B, Mbc), (Mca, Mbc, C), (Mab, Mbc, Mca)
   *
   * For a quad/n-gon: center vertex + midpoints -> N quads
   */
  private midpointSubdivide(engine: IGeometryEngine, faceIds: string[]): SubdivideResult {
    const newFaceIds: string[] = [];
    const newEdgeIds: string[] = [];
    const newVertexIds: string[] = [];
    const removedFaceIds: string[] = [];

    // Cache edge midpoints so shared edges only get one midpoint vertex
    const edgeMidpointMap = new Map<string, string>(); // edgeId -> midpoint vertexId

    const getOrCreateEdgeMidpoint = (v1Id: string, v2Id: string): string => {
      // Look for existing edge between these vertices
      const edge = engine.findEdgeBetween(v1Id, v2Id);
      if (edge && edgeMidpointMap.has(edge.id)) {
        return edgeMidpointMap.get(edge.id)!;
      }

      const v1 = engine.getVertex(v1Id)!;
      const v2 = engine.getVertex(v2Id)!;
      const midPos = vec3.lerp(v1.position, v2.position, 0.5);
      const midVertex = engine.createVertex(midPos);
      newVertexIds.push(midVertex.id);

      if (edge) {
        edgeMidpointMap.set(edge.id, midVertex.id);
      }

      return midVertex.id;
    };

    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;

      const vertexIds = face.vertexIds;
      const n = vertexIds.length;

      if (n === 3) {
        // Triangle subdivision -> 4 triangles
        const mids = [
          getOrCreateEdgeMidpoint(vertexIds[0], vertexIds[1]),
          getOrCreateEdgeMidpoint(vertexIds[1], vertexIds[2]),
          getOrCreateEdgeMidpoint(vertexIds[2], vertexIds[0]),
        ];

        // 4 sub-triangles
        newFaceIds.push(engine.createFace([vertexIds[0], mids[0], mids[2]]).id);
        newFaceIds.push(engine.createFace([mids[0], vertexIds[1], mids[1]]).id);
        newFaceIds.push(engine.createFace([mids[2], mids[1], vertexIds[2]]).id);
        newFaceIds.push(engine.createFace([mids[0], mids[1], mids[2]]).id);

        // Create edges
        for (let i = 0; i < 3; i++) {
          const j = (i + 1) % 3;
          newEdgeIds.push(engine.createEdge(mids[i], mids[j]).id);
          newEdgeIds.push(engine.createEdge(vertexIds[i], mids[i]).id);
          newEdgeIds.push(engine.createEdge(mids[i], vertexIds[j]).id);
        }
      } else {
        // General polygon: create center vertex and split into quads
        const vertices = engine.getFaceVertices(faceId);
        const centerPos = this.computeCentroid(vertices);
        const centerVertex = engine.createVertex(centerPos);
        newVertexIds.push(centerVertex.id);

        const mids: string[] = [];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          mids.push(getOrCreateEdgeMidpoint(vertexIds[i], vertexIds[j]));
        }

        // Create N quad sub-faces
        for (let i = 0; i < n; i++) {
          const prevMid = mids[(i - 1 + n) % n];
          const nextMid = mids[i];
          const subFace = engine.createFace([vertexIds[i], nextMid, centerVertex.id, prevMid]);
          newFaceIds.push(subFace.id);

          // Edges from vertex to midpoint, midpoint to center
          newEdgeIds.push(engine.createEdge(vertexIds[i], nextMid).id);
          newEdgeIds.push(engine.createEdge(nextMid, centerVertex.id).id);
          newEdgeIds.push(engine.createEdge(centerVertex.id, prevMid).id);
        }
      }

      // Remove the original face
      engine.deleteFace(faceId);
      removedFaceIds.push(faceId);
    }

    return {
      success: true,
      newFaceIds,
      newEdgeIds,
      newVertexIds,
      removedFaceIds,
      iterationsPerformed: 1,
    };
  }

  /**
   * Catmull-Clark subdivision with boundary edge handling and crease support.
   *
   * For each face:
   * 1. Create a face point at the centroid.
   * 2. For each edge, create an edge point:
   *    - Interior edges: average of edge midpoint and adjacent face points.
   *    - Boundary edges: midpoint of the edge (no face point averaging).
   *    - Crease edges (edge.soft === false): midpoint of the edge.
   * 3. Move original vertices:
   *    - Interior vertices: (F + 2R + (n-3)P) / n
   *      where F = avg of adjacent face points, R = avg of adjacent edge midpoints,
   *      P = original position, n = valence.
   *    - Boundary vertices: (M1 + 6P + M2) / 8
   *      where M1, M2 are the midpoints of the two boundary edges.
   *    - Crease vertices: same as boundary rule using crease edges.
   * 4. Connect face point -> edge points -> vertex points to form new quads.
   */
  private catmullClark(engine: IGeometryEngine, faceIds: string[]): SubdivideResult {
    const newFaceIds: string[] = [];
    const newEdgeIds: string[] = [];
    const newVertexIds: string[] = [];
    const removedFaceIds: string[] = [];

    const faceIdSet = new Set(faceIds);

    // Classify edges and collect topology info
    const allEdges = new Set<string>();
    const edgeFaceCount = new Map<string, number>(); // how many of our faces touch this edge
    const vertexFaces = new Map<string, Set<string>>(); // vertex -> set of faceIds
    const vertexEdges = new Map<string, Set<string>>(); // vertex -> set of edgeIds

    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;

      for (const vid of face.vertexIds) {
        if (!vertexFaces.has(vid)) vertexFaces.set(vid, new Set());
        vertexFaces.get(vid)!.add(faceId);
      }

      const edges = engine.getFaceEdges(faceId);
      for (const edge of edges) {
        allEdges.add(edge.id);
        edgeFaceCount.set(edge.id, (edgeFaceCount.get(edge.id) ?? 0) + 1);

        // Track vertex-edge adjacency
        if (!vertexEdges.has(edge.startVertexId)) vertexEdges.set(edge.startVertexId, new Set());
        if (!vertexEdges.has(edge.endVertexId)) vertexEdges.set(edge.endVertexId, new Set());
        vertexEdges.get(edge.startVertexId)!.add(edge.id);
        vertexEdges.get(edge.endVertexId)!.add(edge.id);
      }
    }

    // Identify boundary and crease edges
    const isBoundaryEdge = (edgeId: string): boolean => {
      return (edgeFaceCount.get(edgeId) ?? 0) < 2;
    };

    const isCreaseEdge = (edgeId: string): boolean => {
      const edge = engine.getEdge(edgeId);
      return edge ? !edge.soft : false;
    };

    const isSharpEdge = (edgeId: string): boolean => {
      return isBoundaryEdge(edgeId) || isCreaseEdge(edgeId);
    };

    // Step 1: Compute face points
    const facePointMap = new Map<string, string>(); // faceId -> facePoint vertexId
    const facePointPositions = new Map<string, Vec3>();

    for (const faceId of faceIds) {
      const vertices = engine.getFaceVertices(faceId);
      if (vertices.length === 0) continue;
      const centroid = this.computeCentroid(vertices);
      const fp = engine.createVertex(centroid);
      facePointMap.set(faceId, fp.id);
      facePointPositions.set(faceId, centroid);
      newVertexIds.push(fp.id);
    }

    // Step 2: Compute edge points
    const edgePointMap = new Map<string, string>(); // edgeId -> edgePoint vertexId
    const processedEdges = new Set<string>();

    for (const faceId of faceIds) {
      const edges = engine.getFaceEdges(faceId);
      for (const edge of edges) {
        if (processedEdges.has(edge.id)) continue;
        processedEdges.add(edge.id);

        const v1 = engine.getVertex(edge.startVertexId)!;
        const v2 = engine.getVertex(edge.endVertexId)!;
        const edgeMid = vec3.lerp(v1.position, v2.position, 0.5);

        let edgePoint: Vec3;

        if (isBoundaryEdge(edge.id) || isCreaseEdge(edge.id)) {
          // Boundary/crease edge: edge point is just the midpoint
          edgePoint = edgeMid;
        } else {
          // Interior smooth edge: average of edge midpoint and adjacent face points
          const adjFaces = engine.getEdgeFaces(edge.id);
          const adjFacePoints: Vec3[] = [];
          for (const f of adjFaces) {
            const fpPos = facePointPositions.get(f.id);
            if (fpPos) {
              adjFacePoints.push(fpPos);
            }
          }

          if (adjFacePoints.length > 0) {
            let sum = edgeMid;
            for (const fp of adjFacePoints) {
              sum = vec3.add(sum, fp);
            }
            edgePoint = vec3.div(sum, 1 + adjFacePoints.length);
          } else {
            edgePoint = edgeMid;
          }
        }

        const ep = engine.createVertex(edgePoint);
        edgePointMap.set(edge.id, ep.id);
        newVertexIds.push(ep.id);
      }
    }

    // Step 3: Move original vertices (Catmull-Clark vertex rule)
    // We need to update vertex positions in-place. Collect all vertices that
    // are part of the subdivision and compute their new positions.
    const vertexNewPositions = new Map<string, Vec3>();

    for (const [vid, adjFaceSet] of vertexFaces) {
      const vertex = engine.getVertex(vid);
      if (!vertex) continue;

      const adjEdgeSet = vertexEdges.get(vid);
      if (!adjEdgeSet) continue;

      const adjEdgeIds = Array.from(adjEdgeSet);
      const sharpEdgeIds = adjEdgeIds.filter(eid => isSharpEdge(eid));

      const P = vertex.position;

      if (sharpEdgeIds.length > 2) {
        // Corner vertex: more than 2 sharp/boundary edges meet here.
        // Corner rule: vertex does not move.
        vertexNewPositions.set(vid, P);
      } else if (sharpEdgeIds.length === 2) {
        // Boundary/crease vertex: exactly 2 sharp edges.
        // Rule: (M1 + 6P + M2) / 8
        const m1Edge = engine.getEdge(sharpEdgeIds[0]);
        const m2Edge = engine.getEdge(sharpEdgeIds[1]);
        if (m1Edge && m2Edge) {
          const m1Other = m1Edge.startVertexId === vid ? m1Edge.endVertexId : m1Edge.startVertexId;
          const m2Other = m2Edge.startVertexId === vid ? m2Edge.endVertexId : m2Edge.startVertexId;
          const m1Pos = engine.getVertex(m1Other)?.position ?? P;
          const m2Pos = engine.getVertex(m2Other)?.position ?? P;
          const midM1 = vec3.lerp(P, m1Pos, 0.5);
          const midM2 = vec3.lerp(P, m2Pos, 0.5);
          vertexNewPositions.set(vid, vec3.div(
            vec3.add(vec3.add(midM1, vec3.mul(P, 6)), midM2),
            8,
          ));
        } else {
          vertexNewPositions.set(vid, P);
        }
      } else {
        // Interior vertex: (F + 2R + (n-3)P) / n
        const n = adjFaceSet.size;
        if (n === 0) {
          vertexNewPositions.set(vid, P);
          continue;
        }

        // F: average of adjacent face points
        let fSum = vec3.zero();
        let fCount = 0;
        for (const fid of adjFaceSet) {
          const fpPos = facePointPositions.get(fid);
          if (fpPos) {
            fSum = vec3.add(fSum, fpPos);
            fCount++;
          }
        }
        const F = fCount > 0 ? vec3.div(fSum, fCount) : P;

        // R: average of adjacent edge midpoints
        let rSum = vec3.zero();
        let rCount = 0;
        for (const eid of adjEdgeIds) {
          const e = engine.getEdge(eid);
          if (!e) continue;
          const ev1 = engine.getVertex(e.startVertexId);
          const ev2 = engine.getVertex(e.endVertexId);
          if (ev1 && ev2) {
            rSum = vec3.add(rSum, vec3.lerp(ev1.position, ev2.position, 0.5));
            rCount++;
          }
        }
        const R = rCount > 0 ? vec3.div(rSum, rCount) : P;

        const valence = Math.max(n, rCount);
        if (valence < 3) {
          vertexNewPositions.set(vid, P);
        } else {
          // (F + 2R + (n-3)P) / n
          const newPos = vec3.div(
            vec3.add(vec3.add(F, vec3.mul(R, 2)), vec3.mul(P, valence - 3)),
            valence,
          );
          vertexNewPositions.set(vid, newPos);
        }
      }
    }

    // Apply vertex position updates
    for (const [vid, newPos] of vertexNewPositions) {
      const vertex = engine.getVertex(vid);
      if (vertex) {
        vertex.position.x = newPos.x;
        vertex.position.y = newPos.y;
        vertex.position.z = newPos.z;
      }
    }

    // Step 4: Create new sub-faces
    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;

      const vertexIds = face.vertexIds;
      const n = vertexIds.length;
      const fpId = facePointMap.get(faceId)!;

      for (let i = 0; i < n; i++) {
        const prevIdx = (i - 1 + n) % n;
        const vid = vertexIds[i];

        // Find edge between prev vertex and current vertex
        const prevEdge = engine.findEdgeBetween(vertexIds[prevIdx], vid);
        // Find edge between current vertex and next vertex
        const nextEdge = engine.findEdgeBetween(vid, vertexIds[(i + 1) % n]);

        if (!prevEdge || !nextEdge) continue;

        const prevEpId = edgePointMap.get(prevEdge.id);
        const nextEpId = edgePointMap.get(nextEdge.id);

        if (!prevEpId || !nextEpId) continue;

        // Create quad: prevEdgePoint -> vertex -> nextEdgePoint -> facePoint
        const subFace = engine.createFace([prevEpId, vid, nextEpId, fpId]);
        newFaceIds.push(subFace.id);

        // Create connecting edges
        const ce1 = engine.createEdge(prevEpId, vid);
        const ce2 = engine.createEdge(vid, nextEpId);
        const ce3 = engine.createEdge(nextEpId, fpId);
        const ce4 = engine.createEdge(fpId, prevEpId);

        // Preserve crease: if the original edges were creases, the new edges
        // connecting to the edge points along the same original edge should also be creases.
        if (prevEdge && isCreaseEdge(prevEdge.id)) {
          ce1.soft = false;
          ce1.smooth = false;
        }
        if (nextEdge && isCreaseEdge(nextEdge.id)) {
          ce2.soft = false;
          ce2.smooth = false;
        }

        newEdgeIds.push(ce1.id, ce2.id, ce3.id, ce4.id);
      }

      engine.deleteFace(faceId);
      removedFaceIds.push(faceId);
    }

    return {
      success: true,
      newFaceIds,
      newEdgeIds,
      newVertexIds,
      removedFaceIds,
      iterationsPerformed: 1,
    };
  }

  private computeCentroid(vertices: IVertex[]): Vec3 {
    let sum = vec3.zero();
    for (const v of vertices) {
      sum = vec3.add(sum, v.position);
    }
    return vec3.div(sum, vertices.length);
  }
}
