// @archigraph system.autoface
// classic CAD coplanar merge semantics: faces on the same plane must never
// overlap. Drawing a rectangle that partially covers an existing face must
// split that face along the drawn edges, yielding disjoint regions
// (A-only, overlap, B-only) whose areas sum to the union area.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import { vec3 } from '../../src/core/math';
import type { Vec3 } from '../../src/core/types';

function findOrCreateVertex(e: GeometryEngine, p: Vec3): string {
  const mesh = e.getInternalMesh();
  for (const [id, v] of mesh.vertices) {
    if (vec3.distance(v.position, p) < 0.01) return id;
  }
  return e.createVertex(p).id;
}

/**
 * Mirror the Rectangle tool's commit flow on the ground plane (y = 0):
 * four corners, four createEdgeWithIntersection sides, then the ring-based
 * face split (the tool's post-edge splitting step).
 */
function drawRect(e: GeometryEngine, x1: number, z1: number, x2: number, z2: number): string[] {
  const corners: Vec3[] = [
    { x: x1, y: 0, z: z1 },
    { x: x2, y: 0, z: z1 },
    { x: x2, y: 0, z: z2 },
    { x: x1, y: 0, z: z2 },
  ];
  const ring = corners.map(p => findOrCreateVertex(e, p));
  for (let i = 0; i < 4; i++) {
    e.createEdgeWithIntersection(ring[i], ring[(i + 1) % 4]);
  }
  e.splitFacesWithClosedRing(ring);
  return ring;
}

function faceAreas(e: GeometryEngine): number[] {
  const areas: number[] = [];
  for (const faceId of e.getInternalMesh().faces.keys()) {
    areas.push(e.computeFaceArea(faceId));
  }
  return areas.sort((a, b) => a - b);
}

function total(areas: number[]): number {
  return areas.reduce((s, a) => s + a, 0);
}

test('rectangle overlapping a corner of an existing face yields 3 disjoint faces', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);   // A
  drawRect(e, 5, 5, 15, 15);   // B overlaps A's corner; overlap = 5×5

  const areas = faceAreas(e);
  // Union area 175: any overlapping duplicate face pushes the sum past this.
  expect(total(areas)).toBeCloseTo(175, 5);
  expect(areas.length).toBe(3);
  expect(areas[0]).toBeCloseTo(25, 5);  // A∩B
  expect(areas[1]).toBeCloseTo(75, 5);  // A\B
  expect(areas[2]).toBeCloseTo(75, 5);  // B\A
});

test('rectangle with one side crossing into a face yields 3 disjoint faces', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);   // A
  drawRect(e, 5, 3, 15, 7);    // B: two corners inside A, overlap = 5×4

  const areas = faceAreas(e);
  expect(total(areas)).toBeCloseTo(120, 5);
  expect(areas.length).toBe(3);
  expect(areas[0]).toBeCloseTo(20, 5);  // A∩B
  expect(areas[1]).toBeCloseTo(20, 5);  // B\A
  expect(areas[2]).toBeCloseTo(80, 5);  // A\B
});

test('rectangle straddling a face (band) yields 5 disjoint faces', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);   // A
  drawRect(e, -2, 3, 12, 7);   // B crosses clean through A

  const areas = faceAreas(e);
  expect(total(areas)).toBeCloseTo(116, 5); // 100 + 56 − 40
  expect(areas.length).toBe(5);
});

test('retracing the same rectangle does not duplicate the face', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);
  drawRect(e, 0, 0, 10, 10);

  const areas = faceAreas(e);
  expect(areas.length).toBe(1);
  expect(areas[0]).toBeCloseTo(100, 5);
});

test('rectangle crossing a loose line splits into two faces', () => {
  const e = new GeometryEngine();
  const a = e.createVertex({ x: 5, y: 0, z: -3 });
  const b = e.createVertex({ x: 5, y: 0, z: 13 });
  e.createEdgeWithIntersection(a.id, b.id);
  drawRect(e, 0, 0, 10, 10);

  const areas = faceAreas(e);
  expect(areas.length).toBe(2);
  expect(areas[0]).toBeCloseTo(50, 5);
  expect(areas[1]).toBeCloseTo(50, 5);
});

test('rectangle overlapping a loose outline (erased face) forms region faces', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);
  const fid = [...e.getInternalMesh().faces.keys()][0];
  e.deleteFace(fid, { rememberDeleted: true }); // eraser semantics
  drawRect(e, 5, 5, 15, 15);

  const areas = faceAreas(e);
  // A's own region stays erased only for the EXACT original loop; the drawn
  // rectangle re-closes sub-regions, exactly like retracing in the classic modeler.
  expect(total(areas)).toBeCloseTo(175, 5);
  expect(areas.length).toBe(3);
});

test('rectangle over a dangling edge still forms its face', () => {
  const e = new GeometryEngine();
  const a = e.createVertex({ x: 5, y: 0, z: 5 });
  const b = e.createVertex({ x: 15, y: 0, z: 5 });
  e.createEdgeWithIntersection(a.id, b.id);
  drawRect(e, 0, 0, 10, 10); // line endpoint (5,5) dangles inside

  const areas = faceAreas(e);
  expect(areas.length).toBe(1);
  expect(areas[0]).toBeCloseTo(100, 5);
});

test('rectangle fully inside a face still punches a hole (regression)', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);
  drawRect(e, 3, 3, 7, 7);

  const areas = faceAreas(e);
  expect(areas.length).toBe(2);
  expect(total(areas)).toBeCloseTo(100, 5); // (100 − 16) + 16
});
