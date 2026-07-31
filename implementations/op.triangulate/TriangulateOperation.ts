// @archigraph op.triangulate
// Face triangulation using ear-clipping for DraftDown

import { Vec3, Vec2 } from '../../src/core/types';
import { IGeometryEngine, IFace, IVertex } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export interface TriangulateParams {
  faceIds: string[];  // faces to triangulate (empty = all non-triangle faces)
}

export interface TriangulateResult {
  success: boolean;
  newFaceIds: string[];
  newEdgeIds: string[];
  removedFaceIds: string[];
  triangleCount: number;
  error?: string;
}

/**
 * Triangulate Operation: converts n-gon faces into triangles using ear-clipping.
 *
 * Used for rendering (GPUs expect triangles) and export formats that require
 * triangulated meshes.
 *
 * Algorithm (ear-clipping):
 * 1. Compute best-fit plane via PCA/Newell for robust 2D projection.
 * 2. Project the polygon onto the best-fit 2D plane.
 * 3. Handle holes by bridging them into the outer polygon.
 * 4. Handle nearly-colinear vertices by removing them.
 * 5. Find "ear" vertices (triangle formed with neighbors is entirely inside polygon).
 * 6. Clip the ear (create triangle, remove vertex from polygon).
 * 7. Repeat until only a triangle remains.
 */
export class TriangulateOperation {
  execute(engine: IGeometryEngine, params: TriangulateParams): TriangulateResult {
    let faceIds = params.faceIds;

    if (faceIds.length === 0) {
      // Triangulate all non-triangle faces
      const mesh = engine.getMesh();
      faceIds = [];
      for (const [id, face] of mesh.faces) {
        if (face.vertexIds.length > 3) {
          faceIds.push(id);
        }
      }
    }

    const newFaceIds: string[] = [];
    const newEdgeIds: string[] = [];
    const removedFaceIds: string[] = [];
    let triangleCount = 0;

    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;

      const vertexIds = face.vertexIds;
      const n = vertexIds.length;

      if (n < 3) continue;
      if (n === 3) {
        // Already a triangle, skip
        continue;
      }

      const vertices = engine.getFaceVertices(faceId);
      const positions = vertices.map(v => v.position);

      // Compute best-fit plane normal using Newell's method
      const normal = this.computeNewellNormal(positions);
      const materialIndex = face.materialIndex;

      // Build the outer polygon vertex list
      let outerVertexIds = [...vertexIds];
      let outerPositions = [...positions];

      // Handle holes if present (via holeStartIndices on the face)
      if (face.holeStartIndices && face.holeStartIndices.length > 0) {
        const bridged = this.bridgeHoles(
          outerVertexIds,
          outerPositions,
          face.holeStartIndices,
          normal,
        );
        outerVertexIds = bridged.vertexIds;
        outerPositions = bridged.positions;
      }

      // Remove nearly-colinear vertices to prevent degenerate ears
      const cleaned = this.removeColinearVertices(outerVertexIds, outerPositions);
      const cleanedVertexIds = cleaned.vertexIds;
      const cleanedPositions = cleaned.positions;

      if (cleanedPositions.length < 3) {
        // Degenerate polygon after cleanup - skip
        continue;
      }

      // Project to 2D using best-fit plane
      const projected = this.projectTo2DBestFit(cleanedPositions, normal);

      // Run ear-clipping
      const triangles = this.earClip(projected, cleanedVertexIds);

      if (triangles.length === 0) {
        // Fallback: fan triangulation from vertex 0
        for (let i = 1; i < cleanedVertexIds.length - 1; i++) {
          const triFace = engine.createFace([cleanedVertexIds[0], cleanedVertexIds[i], cleanedVertexIds[i + 1]]);
          newFaceIds.push(triFace.id);
          triangleCount++;

          // Create diagonal edge if it does not already exist
          if (i > 1) {
            const existing = engine.findEdgeBetween(cleanedVertexIds[0], cleanedVertexIds[i]);
            if (!existing) {
              const e = engine.createEdge(cleanedVertexIds[0], cleanedVertexIds[i]);
              newEdgeIds.push(e.id);
            }
          }
        }
      } else {
        for (const tri of triangles) {
          const triFace = engine.createFace(tri);
          newFaceIds.push(triFace.id);
          triangleCount++;

          // Create internal diagonal edges
          for (let i = 0; i < 3; i++) {
            const j = (i + 1) % 3;
            const existing = engine.findEdgeBetween(tri[i], tri[j]);
            if (!existing) {
              const e = engine.createEdge(tri[i], tri[j]);
              newEdgeIds.push(e.id);
            }
          }
        }
      }

      // Remove the original n-gon face
      engine.deleteFace(faceId);
      removedFaceIds.push(faceId);
    }

