// @archigraph op.boolean.union
// CSG Union operation for DraftDown — delegates to Manifold WASM

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IVertex } from '../../src/core/interfaces';
import { ManifoldBridge, ManifoldMesh } from '../native.manifold/ManifoldBridge';

export interface MeshRegion {
  faceIds: string[];
  vertexIds: string[];
  edgeIds: string[];
}

export interface BooleanUnionParams {
  regionA: MeshRegion;
  regionB: MeshRegion;
}

export interface BooleanResult {
  success: boolean;
  newFaceIds: string[];
  newEdgeIds: string[];
  newVertexIds: string[];
  removedFaceIds: string[];
  error?: string;
}

// Shared singleton bridge instance for all boolean operations
let sharedBridge: ManifoldBridge | null = null;

/** Get or create the shared ManifoldBridge instance. */
export function getSharedManifoldBridge(): ManifoldBridge {
  if (!sharedBridge) {
    sharedBridge = new ManifoldBridge();
  }
  return sharedBridge;
}

/**
 * Extract a ManifoldMesh (vertices + triangulated faces) from a geometry engine
 * region defined by face IDs. Builds a compact vertex list and remaps indices.
 */
export function regionToManifoldMesh(
  engine: IGeometryEngine,
  region: MeshRegion,
): ManifoldMesh {
  const vertexIndexMap = new Map<string, number>();
  const vertices: Vec3[] = [];
  const faces: number[][] = [];

  // Build compact vertex list from face vertices
  for (const faceId of region.faceIds) {
    const faceVerts = engine.getFaceVertices(faceId);
    for (const v of faceVerts) {
      if (!vertexIndexMap.has(v.id)) {
        vertexIndexMap.set(v.id, vertices.length);
        vertices.push({ x: v.position.x, y: v.position.y, z: v.position.z });
      }
    }
  }

  // Build triangulated face list
  for (const faceId of region.faceIds) {
    const faceVerts = engine.getFaceVertices(faceId);
    if (faceVerts.length < 3) continue;

    // Fan-triangulate from vertex 0
    for (let i = 1; i < faceVerts.length - 1; i++) {
      faces.push([
        vertexIndexMap.get(faceVerts[0].id)!,
        vertexIndexMap.get(faceVerts[i].id)!,
        vertexIndexMap.get(faceVerts[i + 1].id)!,
      ]);
    }
  }

  return { vertices, faces };
}

/**
 * Apply a ManifoldMesh result back into the geometry engine:
 * 1. Delete all original faces/edges/vertices from both regions.
 * 2. Bulk-import the result mesh.
 * Returns the IDs of the newly created entities.
 */
export function applyManifoldResult(
  engine: IGeometryEngine,
  regionA: MeshRegion,
  regionB: MeshRegion,
  resultMesh: ManifoldMesh,
): { newFaceIds: string[]; newEdgeIds: string[]; newVertexIds: string[]; removedFaceIds: string[] } {
  const removedFaceIds: string[] = [];

  // Delete original faces (edges/vertices cleaned up by engine)
  const allFaceIds = new Set([...regionA.faceIds, ...regionB.faceIds]);
  for (const faceId of allFaceIds) {
    if (engine.getFace(faceId)) {
      engine.deleteFace(faceId);
      removedFaceIds.push(faceId);
    }
  }

  // Bulk-import the result mesh
  const rawVerts = resultMesh.vertices;
  const rawFaces = resultMesh.faces;
  const { vertexIds: newVertexIds, faceIds: newFaceIds } = engine.bulkImport(rawVerts, rawFaces);

  // Collect edge IDs from the new faces
  const newEdgeIds: string[] = [];
  const seenEdges = new Set<string>();
  for (const faceId of newFaceIds) {
    const faceEdges = engine.getFaceEdges(faceId);
    for (const edge of faceEdges) {
      if (!seenEdges.has(edge.id)) {
        seenEdges.add(edge.id);
        newEdgeIds.push(edge.id);
      }
    }
  }

  return { newFaceIds, newEdgeIds, newVertexIds, removedFaceIds };
}

/**
 * CSG Union: merges two mesh regions using Manifold WASM.
 *
 * Delegates to ManifoldBridge for robust boolean computation including:
 * - Exact intersection curve computation
 * - Face re-triangulation at intersection boundaries
 * - Proper stitching of boundary loops
 * - Robust handling of coplanar faces and degenerate cases
 */
export class BooleanUnion {
  // @archigraph calls|op.boolean.union|native.manifold|runtime
  async execute(engine: IGeometryEngine, params: BooleanUnionParams): Promise<BooleanResult> {
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
          error: 'Boolean union requires two non-empty mesh regions',
        };
      }

      const resultMesh = await bridge.union(meshA, meshB);
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
        error: `Boolean union failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
