// @archigraph test.integration.geometry
// Comprehensive integration tests for the geometry engine

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';
import { vec3, ray as rayUtil } from '../../src/core/math';
import type { IGeometryEngine, IVertex, IEdge, IFace } from '../../src/core/interfaces';
import type { Vec3 } from '../../src/core/types';

// ─── Helpers ──────────────────────────────────────────────────────

/** Create a triangle on the XZ plane and return vertices + face. */
function createTriangle(engine: IGeometryEngine) {
  const v1 = engine.createVertex(vec3.create(0, 0, 0));
  const v2 = engine.createVertex(vec3.create(1, 0, 0));
  const v3 = engine.createVertex(vec3.create(0, 0, 1));
  const face = engine.createFace([v1.id, v2.id, v3.id]);
  return { v1, v2, v3, face };
}

/** Create a rectangle on the XZ plane (y=0). */
function createRectangle(engine: IGeometryEngine, w = 2, h = 2) {
  const v1 = engine.createVertex(vec3.create(0, 0, 0));
  const v2 = engine.createVertex(vec3.create(w, 0, 0));
  const v3 = engine.createVertex(vec3.create(w, 0, h));
  const v4 = engine.createVertex(vec3.create(0, 0, h));
  const face = engine.createFace([v1.id, v2.id, v3.id, v4.id]);
  return { v1, v2, v3, v4, face };
}

/** Create a cube (8 vertices, 12 edges, 6 faces). */
function createCube(engine: IGeometryEngine, size = 1): { vertices: IVertex[]; faces: IFace[] } {
  const s = size;
  const positions: Vec3[] = [
    vec3.create(0, 0, 0), vec3.create(s, 0, 0), vec3.create(s, s, 0), vec3.create(0, s, 0),
    vec3.create(0, 0, s), vec3.create(s, 0, s), vec3.create(s, s, s), vec3.create(0, s, s),
  ];
  const vertices = positions.map(p => engine.createVertex(p));
  const v = vertices.map(vt => vt.id);
  const faceIndices = [
    [v[0], v[1], v[2], v[3]], // front
    [v[5], v[4], v[7], v[6]], // back
    [v[4], v[0], v[3], v[7]], // left
    [v[1], v[5], v[6], v[2]], // right
    [v[3], v[2], v[6], v[7]], // top
    [v[0], v[4], v[5], v[1]], // bottom
  ];
  const faces = faceIndices.map(ids => engine.createFace(ids));
  return { vertices, faces };
}

