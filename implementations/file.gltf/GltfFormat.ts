// @archigraph file.gltf-format
// glTF 2.0 (.glb) import/export for DraftDown

import { Vec3, MaterialDef } from '../../src/core/types';
import { IMesh } from '../../src/core/interfaces';

// ─── Constants ──────────────────────────────────────────────────

const GLB_MAGIC = 0x46546C67; // 'glTF'
const GLB_VERSION = 2;
const GLB_CHUNK_JSON = 0x4E4F534A; // 'JSON'
const GLB_CHUNK_BIN = 0x004E4942;  // 'BIN\0'

const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;

const BUFFER_TARGET_ARRAY = 34962;
const BUFFER_TARGET_ELEMENT = 34963;

// ─── Types ──────────────────────────────────────────────────────

export interface GltfImportResult {
  meshes: Array<{
    name: string;
    primitives: Array<{
      positions: Float32Array;
      normals?: Float32Array;
      texCoords?: Float32Array;
      indices?: Uint16Array | Uint32Array;
      materialIndex: number;
    }>;
  }>;
  materials: Array<{
    name: string;
    baseColorFactor: [number, number, number, number];
    metallicFactor: number;
    roughnessFactor: number;
  }>;
  nodes: Array<{
    name: string;
    meshIndex?: number;
    translation?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    children?: number[];
  }>;
}

// ─── Helpers ────────────────────────────────────────────────────

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function alignTo4(n: number): number {
  return (n + 3) & ~3;
}

// ─── Export GLB ─────────────────────────────────────────────────

