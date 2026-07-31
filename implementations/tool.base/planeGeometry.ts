// @archigraph tool.base
// Shared plane math for tools that draw or project onto a plane.

import type { Vec3, Plane } from '../../src/core/types';
import { vec3 } from '../../src/core/math';

/** Orthonormal basis (tangent, bitangent) spanning the plane with the given
 *  normal. Used by shape tools (circle, polygon, …) to lay out vertices. */
export function planeBasis(normal: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  let tangent: Vec3;
  if (Math.abs(normal.y) > 0.9) {
    tangent = vec3.normalize(vec3.cross(normal, { x: 1, y: 0, z: 0 }));
  } else {
    tangent = vec3.normalize(vec3.cross(normal, { x: 0, y: 1, z: 0 }));
  }
  const bitangent = vec3.normalize(vec3.cross(normal, tangent));
  return { tangent, bitangent };
}

/** Intersect a ray with a plane. Returns null when parallel or behind the ray origin. */
export function rayPlaneIntersect(
  ray: { origin: Vec3; direction: Vec3 },
  plane: Plane,
): Vec3 | null {
  const denom = vec3.dot(ray.direction, plane.normal);
  if (Math.abs(denom) < 1e-10) return null;
  const t = (plane.distance - vec3.dot(ray.origin, plane.normal)) / denom;
  if (t < 0) return null;
  return vec3.add(ray.origin, vec3.mul(ray.direction, t));
}
