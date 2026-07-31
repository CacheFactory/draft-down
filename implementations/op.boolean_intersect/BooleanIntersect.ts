// @archigraph op.boolean.intersect
// CSG Intersection operation for DraftDown — delegates to Manifold WASM

import { IGeometryEngine } from '../../src/core/interfaces';
import {
  MeshRegion,
  BooleanResult,
  getSharedManifoldBridge,
  regionToManifoldMesh,
  applyManifoldResult,
} from '../op.boolean_union/BooleanUnion';

export interface BooleanIntersectParams {
  regionA: MeshRegion;
  regionB: MeshRegion;
}

/**
 * CSG Intersect: keeps only the overlapping volume of A and B using Manifold WASM.
 *
 * Manifold handles exact intersection, re-triangulation, and stitching
 * for robust results even with coplanar faces and degenerate cases.
 */
export class BooleanIntersect {
  // @archigraph calls|op.boolean.intersect|native.manifold|runtime
  async execute(engine: IGeometryEngine, params: BooleanIntersectParams): Promise<BooleanResult> {
    const { regionA, regionB } = params;

    try {
      const bridge = getSharedManifoldBridge();
      await bridge.initialize();

      const meshA = regionToManifoldMesh(engine, regionA);
      const meshB = regionToManifoldMesh(engine, regionB);

      if (meshA.faces.length === 0 || meshB.faces.length === 0) {
        return {
          success: false,
          newFaceIds: [],
          newEdgeIds: [],
          newVertexIds: [],
          removedFaceIds: [],
          error: 'Boolean intersect requires two non-empty mesh regions',
        };
      }

      const resultMesh = await bridge.intersect(meshA, meshB);
      const result = applyManifoldResult(engine, regionA, regionB, resultMesh);

      return {
        success: true,
        ...result,
      };
    } catch (err) {
      return {
        success: false,
        newFaceIds: [],
        newEdgeIds: [],
        newVertexIds: [],
        removedFaceIds: [],
        error: `Boolean intersect failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
