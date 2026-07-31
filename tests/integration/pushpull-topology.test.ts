// @archigraph tool.pushpull
// classic CAD push/pull topology rules:
//  - a LONE face extrudes into a closed solid (base kept)
//  - a SUB-face (pane in a wall / coplanar region) extrudes openly — the
//    original face is removed so niches and bumps connect
//  - pushing through to another face's plane punches the hole and removes
//    the membrane (an opening)
//  - pushing a face exactly onto the solid's opposite face collapses the
//    volume entirely

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

test('lone face extrudes into a closed solid (base kept)', () => {
  const e = new GeometryEngine();
  const face = rectFace(e, 0, 0, 2);
  pushPull(e, face.id, 2);

  expect(e.getMesh().faces.size).toBe(6);     // closed box
  expect(e.getFace(face.id)).toBeTruthy();    // base survives
});

test('pane in a wall extrudes openly (original face removed)', () => {
  const e = new GeometryEngine();
  rectFace(e, 0, 0, 6);             // host face
  const pane = rectFace(e, 2, 2, 2); // inner pane → hole punched in host

  pushPull(e, pane.id, 1); // pull the pane out of the host plane

  // Pane is gone; the extrusion connects openly through the host's hole:
  // host(holed) + 4 walls + moved face = 6
  expect(e.getFace(pane.id)).toBeFalsy();
  expect(e.getMesh().faces.size).toBe(6);
});

test('pushing a pane through a slab opens a hole (membrane removed)', () => {
  const e = new GeometryEngine();
  const base = rectFace(e, 0, 0, 6);
  pushPull(e, base.id, 1);          // 6x6x1 slab (6 faces); may extrude ±Y
  expect(e.getMesh().faces.size).toBe(6);

  // Find the offset cap (all verts at the same nonzero y)
  let capY = 0;
  for (const [fid] of e.getMesh().faces) {
    const verts = e.getFaceVertices(fid);
    const y0 = verts[0].position.y;
    if (Math.abs(y0) > 1e-6 && verts.every(v => Math.abs(v.position.y - y0) < 1e-6)) { capY = y0; break; }
  }
  expect(Math.abs(capY)).toBeCloseTo(1, 6);

  const pane = rectFace(e, 2, 2, 2, capY); // pane on the offset surface → hole + pane
  // Push it through the slab to y=0, whatever the pane's normal orientation
  const paneNormalY = e.getFace(pane.id)!.normal.y;
  pushPull(e, pane.id, (0 - capY) / paneNormalY);

  // Membrane at y=0 must be gone; the y=0 face must be holed.
  const mesh = e.getMesh();
  let bottomHoled = false;
  let smallCapAtBottom = false;
  for (const [fid, f] of mesh.faces) {
    const verts = e.getFaceVertices(fid);
    if (verts.length > 0 && verts.every(v => Math.abs(v.position.y) < 1e-6)) {
      if (f.holeStartIndices?.length) bottomHoled = true;
      else if (verts.length === 4 &&
               verts.every(v => v.position.x >= 1.9 && v.position.x <= 4.1 &&
                                v.position.z >= 1.9 && v.position.z <= 4.1)) {
        smallCapAtBottom = true;
      }
    }
  }
  expect(bottomHoled).toBe(true);
  expect(smallCapAtBottom).toBe(false);
  expect(e.getFace(pane.id)).toBeFalsy(); // entrance pane removed too
});

test('pushing a face exactly onto the opposite face collapses the volume', () => {
  const e = new GeometryEngine();
  const base = rectFace(e, 0, 0, 2);
  pushPull(e, base.id, 2);          // 2x2x2 cube
  expect(e.getMesh().faces.size).toBe(6);

  let topId: string | null = null;
  let capY = 0;
  for (const [fid] of e.getMesh().faces) {
    const verts = e.getFaceVertices(fid);
    const y0 = verts[0].position.y;
    if (Math.abs(y0) > 1e-6 && verts.every(v => Math.abs(v.position.y - y0) < 1e-6)) {
      topId = fid; capY = y0; break;
    }
  }
  expect(topId).toBeTruthy();

  // Push the cap all the way back to y=0, whatever its normal orientation.
  // Recompute the live normal the same way the tool does.
  const capNormalY = e.getFace(topId!)!.normal.y;
  pushPull(e, topId!, (0 - capY) / capNormalY);

  // Volume gone: just the flat base face remains
  expect(e.getMesh().faces.size).toBe(1);
  expect(e.getMesh().vertices.size).toBe(4);
});

