// @archigraph op.intersect-faces
// Face intersection operation for DraftDown

import { Vec3, Plane, BoundingBox } from '../../src/core/types';
import { IGeometryEngine, IFace, IVertex, IEdge } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export interface IntersectFacesParams {
  /** Intersect two specific faces. If omitted, performs model-wide intersection. */
  faceIdA?: string;
  faceIdB?: string;
  /** Face IDs to check for intersections. If empty and no A/B specified, uses all faces. */
  faceIds?: string[];
  /** Numerical tolerance for intersection tests. Default: EPSILON * 100 */
  epsilon?: number;
}

export interface IntersectFacesResult {
  success: boolean;
  intersectionEdgeIds: string[];      // new edges at the intersection
  intersectionVertexIds: string[];    // new vertices at intersection points
  splitFaceIds: string[];             // new faces from splitting originals
  removedFaceIds: string[];           // original faces that were split
  hasIntersection: boolean;
  /** Number of face pairs tested */
  pairsChecked: number;
  error?: string;
}

/**
 * Intersect Faces Operation: finds intersection lines between overlapping faces
 * and splits faces along those lines.
 *
 * Supports:
 * - Two-face intersection (classic mode)
 * - Model-wide intersection with spatial acceleration (bounding box pre-check)
 * - Configurable numerical epsilon for robustness
 * - Degenerate case handling (coplanar faces, tangent intersections, single-point)
 *
 * Algorithm (per face pair):
 * 1. Bounding box overlap test (early rejection).
 * 2. Compute the intersection line of the two face planes.
 * 3. Handle coplanar faces separately.
 * 4. Clip the intersection line to each face's polygon boundary.
 * 5. The overlap of those two clipped segments is the actual intersection.
 * 6. Create vertices at the intersection endpoints.
 * 7. Split each face along the intersection edge.
 */
export class IntersectFacesOperation {
  execute(engine: IGeometryEngine, params: IntersectFacesParams): IntersectFacesResult {
    const eps = params.epsilon ?? EPSILON * 100;

    // --- Mode selection ---
    if (params.faceIdA !== undefined && params.faceIdB !== undefined) {
      // Two-face mode
      const result = this.intersectPair(engine, params.faceIdA, params.faceIdB, eps);
      return { ...result, pairsChecked: 1 };
    }

    // Model-wide mode
    const faceIds = params.faceIds && params.faceIds.length > 0
      ? params.faceIds
      : Array.from(engine.getMesh().faces.keys());

    return this.intersectAll(engine, faceIds, eps);
  }

  /**
   * Model-wide intersection: check all face pairs with spatial acceleration.
   */
  private intersectAll(
    engine: IGeometryEngine,
    faceIds: string[],
    eps: number,
  ): IntersectFacesResult {
    const allIntersectionEdgeIds: string[] = [];
    const allIntersectionVertexIds: string[] = [];
    const allSplitFaceIds: string[] = [];
    const allRemovedFaceIds: string[] = [];
    const removedSet = new Set<string>();
    let hasAnyIntersection = false;
    let pairsChecked = 0;

    // Pre-compute bounding boxes for all faces
    const faceBounds = new Map<string, BoundingBox>();
    for (const faceId of faceIds) {
      const bb = this.computeFaceBoundingBox(engine, faceId);
      if (bb) {
        faceBounds.set(faceId, bb);
      }
    }

    // Check all pairs with AABB pre-filtering
    const activeFaces = [...faceIds];

    for (let i = 0; i < activeFaces.length; i++) {
      for (let j = i + 1; j < activeFaces.length; j++) {
        const fIdA = activeFaces[i];
        const fIdB = activeFaces[j];

        // Skip faces already split in this pass
        if (removedSet.has(fIdA) || removedSet.has(fIdB)) continue;

        const bbA = faceBounds.get(fIdA);
        const bbB = faceBounds.get(fIdB);

        // Bounding box pre-check
        if (bbA && bbB && !this.bboxOverlaps(bbA, bbB, eps)) {
          continue;
        }

        pairsChecked++;
        const result = this.intersectPair(engine, fIdA, fIdB, eps);

        if (result.hasIntersection) {
          hasAnyIntersection = true;
          allIntersectionEdgeIds.push(...result.intersectionEdgeIds);
          allIntersectionVertexIds.push(...result.intersectionVertexIds);
          allSplitFaceIds.push(...result.splitFaceIds);
          allRemovedFaceIds.push(...result.removedFaceIds);

          for (const removedId of result.removedFaceIds) {
            removedSet.add(removedId);
          }
        }
      }
    }

    return {
      success: true,
      intersectionEdgeIds: allIntersectionEdgeIds,
      intersectionVertexIds: allIntersectionVertexIds,
      splitFaceIds: allSplitFaceIds,
      removedFaceIds: allRemovedFaceIds,
      hasIntersection: hasAnyIntersection,
      pairsChecked,
    };
  }

