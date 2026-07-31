// @archigraph test.integration.geometry
// classic-CAD-style face lifetime: a face cannot outlive its bounding edges.
// Deleting any edge a face depends on must delete the face — including edges
// produced by splits (line drawn across a face boundary).

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';

function makeRectVertices(engine: GeometryEngine, y = 0) {
  const a = engine.createVertex({ x: 0, y, z: 0 });
  const b = engine.createVertex({ x: 2, y, z: 0 });
  const c = engine.createVertex({ x: 2, y, z: 2 });
  const d = engine.createVertex({ x: 0, y, z: 2 });
  return { a, b, c, d };
}

describe('face cascade on edge delete (classic CAD behavior)', () => {
  test('deleting an edge of an explicit face deletes the face', () => {
    const e = new GeometryEngine();
    const { a, b, c, d } = makeRectVertices(e);
    e.createEdge(a.id, b.id);
    e.createEdge(b.id, c.id);
    e.createEdge(c.id, d.id);
    const e4 = e.createEdge(d.id, a.id);
    const f = e.createFace([a.id, b.id, c.id, d.id]);

    e.deleteEdge(e4.id);
    expect(e.getFace(f.id)).toBeFalsy();
  });

  test('deleting an edge of an auto-created face deletes the face', () => {
    const e = new GeometryEngine();
    const { a, b, c, d } = makeRectVertices(e);
    e.createEdgeWithIntersection(a.id, b.id);
    e.createEdgeWithIntersection(b.id, c.id);
    e.createEdgeWithIntersection(c.id, d.id);
    const edges = e.createEdgeWithIntersection(d.id, a.id);
    expect(e.getMesh().faces.size).toBeGreaterThan(0);

    e.deleteEdge(edges[0].id);
    expect(e.getMesh().faces.size).toBe(0);
  });

  test('every non-overhanging edge of a bisected rectangle borders a face', () => {
    const e = new GeometryEngine();
    const { a, b, c, d } = makeRectVertices(e);
    e.createEdgeWithIntersection(a.id, b.id);
    e.createEdgeWithIntersection(b.id, c.id);
    e.createEdgeWithIntersection(c.id, d.id);
    e.createEdgeWithIntersection(d.id, a.id);

    // Bisect: line crossing the rectangle splits two boundary edges + the face
    const m1 = e.createVertex({ x: 1, y: 0, z: -0.5 });
    const m2 = e.createVertex({ x: 1, y: 0, z: 2.5 });
    e.createEdgeWithIntersection(m1.id, m2.id);

    const mesh = e.getMesh();
    expect(mesh.faces.size).toBe(2);

    // The overhanging segments (outside the rectangle) legitimately border no
    // face; every other edge — including the split halves — must border one.
    for (const [eid, edge] of mesh.edges) {
      const sv = mesh.vertices.get(edge.startVertexId)!.position;
      const ev = mesh.vertices.get(edge.endVertexId)!.position;
      const overhangs = sv.z < 0 || sv.z > 2 || ev.z < 0 || ev.z > 2;
      if (!overhangs) {
        expect(e.getEdgeFaces(eid).length).toBeGreaterThan(0);
      }
    }
  });

  test('intentionally deleted face stays deleted (no auto-reface)', () => {
    const e = new GeometryEngine();
    const { a, b, c, d } = makeRectVertices(e);
    e.createEdge(a.id, b.id);
    const ab = e.getMesh().edges.values().next().value!;
    e.createEdge(b.id, c.id);
    e.createEdge(c.id, d.id);
    e.createEdge(d.id, a.id);
    const f = e.createFace([a.id, b.id, c.id, d.id]);

    // User deletes the face — edges remain, loop still closes
    e.deleteFace(f.id, { rememberDeleted: true });
    expect(e.getMesh().faces.size).toBe(0);

    // Auto-face must NOT resurrect it (this is what the select tool's
    // delete pass and later drawing operations trigger)
    e.tryAutoFaceForEdge(ab.id);
    expect(e.getMesh().faces.size).toBe(0);
  });

  test('retracing an edge heals an intentionally deleted face', () => {
    const e = new GeometryEngine();
    const { a, b, c, d } = makeRectVertices(e);
    e.createEdge(a.id, b.id);
    e.createEdge(b.id, c.id);
    e.createEdge(c.id, d.id);
    e.createEdge(d.id, a.id);
    const f = e.createFace([a.id, b.id, c.id, d.id]);
    e.deleteFace(f.id, { rememberDeleted: true });
    expect(e.getMesh().faces.size).toBe(0);

    // classic CAD heal gesture: drawing over a boundary edge re-forms the face
    e.createEdgeWithAutoFace(a.id, b.id);
    expect(e.getMesh().faces.size).toBe(1);
  });

  test('explicit createFace overrides the deleted-face memory', () => {
    const e = new GeometryEngine();
    const { a, b, c, d } = makeRectVertices(e);
    e.createEdge(a.id, b.id);
    e.createEdge(b.id, c.id);
    e.createEdge(c.id, d.id);
    e.createEdge(d.id, a.id);
    const f = e.createFace([a.id, b.id, c.id, d.id]);
    e.deleteFace(f.id, { rememberDeleted: true });

    const f2 = e.createFace([a.id, b.id, c.id, d.id]);
    expect(e.getFace(f2.id)).toBeTruthy();
    expect(e.getMesh().faces.size).toBe(1);
  });

  test('deleting a bisecting edge still re-faces the outer loop', () => {
    const e = new GeometryEngine();
    const { a, b, c, d } = makeRectVertices(e);
    e.createEdge(a.id, b.id);
    const ab = e.getMesh().edges.values().next().value!;
    e.createEdge(b.id, c.id);
    e.createEdge(c.id, d.id);
    e.createEdge(d.id, a.id);
    e.createFace([a.id, b.id, c.id, d.id]);

    // Diagonal bisects the quad into two triangles
    const diag = e.createEdgeWithAutoFace(a.id, c.id);
    expect(e.getMesh().faces.size).toBe(2);

    // Deleting the diagonal cascades both triangles (not user-intent face
    // deletion), then the select tool's re-face pass re-forms the quad
    e.deleteEdge(diag.id);
    expect(e.getMesh().faces.size).toBe(0);
    e.tryAutoFaceForEdge(ab.id);
    expect(e.getMesh().faces.size).toBe(1);
    expect(e.getMesh().faces.values().next().value!.vertexIds).toHaveLength(4);
  });

  test('deleting a split boundary edge deletes the face it bounds', () => {
    const e = new GeometryEngine();
    const { a, b, c, d } = makeRectVertices(e);
    e.createEdgeWithIntersection(a.id, b.id);
    e.createEdgeWithIntersection(b.id, c.id);
    e.createEdgeWithIntersection(c.id, d.id);
    e.createEdgeWithIntersection(d.id, a.id);

    const m1 = e.createVertex({ x: 1, y: 0, z: -0.5 });
    const m2 = e.createVertex({ x: 1, y: 0, z: 2.5 });
    e.createEdgeWithIntersection(m1.id, m2.id);

    const mesh = e.getMesh();
    expect(mesh.faces.size).toBe(2);

    // Find a split half of the bottom boundary edge (z === 0, shorter than full width)
    let splitHalf: string | null = null;
    for (const [eid, edge] of mesh.edges) {
      const sv = mesh.vertices.get(edge.startVertexId)!.position;
      const ev = mesh.vertices.get(edge.endVertexId)!.position;
      if (sv.z === 0 && ev.z === 0 && Math.abs(sv.x - ev.x) < 1.5) {
        splitHalf = eid;
        break;
      }
    }
    expect(splitHalf).toBeTruthy();

    // Deleting the split half must delete exactly the face that depends on it
    e.deleteEdge(splitHalf!);
    expect(mesh.faces.size).toBe(1);
  });
});