test('pulling one triangle of a divided cube face extrudes a prism without dragging the cube', () => {
  const e = new GeometryEngine();
  const base = rectFace(e, 0, 0, 2);
  pushPull(e, base.id, 2); // cube
  expect(e.getMesh().faces.size).toBe(6);

  // Find the offset cap and divide it diagonally
  let topId: string | null = null;
  for (const [fid] of e.getMesh().faces) {
    const verts = e.getFaceVertices(fid);
    const y0 = verts[0].position.y;
    if (Math.abs(y0) > 1e-6 && verts.every(v => Math.abs(v.position.y - y0) < 1e-6)) { topId = fid; break; }
  }
  expect(topId).toBeTruthy();
  const topVerts = e.getFaceVertices(topId!);
  e.createEdgeWithAutoFace(topVerts[0].id, topVerts[2].id); // diagonal → two triangles
  expect(e.getMesh().faces.size).toBe(7);

  // Snapshot every vertex position before the pull
  const before = new Map<string, { x: number; y: number; z: number }>();
  for (const [vid, v] of e.getMesh().vertices) before.set(vid, { ...v.position });

  // Pull one of the triangles outward
  let triId: string | null = null;
  for (const [fid, f] of e.getMesh().faces) {
    if (f.vertexIds.length === 3) { triId = fid; break; }
  }
  expect(triId).toBeTruthy();
  const triVertIds = new Set(e.getFace(triId!)!.vertexIds);
  pushPull(e, triId!, 1);

  // Every PRE-EXISTING vertex must be exactly where it was — the pull must
  // not drag the cube (the old stretch path moved shared vertices).
  for (const [vid, pos] of before) {
    const v = e.getVertex(vid);
    expect(v).toBeTruthy();
    expect(v!.position.x).toBeCloseTo(pos.x, 9);
    expect(v!.position.y).toBeCloseTo(pos.y, 9);
    expect(v!.position.z).toBeCloseTo(pos.z, 9);
  }

  // The original triangle was embedded (sibling shares its plane) → removed,
  // replaced by 3 new walls + moved triangle: 7 - 1 + 4 = 10 faces.
  expect(e.getFace(triId!)).toBeFalsy();
  expect(e.getMesh().faces.size).toBe(10);

  // And there is a new triangle offset from the cap plane
  let movedTri = false;
  for (const [, f] of e.getMesh().faces) {
    if (f.vertexIds.length !== 3) continue;
    const verts = e.getFaceVertices(f.id);
    if (verts.every(v => !triVertIds.has(v.id))) movedTri = true;
  }
  expect(movedTri).toBe(true);
});

// ── Door cutting ──────────────────────────────────────────────────

import { RectangleTool } from '../../implementations/tool.rectangle/rectangleTool';

function drawRect(e: GeometryEngine, first: { x: number; y: number; z: number },
                  opposite: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }) {
  const doc = {
    geometry: e,
    selection: { clear: () => {}, isEmpty: true, state: { entityIds: new Set() } },
    history: { beginTransaction: () => {}, commitTransaction: () => {}, abortTransaction: () => {} },
    scene: {}, materials: null,
  } as any;
  const viewport = {
    camera: {}, getWidth: () => 800, getHeight: () => 600,
    renderer: { addGuideLine: () => {}, removeGuideLine: () => {} },
  } as any;
  const tool = new RectangleTool(doc, viewport, {} as any) as any;
  tool.firstCorner = { ...first };
  tool.drawPlane = { normal: { ...normal }, distance: normal.x * first.x + normal.y * first.y + normal.z * first.z };
  tool.createRectangle({ ...opposite });
}

test('rectangle touching a face boundary splits it (door outline)', () => {
  const e = new GeometryEngine();
  rectFace(e, 0, 0, 6); // host on the ground plane

  // Door: 2 wide, 2 deep, touching the host's z=0 boundary edge
  drawRect(e, { x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 0, y: 1, z: 0 });

  const mesh = e.getMesh();
  expect(mesh.faces.size).toBe(2);

  // One face is the 4-vert door, the other the 8-vert remainder
  const sizes = [...mesh.faces.values()].map(f => f.vertexIds.length).sort((a, b) => a - b);
  expect(sizes).toEqual([4, 8]);

  // No duplicate edges between any vertex pair
  const pairs = new Set<string>();
  for (const [, edge] of mesh.edges) {
    const key = [edge.startVertexId, edge.endVertexId].sort().join('|');
    expect(pairs.has(key)).toBe(false);
    pairs.add(key);
  }
});

