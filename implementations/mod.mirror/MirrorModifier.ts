// @archigraph op.mirror
// Mirror modifier for DraftDown

import { Vec3, Plane } from '../../src/core/types';
import { IGeometryEngine, IFace, IVertex } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export interface MirrorParams {
  faceIds: string[];      // faces to mirror
  plane: Plane;           // mirror plane (normal + distance)
  mergeThreshold?: number; // distance within which mirrored vertices merge with originals (default: EPSILON * 100)
  deleteOriginal?: boolean; // if true, remove original geometry (default: false)
  /** If true, preserve material indices from source faces. Default: true */
  preserveMaterials?: boolean;
}

export interface MirrorResult {
  success: boolean;
  newFaceIds: string[];
  newEdgeIds: string[];
  newVertexIds: string[];
  mergedVertexIds: string[]; // vertices that were merged (on the mirror plane)
  error?: string;
}

/**
 * Mirror Modifier: mirrors geometry across a plane.
 *
 * Algorithm:
 * 1. Validate mirror plane orientation (normal must be non-zero).
 * 2. For each vertex, compute its reflection across the mirror plane.
 * 3. If a reflected vertex is within mergeThreshold of an existing vertex, merge them.
 * 4. Create mirrored faces with reversed winding (to maintain outward normals).
 * 5. Preserve material indices from source faces.
 * 6. Create edges for the mirrored faces.
 */
export class MirrorModifier {
  execute(engine: IGeometryEngine, params: MirrorParams): MirrorResult {
    const {
      faceIds,
      plane,
      mergeThreshold = EPSILON * 100,
      deleteOriginal = false,
      preserveMaterials = true,
    } = params;

    // --- Validation ---
    if (faceIds.length === 0) {
      return this.fail('No faces specified');
    }

    // Validate mirror plane normal
    const normalLen = vec3.length(plane.normal);
    if (normalLen < EPSILON) {
      return this.fail('Mirror plane normal must be non-zero');
    }

    // Normalize the plane normal for consistent distance calculations
    const normalizedPlane: Plane = {
      normal: vec3.div(plane.normal, normalLen),
      distance: plane.distance / normalLen,
    };

    // Validate that the normal is a valid direction (not NaN/Infinity)
    if (
      !isFinite(normalizedPlane.normal.x) ||
      !isFinite(normalizedPlane.normal.y) ||
      !isFinite(normalizedPlane.normal.z)
    ) {
      return this.fail('Mirror plane normal contains invalid values');
    }

    const newVertexIds: string[] = [];
    const newEdgeIds: string[] = [];
    const newFaceIds: string[] = [];
    const mergedVertexIds: string[] = [];

    // Collect all unique vertices from source faces
    const sourceVertexIdSet = new Set<string>();
    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;
      for (const vid of face.vertexIds) {
        sourceVertexIdSet.add(vid);
      }
    }

    // Build a spatial index of all source vertices for efficient merge lookup
    const sourceVertexPositions = new Map<string, Vec3>();
    for (const vid of sourceVertexIdSet) {
      const v = engine.getVertex(vid);
      if (v) {
        sourceVertexPositions.set(vid, v.position);
      }
    }

    // Map from original vertex ID to mirrored vertex ID
    const vertexMap = new Map<string, string>();
    const mergeThresholdSq = mergeThreshold * mergeThreshold;

    for (const vid of sourceVertexIdSet) {
      const v = engine.getVertex(vid);
      if (!v) continue;

      const reflected = this.reflectPoint(v.position, normalizedPlane);

      // Check if the reflected position is close to the original (vertex on mirror plane)
      if (vec3.distanceSq(reflected, v.position) < mergeThresholdSq) {
        // Vertex is on the mirror plane; map to itself
        vertexMap.set(vid, vid);
        mergedVertexIds.push(vid);
        continue;
      }

      // Check if the reflected position is close to any existing source vertex
      let merged = false;
      for (const [existingVid, existingPos] of sourceVertexPositions) {
        if (existingVid === vid) continue;
        if (vec3.distanceSq(reflected, existingPos) < mergeThresholdSq) {
          vertexMap.set(vid, existingVid);
          mergedVertexIds.push(existingVid);
          merged = true;
          break;
        }
      }

      // Also check against already-created mirrored vertices
      if (!merged) {
        for (const newVid of newVertexIds) {
          const nv = engine.getVertex(newVid);
          if (nv && vec3.distanceSq(reflected, nv.position) < mergeThresholdSq) {
            vertexMap.set(vid, newVid);
            mergedVertexIds.push(newVid);
            merged = true;
            break;
          }
        }
      }

      if (!merged) {
        // Create a new mirrored vertex
        const newVertex = engine.createVertex(reflected);
        vertexMap.set(vid, newVertex.id);
        newVertexIds.push(newVertex.id);
      }
    }

    // Create mirrored faces with reversed winding order
    const createdEdges = new Set<string>();

    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;

      // Map and reverse vertex order for correct normal orientation
      const mirroredVerts = face.vertexIds
        .map(vid => vertexMap.get(vid) ?? vid)
        .reverse();

      // Skip if mirrored face is identical to original (all vertices mapped to themselves)
      const isIdentical = face.vertexIds.every((vid) =>
        vertexMap.get(vid) === vid,
      );
      if (isIdentical) continue;

      // Check for degenerate mirrored face (fewer than 3 unique vertices)
      const uniqueVerts = new Set(mirroredVerts);
      if (uniqueVerts.size < 3) continue;

      const newFace = engine.createFace(mirroredVerts);
      newFaceIds.push(newFace.id);

      // Preserve material assignments
      if (preserveMaterials) {
        newFace.materialIndex = face.materialIndex;
        newFace.backMaterialIndex = face.backMaterialIndex;
      }

      // Create edges
      for (let i = 0; i < mirroredVerts.length; i++) {
        const j = (i + 1) % mirroredVerts.length;
        const edgeKey = [mirroredVerts[i], mirroredVerts[j]].sort().join('|');
        if (!createdEdges.has(edgeKey)) {
          createdEdges.add(edgeKey);
          const existing = engine.findEdgeBetween(mirroredVerts[i], mirroredVerts[j]);
          if (!existing) {
            const e = engine.createEdge(mirroredVerts[i], mirroredVerts[j]);
            newEdgeIds.push(e.id);
          }
        }
      }
    }

    // Optionally delete original geometry
    if (deleteOriginal) {
      for (const faceId of faceIds) {
        engine.deleteFace(faceId);
      }
    }

    return {
      success: true,
      newFaceIds,
      newEdgeIds,
      newVertexIds,
      mergedVertexIds,
    };
  }

  /**
   * Reflect a point across a plane.
   * reflected = point - 2 * (dot(point, normal) - distance) * normal
   */
  private reflectPoint(point: Vec3, plane: Plane): Vec3 {
    const dist = vec3.dot(point, plane.normal) - plane.distance;
    return vec3.sub(point, vec3.mul(plane.normal, 2 * dist));
  }

  private fail(error: string): MirrorResult {
    return {
      success: false,
      newFaceIds: [],
      newEdgeIds: [],
      newVertexIds: [],
      mergedVertexIds: [],
      error,
    };
  }
}
