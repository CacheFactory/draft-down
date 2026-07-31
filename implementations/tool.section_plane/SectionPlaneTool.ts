// @archigraph tool.section_plane
// Section plane tool: click on a face to place a section cutting plane.
// Uses Three.js clipping planes for real-time geometry cutting.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview, ToolEventNeeds } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';

interface SectionPlaneData {
  id: string;
  point: Vec3;
  normal: Vec3;
  active: boolean;
}

export class SectionPlaneTool extends BaseTool {
  readonly id = 'tool.section_plane';
  readonly name = 'Section Plane';
  readonly icon = 'scissors';
  readonly shortcut = 'Shift+X';
  readonly category = 'construct' as const;
  readonly cursor = 'crosshair';

  private sectionPlanes: SectionPlaneData[] = [];
  private activePlaneId: string | null = null;
  /** Hover preview — the section rectangle the next click will place. */
  private previewCorners: Vec3[] | null = null;

  activate(): void {
    super.activate();
    this.setStatus('Click on a face to place a section plane aligned to its normal. Double-click a plane to toggle.');
  }

  deactivate(): void {
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;

    let normal: Vec3 = { x: 0, y: 1, z: 0 };
    if (event.hitEntityId) {
      const face = this.document.geometry.getFace(event.hitEntityId);
      if (face) {
        normal = vec3.clone(face.normal);
      }
    }

    const id = `section-${Date.now()}`;

    // Create the section plane data
    const planeData: SectionPlaneData = { id, point, normal, active: true };

    // Deactivate previous active plane
    if (this.activePlaneId) {
      const prev = this.sectionPlanes.find(p => p.id === this.activePlaneId);
      if (prev) prev.active = false;
    }

    this.sectionPlanes.push(planeData);
    this.activePlaneId = id;

    // Draw visual rectangle at the section plane
    this.drawPlaneVisual(id, point, normal);

    // Apply clipping
    this.viewport.renderer.setSectionPlane({ point, normal });

    this.setStatus(`Section plane placed. Press Escape to clear all planes.`);
  }

  onMouseMove(event: ToolMouseEvent): void {
    if (event.hitEntityId) {
      this.document.selection.setPreSelection(event.hitEntityId);
    } else {
      this.document.selection.setPreSelection(null);
    }

    // Show a preview rectangle at the section plane that would be placed by
    // the next click — same point + normal computation as onMouseDown so what
    // you see is what you get.
    this.previewCorners = null;
    const point = this.getStandardDrawPoint(event) ?? this.resolvePoint(event);
    if (!point) return;
    let normal: Vec3 = { x: 0, y: 1, z: 0 };
    if (event.hitEntityId) {
      const face = this.document.geometry.getFace(event.hitEntityId);
      if (face) normal = vec3.clone(face.normal);
    }
    this.previewCorners = this.computePlaneCorners(point, normal, 5);
  }

  /** Build a centered rectangle on the plane (point, normal) for preview/visual. */
  private computePlaneCorners(point: Vec3, normal: Vec3, halfSize: number): Vec3[] {
    let tangent: Vec3;
    if (Math.abs(normal.y) > 0.9) {
      tangent = vec3.normalize(vec3.cross(normal, { x: 1, y: 0, z: 0 }));
    } else {
      tangent = vec3.normalize(vec3.cross(normal, { x: 0, y: 1, z: 0 }));
    }
    const bitangent = vec3.normalize(vec3.cross(normal, tangent));
    return [
      vec3.add(point, vec3.add(vec3.mul(tangent,  halfSize), vec3.mul(bitangent,  halfSize))),
      vec3.add(point, vec3.add(vec3.mul(tangent, -halfSize), vec3.mul(bitangent,  halfSize))),
      vec3.add(point, vec3.add(vec3.mul(tangent, -halfSize), vec3.mul(bitangent, -halfSize))),
      vec3.add(point, vec3.add(vec3.mul(tangent,  halfSize), vec3.mul(bitangent, -halfSize))),
    ];
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      // Clear all section planes
      this.viewport.renderer.setSectionPlane(null);
      // Remove visual guide lines
      for (const plane of this.sectionPlanes) {
        this.viewport.renderer.removeGuideLine(`${plane.id}-1`);
        this.viewport.renderer.removeGuideLine(`${plane.id}-2`);
        this.viewport.renderer.removeGuideLine(`${plane.id}-3`);
        this.viewport.renderer.removeGuideLine(`${plane.id}-4`);
        this.viewport.renderer.removeGuideLine(`${plane.id}-x1`);
        this.viewport.renderer.removeGuideLine(`${plane.id}-x2`);
      }
      this.sectionPlanes = [];
      this.activePlaneId = null;
      this.setPhase('idle');
      this.setStatus('Section planes cleared. Click on a face to place a new one.');
    }
  }

  getVCBLabel(): string { return ''; }
  getPreview(): ToolPreview | null {
    if (!this.previewCorners) return null;
    return { polygon: this.previewCorners };
  }

  getEventNeeds(): ToolEventNeeds {
    return { snap: true, raycast: false, edgeRaycast: false, liveSyncOnMove: false, mutatesOnClick: false };
  }

  // ── Private ────────────────────────────────────────────

  private drawPlaneVisual(id: string, point: Vec3, normal: Vec3): void {
    const size = 5;
    let tangent: Vec3;
    if (Math.abs(normal.y) > 0.9) {
      tangent = vec3.normalize(vec3.cross(normal, { x: 1, y: 0, z: 0 }));
    } else {
      tangent = vec3.normalize(vec3.cross(normal, { x: 0, y: 1, z: 0 }));
    }
    const bitangent = vec3.normalize(vec3.cross(normal, tangent));

    const p1 = vec3.add(point, vec3.add(vec3.mul(tangent, size), vec3.mul(bitangent, size)));
    const p2 = vec3.add(point, vec3.add(vec3.mul(tangent, -size), vec3.mul(bitangent, size)));
    const p3 = vec3.add(point, vec3.add(vec3.mul(tangent, -size), vec3.mul(bitangent, -size)));
    const p4 = vec3.add(point, vec3.add(vec3.mul(tangent, size), vec3.mul(bitangent, -size)));

    const color = { r: 1, g: 0.5, b: 0, a: 0.6 };
    this.viewport.renderer.addGuideLine(`${id}-1`, p1, p2, color, false);
    this.viewport.renderer.addGuideLine(`${id}-2`, p2, p3, color, false);
    this.viewport.renderer.addGuideLine(`${id}-3`, p3, p4, color, false);
    this.viewport.renderer.addGuideLine(`${id}-4`, p4, p1, color, false);

    // Cross through center
    this.viewport.renderer.addGuideLine(`${id}-x1`, p1, p3, color, true);
    this.viewport.renderer.addGuideLine(`${id}-x2`, p2, p4, color, true);
  }
}