  /**
   * Intersect a single pair of faces.
   */
  private intersectPair(
    engine: IGeometryEngine,
    faceIdA: string,
    faceIdB: string,
    eps: number,
  ): Omit<IntersectFacesResult, 'pairsChecked'> {
    const empty: Omit<IntersectFacesResult, 'pairsChecked'> = {
      success: true,
      intersectionEdgeIds: [],
      intersectionVertexIds: [],
      splitFaceIds: [],
      removedFaceIds: [],
      hasIntersection: false,
    };

    const faceA = engine.getFace(faceIdA);
    const faceB = engine.getFace(faceIdB);

    if (!faceA || !faceB) {
      return { ...empty, success: false, error: 'One or both faces not found' };
    }

    const normalA = engine.computeFaceNormal(faceIdA);
    const normalB = engine.computeFaceNormal(faceIdB);

    // Compute intersection line direction: cross product of normals
    const lineDir = vec3.cross(normalA, normalB);
    const lineDirLen = vec3.length(lineDir);

    if (lineDirLen < eps) {
      // Planes are parallel or coplanar
      // Check if they are coplanar (same plane)
      const vertsA = engine.getFaceVertices(faceIdA).map(v => v.position);
      if (vertsA.length === 0) return empty;

      const distToPlaneB = Math.abs(
        vec3.dot(normalB, vertsA[0]) - faceB.plane.distance,
      );

      if (distToPlaneB < eps) {
        // Coplanar faces - handle separately
        return this.handleCoplanarFaces(engine, faceIdA, faceIdB, normalA, eps);
      }

      // Parallel but not coplanar: no intersection
      return empty;
    }

    const lineDirNorm = vec3.div(lineDir, lineDirLen);

    // Find a point on the intersection line by solving the two plane equations
    const lineOrigin = this.findPointOnIntersectionLine(faceA.plane, faceB.plane, lineDirNorm, eps);
    if (!lineOrigin) {
      return empty;
    }

    // Clip the infinite intersection line to each face polygon
    const vertsA = engine.getFaceVertices(faceIdA).map(v => v.position);
    const vertsB = engine.getFaceVertices(faceIdB).map(v => v.position);

    const segA = this.clipLineToPolygon(lineOrigin, lineDirNorm, vertsA, normalA, eps);
    const segB = this.clipLineToPolygon(lineOrigin, lineDirNorm, vertsB, normalB, eps);

    if (!segA || !segB) {
      return empty;
    }

    // Find overlap of the two 1D segments (parameterized along lineDir)
    const overlap = this.segmentOverlap(segA[0], segA[1], segB[0], segB[1], eps);
    if (!overlap) {
      return empty;
    }

    // Create intersection vertices at the overlap endpoints
    const p0 = vec3.add(lineOrigin, vec3.mul(lineDirNorm, overlap[0]));
    const p1 = vec3.add(lineOrigin, vec3.mul(lineDirNorm, overlap[1]));

    if (vec3.distance(p0, p1) < eps) {
      // Degenerate: single point intersection (tangent)
      // Create a vertex at the tangent point but don't split faces
      const tangentVertex = engine.createVertex(p0);
      return {
        success: true,
        intersectionEdgeIds: [],
        intersectionVertexIds: [tangentVertex.id],
        splitFaceIds: [],
        removedFaceIds: [],
        hasIntersection: false, // tangent point only
      };
    }

    const v0 = engine.createVertex(p0);
    const v1 = engine.createVertex(p1);
    const intersectionVertexIds = [v0.id, v1.id];

    // Create the intersection edge
    const intEdge = engine.createEdge(v0.id, v1.id);
    const intersectionEdgeIds = [intEdge.id];

    // Split both faces along the intersection edge
    const splitFaceIds: string[] = [];
    const removedFaceIds: string[] = [];

    const splitA = this.splitFaceAlongEdge(engine, faceIdA, v0.id, v1.id);
    if (splitA) {
      splitFaceIds.push(...splitA.newFaceIds);
      removedFaceIds.push(faceIdA);
    }

    const splitB = this.splitFaceAlongEdge(engine, faceIdB, v0.id, v1.id);
    if (splitB) {
      splitFaceIds.push(...splitB.newFaceIds);
      removedFaceIds.push(faceIdB);
    }

    return {
      success: true,
      intersectionEdgeIds,
      intersectionVertexIds,
      splitFaceIds,
      removedFaceIds,
      hasIntersection: true,
    };
  }

