// @archigraph tool.dimension
// Dimension tool: click two points, then offset to place a dimension annotation.
// Creates extension lines, a dimension line with tick marks, and a text sprite.

import type { Vec3 } from '../../src/core/types';
import type { ToolMouseEvent, ToolKeyEvent, ToolPreview } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';
import { BaseTool } from '../tool.base/BaseTool';
import { dimensionStore } from './DimensionStore';
import * as THREE from 'three';

export class DimensionTool extends BaseTool {
  readonly id = 'tool.dimension';
  readonly name = 'Dimension';
  readonly icon = 'type';
  readonly shortcut = 'D';
  readonly category = 'measure' as const;
  readonly cursor = 'crosshair';

  private startPoint: Vec3 | null = null;
  private endPoint: Vec3 | null = null;
  private startVertexId: string | null = null;
  private endVertexId: string | null = null;
  private currentPoint: Vec3 | null = null;
  private step: 0 | 1 | 2 = 0; // 0=start, 1=end, 2=offset

  activate(): void {
    super.activate();
    this.reset();
    this.setStatus('Click first dimension point.');
  }

  deactivate(): void {
    this.reset();
    super.deactivate();
  }

  onMouseDown(event: ToolMouseEvent): void {
    if (event.button !== 0) return;
    const point = this.getStandardDrawPoint(event, this.startPoint ?? undefined) ?? this.resolvePoint(event);
    if (!point) return;

    if (this.step === 0) {
      this.startPoint = point;
      this.startVertexId = this.findNearestVertexId(point);
      this.step = 1;
      this.setPhase('drawing');
      this.setStatus('Click second dimension point.');
    } else if (this.step === 1) {
      this.endPoint = point;
      this.endVertexId = this.findNearestVertexId(point);
      this.step = 2;
      const dist = vec3.distance(this.startPoint!, point);
      this.setVCBValue(this.formatDist(dist));
      this.setStatus('Move to offset dimension line, then click to place.');
    } else if (this.step === 2) {
      this.createDimension(point);
    }
  }

  onMouseMove(event: ToolMouseEvent): void {
    const point = this.getStandardDrawPoint(event, this.startPoint ?? undefined) ?? this.resolvePoint(event);
    if (point) this.currentPoint = point;

    if (this.step === 1 && this.startPoint && point) {
      this.setVCBValue(this.formatDist(vec3.distance(this.startPoint, point)));
    }
  }

  onKeyDown(event: ToolKeyEvent): void {
    if (event.key === 'Escape') {
      this.reset();
      this.setStatus('Click first dimension point.');
    }
  }

  onVCBInput(value: string): void {
    // Allow typing exact distance when in step 1 (setting end point)
    if (this.step === 1 && this.startPoint && this.currentPoint) {
      const dist = this.parseDistance(value);
      if (isNaN(dist) || dist <= 0) return;

      const delta = vec3.sub(this.currentPoint, this.startPoint);
      const len = vec3.length(delta);
      if (len < 1e-10) return;

      const direction = vec3.normalize(delta);
      this.endPoint = vec3.add(this.startPoint, vec3.mul(direction, dist));
      this.step = 2;
      this.setVCBValue(this.formatDist(dist));
      this.setStatus('Move to offset dimension line, then click to place.');
    }
  }

  getVCBLabel(): string {
    return this.step >= 1 ? 'Length' : '';
  }

  getPreview(): ToolPreview | null {
    if (this.step === 1 && this.startPoint && this.currentPoint) {
      return { lines: [{ from: this.startPoint, to: this.currentPoint }] };
    }
    if (this.step === 2 && this.startPoint && this.endPoint && this.currentPoint) {
      // Show offset dimension preview
      const offset = this.computeOffset(this.startPoint, this.endPoint, this.currentPoint);
      if (offset) {
        const { dimStart, dimEnd, extStart1, extStart2 } = offset;
        return {
          lines: [
            { from: dimStart, to: dimEnd },          // dimension line
            { from: extStart1, to: dimStart },        // extension line 1
            { from: extStart2, to: dimEnd },          // extension line 2
          ],
        };
      }
    }
    return null;
  }

  // ── Private ────────────────────────────────────────────

  private reset(): void {
    this.startPoint = null;
    this.endPoint = null;
    this.startVertexId = null;
    this.endVertexId = null;
    this.currentPoint = null;
    this.step = 0;
    this.setPhase('idle');
    this.setVCBValue('');
  }

  /** Find the nearest vertex within snap distance, or null. */
  private findNearestVertexId(point: Vec3): string | null {
    const SNAP_DIST = 0.05;
    const mesh = this.document.geometry.getMesh();
    let bestId: string | null = null;
    let bestDist = SNAP_DIST;
    for (const [, v] of mesh.vertices) {
      const d = vec3.distance(v.position, point);
      if (d < bestDist) { bestDist = d; bestId = v.id; }
    }
    return bestId;
  }

