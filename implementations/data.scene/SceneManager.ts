// @archigraph svc.scene_manager
// Scene management: entities, groups, components, layers, scene pages

import { v4 as uuid } from 'uuid';
import { SimpleEventEmitter } from '../../src/core/events';
import {
  Entity, EntityType, Transform, Color, Vec3, Quaternion,
} from '../../src/core/types';
import {
  IGroup, IComponentDefinition, IComponentInstance,
  ILayer, IScenePage, IEditingContext, ISceneManager,
} from '../../src/core/interfaces';

// ─── Event map ───────────────────────────────────────────────────

type SceneEvents = {
  'entity-added': [Entity];
  'entity-removed': [Entity];
  'entity-moved': [string, string]; // entityId, newParentId
  'group-created': [IGroup];
  'group-exploded': [string]; // groupId
  'editing-context-changed': [IEditingContext];
  'component-defined': [IComponentDefinition];
  'component-placed': [IComponentInstance];
  'layer-added': [ILayer];
  'layer-removed': [string];
  'layer-updated': [ILayer];
  'scene-page-added': [IScenePage];
  'scene-page-removed': [string];
  'changed': [];
};

// ─── Helpers ─────────────────────────────────────────────────────

function identityTransform(): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

const DEFAULT_LAYER_ID = 'layer0';

// ─── SceneManager ────────────────────────────────────────────────

export class SceneManager implements ISceneManager {
  root: IGroup;
  editingContext: IEditingContext;
  layers: Map<string, ILayer>;
  componentDefinitions: Map<string, IComponentDefinition>;
  scenePages: IScenePage[];

  /** The active layer — new geometry goes here. */
  activeLayerId: string = DEFAULT_LAYER_ID;

  /** Maps geometry entity IDs (faces/edges) to layer IDs. */
  geometryLayerMap: Map<string, string> = new Map();

  /**
   * Component system: groups of face/edge IDs that act as a single unit.
   * Component internals can't be selected or modified from the main scene.
   */
  components: Map<string, {
    id: string; name: string; entityIds: Set<string>; parentComponentId: string | null;
    /** Cumulative rotation of this instance relative to its family basis. */
    quat?: { x: number; y: number; z: number; w: number };
    /** Groups are anonymous one-off containers — never share a family. */
    isGroup?: boolean;
  }> = new Map();

  /** Component FAMILIES (classic CAD definitions): every component belongs to a
   *  family; copies registered into the same family are instances that update
   *  together when one is edited. */
  componentFamilies: Map<string, { id: string; name: string; instanceIds: Set<string> }> = new Map();
  private componentFamilyOf: Map<string, string> = new Map();

  /** Hooks installed by the Application (needs geometry access): capture
   *  state when component editing starts, propagate the edit to sibling
   *  instances when it ends. */
  componentEditHooks: {
    capture: (componentId: string) => unknown;
    propagate: (componentId: string, captured: unknown) => void;
  } | null = null;
  private activeEditCapture: { componentId: string; captured: unknown } | null = null;

  /** Which component is currently being edited (null = main scene). */
  editingComponentId: string | null = null;

  /** Stack of component IDs for nested editing (outermost first). */
  editingComponentStack: string[] = [];

  private entities: Map<string, Entity> = new Map();
  private emitter = new SimpleEventEmitter<SceneEvents>();

  constructor() {
    // Default layer
    this.layers = new Map();
    const defaultLayer: ILayer = {
      id: DEFAULT_LAYER_ID,
      name: 'Layer0',
      visible: true,
      locked: false,
      color: { r: 0, g: 0, b: 0 },
    };
    this.layers.set(DEFAULT_LAYER_ID, defaultLayer);

    // Root group
    this.root = {
      id: uuid(),
      type: 'group',
      name: 'Root',
      visible: true,
      locked: false,
      layerId: DEFAULT_LAYER_ID,
      parentId: null,
      transform: identityTransform(),
      children: [],
      meshId: '',
    };
    this.entities.set(this.root.id, this.root);

    this.editingContext = { path: [], activeGroupId: null };
    this.componentDefinitions = new Map();
    this.scenePages = [];
  }

  // ── Entity CRUD ──────────────────────────────────────────────

  addEntity(entity: Entity, parentId?: string): void {
    const pid = parentId ?? this.editingContext.activeGroupId ?? this.root.id;
    entity.parentId = pid;
    if (!entity.layerId) {
      entity.layerId = DEFAULT_LAYER_ID;
    }
    this.entities.set(entity.id, entity);

    const parent = this.entities.get(pid) as IGroup | undefined;
    if (parent && parent.type === 'group') {
      parent.children.push(entity.id);
    }

    this.emitter.emit('entity-added', entity);
    this.emitter.emit('changed');
  }

