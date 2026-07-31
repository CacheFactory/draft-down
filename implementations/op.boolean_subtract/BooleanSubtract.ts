// @archigraph op.boolean.subtract
// CSG Subtraction operation for DraftDown — delegates to Manifold WASM

import { IGeometryEngine } from '../../src/core/interfaces';
import {
  MeshRegion,
  BooleanResult,
  getSharedManifoldBridge,
  regionToManifoldMesh,
  applyManifoldResult,
} from '../op.boolean_union/BooleanUnion';

export interface BooleanSubtractParams {
  /** The mesh to subtract from */
  regionA: MeshRegion;
  /** The mesh to subtract */
  regionB: MeshRegion;
}

/**
 * CSG Subtract: removes the volume of B from A using Manifold WASM.
 *
 * Manifold handles exact intersection, re-triangulation, and stitching
 * for robust results even with coplanar faces and degenerate cases.
 */
export class BooleanSubtract {
  // @archigraph calls|op.boolean.subtract|native.manifold|runtime
  async execute(engine: IGeometryEngine, params: BooleanSubtractParams): Promise<BooleanResult> {
    const { regionA, regionB } = params;

    try {
      const bridge = getSharedManifoldBridge();
      await bridge.initialize();

      const meshA = regionToManifoldMesh(engine, regionA);
      const meshB = regionToManifoldMesh(engine, regionB);

      if (meshA.faces.length === 0) {
        return {
          success: false,
          newFaceIds: [],
          newEdgeIds: [],
          newVertexIds: [],
          removedFaceIds: [],
          error: 'Boolean subtract requires a non-empty target mesh (region A)',
        };
      }

      if (meshB.faces.length === 0) {
        // Nothing to subtract — return A unchanged
        return {
          success: true,
          newFaceIds: [...regionA.faceIds],
          newEdgeIds: [...regionA.edgeIds],
          newVertexIds: [...regionA.vertexIds],
          removedFaceIds: [],
        };
      }

      const resultMesh = await bridge.subtract(meshA, meshB);
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
        error: `Boolean subtract failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
