// @archigraph eng.inference
// Main inference engine — finds snap targets and constraints every frame during tool operations

import {
  Vec3, Vec2, Ray, InferenceResult, InferenceType, Color,
} from '../../src/core/types';
import {
  IInferenceEngine, InferenceContext,
  IGeometryEngine, IVertex, IEdge, IFace,
} from '../../src/core/interfaces';
import { vec3, ray, EPSILON } from '../../src/core/math';
import { SnapPointConstraint, SnapCandidate } from '../constraint.snap_point/SnapPointConstraint';
import { OnAxisConstraint } from '../constraint.on_axis/OnAxisConstraint';
import { ParallelConstraint } from '../constraint.parallel/ParallelConstraint';
import { PerpendicularConstraint } from '../constraint.perpendicular/PerpendicularConstraint';
import { DistanceConstraint } from '../constraint.distance/DistanceConstraint';

/**
 * Priority reference:
 *   endpoint:      10
 *   intersection:   9
 *   midpoint:       8
 *   parallel:       7
 *   perpendicular:  7
 *   on-edge:        6
 *   on-axis:        5
 *   on-face:        4
 */

/** Cache entry for geometry queries */
interface GeometryCache {
  snapCandidates: SnapCandidate[];
  edgeSegments: Array<{ id: string; start: Vec3; end: Vec3 }>;
  faceData: Array<{ id: string; vertexPositions: Vec3[]; normal: Vec3 }>;
  timestamp: number;
}

/** Default colors for on-edge and on-face indicators */
const ON_EDGE_COLOR: Color = { r: 1, g: 0, b: 0, a: 1 };
const ON_FACE_COLOR: Color = { r: 0.2, g: 0.2, b: 0.8, a: 1 };
const INTERSECTION_COLOR: Color = { r: 1, g: 1, b: 0, a: 1 };

/** How long (ms) to keep the geometry cache before refreshing */
const CACHE_TTL_MS = 100;

export class InferenceEngine implements IInferenceEngine {
  private enabled = true;
  private snapRadius = 15; // screen pixels
  private geometryEngine: IGeometryEngine | null = null;
  private cache: GeometryCache | null = null;

  // Constraint instances
  private snapPointConstraint = new SnapPointConstraint();
  private onAxisConstraint = new OnAxisConstraint();
  private parallelConstraint = new ParallelConstraint();
  private perpendicularConstraint = new PerpendicularConstraint();
  private distanceConstraint = new DistanceConstraint();

  /**
   * Bind the inference engine to a geometry engine so it can query vertices, edges, and faces.
   */
  setGeometryEngine(geometry: IGeometryEngine): void {
    this.geometryEngine = geometry;
    this.cache = null;
  }

  /**
   * Main inference entry point. Called every frame during tool operations.
   * Tests the cursor ray against all geometry to find the best snap target.
   *
   * @param screenPos - Cursor position in screen pixels
   * @param cursorRay - Ray from camera through cursor
   * @param context - Inference context with recent geometry, axis locks, etc.
   * @returns The best inference result, or null if nothing snaps
   */
  findInference(
    screenPos: Vec2,
    cursorRay: Ray,
    context: InferenceContext,
  ): InferenceResult | null {
    if (!this.enabled) return null;

    // Convert screen-pixel snap radius to an approximate world-space radius.
    // This is a heuristic: use the distance from the camera to the last known
    // point, scaled by the pixel radius and a rough FOV factor.
    const worldSnapRadius = this.estimateWorldSnapRadius(cursorRay, context);

    // Refresh geometry cache if stale
    this.refreshCache();

    // Collect all inference results from each constraint
    const results: InferenceResult[] = [];

    // 1. Snap points (endpoints + midpoints) — highest priority point snaps
    const snapCandidates = this.cache?.snapCandidates ?? [];
    const snapResult = this.snapPointConstraint.test(
      cursorRay, context, worldSnapRadius, snapCandidates,
    );
    if (snapResult) results.push(snapResult);

    // 2. On-edge test
    const onEdgeResult = this.testOnEdge(cursorRay, worldSnapRadius);
    if (onEdgeResult) results.push(onEdgeResult);

    // 3. Intersection test (edge-edge intersections near cursor)
    const intersectionResult = this.testIntersections(cursorRay, worldSnapRadius);
    if (intersectionResult) results.push(intersectionResult);

    // 4. On-face test
    const onFaceResult = this.testOnFace(cursorRay);
    if (onFaceResult) results.push(onFaceResult);

    // 5. Axis constraint
    const axisResult = this.onAxisConstraint.test(cursorRay, context, worldSnapRadius);
    if (axisResult) results.push(axisResult);

    // 6. Parallel constraint
    const parallelResult = this.parallelConstraint.test(cursorRay, context, worldSnapRadius);
    if (parallelResult) results.push(parallelResult);

    // 7. Perpendicular constraint
    const perpResult = this.perpendicularConstraint.test(cursorRay, context, worldSnapRadius);
    if (perpResult) results.push(perpResult);

    // If axis is locked, filter: keep only axis results and point snaps ON the axis
    if (context.axisLock) {
      return this.resolveWithAxisLock(results, context.axisLock);
    }

    // Return the highest-priority result
    return this.pickBest(results);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setSnapRadius(pixels: number): void {
    this.snapRadius = Math.max(1, pixels);
  }

  clearCache(): void {
    this.cache = null;
  }

  // ─── Geometry-Based Tests ─────────────────────────────────────

  /**
   * Test whether the cursor ray is close to any edge (on-edge snap).
   */
  private testOnEdge(cursorRay: Ray, snapRadius: number): InferenceResult | null {
    if (!this.cache) return null;

    let bestDist = snapRadius;
    let bestPoint: Vec3 | null = null;
    let bestEdgeId: string | undefined;

    for (const edge of this.cache.edgeSegments) {
      const closest = this.closestPointOnSegmentToRay(cursorRay, edge.start, edge.end);
      if (closest === null) continue;

      const dist = ray.distanceToPoint(cursorRay, closest.point);
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = closest.point;
        bestEdgeId = edge.id;
      }
    }

    if (bestPoint === null) return null;

    return {
      type: 'on-edge',
      point: bestPoint,
      priority: 6,
      referenceEntityId: bestEdgeId,
      guideLines: [],
      tooltip: 'On Edge',
    };
  }

