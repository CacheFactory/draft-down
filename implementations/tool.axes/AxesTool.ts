// @archigraph tool.axes
// Axes tool: click a face to reorient the drawing axes to that surface.
// All tools then use the custom orientation for drawing planes and axis locking.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview, ToolEventNeeds } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { customAxes } from './CustomAxes';
import * as THREE from 'three';

export class AxesTool extends BaseTool {
  readonly id = 'tool.axes';
  readonly name = 'Axes';
  readonly icon = 'move-3d';
  readonly shortcut = 'Shift+A';
  readonly category = 'construct' as const;
  readonly cursor = 'crosshair';

  private axesHelper: THREE.Group | null = null;

  activate(): void {
    super.activate();
    if (customAxes.isCustom) {
      this.setStatus('Click a face to set new axes. Press Escape to reset to default.');
    } else {
      this.setStatus('Click a face to align axes to that surface.');
    }
  }

  deactivate(): void {
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;

    // Use hit entity from event (supports GPU pick for batched mode)
    if (!event.hitEntityId) {
      this.setStatus('Click on a face to set axes.');
      return;
    }
    const targetFace = this.document.geometry.getFace(event.hitEntityId);
    if (!targetFace) {
      this.setStatus('Click on a face to set axes.');
      return;
    }
    const hitPoint = event.hitPoint ?? event.worldPoint ?? { x: 0, y: 0, z: 0 };

    // Get an edge direction from the face for the X axis
    const verts = this.document.geometry.getFaceVertices(targetFace.id);
    let edgeDir: Vec3 | undefined;
    if (verts.length >= 2) {
      edgeDir = vec3.normalize(vec3.sub(verts[1].position, verts[0].position));
    }

    // Set the custom axes
    customAxes.setFromFace(hitPoint, targetFace.normal, edgeDir);

    // Update the visual axes
    this.updateAxesVisual();

    this.setStatus(`Axes set to face. Press Escape to reset. Click another face to change.`);
  }

  onMouseMove(event: ToolMouseEvent): void {
    // Pre-selection highlight on faces
    if (event.hitEntityId) {
      const face = this.document.geometry.getFace(event.hitEntityId);
      if (face) {
        this.document.selection.setPreSelection(event.hitEntityId);
        return;
      }
    }
    this.document.selection.setPreSelection(null);
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      customAxes.reset();
      this.removeAxesVisual();
      this.setStatus('Axes reset to default world orientation.');
    }
  }

  getVCBLabel(): string { return ''; }
  getPreview(): ToolPreview | null { return null; }

  getEventNeeds(): ToolEventNeeds {
    // snap + raycast so the origin click can land on vertices/edges precisely
    // (and so GPU pick runs on hover for the face pre-selection highlight).
    return { snap: true, raycast: true, edgeRaycast: false, liveSyncOnMove: false, mutatesOnClick: false };
  }

  // ── Visual ────────────────────────────────────────────

  private updateAxesVisual(): void {
    this.removeAxesVisual();

    const axes = customAxes.current;
    if (!axes) return;

    const overlayScene = (this.viewport.renderer as any).getOverlayScene?.() as THREE.Scene | undefined;
    if (!overlayScene) return;

    this.axesHelper = new THREE.Group();
    this.axesHelper.name = 'custom-axes';
    this.axesHelper.renderOrder = 998;

    const length = 2.0;
    const origin = new THREE.Vector3(axes.origin.x, axes.origin.y, axes.origin.z);

    // X axis — red
    this.addAxisLine(origin, axes.xAxis, length, 0xff0000);
    // Y axis — blue (vertical, classic CAD color language)
    this.addAxisLine(origin, axes.yAxis, length, 0x2255ee);
    // Z axis — green
    this.addAxisLine(origin, axes.zAxis, length, 0x22aa33);

    overlayScene.add(this.axesHelper);
  }

  private addAxisLine(origin: THREE.Vector3, dir: Vec3, length: number, color: number): void {
    if (!this.axesHelper) return;

    const end = new THREE.Vector3(
      origin.x + dir.x * length,
      origin.y + dir.y * length,
      origin.z + dir.z * length,
    );

    const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 3, depthTest: false });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 998;
    line.raycast = () => {};
    this.axesHelper.add(line);
  }

  private removeAxesVisual(): void {
    const overlayScene = (this.viewport.renderer as any).getOverlayScene?.() as THREE.Scene | undefined;
    if (!overlayScene) return;

    // Remove by reference if we have it
    if (this.axesHelper) {
      overlayScene.remove(this.axesHelper);
      this.axesHelper.traverse(child => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.axesHelper = null;
    }

    // Also remove any orphaned custom-axes groups (from tool deactivation/reactivation)
    let orphan = overlayScene.getObjectByName('custom-axes');
    while (orphan) {
      overlayScene.remove(orphan);
      orphan.traverse(child => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      orphan = overlayScene.getObjectByName('custom-axes');
    }
  }
}
