// @archigraph tool.arc
// Drawing an arc across a face must split it into two independent faces
// (classic CAD behavior). The arc tool creates edges per segment, so it must
// pass the FULL vertex chain to splitFaceWithPath afterward — per-segment
// intersection handling cannot see the whole path and leaves a broken split.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';

function rectFace(e: GeometryEngine) {
  const a = e.createVertex({ x: 0, y: 0, z: 0 });
  const b = e.createVertex({ x: 2, y: 0, z: 0 });
  const c = e.createVertex({ x: 2, y: 0, z: 2 });
  const d = e.createVertex({ x: 0, y: 0, z: 2 });
  e.createEdge(a.id, b.id);
  e.createEdge(b.id, c.id);
  e.createEdge(c.id, d.id);
  e.createEdge(d.id, a.id);
  e.createFace([a.id, b.id, c.id, d.id]);
  return { a, b, c, d };
}

// Arc-like path: start on the bottom edge, bulge through the interior,
// end on the top edge — exactly what the arc tool commits.
const ARC_POINTS = [
  { x: 1.0, y: 0, z: 0 },
  { x: 0.7, y: 0, z: 0.5 },
  { x: 0.6, y: 0, z: 1.0 },
  { x: 0.7, y: 0, z: 1.5 },
  { x: 1.0, y: 0, z: 2 },
];

test('arc across a face splits it into two faces sharing the arc vertices', () => {
  const e = new GeometryEngine();
  rectFace(e);

  // Mirror the (fixed) arc tool commit flow: per-segment edges with
  // intersection handling, then one full-chain face split.
  const vids: string[] = [];
  for (const p of ARC_POINTS) vids.push(e.createVertex(p).id);
  for (let i = 0; i < vids.length - 1; i++) {
    e.createEdgeWithIntersection(vids[i], vids[i + 1]);
  }
  e.splitFaceWithPath(vids);

  const mesh = e.getMesh();
  expect(mesh.faces.size).toBe(2);

  // Both halves must carry the full arc on their shared boundary
  for (const [, face] of mesh.faces) {
    for (const vid of vids) {
      expect(face.vertexIds).toContain(vid);
    }
  }

  // And they must be independent: deleting one leaves the other
  const [first] = mesh.faces.keys();
  e.deleteFace(first, { rememberDeleted: true });
  expect(mesh.faces.size).toBe(1);
});

// Both split directions: which branch splitFaceAtBoundary takes depends on
// where the arc endpoints land in the face's vertex ring order. The
// left-to-right arc historically hit the broken branch (self-crossing faceB,
// parent face left behind).
function arcAcross(e: GeometryEngine, from: { x: number; z: number }, to: { x: number; z: number }, segments: number) {
  const vids: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t + (i === 0 || i === segments ? 0 : Math.sin(Math.PI * t));
    vids.push(e.createVertex({ x, y: 0, z }).id);
  }
  for (let i = 0; i < vids.length - 1; i++) {
    e.createEdgeWithIntersection(vids[i], vids[i + 1]);
  }
  e.splitFaceWithPath(vids);
  return vids;
}

function bigRectFace(e: GeometryEngine) {
  const a = e.createVertex({ x: 0, y: 0, z: 0 });
  const b = e.createVertex({ x: 4, y: 0, z: 0 });
  const c = e.createVertex({ x: 4, y: 0, z: 3 });
  const d = e.createVertex({ x: 0, y: 0, z: 3 });
  e.createEdge(a.id, b.id);
  e.createEdge(b.id, c.id);
  e.createEdge(c.id, d.id);
  e.createEdge(d.id, a.id);
  e.createFace([a.id, b.id, c.id, d.id]);
}

test('12-segment arc left edge to right edge splits into exactly two faces', () => {
  const e = new GeometryEngine();
  bigRectFace(e);
  const vids = arcAcross(e, { x: 0, z: 1.5 }, { x: 4, z: 1.5 }, 12);

  expect(e.getMesh().faces.size).toBe(2);
  for (const [, face] of e.getMesh().faces) {
    for (const vid of vids) expect(face.vertexIds).toContain(vid);
  }
});

test('12-segment arc right edge to left edge splits into exactly two faces', () => {
  const e = new GeometryEngine();
  bigRectFace(e);
  const vids = arcAcross(e, { x: 4, z: 1.5 }, { x: 0, z: 1.5 }, 12);

  expect(e.getMesh().faces.size).toBe(2);
  for (const [, face] of e.getMesh().faces) {
    for (const vid of vids) expect(face.vertexIds).toContain(vid);
  }
});

// Arch on a single edge: both endpoints on the same boundary edge, bulging
// into the face. The inserted endpoints are ring-adjacent — historically
// splitFaceAtBoundary refused to split ("Adjacent") and the parent survived
// alongside auto-created children (3 faces).
function archOnBottomEdge(e: GeometryEngine, x1: number, x2: number, segments: number) {
  const vids: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = x1 + (x2 - x1) * t;
    const z = i === 0 || i === segments ? 0 : Math.sin(Math.PI * t) * 1.5;
    vids.push(e.createVertex({ x, y: 0, z }).id);
  }
  for (let i = 0; i < vids.length - 1; i++) {
    e.createEdgeWithIntersection(vids[i], vids[i + 1]);
  }
  e.splitFaceWithPath(vids);
  return vids;
}

test('arch with both endpoints on the same edge splits into arch + remainder', () => {
  const e = new GeometryEngine();
  bigRectFace(e);
  archOnBottomEdge(e, 1, 3, 8);

  const sizes = [...e.getMesh().faces.values()].map(f => f.vertexIds.length).sort((a, b) => a - b);
  expect(e.getMesh().faces.size).toBe(2);
  // Arch: 2 endpoints + 7 interior = 9; remainder: ring(6) + 7 interior = 13
  expect(sizes).toEqual([9, 13]);
});

test('arch drawn right-to-left on the same edge also splits cleanly', () => {
  const e = new GeometryEngine();
  bigRectFace(e);
  archOnBottomEdge(e, 3, 1, 8);

  expect(e.getMesh().faces.size).toBe(2);
});
