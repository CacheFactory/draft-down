// @archigraph eng.inference
// Constrain next point to an exact distance based on VCB (Value Control Box) input

import { Vec3, Ray, InferenceResult } from '../../src/core/types';
import { InferenceContext } from '../../src/core/interfaces';
import { vec3, ray, EPSILON } from '../../src/core/math';

/**
 * Parsed result from VCB input.
 * - Single number: distance along current direction
 * - Two numbers: X, Y offset from reference point
 * - Three numbers: X, Y, Z offset from reference point
 */
export interface ParsedVCBInput {
  mode: 'distance' | 'offset-2d' | 'offset-3d';
  values: number[];
}

export class DistanceConstraint {
  /**
   * Parse VCB input string and constrain the next point.
   * Supports:
   *   - "150" => distance of 150 along current drawing direction
   *   - "100,200" => X=100, Y=200 offset from reference point
   *   - "100,200,50" => X=100, Y=200, Z=50 offset from reference point
   *   - Negative values are supported
   *   - Semicolon separators are also accepted
   *
   * @param vcbInput - The raw string from the Value Control Box
   * @param cursorRay - The current cursor ray (used to determine drawing direction for single-value input)
   * @param context - Current inference context with recent points
   * @param snapRadius - Not used for distance constraints but kept for interface consistency
   * @returns InferenceResult with the constrained point, or null if input is invalid
   */
  test(
    vcbInput: string,
    cursorRay: Ray,
    context: InferenceContext,
    snapRadius: number,
  ): InferenceResult | null {
    if (context.recentPoints.length === 0) return null;

    const parsed = this.parseInput(vcbInput);
    if (parsed === null) return null;

    const origin = context.recentPoints[context.recentPoints.length - 1];

    let constrainedPoint: Vec3;

    switch (parsed.mode) {
      case 'distance': {
        // Constrain along the current drawing direction
        const direction = this.getDrawingDirection(cursorRay, origin, context);
        if (direction === null) return null;
        constrainedPoint = vec3.add(origin, vec3.mul(direction, parsed.values[0]));
        break;
      }

      case 'offset-2d': {
        // X, Y offset from reference point (Z stays the same as origin)
        constrainedPoint = {
          x: origin.x + parsed.values[0],
          y: origin.y + parsed.values[1],
          z: origin.z,
        };
        break;
      }

      case 'offset-3d': {
        // Full X, Y, Z offset from reference point
        constrainedPoint = {
          x: origin.x + parsed.values[0],
          y: origin.y + parsed.values[1],
          z: origin.z + parsed.values[2],
        };
        break;
      }

      default:
        return null;
    }

    const distance = vec3.distance(origin, constrainedPoint);

    return {
      type: 'endpoint',
      point: constrainedPoint,
      priority: 11, // VCB input overrides all other inferences
      guideLines: [],
      tooltip: `Distance: ${distance.toFixed(2)}`,
    };
  }

  /**
   * Parse a VCB input string into structured values.
   * Accepts comma or semicolon as separator.
   */
  parseInput(input: string): ParsedVCBInput | null {
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;

    // Normalize separators: accept both comma and semicolon
    const separator = trimmed.includes(';') ? ';' : ',';
    const parts = trimmed.split(separator).map((s) => s.trim());

    // Parse all parts as numbers
    const values: number[] = [];
    for (const part of parts) {
      const num = parseFloat(part);
      if (isNaN(num)) return null;
      values.push(num);
    }

    if (values.length === 0) return null;

    if (values.length === 1) {
      return { mode: 'distance', values };
    } else if (values.length === 2) {
      return { mode: 'offset-2d', values };
    } else if (values.length === 3) {
      return { mode: 'offset-3d', values };
    }

    // More than 3 values is invalid
    return null;
  }

  /**
   * Determine the current drawing direction from the cursor ray and reference point.
   * If an axis is locked, use that axis direction.
   * Otherwise, project the ray toward the reference to get the intended direction.
   */
  private getDrawingDirection(
    cursorRay: Ray,
    origin: Vec3,
    context: InferenceContext,
  ): Vec3 | null {
    // If axis is locked, use that axis direction
    if (context.axisLock) {
      const axes: Record<string, Vec3> = {
        x: { x: 1, y: 0, z: 0 },
        y: { x: 0, y: 1, z: 0 },
        z: { x: 0, y: 0, z: 1 },
      };

      if (context.customAxes) {
        axes.x = context.customAxes.xAxis;
        axes.y = context.customAxes.yAxis;
        axes.z = context.customAxes.zAxis;
      }

      // Determine sign from cursor position relative to origin
      const dir = vec3.normalize(axes[context.axisLock]);
      const toOrigin = vec3.sub(origin, cursorRay.origin);
      const t = vec3.dot(toOrigin, cursorRay.direction);
      const cursorWorld = vec3.add(cursorRay.origin, vec3.mul(cursorRay.direction, Math.max(0, t)));
      const offset = vec3.sub(cursorWorld, origin);
      const sign = vec3.dot(offset, dir) >= 0 ? 1 : -1;
      return vec3.mul(dir, sign);
    }

    // Otherwise derive direction from cursor ray toward origin
    const toOrigin = vec3.sub(origin, cursorRay.origin);
    const t = vec3.dot(toOrigin, cursorRay.direction);
    const cursorWorld = vec3.add(cursorRay.origin, vec3.mul(cursorRay.direction, Math.max(0, t)));
    const dir = vec3.sub(cursorWorld, origin);
    const len = vec3.length(dir);

    if (len < EPSILON) return null;
    return vec3.normalize(dir);
  }
}
