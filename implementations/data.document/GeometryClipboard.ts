// @archigraph data.document
// In-session geometry clipboard: snapshot selected faces/edges into a
// detached structure (copy), and instantiate that structure back into the
// mesh (paste). Pure data — no UI. Used by Application copy/cut/paste.

import type { Vec3 } from '../../src/core/types';
import type { IGeometryEngine, IMaterialManager } from '../../src/core/interfaces';

export interface ClipboardEdge {
  a: number;
  b: number;
  soft?: boolean;
  smooth?: boolean;
  curveId?: string;
}

export interface ClipboardFace {
  vertexIndices: number[];
  frontMaterialId: string | null;
  backMaterialId: string | null;
}

export interface ClipboardData {
  positions: Vec3[];
  edges: ClipboardEdge[];
  faces: ClipboardFace[];
  /** Attachment point for cursor placement — bounding-box min corner. */
  anchor: Vec3;
}

/**
 * Snapshot the given entity ids (face/edge ids, already component-expanded)
 * into detached clipboard data. Faces contribute their outer-ring boundary
 * edges automatically so a pasted face arrives fully edged.
 * Holes are not copied (a holed face pastes as its outer ring) — copy the
 * inner faces too if you want the openings.
 * Returns null when the selection contains no copyable geometry.
 */
export function copyGeometry(
  geometry: IGeometryEngine,
  materials: IMaterialManager | null,
  entityIds: Iterable<string>,
): ClipboardData | null {
  const vertexIndex = new Map<string, number>();
  const positions: Vec3[] = [];
  const indexOf = (vid: string): number | null => {
    const existing = vertexIndex.get(vid);
    if (existing !== undefined) return existing;
    const v = geometry.getVertex(vid);
    if (!v) return null;
    vertexIndex.set(vid, positions.length);
    positions.push({ x: v.position.x, y: v.position.y, z: v.position.z });
    return positions.length - 1;
  };

  const edges: ClipboardEdge[] = [];
  const faces: ClipboardFace[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (aId: string, bId: string, src?: { soft?: boolean; smooth?: boolean; curveId?: string }) => {
    const a = indexOf(aId);
    const b = indexOf(bId);
    if (a === null || b === null || a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ a, b, soft: src?.soft, smooth: src?.smooth, curveId: src?.curveId });
  };

  for (const id of entityIds) {
    const face = geometry.getFace(id);
    if (face) {
      // Outer ring only — vertexIds may also contain hole rings.
      const outerEnd = face.holeStartIndices?.[0] ?? face.vertexIds.length;
      const ring = face.vertexIds.slice(0, outerEnd);
      const indices: number[] = [];
      for (const vid of ring) {
        const idx = indexOf(vid);
        if (idx !== null) indices.push(idx);
      }
      if (indices.length < 3) continue;

      const front = materials?.getFaceMaterial?.(id) ?? null;
      faces.push({
        vertexIndices: indices,
        frontMaterialId: front && front.id !== '__default__' ? front.id : null,
        backMaterialId: null, // back-face materials not copied (no front/back read API)
      });

      // Boundary edges of the outer ring
      for (let i = 0; i < ring.length; i++) {
        const aId = ring[i];
        const bId = ring[(i + 1) % ring.length];
        addEdge(aId, bId, findEdgeBetween(geometry, aId, bId));
      }
      continue;
    }
    const edge = geometry.getEdge(id);
    if (edge) {
      addEdge(edge.startVertexId, edge.endVertexId, edge);
    }
  }

  if (faces.length === 0 && edges.length === 0) return null;

  const anchor = { x: Infinity, y: Infinity, z: Infinity };
  for (const p of positions) {
    if (p.x < anchor.x) anchor.x = p.x;
    if (p.y < anchor.y) anchor.y = p.y;
    if (p.z < anchor.z) anchor.z = p.z;
  }

  return { positions, edges, faces, anchor };
}

function findEdgeBetween(geometry: IGeometryEngine, aId: string, bId: string) {
  const mesh = geometry.getMesh();
  for (const [, e] of mesh.edges) {
    if ((e.startVertexId === aId && e.endVertexId === bId) ||
        (e.startVertexId === bId && e.endVertexId === aId)) {
      return e;
    }
  }
  return undefined;
}

/**
 * Instantiate clipboard data into the mesh at `offset` from its copied
 * position. Curve ids are remapped (each paste gets fresh curve grouping),
 * and face materials re-applied when they still exist.
 * The caller owns the history transaction.
 */
export function instantiateGeometry(
  geometry: IGeometryEngine,
  materials: IMaterialManager | null,
  data: ClipboardData,
  offset: Vec3,
): { vertexIds: string[]; edgeIds: string[]; faceIds: string[] } {
  const vertexIds: string[] = [];
  for (const p of data.positions) {
    const v = geometry.createVertex({ x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z });
    vertexIds.push(v.id);
  }

  const curveRemap = new Map<string, string>();
  const edgeIds: string[] = [];
  for (const e of data.edges) {
    try {
      const edge = geometry.createEdge(vertexIds[e.a], vertexIds[e.b]);
      if (e.soft !== undefined) edge.soft = e.soft;
      if (e.smooth !== undefined) edge.smooth = e.smooth;
      if (e.curveId) {
        let mapped = curveRemap.get(e.curveId);
        if (!mapped) {
          mapped = `curve-${Math.random().toString(36).slice(2, 10)}`;
          curveRemap.set(e.curveId, mapped);
        }
        edge.curveId = mapped;
      }
      edgeIds.push(edge.id);
    } catch (err) {
      console.warn('[GeometryClipboard] edge instantiation failed:', err);
    }
  }

  const faceIds: string[] = [];
  for (const f of data.faces) {
    try {
      const face = geometry.createFace(f.vertexIndices.map(i => vertexIds[i]));
      faceIds.push(face.id);
      if (materials) {
        if (f.frontMaterialId && materials.getMaterial(f.frontMaterialId)) {
          materials.applyToFace(face.id, f.frontMaterialId);
        }
        if (f.backMaterialId && materials.getMaterial(f.backMaterialId)) {
          (materials as any).applyToFace?.(face.id, f.backMaterialId, true);
        }
      }
    } catch (err) {
      console.warn('[GeometryClipboard] face instantiation failed:', err);
    }
  }

  return { vertexIds, edgeIds, faceIds };
}