  /**
   * Handle coplanar face intersection.
   * Two faces on the same plane may overlap. We find the overlapping edges
   * from face B that cross face A and vice versa, then split accordingly.
   * For now, we report the intersection but do not split (coplanar splitting
   * requires polygon boolean operations which are substantially more complex).
   */
  private handleCoplanarFaces(
    engine: IGeometryEngine,
    faceIdA: string,
    faceIdB: string,
    normal: Vec3,
    eps: number,
  ): Omit<IntersectFacesResult, 'pairsChecked'> {
    // For coplanar faces, check if any edges of one face cross the boundary of the other.
    // This is a simplified approach - full polygon boolean would be needed for production.
    const vertsA = engine.getFaceVertices(faceIdA).map(v => v.position);
    const vertsB = engine.getFaceVertices(faceIdB).map(v => v.position);

    const intersectionVertexIds: string[] = [];
    const intersectionEdgeIds: string[] = [];

    // Project to 2D and find edge-edge intersections
    const uAxis = this.computePerpendicular(normal);
    const vAxis = vec3.normalize(vec3.cross(normal, uAxis));

    const projA = vertsA.map(v => ({ x: vec3.dot(v, uAxis), y: vec3.dot(v, vAxis) }));
    const projB = vertsB.map(v => ({ x: vec3.dot(v, uAxis), y: vec3.dot(v, vAxis) }));

    // Find all 2D edge-edge intersection points
    const intersectionPoints: Vec3[] = [];

    for (let i = 0; i < projA.length; i++) {
      const i2 = (i + 1) % projA.length;
      for (let j = 0; j < projB.length; j++) {
        const j2 = (j + 1) % projB.length;

        const pt = this.segmentIntersect2D(
          projA[i], projA[i2],
          projB[j], projB[j2],
          eps,
        );
        if (pt) {
          // Reconstruct 3D point
          const p3d = vec3.add(vec3.mul(uAxis, pt.x), vec3.mul(vAxis, pt.y));
          // Add the component along the normal
          const d = faceIdA ? (engine.getFace(faceIdA)?.plane.distance ?? 0) : 0;
          const p3dFull = vec3.add(p3d, vec3.mul(normal, d));
          intersectionPoints.push(p3dFull);
        }
      }
    }

    if (intersectionPoints.length < 2) {
      return {
        success: true,
        intersectionEdgeIds: [],
        intersectionVertexIds: [],
        splitFaceIds: [],
        removedFaceIds: [],
        hasIntersection: intersectionPoints.length > 0,
      };
    }

    // Create vertices and edges for intersection points
    for (const pt of intersectionPoints) {
      const v = engine.createVertex(pt);
      intersectionVertexIds.push(v.id);
    }

    // Connect consecutive intersection points with edges
    for (let i = 0; i < intersectionVertexIds.length - 1; i++) {
      const e = engine.createEdge(intersectionVertexIds[i], intersectionVertexIds[i + 1]);
      intersectionEdgeIds.push(e.id);
    }

    return {
      success: true,
      intersectionEdgeIds,
      intersectionVertexIds,
      splitFaceIds: [],
      removedFaceIds: [],
      hasIntersection: intersectionPoints.length >= 2,
    };
  }

