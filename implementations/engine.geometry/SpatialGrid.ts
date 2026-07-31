// @archigraph engine.geometry
// Uniform hash-grid spatial index over mesh vertices and edges. Rebuilt
// lazily (cheap single pass) and queried by ray corridor or AABB so snap
// detection and draw-time intersection scans stay fast on large models
// instead of bailing out entirely.

import type { Vec3 } from '../../src/core/types';
import type { IMesh } from '../../src/core/interfaces';

const DEFAULT_CELL = 0.5; // meters — a good balance for building-scale models

export class SpatialGrid {
  private cell = DEFAULT_CELL;
  private vertexCells = new Map<string, string[]>(); // cellKey → vertex ids
  private edgeCells = new Map<string, string[]>();   // cellKey → edge ids
  private lastBuildSignature = '';
  private lastBuildTime = 0;

  /** Staleness window: position-only mutations (drag previews) don't change
   *  counts, so also rebuild after this many ms. */
  private static readonly MAX_AGE_MS = 500;

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }

  /** Rebuild if the mesh changed shape or the index has aged out. */
  ensureFresh(mesh: IMesh): void {
    const signature = `${mesh.vertices.size}:${mesh.edges.size}:${mesh.faces.size}`;
    const now = Date.now();
    if (signature === this.lastBuildSignature && now - this.lastBuildTime < SpatialGrid.MAX_AGE_MS) {
      return;
    }
    this.rebuild(mesh);
    this.lastBuildSignature = signature;
    this.lastBuildTime = now;
  }

  private rebuild(mesh: IMesh): void {
    this.vertexCells.clear();
    this.edgeCells.clear();

    for (const [id, v] of mesh.vertices) {
      const k = this.key(v.position.x, v.position.y, v.position.z);
      let arr = this.vertexCells.get(k);
      if (!arr) { arr = []; this.vertexCells.set(k, arr); }
      arr.push(id);
    }

    for (const [id, e] of mesh.edges) {
      const a = mesh.vertices.get(e.startVertexId);
      const b = mesh.vertices.get(e.endVertexId);
      if (!a || !b) continue;
      // Insert the edge into every cell its AABB overlaps (fine for the
      // short edges hand modeling produces; long edges span more cells).
      const minX = Math.floor(Math.min(a.position.x, b.position.x) / this.cell);
      const maxX = Math.floor(Math.max(a.position.x, b.position.x) / this.cell);
      const minY = Math.floor(Math.min(a.position.y, b.position.y) / this.cell);
      const maxY = Math.floor(Math.max(a.position.y, b.position.y) / this.cell);
      const minZ = Math.floor(Math.min(a.position.z, b.position.z) / this.cell);
      const maxZ = Math.floor(Math.max(a.position.z, b.position.z) / this.cell);
      // Cap pathological spans (a 1000m guide-like edge would flood the grid)
      const span = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
      if (span > 4096) continue; // fall back: such edges are found by brute scans
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            const k = `${x},${y},${z}`;
            let arr = this.edgeCells.get(k);
            if (!arr) { arr = []; this.edgeCells.set(k, arr); }
            arr.push(id);
          }
        }
      }
    }
  }

  /**
   * Candidate vertices/edges within `radius` of the ray, walking the grid
   * with a 3D DDA up to maxDist. Returns deduped id sets.
   */
  queryRay(
    origin: Vec3, dir: Vec3, radius: number, maxDist: number,
  ): { vertexIds: Set<string>; edgeIds: Set<string> } {
    const vertexIds = new Set<string>();
    const edgeIds = new Set<string>();
    const pad = Math.max(1, Math.ceil(radius / this.cell));

    // Step along the ray at cell resolution; visit padded neighborhood.
    const steps = Math.min(2000, Math.ceil(maxDist / this.cell));
    const seen = new Set<string>();
    for (let s = 0; s <= steps; s++) {
      const t = s * this.cell;
      const cx = Math.floor((origin.x + dir.x * t) / this.cell);
      const cy = Math.floor((origin.y + dir.y * t) / this.cell);
      const cz = Math.floor((origin.z + dir.z * t) / this.cell);
      for (let x = cx - pad; x <= cx + pad; x++) {
        for (let y = cy - pad; y <= cy + pad; y++) {
          for (let z = cz - pad; z <= cz + pad; z++) {
            const k = `${x},${y},${z}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const vs = this.vertexCells.get(k);
            if (vs) for (const id of vs) vertexIds.add(id);
            const es = this.edgeCells.get(k);
            if (es) for (const id of es) edgeIds.add(id);
          }
        }
      }
    }
    return { vertexIds, edgeIds };
  }

  /** Candidate edges whose cells overlap the given AABB (padded). */
  queryAABBEdges(min: Vec3, max: Vec3, pad = 0.01): Set<string> {
    const out = new Set<string>();
    const minX = Math.floor((min.x - pad) / this.cell);
    const maxX = Math.floor((max.x + pad) / this.cell);
    const minY = Math.floor((min.y - pad) / this.cell);
    const maxY = Math.floor((max.y + pad) / this.cell);
    const minZ = Math.floor((min.z - pad) / this.cell);
    const maxZ = Math.floor((max.z + pad) / this.cell);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const es = this.edgeCells.get(`${x},${y},${z}`);
          if (es) for (const id of es) out.add(id);
        }
      }
    }
    return out;
  }

  /** Candidate vertices whose cells overlap the given AABB (padded). */
  queryAABBVertices(min: Vec3, max: Vec3, pad = 0.01): Set<string> {
    const out = new Set<string>();
    const minX = Math.floor((min.x - pad) / this.cell);
    const maxX = Math.floor((max.x + pad) / this.cell);
    const minY = Math.floor((min.y - pad) / this.cell);
    const maxY = Math.floor((max.y + pad) / this.cell);
    const minZ = Math.floor((min.z - pad) / this.cell);
    const maxZ = Math.floor((max.z + pad) / this.cell);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const vs = this.vertexCells.get(`${x},${y},${z}`);
          if (vs) for (const id of vs) out.add(id);
        }
      }
    }
    return out;
  }
}
