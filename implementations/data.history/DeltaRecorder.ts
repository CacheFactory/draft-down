// @archigraph svc.history_manager
// Delta recording for undo/redo — captures add/delete/modify operations on entity maps

import { IVertex, IEdge, IFace, IHalfEdge } from '../../src/core/interfaces';
import { vec3 } from '../../src/core/math';

// ─── Delta types ────────────────────────────────────────────────

export type DeltaOp =
  | { op: 'add'; map: string; key: string; value: unknown }
  | { op: 'delete'; map: string; key: string; value: unknown }
  | { op: 'modify'; map: string; key: string; before: unknown; after: unknown };

export interface GuideLineDelta {
  id: string;
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  color: { r: number; g: number; b: number; a?: number };
  dashed: boolean;
}

export interface DeltaTransaction {
  id: string;
  name: string;
  timestamp: number;
  deltas: DeltaOp[];
  dimensionsBefore?: Map<string, unknown>;
  dimensionsAfter?: Map<string, unknown>;
  guideLines?: GuideLineDelta[];
  guideLineRemovals?: GuideLineDelta[];
}

// ─── Entity clone helpers ───────────────────────────────────────

export function cloneVertex(v: IVertex): IVertex {
  return {
    id: v.id,
    position: { x: v.position.x, y: v.position.y, z: v.position.z },
    selected: v.selected,
    hidden: v.hidden,
  };
}

export function cloneEdge(e: IEdge): IEdge {
  return {
    id: e.id,
    startVertexId: e.startVertexId,
    endVertexId: e.endVertexId,
    soft: e.soft,
    smooth: e.smooth,
    selected: e.selected,
    hidden: e.hidden,
    materialIndex: e.materialIndex,
    curveId: e.curveId,
  };
}

export function cloneFace(f: IFace): IFace {
  return {
    id: f.id,
    vertexIds: [...f.vertexIds],
    normal: { x: f.normal.x, y: f.normal.y, z: f.normal.z },
    plane: {
      normal: { x: f.plane.normal.x, y: f.plane.normal.y, z: f.plane.normal.z },
      distance: f.plane.distance,
    },
    materialIndex: f.materialIndex,
    backMaterialIndex: f.backMaterialIndex,
    selected: f.selected,
    hidden: f.hidden,
    area: f.area,
    holeStartIndices: f.holeStartIndices ? [...f.holeStartIndices] : undefined,
    uvs: f.uvs ? f.uvs.map(uv => ({ u: uv.u, v: uv.v })) : undefined,
    generation: f.generation,
  };
}

export function cloneHalfEdge(he: IHalfEdge): IHalfEdge {
  return {
    id: he.id,
    originVertexId: he.originVertexId,
    twinId: he.twinId,
    nextId: he.nextId,
    prevId: he.prevId,
    faceId: he.faceId,
    edgeId: he.edgeId,
  };
}

export function cloneFaceAssignment(a: { front: string; back: string }): { front: string; back: string } {
  return { front: a.front, back: a.back };
}

// ─── DeltaRecorder ──────────────────────────────────────────────

export class DeltaRecorder {
  deltas: DeltaOp[] = [];

  record(op: DeltaOp): void {
    this.deltas.push(op);
  }
}
