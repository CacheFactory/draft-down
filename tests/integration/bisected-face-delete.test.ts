// @archigraph engine.geometry
// Invariant: every face's boundary (every consecutive vertex pair in every
// ring) must be backed by a real edge entity. A face with a missing boundary
// edge renders as a "floating" surface with no outline and can never be
// selected by its border — user-visible corruption.
//
// Repro reported 2026-07: cube + one edge bisecting a face → delete a face
// → interior faces appear that have no edges on some sides.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import { PushPullTool } from '../../implementations/tool.pushpull/PushPullTool';

function makeTool(engine: GeometryEngine) {
  const document = {
    geometry: engine,
    selection: { clear: () => {}, isEmpty: true, state: { entityIds: new Set() } },
    history: {
      beginTransaction: () => {},
      commitTransaction: () => {},
      abortTransaction: () => {},
    },
    scene: {},
    materials: null,
  } as any;
  const viewport = { camera: {}, getWidth: () => 800, getHeight: () => 600, renderer: {} } as any;
  return new PushPullTool(document, viewport, {} as any);
}

function rectFace(e: GeometryEngine, x0: number, z0: number, size: number, y = 0) {
  const a = e.createVertex({ x: x0, y, z: z0 });
  const b = e.createVertex({ x: x0 + size, y, z: z0 });
  const c = e.createVertex({ x: x0 + size, y, z: z0 + size });
  const d = e.createVertex({ x: x0, y, z: z0 + size });
  e.createEdge(a.id, b.id);
  e.createEdge(b.id, c.id);
  e.createEdge(c.id, d.id);
  e.createEdge(d.id, a.id);
  return e.createFace([a.id, b.id, c.id, d.id]);
}

function pushPull(e: GeometryEngine, faceId: string, distance: number) {
  const tool = makeTool(e) as any;
  const face = e.getFace(faceId)!;
  tool.startOnFace(face, null);
  tool.currentDistance = distance;
  tool.commitExtrusion();
}

/** Every consecutive vertex pair in every ring of every face must have an edge. */
function facesMissingBoundaryEdges(e: GeometryEngine): Array<{ faceId: string; pair: [string, string] }> {
  const missing: Array<{ faceId: string; pair: [string, string] }> = [];
  const mesh = (e as any).mesh;
  for (const [faceId, face] of mesh.faces) {
    const fv = face.vertexIds;
    const ringStarts = [0, ...(face.holeStartIndices ?? [])];
    for (let r = 0; r < ringStarts.length; r++) {
      const start = ringStarts[r];
      const end = r + 1 < ringStarts.length ? ringStarts[r + 1] : fv.length;
      for (let i = start; i < end; i++) {
        const j = i + 1 < end ? i + 1 : start;
        if (!mesh.findEdgeBetween(fv[i], fv[j])) {
          missing.push({ faceId, pair: [fv[i], fv[j]] });
        }
      }
    }
  }
  return missing;
}

function findFaceAt(e: GeometryEngine, pred: (centroid: { x: number; y: number; z: number }) => boolean): string[] {
  const out: string[] = [];
  const mesh = (e as any).mesh;
  for (const [fid, f] of mesh.faces) {
    let cx = 0, cy = 0, cz = 0;
    const boundary = f.holeStartIndices?.length ? f.vertexIds.slice(0, f.holeStartIndices[0]) : f.vertexIds;
    for (const vid of boundary) {
      const v = mesh.vertices.get(vid)!;
      cx += v.position.x; cy += v.position.y; cz += v.position.z;
    }
    const n = boundary.length;
    if (pred({ x: cx / n, y: cy / n, z: cz / n })) out.push(fid);
  }
  return out;
}

