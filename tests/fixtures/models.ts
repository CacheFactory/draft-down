// @archigraph test.fixture.models
// Test fixture models for geometry tests

import { vec3 } from '../../src/core/math';
import type { Vec3 } from '../../src/core/types';

/** A unit cube: 8 vertices, 12 edges, 6 faces */
export function createCubeVertices(): Vec3[] {
  return [
    vec3.create(0, 0, 0), // 0
    vec3.create(1, 0, 0), // 1
    vec3.create(1, 1, 0), // 2
    vec3.create(0, 1, 0), // 3
    vec3.create(0, 0, 1), // 4
    vec3.create(1, 0, 1), // 5
    vec3.create(1, 1, 1), // 6
    vec3.create(0, 1, 1), // 7
  ];
}

/** Face indices for a cube (each face is 4 vertex indices) */
export function createCubeFaces(): number[][] {
  return [
    [0, 1, 2, 3], // front
    [5, 4, 7, 6], // back
    [4, 0, 3, 7], // left
    [1, 5, 6, 2], // right
    [3, 2, 6, 7], // top
    [4, 5, 1, 0], // bottom
  ];
}

/** A simple triangle on the XZ plane */
export function createTriangleVertices(): Vec3[] {
  return [
    vec3.create(0, 0, 0),
    vec3.create(1, 0, 0),
    vec3.create(0.5, 0, 1),
  ];
}

/** A rectangle on the ground plane */
export function createRectangleVertices(width = 2, depth = 1): Vec3[] {
  return [
    vec3.create(0, 0, 0),
    vec3.create(width, 0, 0),
    vec3.create(width, 0, depth),
    vec3.create(0, 0, depth),
  ];
}

/** An L-shaped polygon (6 vertices) on the XZ plane */
export function createLShapeVertices(): Vec3[] {
  return [
    vec3.create(0, 0, 0),
    vec3.create(2, 0, 0),
    vec3.create(2, 0, 1),
    vec3.create(1, 0, 1),
    vec3.create(1, 0, 2),
    vec3.create(0, 0, 2),
  ];
}

/** A pyramid: square base + apex */
export function createPyramidVertices(): Vec3[] {
  return [
    vec3.create(0, 0, 0),
    vec3.create(1, 0, 0),
    vec3.create(1, 0, 1),
    vec3.create(0, 0, 1),
    vec3.create(0.5, 1, 0.5), // apex
  ];
}

export function createPyramidFaces(): number[][] {
  return [
    [0, 1, 2, 3], // base
    [0, 1, 4],    // front
    [1, 2, 4],    // right
    [2, 3, 4],    // back
    [3, 0, 4],    // left
  ];
}
