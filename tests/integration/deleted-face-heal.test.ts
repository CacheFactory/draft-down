// @archigraph system.autoface
// Deleting a face suppresses ONLY its exact loop. Lines drawn afterwards must
// re-form faces: retracing heals the loop, and new edges across the face-less
// region close sub-loops — including when the line's ENDPOINTS land mid-edge
// (T-junction healing in createEdgeWithIntersection; without it the endpoint
// sits on the loop's edge unconnected and no face can form).
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

// Line tool commit: findOrCreateVertex + createEdgeWithIntersection
function drawLine(e: GeometryEngine, p1: Vec3, p2: Vec3) {
  const v1 = findOrCreateVertex(e, p1);
  const v2 = findOrCreateVertex(e, p2);
  e.createEdgeWithIntersection(v1, v2);
}

function faceAreas(e: GeometryEngine): number[] {
  const m = e.getInternalMesh();
  return [...m.faces.keys()]
    .map(fid => +e.computeFaceArea(fid).toFixed(2))
    .sort((a, b) => a - b);
}

function deleteOnlyFace(e: GeometryEngine) {
  const fid = [...e.getInternalMesh().faces.keys()][0];
  e.deleteFace(fid, { rememberDeleted: true });
}

test('R1: delete face, retrace a boundary edge heals it', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);
  deleteOnlyFace(e);
  drawLine(e, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }); // retrace bottom edge
  expect(faceAreas(e)).toEqual([100]);
});

test('R2: delete face, diagonal corner-to-corner makes two triangles', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);
  deleteOnlyFace(e);
  drawLine(e, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 10 });
  expect(faceAreas(e)).toEqual([50, 50]);
});

test('R3: delete face, line across loop with endpoints ON edges', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);
  deleteOnlyFace(e);
  drawLine(e, { x: 0, y: 0, z: 5 }, { x: 10, y: 0, z: 5 }); // mid-left to mid-right
  expect(faceAreas(e)).toEqual([50, 50]);
});

test('R4: delete face AND one edge, redraw the edge re-forms the face', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);
  deleteOnlyFace(e);
  // Erase the bottom edge like the eraser would
  const m = e.getInternalMesh();
  for (const [eid, ed] of m.edges) {
    const a = m.vertices.get(ed.startVertexId)!.position;
    const b = m.vertices.get(ed.endVertexId)!.position;
    if (Math.abs(a.z) < 0.01 && Math.abs(b.z) < 0.01) { e.deleteEdge(eid); break; }
  }
  expect(faceAreas(e)).toEqual([]);
  drawLine(e, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
  expect(faceAreas(e)).toEqual([100]);
});

test('R5: face NOT deleted, line across face still splits (control)', () => {
  const e = new GeometryEngine();
  drawRect(e, 0, 0, 10, 10);
  drawLine(e, { x: 0, y: 0, z: 5 }, { x: 10, y: 0, z: 5 });
  expect(faceAreas(e)).toEqual([50, 50]);
});