    return {
      success: true,
      newFaceIds,
      newEdgeIds,
      removedFaceIds,
      triangleCount,
    };
  }

  /**
   * Compute the polygon normal using Newell's method, which is robust
   * for non-planar and concave polygons.
   */
  private computeNewellNormal(positions: Vec3[]): Vec3 {
    let nx = 0, ny = 0, nz = 0;
    const n = positions.length;
    for (let i = 0; i < n; i++) {
      const curr = positions[i];
      const next = positions[(i + 1) % n];
      nx += (curr.y - next.y) * (curr.z + next.z);
      ny += (curr.z - next.z) * (curr.x + next.x);
      nz += (curr.x - next.x) * (curr.y + next.y);
    }
    const raw = { x: nx, y: ny, z: nz };
    const len = vec3.length(raw);
    if (len < EPSILON) {
      // Degenerate - fall back to Z-up
      return { x: 0, y: 0, z: 1 };
    }
    return vec3.div(raw, len);
  }

  /**
   * Project 3D polygon vertices onto a 2D plane using a best-fit approach.
   * Constructs an orthonormal basis from the polygon normal and projects
   * vertices onto the resulting UV axes.
   */
  private projectTo2DBestFit(positions: Vec3[], normal: Vec3): Vec2[] {
    // Construct orthonormal basis (uAxis, vAxis) on the plane
    const uAxis = this.computePerpendicularVector(normal);
    const vAxis = vec3.normalize(vec3.cross(normal, uAxis));

    // Use the centroid as origin for better numerical stability
    let cx = 0, cy = 0, cz = 0;
    for (const p of positions) {
      cx += p.x; cy += p.y; cz += p.z;
    }
    const n = positions.length;
    const origin: Vec3 = { x: cx / n, y: cy / n, z: cz / n };

    return positions.map(p => {
      const d = vec3.sub(p, origin);
      return {
        x: vec3.dot(d, uAxis),
        y: vec3.dot(d, vAxis),
      };
    });
  }

  /**
   * Compute a vector perpendicular to the given normal.
   * Chooses the axis least parallel to the normal for numerical stability.
   */
  private computePerpendicularVector(normal: Vec3): Vec3 {
    const absX = Math.abs(normal.x);
    const absY = Math.abs(normal.y);
    const absZ = Math.abs(normal.z);

    let reference: Vec3;
    if (absX <= absY && absX <= absZ) {
      reference = { x: 1, y: 0, z: 0 };
    } else if (absY <= absX && absY <= absZ) {
      reference = { x: 0, y: 1, z: 0 };
    } else {
      reference = { x: 0, y: 0, z: 1 };
    }

    return vec3.normalize(vec3.cross(normal, reference));
  }

  /**
   * Remove nearly-colinear vertices from a polygon.
   * Two consecutive edges with a cross product magnitude below threshold
   * indicate the middle vertex is nearly colinear.
   */
  private removeColinearVertices(
    vertexIds: string[],
    positions: Vec3[],
  ): { vertexIds: string[]; positions: Vec3[] } {
    const colinearThreshold = EPSILON * 100;
    const resultIds: string[] = [];
    const resultPositions: Vec3[] = [];
    const n = vertexIds.length;

    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const next = (i + 1) % n;

      const v1 = vec3.sub(positions[i], positions[prev]);
      const v2 = vec3.sub(positions[next], positions[i]);

      // Check if cross product is near zero (colinear)
      const cross = vec3.cross(v1, v2);
      if (vec3.length(cross) > colinearThreshold || vec3.length(v1) < EPSILON || vec3.length(v2) < EPSILON) {
        // Keep vertex: either not colinear or zero-length edge (will be cleaned later)
        // Actually, keep if NOT colinear
        if (vec3.length(cross) > colinearThreshold) {
          resultIds.push(vertexIds[i]);
          resultPositions.push(positions[i]);
        }
        // Skip zero-length edge vertices
        else if (vec3.length(v1) < EPSILON || vec3.length(v2) < EPSILON) {
          // Zero-length: skip this vertex
        }
        // else: colinear, skip
      }
      // else: colinear, skip
    }

    // If we removed too many vertices, return original
    if (resultIds.length < 3) {
      return { vertexIds: [...vertexIds], positions: [...positions] };
    }

    return { vertexIds: resultIds, positions: resultPositions };
  }

  /**
   * Bridge holes into the outer polygon contour so ear-clipping can handle them.
   *
   * Algorithm (simplified):
   * For each hole, find the rightmost vertex. Draw a horizontal ray to the right.
   * Find the closest edge of the outer polygon intersected by this ray.
   * Insert a bridge (two coincident edges) connecting the hole to the outer contour.
   */
  private bridgeHoles(
    outerVertexIds: string[],
    outerPositions: Vec3[],
    holeStartIndices: number[],
    normal: Vec3,
  ): { vertexIds: string[]; positions: Vec3[] } {
    // Project everything to 2D for bridge computation
    const projected = this.projectTo2DBestFit(outerPositions, normal);

    // Parse hole boundaries from the vertex list
    const holes: Array<{ vertexIds: string[]; positions: Vec3[]; projected: Vec2[] }> = [];
    const sortedHoleStarts = [...holeStartIndices].sort((a, b) => a - b);

    // The outer contour is from 0 to the first hole start
    let outerEnd = sortedHoleStarts.length > 0 ? sortedHoleStarts[0] : outerVertexIds.length;
    let resultVertexIds = outerVertexIds.slice(0, outerEnd);
    let resultPositions = outerPositions.slice(0, outerEnd);
    let resultProjected = projected.slice(0, outerEnd);

    for (let h = 0; h < sortedHoleStarts.length; h++) {
      const start = sortedHoleStarts[h];
      const end = h + 1 < sortedHoleStarts.length ? sortedHoleStarts[h + 1] : outerVertexIds.length;
      holes.push({
        vertexIds: outerVertexIds.slice(start, end),
        positions: outerPositions.slice(start, end),
        projected: projected.slice(start, end),
      });
    }

    // Bridge each hole into the result polygon
    for (const hole of holes) {
      if (hole.vertexIds.length < 3) continue;

      // Find the rightmost vertex of the hole (max x in 2D)
      let maxX = -Infinity;
      let holeIdx = 0;
      for (let i = 0; i < hole.projected.length; i++) {
        if (hole.projected[i].x > maxX) {
          maxX = hole.projected[i].x;
          holeIdx = i;
        }
      }

      // Find the best vertex on the outer contour to bridge to.
      // Simple approach: find the nearest visible vertex on the outer polygon.
      const holePoint = hole.projected[holeIdx];
      let bestDist = Infinity;
      let bestOuterIdx = 0;

      const rp = this.projectTo2DBestFit(resultPositions, normal);

      for (let i = 0; i < rp.length; i++) {
        const dx = rp[i].x - holePoint.x;
        const dy = rp[i].y - holePoint.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist && rp[i].x >= holePoint.x) {
          bestDist = dist;
          bestOuterIdx = i;
        }
      }

      // Insert bridge: outer[bestOuterIdx] -> hole[holeIdx] -> ...hole... -> hole[holeIdx] -> outer[bestOuterIdx]
      const bridgedVertexIds: string[] = [];
      const bridgedPositions: Vec3[] = [];

      // Before bridge point
      for (let i = 0; i <= bestOuterIdx; i++) {
        bridgedVertexIds.push(resultVertexIds[i]);
        bridgedPositions.push(resultPositions[i]);
      }

      // Hole loop starting and ending at holeIdx
      const hn = hole.vertexIds.length;
      for (let i = 0; i <= hn; i++) {
        const idx = (holeIdx + i) % hn;
        bridgedVertexIds.push(hole.vertexIds[idx]);
        bridgedPositions.push(hole.positions[idx]);
      }

      // Bridge back (duplicate outer bridge vertex)
      bridgedVertexIds.push(resultVertexIds[bestOuterIdx]);
      bridgedPositions.push(resultPositions[bestOuterIdx]);

      // After bridge point
      for (let i = bestOuterIdx + 1; i < resultVertexIds.length; i++) {
        bridgedVertexIds.push(resultVertexIds[i]);
        bridgedPositions.push(resultPositions[i]);
      }

      resultVertexIds = bridgedVertexIds;
      resultPositions = bridgedPositions;
    }

    return { vertexIds: resultVertexIds, positions: resultPositions };
  }

  /**
   * Ear-clipping triangulation algorithm.
   *
   * Returns an array of triangles, each as [vertexId0, vertexId1, vertexId2].
   */
  private earClip(projected: Vec2[], vertexIds: string[]): string[][] {
    const n = projected.length;
    if (n < 3) return [];
    if (n === 3) return [[vertexIds[0], vertexIds[1], vertexIds[2]]];

    const triangles: string[][] = [];

    // Create a linked list of vertex indices
    const indices = Array.from({ length: n }, (_, i) => i);

    // Ensure the polygon is counter-clockwise
    if (this.signedArea2D(projected, indices) < 0) {
      indices.reverse();
    }

    let remaining = [...indices];
    let maxIterations = remaining.length * remaining.length; // Safety limit

    while (remaining.length > 3 && maxIterations > 0) {
      maxIterations--;
      let earFound = false;

      for (let i = 0; i < remaining.length; i++) {
        const prevIdx = (i - 1 + remaining.length) % remaining.length;
        const nextIdx = (i + 1) % remaining.length;

        const a = remaining[prevIdx];
        const b = remaining[i];
        const c = remaining[nextIdx];

        // Check if this vertex forms a convex angle
        if (!this.isConvex(projected[a], projected[b], projected[c])) {
          continue;
        }

        // For nearly-colinear ears, accept them if the triangle area is above threshold
        const triArea = Math.abs(this.cross2D(projected[a], projected[b], projected[c])) * 0.5;
        if (triArea < EPSILON * EPSILON) {
          // Degenerate ear - remove vertex without creating a triangle
          remaining.splice(i, 1);
          earFound = true;
          break;
        }

        // Check that no other vertex lies inside the ear triangle
        let isEar = true;
        for (let j = 0; j < remaining.length; j++) {
          if (j === prevIdx || j === i || j === nextIdx) continue;
          if (this.pointInTriangle(projected[remaining[j]], projected[a], projected[b], projected[c])) {
            isEar = false;
            break;
          }
        }

        if (isEar) {
          triangles.push([vertexIds[a], vertexIds[b], vertexIds[c]]);
          remaining.splice(i, 1);
          earFound = true;
          break;
        }
      }

      if (!earFound) {
        // No ear found (degenerate polygon). Fall back to remaining as-is.
        break;
      }
    }

    // Add the final triangle
    if (remaining.length === 3) {
      triangles.push([
        vertexIds[remaining[0]],
        vertexIds[remaining[1]],
        vertexIds[remaining[2]],
      ]);
    }

    return triangles;
  }

  /** Signed area of a 2D polygon (positive = CCW) */
  private signedArea2D(points: Vec2[], indices: number[]): number {
    let area = 0;
    const n = indices.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pi = points[indices[i]];
      const pj = points[indices[j]];
      area += (pi.x * pj.y) - (pj.x * pi.y);
    }
    return area * 0.5;
  }

  /** Check if angle at B is convex (CCW winding) */
  private isConvex(a: Vec2, b: Vec2, c: Vec2): boolean {
    return this.cross2D(a, b, c) > 0;
  }

  /** 2D cross product of vectors BA and BC */
  private cross2D(a: Vec2, b: Vec2, c: Vec2): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  /** Check if point P is inside triangle ABC using barycentric coordinates */
  private pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
    const d1 = this.cross2D(a, b, p);
    const d2 = this.cross2D(b, c, p);
    const d3 = this.cross2D(c, a, p);

    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);

    return !(hasNeg && hasPos);
  }
}
