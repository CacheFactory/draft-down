// @archigraph system.undo
// Undo after a shape is drawn ONTO another face must restore the face to its
// PRE-transaction state. TrackedMap.delete used to record the delete-time
// state — a face whose boundary gained intersection vertices before a split
// deleted it came back referencing vertices the undo removed, breaking
// geometry (the circle-tool type-to-redo flow: commit → undo → redraw).

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import { HistoryManager } from '../../implementations/data.history/HistoryManager';
import { vec3 } from '../../src/core/math';
import type { Vec3 } from '../../src/core/types';

function setup() {
  const geo = new GeometryEngine();
  const hist = new HistoryManager();
  // MaterialManager pulls in DOM-typed procedural textures — stub what
  // HistoryManager touches (setRecorder + faceAssignments.flushDeltas).
  const materialsStub = {
    setRecorder: () => {},
    faceAssignments: { flushDeltas: () => {} },
  } as any;
  hist.setTrackedSources(geo.getInternalMesh(), materialsStub);
  return { geo, hist };
}

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

// Mirror the circle tool commit flow
function drawCircle(e: GeometryEngine, cx: number, cz: number, r: number, segments = 24) {
  const ids: string[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    ids.push(e.createVertex({ x: cx + Math.cos(a) * r, y: 0, z: cz + Math.sin(a) * r }).id);
  }
  for (let i = 0; i < segments; i++) {
    e.createEdgeWithIntersection(ids[i], ids[(i + 1) % segments]);
  }
  const splits = e.splitFacesWithClosedRing(ids);
  if (splits === 0) e.createFace(ids);
}

/** Every face/edge must reference only live vertices. */
function integrityProblems(e: GeometryEngine): string[] {
  const mesh = e.getInternalMesh();
  const problems: string[] = [];
  for (const [fid, f] of mesh.faces) {
    for (const vid of f.vertexIds) {
      if (!mesh.vertices.has(vid)) problems.push(`face ${fid} → missing vertex ${vid}`);
    }
  }
  for (const [eid, ed] of mesh.edges) {
    if (!mesh.vertices.has(ed.startVertexId) || !mesh.vertices.has(ed.endVertexId)) {
      problems.push(`edge ${eid} → missing endpoint`);
    }
  }
  return problems;
}

function counts(e: GeometryEngine) {
  const m = e.getInternalMesh();
  return { faces: m.faces.size, verts: m.vertices.size, edges: m.edges.size };
}

test('undo restores a face crossed by a circle to its pre-transaction state', () => {
  const { geo, hist } = setup();
  hist.beginTransaction('Rect');
  drawRect(geo, 0, 0, 10, 10);
  hist.commitTransaction();
  const before = counts(geo);

  hist.beginTransaction('Circle');
  drawCircle(geo, 9, 5, 3); // crosses the right edge of the rectangle
  hist.commitTransaction();
  const after = counts(geo);

  hist.undo();
  expect(integrityProblems(geo)).toEqual([]);
  expect(counts(geo)).toEqual(before);
  // The surviving face must be the original 4-corner rectangle
  const face = [...geo.getInternalMesh().faces.values()][0];
  expect(face.vertexIds.length).toBe(4);

  // Redo must rebuild the split state consistently
  hist.redo();
  expect(integrityProblems(geo)).toEqual([]);
  expect(counts(geo)).toEqual(after);

  // Type-to-redo flow: undo again and redraw with a different radius
  hist.undo();
  hist.beginTransaction('Circle bigger');
  drawCircle(geo, 9, 5, 4);
  hist.commitTransaction();
  expect(integrityProblems(geo)).toEqual([]);
});

test('undo restores a hole-punched face cleanly (circle fully inside)', () => {
  const { geo, hist } = setup();
  hist.beginTransaction('Rect');
  drawRect(geo, 0, 0, 10, 10);
  hist.commitTransaction();
  const before = counts(geo);

  hist.beginTransaction('Circle');
  drawCircle(geo, 5, 5, 2);
  hist.commitTransaction();

  hist.undo();
  expect(integrityProblems(geo)).toEqual([]);
  expect(counts(geo)).toEqual(before);
  const face = [...geo.getInternalMesh().faces.values()][0];
  expect(face.holeStartIndices ?? []).toEqual([]);

  // Redraw with a different radius (the VCB type-to-redo flow)
  hist.beginTransaction('Circle bigger');
  drawCircle(geo, 5, 5, 3);
  hist.commitTransaction();
  expect(integrityProblems(geo)).toEqual([]);
  expect(counts(geo).faces).toBe(2); // holed face + circle face
});