  removeEntity(id: string): void {
    if (id === this.root.id) return;
    const entity = this.entities.get(id);
    if (!entity) return;

    // Remove from parent
    if (entity.parentId) {
      const parent = this.entities.get(entity.parentId) as IGroup | undefined;
      if (parent && parent.type === 'group') {
        parent.children = parent.children.filter(cid => cid !== id);
      }
    }

    // Recursively remove children if group
    if (entity.type === 'group') {
      const group = entity as IGroup;
      for (const childId of [...group.children]) {
        this.removeEntity(childId);
      }
    }

    // Clean up component instance reference
    if (entity.type === 'component_instance') {
      const inst = entity as IComponentInstance;
      const def = this.componentDefinitions.get(inst.definitionId);
      if (def) {
        def.instanceIds = def.instanceIds.filter(iid => iid !== id);
      }
    }

    this.entities.delete(id);
    this.emitter.emit('entity-removed', entity);
    this.emitter.emit('changed');
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  findEntitiesByType(type: EntityType): Entity[] {
    return this.getAllEntities().filter(e => e.type === type);
  }

  moveEntity(id: string, newParentId: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;

    // Remove from old parent
    if (entity.parentId) {
      const oldParent = this.entities.get(entity.parentId) as IGroup | undefined;
      if (oldParent && oldParent.type === 'group') {
        oldParent.children = oldParent.children.filter(cid => cid !== id);
      }
    }

    // Add to new parent
    entity.parentId = newParentId;
    const newParent = this.entities.get(newParentId) as IGroup | undefined;
    if (newParent && newParent.type === 'group') {
      newParent.children.push(id);
    }

    this.emitter.emit('entity-moved', id, newParentId);
    this.emitter.emit('changed');
  }

  // ── Groups ───────────────────────────────────────────────────

  createGroup(name: string, childIds: string[]): IGroup {
    const group: IGroup = {
      id: uuid(),
      type: 'group',
      name,
      visible: true,
      locked: false,
      layerId: DEFAULT_LAYER_ID,
      parentId: this.editingContext.activeGroupId ?? this.root.id,
      transform: identityTransform(),
      children: [],
      meshId: '',
    };

    this.entities.set(group.id, group);

    // Reparent children into the new group
    for (const childId of childIds) {
      const child = this.entities.get(childId);
      if (!child) continue;

      // Remove from old parent
      if (child.parentId) {
        const oldParent = this.entities.get(child.parentId) as IGroup | undefined;
        if (oldParent && oldParent.type === 'group') {
          oldParent.children = oldParent.children.filter(cid => cid !== childId);
        }
      }

      child.parentId = group.id;
      group.children.push(childId);
    }

    // Add group to its parent
    const parent = this.entities.get(group.parentId!) as IGroup | undefined;
    if (parent && parent.type === 'group') {
      parent.children.push(group.id);
    }

    this.emitter.emit('group-created', group);
    this.emitter.emit('changed');
    return group;
  }

  explodeGroup(groupId: string): void {
    const group = this.entities.get(groupId) as IGroup | undefined;
    if (!group || group.type !== 'group') return;
    if (groupId === this.root.id) return;

    const parentId = group.parentId ?? this.root.id;
    const parent = this.entities.get(parentId) as IGroup | undefined;

    // Move children up to parent
    for (const childId of group.children) {
      const child = this.entities.get(childId);
      if (!child) continue;
      child.parentId = parentId;
      if (parent && parent.type === 'group') {
        parent.children.push(childId);
      }
    }

    // Remove the group itself (without recursively removing children)
    group.children = [];
    if (parent && parent.type === 'group') {
      parent.children = parent.children.filter(cid => cid !== groupId);
    }
    this.entities.delete(groupId);

    this.emitter.emit('group-exploded', groupId);
    this.emitter.emit('changed');
  }

  enterGroup(groupId: string): void {
    const group = this.entities.get(groupId) as IGroup | undefined;
    if (!group || group.type !== 'group') return;

    this.editingContext.path.push(groupId);
    this.editingContext.activeGroupId = groupId;

    this.emitter.emit('editing-context-changed', { ...this.editingContext });
    this.emitter.emit('changed');
  }

  exitGroup(): void {
    if (this.editingContext.path.length === 0) return;

    this.editingContext.path.pop();
    this.editingContext.activeGroupId =
      this.editingContext.path.length > 0
        ? this.editingContext.path[this.editingContext.path.length - 1]
        : null;

    this.emitter.emit('editing-context-changed', { ...this.editingContext });
    this.emitter.emit('changed');
  }

  // ── Components ───────────────────────────────────────────────

  createComponentDefinition(name: string, meshId: string): IComponentDefinition {
    const def: IComponentDefinition = {
      id: uuid(),
      name,
      description: '',
      meshId,
      instanceIds: [],
    };
    this.componentDefinitions.set(def.id, def);
    this.emitter.emit('component-defined', def);
    this.emitter.emit('changed');
    return def;
  }

  placeComponentInstance(defId: string, transform: Transform): IComponentInstance {
    const def = this.componentDefinitions.get(defId);
    if (!def) {
      throw new Error(`Component definition '${defId}' not found`);
    }

    const instance: IComponentInstance = {
      id: uuid(),
      type: 'component_instance',
      name: def.name,
      visible: true,
      locked: false,
      layerId: DEFAULT_LAYER_ID,
      parentId: this.editingContext.activeGroupId ?? this.root.id,
      definitionId: defId,
      transform,
    };

    def.instanceIds.push(instance.id);
    this.entities.set(instance.id, instance);

    const parent = this.entities.get(instance.parentId!) as IGroup | undefined;
    if (parent && parent.type === 'group') {
      parent.children.push(instance.id);
    }

    this.emitter.emit('component-placed', instance);
    this.emitter.emit('changed');
    return instance;
  }

  // ── Layers ───────────────────────────────────────────────────

  addLayer(name: string): ILayer {
    const layer: ILayer = {
      id: uuid(),
      name,
      visible: true,
      locked: false,
      color: { r: 0, g: 0, b: 0 },
    };
    this.layers.set(layer.id, layer);
    this.emitter.emit('layer-added', layer);
    this.emitter.emit('changed');
    return layer;
  }

  removeLayer(id: string): void {
    if (id === DEFAULT_LAYER_ID) return; // cannot remove default layer
    if (!this.layers.has(id)) return;

    // Reassign entities on this layer to default
    for (const entity of this.entities.values()) {
      if (entity.layerId === id) {
        entity.layerId = DEFAULT_LAYER_ID;
      }
    }

    this.layers.delete(id);
    this.emitter.emit('layer-removed', id);
    this.emitter.emit('changed');
  }

  setLayerVisibility(id: string, visible: boolean): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    layer.visible = visible;
    this.emitter.emit('layer-updated', layer);
    this.emitter.emit('changed');
  }

