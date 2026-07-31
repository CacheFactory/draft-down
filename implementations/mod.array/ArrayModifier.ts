// @archigraph op.array
// Linear and polar array modifier for DraftDown

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IFace, IVertex, IEdge } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export type ArrayType = 'linear' | 'polar';

/** Maximum number of array copies to prevent runaway geometry creation. */
const MAX_ARRAY_COUNT = 1000;

export interface LinearArrayParams {
  type: 'linear';
  faceIds: string[];
  direction: Vec3;           // direction and distance of each step
  count: number;             // total copies (including original = false, excluding = true)
  includeOriginal?: boolean; // default: false (count is number of new copies)
  /** Distance within which vertices of adjacent instances are merged. Default: 0 (no merge). */
  mergeTolerance?: number;
  /** If true, preserve material indices from source faces. Default: true */
  preserveMaterials?: boolean;
}

export interface PolarArrayParams {
  type: 'polar';
  faceIds: string[];
  axis: Vec3;       // rotation axis direction
  center: Vec3;     // center of rotation
  count: number;    // total instances around the circle
  angle?: number;   // total angle in radians (default: 2*PI = full circle)
  /** Distance within which vertices of adjacent instances are merged. Default: 0 (no merge). */
  mergeTolerance?: number;
  /** If true, preserve material indices from source faces. Default: true */
  preserveMaterials?: boolean;
}

export type ArrayParams = LinearArrayParams | PolarArrayParams;

export interface ArrayResult {
  success: boolean;
  /** Array of copy groups; each group contains the face/edge/vertex IDs for one copy */
  copies: Array<{
    faceIds: string[];
    edgeIds: string[];
    vertexIds: string[];
  }>;
  /** Number of vertices merged between adjacent instances */
  mergedVertexCount: number;
  error?: string;
}

/**
 * Array Modifier: duplicates geometry N times with a transform offset.
 *
 * Supports:
 * - Linear array: translate by a fixed vector each step.
 * - Polar array: rotate around an axis/center each step.
 * - Material preservation from source faces.
 * - Merge tolerance for welding vertices of adjacent instances.
 * - Count validation (max 1000 copies).
 */
export class ArrayModifier {
  execute(engine: IGeometryEngine, params: ArrayParams): ArrayResult {
    if (params.count < 1) {
      return { success: false, copies: [], mergedVertexCount: 0, error: 'Count must be at least 1' };
    }

    if (params.count > MAX_ARRAY_COUNT) {
      return {
        success: false,
        copies: [],
        mergedVertexCount: 0,
        error: `Count ${params.count} exceeds maximum of ${MAX_ARRAY_COUNT}`,
      };
    }

    if (params.faceIds.length === 0) {
      return { success: false, copies: [], mergedVertexCount: 0, error: 'No faces specified' };
    }

    // Validate direction/axis
    if (params.type === 'linear') {
      if (vec3.length(params.direction) < EPSILON) {
        return { success: false, copies: [], mergedVertexCount: 0, error: 'Direction vector must be non-zero' };
      }
    } else {
      if (vec3.length(params.axis) < EPSILON) {
        return { success: false, copies: [], mergedVertexCount: 0, error: 'Rotation axis must be non-zero' };
      }
    }

    if (params.type === 'linear') {
      return this.executeLinear(engine, params);
    } else {
      return this.executePolar(engine, params);
    }
  }

