// @archigraph worker.file-io
// Web Worker for file parsing and serialization
// Offloads heavy I/O operations from the main thread.

// ─── Message Types ──────────────────────────────────────────────

export interface FileImportRequest {
  type: 'import';
  format: string;
  data: ArrayBuffer;
  /** Optional companion data (e.g., .mtl file content for OBJ) */
  companionData?: string;
}

export interface FileExportRequest {
  type: 'export';
  format: string;
  data: {
    /** Serialized mesh data */
    vertices: Array<{ id: string; position: { x: number; y: number; z: number }; selected: boolean; hidden: boolean }>;
    edges: Array<{
      id: string;
      startVertexId: string;
      endVertexId: string;
      soft: boolean;
      smooth: boolean;
      materialIndex: number;
      selected: boolean;
      hidden: boolean;
    }>;
    faces: Array<{
      id: string;
      vertexIds: string[];
      normal: { x: number; y: number; z: number };
      plane: { normal: { x: number; y: number; z: number }; distance: number };
      materialIndex: number;
      backMaterialIndex: number;
      selected: boolean;
      hidden: boolean;
      area: number;
    }>;
    materials?: Array<{
      id: string;
      name: string;
      color: { r: number; g: number; b: number; a?: number };
      opacity: number;
      roughness: number;
      metalness: number;
    }>;
  };
  options?: Record<string, unknown>;
}

export type FileIORequest = FileImportRequest | FileExportRequest;

export interface FileIOResponse {
  type: 'result' | 'error';
  requestType: 'import' | 'export';
  format: string;
  data?: unknown;
  /** For export: the serialized output */
  output?: ArrayBuffer | string;
  error?: string;
}

// ─── Reconstruct IMesh-like maps from plain data ────────────────

function buildMeshMaps(data: FileExportRequest['data']) {
  const vertices = new Map(data.vertices.map(v => [v.id, v]));
  const edges = new Map(data.edges.map(e => [e.id, e]));
  const faces = new Map(data.faces.map(f => [f.id, f]));
  return { vertices, edges, faces, halfEdges: new Map() };
}

// ─── Import Handlers ────────────────────────────────────────────

async function handleImport(request: FileImportRequest): Promise<unknown> {
  switch (request.format) {
    case 'obj': {
      const { importObj } = await import('../file.obj/ObjFormat');
      const text = new TextDecoder().decode(request.data);
      return importObj(text);
    }

    case 'stl': {
      const { importStl } = await import('../file.stl/StlFormat');
      return importStl(request.data);
    }

    case 'glb':
    case 'gltf': {
      const { importGlb } = await import('../file.gltf/GltfFormat');
      return importGlb(request.data);
    }

    case 'dxf': {
      const { importDxf } = await import('../file.dxf/DxfFormat');
      const text = new TextDecoder().decode(request.data);
      return importDxf(text);
    }

    case 'step':
    case 'stp': {
      const { importStep } = await import('../file.step/StepFormat');
      return await importStep(request.data);
    }

    case 'fbx': {
      const { importFbx } = await import('../file.fbx/FbxFormat');
      return await importFbx(request.data);
    }

    case 'sketch': {
      const { deserialize } = await import('../file.native/NativeFormat');
      return deserialize(request.data);
    }

    default:
      throw new Error(`Unsupported import format: '${request.format}'`);
  }
}

// ─── Export Handlers ────────────────────────────────────────────

async function handleExport(request: FileExportRequest): Promise<ArrayBuffer | string> {
  const mesh = buildMeshMaps(request.data) as any; // IMesh-compatible

  switch (request.format) {
    case 'obj': {
      const { exportObj } = await import('../file.obj/ObjFormat');
      return exportObj(mesh, undefined, request.options as any);
    }

    case 'stl': {
      const { exportStlBinary } = await import('../file.stl/StlFormat');
      return exportStlBinary(mesh, request.options as any);
    }

    case 'glb':
    case 'gltf': {
      const { exportGlb } = await import('../file.gltf/GltfFormat');
      const materials = (request.data.materials ?? []).map(m => ({
        ...m,
        albedoMap: undefined,
        normalMap: undefined,
        roughnessMap: undefined,
        metalnessMap: undefined,
      }));
      return exportGlb(mesh, materials);
    }

    case 'dxf': {
      const { exportDxf } = await import('../file.dxf/DxfFormat');
      return exportDxf(mesh, request.options as any);
    }

    case 'fbx': {
      const { exportFbx } = await import('../file.fbx/FbxFormat');
      const materials = (request.data.materials ?? []).map(m => ({
        ...m,
        albedoMap: undefined,
        normalMap: undefined,
        roughnessMap: undefined,
        metalnessMap: undefined,
      }));
      return exportFbx(mesh, materials, request.options as any);
    }

    case 'step':
    case 'stp': {
      const { exportStep } = await import('../file.step/StepFormat');
      return exportStep(); // Will throw — STEP export not supported
    }

    default:
      throw new Error(`Unsupported export format: '${request.format}'`);
  }
}

// ─── Worker Message Handler ─────────────────────────────────────

const ctx = self as unknown as Worker;

ctx.onmessage = async (event: MessageEvent<FileIORequest>) => {
  const request = event.data;

  try {
    if (request.type === 'import') {
      const data = await handleImport(request);
      const response: FileIOResponse = {
        type: 'result',
        requestType: 'import',
        format: request.format,
        data,
      };
      ctx.postMessage(response);
    } else if (request.type === 'export') {
      const output = await handleExport(request);
      const response: FileIOResponse = {
        type: 'result',
        requestType: 'export',
        format: request.format,
        output,
      };

      // Transfer ArrayBuffer ownership for efficiency
      if (output instanceof ArrayBuffer) {
        ctx.postMessage(response, [output]);
      } else {
        ctx.postMessage(response);
      }
    }
  } catch (err) {
    const response: FileIOResponse = {
      type: 'error',
      requestType: request.type,
      format: request.format,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
};