test('full door: rect on slab touching the edge, pushed through, opens a doorway', () => {
  const e = new GeometryEngine();
  const base = rectFace(e, 0, 0, 6);
  pushPull(e, base.id, 1); // 6x6x1 slab
  // Find offset cap plane
  let capY = 0;
  for (const [fid] of e.getMesh().faces) {
    const verts = e.getFaceVertices(fid);
    const y0 = verts[0].position.y;
    if (Math.abs(y0) > 1e-6 && verts.every(v => Math.abs(v.position.y - y0) < 1e-6)) { capY = y0; break; }
  }
  expect(Math.abs(capY)).toBeCloseTo(1, 6);

  // Door rectangle on the cap, touching the cap's z=0 boundary edge
  drawRect(e, { x: 2, y: capY, z: 0 }, { x: 4, y: capY, z: 2 }, { x: 0, y: 1, z: 0 });

  // The cap is now split into door + remainder. Find the 4-vert door face on the cap plane.
  let doorId: string | null = null;
  for (const [fid, f] of e.getMesh().faces) {
    if (f.vertexIds.length !== 4) continue;
    const verts = e.getFaceVertices(fid);
    if (verts.every(v => Math.abs(v.position.y - capY) < 1e-6) &&
        verts.every(v => v.position.x >= 1.9 && v.position.x <= 4.1 && v.position.z <= 2.1)) {
      doorId = fid; break;
    }
  }
  expect(doorId).toBeTruthy();

  // Push the door panel through the slab
  const doorNormalY = e.getFace(doorId!)!.normal.y;
  pushPull(e, doorId!, (0 - capY) / doorNormalY);

  // Doorway must be OPEN: no 4-vert face covering the door region at either plane
  for (const [, f] of e.getMesh().faces) {
    const verts = e.getFaceVertices(f.id);
    if (verts.length !== 4) continue;
    const atPlane = (y: number) => verts.every(v => Math.abs(v.position.y - y) < 1e-6);
    if (atPlane(capY) || atPlane(0)) {
      const inDoor = verts.every(v =>
        v.position.x >= 1.9 && v.position.x <= 4.1 && v.position.z >= -0.1 && v.position.z <= 2.1);
      expect(inDoor).toBe(false);
    }
  }
});

test('imprecise push-through (97% of thickness) still lands on the back plane and opens', () => {
  const e = new GeometryEngine();
  const base = rectFace(e, 0, 0, 6);
  pushPull(e, base.id, 1); // slab, thickness 1 (sign per normal)
  let capY = 0;
  for (const [fid] of e.getMesh().faces) {
    const verts = e.getFaceVertices(fid);
    const y0 = verts[0].position.y;
    if (Math.abs(y0) > 1e-6 && verts.every(v => Math.abs(v.position.y - y0) < 1e-6)) { capY = y0; break; }
  }

  drawRect(e, { x: 2, y: capY, z: 0 }, { x: 4, y: capY, z: 2 }, { x: 0, y: 1, z: 0 });

  let doorId: string | null = null;
  for (const [fid, f] of e.getMesh().faces) {
    if (f.vertexIds.length !== 4) continue;
    const verts = e.getFaceVertices(fid);
    if (verts.every(v => Math.abs(v.position.y - capY) < 1e-6) &&
        verts.every(v => v.position.x >= 1.9 && v.position.x <= 4.1 && v.position.z <= 2.1)) {
      doorId = fid; break;
    }
  }
  expect(doorId).toBeTruthy();

  // Push 99% of the way through — hand-drag that missed the depth inference
  const doorNormalY = e.getFace(doorId!)!.normal.y;
  pushPull(e, doorId!, ((0 - capY) / doorNormalY) * 0.99);

  // The commit must have snapped onto the back plane: doorway open at both
  // planes, and NO face floating strictly between the planes (no sliver cap).
  for (const [, f] of e.getMesh().faces) {
    const verts = e.getFaceVertices(f.id);
    if (verts.length !== 4) continue;
    const ys = verts.map(v => v.position.y);
    const allSameY = ys.every(y => Math.abs(y - ys[0]) < 1e-6);
    if (allSameY) {
      const between = Math.abs(ys[0]) > 1e-6 && Math.abs(ys[0] - capY) > 1e-6;
      expect(between).toBe(false); // nothing stranded inside the wall
    }
    const atPlane = (y: number) => verts.every(v => Math.abs(v.position.y - y) < 1e-6);
    if (atPlane(capY) || atPlane(0)) {
      const inDoor = verts.every(v =>
        v.position.x >= 1.9 && v.position.x <= 4.1 && v.position.z >= -0.1 && v.position.z <= 2.1);
      expect(inDoor).toBe(false); // doorway open at both planes
    }
  }
});