  private executeLinear(engine: IGeometryEngine, params: LinearArrayParams): ArrayResult {
    const {
      faceIds,
      direction,
      count,
      mergeTolerance = 0,
      preserveMaterials = true,
    } = params;
    const copies: ArrayResult['copies'] = [];
    let mergedVertexCount = 0;

    // Collect all unique vertices from the source faces
    const sourceVertexIds = this.collectUniqueVertices(engine, faceIds);

    // Collect source face material info for preservation
    const sourceMaterials = preserveMaterials
      ? this.collectFaceMaterials(engine, faceIds)
      : null;

    // Track all created vertices for merge operations
    const allCopyVertexIds: string[][] = [];

    for (let step = 1; step <= count; step++) {
      const offset = vec3.mul(direction, step);
      const copy = this.duplicateGeometry(
        engine, faceIds, sourceVertexIds,
        (pos) => vec3.add(pos, offset),
        sourceMaterials,
      );
      copies.push(copy);
      allCopyVertexIds.push(copy.vertexIds);
    }

    // Merge vertices between adjacent instances if tolerance > 0
    if (mergeTolerance > EPSILON) {
      // Merge between source and first copy, then between consecutive copies
      const sourcePosMap = this.buildVertexPositionMap(engine, sourceVertexIds);

      for (let step = 0; step < allCopyVertexIds.length; step++) {
        const prevVertexIds = step === 0 ? sourceVertexIds : allCopyVertexIds[step - 1];
        const currVertexIds = allCopyVertexIds[step];

        const merged = this.mergeNearbyVertices(engine, prevVertexIds, currVertexIds, mergeTolerance);
        mergedVertexCount += merged;
      }
    }

    return { success: true, copies, mergedVertexCount };
  }

  private executePolar(engine: IGeometryEngine, params: PolarArrayParams): ArrayResult {
    const {
      faceIds,
      axis,
      center,
      count,
      angle = Math.PI * 2,
      mergeTolerance = 0,
      preserveMaterials = true,
    } = params;
    const copies: ArrayResult['copies'] = [];
    let mergedVertexCount = 0;

    const axisNorm = vec3.normalize(axis);
    const sourceVertexIds = this.collectUniqueVertices(engine, faceIds);

    const sourceMaterials = preserveMaterials
      ? this.collectFaceMaterials(engine, faceIds)
      : null;

    // Angular step between copies. For full circle, divide evenly
    // and skip the last one (which would overlap the original).
    const stepAngle = angle / count;
    const allCopyVertexIds: string[][] = [];

    for (let step = 1; step < count; step++) {
      const theta = stepAngle * step;
      const copy = this.duplicateGeometry(
        engine, faceIds, sourceVertexIds,
        (pos) => this.rotatePointAroundAxis(pos, center, axisNorm, theta),
        sourceMaterials,
      );
      copies.push(copy);
      allCopyVertexIds.push(copy.vertexIds);
    }

    // Merge vertices between adjacent instances
    if (mergeTolerance > EPSILON && allCopyVertexIds.length > 0) {
      for (let step = 0; step < allCopyVertexIds.length; step++) {
        const prevVertexIds = step === 0 ? sourceVertexIds : allCopyVertexIds[step - 1];
        const currVertexIds = allCopyVertexIds[step];
        const merged = this.mergeNearbyVertices(engine, prevVertexIds, currVertexIds, mergeTolerance);
        mergedVertexCount += merged;
      }

      // For full circle, also merge last copy with source
      if (Math.abs(angle - Math.PI * 2) < EPSILON && allCopyVertexIds.length > 0) {
        const lastCopy = allCopyVertexIds[allCopyVertexIds.length - 1];
        const merged = this.mergeNearbyVertices(engine, lastCopy, sourceVertexIds, mergeTolerance);
        mergedVertexCount += merged;
      }
    }

    return { success: true, copies, mergedVertexCount };
  }