describe('cube with a bisected face', () => {
  function buildBisectedCube() {
    const e = new GeometryEngine();
    const base = rectFace(e, 0, 0, 2); // y=0
    pushPull(e, base.id, 2);           // cube 2x2x2 (top may be y=2 or y=-2)
    expect(e.getMesh().faces.size).toBe(6);

    // Locate the actual top plane
    let topY = 0;
    for (const [, v] of (e as any).mesh.vertices) topY = Math.abs(v.position.y) > Math.abs(topY) ? v.position.y : topY;

    // Bisect the top face the way the Line tool does: endpoints land on the
    // midpoints of two opposite boundary edges (T-junctions healed at draw time)
    const m1 = e.createVertex({ x: 1, y: topY, z: 0 });
    const m2 = e.createVertex({ x: 1, y: topY, z: 2 });
    e.createEdgeWithIntersection(m1.id, m2.id);
    return { e, topY };
  }

  test('bisecting alone leaves every face fully edged', () => {
    const { e } = buildBisectedCube();
    expect(facesMissingBoundaryEdges(e)).toEqual([]);
    expect(e.getMesh().faces.size).toBe(7); // 4 sides + bottom + 2 top halves
  });

  test('deleting one bisected half leaves every face fully edged', () => {
    const { e, topY } = buildBisectedCube();
    const [half] = findFaceAt(e, c => Math.abs(c.y - topY) < 1e-6 && c.x < 1);
    expect(half).toBeTruthy();
    e.deleteFace(half, { rememberDeleted: true });
    expect(facesMissingBoundaryEdges(e)).toEqual([]);
    expect(e.getMesh().faces.size).toBe(6);
  });

  test('deleting a side face leaves every face fully edged', () => {
    const { e } = buildBisectedCube();
    const [side] = findFaceAt(e, c => Math.abs(c.x) < 1e-6); // x=0 side wall
    expect(side).toBeTruthy();
    e.deleteFace(side, { rememberDeleted: true });
    expect(facesMissingBoundaryEdges(e)).toEqual([]);
    expect(e.getMesh().faces.size).toBe(6);
  });
});

describe('cube built by push/pulling two bisected halves', () => {
  function buildTwoPrismCube() {
    const e = new GeometryEngine();
    rectFace(e, 0, 0, 2); // y=0, 2x2
    // Bisect the base BEFORE extruding (line across at x=1)
    const m1 = e.createVertex({ x: 1, y: 0, z: 0 });
    const m2 = e.createVertex({ x: 1, y: 0, z: 2 });
    e.createEdgeWithIntersection(m1.id, m2.id);
    expect((e as any).mesh.faces.size).toBe(2); // two halves

    const [halfA] = findFaceAt(e, c => Math.abs(c.y) < 1e-9 && c.x < 1);
    pushPull(e, halfA, 2);
    const missingAfterFirst = facesMissingBoundaryEdges(e);
    const [halfB] = findFaceAt(e, c => Math.abs(c.y) < 1e-9 && c.x > 1);
    pushPull(e, halfB, 2);
    return { e, missingAfterFirst };
  }

  test('both prisms leave every face fully edged', () => {
    const { e, missingAfterFirst } = buildTwoPrismCube();
    expect(missingAfterFirst).toEqual([]);
    expect(facesMissingBoundaryEdges(e)).toEqual([]);
  });

  test('all faces stay planar quads (no bent hexagons threading the solid)', () => {
    const { e } = buildTwoPrismCube();
    const mesh = (e as any).mesh;
    // Expected: halfB base + 3 prism-A walls + shared membrane + 2 caps + 3 prism-B walls
    const summary: string[] = [];
    for (const [fid, f] of mesh.faces) {
      const pos = f.vertexIds.map((vid: string) => mesh.vertices.get(vid)!.position);
      summary.push(`${fid.slice(0,8)} n=${f.vertexIds.length} :: ${pos.map((p: any) => `(${p.x},${p.y},${p.z})`).join(' ')}`);
    }
    if (mesh.faces.size !== 10) console.log('faces:\n' + summary.join('\n'));
    expect(mesh.faces.size).toBe(10);
    for (const [, f] of mesh.faces) {
      expect(f.vertexIds.length).toBe(4);
      // Planarity: all vertices on the face's plane
      const pos = f.vertexIds.map((vid: string) => mesh.vertices.get(vid)!.position);
      const n = mesh.computePolygonNormal(pos);
      const d = pos[0].x * n.x + pos[0].y * n.y + pos[0].z * n.z;
      for (const p of pos) {
        expect(Math.abs(p.x * n.x + p.y * n.y + p.z * n.z - d)).toBeLessThan(1e-6);
      }
    }
  });

  test('deleting a side face after both extrusions leaves every face fully edged', () => {
    const { e } = buildTwoPrismCube();
    const [side] = findFaceAt(e, c => Math.abs(c.x) < 1e-6);
    expect(side).toBeTruthy();
    e.deleteFace(side, { rememberDeleted: true });
    expect(facesMissingBoundaryEdges(e)).toEqual([]);
  });
});

