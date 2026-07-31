// @archigraph system.autoface
// Small shapes drawn on/near existing faces must not corrupt them.
// Regression for two tolerance bugs (circle typed via VCB centered on a
// rectangle corner turned the corner into a blob and duplicated the face):
// 1. insertOnBoundaryVertices accepted projection t up to 1.01 RELATIVE to
//    edge length — 1% of a 4m edge = 4cm of slop BEYOND the corner, so
//    collinear circle vertices outside the face got spliced into its
//    boundary, spawning phantom edges (a diameter through the corner).
// 2. Boundary weld/classify tolerances were 1–5cm, at the same scale as a
//    small circle's segment chords, welding its ring into degenerate paths.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import { vec3 } from '../../src/core/math';
import type { Vec3 } from '../../src/core/types';

function findOrCreateVertex(e: GeometryEngine, p: Vec3): string {
  for (const [id, v] of e.getInternalMesh().vertices) {
    if (vec3.distance(v.position, p) < 0.01) return id;
  }
  return e.createVertex(p).id;
}

function drawRect(e: GeometryEngine, x1: number, z1: number, x2: number, z2: number) {
  const corners: Vec3[] = [
    { x: x1, y: 0, z: z1 }, { x: x2, y: 0, z: z1 },
    { x: x2, y: 0, z: z2 }, { x: x1, y: 0, z: z2 },
  ];
  const ring = corners.map(p => findOrCreateVertex(e, p));
  for (let i = 0; i < 4; i++) e.createEdgeWithIntersection(ring[i], ring[(i + 1) % 4]);
  e.splitFacesWithClosedRing(ring);
}

// Circle tool commit flow on the ground plane
function drawCircle(e: GeometryEngine, cx: number, cz: number, r: number, segments = 24) {
  const ids: string[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    ids.push(e.createVertex({ x: cx + Math.cos(a) * r, y: 0, z: cz + Math.sin(a) * r }).id);
  }
  for (let i = 0; i < segments; i++) {
    e.createEdgeWithIntersection(ids[i], ids[(i + 1) % segments]);
  }
  const splits = e.splitFacesWithClosedRing(ids);
  if (splits === 0) e.createFace(ids);
}

function faceAreas(e: GeometryEngine): number[] {
  return [...e.getInternalMesh().faces.keys()]
    .map(fid => e.computeFaceArea(fid))
    .sort((a, b) => a - b);
}

test('small circle centered on a rect corner: quarter disc + intact remainder', () => {
  const e = new GeometryEngine();
  drawRect(e, -4, 0, 0, 4); // corner at origin, 4m edges
  drawCircle(e, 0, 0, 0.0305); // ~1.2" radius — chords ~8mm

  const areas = faceAreas(e);
  const quarter = Math.PI * 0.0305 * 0.0305 / 4;
  expect(areas.length).toBe(2);
  expect(areas[0]).toBeCloseTo(quarter, 3);           // quarter disc inside
  expect(areas[0] + areas[1]).toBeCloseTo(16, 6);     // area conserved — no duplicates
});

test('small circle centered mid-edge: half disc + intact remainder', () => {
  const e = new GeometryEngine();
  drawRect(e, -4, 0, 0, 4);
  drawCircle(e, -2, 0, 0.05);

  const areas = faceAreas(e);
  const half = Math.PI * 0.05 * 0.05 / 2;
  expect(areas.length).toBe(2);
  expect(areas[0]).toBeCloseTo(half, 3);
  expect(areas[0] + areas[1]).toBeCloseTo(16, 6);
});

test('small circle fully inside still punches a hole', () => {
  const e = new GeometryEngine();
  drawRect(e, -4, 0, 0, 4);
  drawCircle(e, -2, 2, 0.05);

  const areas = faceAreas(e);
  expect(areas.length).toBe(2);
  expect(areas[0] + areas[1]).toBeCloseTo(16, 6); // (rect − disc) + disc
});

test('createFace rejects degenerate zero-area rings', () => {
  const e = new GeometryEngine();
  const a = e.createVertex({ x: 0, y: 0, z: 0 });
  const b = e.createVertex({ x: 1, y: 0, z: 0 });
  const c = e.createVertex({ x: 2, y: 0, z: 0 }); // collinear
  expect(() => e.createFace([a.id, b.id, c.id])).toThrow(/zero-area/);
});
