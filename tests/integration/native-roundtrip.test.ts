// @archigraph file.native
// Native format round-trip: EVERYTHING the app can create must survive
// serialize → deserialize — geometry (incl. soft/smooth/hidden edges,
// curveIds, holed faces), components + instance families, scene pages,
// layers + active layer, materials + face assignments, metadata, and the
// app-level extra state channel (guides/section).

import { ModelDocument } from '../../implementations/data.document/ModelDocument';
import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import type { SceneManager } from '../../implementations/data.scene/SceneManager';

function buildRichDocument(): ModelDocument {
  const doc = new ModelDocument(new GeometryEngine());
  const geo = doc.geometry;

  // Rectangle face
  const a = geo.createVertex({ x: 0, y: 0, z: 0 });
  const b = geo.createVertex({ x: 2, y: 0, z: 0 });
  const c = geo.createVertex({ x: 2, y: 0, z: 2 });
  const d = geo.createVertex({ x: 0, y: 0, z: 2 });
  for (const [p, q] of [[a, b], [b, c], [c, d], [d, a]] as const) geo.createEdge(p.id, q.id);
  const face = geo.createFace([a.id, b.id, c.id, d.id]);

  // A soft/smooth edge and a hidden edge (loose)
  const e1 = geo.createVertex({ x: 5, y: 0, z: 0 });
  const e2 = geo.createVertex({ x: 6, y: 0, z: 0 });
  const soft = geo.createEdge(e1.id, e2.id);
  soft.soft = true;
  soft.smooth = true;
  const e3 = geo.createVertex({ x: 5, y: 0, z: 1 });
  const hidden = geo.createEdge(e1.id, e3.id);
  hidden.hidden = true;

  // A curve (arc-like chain with shared curveId)
  const c1 = geo.createVertex({ x: 8, y: 0, z: 0 });
  const c2 = geo.createVertex({ x: 8.5, y: 0, z: 0.5 });
  const c3 = geo.createVertex({ x: 9, y: 0, z: 0 });
  geo.createEdge(c1.id, c2.id).curveId = 'curve-test';
  geo.createEdge(c2.id, c3.id).curveId = 'curve-test';

  // Component + a sibling instance in one family
  const sm = doc.scene as SceneManager & { [k: string]: any };
  const compA = sm.createComponent('Door', [face.id]);
  const compB = sm.createComponent('Door', [soft.id]);
  sm.linkInstanceToFamily(compA, compB);

  // Layer + assignment + active
  const layer = sm.addLayer('Walls');
  sm.activeLayerId = layer.id;

  // Scene page
  sm.addScenePage({
    name: 'Front View',
    cameraPosition: { x: 1, y: 2, z: 3 },
    cameraTarget: { x: 0, y: 0, z: 0 },
    cameraFov: 45,
    projection: 'perspective',
    renderMode: 'shaded',
    layerVisibility: { [layer.id]: false },
    sectionPlane: { point: { x: 1, y: 0, z: 1 }, normal: { x: 0, y: 1, z: 0 } },
  });

  // Material + face assignment
  const mat = (doc.materials as any).addMaterial({ name: 'Red Paint', color: { r: 1, g: 0, b: 0 }, opacity: 1, roughness: 0.5, metalness: 0 });
  (doc.materials as any).faceAssignments.set(face.id, { front: mat.id, back: mat.id });

  // Extra state channel (guides/section — normally provided by Application)
  (doc as any).extraStateProvider = () => ({
    guides: [{ id: 'guide-1', start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 }, color: { r: 0, g: 0, b: 0 }, dashed: true }],
    section: { point: { x: 1, y: 1, z: 1 }, normal: { x: 0, y: 1, z: 0 } },
  });

  doc.metadata.name = 'Round Trip Test';
  doc.metadata.units = 'inches';
  return doc;
}

test('native format round-trips geometry, components, scenes, layers, materials, extra state', () => {
  const doc = buildRichDocument();
  const sm = doc.scene as any;
  const origFamilies = sm.componentFamilies.size;
  const origComponents = sm.components.size;
  const buffer = doc.serialize();

  const restored = new ModelDocument(new GeometryEngine());
  restored.deserialize(buffer);
  const rsm = restored.scene as any;
  const rgeo = restored.geometry;
  const rmesh = rgeo.getMesh();

  // Metadata
  expect(restored.metadata.name).toBe('Round Trip Test');
  expect(restored.metadata.units).toBe('inches');

  // Geometry counts
  const omesh = doc.geometry.getMesh();
  expect(rmesh.vertices.size).toBe(omesh.vertices.size);
  expect(rmesh.edges.size).toBe(omesh.edges.size);
  expect(rmesh.faces.size).toBe(omesh.faces.size);

  // Edge flags + curve ids
  let softCount = 0, hiddenCount = 0, curveCount = 0;
  for (const e of rmesh.edges.values()) {
    if (e.soft && e.smooth) softCount++;
    if (e.hidden) hiddenCount++;
    if (e.curveId === 'curve-test') curveCount++;
  }
  expect(softCount).toBe(1);
  expect(hiddenCount).toBe(1);
  expect(curveCount).toBe(2);

  // Components + families (instances stay linked)
  expect(rsm.components.size).toBe(origComponents);
  expect(rsm.componentFamilies.size).toBe(origFamilies);
  const familyWithTwo = [...rsm.componentFamilies.values()].find((f: any) => f.instanceIds.size === 2);
  expect(familyWithTwo).toBeTruthy();
  // getSiblingInstanceIds works on the restored doc (familyOf index rebuilt)
  const anyInstance = [...(familyWithTwo as any).instanceIds][0] as string;
  expect(rsm.getSiblingInstanceIds(anyInstance).length).toBe(1);

  // Layers + active layer
  const wallLayer = [...rsm.layers.values()].find((l: any) => l.name === 'Walls');
  expect(wallLayer).toBeTruthy();
  expect(rsm.activeLayerId).toBe((wallLayer as any).id);

  // Scene page incl. section
  expect(rsm.scenePages.length).toBe(1);
  expect(rsm.scenePages[0].name).toBe('Front View');
  expect(rsm.scenePages[0].sectionPlane.normal.y).toBe(1);

  // Materials + face assignment
  const redMat = [...rsm ? restored.materials.materials.values() : []].find((m: any) => m.name === 'Red Paint');
  expect(redMat).toBeTruthy();
  expect((restored.materials as any).faceAssignments.size).toBe(1);

  // Extra state surfaced for the Application to apply
  const extra = (restored as any).lastExtraState;
  expect(extra.guides.length).toBe(1);
  expect(extra.guides[0].dashed).toBe(true);
  expect(extra.section.normal.y).toBe(1);
});

test('deserialize rejects garbage', () => {
  const restored = new ModelDocument(new GeometryEngine());
  const garbage = new ArrayBuffer(64);
  expect(() => restored.deserialize(garbage)).toThrow(/magic/i);
});