export function exportGlb(
  mesh: IMesh,
  materials: MaterialDef[] = [],
): ArrayBuffer {
  // Build indexed geometry from mesh via fan triangulation
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const vertexIdToIndex = new Map<string, number>();
  let nextIdx = 0;

  // Add all vertices referenced by faces
  for (const face of mesh.faces.values()) {
    const faceVertexIndices: number[] = [];

    for (const vid of face.vertexIds) {
      if (!vertexIdToIndex.has(vid)) {
        const v = mesh.vertices.get(vid);
        if (!v) continue;
        vertexIdToIndex.set(vid, nextIdx++);
        positions.push(v.position.x, v.position.y, v.position.z);
        // Use face normal for all vertices of the face (flat shading)
        normals.push(face.normal.x, face.normal.y, face.normal.z);
      }
      faceVertexIndices.push(vertexIdToIndex.get(vid)!);
    }

    // Fan triangulation
    for (let i = 1; i < faceVertexIndices.length - 1; i++) {
      indices.push(faceVertexIndices[0], faceVertexIndices[i], faceVertexIndices[i + 1]);
    }
  }

  const positionsF32 = new Float32Array(positions);
  const normalsF32 = new Float32Array(normals);
  const useUint32 = nextIdx > 65535;
  const indicesTyped = useUint32
    ? new Uint32Array(indices)
    : new Uint16Array(indices);

  // Compute bounding box for positions accessor
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  if (positions.length === 0) {
    minX = minY = minZ = maxX = maxY = maxZ = 0;
  }

  // Build binary buffer: [indices | positions | normals]
  const indicesByteLength = indicesTyped.byteLength;
  const indicesPadded = alignTo4(indicesByteLength);
  const positionsByteLength = positionsF32.byteLength;
  const positionsPadded = alignTo4(positionsByteLength);
  const normalsByteLength = normalsF32.byteLength;
  const normalsPadded = alignTo4(normalsByteLength);

  const totalBinSize = indicesPadded + positionsPadded + normalsPadded;
  const binBuffer = new ArrayBuffer(totalBinSize);
  const binU8 = new Uint8Array(binBuffer);

  let binOffset = 0;
  binU8.set(new Uint8Array(indicesTyped.buffer, indicesTyped.byteOffset, indicesTyped.byteLength), binOffset);
  binOffset = indicesPadded;
  binU8.set(new Uint8Array(positionsF32.buffer, positionsF32.byteOffset, positionsF32.byteLength), binOffset);
  binOffset = indicesPadded + positionsPadded;
  binU8.set(new Uint8Array(normalsF32.buffer, normalsF32.byteOffset, normalsF32.byteLength), binOffset);

  // Build glTF JSON
  const gltfMaterials = materials.length > 0
    ? materials.map(m => ({
        name: m.name,
        pbrMetallicRoughness: {
          baseColorFactor: [m.color.r, m.color.g, m.color.b, m.opacity],
          metallicFactor: m.metalness,
          roughnessFactor: m.roughness,
        },
      }))
    : [{
        name: 'default',
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.8, 0.8, 1.0],
          metallicFactor: 0.0,
          roughnessFactor: 0.5,
        },
      }];

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'DraftDown',
    },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ name: 'Mesh', mesh: 0 }],
    meshes: [{
      name: 'Geometry',
      primitives: [{
        attributes: {
          POSITION: 1,
          NORMAL: 2,
        },
        indices: 0,
        material: 0,
      }],
    }],
    materials: gltfMaterials,
    accessors: [
      {
        bufferView: 0,
        componentType: useUint32 ? COMPONENT_UNSIGNED_INT : COMPONENT_UNSIGNED_SHORT,
        count: indices.length,
        type: 'SCALAR',
        max: [indices.length > 0 ? Math.max(...indices) : 0],
        min: [0],
      },
      {
        bufferView: 1,
        componentType: COMPONENT_FLOAT,
        count: nextIdx,
        type: 'VEC3',
        max: [maxX, maxY, maxZ],
        min: [minX, minY, minZ],
      },
      {
        bufferView: 2,
        componentType: COMPONENT_FLOAT,
        count: nextIdx,
        type: 'VEC3',
        max: [1, 1, 1],
        min: [-1, -1, -1],
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: indicesByteLength,
        target: BUFFER_TARGET_ELEMENT,
      },
      {
        buffer: 0,
        byteOffset: indicesPadded,
        byteLength: positionsByteLength,
        target: BUFFER_TARGET_ARRAY,
      },
      {
        buffer: 0,
        byteOffset: indicesPadded + positionsPadded,
        byteLength: normalsByteLength,
        target: BUFFER_TARGET_ARRAY,
      },
    ],
    buffers: [{
      byteLength: totalBinSize,
    }],
  };

  // Encode JSON chunk
  const jsonString = JSON.stringify(gltf);
  const jsonBytes = textEncoder.encode(jsonString);
  const jsonPaddedLength = alignTo4(jsonBytes.length);

  // GLB structure: header(12) + JSON chunk header(8) + JSON data + BIN chunk header(8) + BIN data
  const totalGlbSize = 12 + 8 + jsonPaddedLength + 8 + totalBinSize;
  const glbBuffer = new ArrayBuffer(totalGlbSize);
  const glbView = new DataView(glbBuffer);
  const glbU8 = new Uint8Array(glbBuffer);

  let off = 0;
  // GLB Header
  glbView.setUint32(off, GLB_MAGIC, true); off += 4;
  glbView.setUint32(off, GLB_VERSION, true); off += 4;
  glbView.setUint32(off, totalGlbSize, true); off += 4;

  // JSON chunk
  glbView.setUint32(off, jsonPaddedLength, true); off += 4;
  glbView.setUint32(off, GLB_CHUNK_JSON, true); off += 4;
  glbU8.set(jsonBytes, off);
  // Pad JSON with spaces (0x20)
  for (let i = jsonBytes.length; i < jsonPaddedLength; i++) {
    glbU8[off + i] = 0x20;
  }
  off += jsonPaddedLength;

  // BIN chunk
  glbView.setUint32(off, totalBinSize, true); off += 4;
  glbView.setUint32(off, GLB_CHUNK_BIN, true); off += 4;
  glbU8.set(binU8, off);

  return glbBuffer;
}

// ─── Import GLB ─────────────────────────────────────────────────

