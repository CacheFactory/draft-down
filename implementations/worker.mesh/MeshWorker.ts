// @archigraph worker.mesh
// Web Worker for heavy mesh operations (triangulation, subdivision, booleans)
// Runs in a separate thread to keep the UI responsive.
// @archigraph calls|worker.mesh|native.manifold|runtime

import { Vec3 } from '../../src/core/types';
import { ManifoldBridge } from '../native.manifold/ManifoldBridge';

// ─── Message Types ──────────────────────────────────────────────

export interface TriangulateRequest {
  type: 'triangulate';
  data: {
    vertices: Vec3[];
    faces: number[][]; // each face is an array of vertex indices
  };
}

export interface SubdivideRequest {
  type: 'subdivide';
  data: {
    vertices: Vec3[];
    faces: number[][];
    iterations: number;
    method: 'catmull-clark' | 'loop';
  };
}

export interface BooleanRequest {
  type: 'boolean';
  data: {
    operation: 'union' | 'subtract' | 'intersect';
    meshA: { vertices: Vec3[]; faces: number[][] };
    meshB: { vertices: Vec3[]; faces: number[][] };
  };
}

export type MeshWorkerRequest = TriangulateRequest | SubdivideRequest | BooleanRequest;

export interface MeshWorkerResponse {
  type: 'result' | 'error';
  requestType: MeshWorkerRequest['type'];
  data?: {
    vertices: Vec3[];
    faces: number[][];
  };
  error?: string;
}

// ─── Manifold Bridge (lazy-initialized per worker) ──────────────

let workerBridge: ManifoldBridge | null = null;

async function getWorkerBridge(): Promise<ManifoldBridge> {
  if (!workerBridge) {
    workerBridge = new ManifoldBridge();
  }
  if (!workerBridge.isReady()) {
    await workerBridge.initialize();
  }
  return workerBridge;
}

// ─── Triangulation ──────────────────────────────────────────────

function triangulateMesh(
  vertices: Vec3[],
  faces: number[][],
): { vertices: Vec3[]; faces: number[][] } {
  const outFaces: number[][] = [];

  for (const face of faces) {
    if (face.length < 3) continue;

    if (face.length === 3) {
      outFaces.push([...face]);
      continue;
    }

    // Fan triangulation from first vertex
    for (let i = 1; i < face.length - 1; i++) {
      outFaces.push([face[0], face[i], face[i + 1]]);
    }
  }

  return { vertices: [...vertices], faces: outFaces };
}

// ─── Subdivision (Catmull-Clark) ────────────────────────────────

