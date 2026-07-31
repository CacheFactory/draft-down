// @archigraph native.manifold-bridge
// Bridge to Manifold WASM for CSG boolean operations
// Manifold: https://github.com/elalish/manifold

import { Vec3 } from '../../src/core/types';

// ─── Types ──────────────────────────────────────────────────────

export interface ManifoldMesh {
  vertices: Vec3[];
  faces: number[][]; // each face is an array of vertex indices (triangulated)
}

export interface ManifoldModule {
  Manifold: {
    new(mesh: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }): ManifoldInstance;
  };
  setup(): Promise<void>;
}

export interface ManifoldInstance {
  add(other: ManifoldInstance): ManifoldInstance;
  subtract(other: ManifoldInstance): ManifoldInstance;
  intersect(other: ManifoldInstance): ManifoldInstance;
  getMesh(): { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array };
  delete(): void;
}

// ─── Bridge ─────────────────────────────────────────────────────

export class ManifoldBridge {
  private module: ManifoldModule | null = null;
  private initialized = false;

  /**
   * Initialize the Manifold WASM module.
   * Must be called before any boolean operations.
   */
  /** True when running in the Electron renderer — operations go through the
   *  main process over IPC (the renderer can't import bare WASM specifiers). */
  private get useIPC(): boolean {
    return typeof (globalThis as any).window !== 'undefined' &&
           typeof (globalThis as any).window.api !== 'undefined';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.useIPC) {
      // Main process lazy-loads the WASM on first operation.
      this.initialized = true;
      return;
    }

    try {
      // Direct load (Node contexts: tests, scripts). Forced NATIVE dynamic
      // import — CJS transpilers (jest, webpack targets) rewrite a literal
      // import() into require(), which cannot load this ESM-only package.
      const nativeImport = new Function('specifier', 'return import(specifier)');
      const pkg: any = await nativeImport('manifold-3d');
      const factory = pkg.default ?? pkg;
      const wasm = await factory();
      wasm.setup();
      this.module = wasm as unknown as ManifoldModule;
      this.initialized = true;
    } catch (e) {
      console.error('[ManifoldBridge] failed to load manifold-3d:', e);
      throw new Error(
        'Failed to load Manifold WASM module. ' +
        'Install the "manifold-3d" package: npm install manifold-3d',
      );
    }
  }

  /**
   * Check if the Manifold module is ready.
   */
  isReady(): boolean {
    return this.initialized && this.module !== null;
  }

  /**
   * Convert a ManifoldMesh to the internal Manifold representation.
   */
  private toManifold(mesh: ManifoldMesh): ManifoldInstance {
    if (!this.module) throw new Error('Manifold not initialized');

    // Flatten vertices into a Float32Array (3 properties per vertex: x, y, z)
    const vertProperties = new Float32Array(mesh.vertices.length * 3);
    for (let i = 0; i < mesh.vertices.length; i++) {
      vertProperties[i * 3] = mesh.vertices[i].x;
      vertProperties[i * 3 + 1] = mesh.vertices[i].y;
      vertProperties[i * 3 + 2] = mesh.vertices[i].z;
    }

    // Flatten triangle indices
    const triVerts = new Uint32Array(mesh.faces.length * 3);
    for (let i = 0; i < mesh.faces.length; i++) {
      triVerts[i * 3] = mesh.faces[i][0];
      triVerts[i * 3 + 1] = mesh.faces[i][1];
      triVerts[i * 3 + 2] = mesh.faces[i][2];
    }

    const wasm = this.module as any;
    const wasmMesh = new wasm.Mesh({ numProp: 3, vertProperties, triVerts });
    wasmMesh.merge(); // weld duplicates so face soup becomes manifold
    return new wasm.Manifold(wasmMesh);
  }

  /**
   * Convert a Manifold instance back to our mesh format.
   */
  private fromManifold(instance: ManifoldInstance): ManifoldMesh {
    const result = instance.getMesh();
    const vertices: Vec3[] = [];
    const faces: number[][] = [];

    const numVerts = result.vertProperties.length / result.numProp;
    for (let i = 0; i < numVerts; i++) {
      vertices.push({
        x: result.vertProperties[i * result.numProp],
        y: result.vertProperties[i * result.numProp + 1],
        z: result.vertProperties[i * result.numProp + 2],
      });
    }

    const numTris = result.triVerts.length / 3;
    for (let i = 0; i < numTris; i++) {
      faces.push([
        result.triVerts[i * 3],
        result.triVerts[i * 3 + 1],
        result.triVerts[i * 3 + 2],
      ]);
    }

    return { vertices, faces };
  }

  /**
   * Compute the union of two meshes.
   * The result contains geometry from both meshes.
   */
  private async ipcOp(op: 'union' | 'subtract' | 'intersect', meshA: ManifoldMesh, meshB: ManifoldMesh): Promise<ManifoldMesh> {
    const result = await (globalThis as any).window.api.invoke('native:boolean', { op, meshA, meshB });
    if (!result?.ok || !result.mesh) {
      throw new Error(result?.error ?? 'Boolean operation failed');
    }
    return result.mesh as ManifoldMesh;
  }

  async union(meshA: ManifoldMesh, meshB: ManifoldMesh): Promise<ManifoldMesh> {
    if (!this.initialized) await this.initialize();
    if (this.useIPC) return this.ipcOp('union', meshA, meshB);

    const a = this.toManifold(meshA);
    const b = this.toManifold(meshB);

    try {
      const result = a.add(b);
      const mesh = this.fromManifold(result);
      result.delete();
      return mesh;
    } finally {
      a.delete();
      b.delete();
    }
  }

  /**
   * Subtract meshB from meshA.
   * The result contains geometry of A with B's volume removed.
   */
  async subtract(meshA: ManifoldMesh, meshB: ManifoldMesh): Promise<ManifoldMesh> {
    if (!this.initialized) await this.initialize();
    if (this.useIPC) return this.ipcOp('subtract', meshA, meshB);

    const a = this.toManifold(meshA);
    const b = this.toManifold(meshB);

    try {
      const result = a.subtract(b);
      const mesh = this.fromManifold(result);
      result.delete();
      return mesh;
    } finally {
      a.delete();
      b.delete();
    }
  }

  /**
   * Compute the intersection of two meshes.
   * The result contains only the overlapping volume.
   */
  async intersect(meshA: ManifoldMesh, meshB: ManifoldMesh): Promise<ManifoldMesh> {
    if (!this.initialized) await this.initialize();
    if (this.useIPC) return this.ipcOp('intersect', meshA, meshB);

    const a = this.toManifold(meshA);
    const b = this.toManifold(meshB);

    try {
      const result = a.intersect(b);
      const mesh = this.fromManifold(result);
      result.delete();
      return mesh;
    } finally {
      a.delete();
      b.delete();
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