  setLayerLocked(id: string, locked: boolean): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    layer.locked = locked;
    this.emitter.emit('changed');
  }

  setActiveLayer(id: string): void {
    if (!this.layers.has(id)) return;
    this.activeLayerId = id;
    this.emitter.emit('changed');
  }

  /** Get the layer ID for a geometry entity (face/edge). Falls back to active layer. */
  getEntityLayerId(entityId: string): string {
    return this.geometryLayerMap.get(entityId) ?? DEFAULT_LAYER_ID;
  }

  /** Check if a geometry entity's layer is visible. */
  /** Per-entity hidden set (context-menu Hide). Session-only — cleared by
   *  Edit > Unhide All; not persisted with the document. */
  private hiddenEntityIds = new Set<string>();

  /** Hide or show a single geometry entity (face/edge), classic-CAD-style. */
  setEntityHidden(entityId: string, hidden: boolean): void {
    if (hidden) this.hiddenEntityIds.add(entityId);
    else this.hiddenEntityIds.delete(entityId);
    this.emitter.emit('changed');
  }

  /** Unhide everything hidden via setEntityHidden, plus any scene entities
   *  with visible=false. */
  unhideAll(): void {
    this.hiddenEntityIds.clear();
    for (const [, entity] of this.entities) {
      if (entity.visible === false) entity.visible = true;
    }
    this.emitter.emit('changed');
  }

  isEntityVisible(entityId: string): boolean {
    if (this.hiddenEntityIds.has(entityId)) return false;
    const layerId = this.getEntityLayerId(entityId);
    const layer = this.layers.get(layerId);
    return layer ? layer.visible : true;
  }

  /** Check if a geometry entity's layer is locked. */
  isEntityLocked(entityId: string): boolean {
    const layerId = this.getEntityLayerId(entityId);
    const layer = this.layers.get(layerId);
    return layer ? layer.locked : false;
  }

  // ── Components ─────────────────────────────────────────────

  /** Create a component from a set of face/edge IDs. */
  createComponent(name: string, entityIds: string[], opts?: { isGroup?: boolean }): string {
    const id = uuid();
    // If currently editing a component, this new component is its child
    const parentComponentId = this.editingComponentId;
    this.components.set(id, {
      id, name, entityIds: new Set(entityIds), parentComponentId,
      quat: { x: 0, y: 0, z: 0, w: 1 },
      isGroup: opts?.isGroup ?? false,
    });
    // Every component starts as the sole instance of its own family;
    // linkInstanceToFamily() re-homes copies into the source's family.
    const famId = uuid();
    this.componentFamilies.set(famId, { id: famId, name, instanceIds: new Set([id]) });
    this.componentFamilyOf.set(id, famId);
    this.emitter.emit('changed');
    return id;
  }

  /** Accumulate a rotation onto an instance (RotateTool commits call this
   *  when the selection was exactly one component). q' = qRot * q. */
  accumulateComponentRotation(componentId: string, qRot: { x: number; y: number; z: number; w: number }): void {
    const comp = this.components.get(componentId);
    if (!comp) return;
    const q = comp.quat ?? { x: 0, y: 0, z: 0, w: 1 };
    comp.quat = {
      w: qRot.w * q.w - qRot.x * q.x - qRot.y * q.y - qRot.z * q.z,
      x: qRot.w * q.x + qRot.x * q.w + qRot.y * q.z - qRot.z * q.y,
      y: qRot.w * q.y - qRot.x * q.z + qRot.y * q.w + qRot.z * q.x,
      z: qRot.w * q.z + qRot.x * q.y - qRot.y * q.x + qRot.z * q.w,
    };
  }

  /** Register a copied component as an instance of the source's family —
   *  edits to any instance then propagate to all of them. */
  linkInstanceToFamily(sourceComponentId: string, newComponentId: string): void {
    const famId = this.componentFamilyOf.get(sourceComponentId);
    if (!famId) return;
    // Remove from its auto-created family
    const oldFam = this.componentFamilyOf.get(newComponentId);
    if (oldFam && oldFam !== famId) {
      this.componentFamilies.get(oldFam)?.instanceIds.delete(newComponentId);
      if ((this.componentFamilies.get(oldFam)?.instanceIds.size ?? 0) === 0) {
        this.componentFamilies.delete(oldFam);
      }
    }
    this.componentFamilies.get(famId)?.instanceIds.add(newComponentId);
    this.componentFamilyOf.set(newComponentId, famId);
  }

  /** classic CAD Make Unique: detach an instance into its own fresh family. */
  makeUnique(componentId: string): void {
    const comp = this.components.get(componentId);
    if (!comp) return;
    const oldFam = this.componentFamilyOf.get(componentId);
    if (oldFam) {
      this.componentFamilies.get(oldFam)?.instanceIds.delete(componentId);
      if ((this.componentFamilies.get(oldFam)?.instanceIds.size ?? 0) === 0) {
        this.componentFamilies.delete(oldFam);
      }
    }
    const famId = uuid();
    this.componentFamilies.set(famId, { id: famId, name: `${comp.name} (unique)`, instanceIds: new Set([componentId]) });
    this.componentFamilyOf.set(componentId, famId);
    this.emitter.emit('changed');
  }

  /** Other instances in this component's family. */
  getSiblingInstanceIds(componentId: string): string[] {
    const famId = this.componentFamilyOf.get(componentId);
    if (!famId) return [];
    const fam = this.componentFamilies.get(famId);
    if (!fam) return [];
    return [...fam.instanceIds].filter(id => id !== componentId && this.components.has(id));
  }

  /** Explode a component back to loose geometry. */
  explodeComponent(componentId: string): void {
    this.components.delete(componentId);
    const famId = this.componentFamilyOf.get(componentId);
    if (famId) {
      this.componentFamilies.get(famId)?.instanceIds.delete(componentId);
      if ((this.componentFamilies.get(famId)?.instanceIds.size ?? 0) === 0) {
        this.componentFamilies.delete(famId);
      }
      this.componentFamilyOf.delete(componentId);
    }
    if (this.editingComponentId === componentId) {
      this.exitComponent();
    }
    this.editingComponentStack = this.editingComponentStack.filter(id => id !== componentId);
    this.emitter.emit('changed');
  }

  /** Get the component that should be selected when clicking this entity.
   *  Respects the explicit parent-child hierarchy:
   *  - At top level: returns the top-level component (parentComponentId === null)
   *  - When editing component X: returns X's direct child component
   *  This enforces drill-down: click selects component, double-click enters it,
   *  then you can select its children, and so on. */
  getEntityComponent(entityId: string): string | null {
    // Find all components containing this entity
    const containing: string[] = [];
    for (const [compId, comp] of this.components) {
      if (compId === this.editingComponentId) continue;
      if (comp.entityIds.has(entityId)) containing.push(compId);
    }
    if (containing.length === 0) return null;

    // Find the component whose parent matches the current editing context
    // At top level: look for parentComponentId === null
    // When editing X: look for parentComponentId === X
    const targetParent = this.editingComponentId;
    for (const compId of containing) {
      const comp = this.components.get(compId)!;
      if (comp.parentComponentId === targetParent) return compId;
    }

    // If no direct child found, walk up: find the ancestor whose parent
    // matches the target. This handles clicking on deeply nested geometry.
    for (const compId of containing) {
      let current = compId;
      while (current) {
        const comp = this.components.get(current);
        if (!comp) break;
        if (comp.parentComponentId === targetParent) return current;
        if (!comp.parentComponentId) break;
        current = comp.parentComponentId;
      }
    }

    return null;
  }

  /** Check if an entity is inside a component and NOT currently being edited. */
  isEntityProtected(entityId: string): boolean {
    const compId = this.getEntityComponent(entityId);
    if (!compId) return false; // Not in a component — freely editable
    return true; // getEntityComponent already excludes the editing component
  }

  /** Enter component editing mode (supports nesting). */
  enterComponent(componentId: string): void {
    if (!this.components.has(componentId)) return;
    if (this.editingComponentId) {
      this.editingComponentStack.push(this.editingComponentId);
    }
    this.editingComponentId = componentId;
    // Capture pre-edit state so sibling instances can be synced on exit.
    if (this.componentEditHooks) {
      this.activeEditCapture = {
        componentId,
        captured: this.componentEditHooks.capture(componentId),
      };
    }
    this.emitter.emit('changed');
  }

  /** Exit component editing mode (pops one level, or exits to main scene). */
  exitComponent(): void {
    const exited = this.editingComponentId;
    if (this.editingComponentStack.length > 0) {
      this.editingComponentId = this.editingComponentStack.pop()!;
    } else {
      this.editingComponentId = null;
    }
    // Propagate the edit to all sibling instances of the family.
    if (exited && this.componentEditHooks && this.activeEditCapture?.componentId === exited) {
      const { captured } = this.activeEditCapture;
      this.activeEditCapture = null;
      this.componentEditHooks.propagate(exited, captured);
    }
    this.emitter.emit('changed');
  }

  /** Check if we're currently editing a component. */
  get isEditingComponent(): boolean {
    return this.editingComponentId !== null;
  }

  /** Get the entity IDs that are editable in the current context. */
  isEntityEditable(entityId: string): boolean {
    if (this.editingComponentId) {
      const comp = this.components.get(this.editingComponentId);
      if (!comp || !comp.entityIds.has(entityId)) return false;
      // Entity is in the editing component, but check if it's also in a child component
      return !this.isEntityProtected(entityId);
    }
    // In main scene, entities NOT in any component are editable
    return !this.getEntityComponent(entityId);
  }

  assignToLayer(entityId: string, layerId: string): void {
    // Check scene entities
    const entity = this.entities.get(entityId);
    if (entity) {
      if (!this.layers.has(layerId)) return;
      entity.layerId = layerId;
    }
    // Also works for geometry entities (faces/edges)
    if (this.layers.has(layerId)) {
      this.geometryLayerMap.set(entityId, layerId);
    }
    this.emitter.emit('changed');
  }

  // ── Scene Pages ──────────────────────────────────────────────

  addScenePage(page: Omit<IScenePage, 'id'>): IScenePage {
    const scenePage: IScenePage = { id: uuid(), ...page };
    this.scenePages.push(scenePage);
    this.emitter.emit('scene-page-added', scenePage);
    this.emitter.emit('changed');
    return scenePage;
  }

  removeScenePage(id: string): void {
    const idx = this.scenePages.findIndex(p => p.id === id);
    if (idx === -1) return;
    this.scenePages.splice(idx, 1);
    this.emitter.emit('scene-page-removed', id);
    this.emitter.emit('changed');
  }

  // ── Events ───────────────────────────────────────────────────

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.emitter.on(event as keyof SceneEvents, handler as never);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.emitter.off(event as keyof SceneEvents, handler as never);
  }
}