function subdivideCatmullClark(
  vertices: Vec3[],
  faces: number[][],
  iterations: number,
): { vertices: Vec3[]; faces: number[][] } {
  let currentVerts = vertices.map(v => ({ ...v }));
  let currentFaces = faces.map(f => [...f]);

  for (let iter = 0; iter < iterations; iter++) {
    const newVerts: Vec3[] = [...currentVerts];
    const newFaces: number[][] = [];

    // Step 1: Compute face points (centroid of each face)
    const facePoints: Vec3[] = [];
    for (const face of currentFaces) {
      let cx = 0, cy = 0, cz = 0;
      for (const idx of face) {
        cx += currentVerts[idx].x;
        cy += currentVerts[idx].y;
        cz += currentVerts[idx].z;
      }
      const n = face.length;
      facePoints.push({ x: cx / n, y: cy / n, z: cz / n });
    }

    // Step 2: Compute edge points
    // Build edge -> face adjacency
    const edgeKey = (a: number, b: number) => `${Math.min(a, b)}_${Math.max(a, b)}`;
    const edgeFaces = new Map<string, number[]>();
    const edgeMidpoints = new Map<string, Vec3>();

    for (let fi = 0; fi < currentFaces.length; fi++) {
      const face = currentFaces[fi];
      for (let i = 0; i < face.length; i++) {
        const a = face[i];
        const b = face[(i + 1) % face.length];
        const key = edgeKey(a, b);
        if (!edgeFaces.has(key)) {
          edgeFaces.set(key, []);
          const va = currentVerts[a], vb = currentVerts[b];
          edgeMidpoints.set(key, {
            x: (va.x + vb.x) / 2,
            y: (va.y + vb.y) / 2,
            z: (va.z + vb.z) / 2,
          });
        }
        edgeFaces.get(key)!.push(fi);
      }
    }

    // Edge point = average of edge midpoint and average of adjacent face points
    const edgePointIndex = new Map<string, number>();
    for (const [key, adjFaces] of edgeFaces) {
      const mid = edgeMidpoints.get(key)!;
      if (adjFaces.length === 2) {
        const fp1 = facePoints[adjFaces[0]];
        const fp2 = facePoints[adjFaces[1]];
        newVerts.push({
          x: (mid.x + (fp1.x + fp2.x) / 2) / 2,
          y: (mid.y + (fp1.y + fp2.y) / 2) / 2,
          z: (mid.z + (fp1.z + fp2.z) / 2) / 2,
        });
      } else {
        newVerts.push(mid);
      }
      edgePointIndex.set(key, newVerts.length - 1);
    }

    // Step 3: Add face points as vertices
    const facePointStartIdx = newVerts.length;
    for (const fp of facePoints) {
      newVerts.push(fp);
    }

    // Step 4: Move original vertices
    const vertexFaces = new Map<number, number[]>();
    const vertexEdges = new Map<number, string[]>();
    for (let fi = 0; fi < currentFaces.length; fi++) {
      const face = currentFaces[fi];
      for (let i = 0; i < face.length; i++) {
        const vi = face[i];
        if (!vertexFaces.has(vi)) vertexFaces.set(vi, []);
        vertexFaces.get(vi)!.push(fi);

        const key = edgeKey(vi, face[(i + 1) % face.length]);
        if (!vertexEdges.has(vi)) vertexEdges.set(vi, []);
        const edges = vertexEdges.get(vi)!;
        if (!edges.includes(key)) edges.push(key);
      }
    }

    for (let vi = 0; vi < currentVerts.length; vi++) {
      const adjFaceIndices = vertexFaces.get(vi) ?? [];
      const adjEdgeKeys = vertexEdges.get(vi) ?? [];
      const n = adjFaceIndices.length;
      if (n === 0) continue;

      // F = average of face points
      let fx = 0, fy = 0, fz = 0;
      for (const fi of adjFaceIndices) {
        fx += facePoints[fi].x;
        fy += facePoints[fi].y;
        fz += facePoints[fi].z;
      }
      fx /= n; fy /= n; fz /= n;

      // R = average of edge midpoints
      let rx = 0, ry = 0, rz = 0;
      for (const ek of adjEdgeKeys) {
        const mp = edgeMidpoints.get(ek)!;
        rx += mp.x; ry += mp.y; rz += mp.z;
      }
      const en = adjEdgeKeys.length;
      rx /= en; ry /= en; rz /= en;

      const v = currentVerts[vi];
      // New position: (F + 2R + (n-3)P) / n
      newVerts[vi] = {
        x: (fx + 2 * rx + (n - 3) * v.x) / n,
        y: (fy + 2 * ry + (n - 3) * v.y) / n,
        z: (fz + 2 * rz + (n - 3) * v.z) / n,
      };
    }

    // Step 5: Build new faces — each original face becomes n quads
    for (let fi = 0; fi < currentFaces.length; fi++) {
      const face = currentFaces[fi];
      const fpIdx = facePointStartIdx + fi;

      for (let i = 0; i < face.length; i++) {
        const vi = face[i];
        const prevEdge = edgeKey(face[(i + face.length - 1) % face.length], vi);
        const nextEdge = edgeKey(vi, face[(i + 1) % face.length]);

        const ep1 = edgePointIndex.get(prevEdge)!;
        const ep2 = edgePointIndex.get(nextEdge)!;

        newFaces.push([vi, ep2, fpIdx, ep1]);
      }
    }

    currentVerts = newVerts;
    currentFaces = newFaces;
  }

  return { vertices: currentVerts, faces: currentFaces };
}

// ─── Subdivision (Loop) ─────────────────────────────────────────

