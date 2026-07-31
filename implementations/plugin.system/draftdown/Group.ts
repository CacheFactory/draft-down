// @archigraph plugin.system.draftdown.group
// DraftDown.Group, DraftDown.ComponentInstance, DraftDown.ComponentDefinition wrappers.
//
// References:
//   
//   
//   

import type { ISceneManager, IComponentDefinition } from '../../../src/core/interfaces';
import { Entity, EntityContext } from './Entity';
import { Transformation, Point3d, Vector3d, BoundingBox } from './Geom';

/** Helper to read an entity from the scene. */
function getSceneEntity(scene: ISceneManager, id: string) {
  return scene.getEntity(id);
}

/**
 * DraftDown.ComponentDefinition — the master definition shared by all instances.
 * In DraftDown, definitions live in `scene.componentDefinitions`.
 */
export class ComponentDefinition {
  constructor(public readonly definitionId: string, private ctx: EntityContext) {}

  get id(): string { return this.definitionId; }

  private get raw(): IComponentDefinition {
    const d = this.ctx.doc.scene.componentDefinitions.get(this.definitionId);
    if (!d) throw new Error(`ComponentDefinition ${this.definitionId} not found`);
    return d;
  }

  get name(): string { return this.raw.name; }
  set name(n: string) { this.raw.name = n; }

  get description(): string { return this.raw.description; }
  set description(d: string) { this.raw.description = d; }

  /** Number of instances placed in the model. */
  get count(): number { return this.raw.instanceIds.length; }

  /** DraftDown.ComponentDefinition#instances — all live instances. */
  instances(): ComponentInstance[] {
    return this.raw.instanceIds.map(id => new ComponentInstance(id, this.ctx));
  }
}

/**
 * DraftDown.Group — a transformable container of geometry.
 * In DraftDown a Group is a scene entity of type 'group'.
 */
export class Group extends Entity {
  typename(): string { return 'Group'; }

  valid(): boolean {
    const e = getSceneEntity(this.ctx.doc.scene, this.entityID);
    return !!e && e.type === 'group';
  }

  private get raw(): any {
    const e = getSceneEntity(this.ctx.doc.scene, this.entityID);
    if (!e || e.type !== 'group') throw new Error(`Group ${this.entityID} is deleted`);
    return e;
  }

  get name(): string { return this.raw.name ?? 'Group'; }
  set name(n: string) { this.raw.name = n; }

  /** DraftDown.Group#transformation — returns a NEW Transformation. */
  get transformation(): Transformation {
    const t = this.raw.transform;
    if (!t) return Transformation.identity();
    // Build from position + rotation + scale.
    const p = t.position ?? { x: 0, y: 0, z: 0 };
    const out = Transformation.translation(new Point3d(p.x, p.y, p.z));
    return out;
  }
  set transformation(t: Transformation) { this.raw.transform = { ...this.raw.transform, position: t.origin.toVec3() }; }

  /** DraftDown.Group#move! / #transform! */
  transformInPlace(t: Transformation): Group {
    const cur = this.transformation;
    this.transformation = t.multiply(cur);
    return this;
  }

  /** DraftDown.Group#explode — dissolves the group into loose entities. */
  explode(): void {
    const sm: any = this.ctx.doc.scene;
    sm.explodeGroup?.(this.entityID);
  }

  /** DraftDown.Group#entities — child entities scoped to the group. */
  get entities(): import('./Entities').Entities {
    // Lazy import to break the cycle.
    const { Entities } = require('./Entities') as typeof import('./Entities');
    return new Entities(this.ctx, this.entityID);
  }

  /** DraftDown.Group#definition — DraftDown groups have an implicit definition. */
  get definition(): ComponentDefinition | null {
    const defId = this.raw.definitionId;
    if (!defId) return null;
    return new ComponentDefinition(defId, this.ctx);
  }

  /** DraftDown.Group#guid — stable identifier (same as engine id). */
  get guid(): string { return this.entityID; }

  /** DraftDown.Group#bounds — world-space bounding box. */
  get bounds(): BoundingBox {
    const bb = new BoundingBox();
    const childIds: string[] = (this.raw.children ?? []) as string[];
    const g = this.ctx.doc.geometry;
    for (const id of childIds) {
      const f = g.getFace(id);
      if (f) for (const v of g.getFaceVertices(id)) bb.add(new Point3d(v.position.x, v.position.y, v.position.z));
      const e = g.getEdge(id);
      if (e) {
        const a = g.getVertex(e.startVertexId); const b = g.getVertex(e.endVertexId);
        if (a) bb.add(new Point3d(a.position.x, a.position.y, a.position.z));
        if (b) bb.add(new Point3d(b.position.x, b.position.y, b.position.z));
      }
      const v = g.getVertex(id);
      if (v) bb.add(new Point3d(v.position.x, v.position.y, v.position.z));
    }
    return bb;
  }

  /** DraftDown.Group#local_bounds — same as bounds in local space (pre-transform). */
  get localBounds(): BoundingBox { return this.bounds; }

  /** DraftDown.Group#volume — naive: AABB volume × signed-offset, useful for rough comparisons. */
  get volume(): number {
    const bb = this.bounds;
    if (bb.empty()) return 0;
    return bb.width * bb.height * bb.depth;
  }

  /** DraftDown.Group#manifold? — best-effort: every edge has exactly two adjacent faces. */
  manifold(): boolean {
    const g = this.ctx.doc.geometry;
    for (const id of (this.raw.children ?? []) as string[]) {
      const e = g.getEdge(id);
      if (e) { if (g.getEdgeFaces(id).length !== 2) return false; }
    }
    return true;
  }

