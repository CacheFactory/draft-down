// @archigraph data.document
// Geometry clipboard: copy a selection into detached data, paste it back.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import { copyGeometry, instantiateGeometry } from '../../implementations/data.document/GeometryClipboard';

// Minimal material manager stub (the real one pulls in canvas-based
// procedural textures, which need a DOM)
function makeMaterialsStub() {
  const assignments = new Map<string, string>();
  const mats = new Map<string, { id: string; name: string }>([
    ['mat-red', { id: 'mat-red', name: 'Test Red' }],
  ]);
  return {
    getMaterial: (id: string) => mats.get(id),
    getFaceMaterial: (faceId: string) => {
      const id = assignments.get(faceId);
      return id ? mats.get(id)! : { id: '__default__', name: 'Default' };
    },
    applyToFace: (faceId: string, materialId: string) => {
      assignments.set(faceId, materialId);
    },
  } as any;
}

function makeRect(e: GeometryEngine, x0 = 0) {
  const a = e.createVertex({ x: x0, y: 0, z: 0 });
  const b = e.createVertex({ x: x0 + 2, y: 0, z: 0 });
  const c = e.createVertex({ x: x0 + 2, y: 0, z: 2 });
  const d = e.createVertex({ x: x0, y: 0, z: 2 });
  e.createEdge(a.id, b.id);
  e.createEdge(b.id, c.id);
  e.createEdge(c.id, d.id);
  e.createEdge(d.id, a.id);
  return e.createFace([a.id, b.id, c.id, d.id]);
}

test('copy a face captures vertices, boundary edges, and anchor', () => {
  const e = new GeometryEngine();
  const face = makeRect(e);

  const data = copyGeometry(e, null, [face.id])!;
  expect(data).toBeTruthy();
  expect(data.positions).toHaveLength(4);
  expect(data.edges).toHaveLength(4);
  expect(data.faces).toHaveLength(1);
  expect(data.anchor).toEqual({ x: 0, y: 0, z: 0 });
});

test('paste instantiates independent geometry at an offset', () => {
  const e = new GeometryEngine();
  const face = makeRect(e);
  const data = copyGeometry(e, null, [face.id])!;

  const inst = instantiateGeometry(e, null, data, { x: 10, y: 0, z: 0 });
  expect(inst.vertexIds).toHaveLength(4);
  expect(inst.faceIds).toHaveLength(1);
  expect(e.getMesh().faces.size).toBe(2);

  // Pasted copy is offset and independent: deleting it leaves the original
  const v = e.getVertex(inst.vertexIds[0])!;
  expect(v.position.x).toBeGreaterThanOrEqual(10);
  e.deleteFace(inst.faceIds[0], { rememberDeleted: true });
  expect(e.getFace(face.id)).toBeTruthy();
});

test('materials travel with the copy', () => {
  const e = new GeometryEngine();
  const materials = makeMaterialsStub();
  const face = makeRect(e);
  materials.applyToFace(face.id, 'mat-red');

  const data = copyGeometry(e, materials, [face.id])!;
  expect(data.faces[0].frontMaterialId).toBe('mat-red');

  const inst = instantiateGeometry(e, materials, data, { x: 5, y: 0, z: 0 });
  expect(materials.getFaceMaterial(inst.faceIds[0]).id).toBe('mat-red');
});

test('copying loose edges works without faces', () => {
  const e = new GeometryEngine();
  const a = e.createVertex({ x: 0, y: 0, z: 0 });
  const b = e.createVertex({ x: 1, y: 0, z: 0 });
  const edge = e.createEdge(a.id, b.id);

  const data = copyGeometry(e, null, [edge.id])!;
  expect(data.edges).toHaveLength(1);
  expect(data.faces).toHaveLength(0);

  const inst = instantiateGeometry(e, null, data, { x: 0, y: 0, z: 3 });
  expect(inst.edgeIds).toHaveLength(1);
});

test('empty or non-geometry selection copies nothing', () => {
  const e = new GeometryEngine();
  expect(copyGeometry(e, null, [])).toBeNull();
  expect(copyGeometry(e, null, ['nonexistent-id'])).toBeNull();
});
