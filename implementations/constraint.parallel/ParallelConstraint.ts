// @archigraph eng.inference
// Detect when current drawing direction is parallel to a nearby edge

import { Vec3, Ray, InferenceResult, Color } from '../../src/core/types';
import { InferenceContext } from '../../src/core/interfaces';
import { vec3, ray, EPSILON, degToRad } from '../../src/core/math';

/** Magenta guide line for parallel inference */
const PARALLEL_COLOR: Color = { r: 0.8, g: 0, b: 0.8, a: 1 };

/** Angular tolerance in radians (3 degrees) */
const ANGULAR_TOLERANCE = degToRad(3);

/** How far the guide line extends */
const GUIDE_LINE_EXTENSION = 1000;

export class ParallelConstraint {
  /**
   * Test whether the current drawing direction (from the last reference point
   * through the cursor) is parallel to any nearby edge.
   *
   * @param cursorRay - The ray from the camera through the cursor position
   * @param context - Current inference context with recent edges and points
   * @param snapRadius - Not directly used for angular tests, but passed for consistency
   * @returns InferenceResult if parallel alignment detected, null otherwise
   */
  test(
    cursorRay: Ray,
    context: InferenceContext,
    snapRadius: number,
  ): InferenceResult | null {
    // Need a reference point to define the drawing direction
    if (context.recentPoints.length === 0) return null;
    if (context.recentEdges.length === 0) return null;

    const origin = context.recentPoints[context.recentPoints.length - 1];

    // Project cursor ray onto a working plane to get the candidate direction.
    // Use the closest point on the ray to the origin as an approximation.
    const toOrigin = vec3.sub(origin, cursorRay.origin);
    const t = vec3.dot(toOrigin, cursorRay.direction);
    const cursorWorldPoint = ray.pointAt(cursorRay, Math.max(0, t));

    const drawingDir = vec3.sub(cursorWorldPoint, origin);
    const drawingLen = vec3.length(drawingDir);
    if (drawingLen < EPSILON) return null;

    const drawingDirNorm = vec3.normalize(drawingDir);

    let bestResult: InferenceResult | null = null;
    let bestAngleDiff = ANGULAR_TOLERANCE;

    for (const edge of context.recentEdges) {
      const edgeDir = vec3.normalize(vec3.sub(edge.end, edge.start));
      if (vec3.length(vec3.sub(edge.end, edge.start)) < EPSILON) continue;

      // Check if directions are parallel: angle between them should be near 0 or PI
      const angle = vec3.angle(drawingDirNorm, edgeDir);
      const angleDiff = Math.min(angle, Math.PI - angle);

      if (angleDiff < bestAngleDiff) {
        bestAngleDiff = angleDiff;

        // Constrain the point: project cursor point onto the parallel line
        // through the origin in the direction of the edge
        const projT = vec3.dot(drawingDir, edgeDir);
        const constrainedPoint = vec3.add(origin, vec3.mul(edgeDir, projT));

        // Build guide line along the parallel direction
        const guideStart = vec3.sub(origin, vec3.mul(edgeDir, GUIDE_LINE_EXTENSION));
        const guideEnd = vec3.add(origin, vec3.mul(edgeDir, GUIDE_LINE_EXTENSION));

        bestResult = {
          type: 'parallel',
          point: constrainedPoint,
          priority: 7,
          guideLines: [{ start: guideStart, end: guideEnd, color: PARALLEL_COLOR }],
          tooltip: 'Parallel to Edge',
        };
      }
    }

    return bestResult;
  }
}
