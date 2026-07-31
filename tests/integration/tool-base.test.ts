// @archigraph tool.base
// Unit tests for the shared tool infrastructure in implementations/tool.base/:
// VertexTransformSession (used by Move/Rotate/Scale) and planeGeometry
// (used by Circle/Polygon/Rectangle/Rotate).

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import { VertexTransformSession } from '../../implementations/tool.base/VertexTransformSession';
import { planeBasis, rayPlaneIntersect } from '../../implementations/tool.base/planeGeometry';
import { vec3 } from '../../src/core/math';

describe('VertexTransformSession', () => {
  function setup() {
    const engine = new GeometryEngine();
    const a = engine.createVertex({ x: 0, y: 0, z: 0 });
    const b = engine.createVertex({ x: 2, y: 0, z: 0 });
    const c = engine.createVertex({ x: 2, y: 0, z: 2 });
    const d = engine.createVertex({ x: 0, y: 0, z: 2 });
    engine.createEdge(a.id, b.id);
    engine.createEdge(b.id, c.id);
    engine.createEdge(c.id, d.id);
    engine.createEdge(d.id, a.id);
    const face = engine.createFace([a.id, b.id, c.id, d.id]);
    return { engine, face, vertIds: [a.id, b.id, c.id, d.id] };
  }

  test('gather collects unique vertices from faces and edges', () => {
    const { engine, face } = setup();
    const session = new VertexTransformSession(engine);
    const ids = session.gather([face.id]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(session.size).toBe(4);
  });

  test('apply transforms against snapshots, restore undoes', () => {
    const { engine, face } = setup();
    const session = new VertexTransformSession(engine);
    session.gather([face.id]);
    session.snapshot();

    // Live-preview style: apply twice; the second apply must be relative to
    // the ORIGINAL positions, not the first preview.
    session.apply(o => ({ x: o.x + 1, y: o.y, z: o.z }));
    const dirty = session.apply(o => ({ x: o.x + 5, y: o.y, z: o.z }));
    expect(dirty).toHaveLength(4);
    const first = engine.getVertex(session.vertexIds[0])!;
    expect(first.position.x).toBe(5); // 0 + 5, not 0 + 1 + 5

    session.restore();
    expect(engine.getVertex(session.vertexIds[0])!.position.x).toBe(0);
  });

  test('bounds reflects current positions', () => {
    const { engine, face } = setup();
    const session = new VertexTransformSession(engine);
    session.gather([face.id]);
    const bb = session.bounds();
    expect(bb.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(bb.max).toEqual({ x: 2, y: 0, z: 2 });
    expect(bb.center).toEqual({ x: 1, y: 0, z: 1 });
  });

  test('setVertices + clear manage explicit vertex lists', () => {
    const { engine, vertIds } = setup();
    const session = new VertexTransformSession(engine);
    session.setVertices(vertIds.slice(0, 2));
    expect(session.size).toBe(2);
    session.clear();
    expect(session.size).toBe(0);
  });
});

describe('planeGeometry', () => {
  test('planeBasis returns orthonormal in-plane axes', () => {
    for (const normal of [
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      vec3.normalize({ x: 1, y: 1, z: 1 }),
    ]) {
      const { tangent, bitangent } = planeBasis(normal);
      expect(vec3.length(tangent)).toBeCloseTo(1, 6);
      expect(vec3.length(bitangent)).toBeCloseTo(1, 6);
      expect(vec3.dot(tangent, normal)).toBeCloseTo(0, 6);
      expect(vec3.dot(bitangent, normal)).toBeCloseTo(0, 6);
      expect(vec3.dot(tangent, bitangent)).toBeCloseTo(0, 6);
    }
  });

  test('rayPlaneIntersect hits the ground plane', () => {
    const hit = rayPlaneIntersect(
      { origin: { x: 0, y: 10, z: 0 }, direction: vec3.normalize({ x: 1, y: -1, z: 0 }) },
      { normal: { x: 0, y: 1, z: 0 }, distance: 0 },
    );
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(0, 6);
    expect(hit!.x).toBeCloseTo(10, 6);
  });

  test('rayPlaneIntersect returns null for parallel and behind-origin rays', () => {
    const ground = { normal: { x: 0, y: 1, z: 0 }, distance: 0 };
    // Parallel to plane
    expect(rayPlaneIntersect(
      { origin: { x: 0, y: 5, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, ground,
    )).toBeNull();
    // Plane behind the ray origin
    expect(rayPlaneIntersect(
      { origin: { x: 0, y: 5, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, ground,
    )).toBeNull();
  });
});
