// @archigraph eng.inference
// Detect alignment with X (red), Y (green), Z (blue) axes from a reference point

import { Vec3, Ray, InferenceResult, Color } from '../../src/core/types';
import { InferenceContext } from '../../src/core/interfaces';
import { vec3, ray, EPSILON } from '../../src/core/math';

/** Axis colors matching DraftDown conventions */
const AXIS_COLORS: Record<string, Color> = {
  x: { r: 1, g: 0, b: 0, a: 1 },   // Red
  y: { r: 0, g: 0.7, b: 0, a: 1 },  // Green
  z: { r: 0, g: 0, b: 1, a: 1 },    // Blue
};

/** Standard axis direction vectors */
const AXIS_DIRECTIONS: Record<string, Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

/** How far the guide line extends beyond the snapped point */
const GUIDE_LINE_EXTENSION = 1000;

export class OnAxisConstraint {
  /**
   * Test whether the cursor ray aligns with any axis from the most recent reference point.
   * If an axis lock is active, only that axis is tested.
   *
   * @param cursorRay - The ray from the camera through the cursor position
   * @param context - Current inference context; uses recentPoints[0] as the reference origin
   * @param snapRadius - Maximum perpendicular distance (world units) for axis snap
   * @returns InferenceResult if cursor is near an axis, null otherwise
   */
  test(
    cursorRay: Ray,
    context: InferenceContext,
    snapRadius: number,
  ): InferenceResult | null {
    // Need at least one reference point to define axis origin
    if (context.recentPoints.length === 0) return null;

    const origin = context.recentPoints[context.recentPoints.length - 1];

    // Determine which axes to test
    const axesToTest: ('x' | 'y' | 'z')[] = context.axisLock
      ? [context.axisLock]
      : ['x', 'y', 'z'];

    // Use custom axes if provided, otherwise standard axes
    const axes = context.customAxes
      ? {
          x: context.customAxes.xAxis,
          y: context.customAxes.yAxis,
          z: context.customAxes.zAxis,
        }
      : AXIS_DIRECTIONS;

    let bestResult: InferenceResult | null = null;
    let bestDistance = Infinity;

    for (const axisName of axesToTest) {
      const axisDir = vec3.normalize(axes[axisName]);
      const result = this.projectOnAxis(cursorRay, origin, axisDir, axisName, snapRadius);

      if (result !== null) {
        const dist = ray.distanceToPoint(cursorRay, result.point);
        // For locked axes, always use the projection regardless of distance
        if (context.axisLock === axisName || (dist < snapRadius && dist < bestDistance)) {
          bestDistance = dist;
          bestResult = result;
        }
      }
    }

    // If axis is locked, force the result even if distance is large
    if (context.axisLock && bestResult === null) {
      const axisDir = vec3.normalize(axes[context.axisLock]);
      bestResult = this.projectOnAxis(cursorRay, origin, axisDir, context.axisLock, Infinity);
    }

    return bestResult;
  }

  /**
   * Project the cursor ray onto an axis line and return the closest point on that axis.
   */
  private projectOnAxis(
    cursorRay: Ray,
    origin: Vec3,
    axisDir: Vec3,
    axisName: 'x' | 'y' | 'z',
    snapRadius: number,
  ): InferenceResult | null {
    // Find the closest point between the cursor ray and the axis line.
    // The axis line is: P = origin + t * axisDir
    // The cursor ray is: Q = ray.origin + s * ray.direction
    // We want to minimize |P - Q|.

    const w0 = vec3.sub(origin, cursorRay.origin);
    const a = vec3.dot(axisDir, axisDir);         // always 1 if normalized
    const b = vec3.dot(axisDir, cursorRay.direction);
    const c = vec3.dot(cursorRay.direction, cursorRay.direction); // always 1 if normalized
    const d = vec3.dot(axisDir, w0);
    const e = vec3.dot(cursorRay.direction, w0);

    const denom = a * c - b * b;

    // If lines are parallel, no unique closest point
    if (Math.abs(denom) < EPSILON) return null;

    const t = (b * e - c * d) / denom;
    const s = (a * e - b * d) / denom;

    // Point must be forward along the ray (s >= 0)
    if (s < 0) return null;

    const pointOnAxis = vec3.add(origin, vec3.mul(axisDir, t));
    const pointOnRay = vec3.add(cursorRay.origin, vec3.mul(cursorRay.direction, s));
    const dist = vec3.distance(pointOnAxis, pointOnRay);

    if (dist > snapRadius) return null;

    const color = AXIS_COLORS[axisName];
    const inferenceType = `on-axis-${axisName}` as const;

    // Build guide line along the axis
    const guideStart = vec3.sub(origin, vec3.mul(axisDir, GUIDE_LINE_EXTENSION));
    const guideEnd = vec3.add(origin, vec3.mul(axisDir, GUIDE_LINE_EXTENSION));

    return {
      type: inferenceType,
      point: pointOnAxis,
      priority: 5,
      guideLines: [{ start: guideStart, end: guideEnd, color }],
      tooltip: `On ${axisName.toUpperCase()} Axis`,
    };
  }
}
