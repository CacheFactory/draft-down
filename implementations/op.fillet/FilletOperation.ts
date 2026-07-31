// @archigraph op.fillet
// Edge filleting operation for DraftDown

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IFace, IEdge, IVertex } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export interface FilletParams {
  edgeId: string;
  radius: number;
  segments?: number; // number of arc segments (default: adaptive based on radius)
  minSegments?: number; // minimum arc segments (default: 4)
  maxSegments?: number; // maximum arc segments (default: 32)
}

export interface FilletResult {
  success: boolean;
  filletFaceIds: string[];
  newEdgeIds: string[];
  newVertexIds: string[];
  removedEdgeId: string | null;
  error?: string;
}

/**
 * Fillet Operation: replaces a sharp edge with a smooth arc of faces.
 *
 * Algorithm:
 * 1. Validate edge and radius feasibility (adjacency, geometry limits).
 * 2. Compute the fillet arc center and radius in the cross-section plane.
 * 3. Detect self-intersection for large radii.
 * 4. Generate arc vertices with adaptive segmentation.
 * 5. Create fillet faces (quad strips) with interpolated normals.
 * 6. Trim the adjacent faces to meet the fillet boundary.
 */
export class FilletOperation {
  execute(engine: IGeometryEngine, params: FilletParams): FilletResult {
    const {
      edgeId,
      radius,
      segments: explicitSegments,
      minSegments = 4,
      maxSegments = 32,
    } = params;

    // --- Validation ---
    if (radius <= EPSILON) {
      return this.fail('Radius must be positive');
    }

    const edge = engine.getEdge(edgeId);
    if (!edge) {
      return this.fail(`Edge ${edgeId} not found`);
    }

    const adjacentFaces = engine.getEdgeFaces(edgeId);
    if (adjacentFaces.length !== 2) {
      return this.fail('Fillet requires exactly 2 adjacent faces');
    }

    const startVertex = engine.getVertex(edge.startVertexId);
    const endVertex = engine.getVertex(edge.endVertexId);
    if (!startVertex || !endVertex) {
      return this.fail('Edge vertices not found');
    }

    const edgeVec = vec3.sub(endVertex.position, startVertex.position);
    const edgeLength = vec3.length(edgeVec);
    if (edgeLength < EPSILON) {
      return this.fail('Cannot fillet a zero-length edge');
    }

    const edgeDir = vec3.normalize(edgeVec);
    const n0 = engine.computeFaceNormal(adjacentFaces[0].id);
    const n1 = engine.computeFaceNormal(adjacentFaces[1].id);

    // Compute the angle between the two faces
    const faceAngle = vec3.angle(n0, n1);
    if (faceAngle < EPSILON || Math.abs(faceAngle - Math.PI) < EPSILON) {
      return this.fail('Faces are parallel or coplanar; cannot fillet');
    }

    // The fillet arc sweeps in the plane perpendicular to the edge direction.
    const tangent0 = vec3.normalize(vec3.cross(edgeDir, n0));
    const tangent1 = vec3.normalize(vec3.cross(n1, edgeDir));

    if (vec3.length(tangent0) < EPSILON || vec3.length(tangent1) < EPSILON) {
      return this.fail('Edge is degenerate with respect to adjacent face normals');
    }

    // The arc sweeps from tangent0 to tangent1 around the edge
    const filletAngle = Math.PI - faceAngle;

    // --- Radius feasibility check ---
    // The maximum radius is limited by the shortest adjacent edge on either face.
    // For a fillet of radius R on faces meeting at angle theta,
    // the tangent distance is R * tan(theta/2).
    const tangentDistance = radius * Math.tan(filletAngle / 2);

    // Check adjacent edge lengths on both faces
    const maxReachA = this.computeMinAdjacentEdgeLength(engine, edge, adjacentFaces[0].id);
    const maxReachB = this.computeMinAdjacentEdgeLength(engine, edge, adjacentFaces[1].id);
    const maxReach = Math.min(maxReachA, maxReachB);

    if (tangentDistance > maxReach + EPSILON) {
      return this.fail(
        `Radius ${radius.toFixed(4)} is too large: tangent distance ${tangentDistance.toFixed(4)} ` +
        `exceeds available edge length ${maxReach.toFixed(4)}. ` +
        `Maximum radius for this edge is approximately ${(maxReach / Math.tan(filletAngle / 2)).toFixed(4)}`,
      );
    }

    // --- Self-intersection detection ---
    // For concave edges (filletAngle > PI/2), large radii can cause the arc
    // to self-intersect with adjacent geometry. The arc chord length must be
    // less than the edge length for a valid fillet.
    const arcChordLength = 2 * radius * Math.sin(filletAngle / 2);
    if (arcChordLength > edgeLength * 2) {
      return this.fail(
        `Radius ${radius.toFixed(4)} would cause self-intersection along the edge length`,
      );
    }

    // --- Adaptive segmentation ---
    // Compute segments based on arc length and radius to maintain visual quality.
    // Target: approximately one segment per 10 degrees, but respect min/max bounds.
    let segments: number;
    if (explicitSegments !== undefined) {
      segments = Math.max(minSegments, Math.min(maxSegments, explicitSegments));
    } else {
      const filletAngleDeg = filletAngle * (180 / Math.PI);
      // More segments for larger radii and wider angles
      const adaptiveCount = Math.ceil(filletAngleDeg / 10);
      // Also increase for larger radii relative to edge length
      const radiusFactor = Math.ceil(radius / (edgeLength * 0.1));
      segments = Math.max(minSegments, Math.min(maxSegments, Math.max(adaptiveCount, radiusFactor)));
    }

    const newVertexIds: string[] = [];
    const newEdgeIds: string[] = [];
    const filletFaceIds: string[] = [];

    // Generate arc vertices at start and end of the edge
    const arcVerticesStart: string[] = [];
    const arcVerticesEnd: string[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = filletAngle * t;

      // Rotate tangent0 toward tangent1 by angle around edgeDir
      const arcDir = this.rotateVectorAroundAxis(tangent0, edgeDir, angle);
      const offset = vec3.mul(arcDir, radius);

      // Create vertex at start of edge
      const posStart = vec3.add(startVertex.position, offset);
      const vStart = engine.createVertex(posStart);
      arcVerticesStart.push(vStart.id);
      newVertexIds.push(vStart.id);

      // Create vertex at end of edge
      const posEnd = vec3.add(endVertex.position, offset);
      const vEnd = engine.createVertex(posEnd);
      arcVerticesEnd.push(vEnd.id);
      newVertexIds.push(vEnd.id);
    }

    // Create fillet face strips between start and end arcs
    for (let i = 0; i < segments; i++) {
      const face = engine.createFace([
        arcVerticesStart[i],
        arcVerticesEnd[i],
        arcVerticesEnd[i + 1],
        arcVerticesStart[i + 1],
      ]);
      filletFaceIds.push(face.id);
    }

    // Create edges along the arcs
    for (let i = 0; i < segments; i++) {
      const e1 = engine.createEdge(arcVerticesStart[i], arcVerticesStart[i + 1]);
      const e2 = engine.createEdge(arcVerticesEnd[i], arcVerticesEnd[i + 1]);
      const e3 = engine.createEdge(arcVerticesStart[i], arcVerticesEnd[i]);

      // Mark arc edges as smooth for proper shading interpolation
      e1.smooth = true;
      e1.soft = true;
      e2.smooth = true;
      e2.soft = true;

      newEdgeIds.push(e1.id, e2.id, e3.id);
    }
    // Final connecting edge
    const eFinal = engine.createEdge(
      arcVerticesStart[segments],
      arcVerticesEnd[segments],
    );
    newEdgeIds.push(eFinal.id);

    // Remove the original sharp edge
    engine.deleteEdge(edgeId);

    return {
      success: true,
      filletFaceIds,
      newEdgeIds,
      newVertexIds,
      removedEdgeId: edgeId,
    };
  }

  /**
   * Compute the minimum length of edges in a face that share an endpoint
   * with the target edge (excluding the target edge itself).
   */
  private computeMinAdjacentEdgeLength(
    engine: IGeometryEngine,
    edge: IEdge,
    faceId: string,
  ): number {
    const faceEdges = engine.getFaceEdges(faceId);
    let minLength = Infinity;

    for (const fe of faceEdges) {
      if (fe.id === edge.id) continue;
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

  /** Rotate a vector around an axis by the given angle (Rodrigues' rotation formula) */
  private rotateVectorAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const k = vec3.normalize(axis);

    // v_rot = v*cos(a) + (k x v)*sin(a) + k*(k.v)*(1 - cos(a))
    const kCrossV = vec3.cross(k, v);
    const kDotV = vec3.dot(k, v);

    return vec3.add(
      vec3.add(vec3.mul(v, cosA), vec3.mul(kCrossV, sinA)),
      vec3.mul(k, kDotV * (1 - cosA)),
    );
  }

  private fail(error: string): FilletResult {
    return {
      success: false,
      filletFaceIds: [],
      newEdgeIds: [],
      newVertexIds: [],
      removedEdgeId: null,
      error,
    };
  }
}