  /** Collect all unique vertex IDs referenced by the given faces */
  private collectUniqueVertices(engine: IGeometryEngine, faceIds: string[]): string[] {
    const vertexIdSet = new Set<string>();
    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;
      for (const vid of face.vertexIds) {
        vertexIdSet.add(vid);
      }
    }
    return Array.from(vertexIdSet);
  }

  /** Collect material indices for source faces */
  private collectFaceMaterials(
    engine: IGeometryEngine,
    faceIds: string[],
  ): Map<string, { materialIndex: number; backMaterialIndex: number }> {
    const result = new Map<string, { materialIndex: number; backMaterialIndex: number }>();
    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;
      result.set(faceId, {
        materialIndex: face.materialIndex,
        backMaterialIndex: face.backMaterialIndex,
      });
    }
    return result;
  }

  /**
   * Duplicate geometry by creating new vertices (transformed), edges, and faces.
   * Optionally preserves material assignments from source faces.
   */
  private duplicateGeometry(
    engine: IGeometryEngine,
    faceIds: string[],
    sourceVertexIds: string[],
    transformPos: (pos: Vec3) => Vec3,
    sourceMaterials: Map<string, { materialIndex: number; backMaterialIndex: number }> | null,
  ): { faceIds: string[]; edgeIds: string[]; vertexIds: string[] } {
    const vertexMap = new Map<string, string>(); // old -> new
    const newVertexIds: string[] = [];
    const newEdgeIds: string[] = [];
    const newFaceIds: string[] = [];

    // Create transformed copies of all vertices
    for (const vid of sourceVertexIds) {
      const v = engine.getVertex(vid);
      if (!v) continue;
      const newPos = transformPos(v.position);
      const newVertex = engine.createVertex(newPos);
      vertexMap.set(vid, newVertex.id);
      newVertexIds.push(newVertex.id);
    }

    // Track created edges to avoid duplicates
    const createdEdges = new Set<string>();

    // Recreate faces with mapped vertex IDs
    for (const faceId of faceIds) {
      const face = engine.getFace(faceId);
      if (!face) continue;

      const newVerts = face.vertexIds.map(vid => vertexMap.get(vid) ?? vid);
      const newFace = engine.createFace(newVerts);
      newFaceIds.push(newFace.id);

      // Preserve material assignments
      if (sourceMaterials) {
        const mat = sourceMaterials.get(faceId);
        if (mat) {
          newFace.materialIndex = mat.materialIndex;
          newFace.backMaterialIndex = mat.backMaterialIndex;
        }
      }

      // Create edges for the new face
      for (let i = 0; i < newVerts.length; i++) {
        const j = (i + 1) % newVerts.length;
        const edgeKey = [newVerts[i], newVerts[j]].sort().join('|');
        if (!createdEdges.has(edgeKey)) {
          createdEdges.add(edgeKey);
          const existing = engine.findEdgeBetween(newVerts[i], newVerts[j]);
          if (!existing) {
            const e = engine.createEdge(newVerts[i], newVerts[j]);
            newEdgeIds.push(e.id);
          }
        }
      }
    }

    return { faceIds: newFaceIds, edgeIds: newEdgeIds, vertexIds: newVertexIds };
  }

  /**
   * Build a map of vertex ID to position for efficient lookup.
   */
  private buildVertexPositionMap(
    engine: IGeometryEngine,
    vertexIds: string[],
  ): Map<string, Vec3> {
    const result = new Map<string, Vec3>();
    for (const vid of vertexIds) {
      const v = engine.getVertex(vid);
      if (v) {
        result.set(vid, v.position);
      }
    }
    return result;
  }

  /**
   * Merge vertices from two sets that are within tolerance distance.
   * Returns the number of vertices merged.
   *
   * For each vertex in setB that is close to a vertex in setA,
   * we move the setB vertex to the setA vertex position (welding).
   */
  private mergeNearbyVertices(
    engine: IGeometryEngine,
    setA: string[],
    setB: string[],
    tolerance: number,
  ): number {
    let mergedCount = 0;
    const toleranceSq = tolerance * tolerance;

    for (const vidB of setB) {
      const vB = engine.getVertex(vidB);
      if (!vB) continue;

      for (const vidA of setA) {
        const vA = engine.getVertex(vidA);
        if (!vA) continue;

        if (vec3.distanceSq(vB.position, vA.position) < toleranceSq) {
          // Weld: move B to A's position
          vB.position.x = vA.position.x;
          vB.position.y = vA.position.y;
          vB.position.z = vA.position.z;
          mergedCount++;
          break;
        }
      }
    }

    return mergedCount;
  }

  /**
   * Rotate a point around an axis through a center point using Rodrigues' formula.
   */
  private rotatePointAroundAxis(point: Vec3, center: Vec3, axis: Vec3, angle: number): Vec3 {
    // Translate to origin
    const p = vec3.sub(point, center);

    // Rodrigues' rotation
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const kDotP = vec3.dot(axis, p);
    const kCrossP = vec3.cross(axis, p);

    const rotated = vec3.add(
      vec3.add(vec3.mul(p, cosA), vec3.mul(kCrossP, sinA)),
      vec3.mul(axis, kDotP * (1 - cosA)),
    );

    // Translate back
    return vec3.add(rotated, center);
  }
}
