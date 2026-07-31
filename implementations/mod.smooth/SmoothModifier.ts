// @archigraph op.smooth
// Smooth/soften edges modifier with Catmull-Clark subdivision for DraftDown

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IEdge, IFace, IVertex } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

/** Maximum subdivision iterations to prevent geometry explosion. */
const MAX_SMOOTH_ITERATIONS = 5;

export interface SmoothParams {
  /** Edge IDs to process. Empty = all edges in the mesh. */
  edgeIds?: string[];
  /** Angle threshold in radians. Edges between faces with dihedral angle
   *  less than this are smoothed/softened. */
  angleThreshold: number;
  /** Set the soft flag (hides edge line in rendering). Default: true */
  setSoft?: boolean;
  /** Set the smooth flag (interpolates normals across the edge). Default: true */
  setSmooth?: boolean;
  /** If true, perform actual Catmull-Clark subdivision smoothing (geometry modification).
   *  If false (default), only set edge flags. */
  subdivisionSmooth?: boolean;
  /** Number of subdivision iterations (only used when subdivisionSmooth=true). Default: 1. Max: 5. */
  iterations?: number;
  /** Face IDs to subdivide (only used when subdivisionSmooth=true). Empty = all faces. */
  faceIds?: string[];
}

export interface SmoothResult {
  success: boolean;
  smoothedEdgeIds: string[];   // edges that were smoothed
  hardEdgeIds: string[];       // edges that remain hard
  /** New faces created by subdivision (only when subdivisionSmooth=true) */
  newFaceIds: string[];
  /** Faces removed by subdivision (only when subdivisionSmooth=true) */
  removedFaceIds: string[];
  /** New vertices created by subdivision */
  newVertexIds: string[];
  iterationsPerformed: number;
  error?: string;
}

/**
 * Smooth Modifier: provides two modes of smoothing.
 *
 * 1. Edge flag smoothing (default): sets soft/smooth flags on edges based on the
 *    dihedral angle between adjacent faces. This affects rendering only.
 *    - Soft edges are not rendered as visible lines (cosmetic).
 *    - Smooth edges interpolate vertex normals across the edge (affects shading).
 *
 * 2. Subdivision smoothing (subdivisionSmooth=true): performs actual Catmull-Clark
 *    subdivision to geometrically smooth the mesh. Supports:
 *    - Multi-pass subdivision with configurable iteration count (max 5).
 *    - Crease edge support: edges with soft=false are treated as creases and
 *      maintain their sharpness during subdivision.
 *    - Boundary edge handling for open meshes.
 */
export class SmoothModifier {
  execute(engine: IGeometryEngine, params: SmoothParams): SmoothResult {
    const {
      edgeIds,
      angleThreshold,
      setSoft = true,
      setSmooth = true,
      subdivisionSmooth = false,
      iterations: requestedIterations = 1,
      faceIds,
    } = params;

    // Step 1: Always apply edge flag smoothing first
    const flagResult = this.applyEdgeFlags(engine, edgeIds, angleThreshold, setSoft, setSmooth);

    if (!subdivisionSmooth) {
      return {
        ...flagResult,
        newFaceIds: [],
        removedFaceIds: [],
        newVertexIds: [],
        iterationsPerformed: 0,
      };
    }

    // Step 2: Subdivision smoothing
    const iterations = Math.max(1, Math.min(MAX_SMOOTH_ITERATIONS, requestedIterations));

    let currentFaceIds = faceIds && faceIds.length > 0
      ? [...faceIds]
      : Array.from(engine.getMesh().faces.keys());

    const allNewFaceIds: string[] = [];
    const allRemovedFaceIds: string[] = [];
    const allNewVertexIds: string[] = [];
    let iterationsPerformed = 0;

    for (let iter = 0; iter < iterations; iter++) {
      const result = this.catmullClarkSubdivide(engine, currentFaceIds);

      if (!result.success) {
        return {
          ...flagResult,
          newFaceIds: allNewFaceIds,
          removedFaceIds: allRemovedFaceIds,
          newVertexIds: allNewVertexIds,
          iterationsPerformed,
          error: result.error,
        };
      }

      allNewFaceIds.push(...result.newFaceIds);
      allRemovedFaceIds.push(...result.removedFaceIds);
      allNewVertexIds.push(...result.newVertexIds);
      iterationsPerformed++;

      currentFaceIds = result.newFaceIds;

      // Apply edge flags to newly created edges after subdivision
      const newEdgeIds = Array.from(engine.getMesh().edges.keys());
      this.applyEdgeFlags(engine, newEdgeIds, angleThreshold, setSoft, setSmooth);
    }

    return {
      success: true,
      smoothedEdgeIds: flagResult.smoothedEdgeIds,
      hardEdgeIds: flagResult.hardEdgeIds,
      newFaceIds: allNewFaceIds,
      removedFaceIds: allRemovedFaceIds,
      newVertexIds: allNewVertexIds,
      iterationsPerformed,
    };
  }

