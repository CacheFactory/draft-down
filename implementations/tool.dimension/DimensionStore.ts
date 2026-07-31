// @archigraph tool.dimension
// Shared store for placed dimension annotations.
// Dimensions are associative — they track vertex IDs and update when geometry moves.

import type { Vec3 } from '../../src/core/types';
import { vec3 } from '../../src/core/math';
import { formatDistance, getCurrentUnit } from '../../src/core/units';
import type { IGeometryEngine } from '../../src/core/interfaces';
import * as THREE from 'three';

export interface DimensionRecord {
  id: string;
  startVertexId: string | null;  // vertex ID for associative tracking
  endVertexId: string | null;
  startPoint: Vec3;              // fallback if vertex not found
  endPoint: Vec3;
  offsetDir: Vec3;               // unit vector perpendicular to measurement line
  offsetDist: number;            // current offset distance along offsetDir
  textPosition: Vec3;
  distance: number;
  sprite: THREE.Sprite;
  guideLineIds: string[];
}

class DimensionStoreImpl {
  private dimensions = new Map<string, DimensionRecord>();

  /** Snapshot stack — stores dimension IDs present at each geometry snapshot. */
  private snapshotStack: Set<string>[] = [];

  add(record: DimensionRecord): void {
    this.dimensions.set(record.id, record);
  }

  /** Take a snapshot of current dimension IDs. Call this when geometry is snapshotted. */
  pushSnapshot(): void {
    this.snapshotStack.push(new Set(this.dimensions.keys()));
  }

  /** Pop the latest snapshot and return dimension IDs that should be removed.
   *  Returns the IDs that were added since the snapshot was taken. */
  popSnapshot(): string[] {
    if (this.snapshotStack.length === 0) return [];
    const snapshot = this.snapshotStack.pop()!;
    // Dimensions that exist now but weren't in the snapshot should be removed
    const toRemove: string[] = [];
    for (const id of this.dimensions.keys()) {
      if (!snapshot.has(id)) toRemove.push(id);
    }
    // Dimensions that were in the snapshot but don't exist now — these were
    // removed dimensions we can't restore (sprites are gone), so we skip them.
    return toRemove;
  }

  get(id: string): DimensionRecord | undefined {
    return this.dimensions.get(id);
  }

  has(id: string): boolean {
    return this.dimensions.has(id);
  }

  isDimensionEntity(entityId: string): boolean {
    return this.dimensions.has(entityId);
  }

  remove(id: string): DimensionRecord | undefined {
    const rec = this.dimensions.get(id);
    if (rec) this.dimensions.delete(id);
    return rec;
  }

  all(): DimensionRecord[] {
    return Array.from(this.dimensions.values());
  }

  /**
   * Reposition a dimension at a new offset distance along its perpendicular.
   */
  reposition(id: string, newOffsetDist: number): {
    dimStart: Vec3; dimEnd: Vec3;
    extStart1: Vec3; extStart2: Vec3;
    textPos: Vec3; offsetDir: Vec3;
  } | null {
    const dim = this.dimensions.get(id);
    if (!dim) return null;

    const dir = dim.offsetDir;
    const dimStart = vec3.add(dim.startPoint, vec3.mul(dir, newOffsetDist));
    const dimEnd = vec3.add(dim.endPoint, vec3.mul(dir, newOffsetDist));
    const midpoint = vec3.mul(vec3.add(dimStart, dimEnd), 0.5);
    const textPos: Vec3 = {
      x: midpoint.x + dir.x * 0.15,
      y: midpoint.y + dir.y * 0.15,
      z: midpoint.z + dir.z * 0.15,
    };

    dim.offsetDist = newOffsetDist;
    dim.textPosition = textPos;
    dim.sprite.position.set(textPos.x, textPos.y, textPos.z);

    return {
      dimStart, dimEnd,
      extStart1: dim.startPoint,
      extStart2: dim.endPoint,
      textPos, offsetDir: dir,
    };
  }

