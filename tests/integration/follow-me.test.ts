// @archigraph op.sweep
// Follow Me (sweep): open paths cap both ends and consume the profile;
// closed paths produce a watertight ring (torus) with no caps.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import { SweepOperation } from '../../implementations/op.sweep/SweepOperation';

function makeProfile(e: GeometryEngine): string {
  // Small square in the XY plane at origin (normal +Z)
  const a = e.createVertex({ x: -0.2, y: -0.2, z: 0 });
  const b = e.createVertex({ x: 0.2, y: -0.2, z: 0 });
  const c = e.createVertex({ x: 0.2, y: 0.2, z: 0 });
  const d = e.createVertex({ x: -0.2, y: 0.2, z: 0 });
  for (const [p, q] of [[a, b], [b, c], [c, d], [d, a]] as const) e.createEdge(p.id, q.id);
  return e.createFace([a.id, b.id, c.id, d.id]).id;
}

test('open-path sweep caps ends and consumes the profile', () => {
  const e = new GeometryEngine();
  const profileId = makeProfile(e);

  // Straight 2-segment path along +Z
  const p0 = e.createVertex({ x: 0, y: 0, z: 0 });
  const p1 = e.createVertex({ x: 0, y: 0, z: 2 });
  const p2 = e.createVertex({ x: 0, y: 0, z: 4 });
  const e1 = e.createEdge(p0.id, p1.id);
  const e2 = e.createEdge(p1.id, p2.id);

  const result = new SweepOperation().execute(e, {
    profileFaceId: profileId,
    pathEdgeIds: [e1.id, e2.id],
  });

  expect(result.success).toBe(true);
  // 4 profile sides × 2 segments + 2 caps
  expect(result.newFaceIds.length).toBe(10);
  // Profile consumed
  expect(e.getFace(profileId)).toBeUndefined();
});

test('closed-path sweep produces a watertight ring with no caps', () => {
  const e = new GeometryEngine();
  const profileId = makeProfile(e);

  // Closed square path in the XZ plane
  const q0 = e.createVertex({ x: 3, y: 0, z: 0 });
  const q1 = e.createVertex({ x: 6, y: 0, z: 3 });
  const q2 = e.createVertex({ x: 3, y: 0, z: 6 });
  const q3 = e.createVertex({ x: 0, y: 0, z: 3 });
  const edges = [
    e.createEdge(q0.id, q1.id),
    e.createEdge(q1.id, q2.id),
    e.createEdge(q2.id, q3.id),
    e.createEdge(q3.id, q0.id),
  ];

  const result = new SweepOperation().execute(e, {
    profileFaceId: profileId,
    pathEdgeIds: edges.map(x => x.id),
  });

  expect(result.success).toBe(true);
  // 4 profile sides × 4 path segments, NO caps
  expect(result.newFaceIds.length).toBe(16);
  expect(e.getFace(profileId)).toBeUndefined();

  // Watertight: every new edge borders exactly 2 of the new faces
  const newFaceSet = new Set(result.newFaceIds);
  for (const eid of result.newEdgeIds) {
    const faces = e.getEdgeFaces(eid).filter(f => newFaceSet.has(f.id));
    expect(faces.length).toBe(2);
  }
});
