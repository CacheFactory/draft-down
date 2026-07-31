// @archigraph tool.base
// Shared selection-cloning helper: duplicate faces/edges (with fresh vertices)
// from a list of entity ids. Used by Move (Ctrl-copy + linear arrays) and
// Rotate (Ctrl-copy + radial arrays).

import type { IGeometryEngine } from '../../src/core/interfaces';

export interface ClonedGeometry {
  newVertexIds: string[];
  newFaceIds: string[];
  newEdgeIds: string[];
}

export function cloneEntitiesFromIds(geo: IGeometryEngine, entityIds: string[]): ClonedGeometry {
  const oldVertexIds = new Set<string>();
  const faceIds: string[] = [];
  const edgeIds: string[] = [];

  for (const id of entityIds) {
    const face = geo.getFace(id);
    if (face) {
      faceIds.push(id);
      for (const vid of face.vertexIds) oldVertexIds.add(vid);
      continue;
    }
    const edge = geo.getEdge(id);
    if (edge) {
      edgeIds.push(id);
      oldVertexIds.add(edge.startVertexId);
      oldVertexIds.add(edge.endVertexId);
    }
  }

  const vMap = new Map<string, string>();
  const newVertexIds: string[] = [];
  for (const oldVid of oldVertexIds) {
    const v = geo.getVertex(oldVid);
    if (!v) continue;
    const newV = geo.createVertex({ x: v.position.x, y: v.position.y, z: v.position.z });
    vMap.set(oldVid, newV.id);
    newVertexIds.push(newV.id);
  }

  const newFaceIds: string[] = [];
  for (const fid of faceIds) {
    const face = geo.getFace(fid);
    if (!face) continue;
    const newVerts = face.vertexIds.map(v => vMap.get(v)).filter(Boolean) as string[];
    if (newVerts.length < 3) continue;
    try {
      const newF = geo.createFace(newVerts);
      newFaceIds.push(newF.id);
    } catch (e) { console.warn('[cloneEntitiesFromIds] clone face failed:', e); }
  }

  const newEdgeIds: string[] = [];
  for (const eid of edgeIds) {
    const edge = geo.getEdge(eid);
    if (!edge) continue;
    const newStart = vMap.get(edge.startVertexId);
    const newEnd = vMap.get(edge.endVertexId);
    if (!newStart || !newEnd || newStart === newEnd) continue;
    try {
      const newE = geo.createEdge(newStart, newEnd);
      newEdgeIds.push(newE.id);
    } catch { /* edge may already exist via cloned face — ignore */ }
  }

  return { newVertexIds, newFaceIds, newEdgeIds };
}
