// @archigraph op.manifold-check
// Manifold solid validation for DraftDown

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IFace, IEdge, IVertex, IMesh } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export interface ManifoldCheckParams {
  /** Optional: check only these face IDs. Empty = check entire mesh. */
  faceIds?: string[];
}

export enum ManifoldIssueType {
  NonManifoldEdge = 'non-manifold-edge',
  BoundaryEdge = 'boundary-edge',
  InconsistentNormal = 'inconsistent-normal',
  DegenerateFace = 'degenerate-face',
  IsolatedVertex = 'isolated-vertex',
  SelfIntersection = 'self-intersection',
  DuplicateVertex = 'duplicate-vertex',
}

export interface ManifoldIssue {
  type: ManifoldIssueType;
  entityId: string;         // the problematic entity (edge, face, or vertex ID)
  description: string;
  severity: 'error' | 'warning';
  relatedIds?: string[];    // other related entity IDs
}

export interface ManifoldCheckResult {
  isManifold: boolean;
  isClosed: boolean;
  isOrientable: boolean;
  issues: ManifoldIssue[];
  stats: {
    vertexCount: number;
    edgeCount: number;
    faceCount: number;
    boundaryEdges: number;
    nonManifoldEdges: number;
    eulerCharacteristic: number; // V - E + F (should be 2 for a closed manifold sphere topology)
    genus: number;               // (2 - euler) / 2 for closed manifold
  };
}

/**
 * SolidManifold: validates that a mesh is a proper manifold solid.
 *
 * Checks:
 * 1. Every edge is shared by exactly 2 faces (manifold condition).
 * 2. The mesh is closed (no boundary edges).
 * 3. Face normals are consistently oriented (orientability).
 * 4. No degenerate faces (zero area).
 * 5. No isolated vertices.
 * 6. No duplicate vertices at the same position.
 */
export class SolidManifold {
  execute(engine: IGeometryEngine, params: ManifoldCheckParams = {}): ManifoldCheckResult {
    const mesh = engine.getMesh();
    const issues: ManifoldIssue[] = [];

    let boundaryEdges = 0;
    let nonManifoldEdges = 0;

    const relevantFaceIds = params.faceIds && params.faceIds.length > 0
      ? new Set(params.faceIds)
      : new Set(mesh.faces.keys());

    // -- Check 1: Edge manifold condition --
    // Each edge should have exactly 2 adjacent faces
    for (const [edgeId, edge] of mesh.edges) {
      const adjFaces = engine.getEdgeFaces(edgeId);
      // Filter to relevant faces if a subset was specified
      const relevantAdjFaces = adjFaces.filter(f => relevantFaceIds.has(f.id));

      if (relevantAdjFaces.length === 0) continue; // Edge not part of checked region

      if (relevantAdjFaces.length === 1) {
        boundaryEdges++;
        issues.push({
          type: ManifoldIssueType.BoundaryEdge,
          entityId: edgeId,
          description: `Edge ${edgeId} is a boundary edge (only 1 adjacent face)`,
          severity: 'error',
          relatedIds: relevantAdjFaces.map(f => f.id),
        });
      } else if (relevantAdjFaces.length > 2) {
        nonManifoldEdges++;
        issues.push({
          type: ManifoldIssueType.NonManifoldEdge,
          entityId: edgeId,
          description: `Edge ${edgeId} has ${relevantAdjFaces.length} adjacent faces (non-manifold)`,
          severity: 'error',
          relatedIds: relevantAdjFaces.map(f => f.id),
        });
      }
    }

    // -- Check 2: Consistent normals (orientability) --
    // For each edge shared by exactly 2 faces, the edge should be traversed
    // in opposite directions by the two faces.
    for (const [edgeId, edge] of mesh.edges) {
      const adjFaces = engine.getEdgeFaces(edgeId).filter(f => relevantFaceIds.has(f.id));
      if (adjFaces.length !== 2) continue;

      const windingA = this.getEdgeWinding(adjFaces[0], edge.startVertexId, edge.endVertexId);
      const windingB = this.getEdgeWinding(adjFaces[1], edge.startVertexId, edge.endVertexId);

      // For consistent orientation, the edge should be traversed in opposite directions
      if (windingA === windingB) {
        issues.push({
          type: ManifoldIssueType.InconsistentNormal,
          entityId: edgeId,
          description: `Faces ${adjFaces[0].id} and ${adjFaces[1].id} have inconsistent normal orientation at edge ${edgeId}`,
          severity: 'error',
          relatedIds: [adjFaces[0].id, adjFaces[1].id],
        });
      }
    }

    // -- Check 3: Degenerate faces --
    for (const faceId of relevantFaceIds) {
      const area = engine.computeFaceArea(faceId);
      if (area < EPSILON) {
        issues.push({
          type: ManifoldIssueType.DegenerateFace,
          entityId: faceId,
          description: `Face ${faceId} has near-zero area (${area.toFixed(10)})`,
          severity: 'warning',
        });
      }

      const face = engine.getFace(faceId);
      if (face && face.vertexIds.length < 3) {
        issues.push({
          type: ManifoldIssueType.DegenerateFace,
          entityId: faceId,
          description: `Face ${faceId} has fewer than 3 vertices`,
          severity: 'error',
        });
      }
    }

    // -- Check 4: Isolated vertices --
    for (const [vertexId] of mesh.vertices) {
      const edges = engine.getVertexEdges(vertexId);
      if (edges.length === 0) {
        issues.push({
          type: ManifoldIssueType.IsolatedVertex,
          entityId: vertexId,
          description: `Vertex ${vertexId} has no edges (isolated)`,
          severity: 'warning',
        });
      }
    }

    // -- Check 5: Duplicate vertices --
    const vertexList = Array.from(mesh.vertices.values());
    for (let i = 0; i < vertexList.length; i++) {
      for (let j = i + 1; j < vertexList.length; j++) {
        if (vec3.equals(vertexList[i].position, vertexList[j].position)) {
          issues.push({
            type: ManifoldIssueType.DuplicateVertex,
            entityId: vertexList[i].id,
            description: `Vertices ${vertexList[i].id} and ${vertexList[j].id} are at the same position`,
            severity: 'warning',
            relatedIds: [vertexList[j].id],
          });
        }
      }
    }

    // Compute Euler characteristic: V - E + F
    const V = mesh.vertices.size;
    const E = mesh.edges.size;
    const F = relevantFaceIds.size;
    const euler = V - E + F;
    const genus = (2 - euler) / 2;

    const isClosed = boundaryEdges === 0;
    const isOrientable = issues.filter(i => i.type === ManifoldIssueType.InconsistentNormal).length === 0;
    const isManifold = isClosed && isOrientable && nonManifoldEdges === 0;

    return {
      isManifold,
      isClosed,
      isOrientable,
      issues,
      stats: {
        vertexCount: V,
        edgeCount: E,
        faceCount: F,
        boundaryEdges,
        nonManifoldEdges,
        eulerCharacteristic: euler,
        genus: Math.max(0, genus),
      },
    };
  }

  /**
   * Determine the winding direction of an edge within a face.
   * Returns 1 if the edge goes startVertex -> endVertex in the face's vertex order,
   * -1 if it goes endVertex -> startVertex, 0 if not found.
   */
  private getEdgeWinding(face: IFace, startVertexId: string, endVertexId: string): number {
    const vids = face.vertexIds;
    const n = vids.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (vids[i] === startVertexId && vids[j] === endVertexId) return 1;
      if (vids[i] === endVertexId && vids[j] === startVertexId) return -1;
    }

    return 0;
  }
}
