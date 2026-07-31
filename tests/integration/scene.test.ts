// @archigraph test.integration.scene
// Comprehensive integration tests for scene manager and selection manager

import { SceneManager } from '../../implementations/data.scene/SceneManager';
import { SelectionManager } from '../../implementations/data.selection/SelectionManager';
import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import { vec3 } from '../../src/core/math';
import type { Entity, EntityType } from '../../src/core/types';
import type { IGroup, ISceneManager, ISelectionManager, IGeometryEngine } from '../../src/core/interfaces';

// ─── Helpers ──────────────────────────────────────────────────────

function makeEntity(overrides: Partial<Entity> & { id: string; type: EntityType }): Entity {
  return {
    visible: true,
    locked: false,
    layerId: 'layer0',
    parentId: null,
    ...overrides,
  };
}

function identityTransform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

// ─── Scene Manager Tests ──────────────────────────────────────────

describe('Scene Manager', () => {
  let scene: SceneManager;

  beforeEach(() => {
    scene = new SceneManager();
  });

  // ── Entity CRUD ─────────────────────────────────────────────

  describe('Entity management', () => {
    test('adds an entity to the root', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      expect(scene.getEntity('e1')).toBeDefined();
    });

    test('adds multiple entities', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.addEntity(makeEntity({ id: 'e2', type: 'edge' }));
      scene.addEntity(makeEntity({ id: 'e3', type: 'vertex' }));
      expect(scene.getAllEntities().length).toBeGreaterThanOrEqual(4); // 3 + root
    });

    test('removes an entity', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.removeEntity('e1');
      expect(scene.getEntity('e1')).toBeUndefined();
    });

    test('removing non-existent entity is a no-op', () => {
      expect(() => scene.removeEntity('nonexistent')).not.toThrow();
    });

    test('cannot remove root entity', () => {
      const rootId = scene.root.id;
      scene.removeEntity(rootId);
      expect(scene.getEntity(rootId)).toBeDefined();
    });

    test('entity gets assigned to root parent by default', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      const entity = scene.getEntity('e1')!;
      expect(entity.parentId).toBe(scene.root.id);
    });

    test('entity is added to parent\'s children array', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      expect(scene.root.children).toContain('e1');
    });

    test('removing entity removes it from parent\'s children', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.removeEntity('e1');
      expect(scene.root.children).not.toContain('e1');
    });

    test('findEntitiesByType filters correctly', () => {
      scene.addEntity(makeEntity({ id: 'f1', type: 'face' }));
      scene.addEntity(makeEntity({ id: 'e1', type: 'edge' }));
      scene.addEntity(makeEntity({ id: 'f2', type: 'face' }));
      const faces = scene.findEntitiesByType('face');
      expect(faces).toHaveLength(2);
      expect(faces.every(e => e.type === 'face')).toBe(true);
    });

    test('findEntitiesByType returns empty for absent type', () => {
      scene.addEntity(makeEntity({ id: 'f1', type: 'face' }));
      const guides = scene.findEntitiesByType('guide');
      expect(guides).toHaveLength(0);
    });

    test('moveEntity reparents correctly', () => {
      const group = scene.createGroup('G1', []);
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.moveEntity('e1', group.id);
      const entity = scene.getEntity('e1')!;
      expect(entity.parentId).toBe(group.id);
      expect(group.children).toContain('e1');
      expect(scene.root.children).not.toContain('e1');
    });
  });

  // ── Layer CRUD ──────────────────────────────────────────────

  describe('Layer management', () => {
    test('starts with a default layer', () => {
      expect(scene.layers.size).toBe(1);
      expect(scene.layers.get('layer0')).toBeDefined();
    });

    test('adds a new layer', () => {
      const layer = scene.addLayer('Test Layer');
      expect(layer.name).toBe('Test Layer');
      expect(layer.visible).toBe(true);
      expect(layer.locked).toBe(false);
      expect(scene.layers.get(layer.id)).toBeDefined();
    });

    test('removes a layer', () => {
      const layer = scene.addLayer('Temp');
      scene.removeLayer(layer.id);
      expect(scene.layers.get(layer.id)).toBeUndefined();
    });

    test('cannot remove default layer', () => {
      scene.removeLayer('layer0');
      expect(scene.layers.get('layer0')).toBeDefined();
    });

    test('removing layer reassigns entities to default', () => {
      const layer = scene.addLayer('Custom');
      scene.addEntity(makeEntity({ id: 'e1', type: 'face', layerId: layer.id }));
      scene.removeLayer(layer.id);
      const entity = scene.getEntity('e1')!;
      expect(entity.layerId).toBe('layer0');
    });

    test('sets layer visibility', () => {
      const layer = scene.addLayer('Vis');
      scene.setLayerVisibility(layer.id, false);
      expect(scene.layers.get(layer.id)!.visible).toBe(false);
      scene.setLayerVisibility(layer.id, true);
      expect(scene.layers.get(layer.id)!.visible).toBe(true);
    });

    test('sets layer locked state', () => {
      const layer = scene.addLayer('Lock');
      scene.setLayerLocked(layer.id, true);
      expect(scene.layers.get(layer.id)!.locked).toBe(true);
      scene.setLayerLocked(layer.id, false);
      expect(scene.layers.get(layer.id)!.locked).toBe(false);
    });

    test('assigns entity to a different layer', () => {
      const layer = scene.addLayer('Other');
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.assignToLayer('e1', layer.id);
      const entity = scene.getEntity('e1')!;
      expect(entity.layerId).toBe(layer.id);
    });

    test('assigning to non-existent layer is ignored for scene entities', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.assignToLayer('e1', 'nonexistent');
      const entity = scene.getEntity('e1')!;
      expect(entity.layerId).toBe('layer0');
    });

    test('isEntityVisible reflects layer visibility', () => {
      const layer = scene.addLayer('Vis');
      scene.geometryLayerMap.set('geo1', layer.id);
      expect(scene.isEntityVisible('geo1')).toBe(true);
      scene.setLayerVisibility(layer.id, false);
      expect(scene.isEntityVisible('geo1')).toBe(false);
    });

    test('isEntityLocked reflects layer lock state', () => {
      const layer = scene.addLayer('Lock');
      scene.geometryLayerMap.set('geo1', layer.id);
      expect(scene.isEntityLocked('geo1')).toBe(false);
      scene.setLayerLocked(layer.id, true);
      expect(scene.isEntityLocked('geo1')).toBe(true);
    });

    test('entity on default layer is visible by default', () => {
      expect(scene.isEntityVisible('any-id')).toBe(true);
    });

    test('entity on default layer is not locked by default', () => {
      expect(scene.isEntityLocked('any-id')).toBe(false);
    });
  });

  // ── Group management ────────────────────────────────────────

  describe('Group management', () => {
    test('creates a group with children', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.addEntity(makeEntity({ id: 'e2', type: 'edge' }));
      const group = scene.createGroup('My Group', ['e1', 'e2']);
      expect(group.type).toBe('group');
      expect(group.children).toContain('e1');
      expect(group.children).toContain('e2');
    });

    test('creating a group reparents children from root', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      const group = scene.createGroup('G1', ['e1']);
      expect(scene.root.children).not.toContain('e1');
      expect(scene.root.children).toContain(group.id);
    });

    test('creates an empty group', () => {
      const group = scene.createGroup('Empty', []);
      expect(group.children).toHaveLength(0);
      expect(group.type).toBe('group');
    });

    test('enters and exits group editing context', () => {
      const group = scene.createGroup('G1', []);
      scene.enterGroup(group.id);
      expect(scene.editingContext.activeGroupId).toBe(group.id);
      expect(scene.editingContext.path).toContain(group.id);

      scene.exitGroup();
      expect(scene.editingContext.activeGroupId).toBeNull();
      expect(scene.editingContext.path).toHaveLength(0);
    });

    test('nested group editing context stacks correctly', () => {
      const g1 = scene.createGroup('G1', []);
      scene.enterGroup(g1.id);

      const g2 = scene.createGroup('G2', []);
      scene.enterGroup(g2.id);

      expect(scene.editingContext.activeGroupId).toBe(g2.id);
      expect(scene.editingContext.path).toEqual([g1.id, g2.id]);

      scene.exitGroup();
      expect(scene.editingContext.activeGroupId).toBe(g1.id);

      scene.exitGroup();
      expect(scene.editingContext.activeGroupId).toBeNull();
    });

    test('exitGroup is a no-op when not in a group', () => {
      expect(() => scene.exitGroup()).not.toThrow();
      expect(scene.editingContext.activeGroupId).toBeNull();
    });

    test('enterGroup is a no-op for non-group entity', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.enterGroup('e1');
      expect(scene.editingContext.activeGroupId).toBeNull();
    });

    test('explodes a group, reparenting children to parent', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.addEntity(makeEntity({ id: 'e2', type: 'edge' }));
      const group = scene.createGroup('G1', ['e1', 'e2']);
      scene.explodeGroup(group.id);

      expect(scene.getEntity(group.id)).toBeUndefined();
      const e1 = scene.getEntity('e1')!;
      expect(e1.parentId).toBe(scene.root.id);
      expect(scene.root.children).toContain('e1');
      expect(scene.root.children).toContain('e2');
    });

    test('exploding root is a no-op', () => {
      scene.explodeGroup(scene.root.id);
      expect(scene.getEntity(scene.root.id)).toBeDefined();
    });

    test('removing a group recursively removes children', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      const group = scene.createGroup('G1', ['e1']);
      scene.removeEntity(group.id);
      expect(scene.getEntity(group.id)).toBeUndefined();
      expect(scene.getEntity('e1')).toBeUndefined();
    });

    test('entities added while in group context go to active group', () => {
      const group = scene.createGroup('G1', []);
      scene.enterGroup(group.id);
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      expect(scene.getEntity('e1')!.parentId).toBe(group.id);
      expect(group.children).toContain('e1');
    });
  });

  // ── Component management ────────────────────────────────────

  describe('Component management', () => {
    test('creates a component definition', () => {
      const def = scene.createComponentDefinition('Chair', 'mesh-1');
      expect(def.name).toBe('Chair');
      expect(def.meshId).toBe('mesh-1');
      expect(scene.componentDefinitions.get(def.id)).toBeDefined();
    });

    test('places a component instance', () => {
      const def = scene.createComponentDefinition('Chair', 'mesh-1');
      const inst = scene.placeComponentInstance(def.id, identityTransform());
      expect(inst.type).toBe('component_instance');
      expect(inst.definitionId).toBe(def.id);
      expect(def.instanceIds).toContain(inst.id);
    });

    test('throws when placing instance of unknown definition', () => {
      expect(() => scene.placeComponentInstance('unknown', identityTransform())).toThrow();
    });

    test('removing component instance updates definition instanceIds', () => {
      const def = scene.createComponentDefinition('Table', 'mesh-2');
      const inst = scene.placeComponentInstance(def.id, identityTransform());
      scene.removeEntity(inst.id);
      expect(def.instanceIds).not.toContain(inst.id);
    });
  });

  // ── Scene pages ─────────────────────────────────────────────

  describe('Scene pages', () => {
    test('adds a scene page', () => {
      const page = scene.addScenePage({
        name: 'Front View',
        cameraPosition: { x: 0, y: 0, z: 10 },
        cameraTarget: { x: 0, y: 0, z: 0 },
        cameraFov: 45,
        projection: 'perspective',
        renderMode: 'shaded',
        layerVisibility: {},
      });
      expect(page.name).toBe('Front View');
      expect(page.id).toBeTruthy();
      expect(scene.scenePages).toHaveLength(1);
    });

    test('removes a scene page', () => {
      const page = scene.addScenePage({
        name: 'Top',
        cameraPosition: { x: 0, y: 10, z: 0 },
        cameraTarget: { x: 0, y: 0, z: 0 },
        cameraFov: 45,
        projection: 'orthographic',
        renderMode: 'wireframe',
        layerVisibility: {},
      });
      scene.removeScenePage(page.id);
      expect(scene.scenePages).toHaveLength(0);
    });

    test('removing non-existent scene page is a no-op', () => {
      expect(() => scene.removeScenePage('nonexistent')).not.toThrow();
    });

    test('multiple scene pages are maintained in order', () => {
      scene.addScenePage({ name: 'A', cameraPosition: { x: 0, y: 0, z: 0 }, cameraTarget: { x: 0, y: 0, z: 0 }, cameraFov: 45, projection: 'perspective', renderMode: 'shaded', layerVisibility: {} });
      scene.addScenePage({ name: 'B', cameraPosition: { x: 0, y: 0, z: 0 }, cameraTarget: { x: 0, y: 0, z: 0 }, cameraFov: 45, projection: 'perspective', renderMode: 'shaded', layerVisibility: {} });
      scene.addScenePage({ name: 'C', cameraPosition: { x: 0, y: 0, z: 0 }, cameraTarget: { x: 0, y: 0, z: 0 }, cameraFov: 45, projection: 'perspective', renderMode: 'shaded', layerVisibility: {} });
      expect(scene.scenePages.map(p => p.name)).toEqual(['A', 'B', 'C']);
    });
  });

  // ── Events ──────────────────────────────────────────────────

  describe('Events', () => {
    test('emits changed event when adding entity', () => {
      const handler = jest.fn();
      scene.on('changed', handler);
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      expect(handler).toHaveBeenCalled();
    });

    test('emits changed event when removing entity', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      const handler = jest.fn();
      scene.on('changed', handler);
      scene.removeEntity('e1');
      expect(handler).toHaveBeenCalled();
    });

    test('off unregisters handler', () => {
      const handler = jest.fn();
      scene.on('changed', handler);
      scene.off('changed', handler);
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Component editing context ───────────────────────────────

  describe('Component editing context', () => {
    test('creates and retrieves a component', () => {
      const compId = scene.createComponent('Box', ['f1', 'f2']);
      expect(scene.components.get(compId)).toBeDefined();
      expect(scene.getEntityComponent('f1')).toBe(compId);
    });

    test('entity in component is protected when not editing', () => {
      const compId = scene.createComponent('Box', ['f1']);
      expect(scene.isEntityProtected('f1')).toBe(true);
      expect(scene.isEntityEditable('f1')).toBe(false);
    });

    test('entity in component is editable when editing that component', () => {
      const compId = scene.createComponent('Box', ['f1']);
      scene.enterComponent(compId);
      expect(scene.isEntityProtected('f1')).toBe(false);
      expect(scene.isEntityEditable('f1')).toBe(true);
    });

    test('entity NOT in any component is editable in main scene', () => {
      scene.createComponent('Box', ['f1']);
      expect(scene.isEntityEditable('f2')).toBe(true);
    });

    test('entity NOT in component is NOT editable when editing a component', () => {
      const compId = scene.createComponent('Box', ['f1']);
      scene.enterComponent(compId);
      expect(scene.isEntityEditable('f2')).toBe(false);
    });

    test('exploding a component removes it', () => {
      const compId = scene.createComponent('Box', ['f1']);
      scene.explodeComponent(compId);
      expect(scene.components.get(compId)).toBeUndefined();
      expect(scene.isEntityProtected('f1')).toBe(false);
    });

    test('exiting component editing resets context', () => {
      const compId = scene.createComponent('Box', ['f1']);
      scene.enterComponent(compId);
      expect(scene.isEditingComponent).toBe(true);
      scene.exitComponent();
      expect(scene.isEditingComponent).toBe(false);
    });
  });
});

// ─── Selection Manager Tests ──────────────────────────────────────

describe('Selection Manager', () => {
  let scene: SceneManager;
  let selection: SelectionManager;

  beforeEach(() => {
    scene = new SceneManager();
    selection = new SelectionManager(scene);
  });

  // ── Basic selection ─────────────────────────────────────────

  describe('Single & multi select', () => {
    test('select replaces current selection', () => {
      selection.select('e1');
      selection.select('e2');
      expect(selection.isSelected('e1')).toBe(false);
      expect(selection.isSelected('e2')).toBe(true);
      expect(selection.count).toBe(1);
    });

    test('add appends to selection', () => {
      selection.select('e1');
      selection.add('e2');
      expect(selection.isSelected('e1')).toBe(true);
      expect(selection.isSelected('e2')).toBe(true);
      expect(selection.count).toBe(2);
    });

    test('remove removes from selection', () => {
      selection.select('e1');
      selection.add('e2');
      selection.remove('e1');
      expect(selection.isSelected('e1')).toBe(false);
      expect(selection.isSelected('e2')).toBe(true);
      expect(selection.count).toBe(1);
    });

    test('remove non-selected entity is a no-op', () => {
      selection.select('e1');
      selection.remove('e2');
      expect(selection.count).toBe(1);
    });

    test('toggle adds unselected entity', () => {
      selection.toggle('e1');
      expect(selection.isSelected('e1')).toBe(true);
    });

    test('toggle removes selected entity', () => {
      selection.select('e1');
      selection.toggle('e1');
      expect(selection.isSelected('e1')).toBe(false);
      expect(selection.isEmpty).toBe(true);
    });

    test('toggle with multiple entities', () => {
      selection.select('e1');
      selection.add('e2');
      selection.toggle('e2');
      expect(selection.count).toBe(1);
      expect(selection.isSelected('e1')).toBe(true);
    });
  });

  // ── Clear & select all ──────────────────────────────────────

  describe('Clear and select all', () => {
    test('clear empties the selection', () => {
      selection.select('e1');
      selection.add('e2');
      selection.clear();
      expect(selection.isEmpty).toBe(true);
      expect(selection.count).toBe(0);
    });

    test('clear on empty selection is safe', () => {
      expect(() => selection.clear()).not.toThrow();
    });

    test('selectAll selects all entities except root', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'face' }));
      scene.addEntity(makeEntity({ id: 'e2', type: 'edge' }));
      scene.addEntity(makeEntity({ id: 'e3', type: 'vertex' }));
      selection.selectAll();
      expect(selection.isSelected('e1')).toBe(true);
      expect(selection.isSelected('e2')).toBe(true);
      expect(selection.isSelected('e3')).toBe(true);
      expect(selection.isSelected(scene.root.id)).toBe(false);
    });
  });

  // ── Pre-selection ───────────────────────────────────────────

  describe('Pre-selection', () => {
    test('setPreSelection sets primary pre-selection', () => {
      selection.setPreSelection('e1');
      expect(selection.state.preSelectionId).toBe('e1');
    });

    test('setPreSelection null clears pre-selection', () => {
      selection.setPreSelection('e1');
      selection.setPreSelection(null);
      expect(selection.state.preSelectionId).toBeNull();
    });

    test('addPreSelection adds extra pre-selection IDs', () => {
      selection.setPreSelection('e1');
      selection.addPreSelection('e2');
      selection.addPreSelection('e3');
      const ids = selection.getPreSelectionIds();
      expect(ids).toContain('e1');
      expect(ids).toContain('e2');
      expect(ids).toContain('e3');
    });

    test('setPreSelection clears extra pre-selections', () => {
      selection.setPreSelection('e1');
      selection.addPreSelection('e2');
      selection.setPreSelection('e3');
      const ids = selection.getPreSelectionIds();
      expect(ids).toContain('e3');
      expect(ids).not.toContain('e2');
    });

    test('getPreSelectionIds returns empty when nothing pre-selected', () => {
      expect(selection.getPreSelectionIds()).toHaveLength(0);
    });
  });

  // ── Selection modes ─────────────────────────────────────────

  describe('Selection modes', () => {
    test('default mode is object', () => {
      expect(selection.state.mode).toBe('object');
    });

    test('setMode changes mode', () => {
      selection.setMode('face');
      expect(selection.state.mode).toBe('face');
    });

    test('setMode to edge', () => {
      selection.setMode('edge');
      expect(selection.state.mode).toBe('edge');
    });

    test('setMode to vertex', () => {
      selection.setMode('vertex');
      expect(selection.state.mode).toBe('vertex');
    });

    test('changing mode clears selection', () => {
      selection.select('e1');
      selection.setMode('face');
      expect(selection.isEmpty).toBe(true);
    });

    test('setting same mode does not clear selection', () => {
      selection.select('e1');
      selection.setMode('object');
      expect(selection.isSelected('e1')).toBe(true);
    });
  });

  // ── Box selection ───────────────────────────────────────────

  describe('Box selection', () => {
    test('selectInBox window mode calls without error', () => {
      expect(() => {
        selection.selectInBox({ x: 0, y: 0, width: 100, height: 100 }, 'window');
      }).not.toThrow();
    });

    test('selectInBox crossing mode calls without error', () => {
      expect(() => {
        selection.selectInBox({ x: 0, y: 0, width: 50, height: 50 }, 'crossing');
      }).not.toThrow();
    });

    test('selectInBox emits changed event', () => {
      const handler = jest.fn();
      selection.on('changed', handler);
      selection.selectInBox({ x: 0, y: 0, width: 100, height: 100 }, 'window');
      expect(handler).toHaveBeenCalled();
    });
  });

  // ── Connected selection ─────────────────────────────────────

  describe('Connected selection', () => {
    test('selectConnected with geometry engine traverses topology', () => {
      const geo = new GeometryEngine();
      const selWithGeo = new SelectionManager(scene, geo);

      const v1 = geo.createVertex(vec3.create(0, 0, 0));
      const v2 = geo.createVertex(vec3.create(1, 0, 0));
      const v3 = geo.createVertex(vec3.create(0, 0, 1));
      const face = geo.createFace([v1.id, v2.id, v3.id]);

      selWithGeo.selectConnected(face.id);
      // Should select the face, its edges, and its vertices
      expect(selWithGeo.isSelected(face.id)).toBe(true);
      expect(selWithGeo.isSelected(v1.id)).toBe(true);
      expect(selWithGeo.isSelected(v2.id)).toBe(true);
      expect(selWithGeo.isSelected(v3.id)).toBe(true);
    });

    test('selectConnected without geometry engine is a no-op', () => {
      selection.selectConnected('e1');
      expect(selection.isEmpty).toBe(true);
    });

    test('selectConnected from edge selects adjacent faces', () => {
      const geo = new GeometryEngine();
      const selWithGeo = new SelectionManager(scene, geo);

      const v1 = geo.createVertex(vec3.create(0, 0, 0));
      const v2 = geo.createVertex(vec3.create(1, 0, 0));
      const v3 = geo.createVertex(vec3.create(1, 1, 0));
      const v4 = geo.createVertex(vec3.create(0, 1, 0));
      const f1 = geo.createFace([v1.id, v2.id, v3.id]);
      const f2 = geo.createFace([v1.id, v3.id, v4.id]);
      const sharedEdge = geo.findEdgeBetween(v1.id, v3.id)!;

      selWithGeo.selectConnected(sharedEdge.id);
      expect(selWithGeo.isSelected(f1.id)).toBe(true);
      expect(selWithGeo.isSelected(f2.id)).toBe(true);
    });

    test('selectConnected from vertex selects connected edges', () => {
      const geo = new GeometryEngine();
      const selWithGeo = new SelectionManager(scene, geo);

      const v1 = geo.createVertex(vec3.create(0, 0, 0));
      const v2 = geo.createVertex(vec3.create(1, 0, 0));
      const v3 = geo.createVertex(vec3.create(0, 1, 0));
      const e1 = geo.createEdge(v1.id, v2.id);
      const e2 = geo.createEdge(v1.id, v3.id);

      selWithGeo.selectConnected(v1.id);
      expect(selWithGeo.isSelected(e1.id)).toBe(true);
      expect(selWithGeo.isSelected(e2.id)).toBe(true);
      expect(selWithGeo.isSelected(v2.id)).toBe(true);
      expect(selWithGeo.isSelected(v3.id)).toBe(true);
    });
  });

  // ── getSelectedByType ───────────────────────────────────────

  describe('getSelectedByType', () => {
    test('returns only entities of the requested type', () => {
      scene.addEntity(makeEntity({ id: 'f1', type: 'face' }));
      scene.addEntity(makeEntity({ id: 'e1', type: 'edge' }));
      scene.addEntity(makeEntity({ id: 'f2', type: 'face' }));
      selection.select('f1');
      selection.add('e1');
      selection.add('f2');
      const faces = selection.getSelectedByType('face');
      expect(faces).toHaveLength(2);
      expect(faces).toContain('f1');
      expect(faces).toContain('f2');
    });

    test('returns empty when no entities of type are selected', () => {
      scene.addEntity(makeEntity({ id: 'e1', type: 'edge' }));
      selection.select('e1');
      expect(selection.getSelectedByType('face')).toHaveLength(0);
    });
  });

  // ── Events ──────────────────────────────────────────────────

  describe('Events', () => {
    test('emits changed on select', () => {
      const handler = jest.fn();
      selection.on('changed', handler);
      selection.select('e1');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('emits changed on add', () => {
      const handler = jest.fn();
      selection.on('changed', handler);
      selection.add('e1');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('emits changed on toggle', () => {
      const handler = jest.fn();
      selection.on('changed', handler);
      selection.toggle('e1');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('emits changed on clear with items', () => {
      selection.select('e1');
      const handler = jest.fn();
      selection.on('changed', handler);
      selection.clear();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('does not emit changed on clear when already empty', () => {
      const handler = jest.fn();
      selection.on('changed', handler);
      selection.clear();
      expect(handler).not.toHaveBeenCalled();
    });

    test('emits pre-selection-changed on setPreSelection', () => {
      const handler = jest.fn();
      selection.on('pre-selection-changed', handler);
      selection.setPreSelection('e1');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('off unregisters event handler', () => {
      const handler = jest.fn();
      selection.on('changed', handler);
      selection.off('changed', handler);
      selection.select('e1');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Accessors ───────────────────────────────────────────────

  describe('Accessors', () => {
    test('isEmpty is true initially', () => {
      expect(selection.isEmpty).toBe(true);
    });

    test('isEmpty is false after select', () => {
      selection.select('e1');
      expect(selection.isEmpty).toBe(false);
    });

    test('count reflects number of selected entities', () => {
      expect(selection.count).toBe(0);
      selection.select('e1');
      expect(selection.count).toBe(1);
      selection.add('e2');
      expect(selection.count).toBe(2);
      selection.add('e3');
      expect(selection.count).toBe(3);
    });

    test('state is accessible', () => {
      expect(selection.state).toBeDefined();
      expect(selection.state.mode).toBe('object');
      expect(selection.state.entityIds).toBeInstanceOf(Set);
    });
  });
});
