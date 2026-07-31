// @archigraph native.opencascade-bridge
// Bridge to OpenCascade WASM for STEP file processing
// OpenCascade: https://dev.opencascade.org/

import { Vec3 } from '../../src/core/types';

// ─── Types ──────────────────────────────────────────────────────

export interface StepMeshResult {
  vertices: Vec3[];
  faces: Array<{
    vertexIndices: number[];
    normal: Vec3;
  }>;
  edges: Array<{
    startIndex: number;
    endIndex: number;
  }>;
  metadata: {
    schema: string;
    description: string;
    author: string;
  };
}

interface OpenCascadeModule {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  STEPReader: {
    new(): OpenCascadeStepReader;
  };
  Triangulation: {
    new(): OpenCascadeTriangulation;
  };
}

interface OpenCascadeStepReader {
  readFile(path: string): boolean;
  getShape(): OpenCascadeShape;
  getSchema(): string;
  getDescription(): string;
  getAuthor(): string;
  delete(): void;
}

interface OpenCascadeShape {
  isValid(): boolean;
  delete(): void;
}

interface OpenCascadeTriangulation {
  triangulate(shape: OpenCascadeShape, deflection: number): void;
  getVertices(): Float64Array;
  getNormals(): Float64Array;
  getTriangles(): Int32Array;
  getEdgeVertices(): Float64Array;
  delete(): void;
}

// ─── Bridge ─────────────────────────────────────────────────────

export class OpenCascadeBridge {
  private module: OpenCascadeModule | null = null;
  private initialized = false;

  /**
   * Initialize the OpenCascade WASM module.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // @ts-ignore - Optional dependency, loaded at runtime if available
      const ocModule = await import('opencascade.js');
      this.module = await (ocModule as any).default() as OpenCascadeModule;
      this.initialized = true;
    } catch (e) {
      console.error('[OpenCascadeBridge] failed to load opencascade.js:', e);
      throw new Error(
        'Failed to load OpenCascade WASM module. ' +
        'Install "opencascade.js": npm install opencascade.js',
      );
    }
  }

  /**
   * Check if the OpenCascade module is ready.
   */
  isReady(): boolean {
    return this.initialized && this.module !== null;
  }

  /**
   * Import a STEP file and convert its B-Rep geometry to triangulated mesh data.
   *
   * @param data - Raw bytes of the STEP file
   * @param deflection - Triangulation accuracy (smaller = more triangles). Default: 0.1
   */
  async importStep(data: ArrayBuffer, deflection = 0.1): Promise<StepMeshResult> {
    if (!this.initialized) await this.initialize();
    if (!this.module) throw new Error('OpenCascade not initialized');

    const oc = this.module;
    const tempPath = '/tmp/import.step';

    // Write STEP file to the WASM virtual filesystem
    oc.FS.writeFile(tempPath, new Uint8Array(data));

    const reader = new oc.STEPReader();
    let shape: OpenCascadeShape | null = null;
    let triangulation: OpenCascadeTriangulation | null = null;

    try {
      const success = reader.readFile(tempPath);
      if (!success) {
        throw new Error('Failed to parse STEP file. The file may be corrupted or use an unsupported schema.');
      }

      shape = reader.getShape();
      if (!shape.isValid()) {
        throw new Error('STEP file produced an invalid shape.');
      }

      // Extract metadata
      const metadata = {
        schema: reader.getSchema(),
        description: reader.getDescription(),
        author: reader.getAuthor(),
      };

      // Triangulate the B-Rep shape
      triangulation = new oc.Triangulation();
      triangulation.triangulate(shape, deflection);

      // Extract vertices
      const rawVerts = triangulation.getVertices();
      const vertices: Vec3[] = [];
      for (let i = 0; i < rawVerts.length; i += 3) {
        vertices.push({ x: rawVerts[i], y: rawVerts[i + 1], z: rawVerts[i + 2] });
      }

      // Extract normals and build faces
      const rawNormals = triangulation.getNormals();
      const rawTriangles = triangulation.getTriangles();
      const faces: StepMeshResult['faces'] = [];
      for (let i = 0; i < rawTriangles.length; i += 3) {
        const i0 = rawTriangles[i];
        const i1 = rawTriangles[i + 1];
        const i2 = rawTriangles[i + 2];

        // Average the three vertex normals for the face normal
        const normalIdx = i; // Simplified: use first vertex normal
        const normal: Vec3 = normalIdx * 3 + 2 < rawNormals.length
          ? { x: rawNormals[normalIdx * 3], y: rawNormals[normalIdx * 3 + 1], z: rawNormals[normalIdx * 3 + 2] }
          : { x: 0, y: 0, z: 1 };

        faces.push({ vertexIndices: [i0, i1, i2], normal });
      }

      // Extract edges
      const rawEdgeVerts = triangulation.getEdgeVertices();
      const edges: StepMeshResult['edges'] = [];
      for (let i = 0; i < rawEdgeVerts.length; i += 6) {
        // Edge vertex pairs — find closest vertices in the vertex list
        const startPos: Vec3 = { x: rawEdgeVerts[i], y: rawEdgeVerts[i + 1], z: rawEdgeVerts[i + 2] };
        const endPos: Vec3 = { x: rawEdgeVerts[i + 3], y: rawEdgeVerts[i + 4], z: rawEdgeVerts[i + 5] };

        const startIndex = findClosestVertex(vertices, startPos);
        const endIndex = findClosestVertex(vertices, endPos);
        edges.push({ startIndex, endIndex });
      }

      return { vertices, faces, edges, metadata };
    } finally {
      triangulation?.delete();
      shape?.delete();
      reader.delete();
      try { oc.FS.unlink(tempPath); }
      catch (e) { console.warn(`[OpenCascadeBridge] FS.unlink ${tempPath} failed:`, e); }
    }
  }

  /**
   * Release WASM resources.
   */
  dispose(): void {
    this.module = null;
    this.initialized = false;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function findClosestVertex(vertices: Vec3[], target: Vec3): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const dx = v.x - target.x;
    const dy = v.y - target.y;
    const dz = v.z - target.z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}