  /**
   * Apply soft/smooth edge flags based on dihedral angle threshold.
   */
  private applyEdgeFlags(
    engine: IGeometryEngine,
    edgeIds: string[] | undefined,
    angleThreshold: number,
    setSoft: boolean,
    setSmooth: boolean,
  ): { success: boolean; smoothedEdgeIds: string[]; hardEdgeIds: string[] } {
    const mesh = engine.getMesh();

    const targetEdgeIds = edgeIds && edgeIds.length > 0
      ? edgeIds
      : Array.from(mesh.edges.keys());

    const smoothedEdgeIds: string[] = [];
    const hardEdgeIds: string[] = [];

    for (const edgeId of targetEdgeIds) {
      const edge = engine.getEdge(edgeId);
      if (!edge) continue;

      const adjFaces = engine.getEdgeFaces(edgeId);

      if (adjFaces.length !== 2) {
        // Boundary or non-manifold edge: keep hard
        hardEdgeIds.push(edgeId);
        continue;
      }

      // Compute dihedral angle between the two faces
      const n0 = engine.computeFaceNormal(adjFaces[0].id);
      const n1 = engine.computeFaceNormal(adjFaces[1].id);
      const dihedralAngle = vec3.angle(n0, n1);

      if (dihedralAngle <= angleThreshold) {
        // Smooth this edge
        edge.soft = setSoft;
        edge.smooth = setSmooth;
        smoothedEdgeIds.push(edgeId);
      } else {
        // Keep hard
        edge.soft = false;
        edge.smooth = false;
        hardEdgeIds.push(edgeId);
      }
    }

    return { success: true, smoothedEdgeIds, hardEdgeIds };
  }

  /**
   * Catmull-Clark subdivision with crease edge and boundary edge support.
   *
   * For each face:
   * 1. Create a face point at the centroid.
   * 2. For each edge, create an edge point:
   *    - Interior smooth: average of edge midpoint and adjacent face points.
   *    - Boundary/crease: midpoint of the edge.
   * 3. Move original vertices:
   *    - Interior: (F + 2R + (n-3)P) / n
   *    - Boundary/crease (2 sharp edges): (M1 + 6P + M2) / 8
   *    - Corner (>2 sharp edges): no movement
   * 4. Connect face point -> edge points -> vertex points to form new quads.
   */
  private catmullClarkSubdivide(
    engine: IGeometryEngine,
    faceIds: string[],
  ): { success: boolean; newFaceIds: string[]; removedFaceIds: string[]; newVertexIds: string[]; error?: string } {
    const newFaceIds: string[] = [];
    const removedFaceIds: string[] = [];
    const newVertexIds: string[] = [];

    // Build topology maps
    const edgeFaceCount = new Map<string, number>();
    const vertexFaces = new Map<string, Set<string>>();
    const vertexEdges = new Map<string, Set<string>>();

    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;

      for (const vid of face.vertexIds) {
        if (!vertexFaces.has(vid)) vertexFaces.set(vid, new Set());
        vertexFaces.get(vid)!.add(faceId);
      }

      const edges = engine.getFaceEdges(faceId);
      for (const edge of edges) {
        edgeFaceCount.set(edge.id, (edgeFaceCount.get(edge.id) ?? 0) + 1);
        if (!vertexEdges.has(edge.startVertexId)) vertexEdges.set(edge.startVertexId, new Set());
        if (!vertexEdges.has(edge.endVertexId)) vertexEdges.set(edge.endVertexId, new Set());
        vertexEdges.get(edge.startVertexId)!.add(edge.id);
        vertexEdges.get(edge.endVertexId)!.add(edge.id);
      }
    }

    const isBoundaryEdge = (edgeId: string): boolean => (edgeFaceCount.get(edgeId) ?? 0) < 2;
    const isCreaseEdge = (edgeId: string): boolean => {
      const edge = engine.getEdge(edgeId);
      return edge ? !edge.soft : false;
    };
    const isSharpEdge = (edgeId: string): boolean => isBoundaryEdge(edgeId) || isCreaseEdge(edgeId);

    // Step 1: Face points
    const facePointMap = new Map<string, string>();
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

