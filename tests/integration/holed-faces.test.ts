// @archigraph engine.geometry
// Faces with holes: vertexIds = outer ring + hole rings, holeStartIndices
// marks ring starts. Every consumer must treat the rings separately —
// regression tests for the corruption cluster found 2026-06-11.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';

function buildHoledFace(e: GeometryEngine) {
  const o = [
    e.createVertex({ x: 0, y: 0, z: 0 }), e.createVertex({ x: 6, y: 0, z: 0 }),
    e.createVertex({ x: 6, y: 0, z: 6 }), e.createVertex({ x: 0, y: 0, z: 6 }),
  ];
  for (let i = 0; i < 4; i++) e.createEdge(o[i].id, o[(i + 1) % 4].id);
  const outer = e.createFace(o.map(v => v.id));
  const h = [
    e.createVertex({ x: 2, y: 0, z: 2 }), e.createVertex({ x: 4, y: 0, z: 2 }),
    e.createVertex({ x: 4, y: 0, z: 4 }), e.createVertex({ x: 2, y: 0, z: 4 }),
  ];
  for (let i = 0; i < 4; i++) e.createEdge(h[i].id, h[(i + 1) % 4].id);
  e.createFace(h.map(v => v.id));
  return { outerId: outer.id, o, h };
}

test('drawing a closed loop inside a face punches a hole', () => {
  const e = new GeometryEngine();
  const { outerId } = buildHoledFace(e);
  const outer = e.getFace(outerId)!;
  expect(outer.vertexIds).toHaveLength(8);
  expect(outer.holeStartIndices).toEqual([4]);
});

test('face area subtracts holes', () => {
  const e = new GeometryEngine();
  const { outerId } = buildHoledFace(e);
  expect(e.computeFaceArea(outerId)).toBeCloseTo(32, 6); // 36 outer − 4 hole
});

test('splitting an outer edge keeps hole markers on hole vertices', () => {
  const e = new GeometryEngine();
  const { outerId, h } = buildHoledFace(e);

  // Crossing line splits the bottom outer edge at (3,0,0)
  const m1 = e.createVertex({ x: 3, y: 0, z: -1 });
  const m2 = e.createVertex({ x: 3, y: 0, z: 1 });
  e.createEdgeWithIntersection(m1.id, m2.id);

  const outer = e.getFace(outerId)!;
  expect(outer.holeStartIndices).toHaveLength(1);
  const holeStart = outer.holeStartIndices![0];
  const holeVertexIds = new Set(h.map(v => v.id));
  // Every vertex from holeStart onward must be a hole vertex
  for (let i = holeStart; i < outer.vertexIds.length; i++) {
    expect(holeVertexIds.has(outer.vertexIds[i])).toBe(true);
  }
});

test('deleting a hole-to-outer bridge edge does not kill the face', () => {
  const e = new GeometryEngine();
  const { outerId, o, h } = buildHoledFace(e);

  // Edge between the hole's last vertex and the outer ring's first vertex —
  // adjacent in the flat vertexIds array, but NOT a boundary segment.
  const bridge = e.createEdge(h[3].id, o[0].id);
  e.deleteEdge(bridge.id);
  expect(e.getFace(outerId)).toBeTruthy();
});

test('deleting a real outer edge still kills the holed face', () => {
  const e = new GeometryEngine();
  const { outerId, o } = buildHoledFace(e);
  const edge = e.getMesh().edges.values().next().value!;
  // find the actual o[0]-o[1] edge
  let target = edge.id;
  for (const [eid, ed] of e.getMesh().edges) {
    if ((ed.startVertexId === o[0].id && ed.endVertexId === o[1].id) ||
        (ed.startVertexId === o[1].id && ed.endVertexId === o[0].id)) { target = eid; break; }
  }
  e.deleteEdge(target);
  expect(e.getFace(outerId)).toBeFalsy();
});

test('splitting a holed face along a path is refused, not corrupted', () => {
  const e = new GeometryEngine();
  const { outerId } = buildHoledFace(e);
  const before = e.getFace(outerId)!.vertexIds.length;

  // Path across the face (avoiding the hole)
  const p1 = e.createVertex({ x: 1, y: 0, z: 0 });
  const p2 = e.createVertex({ x: 1, y: 0, z: 6 });
  e.splitFaceWithPath([p1.id, p2.id]);

  const outer = e.getFace(outerId)!;
  expect(outer).toBeTruthy();                       // face survives
  expect(outer.vertexIds).toHaveLength(before);     // and is untouched
  expect(outer.holeStartIndices).toEqual([4]);
});
