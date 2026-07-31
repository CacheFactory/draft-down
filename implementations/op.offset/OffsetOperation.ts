// @archigraph op.offset
// Face offset (inset/outset) operation for DraftDown

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IFace, IVertex, IEdge } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export interface OffsetParams {
  faceId: string;
  distance: number; // positive = inset, negative = outset
}

export interface OffsetResult {
  success: boolean;
  innerFaceId: string | null;       // the offset (inner/outer) face
  connectingFaceIds: string[];       // faces connecting original boundary to offset
  newEdgeIds: string[];
  newVertexIds: string[];
  error?: string;
}

/**
 * Offset Operation: creates an inset or outset copy of a face's boundary
 * within the face plane, then creates connecting faces between the original
 * and offset boundaries.
 *
 * Algorithm:
 * 1. Get face vertices and normal.
 * 2. Compute the offset direction for each edge (inward perpendicular in the face plane).
 * 3. For each vertex, compute the intersection of the two adjacent offset edge lines
 *    to get the offset vertex position.
 * 4. Create the offset face from the new vertices.
 * 5. Create connecting quad faces between original and offset edges.
 * 6. Delete the original face (replaced by the ring of connecting faces + inner face).
 */
export class OffsetOperation {
  execute(engine: IGeometryEngine, params: OffsetParams): OffsetResult {
    const { faceId, distance } = params;

    if (Math.abs(distance) < EPSILON) {
      return { success: false, innerFaceId: null, connectingFaceIds: [], newEdgeIds: [], newVertexIds: [], error: 'Distance is zero' };
    }

    const face = engine.getFace(faceId);
    if (!face) {
      return { success: false, innerFaceId: null, connectingFaceIds: [], newEdgeIds: [], newVertexIds: [], error: `Face ${faceId} not found` };
    }

    const vertexIds = face.vertexIds;
    const n = vertexIds.length;
    if (n < 3) {
      return { success: false, innerFaceId: null, connectingFaceIds: [], newEdgeIds: [], newVertexIds: [], error: 'Face has fewer than 3 vertices' };
    }

    const normal = engine.computeFaceNormal(faceId);

    // Get positions in order
    const positions: Vec3[] = vertexIds.map(vid => engine.getVertex(vid)!.position);

    // Compute offset positions using the miter method
    const offsetPositions = this.computeOffsetPolygon(positions, normal, distance);

    if (!offsetPositions) {
      return { success: false, innerFaceId: null, connectingFaceIds: [], newEdgeIds: [], newVertexIds: [], error: 'Failed to compute offset polygon (degenerate geometry)' };
    }

    const newVertexIds: string[] = [];
    const newEdgeIds: string[] = [];
    const connectingFaceIds: string[] = [];

    // Create offset vertices
    const offsetVertexIds: string[] = [];
    for (const pos of offsetPositions) {
      const v = engine.createVertex(pos);
      offsetVertexIds.push(v.id);
      newVertexIds.push(v.id);
    }

    // Create edges for the offset polygon
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e = engine.createEdge(offsetVertexIds[i], offsetVertexIds[j]);
      newEdgeIds.push(e.id);
    }

    // Create connecting edges (original vertex to offset vertex)
    for (let i = 0; i < n; i++) {
      const e = engine.createEdge(vertexIds[i], offsetVertexIds[i]);
      newEdgeIds.push(e.id);
    }

    // Create the inner offset face
    const innerFace = engine.createFace(offsetVertexIds);

    // Create connecting quad faces between original and offset boundaries
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // Quad: origA -> origB -> offsetB -> offsetA
      const connectFace = engine.createFace([
        vertexIds[i],
        vertexIds[j],
        offsetVertexIds[j],
        offsetVertexIds[i],
      ]);
      connectingFaceIds.push(connectFace.id);
    }

    // Delete the original face (replaced by inner face + connecting faces)
    engine.deleteFace(faceId);

    return {
      success: true,
      innerFaceId: innerFace.id,
      connectingFaceIds,
      newEdgeIds,
      newVertexIds,
    };
  }

  /**
   * Compute an offset polygon using the miter method.
   *
   * For each edge, compute the inward-facing perpendicular direction in the face plane.
   * At each vertex, intersect the two adjacent offset edge lines to find the miter point.
   */
  private computeOffsetPolygon(positions: Vec3[], normal: Vec3, distance: number): Vec3[] | null {
    const n = positions.length;
    const offsetPositions: Vec3[] = [];

    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const next = (i + 1) % n;

      // Edge directions
      const ePrev = vec3.normalize(vec3.sub(positions[i], positions[prev]));
      const eNext = vec3.normalize(vec3.sub(positions[next], positions[i]));

      // Inward perpendiculars (rotate edge direction 90 degrees inward in the face plane)
      const inPrev = vec3.normalize(vec3.cross(normal, ePrev));
      const inNext = vec3.normalize(vec3.cross(normal, eNext));

      // Miter direction: average of the two inward normals
      const miter = vec3.add(inPrev, inNext);
      const miterLen = vec3.length(miter);

      if (miterLen < EPSILON) {
        // Edges are parallel going opposite directions; degenerate case
        return null;
      }

      const miterDir = vec3.div(miter, miterLen);

      // The miter length needs to be adjusted to maintain the correct offset distance.
      // The actual offset along the miter = distance / cos(half_angle)
      // cos(half_angle) = dot(miterDir, inPrev)
      const cosHalfAngle = vec3.dot(miterDir, inPrev);
      if (Math.abs(cosHalfAngle) < EPSILON) {
        return null; // Degenerate miter (180-degree turn)
      }

      const miterDistance = distance / cosHalfAngle;

      // Clamp miter distance to avoid spikes on very acute angles
      const maxMiter = Math.abs(distance) * 4;
      const clampedDistance = Math.sign(miterDistance) * Math.min(Math.abs(miterDistance), maxMiter);

      const offsetPos = vec3.add(positions[i], vec3.mul(miterDir, clampedDistance));
      offsetPositions.push(offsetPos);
    }

    return offsetPositions;
  }
}