  /**
   * Compute offset positions for the dimension line.
   * Projects the cursor onto the perpendicular of the start→end line
   * to determine how far offset the dimension annotation should be.
   */
  private computeOffset(start: Vec3, end: Vec3, cursor: Vec3) {
    const lineDir = vec3.sub(end, start);
    const lineLen = vec3.length(lineDir);
    if (lineLen < 1e-6) return null;

    const lineDirN = vec3.normalize(lineDir);

    // Vector from start to cursor
    const toCursor = vec3.sub(cursor, start);

    // Component along line direction (not needed for offset, but useful)
    // Component perpendicular to line = toCursor - projection onto line
    const projLen = vec3.dot(toCursor, lineDirN);
    const projOnLine = vec3.mul(lineDirN, projLen);
    const perpComponent = vec3.sub(toCursor, projOnLine);
    const offsetDist = vec3.length(perpComponent);

    if (offsetDist < 0.01) {
      // Too close to the line, use a small default offset
      // Pick a perpendicular direction (prefer Y-up)
      const up: Vec3 = { x: 0, y: 1, z: 0 };
      const cross = vec3.cross(lineDirN, up);
      const crossLen = vec3.length(cross);
      const perpDir = crossLen > 0.01
        ? vec3.normalize(cross)
        : vec3.normalize(vec3.cross(lineDirN, { x: 1, y: 0, z: 0 }));

      return {
        dimStart: vec3.add(start, vec3.mul(perpDir, 0.3)),
        dimEnd: vec3.add(end, vec3.mul(perpDir, 0.3)),
        extStart1: start,
        extStart2: end,
        offsetDir: perpDir,
        distance: lineLen,
      };
    }

    const offsetDir = vec3.normalize(perpComponent);
    const dimStart = vec3.add(start, vec3.mul(offsetDir, offsetDist));
    const dimEnd = vec3.add(end, vec3.mul(offsetDir, offsetDist));

    return {
      dimStart,
      dimEnd,
      extStart1: start,
      extStart2: end,
      offsetDir,
      distance: lineLen,
    };
  }

  private createDimension(offsetPoint: Vec3): void {
    if (!this.startPoint || !this.endPoint) return;

    this.beginTransaction('Dimension');

    const offset = this.computeOffset(this.startPoint, this.endPoint, offsetPoint);
    if (!offset) return;

    const { dimStart, dimEnd, extStart1, extStart2, offsetDir, distance } = offset;
    const ts = Date.now();
    const dimId = `dim-text-${ts}`;

    const dimColor = { r: 0.2, g: 0.2, b: 0.2 };
    const guideLineIds: string[] = [];

    // Extension lines (from geometry to dimension line)
    const ext1Id = `dim-ext1-${ts}`;
    const ext2Id = `dim-ext2-${ts}`;
    this.viewport.renderer.addGuideLine(ext1Id, extStart1, dimStart, dimColor, true);
    this.viewport.renderer.addGuideLine(ext2Id, extStart2, dimEnd, dimColor, true);
    guideLineIds.push(ext1Id, ext2Id);

    // Main dimension line
    const mainId = `dim-main-${ts}`;
    this.viewport.renderer.addGuideLine(mainId, dimStart, dimEnd, dimColor, false);
    guideLineIds.push(mainId);

    // Tick marks at each end of the dimension line
    const tickSize = 0.08;
    const tickDir = offsetDir;

    const tick1a = vec3.add(dimStart, vec3.mul(tickDir, tickSize));
    const tick1b = vec3.add(dimStart, vec3.mul(tickDir, -tickSize));
    const tick1Id = `dim-tick1-${ts}`;
    this.viewport.renderer.addGuideLine(tick1Id, tick1a, tick1b, dimColor, false);
    guideLineIds.push(tick1Id);

    const tick2a = vec3.add(dimEnd, vec3.mul(tickDir, tickSize));
    const tick2b = vec3.add(dimEnd, vec3.mul(tickDir, -tickSize));
    const tick2Id = `dim-tick2-${ts}`;
    this.viewport.renderer.addGuideLine(tick2Id, tick2a, tick2b, dimColor, false);
    guideLineIds.push(tick2Id);

    // Text sprite at midpoint of dimension line
    const midpoint = vec3.mul(vec3.add(dimStart, dimEnd), 0.5);
    const textPos: Vec3 = {
      x: midpoint.x + offsetDir.x * 0.15,
      y: midpoint.y + offsetDir.y * 0.15,
      z: midpoint.z + offsetDir.z * 0.15,
    };
    const sprite = this.createDimensionText(dimId, this.formatDist(distance), textPos);

    if (sprite) {
      // Compute offset distance from the measurement line to the dimension line
      const offsetDist = vec3.length(vec3.sub(dimStart, this.startPoint));
      dimensionStore.add({
        id: dimId,
        startVertexId: this.startVertexId,
        endVertexId: this.endVertexId,
        startPoint: vec3.clone(this.startPoint),
        endPoint: vec3.clone(this.endPoint),
        offsetDir: vec3.clone(offsetDir),
        offsetDist,
        textPosition: textPos,
        distance,
        sprite,
        guideLineIds,
      });
    }

    this.commitTransaction();
    this.setStatus(`Dimension placed: ${this.formatDist(distance)}`);
    this.reset();
  }

  /**
   * Create a Three.js Sprite showing the dimension measurement text.
   * Returns the sprite so it can be tracked in the dimension store.
   */
  private createDimensionText(dimId: string, text: string, position: Vec3): THREE.Sprite | null {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const fontSize = 36;
    const padding = 8;
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;

    canvas.width = textWidth + padding * 2;
    canvas.height = fontSize + padding * 2;

    // White background with slight transparency
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 4);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = '#333333';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      sizeAttenuation: true,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.set(position.x, position.y, position.z);
    sprite.scale.set(canvas.width / 250, canvas.height / 250, 1);

    // Make it selectable — entity ID and raycastable
    sprite.name = dimId;
    sprite.userData.entityId = dimId;
    sprite.userData.entityType = 'dimension';

    // Add to overlay scene
    const overlayScene = (this.viewport.renderer as any).getOverlayScene?.();
    if (overlayScene) {
      overlayScene.add(sprite);
    } else {
      const scene = (this.viewport.renderer as any).getScene?.();
      if (scene) scene.add(sprite);
    }

    // Register with renderer for hit detection
    (this.viewport.renderer as any).registerEntityObject?.(dimId, sprite);

    return sprite;
  }
}
