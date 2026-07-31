// @archigraph eng.inference
// Detect when current drawing direction is perpendicular to a nearby edge

import { Vec3, Ray, InferenceResult, Color } from '../../src/core/types';
import { InferenceContext } from '../../src/core/interfaces';
import { vec3, ray, EPSILON, degToRad } from '../../src/core/math';

/** Magenta guide line for perpendicular inference */
const PERPENDICULAR_COLOR: Color = { r: 0.8, g: 0, b: 0.8, a: 1 };

/** Angular tolerance in radians (3 degrees from 90 degrees) */
const ANGULAR_TOLERANCE = degToRad(3);

/** How far the guide line extends */
const GUIDE_LINE_EXTENSION = 1000;

export class PerpendicularConstraint {
  /**
   * Test whether the current drawing direction (from the last reference point
   * through the cursor) is perpendicular to any nearby edge.
   * Perpendicularity is detected when the dot product of normalized direction
   * vectors is near zero.
   *
   * @param cursorRay - The ray from the camera through the cursor position
   * @param context - Current inference context with recent edges and points
   * @param snapRadius - Not directly used for angular tests, but passed for consistency
   * @returns InferenceResult if perpendicular alignment detected, null otherwise
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

    // Project cursor ray to estimate world position
    const toOrigin = vec3.sub(origin, cursorRay.origin);
    const t = vec3.dot(toOrigin, cursorRay.direction);
    const cursorWorldPoint = ray.pointAt(cursorRay, Math.max(0, t));

    const drawingDir = vec3.sub(cursorWorldPoint, origin);
    const drawingLen = vec3.length(drawingDir);
    if (drawingLen < EPSILON) return null;

    const drawingDirNorm = vec3.normalize(drawingDir);

    let bestResult: InferenceResult | null = null;
    let bestDotAbs = Math.sin(ANGULAR_TOLERANCE); // threshold: dot product near zero

    for (const edge of context.recentEdges) {
      const edgeVec = vec3.sub(edge.end, edge.start);
      if (vec3.length(edgeVec) < EPSILON) continue;

      const edgeDir = vec3.normalize(edgeVec);

      // Dot product of two unit vectors: 0 means perpendicular
      const dotProduct = Math.abs(vec3.dot(drawingDirNorm, edgeDir));

      if (dotProduct < bestDotAbs) {
        bestDotAbs = dotProduct;

        // The constrained direction is the component of drawingDir
        // that is perpendicular to the edge direction.
        // Remove the parallel component from drawingDir.
        const parallelComponent = vec3.mul(edgeDir, vec3.dot(drawingDir, edgeDir));
        const perpDir = vec3.sub(drawingDir, parallelComponent);
        const perpLen = vec3.length(perpDir);

        let constrainedPoint: Vec3;
        if (perpLen < EPSILON) {
          // Drawing direction is actually parallel, skip
          continue;
        }
        const perpDirNorm = vec3.normalize(perpDir);
        constrainedPoint = vec3.add(origin, vec3.mul(perpDirNorm, drawingLen));

        // Build guide line along the perpendicular direction
        const guideStart = vec3.sub(origin, vec3.mul(perpDirNorm, GUIDE_LINE_EXTENSION));
        const guideEnd = vec3.add(origin, vec3.mul(perpDirNorm, GUIDE_LINE_EXTENSION));

        bestResult = {
          type: 'perpendicular',
          point: constrainedPoint,
          priority: 7,
          guideLines: [{ start: guideStart, end: guideEnd, color: PERPENDICULAR_COLOR }],
          tooltip: 'Perpendicular to Edge',
        };
      }
    }

    return bestResult;
  }
}
