// @archigraph engine.geometry
// Vector and math utilities for DraftDown

import { Vec3, Vec2, Plane, Ray, BoundingBox } from './types';

export const EPSILON = 1e-10;

export const vec3 = {
  create(x = 0, y = 0, z = 0): Vec3 { return { x, y, z }; },
  zero(): Vec3 { return { x: 0, y: 0, z: 0 }; },
  one(): Vec3 { return { x: 1, y: 1, z: 1 }; },
  up(): Vec3 { return { x: 0, y: 1, z: 0 }; },
  right(): Vec3 { return { x: 1, y: 0, z: 0 }; },
  forward(): Vec3 { return { x: 0, y: 0, z: -1 }; },

  add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
  sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
  mul(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; },
  div(a: Vec3, s: number): Vec3 { return { x: a.x / s, y: a.y / s, z: a.z / s }; },
  negate(a: Vec3): Vec3 { return { x: -a.x, y: -a.y, z: -a.z }; },

  dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; },
  cross(a: Vec3, b: Vec3): Vec3 {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  },

  length(a: Vec3): number { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); },
  lengthSq(a: Vec3): number { return a.x * a.x + a.y * a.y + a.z * a.z; },
  distance(a: Vec3, b: Vec3): number { return vec3.length(vec3.sub(a, b)); },
  distanceSq(a: Vec3, b: Vec3): number { return vec3.lengthSq(vec3.sub(a, b)); },

  normalize(a: Vec3): Vec3 {
    const len = vec3.length(a);
    if (len < EPSILON) return vec3.zero();
    return vec3.div(a, len);
  },

  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  },

  equals(a: Vec3, b: Vec3, epsilon = EPSILON): boolean {
    return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.z - b.z) < epsilon;
  },

  clone(a: Vec3): Vec3 { return { x: a.x, y: a.y, z: a.z }; },

  projectOnPlane(point: Vec3, plane: Plane): Vec3 {
    const dist = vec3.dot(point, plane.normal) - plane.distance;
    return vec3.sub(point, vec3.mul(plane.normal, dist));
  },

  projectOnLine(point: Vec3, lineStart: Vec3, lineEnd: Vec3): Vec3 {
    const dir = vec3.sub(lineEnd, lineStart);
    const lenSq = vec3.lengthSq(dir);
    if (lenSq < EPSILON) return vec3.clone(lineStart);
    const t = Math.max(0, Math.min(1, vec3.dot(vec3.sub(point, lineStart), dir) / lenSq));
    return vec3.add(lineStart, vec3.mul(dir, t));
  },

  angle(a: Vec3, b: Vec3): number {
    const d = vec3.dot(vec3.normalize(a), vec3.normalize(b));
    return Math.acos(Math.max(-1, Math.min(1, d)));
  },
};

export const ray = {
  create(origin: Vec3, direction: Vec3): Ray {
    return { origin, direction: vec3.normalize(direction) };
  },
  pointAt(r: Ray, t: number): Vec3 {
    return vec3.add(r.origin, vec3.mul(r.direction, t));
  },
  intersectPlane(r: Ray, plane: Plane): number | null {
    const denom = vec3.dot(r.direction, plane.normal);
    if (Math.abs(denom) < EPSILON) return null;
    const t = (plane.distance - vec3.dot(r.origin, plane.normal)) / denom;
    return t >= 0 ? t : null;
  },
  distanceToPoint(r: Ray, point: Vec3): number {
    const v = vec3.sub(point, r.origin);
    const proj = vec3.dot(v, r.direction);
    const closest = vec3.add(r.origin, vec3.mul(r.direction, Math.max(0, proj)));
    return vec3.distance(closest, point);
  },
};

export const bbox = {
  empty(): BoundingBox {
    return {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
    };
  },
  expandByPoint(box: BoundingBox, p: Vec3): BoundingBox {
    return {
      min: { x: Math.min(box.min.x, p.x), y: Math.min(box.min.y, p.y), z: Math.min(box.min.z, p.z) },
      max: { x: Math.max(box.max.x, p.x), y: Math.max(box.max.y, p.y), z: Math.max(box.max.z, p.z) },
    };
  },
  center(box: BoundingBox): Vec3 {
    return vec3.mul(vec3.add(box.min, box.max), 0.5);
  },
  size(box: BoundingBox): Vec3 {
    return vec3.sub(box.max, box.min);
  },
  containsPoint(box: BoundingBox, p: Vec3): boolean {
    return p.x >= box.min.x && p.x <= box.max.x &&
           p.y >= box.min.y && p.y <= box.max.y &&
           p.z >= box.min.z && p.z <= box.max.z;
  },
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function degToRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

export function radToDeg(radians: number): number {
  return radians * 180 / Math.PI;
}