  /**
   * 2D segment-segment intersection.
   * Returns the intersection point or null if segments don't intersect.
   */
  private segmentIntersect2D(
    a1: { x: number; y: number },
    a2: { x: number; y: number },
    b1: { x: number; y: number },
    b2: { x: number; y: number },
    eps: number,
  ): { x: number; y: number } | null {
    const dx1 = a2.x - a1.x;
    const dy1 = a2.y - a1.y;
    const dx2 = b2.x - b1.x;
    const dy2 = b2.y - b1.y;

    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < eps) return null; // Parallel

    const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
    const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;

    if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;

    return {
      x: a1.x + t * dx1,
      y: a1.y + t * dy1,
    };
  }

  /** Compute a vector perpendicular to the given normal. */
  private computePerpendicular(normal: Vec3): Vec3 {
    const absX = Math.abs(normal.x);
    const absY = Math.abs(normal.y);
    const absZ = Math.abs(normal.z);

    let ref: Vec3;
    if (absX <= absY && absX <= absZ) {
      ref = { x: 1, y: 0, z: 0 };
    } else if (absY <= absX && absY <= absZ) {
      ref = { x: 0, y: 1, z: 0 };
    } else {
      ref = { x: 0, y: 0, z: 1 };
    }

    return vec3.normalize(vec3.cross(normal, ref));
  }

  /**
   * Compute axis-aligned bounding box for a face.
   */
  private computeFaceBoundingBox(engine: IGeometryEngine, faceId: string): BoundingBox | null {
    const vertices = engine.getFaceVertices(faceId);
    if (vertices.length === 0) return null;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const v of vertices) {
      const p = v.position;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
  }

  /**
   * Test if two axis-aligned bounding boxes overlap (with epsilon padding).
   */
  private bboxOverlaps(a: BoundingBox, b: BoundingBox, eps: number): boolean {
    return (
      a.min.x - eps <= b.max.x && a.max.x + eps >= b.min.x &&
      a.min.y - eps <= b.max.y && a.max.y + eps >= b.min.y &&
      a.min.z - eps <= b.max.z && a.max.z + eps >= b.min.z
    );
  }

  /**
   * Find a point on the intersection of two planes.
   * Solves the system using the direction perpendicular to both normals.
   */
  private findPointOnIntersectionLine(
    planeA: Plane,
    planeB: Plane,
    lineDir: Vec3,
    eps: number,
  ): Vec3 | null {
    const n1 = planeA.normal;
    const n2 = planeB.normal;
    const d1 = planeA.distance;
    const d2 = planeB.distance;

    const n2CrossDir = vec3.cross(n2, lineDir);
    const dirCrossN1 = vec3.cross(lineDir, n1);
    const denom = vec3.dot(lineDir, lineDir);

    if (Math.abs(denom) < eps) return null;

    const p = vec3.div(
      vec3.add(vec3.mul(n2CrossDir, d1), vec3.mul(dirCrossN1, d2)),
      denom,
    );

    return p;
  }

  /**
   * Clip an infinite line to a convex polygon, returning the parameter range [tMin, tMax].
   * The line is parameterized as: P = origin + t * direction.
   */
  private clipLineToPolygon(
    origin: Vec3,
    direction: Vec3,
    polygonVerts: Vec3[],
    polygonNormal: Vec3,
    eps: number,
  ): [number, number] | null {
    let tMin = -Infinity;
    let tMax = Infinity;

    const n = polygonVerts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const edgeDir = vec3.sub(polygonVerts[j], polygonVerts[i]);
      // Inward-facing edge normal in the polygon plane
      const edgeNormal = vec3.normalize(vec3.cross(polygonNormal, edgeDir));

      const denom = vec3.dot(direction, edgeNormal);
      const dist = vec3.dot(vec3.sub(polygonVerts[i], origin), edgeNormal);

      if (Math.abs(denom) < eps) {
        // Line is parallel to this edge
        if (dist < -eps) return null; // Outside
        continue;
      }

      const t = dist / denom;
      if (denom < 0) {
        tMin = Math.max(tMin, t);
      } else {
        tMax = Math.min(tMax, t);
      }

      if (tMin > tMax + eps) return null;
    }

    if (tMin > tMax + eps) return null;
    return [tMin, tMax];
  }

  /** Find the overlap of two 1D segments [a0,a1] and [b0,b1] */
  private segmentOverlap(
    a0: number, a1: number,
    b0: number, b1: number,
    eps: number,
  ): [number, number] | null {
    const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
    const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
    if (lo >= hi - eps) return null;
    return [lo, hi];
  }

  /**
   * Split a face along an edge defined by two vertex IDs that lie on the face boundary.
   * Creates two new faces from the split.
   */
  private splitFaceAlongEdge(
    engine: IGeometryEngine,
    faceId: string,
    splitV0Id: string,
    splitV1Id: string,
  ): { newFaceIds: string[] } | null {
    const face = engine.getFace(faceId);
    if (!face) return null;

    const vertexIds = [...face.vertexIds];

    // Find which edges the split vertices lie on (or nearest vertices)
    // Insert split vertices into the polygon at the correct positions
    const insertions = this.findInsertionPoints(engine, vertexIds, splitV0Id, splitV1Id);
    if (!insertions) return null;

    const { polygon, idx0, idx1 } = insertions;

    // Split polygon into two parts at idx0 and idx1
    const polyA: string[] = [];
    const polyB: string[] = [];

    // Walk from idx0 to idx1
    let i = idx0;
    while (true) {
      polyA.push(polygon[i]);
      if (i === idx1) break;
      i = (i + 1) % polygon.length;
    }

    // Walk from idx1 to idx0
    i = idx1;
    while (true) {
      polyB.push(polygon[i]);
      if (i === idx0) break;
      i = (i + 1) % polygon.length;
    }

    if (polyA.length < 3 || polyB.length < 3) return null;

    // Delete original face and create two new ones
    const materialIndex = face.materialIndex;
    engine.deleteFace(faceId);

    const faceA = engine.createFace(polyA);
    const faceB = engine.createFace(polyB);

    return { newFaceIds: [faceA.id, faceB.id] };
  }

  /**
   * Find where to insert the split vertices into the polygon vertex list.
   * Returns the modified polygon and indices of the two split vertices.
   */
  private findInsertionPoints(
    engine: IGeometryEngine,
    vertexIds: string[],
    splitV0Id: string,
    splitV1Id: string,
  ): { polygon: string[]; idx0: number; idx1: number } | null {
    const polygon = [...vertexIds];
    let idx0 = -1;
    let idx1 = -1;

    // Check if split vertices already exist in the polygon
    for (let i = 0; i < polygon.length; i++) {
      if (polygon[i] === splitV0Id) idx0 = i;
      if (polygon[i] === splitV1Id) idx1 = i;
    }

    // If not found, insert on the nearest edge
    if (idx0 === -1) {
      const insertIdx = this.findNearestEdgeInsert(engine, polygon, splitV0Id);
      if (insertIdx === -1) return null;
      polygon.splice(insertIdx + 1, 0, splitV0Id);
      idx0 = insertIdx + 1;
    }

    if (idx1 === -1) {
      const insertIdx = this.findNearestEdgeInsert(engine, polygon, splitV1Id);
      if (insertIdx === -1) return null;
      // Adjust for possible shift from previous insertion
      const adjustedIdx = insertIdx >= idx0 ? insertIdx : insertIdx;
      polygon.splice(adjustedIdx + 1, 0, splitV1Id);
      idx1 = adjustedIdx + 1;
      // Recompute idx0 if it shifted
      if (adjustedIdx + 1 <= idx0) idx0++;
    }

    if (idx0 === -1 || idx1 === -1 || idx0 === idx1) return null;

    return { polygon, idx0, idx1 };
  }

  /**
   * Find which polygon edge the vertex is closest to, for insertion.
   */
  private findNearestEdgeInsert(
    engine: IGeometryEngine,
    polygon: string[],
    vertexId: string,
  ): number {
    const v = engine.getVertex(vertexId);
    if (!v) return -1;

    let bestDist = Infinity;
    let bestIdx = -1;

    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      const va = engine.getVertex(polygon[i]);
      const vb = engine.getVertex(polygon[j]);
      if (!va || !vb) continue;

      const projected = vec3.projectOnLine(v.position, va.position, vb.position);
      const dist = vec3.distance(v.position, projected);

      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    return bestIdx;
  }
}
