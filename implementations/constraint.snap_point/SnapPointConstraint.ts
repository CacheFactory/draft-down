// @archigraph eng.inference
// Snap to existing vertices (endpoints) and edge midpoints

import { Vec3, Vec2, Ray, InferenceResult, Color } from '../../src/core/types';
import { InferenceContext } from '../../src/core/interfaces';
import { vec3, ray, EPSILON } from '../../src/core/math';

/** Green dot indicator color for endpoint snaps */
const ENDPOINT_COLOR: Color = { r: 0, g: 0.8, b: 0, a: 1 };

/** Cyan dot indicator color for midpoint snaps */
const MIDPOINT_COLOR: Color = { r: 0, g: 0.8, b: 0.8, a: 1 };

export interface SnapCandidate {
  point: Vec3;
  type: 'endpoint' | 'midpoint';
  entityId?: string;
}

export class SnapPointConstraint {
  /**
   * Test the cursor ray against known snap candidates (vertices and edge midpoints).
   *
   * @param cursorRay - The ray from the camera through the cursor position
   * @param context - Current inference context with recent geometry
   * @param snapRadius - Maximum distance in world units for a snap to trigger
   * @param candidates - Pre-collected snap candidates from the geometry engine
   * @returns InferenceResult if a snap target is within range, null otherwise
   */
  test(
    cursorRay: Ray,
    context: InferenceContext,
    snapRadius: number,
    candidates: SnapCandidate[] = [],
  ): InferenceResult | null {
    let bestResult: InferenceResult | null = null;
    let bestDistance = Infinity;

    for (const candidate of candidates) {
      const dist = ray.distanceToPoint(cursorRay, candidate.point);

      if (dist < snapRadius && dist < bestDistance) {
        bestDistance = dist;

        if (candidate.type === 'endpoint') {
          bestResult = {
            type: 'endpoint',
            point: vec3.clone(candidate.point),
            priority: 10,
            referenceEntityId: candidate.entityId,
            guideLines: [],
            tooltip: 'Endpoint',
          };
        } else {
          bestResult = {
            type: 'midpoint',
            point: vec3.clone(candidate.point),
            priority: 8,
            referenceEntityId: candidate.entityId,
            guideLines: [],
            tooltip: 'Midpoint',
          };
        }
      }
    }

    // Also test against recent points from context (these are endpoints)
    for (const point of context.recentPoints) {
      const dist = ray.distanceToPoint(cursorRay, point);
      if (dist < snapRadius && dist < bestDistance) {
        bestDistance = dist;
        bestResult = {
          type: 'endpoint',
          point: vec3.clone(point),
          priority: 10,
          guideLines: [],
          tooltip: 'Endpoint',
        };
      }
    }

    // Test midpoints of recent edges
    for (const edge of context.recentEdges) {
      const midpoint = vec3.lerp(edge.start, edge.end, 0.5);
      const dist = ray.distanceToPoint(cursorRay, midpoint);
      if (dist < snapRadius && dist < bestDistance) {
        bestDistance = dist;
        bestResult = {
          type: 'midpoint',
          point: midpoint,
          priority: 8,
          guideLines: [],
          tooltip: 'Midpoint',
        };
      }
    }

    return bestResult;
  }

  /**
   * Build snap candidates from geometry data. Utility for the inference engine
   * to prepare the candidate list before calling test().
   */
  static buildCandidates(
    vertices: Array<{ id: string; position: Vec3 }>,
    edges: Array<{ id: string; start: Vec3; end: Vec3 }>,
  ): SnapCandidate[] {
    const candidates: SnapCandidate[] = [];

    for (const v of vertices) {
      candidates.push({
        point: v.position,
        type: 'endpoint',
        entityId: v.id,
      });
    }

    for (const e of edges) {
      candidates.push({
        point: vec3.lerp(e.start, e.end, 0.5),
        type: 'midpoint',
        entityId: e.id,
      });
    }

    return candidates;
  }
}
