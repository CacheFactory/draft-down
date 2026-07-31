// @archigraph engine.geometry
// classic CAD autofold: moving a vertex out of its faces' planes triangulates
// those faces along fold edges (soft+smooth) instead of leaving invalid
// non-planar polygons.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';

function quad(e: GeometryEngine) {
  const a = e.createVertex({ x: 0, y: 0, z: 0 });
  const b = e.createVertex({ x: 2, y: 0, z: 0 });
  const c = e.createVertex({ x: 2, y: 0, z: 2 });
  const d = e.createVertex({ x: 0, y: 0, z: 2 });
  for (const [p, q] of [[a, b], [b, c], [c, d], [d, a]] as const) e.createEdge(p.id, q.id);
  const f = e.createFace([a.id, b.id, c.id, d.id]);
  return { a, b, c, d, f };
}

test('lifting one quad corner folds the face into two triangles', () => {
  const e = new GeometryEngine();
  const { c, f } = quad(e);

  // Lift corner c out of plane
  c.position.y = 1;
  const folded = e.autofoldNonPlanarFaces([c.id]);
  expect(folded).toBe(1);

  const mesh = e.getInternalMesh();
  expect(mesh.faces.size).toBe(2);
  expect(e.getFace(f.id)).toBeUndefined(); // parent replaced
  for (const [fid, face] of mesh.faces) {
    expect(face.vertexIds.length).toBe(3);
    // Each triangle must be planar by construction
    expect(e.computeFaceArea(fid)).toBeGreaterThan(0);
  }

  // The fold diagonal is a NEW edge marked soft+smooth
  let softCount = 0;
  for (const [, edge] of mesh.edges) {
    if (edge.soft && edge.smooth) softCount++;
  }
  expect(softCount).toBe(1);
});

test('planar moves do not fold anything', () => {
  const e = new GeometryEngine();
  const { c } = quad(e);

  // Slide corner c WITHIN the plane
  c.position.x = 3;
  c.position.z = 3;
  expect(e.autofoldNonPlanarFaces([c.id])).toBe(0);
  expect(e.getInternalMesh().faces.size).toBe(1);
});

test('lifting a shared edge folds both adjacent quads', () => {
  const e = new GeometryEngine();
  // Two quads sharing the edge x=2
  const a = e.createVertex({ x: 0, y: 0, z: 0 });
  const b = e.createVertex({ x: 2, y: 0, z: 0 });
  const c = e.createVertex({ x: 2, y: 0, z: 2 });
  const d = e.createVertex({ x: 0, y: 0, z: 2 });
  const b2 = e.createVertex({ x: 4, y: 0, z: 0 });
  const c2 = e.createVertex({ x: 4, y: 0, z: 2 });
  for (const [p, q] of [[a, b], [b, c], [c, d], [d, a], [b, b2], [b2, c2], [c2, c]] as const) {
    e.createEdge(p.id, q.id);
  }
  e.createFace([a.id, b.id, c.id, d.id]);
  e.createFace([b.id, b2.id, c2.id, c.id]);

  // Lift ONE vertex of the shared edge — both quads go non-planar
  b.position.y = 1.5;
  const folded = e.autofoldNonPlanarFaces([b.id]);
  expect(folded).toBe(2);
  expect(e.getInternalMesh().faces.size).toBe(4); // 2 triangles each
});