export function importGlb(data: ArrayBuffer): GltfImportResult {
  const view = new DataView(data);
  let offset = 0;

  // Read GLB header
  const magic = view.getUint32(offset, true); offset += 4;
  if (magic !== GLB_MAGIC) {
    throw new Error(`Invalid GLB: expected magic 0x${GLB_MAGIC.toString(16)}, got 0x${magic.toString(16)}`);
  }
  const version = view.getUint32(offset, true); offset += 4;
  if (version !== 2) {
    throw new Error(`Unsupported glTF version ${version}`);
  }
  const _totalLength = view.getUint32(offset, true); offset += 4;

  // Read chunks
  let jsonData: Record<string, unknown> | null = null;
  let binData: ArrayBuffer | null = null;

  while (offset < data.byteLength) {
    const chunkLength = view.getUint32(offset, true); offset += 4;
    const chunkType = view.getUint32(offset, true); offset += 4;

    if (chunkType === GLB_CHUNK_JSON) {
      const jsonBytes = new Uint8Array(data, offset, chunkLength);
      jsonData = JSON.parse(textDecoder.decode(jsonBytes));
    } else if (chunkType === GLB_CHUNK_BIN) {
      binData = data.slice(offset, offset + chunkLength);
    }

    offset += chunkLength;
  }

  if (!jsonData) throw new Error('GLB missing JSON chunk');

  const gltf = jsonData as {
    meshes?: Array<{
      name?: string;
      primitives: Array<{
        attributes: Record<string, number>;
        indices?: number;
        material?: number;
      }>;
    }>;
    accessors?: Array<{
      bufferView: number;
      componentType: number;
      count: number;
      type: string;
    }>;
    bufferViews?: Array<{
      buffer: number;
      byteOffset?: number;
      byteLength: number;
    }>;
    materials?: Array<{
      name?: string;
      pbrMetallicRoughness?: {
        baseColorFactor?: [number, number, number, number];
        metallicFactor?: number;
        roughnessFactor?: number;
      };
    }>;
    nodes?: Array<{
      name?: string;
      mesh?: number;
      translation?: [number, number, number];
      rotation?: [number, number, number, number];
      scale?: [number, number, number];
      children?: number[];
    }>;
  };

  // Helper to read accessor data
  function readAccessor(accessorIndex: number): ArrayBuffer {
    const accessor = gltf.accessors?.[accessorIndex];
    if (!accessor || !binData) return new ArrayBuffer(0);
    const bufferView = gltf.bufferViews?.[accessor.bufferView];
    if (!bufferView) return new ArrayBuffer(0);
    const byteOffset = bufferView.byteOffset ?? 0;
    return binData.slice(byteOffset, byteOffset + bufferView.byteLength);
  }

  // Parse meshes
  const meshes: GltfImportResult['meshes'] = [];
  for (const gltfMesh of (gltf.meshes ?? [])) {
    const primitives: GltfImportResult['meshes'][0]['primitives'] = [];

    for (const prim of gltfMesh.primitives) {
      const posAccessorIdx = prim.attributes['POSITION'];
      const normAccessorIdx = prim.attributes['NORMAL'];
      const texAccessorIdx = prim.attributes['TEXCOORD_0'];

      const posData = readAccessor(posAccessorIdx);
      const positions = new Float32Array(posData);

      let primNormals: Float32Array | undefined;
      if (normAccessorIdx !== undefined) {
        primNormals = new Float32Array(readAccessor(normAccessorIdx));
      }

      let texCoords: Float32Array | undefined;
      if (texAccessorIdx !== undefined) {
        texCoords = new Float32Array(readAccessor(texAccessorIdx));
      }

      let primIndices: Uint16Array | Uint32Array | undefined;
      if (prim.indices !== undefined) {
        const accessor = gltf.accessors?.[prim.indices];
        const idxData = readAccessor(prim.indices);
        if (accessor?.componentType === COMPONENT_UNSIGNED_INT) {
          primIndices = new Uint32Array(idxData);
        } else {
          primIndices = new Uint16Array(idxData);
        }
      }

      primitives.push({
        positions,
        normals: primNormals,
        texCoords,
        indices: primIndices,
        materialIndex: prim.material ?? -1,
      });
    }

    meshes.push({ name: gltfMesh.name ?? '', primitives });
  }

  // Parse materials
  const parsedMaterials: GltfImportResult['materials'] = [];
  for (const gltfMat of (gltf.materials ?? [])) {
    const pbr = gltfMat.pbrMetallicRoughness;
    parsedMaterials.push({
      name: gltfMat.name ?? 'Untitled',
      baseColorFactor: pbr?.baseColorFactor ?? [1, 1, 1, 1],
      metallicFactor: pbr?.metallicFactor ?? 1.0,
      roughnessFactor: pbr?.roughnessFactor ?? 1.0,
    });
  }

  // Parse nodes
  const nodes: GltfImportResult['nodes'] = [];
  for (const gltfNode of (gltf.nodes ?? [])) {
    nodes.push({
      name: gltfNode.name ?? '',
      meshIndex: gltfNode.mesh,
      translation: gltfNode.translation,
      rotation: gltfNode.rotation,
      scale: gltfNode.scale,
      children: gltfNode.children,
    });
  }

  return { meshes, materials: parsedMaterials, nodes };
}
