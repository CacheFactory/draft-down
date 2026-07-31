// @archigraph op.extrude
// Push/Pull extrusion operation for DraftDown

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IFace, IVertex, IEdge } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export interface ExtrudeParams {
  faceId: string;
  distance: number; // positive = along normal, negative = reverse
}

export interface ExtrudeResult {
  success: boolean;
  newFaceId: string | null;        // the moved original face at new position
  sideFaceIds: string[];            // faces created along the extrusion sides
  newEdgeIds: string[];             // new edges created
  newVertexIds: string[];           // new vertices created
  error?: string;
}

export class ExtrudeOperation {
  /**
   * Extrudes a face along its normal by the given distance.
   *
   * Algorithm:
   * 1. Get the face and its ordered vertices/edges.
   * 2. Compute the extrusion direction (face normal * distance).
   * 3. Duplicate each vertex at offset position.
   * 4. Create side faces connecting original edges to new edges.
   * 5. Delete the original face and create a new cap face from the new vertices.
   */
  execute(engine: IGeometryEngine, params: ExtrudeParams): ExtrudeResult {
    const { faceId, distance } = params;

    if (Math.abs(distance) < EPSILON) {
      return { success: false, newFaceId: null, sideFaceIds: [], newEdgeIds: [], newVertexIds: [], error: 'Distance is zero' };
    }

    const face = engine.getFace(faceId);
    if (!face) {
      return { success: false, newFaceId: null, sideFaceIds: [], newEdgeIds: [], newVertexIds: [], error: `Face ${faceId} not found` };
    }

    const faceVertices = engine.getFaceVertices(faceId);
    if (faceVertices.length < 3) {
      return { success: false, newFaceId: null, sideFaceIds: [], newEdgeIds: [], newVertexIds: [], error: 'Face has fewer than 3 vertices' };
    }

    // Compute extrusion vector
    const normal = engine.computeFaceNormal(faceId);
    const extrudeVec = vec3.mul(normal, distance);

    const newVertexIds: string[] = [];
    const newEdgeIds: string[] = [];
    const sideFaceIds: string[] = [];

    // Map from original vertex ID to new (extruded) vertex ID
    const vertexMap = new Map<string, string>();

    // Step 1: Create new vertices at offset positions
    for (const v of faceVertices) {
      const newPos = vec3.add(v.position, extrudeVec);
      const newVertex = engine.createVertex(newPos);
      vertexMap.set(v.id, newVertex.id);
      newVertexIds.push(newVertex.id);
    }

    // Split vertexIds into separate loops: outer boundary + hole loops
    const allVertexIds = face.vertexIds;
    const holeStarts = face.holeStartIndices && face.holeStartIndices.length > 0
      ? [...face.holeStartIndices].sort((a, b) => a - b)
      : [];
    const loopBoundaries = [0, ...holeStarts, allVertexIds.length];
    const loops: string[][] = [];
    for (let li = 0; li < loopBoundaries.length - 1; li++) {
      loops.push(allVertexIds.slice(loopBoundaries[li], loopBoundaries[li + 1]));
    }

    // Step 2 & 3: For each loop, create cap edges, vertical edges, and side faces
    for (let li = 0; li < loops.length; li++) {
      const loop = loops[li];
      const isHole = li > 0;

      // Create cap edges for this loop
      const newCapLoop = loop.map(vid => vertexMap.get(vid)!);
      for (let i = 0; i < newCapLoop.length; i++) {
        const j = (i + 1) % newCapLoop.length;
        const edge = engine.createEdge(newCapLoop[i], newCapLoop[j]);
        newEdgeIds.push(edge.id);
      }

      // Create vertical edges
      for (const vid of loop) {
        const newVid = vertexMap.get(vid)!;
        // Avoid creating duplicate vertical edges (shared between outer and hole)
        const existing = engine.findEdgeBetween(vid, newVid);
        if (!existing) {
          const edge = engine.createEdge(vid, newVid);
          newEdgeIds.push(edge.id);
        }
      }

      // Create side faces for this loop
      for (let i = 0; i < loop.length; i++) {
        const j = (i + 1) % loop.length;
        const origA = loop[i];
        const origB = loop[j];
        const newA = vertexMap.get(origA)!;
        const newB = vertexMap.get(origB)!;

        // Side face winding: for outer boundary, origA -> origB -> newB -> newA
        // For holes, reverse winding so normals face outward (into the hole)
        const sideFace = isHole
          ? engine.createFace([origA, newA, newB, origB])
          : engine.createFace([origA, origB, newB, newA]);
        sideFaceIds.push(sideFace.id);
      }
    }

    // Step 4: Create the new cap face from the new vertices (preserving holes)
    // Create cap with just the outer boundary loop to avoid bridge edges
    const outerLoop = loops[0];
    const newCapOuter = outerLoop.map(vid => vertexMap.get(vid)!);
    const newFace = engine.createFace(newCapOuter);

    // If there are holes, append hole vertices and set holeStartIndices
    if (loops.length > 1) {
      for (let li = 1; li < loops.length; li++) {
        const holeStart = newFace.vertexIds.length;
        const newHoleVerts = loops[li].map(vid => vertexMap.get(vid)!);
        newFace.vertexIds.push(...newHoleVerts);
        if (!newFace.holeStartIndices) newFace.holeStartIndices = [];
        newFace.holeStartIndices.push(holeStart);
      }
      newFace.generation = Date.now();
    }

    // Step 5: Delete the original face (it is now interior to the extrusion)
    engine.deleteFace(faceId);

    return {
      success: true,
      newFaceId: newFace.id,
      sideFaceIds,
      newEdgeIds,
      newVertexIds,
    };
  }
}