describe('post-delete auto-face heal (tryAutoFaceForEdge)', () => {
  test('does not create non-planar faces from loops with collinear leading vertices', () => {
    const e = new GeometryEngine();
    const base = rectFace(e, 0, 0, 2);
    pushPull(e, base.id, 2);
    let topY = 0;
    const mesh = (e as any).mesh;
    for (const [, v] of mesh.vertices) topY = Math.abs(v.position.y) > Math.abs(topY) ? v.position.y : topY;
    const m1 = e.createVertex({ x: 1, y: topY, z: 0 });
    const m2 = e.createVertex({ x: 1, y: topY, z: 2 });
    e.createEdgeWithIntersection(m1.id, m2.id);

    const [half] = findFaceAt(e, c => Math.abs(c.y - topY) < 1e-6 && c.x < 1);
    const f = mesh.faces.get(half)!;
    const fv = f.vertexIds;
    const edgeIds: string[] = [];
    for (let i = 0; i < fv.length; i++) {
      const ed = mesh.findEdgeBetween(fv[i], fv[(i + 1) % fv.length]);
      if (ed) edgeIds.push(ed.id);
    }

    // SelectTool's Delete path: delete face, then retry auto-face on its edges
    e.deleteFace(half, { rememberDeleted: true });
    for (const eid of edgeIds) {
      if (e.getEdge(eid)) (e as any).tryAutoFaceForEdge(eid);
    }

    expect(mesh.faces.size).toBe(6); // nothing re-created, nothing bogus
    for (const [, face] of mesh.faces) {
      const pos = face.vertexIds.map((vid: string) => mesh.vertices.get(vid)!.position);
      const n = mesh.computePolygonNormal(pos);
      const d = pos[0].x * n.x + pos[0].y * n.y + pos[0].z * n.z;
      for (const p of pos) {
        expect(Math.abs(p.x * n.x + p.y * n.y + p.z * n.z - d)).toBeLessThan(1e-6);
      }
    }
    expect(facesMissingBoundaryEdges(e)).toEqual([]);
  });

  test('checkCoplanar: collinear leading vertices no longer bypass the planarity check', () => {
    const e = new GeometryEngine();
    const a = e.createVertex({ x: 0, y: 0, z: 0 });
    const b = e.createVertex({ x: 1, y: 0, z: 0 });
    const c = e.createVertex({ x: 2, y: 0, z: 0 });
    // The exact bogus loop from the app repro: collinear A,B,C then a ring
    // wrapping the cube — genuinely non-planar (max plane deviation ~1.15m)
    const d1 = e.createVertex({ x: 2, y: -2, z: 0 });
    const d2 = e.createVertex({ x: 2, y: -2, z: 2 });
    const d3 = e.createVertex({ x: 0, y: -2, z: 2 });
    const d4 = e.createVertex({ x: 0, y: 0, z: 2 });
    expect(e.checkCoplanar([a.id, b.id, c.id, d1.id, d2.id, d3.id, d4.id])).toBe(false);

    const flat1 = e.createVertex({ x: 2, y: 0, z: 2 });
    const flat2 = e.createVertex({ x: 0, y: 0, z: 2 });
    expect(e.checkCoplanar([a.id, b.id, c.id, flat1.id, flat2.id])).toBe(true);
  });
});