  /**
   * Update all dimensions from current vertex positions.
   * Call this after any geometry change (move, scale, etc.).
   * Returns guide line updates that need to be applied to the renderer.
   */
  syncToGeometry(geometry: IGeometryEngine): Array<{
    dim: DimensionRecord;
    dimStart: Vec3; dimEnd: Vec3;
    extStart1: Vec3; extStart2: Vec3;
    textPos: Vec3; offsetDir: Vec3;
  }> {
    const updates: Array<{
      dim: DimensionRecord;
      dimStart: Vec3; dimEnd: Vec3;
      extStart1: Vec3; extStart2: Vec3;
      textPos: Vec3; offsetDir: Vec3;
    }> = [];

    for (const dim of this.dimensions.values()) {
      let changed = false;

      // Update start point from vertex
      if (dim.startVertexId) {
        const v = geometry.getVertex(dim.startVertexId);
        if (v && vec3.distance(v.position, dim.startPoint) > 1e-6) {
          dim.startPoint = vec3.clone(v.position);
          changed = true;
        }
      }

      // Update end point from vertex
      if (dim.endVertexId) {
        const v = geometry.getVertex(dim.endVertexId);
        if (v && vec3.distance(v.position, dim.endPoint) > 1e-6) {
          dim.endPoint = vec3.clone(v.position);
          changed = true;
        }
      }

      if (!changed) continue;

      // Recompute distance
      dim.distance = vec3.distance(dim.startPoint, dim.endPoint);

      // Recompute dimension positions at current offset
      const dir = dim.offsetDir;
      const dimStart = vec3.add(dim.startPoint, vec3.mul(dir, dim.offsetDist));
      const dimEnd = vec3.add(dim.endPoint, vec3.mul(dir, dim.offsetDist));
      const midpoint = vec3.mul(vec3.add(dimStart, dimEnd), 0.5);
      const textPos: Vec3 = {
        x: midpoint.x + dir.x * 0.15,
        y: midpoint.y + dir.y * 0.15,
        z: midpoint.z + dir.z * 0.15,
      };

      dim.textPosition = textPos;
      dim.sprite.position.set(textPos.x, textPos.y, textPos.z);

      // Update text on sprite — recreate canvas texture
      this.updateSpriteText(dim.sprite, formatDistance(dim.distance, getCurrentUnit()));

      updates.push({
        dim, dimStart, dimEnd,
        extStart1: dim.startPoint,
        extStart2: dim.endPoint,
        textPos, offsetDir: dir,
      });
    }

    return updates;
  }

  /** Redraw the text on an existing sprite's canvas texture. */
  private updateSpriteText(sprite: THREE.Sprite, text: string): void {
    // globalThis-guarded: this module is also loaded in headless tests
    const canvas = (globalThis as any).document?.createElement?.('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fontSize = 36;
    const padding = 8;
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const metrics = ctx.measureText(text);
    canvas.width = metrics.width + padding * 2;
    canvas.height = fontSize + padding * 2;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = '#333333';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const mat = sprite.material as THREE.SpriteMaterial;
    if (mat.map) mat.map.dispose();
    mat.map = new THREE.CanvasTexture(canvas);
    mat.map.needsUpdate = true;
    sprite.scale.set(canvas.width / 250, canvas.height / 250, 1);
  }

  /**
   * Remove dimensions whose tracked vertices no longer exist in the geometry.
   * Returns removed records so caller can clean up guide lines and sprites.
   */
  reconcile(geometry: IGeometryEngine): DimensionRecord[] {
    const removed: DimensionRecord[] = [];
    for (const [id, dim] of this.dimensions) {
      let orphaned = false;
      if (dim.startVertexId && !geometry.getVertex(dim.startVertexId)) orphaned = true;
      if (dim.endVertexId && !geometry.getVertex(dim.endVertexId)) orphaned = true;
      if (orphaned) {
        removed.push(dim);
        this.dimensions.delete(id);
      }
    }
    return removed;
  }

  clear(): void {
    this.dimensions.clear();
  }
}

/** Singleton dimension store shared across tools. */
export const dimensionStore = new DimensionStoreImpl();