function subdivideLoop(
  vertices: Vec3[],
  faces: number[][],
  iterations: number,
): { vertices: Vec3[]; faces: number[][] } {
  // Loop subdivision works on triangle meshes — triangulate first
  let result = triangulateMesh(vertices, faces);

  for (let iter = 0; iter < iterations; iter++) {
    const { vertices: verts, faces: tris } = result;
    const newVerts: Vec3[] = verts.map(v => ({ ...v }));
    const newFaces: number[][] = [];

    const edgeKey = (a: number, b: number) => `${Math.min(a, b)}_${Math.max(a, b)}`;
    const edgeFaces = new Map<string, number[]>();
    const edgeMidIndex = new Map<string, number>();

    // Build edge adjacency
    for (let fi = 0; fi < tris.length; fi++) {
      const t = tris[fi];
      for (let i = 0; i < 3; i++) {
        const key = edgeKey(t[i], t[(i + 1) % 3]);
        if (!edgeFaces.has(key)) edgeFaces.set(key, []);
        edgeFaces.get(key)!.push(fi);
      }
    }

    // Create edge midpoints
    for (const [key, adjFaces] of edgeFaces) {
      const [aStr, bStr] = key.split('_');
      const a = parseInt(aStr), b = parseInt(bStr);
      const va = verts[a], vb = verts[b];

      if (adjFaces.length === 2) {
        // Interior edge: 3/8 * (A + B) + 1/8 * (C + D)
        // Find opposite vertices
        const opposites: number[] = [];
        for (const fi of adjFaces) {
          const t = tris[fi];
          for (const vi of t) {
            if (vi !== a && vi !== b) opposites.push(vi);
          }
        }
        const vc = verts[opposites[0]], vd = verts[opposites[1]];
        newVerts.push({
          x: 3 / 8 * (va.x + vb.x) + 1 / 8 * (vc.x + vd.x),
          y: 3 / 8 * (va.y + vb.y) + 1 / 8 * (vc.y + vd.y),
          z: 3 / 8 * (va.z + vb.z) + 1 / 8 * (vc.z + vd.z),
        });
      } else {
        // Boundary edge: simple midpoint
        newVerts.push({
          x: (va.x + vb.x) / 2,
          y: (va.y + vb.y) / 2,
          z: (va.z + vb.z) / 2,
        });
      }
      edgeMidIndex.set(key, newVerts.length - 1);
    }

    // Update original vertex positions
    const vertexNeighbors = new Map<number, Set<number>>();
    for (const t of tris) {
      for (let i = 0; i < 3; i++) {
        if (!vertexNeighbors.has(t[i])) vertexNeighbors.set(t[i], new Set());
        vertexNeighbors.get(t[i])!.add(t[(i + 1) % 3]);
        vertexNeighbors.get(t[i])!.add(t[(i + 2) % 3]);
      }
    }

    for (let vi = 0; vi < verts.length; vi++) {
      const neighbors = vertexNeighbors.get(vi);
      if (!neighbors || neighbors.size === 0) continue;
      const n = neighbors.size;
      const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      let sx = 0, sy = 0, sz = 0;
      for (const ni of neighbors) {
        sx += verts[ni].x;
        sy += verts[ni].y;
        sz += verts[ni].z;
      }
      const v = verts[vi];
      newVerts[vi] = {
        x: (1 - n * beta) * v.x + beta * sx,
        y: (1 - n * beta) * v.y + beta * sy,
        z: (1 - n * beta) * v.z + beta * sz,
      };
    }

    // Build new triangles: each triangle becomes 4 triangles
    for (const t of tris) {
      const e01 = edgeMidIndex.get(edgeKey(t[0], t[1]))!;
      const e12 = edgeMidIndex.get(edgeKey(t[1], t[2]))!;
      const e20 = edgeMidIndex.get(edgeKey(t[2], t[0]))!;

      newFaces.push([t[0], e01, e20]);
      newFaces.push([t[1], e12, e01]);
      newFaces.push([t[2], e20, e12]);
      newFaces.push([e01, e12, e20]);
    }

    result = { vertices: newVerts, faces: newFaces };
  }

  return result;
}

// ─── Boolean Operations (Manifold WASM) ─────────────────────────

async function booleanOp(
  operation: 'union' | 'subtract' | 'intersect',
  meshA: { vertices: Vec3[]; faces: number[][] },
  meshB: { vertices: Vec3[]; faces: number[][] },
): Promise<{ vertices: Vec3[]; faces: number[][] }> {
  const bridge = await getWorkerBridge();

  const manifoldMeshA = { vertices: meshA.vertices, faces: meshA.faces };
  const manifoldMeshB = { vertices: meshB.vertices, faces: meshB.faces };

  let resultMesh;
  switch (operation) {
    case 'union':
      resultMesh = await bridge.union(manifoldMeshA, manifoldMeshB);
      break;
    case 'subtract':
      resultMesh = await bridge.subtract(manifoldMeshA, manifoldMeshB);
      break;
    case 'intersect':
      resultMesh = await bridge.intersect(manifoldMeshA, manifoldMeshB);
      break;
  }

  return { vertices: resultMesh.vertices, faces: resultMesh.faces };
}

// ─── Worker Message Handler ─────────────────────────────────────

const ctx = self as unknown as Worker;

ctx.onmessage = async (event: MessageEvent<MeshWorkerRequest>) => {
  const request = event.data;

  try {
    let result: { vertices: Vec3[]; faces: number[][] };

    switch (request.type) {
      case 'triangulate':
        result = triangulateMesh(request.data.vertices, request.data.faces);
        break;

      case 'subdivide':
        if (request.data.method === 'loop') {
          result = subdivideLoop(
            request.data.vertices,
            request.data.faces,
            request.data.iterations,
          );
        } else {
          result = subdivideCatmullClark(
            request.data.vertices,
            request.data.faces,
            request.data.iterations,
          );
        }
        break;

      case 'boolean':
        result = await booleanOp(
          request.data.operation,
          request.data.meshA,
          request.data.meshB,
        );
        break;

      default:
        throw new Error(`Unknown request type: ${(request as MeshWorkerRequest).type}`);
    }

    const response: MeshWorkerResponse = {
      type: 'result',
      requestType: request.type,
      data: result,
    };
    ctx.postMessage(response);
  } catch (err) {
    const response: MeshWorkerResponse = {
      type: 'error',
      requestType: request.type,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
};
