// @archigraph engine.geometry
// classic CAD face orientation: reverseFace flips winding + normal; orientFaces
// makes connected faces' windings consistent with a seed.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';

function quad(e: GeometryEngine, pts: Array<[number, number, number]>) {
  const ids = pts.map(([x, y, z]) => e.createVertex({ x, y, z }).id);
  for (let i = 0; i < ids.length; i++) e.createEdge(ids[i], ids[(i + 1) % ids.length]);
  return e.createFace(ids);
}

test('reverseFace flips winding, normal, and plane', () => {
  const e = new GeometryEngine();
  const f = quad(e, [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]]);
  const before = [...f.vertexIds];
  const beforeNormal = { ...f.normal };
  const area = e.computeFaceArea(f.id);

  e.reverseFace(f.id);
  const after = e.getFace(f.id)!;
  expect(after.vertexIds).toEqual([...before].reverse());
  expect(after.normal.x).toBeCloseTo(-beforeNormal.x, 10);
  expect(after.normal.y).toBeCloseTo(-beforeNormal.y, 10);
  expect(after.normal.z).toBeCloseTo(-beforeNormal.z, 10);
  expect(e.computeFaceArea(f.id)).toBeCloseTo(area, 10);

  // Reversing twice restores the original
  e.reverseFace(f.id);
  expect(e.getFace(f.id)!.vertexIds).toEqual(before);
});

test('orientFaces makes an inconsistently-wound neighbor consistent', () => {
  const e = new GeometryEngine();
  // Two quads sharing the edge x=2: A wound CCW (viewed from +y),
  // B wound the SAME direction across the shared edge → inconsistent.
  const a1 = e.createVertex({ x: 0, y: 0, z: 0 });
  const a2 = e.createVertex({ x: 2, y: 0, z: 0 });
  const a3 = e.createVertex({ x: 2, y: 0, z: 2 });
  const a4 = e.createVertex({ x: 0, y: 0, z: 2 });
  const b3 = e.createVertex({ x: 4, y: 0, z: 0 });
  const b4 = e.createVertex({ x: 4, y: 0, z: 2 });
  for (const [p, q] of [[a1, a2], [a2, a3], [a3, a4], [a4, a1], [a2, b3], [b3, b4], [b4, a3]] as const) {
    e.createEdge(p.id, q.id);
  }
  const faceA = e.createFace([a1.id, a2.id, a3.id, a4.id]);
  // B traverses shared edge a2→a3 in the SAME order as A → inconsistent
  const faceB = e.createFace([a2.id, a3.id, b4.id, b3.id]);

  const reversed = e.orientFaces(faceA.id);
  expect(reversed).toBe(1);

  // Now A traverses a2→a3 and B must traverse a3→a2 (opposite)
  const bVerts = e.getFace(faceB.id)!.vertexIds;
  const i3 = bVerts.indexOf(a3.id);
  const next = bVerts[(i3 + 1) % bVerts.length];
  expect(next).toBe(a2.id);

  // Idempotent: nothing to fix on a second run
  expect(e.orientFaces(faceA.id)).toBe(0);
});