    // Step 2: Edge points
    const edgePointMap = new Map<string, string>();
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
        if (isSharpEdge(edge.id)) {
          edgePoint = edgeMid;
        } else {
          const adjFaces = engine.getEdgeFaces(edge.id);
          const adjFacePoints: Vec3[] = [];
          for (const f of adjFaces) {
            const fpPos = facePointPositions.get(f.id);
            if (fpPos) adjFacePoints.push(fpPos);
          }

          if (adjFacePoints.length > 0) {
            let sum = edgeMid;
            for (const fp of adjFacePoints) sum = vec3.add(sum, fp);
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

    // Step 3: Move original vertices
    for (const [vid, adjFaceSet] of vertexFaces) {
      const vertex = engine.getVertex(vid);
      if (!vertex) continue;

      const adjEdgeSet = vertexEdges.get(vid);
      if (!adjEdgeSet) continue;

      const adjEdgeIds = Array.from(adjEdgeSet);
      const sharpEdgeIds = adjEdgeIds.filter(eid => isSharpEdge(eid));
      const P = vertex.position;

      let newPos: Vec3;

      if (sharpEdgeIds.length > 2) {
        // Corner vertex: does not move
        newPos = P;
      } else if (sharpEdgeIds.length === 2) {
        // Boundary/crease vertex
        const m1Edge = engine.getEdge(sharpEdgeIds[0]);
        const m2Edge = engine.getEdge(sharpEdgeIds[1]);
        if (m1Edge && m2Edge) {
          const m1Other = m1Edge.startVertexId === vid ? m1Edge.endVertexId : m1Edge.startVertexId;
          const m2Other = m2Edge.startVertexId === vid ? m2Edge.endVertexId : m2Edge.startVertexId;
          const m1Pos = engine.getVertex(m1Other)?.position ?? P;
          const m2Pos = engine.getVertex(m2Other)?.position ?? P;
          const midM1 = vec3.lerp(P, m1Pos, 0.5);
          const midM2 = vec3.lerp(P, m2Pos, 0.5);
          newPos = vec3.div(vec3.add(vec3.add(midM1, vec3.mul(P, 6)), midM2), 8);
        } else {
          newPos = P;
        }
      } else {
        // Interior vertex: (F + 2R + (n-3)P) / n
        const n = adjFaceSet.size;
        if (n === 0) { newPos = P; } else {
          let fSum = vec3.zero();
          let fCount = 0;
          for (const fid of adjFaceSet) {
            const fpPos = facePointPositions.get(fid);
            if (fpPos) { fSum = vec3.add(fSum, fpPos); fCount++; }
          }
          const F = fCount > 0 ? vec3.div(fSum, fCount) : P;

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
            newPos = P;
          } else {
            newPos = vec3.div(
              vec3.add(vec3.add(F, vec3.mul(R, 2)), vec3.mul(P, valence - 3)),
              valence,
            );
          }
        }
      }

      vertex.position.x = newPos.x;
      vertex.position.y = newPos.y;
      vertex.position.z = newPos.z;
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

        const prevEdge = engine.findEdgeBetween(vertexIds[prevIdx], vid);
        const nextEdge = engine.findEdgeBetween(vid, vertexIds[(i + 1) % n]);
        if (!prevEdge || !nextEdge) continue;

        const prevEpId = edgePointMap.get(prevEdge.id);
        const nextEpId = edgePointMap.get(nextEdge.id);
        if (!prevEpId || !nextEpId) continue;

        const subFace = engine.createFace([prevEpId, vid, nextEpId, fpId]);
        newFaceIds.push(subFace.id);

        // Create connecting edges and preserve crease flags
        const ce1 = engine.createEdge(prevEpId, vid);
        const ce2 = engine.createEdge(vid, nextEpId);
        const ce3 = engine.createEdge(nextEpId, fpId);
        const ce4 = engine.createEdge(fpId, prevEpId);

        // Propagate crease to subdivided edges
        if (isCreaseEdge(prevEdge.id)) {
          ce1.soft = false;
          ce1.smooth = false;
        }
        if (isCreaseEdge(nextEdge.id)) {
          ce2.soft = false;
          ce2.smooth = false;
        }
      }

      engine.deleteFace(faceId);
      removedFaceIds.push(faceId);
    }

    return { success: true, newFaceIds, removedFaceIds, newVertexIds };
  }

  private computeCentroid(vertices: IVertex[]): Vec3 {
    let sum = vec3.zero();
    for (const v of vertices) {
      sum = vec3.add(sum, v.position);
    }
    return vec3.div(sum, vertices.length);
  }
}