  /** DraftDown.Group#move!(transformation) */
  moveInPlace(t: Transformation): Group { return this.transformInPlace(t); }

  /** DraftDown.Group#copy — duplicate the group at the same transform. */
  copy(): Group {
    const childIds: string[] = (this.raw.children ?? []).slice();
    if (childIds.length === 0) return this;
    const result = this.ctx.api.copyEntities(childIds, { x: 0, y: 0, z: 0 });
    const newId = this.ctx.api.createGroup(this.name + ' Copy', result.faceIds.concat(result.edgeIds));
    const newGroup = new Group(newId, this.ctx);
    newGroup.transformation = this.transformation;
    return newGroup;
  }

  /** DraftDown.Group#make_unique — DraftDown groups already have implicit unique definitions. */
  makeUnique(): Group { return this; }

  /** DraftDown.Group#to_component — promotes this group to a reusable definition. */
  toComponent(): import('./DefinitionList').ComponentDefinitionEx {
    const sm: any = this.ctx.doc.scene;
    const defId = sm.promoteGroupToComponent?.(this.entityID) ?? this.raw.definitionId;
    const { ComponentDefinitionEx } = require('./DefinitionList') as typeof import('./DefinitionList');
    return new ComponentDefinitionEx(defId ?? this.entityID, this.ctx);
  }

  /** DraftDown.Group#glued_to / glued_to= — DraftDown has no glue concept; round-trip on raw. */
  get gluedTo(): Entity | null {
    const id = (this.raw as any).gluedTo;
    if (!id) return null;
    const e = this.ctx.doc.scene.getEntity(id);
    if (!e) return null;
    if (e.type === 'group') return new Group(id, this.ctx);
    if (e.type === 'component_instance') return new ComponentInstance(id, this.ctx);
    return null;
  }
  set gluedTo(other: Entity | null) {
    (this.raw as any).gluedTo = other ? (other as any).entityID : null;
  }

  /** DraftDown.Group#show_differences — minimal: returns false (no diffing yet). */
  showDifferences(_otherGroup: Group, _verbose = false): boolean { return false; }
}

/**
 * DraftDown.ComponentInstance — a placed instance of a ComponentDefinition.
 */
export class ComponentInstance extends Entity {
  typename(): string { return 'ComponentInstance'; }

  valid(): boolean {
    const e = getSceneEntity(this.ctx.doc.scene, this.entityID);
    return !!e && e.type === 'component_instance';
  }

  private get raw(): any {
    const e = getSceneEntity(this.ctx.doc.scene, this.entityID);
    if (!e || e.type !== 'component_instance') throw new Error(`ComponentInstance ${this.entityID} is deleted`);
    return e;
  }

  get name(): string { return this.raw.name ?? this.definition.name; }
  set name(n: string) { this.raw.name = n; }

  get definition(): ComponentDefinition {
    return new ComponentDefinition(this.raw.definitionId, this.ctx);
  }

  get transformation(): Transformation {
    const t = this.raw.transform;
    if (!t) return Transformation.identity();
    const p = t.position ?? { x: 0, y: 0, z: 0 };
    return Transformation.translation(new Point3d(p.x, p.y, p.z));
  }
  set transformation(t: Transformation) {
    this.raw.transform = { ...this.raw.transform, position: t.origin.toVec3() };
  }

  /** DraftDown.ComponentInstance#explode. */
  explode(): void {
    const sm: any = this.ctx.doc.scene;
    sm.explodeGroup?.(this.entityID);
  }

  /** DraftDown.ComponentInstance#guid */
  get guid(): string { return this.entityID; }

  /** DraftDown.ComponentInstance#bounds */
  get bounds(): BoundingBox {
    const def = this.definition as any;
    if (def && typeof def.bounds === 'object' && def.bounds instanceof BoundingBox) return def.bounds;
    return new BoundingBox();
  }

  /** DraftDown.ComponentInstance#volume */
  get volume(): number {
    const bb = this.bounds;
    if ((bb as any).empty?.()) return 0;
    return bb.width * bb.height * bb.depth;
  }

  /** DraftDown.ComponentInstance#manifold? */
  manifold(): boolean { return true; }

  /** DraftDown.ComponentInstance#copy */
  copy(): ComponentInstance {
    const sm: any = this.ctx.doc.scene;
    const placed = sm.placeComponentInstance?.(this.raw.definitionId, { ...this.raw.transform });
    return placed ? new ComponentInstance(placed.id, this.ctx) : this;
  }

  /** DraftDown.ComponentInstance#make_unique — clones the definition for this instance only. */
  makeUnique(): ComponentInstance {
    const sm: any = this.ctx.doc.scene;
    const newDefId = sm.cloneDefinitionForInstance?.(this.entityID);
    if (newDefId) (this.raw as any).definitionId = newDefId;
    return this;
  }

  /** DraftDown.ComponentInstance#move! */
  moveInPlace(t: Transformation): ComponentInstance {
    this.transformation = t.multiply(this.transformation);
    return this;
  }

  /** Glued-to flag (round-trip only). */
  get gluedTo(): Entity | null {
    const id = (this.raw as any).gluedTo;
    if (!id) return null;
    const e = this.ctx.doc.scene.getEntity(id);
    if (!e) return null;
    if (e.type === 'group') return new Group(id, this.ctx);
    if (e.type === 'component_instance') return new ComponentInstance(id, this.ctx);
    return null;
  }
  set gluedTo(other: Entity | null) { (this.raw as any).gluedTo = other ? (other as any).entityID : null; }
}
