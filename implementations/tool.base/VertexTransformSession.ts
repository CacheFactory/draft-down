// @archigraph tool.base
// Shared vertex-transform session for tools that displace existing vertices
// (Move, Rotate, Scale): collect vertices from a selection, snapshot their
// original positions, preview transforms against the originals on every
// mouse move, and restore on cancel.

import type { Vec3 } from '../../src/core/types';
import type { IGeometryEngine } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';

export class VertexTransformSession {
  /** Unique vertex ids in the session (gathered or set explicitly). */
  vertexIds: string[] = [];
  private originals = new Map<string, Vec3>();

  constructor(private geometry: IGeometryEngine) {}

  /** Collect unique vertex ids from face/edge entity ids (component-resolved). */
  gather(entityIds: Iterable<string>): string[] {
    this.vertexIds = [];
    const seen = new Set<string>();
    const push = (vid: string) => {
      if (!seen.has(vid)) { seen.add(vid); this.vertexIds.push(vid); }
    };
    for (const id of entityIds) {
      const face = this.geometry.getFace(id);
      if (face) {
        for (const vid of face.vertexIds) push(vid);
        continue;
      }
      const edge = this.geometry.getEdge(id);
      if (edge) {
        push(edge.startVertexId);
        push(edge.endVertexId);
      }
    }
    return this.vertexIds;
  }

  /** Use an explicit vertex list (e.g. freshly cloned copies in Copy mode). */
  setVertices(ids: string[]): void {
    this.vertexIds = [...ids];
  }

  /** Snapshot the current positions of the session's vertices. */
  snapshot(): void {
    this.originals.clear();
    for (const vid of this.vertexIds) {
      const v = this.geometry.getVertex(vid);
      if (v) this.originals.set(vid, vec3.clone(v.position));
    }
  }

  /** Set every vertex to fn(originalPosition). Returns the ids for dirty-sync. */
  apply(fn: (original: Vec3) => Vec3): string[] {
    for (const [vid, orig] of this.originals) {
      const v = this.geometry.getVertex(vid);
      if (!v) continue;
      const p = fn(orig);
      v.position.x = p.x;
      v.position.y = p.y;
      v.position.z = p.z;
    }
    return this.vertexIds;
  }

  /** Restore all vertices to their snapshotted positions. */
  restore(): void {
    this.apply(orig => orig);
  }

  get size(): number {
    return this.vertexIds.length;
  }

  /** Axis-aligned bounding box of the session's current vertex positions. */
  bounds(): { min: Vec3; max: Vec3; center: Vec3 } {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const vid of this.vertexIds) {
      const v = this.geometry.getVertex(vid);
      if (!v) continue;
      const p = v.position;
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; if (p.z > maxZ) maxZ = p.z;
    }
    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    };
  }

  get originalPositions(): ReadonlyMap<string, Vec3> {
    return this.originals;
  }

  clear(): void {
    this.vertexIds = [];
    this.originals.clear();
  }
}
