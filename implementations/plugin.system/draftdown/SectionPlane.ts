// @archigraph plugin.system.draftdown.section-plane
// DraftDown.SectionPlane wrapper. Backed by IRenderer.setSectionPlane.
// Reference: 

import type { IRenderer } from '../../../src/core/interfaces';
import { Entity, EntityContext } from './Entity';
import { Point3d, Vector3d } from './Geom';

interface SectionState { point: Point3d; normal: Vector3d; active: boolean; name: string }
const sectionRegistry = new Map<string, SectionState>();
let activeSectionId: string | null = null;

export class SectionPlane extends Entity {
  static create(ctx: EntityContext, point: Point3d, normal: Vector3d, name = 'Section'): SectionPlane {
    const id = `section-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    sectionRegistry.set(id, { point, normal: normal.normalize(), active: false, name });
    return new SectionPlane(id, ctx);
  }
  typename(): string { return 'SectionPlane'; }

  private get state(): SectionState {
    const s = sectionRegistry.get(this.entityID);
    if (!s) throw new Error(`SectionPlane ${this.entityID} is deleted`);
    return s;
  }

  get name(): string { return this.state.name; }
  set name(v: string) { this.state.name = v; }

  get plane(): { point: Point3d; normal: Vector3d } {
    return { point: this.state.point, normal: this.state.normal };
  }

  /** SectionPlane#active? */
  isActive(): boolean { return activeSectionId === this.entityID; }

  /** SectionPlane#activate */
  activate(): SectionPlane {
    activeSectionId = this.entityID;
    const r: IRenderer | null = (this.ctx.doc as any).renderer ?? (window as any).draftdownRenderer ?? null;
    r?.setSectionPlane?.({ point: this.state.point, normal: { x: this.state.normal.x, y: this.state.normal.y, z: this.state.normal.z } });
    return this;
  }

  /** SectionPlane#deactivate */
  deactivate(): SectionPlane {
    if (activeSectionId === this.entityID) activeSectionId = null;
    const r: IRenderer | null = (this.ctx.doc as any).renderer ?? (window as any).draftdownRenderer ?? null;
    r?.setSectionPlane?.(null);
    return this;
  }

  /** SectionPlane#set_plane(point, normal) */
  setPlane(point: Point3d, normal: Vector3d): SectionPlane {
    this.state.point = point; this.state.normal = normal.normalize();
    if (this.isActive()) this.activate();
    return this;
  }

  eraseInPlace(): void {
    if (this.isActive()) this.deactivate();
    sectionRegistry.delete(this.entityID);
  }
}

export function listAllSectionPlanes(ctx: EntityContext): SectionPlane[] {
  return Array.from(sectionRegistry.keys()).map(id => new SectionPlane(id, ctx));
}
export function getActiveSectionPlane(ctx: EntityContext): SectionPlane | null {
  return activeSectionId ? new SectionPlane(activeSectionId, ctx) : null;
}
export function clearAllSectionPlanes(ctx: EntityContext): void {
  for (const id of Array.from(sectionRegistry.keys())) new SectionPlane(id, ctx).eraseInPlace();
}
export function findSectionById(id: string, ctx: EntityContext): SectionPlane | null {
  return sectionRegistry.has(id) ? new SectionPlane(id, ctx) : null;
}