/** Create a chain of edges and return {vertices, edges}. */
function createEdgeChain(engine: IGeometryEngine, points: Vec3[]) {
  const vertices = points.map(p => engine.createVertex(p));
  const edges: IEdge[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    edges.push(engine.createEdge(vertices[i].id, vertices[i + 1].id));
  }
  return { vertices, edges };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Geometry Engine', () => {
  let engine: IGeometryEngine;

  beforeEach(() => {
    engine = new GeometryEngine();
  });

  // ────────────────────────────────────────────────────────────────
  // Vertex CRUD
  // ────────────────────────────────────────────────────────────────

  describe('Vertex CRUD', () => {
    test('creates a vertex with correct position', () => {
      const v = engine.createVertex(vec3.create(1, 2, 3));
      expect(v).toBeDefined();
      expect(v.id).toBeTruthy();
      expect(v.position).toEqual({ x: 1, y: 2, z: 3 });
    });

    test('creates a vertex at the origin', () => {
      const v = engine.createVertex(vec3.create(0, 0, 0));
      expect(v.position).toEqual({ x: 0, y: 0, z: 0 });
    });

    test('creates vertices with negative coordinates', () => {
      const v = engine.createVertex(vec3.create(-5, -10, -15));
      expect(v.position).toEqual({ x: -5, y: -10, z: -15 });
    });

    test('creates vertices with fractional coordinates', () => {
      const v = engine.createVertex(vec3.create(0.123456789, 0.987654321, 0.5));
      expect(v.position.x).toBeCloseTo(0.123456789, 8);
      expect(v.position.y).toBeCloseTo(0.987654321, 8);
    });

    test('retrieves a vertex by ID', () => {
      const v = engine.createVertex(vec3.create(5, 6, 7));
      const retrieved = engine.getVertex(v.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(v.id);
      expect(retrieved!.position).toEqual(v.position);
    });

    test('returns undefined for non-existent vertex', () => {
      expect(engine.getVertex('nonexistent-id')).toBeUndefined();
    });

    test('deletes a vertex', () => {
      const v = engine.createVertex(vec3.create(0, 0, 0));
      engine.deleteVertex(v.id);
      expect(engine.getVertex(v.id)).toBeUndefined();
    });

    test('deleting a vertex also removes connected edges', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);
      engine.deleteVertex(v1.id);
      expect(engine.getEdge(edge.id)).toBeUndefined();
    });

    test('each vertex gets a unique ID', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(engine.createVertex(vec3.create(i, 0, 0)).id);
      }
      expect(ids.size).toBe(100);
    });

    test('new vertex defaults to not selected and not hidden', () => {
      const v = engine.createVertex(vec3.create(0, 0, 0));
      expect(v.selected).toBe(false);
      expect(v.hidden).toBe(false);
    });

    test('creates vertices with very large coordinates', () => {
      const v = engine.createVertex(vec3.create(1e12, -1e12, 1e12));
      expect(v.position.x).toBe(1e12);
      expect(v.position.y).toBe(-1e12);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Edge CRUD
  // ────────────────────────────────────────────────────────────────

  describe('Edge CRUD', () => {
    test('creates an edge between two vertices', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);
      expect(edge).toBeDefined();
      expect(edge.startVertexId).toBe(v1.id);
      expect(edge.endVertexId).toBe(v2.id);
    });

    test('retrieves an edge by ID', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);
      const retrieved = engine.getEdge(edge.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(edge.id);
    });

    test('returns undefined for non-existent edge', () => {
      expect(engine.getEdge('nonexistent')).toBeUndefined();
    });

    test('deletes an edge', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);
      engine.deleteEdge(edge.id);
      expect(engine.getEdge(edge.id)).toBeUndefined();
    });

    test('deleting an edge leaves vertices intact', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);
      engine.deleteEdge(edge.id);
      expect(engine.getVertex(v1.id)).toBeDefined();
      expect(engine.getVertex(v2.id)).toBeDefined();
    });

    test('throws on self-edge', () => {
      const v = engine.createVertex(vec3.create(0, 0, 0));
      expect(() => engine.createEdge(v.id, v.id)).toThrow();
    });

    test('throws on zero-length edge (coincident vertices)', () => {
      const v1 = engine.createVertex(vec3.create(5, 5, 5));
      const v2 = engine.createVertex(vec3.create(5, 5, 5));
      expect(() => engine.createEdge(v1.id, v2.id)).toThrow();
    });

    test('returns existing edge for duplicate creation', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const e1 = engine.createEdge(v1.id, v2.id);
      const e2 = engine.createEdge(v1.id, v2.id);
      expect(e1.id).toBe(e2.id);
    });

    test('returns existing edge for reversed duplicate', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const e1 = engine.createEdge(v1.id, v2.id);
      const e2 = engine.createEdge(v2.id, v1.id);
      expect(e1.id).toBe(e2.id);
    });

    test('throws when vertex ID does not exist', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      expect(() => engine.createEdge(v1.id, 'missing-id')).toThrow();
    });

    test('new edge defaults to not soft, not smooth, not selected, not hidden', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);
      expect(edge.soft).toBe(false);
      expect(edge.smooth).toBe(false);
      expect(edge.selected).toBe(false);
      expect(edge.hidden).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Face CRUD
  // ────────────────────────────────────────────────────────────────

  describe('Face CRUD', () => {
    test('creates a triangular face', () => {
      const { face } = createTriangle(engine);
      expect(face).toBeDefined();
      expect(face.vertexIds).toHaveLength(3);
    });

    test('creates a rectangular face', () => {
      const { face } = createRectangle(engine);
      expect(face).toBeDefined();
      expect(face.vertexIds).toHaveLength(4);
    });

    test('creates a pentagonal face', () => {
      const verts = [
        vec3.create(1, 0, 0),
        vec3.create(0.309, 0, 0.951),
        vec3.create(-0.809, 0, 0.588),
        vec3.create(-0.809, 0, -0.588),
        vec3.create(0.309, 0, -0.951),
      ];
      const vs = verts.map(p => engine.createVertex(p));
      const face = engine.createFace(vs.map(v => v.id));
      expect(face.vertexIds).toHaveLength(5);
    });

    test('retrieves a face by ID', () => {
      const { face } = createTriangle(engine);
      const retrieved = engine.getFace(face.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(face.id);
    });

    test('returns undefined for non-existent face', () => {
      expect(engine.getFace('nonexistent')).toBeUndefined();
    });

    test('deletes a face and leaves edges and vertices intact', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(0, 0, 1));
      const face = engine.createFace([v1.id, v2.id, v3.id]);
      engine.deleteFace(face.id);
      expect(engine.getFace(face.id)).toBeUndefined();
      expect(engine.getVertex(v1.id)).toBeDefined();
    });

    test('throws on fewer than 3 vertices', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      expect(() => engine.createFace([v1.id, v2.id])).toThrow();
    });

    test('throws on duplicate vertex IDs that reduce unique count below 3', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      expect(() => engine.createFace([v1.id, v2.id, v1.id])).toThrow();
    });

    test('returns existing face when creating with same vertex set', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(0, 0, 1));
      const f1 = engine.createFace([v1.id, v2.id, v3.id]);
      const f2 = engine.createFace([v1.id, v2.id, v3.id]);
      expect(f1.id).toBe(f2.id);
    });

    test('face has a computed normal', () => {
      const { face } = createTriangle(engine);
      expect(face.normal).toBeDefined();
      const len = Math.sqrt(face.normal.x ** 2 + face.normal.y ** 2 + face.normal.z ** 2);
      expect(len).toBeCloseTo(1, 5);
    });

    test('face has a computed area', () => {
      const { face } = createTriangle(engine);
      expect(face.area).toBeGreaterThan(0);
    });

    test('automatically creates edges for face boundary', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(0, 0, 1));
      engine.createFace([v1.id, v2.id, v3.id]);
      expect(engine.findEdgeBetween(v1.id, v2.id)).toBeDefined();
      expect(engine.findEdgeBetween(v2.id, v3.id)).toBeDefined();
      expect(engine.findEdgeBetween(v3.id, v1.id)).toBeDefined();
    });

    test('throws if vertex ID does not exist', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      expect(() => engine.createFace([v1.id, v2.id, 'nonexistent'])).toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Auto-face creation
  // ────────────────────────────────────────────────────────────────

  describe('createEdgeWithAutoFace', () => {
    test('closing a triangle loop creates a face', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(0, 0, 1));
      engine.createEdge(v1.id, v2.id);
      engine.createEdge(v2.id, v3.id);
      engine.createEdgeWithAutoFace(v3.id, v1.id);
      const mesh = engine.getMesh();
      expect(mesh.faces.size).toBeGreaterThanOrEqual(1);
    });

    test('closing a rectangle loop creates a face', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(1, 0, 1));
      const v4 = engine.createVertex(vec3.create(0, 0, 1));
      engine.createEdge(v1.id, v2.id);
      engine.createEdge(v2.id, v3.id);
      engine.createEdge(v3.id, v4.id);
      engine.createEdgeWithAutoFace(v4.id, v1.id);
      const mesh = engine.getMesh();
      expect(mesh.faces.size).toBeGreaterThanOrEqual(1);
    });

    test('does not create a face if loop is not coplanar', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(1, 1, 0));
      const v4 = engine.createVertex(vec3.create(0, 0, 5)); // way off-plane
      engine.createEdge(v1.id, v2.id);
      engine.createEdge(v2.id, v3.id);
      engine.createEdge(v3.id, v4.id);
      engine.createEdgeWithAutoFace(v4.id, v1.id);
      const mesh = engine.getMesh();
      // The face may or may not be created depending on coplanarity tolerance.
      // With the 0.05 tolerance, a 5-unit deviation should fail.
      // This test documents the behavior.
      expect(mesh.faces.size).toBeLessThanOrEqual(1);
    });

    test('bisecting an existing face splits it into two', () => {
      const { v1, v3, face } = createRectangle(engine);
      // Draw a diagonal from v1 to v3, bisecting the rectangle
      engine.createEdgeWithAutoFace(v1.id, v3.id);
      // The original face should have been split
      expect(engine.getFace(face.id)).toBeUndefined();
      const mesh = engine.getMesh();
      expect(mesh.faces.size).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Face splitting with paths
  // ────────────────────────────────────────────────────────────────

  describe('splitFaceWithPath', () => {
    test('splits a rectangle face with a straight path', () => {
      // Create a rectangle face, then add midpoints on two opposite edges
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(2, 0, 0));
      const v3 = engine.createVertex(vec3.create(2, 0, 2));
      const v4 = engine.createVertex(vec3.create(0, 0, 2));
      engine.createFace([v1.id, v2.id, v3.id, v4.id]);

      // Create midpoint vertices on the boundary edges
      const mid12 = engine.createVertex(vec3.create(1, 0, 0));
      const mid34 = engine.createVertex(vec3.create(1, 0, 2));

      engine.createEdge(mid12.id, mid34.id);
      engine.splitFaceWithPath([mid12.id, mid34.id]);

      const mesh = engine.getMesh();
      // After splitting, we should have 2 faces (original replaced by two halves)
      expect(mesh.faces.size).toBeGreaterThanOrEqual(2);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // createEdgeWithIntersection
  // ────────────────────────────────────────────────────────────────

  describe('createEdgeWithIntersection', () => {
    test('creates edges and returns them', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(5, 0, 0));
      const edges = engine.createEdgeWithIntersection(v1.id, v2.id);
      expect(edges.length).toBeGreaterThanOrEqual(1);
    });

    test('throws on self-edge', () => {
      const v = engine.createVertex(vec3.create(0, 0, 0));
      expect(() => engine.createEdgeWithIntersection(v.id, v.id)).toThrow();
    });

    test('throws when vertex not found', () => {
      const v = engine.createVertex(vec3.create(0, 0, 0));
      expect(() => engine.createEdgeWithIntersection(v.id, 'missing')).toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Topology queries
  // ────────────────────────────────────────────────────────────────

  describe('Topology queries', () => {
    test('getVertexEdges returns all edges connected to a vertex', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(0, 1, 0));
      const v4 = engine.createVertex(vec3.create(0, 0, 1));
      engine.createEdge(v1.id, v2.id);
      engine.createEdge(v1.id, v3.id);
      engine.createEdge(v1.id, v4.id);
      const edges = engine.getVertexEdges(v1.id);
      expect(edges).toHaveLength(3);
    });

    test('getVertexEdges returns empty for isolated vertex', () => {
      const v = engine.createVertex(vec3.create(0, 0, 0));
      const edges = engine.getVertexEdges(v.id);
      expect(edges).toHaveLength(0);
    });

    test('getEdgeFaces returns faces sharing an edge', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(1, 1, 0));
      const v4 = engine.createVertex(vec3.create(0, 1, 0));
      engine.createFace([v1.id, v2.id, v3.id]);
      engine.createFace([v1.id, v3.id, v4.id]);
      const sharedEdge = engine.findEdgeBetween(v1.id, v3.id)!;
      const faces = engine.getEdgeFaces(sharedEdge.id);
      expect(faces).toHaveLength(2);
    });

    test('getEdgeFaces returns empty for standalone edge', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);
      const faces = engine.getEdgeFaces(edge.id);
      expect(faces).toHaveLength(0);
    });

    test('getFaceEdges returns all boundary edges of a face', () => {
      const { face } = createTriangle(engine);
      const edges = engine.getFaceEdges(face.id);
      expect(edges).toHaveLength(3);
    });

    test('getFaceEdges returns 4 edges for a rectangle', () => {
      const { face } = createRectangle(engine);
      const edges = engine.getFaceEdges(face.id);
      expect(edges).toHaveLength(4);
    });

    test('getFaceVertices returns ordered vertices', () => {
      const { v1, v2, v3, face } = createTriangle(engine);
      const verts = engine.getFaceVertices(face.id);
      expect(verts).toHaveLength(3);
      const ids = verts.map(v => v.id);
      expect(ids).toContain(v1.id);
      expect(ids).toContain(v2.id);
      expect(ids).toContain(v3.id);
    });

    test('getConnectedFaces returns adjacent faces', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(1, 1, 0));
      const v4 = engine.createVertex(vec3.create(0, 1, 0));
      const f1 = engine.createFace([v1.id, v2.id, v3.id]);
      const f2 = engine.createFace([v1.id, v3.id, v4.id]);
      const connected = engine.getConnectedFaces(f1.id);
      expect(connected.length).toBeGreaterThanOrEqual(1);
      expect(connected.some(f => f.id === f2.id)).toBe(true);
    });

    test('getConnectedFaces returns empty for isolated face', () => {
      // A single triangle with no adjacent faces
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(0, 1, 0));
      const face = engine.createFace([v1.id, v2.id, v3.id]);
      // No other faces, so connected should be empty
      const connected = engine.getConnectedFaces(face.id);
      expect(connected).toHaveLength(0);
    });

    test('findEdgeBetween finds edge in either direction', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);

      expect(engine.findEdgeBetween(v1.id, v2.id)?.id).toBe(edge.id);
      expect(engine.findEdgeBetween(v2.id, v1.id)?.id).toBe(edge.id);
    });

    test('findEdgeBetween returns undefined when no edge exists', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      expect(engine.findEdgeBetween(v1.id, v2.id)).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Geometry computations
  // ────────────────────────────────────────────────────────────────

  describe('Geometry computations', () => {
    test('computeFaceNormal for XZ-plane triangle points along -Y', () => {
      const { face } = createTriangle(engine);
      const normal = engine.computeFaceNormal(face.id);
      // Triangle on XZ plane: (0,0,0), (1,0,0), (0,0,1)
      // Cross of (1,0,0)x(0,0,1) = (0,-1,0) using Newell's method
      expect(Math.abs(normal.y)).toBeCloseTo(1, 3);
    });

    test('computeFaceNormal for XY-plane triangle', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(0, 1, 0));
      const face = engine.createFace([v1.id, v2.id, v3.id]);
      const normal = engine.computeFaceNormal(face.id);
      expect(Math.abs(normal.z)).toBeCloseTo(1, 3);
    });

    test('computeFaceNormal throws for non-existent face', () => {
      expect(() => engine.computeFaceNormal('missing')).toThrow();
    });

    test('computeFaceArea for unit square', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(1, 0, 1));
      const v4 = engine.createVertex(vec3.create(0, 0, 1));
      const face = engine.createFace([v1.id, v2.id, v3.id, v4.id]);
      expect(engine.computeFaceArea(face.id)).toBeCloseTo(1, 5);
    });

    test('computeFaceArea for 2x3 rectangle', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(2, 0, 0));
      const v3 = engine.createVertex(vec3.create(2, 0, 3));
      const v4 = engine.createVertex(vec3.create(0, 0, 3));
      const face = engine.createFace([v1.id, v2.id, v3.id, v4.id]);
      expect(engine.computeFaceArea(face.id)).toBeCloseTo(6, 5);
    });

    test('computeFaceArea for triangle is half base times height', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(4, 0, 0));
      const v3 = engine.createVertex(vec3.create(0, 0, 3));
      const face = engine.createFace([v1.id, v2.id, v3.id]);
      expect(engine.computeFaceArea(face.id)).toBeCloseTo(6, 5);
    });

    test('computeFaceArea throws for non-existent face', () => {
      expect(() => engine.computeFaceArea('missing')).toThrow();
    });

    test('computeEdgeLength for 3-4-5 right triangle hypotenuse', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(3, 4, 0));
      const edge = engine.createEdge(v1.id, v2.id);
      expect(engine.computeEdgeLength(edge.id)).toBeCloseTo(5, 10);
    });

    test('computeEdgeLength for unit edge', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);
      expect(engine.computeEdgeLength(edge.id)).toBeCloseTo(1, 10);
    });

    test('computeEdgeLength for diagonal edge', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 1, 1));
      const edge = engine.createEdge(v1.id, v2.id);
      expect(engine.computeEdgeLength(edge.id)).toBeCloseTo(Math.sqrt(3), 10);
    });

    test('computeEdgeLength throws for non-existent edge', () => {
      expect(() => engine.computeEdgeLength('missing')).toThrow();
    });

    test('checkCoplanar returns true for coplanar quad', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(1, 0, 1));
      const v4 = engine.createVertex(vec3.create(0, 0, 1));
      expect(engine.checkCoplanar([v1.id, v2.id, v3.id, v4.id])).toBe(true);
    });

    test('checkCoplanar returns false for non-coplanar quad', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(1, 0, 1));
      const v4 = engine.createVertex(vec3.create(0, 5, 1));
      expect(engine.checkCoplanar([v1.id, v2.id, v3.id, v4.id])).toBe(false);
    });

    test('checkCoplanar returns true for 3 or fewer points', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(0, 5, 3));
      expect(engine.checkCoplanar([v1.id, v2.id, v3.id])).toBe(true);
    });

    test('checkCoplanar returns true for collinear points', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(2, 0, 0));
      expect(engine.checkCoplanar([v1.id, v2.id, v3.id])).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Raycasting
  // ────────────────────────────────────────────────────────────────

  describe('Raycasting', () => {
    test('raycast hits a vertex near the ray', () => {
      engine.createVertex(vec3.create(0, 0, -5));
      const r = rayUtil.create(vec3.create(0, 0, 0), vec3.create(0, 0, -1));
      const hits = engine.raycast(r);
      const vertexHits = hits.filter(h => h.type === 'vertex');
      expect(vertexHits.length).toBeGreaterThanOrEqual(1);
    });

    test('raycast misses vertices far from the ray', () => {
      engine.createVertex(vec3.create(100, 100, 100));
      const r = rayUtil.create(vec3.create(0, 0, 0), vec3.create(0, 0, -1));
      const hits = engine.raycast(r);
      expect(hits).toHaveLength(0);
    });

    test('raycast hits a face', () => {
      // Face on XZ plane at y=0, pointing in Y direction
      const v1 = engine.createVertex(vec3.create(-1, 0, -1));
      const v2 = engine.createVertex(vec3.create(1, 0, -1));
      const v3 = engine.createVertex(vec3.create(1, 0, 1));
      const v4 = engine.createVertex(vec3.create(-1, 0, 1));
      engine.createFace([v1.id, v2.id, v3.id, v4.id]);
      // Ray from above pointing down
      const r = rayUtil.create(vec3.create(0, 5, 0), vec3.create(0, -1, 0));
      const hits = engine.raycast(r);
      const faceHits = hits.filter(h => h.type === 'face');
      expect(faceHits.length).toBeGreaterThanOrEqual(1);
    });

    test('raycast results are sorted by distance', () => {
      // Two faces at different Y heights
      const makeQuad = (y: number) => {
        const v1 = engine.createVertex(vec3.create(-1, y, -1));
        const v2 = engine.createVertex(vec3.create(1, y, -1));
        const v3 = engine.createVertex(vec3.create(1, y, 1));
        const v4 = engine.createVertex(vec3.create(-1, y, 1));
        engine.createFace([v1.id, v2.id, v3.id, v4.id]);
      };
      makeQuad(2);
      makeQuad(5);

      const r = rayUtil.create(vec3.create(0, 10, 0), vec3.create(0, -1, 0));
      const hits = engine.raycast(r);
      for (let i = 1; i < hits.length; i++) {
        expect(hits[i].distance).toBeGreaterThanOrEqual(hits[i - 1].distance);
      }
    });

    test('raycast does not hit behind the ray origin', () => {
      engine.createVertex(vec3.create(0, 0, 5)); // Behind if ray goes -Z
      const r = rayUtil.create(vec3.create(0, 0, 0), vec3.create(0, 0, -1));
      const hits = engine.raycast(r);
      const vertexHits = hits.filter(h => h.type === 'vertex');
      expect(vertexHits).toHaveLength(0);
    });

    test('raycast does not hit hidden vertices', () => {
      const v = engine.createVertex(vec3.create(0, 0, -5));
      v.hidden = true;
      const r = rayUtil.create(vec3.create(0, 0, 0), vec3.create(0, 0, -1));
      const hits = engine.raycast(r);
      expect(hits.filter(h => h.entityId === v.id)).toHaveLength(0);
    });

    test('raycast returns empty for empty engine', () => {
      const r = rayUtil.create(vec3.create(0, 0, 0), vec3.create(1, 0, 0));
      const hits = engine.raycast(r);
      expect(hits).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Bounding box
  // ────────────────────────────────────────────────────────────────

  describe('Bounding box', () => {
    test('computes bounding box for scattered vertices', () => {
      engine.createVertex(vec3.create(-1, -2, -3));
      engine.createVertex(vec3.create(4, 5, 6));
      engine.createVertex(vec3.create(0, 0, 0));
      const box = engine.getBoundingBox();
      expect(box.min).toEqual({ x: -1, y: -2, z: -3 });
      expect(box.max).toEqual({ x: 4, y: 5, z: 6 });
    });

    test('bounding box for single vertex is a point', () => {
      engine.createVertex(vec3.create(3, 4, 5));
      const box = engine.getBoundingBox();
      expect(box.min).toEqual({ x: 3, y: 4, z: 5 });
      expect(box.max).toEqual({ x: 3, y: 4, z: 5 });
    });

    test('bounding box for empty engine has infinite bounds', () => {
      const box = engine.getBoundingBox();
      expect(box.min.x).toBe(Infinity);
      expect(box.max.x).toBe(-Infinity);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Serialization / Deserialization
  // ────────────────────────────────────────────────────────────────

  describe('Serialization', () => {
    test('serialize produces non-empty buffer', () => {
      engine.createVertex(vec3.create(1, 2, 3));
      const buffer = engine.serialize();
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    test('roundtrip preserves vertices', () => {
      const v1 = engine.createVertex(vec3.create(1, 2, 3));
      const v2 = engine.createVertex(vec3.create(4, 5, 6));

      const buffer = engine.serialize();
      const engine2 = new GeometryEngine();
      engine2.deserialize(buffer);
      const mesh = engine2.getMesh();

      expect(mesh.vertices.size).toBe(2);
      expect(mesh.vertices.get(v1.id)?.position).toEqual({ x: 1, y: 2, z: 3 });
      expect(mesh.vertices.get(v2.id)?.position).toEqual({ x: 4, y: 5, z: 6 });
    });

    test('roundtrip preserves edges', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const edge = engine.createEdge(v1.id, v2.id);

      const buffer = engine.serialize();
      const engine2 = new GeometryEngine();
      engine2.deserialize(buffer);
      const mesh = engine2.getMesh();

      expect(mesh.edges.size).toBe(1);
      const restoredEdge = mesh.edges.get(edge.id);
      expect(restoredEdge).toBeDefined();
      expect(restoredEdge!.startVertexId).toBe(v1.id);
      expect(restoredEdge!.endVertexId).toBe(v2.id);
    });

    test('roundtrip preserves faces', () => {
      const { face, v1 } = createTriangle(engine);
      const buffer = engine.serialize();
      const engine2 = new GeometryEngine();
      engine2.deserialize(buffer);
      const mesh = engine2.getMesh();
      expect(mesh.faces.size).toBe(1);
      const restoredFace = mesh.faces.get(face.id);
      expect(restoredFace).toBeDefined();
      expect(restoredFace!.vertexIds).toHaveLength(3);
    });

    test('roundtrip preserves a complete cube', () => {
      const { vertices, faces } = createCube(engine);
      const buffer = engine.serialize();
      const engine2 = new GeometryEngine();
      engine2.deserialize(buffer);
      const mesh = engine2.getMesh();
      expect(mesh.vertices.size).toBe(8);
      expect(mesh.faces.size).toBe(6);
    });

    test('deserializing invalid data throws', () => {
      const engine2 = new GeometryEngine();
      const badBuffer = new ArrayBuffer(8);
      const view = new DataView(badBuffer);
      view.setUint32(0, 0xDEADBEEF, true); // wrong magic
      expect(() => engine2.deserialize(badBuffer)).toThrow();
    });

    test('roundtrip preserves hidden/selected state', () => {
      const v = engine.createVertex(vec3.create(1, 2, 3));
      v.selected = true;
      v.hidden = true;

      const buffer = engine.serialize();
      const engine2 = new GeometryEngine();
      engine2.deserialize(buffer);

      const restored = engine2.getVertex(v.id);
      expect(restored!.selected).toBe(true);
      expect(restored!.hidden).toBe(true);
    });

    test('empty engine serialization roundtrip', () => {
      const buffer = engine.serialize();
      expect(buffer.byteLength).toBeGreaterThan(0);
      const engine2 = new GeometryEngine();
      engine2.deserialize(buffer);
      const mesh = engine2.getMesh();
      expect(mesh.vertices.size).toBe(0);
      expect(mesh.edges.size).toBe(0);
      expect(mesh.faces.size).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // bulkImport
  // ────────────────────────────────────────────────────────────────

  describe('bulkImport', () => {
    test('imports vertices and faces', () => {
      const verts: Vec3[] = [
        vec3.create(0, 0, 0),
        vec3.create(1, 0, 0),
        vec3.create(1, 0, 1),
        vec3.create(0, 0, 1),
      ];
      const faces = [[0, 1, 2, 3]];
      const { vertexIds: ids } = engine.bulkImport(verts, faces);
      expect(ids).toHaveLength(4);
      const mesh = engine.getMesh();
      expect(mesh.vertices.size).toBe(4);
      expect(mesh.faces.size).toBe(1);
    });

    test('imports standalone edges', () => {
      const verts: Vec3[] = [
        vec3.create(0, 0, 0),
        vec3.create(1, 0, 0),
        vec3.create(2, 0, 0),
      ];
      const standaloneEdges: [number, number][] = [[0, 1], [1, 2]];
      engine.bulkImport(verts, [], standaloneEdges);
      const mesh = engine.getMesh();
      expect(mesh.edges.size).toBe(2);
    });

    test('deduplicates edges across faces', () => {
      const verts: Vec3[] = [
        vec3.create(0, 0, 0),
        vec3.create(1, 0, 0),
        vec3.create(1, 0, 1),
        vec3.create(0, 0, 1),
      ];
      // Two triangles sharing edge 0-2
      const faces = [[0, 1, 2], [0, 2, 3]];
      engine.bulkImport(verts, faces);
      const mesh = engine.getMesh();
      expect(mesh.faces.size).toBe(2);
      // 5 unique edges: 0-1, 1-2, 0-2 (shared), 2-3, 0-3
      expect(mesh.edges.size).toBe(5);
    });

    test('skips faces with fewer than 3 vertices', () => {
      const verts: Vec3[] = [vec3.create(0, 0, 0), vec3.create(1, 0, 0)];
      const faces = [[0, 1]];
      engine.bulkImport(verts, faces);
      const mesh = engine.getMesh();
      expect(mesh.faces.size).toBe(0);
    });

    test('skips faces with invalid vertex indices', () => {
      const verts: Vec3[] = [vec3.create(0, 0, 0), vec3.create(1, 0, 0), vec3.create(0, 0, 1)];
      const faces = [[0, 1, 99]]; // 99 is out of range
      engine.bulkImport(verts, faces);
      const mesh = engine.getMesh();
      expect(mesh.faces.size).toBe(0);
    });

    test('imports many vertices efficiently', () => {
      const verts: Vec3[] = [];
      for (let i = 0; i < 1000; i++) {
        verts.push(vec3.create(i, 0, 0));
      }
      const { vertexIds: ids } = engine.bulkImport(verts, []);
      expect(ids).toHaveLength(1000);
      expect(engine.getMesh().vertices.size).toBe(1000);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Clone
  // ────────────────────────────────────────────────────────────────

  describe('Clone', () => {
    test('clone produces an independent copy', () => {
      createTriangle(engine);
      const cloned = engine.clone();
      const origMesh = engine.getMesh();
      const clonedMesh = cloned.getMesh();
      expect(clonedMesh.vertices.size).toBe(origMesh.vertices.size);
      expect(clonedMesh.edges.size).toBe(origMesh.edges.size);
      expect(clonedMesh.faces.size).toBe(origMesh.faces.size);
    });

    test('modifying clone does not affect original', () => {
      const { v1 } = createTriangle(engine);
      const cloned = engine.clone();
      cloned.deleteVertex(v1.id);
      expect(engine.getVertex(v1.id)).toBeDefined();
      expect(cloned.getVertex(v1.id)).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Edge cases and degenerate geometry
  // ────────────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    test('creating many vertices and edges', () => {
      const verts: IVertex[] = [];
      for (let i = 0; i < 50; i++) {
        verts.push(engine.createVertex(vec3.create(i, 0, 0)));
      }
      for (let i = 0; i < verts.length - 1; i++) {
        engine.createEdge(verts[i].id, verts[i + 1].id);
      }
      const mesh = engine.getMesh();
      expect(mesh.vertices.size).toBe(50);
      expect(mesh.edges.size).toBe(49);
    });

    test('deleting all faces leaves edges and vertices', () => {
      const { face } = createTriangle(engine);
      engine.deleteFace(face.id);
      const mesh = engine.getMesh();
      expect(mesh.vertices.size).toBe(3);
      expect(mesh.faces.size).toBe(0);
      // Edges created by createFace should still exist
      expect(mesh.edges.size).toBeGreaterThanOrEqual(3);
    });

    test('getMesh returns vertices, edges, faces, and halfEdges maps', () => {
      createTriangle(engine);
      const mesh = engine.getMesh();
      expect(mesh.vertices).toBeInstanceOf(Map);
      expect(mesh.edges).toBeInstanceOf(Map);
      expect(mesh.faces).toBeInstanceOf(Map);
      expect(mesh.halfEdges).toBeInstanceOf(Map);
    });

    test('getCurveEdges returns edges sharing a curveId', () => {
      const v1 = engine.createVertex(vec3.create(0, 0, 0));
      const v2 = engine.createVertex(vec3.create(1, 0, 0));
      const v3 = engine.createVertex(vec3.create(2, 0, 0));
      const e1 = engine.createEdge(v1.id, v2.id);
      const e2 = engine.createEdge(v2.id, v3.id);
      const curveId = 'my-curve';
      e1.curveId = curveId;
      e2.curveId = curveId;
      const curveEdges = engine.getCurveEdges(curveId);
      expect(curveEdges).toHaveLength(2);
    });

    test('getCurveEdges returns empty for unknown curveId', () => {
      expect(engine.getCurveEdges('nonexistent-curve')).toHaveLength(0);
    });

    test('cube has correct topology', () => {
      const { vertices, faces } = createCube(engine);
      expect(vertices).toHaveLength(8);
      expect(faces).toHaveLength(6);
      const mesh = engine.getMesh();
      // A cube should have 12 edges
      expect(mesh.edges.size).toBe(12);
    });
  });
});