  /**
   * Test for edge-edge intersections near the cursor ray.
   */
  private testIntersections(cursorRay: Ray, snapRadius: number): InferenceResult | null {
    if (!this.cache || this.cache.edgeSegments.length < 2) return null;

    const edges = this.cache.edgeSegments;
    let bestDist = snapRadius;
    let bestPoint: Vec3 | null = null;

    // Check pairwise intersections (O(n^2) but typically small n for visible geometry)
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const intersection = this.edgeEdgeIntersection(
          edges[i].start, edges[i].end,
          edges[j].start, edges[j].end,
        );
        if (intersection === null) continue;

        const dist = ray.distanceToPoint(cursorRay, intersection);
        if (dist < bestDist) {
          bestDist = dist;
          bestPoint = intersection;
        }
      }
    }

    if (bestPoint === null) return null;

    return {
      type: 'intersection',
      point: bestPoint,
      priority: 9,
      guideLines: [],
      tooltip: 'Intersection',
    };
  }

  /**
   * Test whether the cursor ray hits any face.
   */
  private testOnFace(cursorRay: Ray): InferenceResult | null {
    if (!this.geometryEngine) return null;

    const hits = this.geometryEngine.raycast(cursorRay);
    const faceHit = hits.find((h) => h.type === 'face');
    if (!faceHit) return null;

    return {
      type: 'on-face',
      point: faceHit.point,
      priority: 4,
      referenceEntityId: faceHit.entityId,
      guideLines: [],
      tooltip: 'On Face',
    };
  }

  // ─── Resolution ──────────────────────────────────────────────

  /**
   * Pick the result with the highest priority. Ties broken by order (first wins).
   */
  private pickBest(results: InferenceResult[]): InferenceResult | null {
    if (results.length === 0) return null;
    let best = results[0];
    for (let i = 1; i < results.length; i++) {
      if (results[i].priority > best.priority) {
        best = results[i];
      }
    }
    return best;
  }

  /**
   * When an axis lock is active, prefer the axis result but allow higher-priority
   * point snaps that lie on the locked axis.
   */
  private resolveWithAxisLock(
    results: InferenceResult[],
    axisLock: 'x' | 'y' | 'z',
  ): InferenceResult | null {
    const axisType = `on-axis-${axisLock}` as InferenceType;

    // Find the axis result
    const axisResult = results.find((r) => r.type === axisType) ?? null;

    // Find point snaps (endpoint, midpoint, intersection) that happen to be on the axis
    // (they would override the axis result if they are within tolerance)
    const pointSnaps = results.filter(
      (r) => (r.type === 'endpoint' || r.type === 'midpoint' || r.type === 'intersection')
        && r.priority > (axisResult?.priority ?? 0),
    );

    if (pointSnaps.length > 0) {
      return this.pickBest(pointSnaps);
    }

    return axisResult;
  }

  // ─── Cache Management ────────────────────────────────────────

  /**
   * Refresh the geometry cache if it is stale or missing.
   */
  private refreshCache(): void {
    const now = Date.now();
    if (this.cache && (now - this.cache.timestamp) < CACHE_TTL_MS) {
      return; // cache is still fresh
    }

    if (!this.geometryEngine) {
      this.cache = null;
      return;
    }

    const mesh = this.geometryEngine.getMesh();

    // Build vertex list
    const vertices: Array<{ id: string; position: Vec3 }> = [];
    mesh.vertices.forEach((vertex, id) => {
      if (!vertex.hidden) {
        vertices.push({ id, position: vertex.position });
      }
    });

    // Build edge segments
    const edgeSegments: Array<{ id: string; start: Vec3; end: Vec3 }> = [];
    mesh.edges.forEach((edge, id) => {
      if (edge.hidden) return;
      const startV = mesh.vertices.get(edge.startVertexId);
      const endV = mesh.vertices.get(edge.endVertexId);
      if (startV && endV) {
        edgeSegments.push({ id, start: startV.position, end: endV.position });
      }
    });

    // Build snap candidates from vertices and edge midpoints
    const snapCandidates = SnapPointConstraint.buildCandidates(vertices, edgeSegments);

    // Build face data (simplified — store vertex positions for each face)
    const faceData: Array<{ id: string; vertexPositions: Vec3[]; normal: Vec3 }> = [];
    mesh.faces.forEach((face, id) => {
      if (face.hidden) return;
      const positions: Vec3[] = [];
      for (const vid of face.vertexIds) {
        const v = mesh.vertices.get(vid);
        if (v) positions.push(v.position);
      }
      if (positions.length >= 3) {
        faceData.push({ id, vertexPositions: positions, normal: face.normal });
      }
    });

    this.cache = {
      snapCandidates,
      edgeSegments,
      faceData,
      timestamp: now,
    };
  }

  // ─── Utility Methods ─────────────────────────────────────────

  /**
   * Estimate a world-space snap radius from the screen-pixel radius.
   * Uses the distance from the ray origin to the last known point as a depth reference.
   */
  private estimateWorldSnapRadius(cursorRay: Ray, context: InferenceContext): number {
    // Default depth if no reference points
    let depth = 10;

    if (context.recentPoints.length > 0) {
      const lastPoint = context.recentPoints[context.recentPoints.length - 1];
      depth = Math.max(1, vec3.distance(cursorRay.origin, lastPoint));
    }

    // Approximate: at a typical 60-degree FOV on a 1000px-wide viewport,
    // 1 pixel ~ depth * tan(fov/2) / (width/2). Simplified:
    const pixelToWorld = depth * 0.001; // rough heuristic
    return this.snapRadius * pixelToWorld;
  }

  /**
   * Find the closest point on a line segment to a ray.
   * Returns the point on the segment and the parameter t along the segment.
   */
  private closestPointOnSegmentToRay(
    r: Ray,
    segStart: Vec3,
    segEnd: Vec3,
  ): { point: Vec3; t: number } | null {
    const segDir = vec3.sub(segEnd, segStart);
    const segLen = vec3.length(segDir);
    if (segLen < EPSILON) return null;

    const segDirNorm = vec3.normalize(segDir);

    // Closest approach between two lines:
    // Line 1: P = segStart + t * segDir
    // Line 2: Q = r.origin + s * r.direction
    const w0 = vec3.sub(segStart, r.origin);
    const a = vec3.dot(segDirNorm, segDirNorm);
    const b = vec3.dot(segDirNorm, r.direction);
    const c = vec3.dot(r.direction, r.direction);
    const d = vec3.dot(segDirNorm, w0);
    const e = vec3.dot(r.direction, w0);

    const denom = a * c - b * b;
    if (Math.abs(denom) < EPSILON) return null; // parallel

    let t = (b * e - c * d) / denom;

    // Clamp t to [0, segLen] to stay on the segment
    t = Math.max(0, Math.min(segLen, t));

    const point = vec3.add(segStart, vec3.mul(segDirNorm, t));
    return { point, t: t / segLen };
  }

  /**
   * Find the intersection point of two line segments in 3D, if they are coplanar
   * and actually cross. Returns null if they don't intersect within tolerance.
   */
  private edgeEdgeIntersection(
    a1: Vec3, a2: Vec3,
    b1: Vec3, b2: Vec3,
    tolerance: number = 0.01,
  ): Vec3 | null {
    const da = vec3.sub(a2, a1);
    const db = vec3.sub(b2, b1);
    const dc = vec3.sub(b1, a1);

    const crossDaDb = vec3.cross(da, db);
    const crossLen = vec3.length(crossDaDb);

    // Check if segments are parallel
    if (crossLen < EPSILON) return null;

    // Check if segments are coplanar
    const dotDcCross = Math.abs(vec3.dot(dc, crossDaDb));
    if (dotDcCross > tolerance * crossLen) return null; // not coplanar

    // Find parameters
    const crossDcDb = vec3.cross(dc, db);
    const t = vec3.dot(crossDcDb, crossDaDb) / (crossLen * crossLen);

    if (t < 0 || t > 1) return null; // outside segment A

    const crossDcDa = vec3.cross(dc, da);
    const s = vec3.dot(crossDcDa, crossDaDb) / (crossLen * crossLen);

    if (s < 0 || s > 1) return null; // outside segment B

    return vec3.add(a1, vec3.mul(da, t));
  }

  // ─── Public Accessors for Distance Constraint ────────────────

  /**
   * Convenience method for tools to apply VCB distance input.
   * This is separate from findInference because VCB input overrides normal inference.
   */
  applyDistanceConstraint(
    vcbInput: string,
    cursorRay: Ray,
    context: InferenceContext,
  ): InferenceResult | null {
    return this.distanceConstraint.test(vcbInput, cursorRay, context, this.snapRadius);
  }
}
