// @archigraph file.fbx
// FBX binary format import/export for DraftDown
// Supports FBX 7400+ (import) and FBX 7500 (export) binary formats.

import { Vec3, MaterialDef } from '../../src/core/types';
import { IMesh } from '../../src/core/interfaces';

// ─── Constants ──────────────────────────────────────────────────

const FBX_MAGIC = 'Kaydara FBX Binary  \0';
const FBX_MAGIC_BYTES = new Uint8Array([
  0x4B, 0x61, 0x79, 0x64, 0x61, 0x72, 0x61, 0x20,
  0x46, 0x42, 0x58, 0x20, 0x42, 0x69, 0x6E, 0x61,
  0x72, 0x79, 0x20, 0x20, 0x00,
]);
const FBX_VERSION_EXPORT = 7500;
const FBX_HEADER_SIZE = 27; // magic(21) + 0x1A(1) + 0x00(1) + version(4)
const FBX_NULL_RECORD_SIZE = 13; // FBX 7500 null sentinel: 13 zero bytes

// FBX property type codes
const PROP_Y = 0x59; // int16
const PROP_C = 0x43; // bool (uint8)
const PROP_I = 0x49; // int32
const PROP_F = 0x46; // float32
const PROP_D = 0x44; // float64
const PROP_L = 0x4C; // int64
const PROP_S = 0x53; // string
const PROP_R = 0x52; // raw bytes

// Array property type codes
const PROP_f = 0x66; // float32 array
const PROP_d = 0x64; // float64 array
const PROP_l = 0x6C; // int64 array
const PROP_i = 0x69; // int32 array
const PROP_b = 0x62; // bool array

// ─── Types ──────────────────────────────────────────────────────

export interface FbxImportResult {
  vertices: Vec3[];
  faces: Array<{ vertexIndices: number[] }>;
  normals: Vec3[];
  materials: Array<{ name: string; diffuseColor: Vec3 }>;
}

export interface FbxExportOptions {
  title?: string;
  creator?: string;
}

/** Internal representation of an FBX node record. */
interface FbxNode {
  name: string;
  properties: FbxProperty[];
  children: FbxNode[];
}

type FbxProperty =
  | { type: 'Y'; value: number }
  | { type: 'C'; value: boolean }
  | { type: 'I'; value: number }
  | { type: 'F'; value: number }
  | { type: 'D'; value: number }
  | { type: 'L'; value: bigint }
  | { type: 'S'; value: string }
  | { type: 'R'; value: Uint8Array }
  | { type: 'f'; value: Float32Array }
  | { type: 'd'; value: Float64Array }
  | { type: 'l'; value: BigInt64Array }
  | { type: 'i'; value: Int32Array }
  | { type: 'b'; value: Uint8Array };

// ─── Binary Reader ──────────────────────────────────────────────

class FbxBinaryReader {
  private view: DataView;
  private u8: Uint8Array;
  public offset: number;
  public version: number;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.u8 = new Uint8Array(buffer);
    this.offset = 0;
    this.version = 0;
  }

  get remaining(): number {
    return this.u8.length - this.offset;
  }

  readUint8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readInt16LE(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readUint32LE(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readInt32LE(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readUint64LE(): bigint {
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readInt64LE(): bigint {
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readFloat32LE(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readFloat64LE(): number {
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readBytes(length: number): Uint8Array {
    const bytes = this.u8.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readString(length: number): string {
    const bytes = this.readBytes(length);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /** Check if the next N bytes are all zero (null record sentinel). */
  isNullRecord(sentinelSize: number): boolean {
    for (let i = 0; i < sentinelSize; i++) {
      if (this.offset + i >= this.u8.length) return true;
      if (this.u8[this.offset + i] !== 0) return false;
    }
    return true;
  }
}

// ─── Binary Writer ──────────────────────────────────────────────

class FbxBinaryWriter {
  private chunks: Uint8Array[] = [];
  private _size = 0;

  get size(): number {
    return this._size;
  }

  writeBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this._size += bytes.length;
  }

  writeUint8(v: number): void {
    const b = new Uint8Array(1);
    b[0] = v & 0xFF;
    this.writeBytes(b);
  }

  writeInt16LE(v: number): void {
    const buf = new ArrayBuffer(2);
    new DataView(buf).setInt16(0, v, true);
    this.writeBytes(new Uint8Array(buf));
  }

  writeUint32LE(v: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, v, true);
    this.writeBytes(new Uint8Array(buf));
  }

  writeInt32LE(v: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, v, true);
    this.writeBytes(new Uint8Array(buf));
  }

  writeInt64LE(v: bigint): void {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigInt64(0, v, true);
    this.writeBytes(new Uint8Array(buf));
  }

  writeFloat32LE(v: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, true);
    this.writeBytes(new Uint8Array(buf));
  }

  writeFloat64LE(v: number): void {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v, true);
    this.writeBytes(new Uint8Array(buf));
  }

  writeString(s: string): void {
    this.writeBytes(new TextEncoder().encode(s));
  }

  writeZeros(count: number): void {
    this.writeBytes(new Uint8Array(count));
  }

  toArrayBuffer(): ArrayBuffer {
    const result = new ArrayBuffer(this._size);
    const u8 = new Uint8Array(result);
    let offset = 0;
    for (const chunk of this.chunks) {
      u8.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

// ─── FBX Node Parsing ───────────────────────────────────────────

/**
 * Parse a single FBX property from the binary stream.
 */
function readProperty(reader: FbxBinaryReader): FbxProperty {
  const typeCode = reader.readUint8();

  switch (typeCode) {
    case PROP_Y:
      return { type: 'Y', value: reader.readInt16LE() };
    case PROP_C:
      return { type: 'C', value: reader.readUint8() !== 0 };
    case PROP_I:
      return { type: 'I', value: reader.readInt32LE() };
    case PROP_F:
      return { type: 'F', value: reader.readFloat32LE() };
    case PROP_D:
      return { type: 'D', value: reader.readFloat64LE() };
    case PROP_L:
      return { type: 'L', value: reader.readInt64LE() };
    case PROP_S: {
      const len = reader.readUint32LE();
      return { type: 'S', value: reader.readString(len) };
    }
    case PROP_R: {
      const len = reader.readUint32LE();
      return { type: 'R', value: reader.readBytes(len) };
    }
    case PROP_f:
      return { type: 'f', value: readFloat32Array(reader) };
    case PROP_d:
      return { type: 'd', value: readFloat64Array(reader) };
    case PROP_l:
      return { type: 'l', value: readInt64Array(reader) };
    case PROP_i:
      return { type: 'i', value: readInt32Array(reader) };
    case PROP_b:
      return { type: 'b', value: readBoolArray(reader) };
    default:
      throw new Error(`Unknown FBX property type code: 0x${typeCode.toString(16)} at offset ${reader.offset - 1}`);
  }
}

/**
 * Read an FBX array property. Arrays have:
 *   arrayLength(u32), encoding(u32), compressedLength(u32), data...
 * encoding=0 means raw, encoding=1 means zlib-compressed.
 */
function readArrayHeader(reader: FbxBinaryReader): { arrayLength: number; encoding: number; compressedLength: number } {
  const arrayLength = reader.readUint32LE();
  const encoding = reader.readUint32LE();
  const compressedLength = reader.readUint32LE();
  return { arrayLength, encoding, compressedLength };
}

function readFloat64Array(reader: FbxBinaryReader): Float64Array {
  const { arrayLength, encoding, compressedLength } = readArrayHeader(reader);
  const rawBytes = reader.readBytes(encoding === 0 ? arrayLength * 8 : compressedLength);
  const data = encoding === 0 ? rawBytes : decompressZlib(rawBytes, arrayLength * 8);
  const result = new Float64Array(arrayLength);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < arrayLength; i++) {
    result[i] = view.getFloat64(i * 8, true);
  }
  return result;
}

function readFloat32Array(reader: FbxBinaryReader): Float32Array {
  const { arrayLength, encoding, compressedLength } = readArrayHeader(reader);
  const rawBytes = reader.readBytes(encoding === 0 ? arrayLength * 4 : compressedLength);
  const data = encoding === 0 ? rawBytes : decompressZlib(rawBytes, arrayLength * 4);
  const result = new Float32Array(arrayLength);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < arrayLength; i++) {
    result[i] = view.getFloat32(i * 4, true);
  }
  return result;
}

function readInt32Array(reader: FbxBinaryReader): Int32Array {
  const { arrayLength, encoding, compressedLength } = readArrayHeader(reader);
  const rawBytes = reader.readBytes(encoding === 0 ? arrayLength * 4 : compressedLength);
  const data = encoding === 0 ? rawBytes : decompressZlib(rawBytes, arrayLength * 4);
  const result = new Int32Array(arrayLength);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < arrayLength; i++) {
    result[i] = view.getInt32(i * 4, true);
  }
  return result;
}

function readInt64Array(reader: FbxBinaryReader): BigInt64Array {
  const { arrayLength, encoding, compressedLength } = readArrayHeader(reader);
  const rawBytes = reader.readBytes(encoding === 0 ? arrayLength * 8 : compressedLength);
  const data = encoding === 0 ? rawBytes : decompressZlib(rawBytes, arrayLength * 8);
  const result = new BigInt64Array(arrayLength);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < arrayLength; i++) {
    result[i] = view.getBigInt64(i * 8, true);
  }
  return result;
}

function readBoolArray(reader: FbxBinaryReader): Uint8Array {
  const { arrayLength, encoding, compressedLength } = readArrayHeader(reader);
  const rawBytes = reader.readBytes(encoding === 0 ? arrayLength : compressedLength);
  return encoding === 0 ? rawBytes : decompressZlib(rawBytes, arrayLength);
}

/**
 * Attempt to decompress zlib data. In a Node.js environment, use zlib.inflateSync.
 * Falls back to returning the raw data if decompression is unavailable.
 */
function decompressZlib(compressed: Uint8Array, _expectedSize: number): Uint8Array {
  try {
    // Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const zlib = require('zlib');
    const result = zlib.inflateSync(Buffer.from(compressed));
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  } catch (e) {
    console.warn('[FbxFormat.inflate] zlib unavailable or decompression failed:', e);
    // If zlib is not available (browser), throw a descriptive error
    throw new Error(
      'Compressed FBX array data encountered but zlib decompression is not available. ' +
      'This FBX file uses zlib-compressed arrays which require a Node.js environment.',
    );
  }
}

/**
 * Parse a single FBX node record from the binary stream.
 * Returns null for the null sentinel record.
 */
function readNodeRecord(reader: FbxBinaryReader): FbxNode | null {
  const sentinelSize = reader.version >= 7500 ? FBX_NULL_RECORD_SIZE : 13;

  // For FBX 7500+, offsets are 64-bit; for older versions, 32-bit
  const is64Bit = reader.version >= 7500;

  let endOffset: number;
  let numProperties: number;
  let propertyListLen: number;

  if (is64Bit) {
    const eo = reader.readUint64LE();
    endOffset = Number(eo);
    const np = reader.readUint64LE();
    numProperties = Number(np);
    const pl = reader.readUint64LE();
    propertyListLen = Number(pl);
  } else {
    endOffset = reader.readUint32LE();
    numProperties = reader.readUint32LE();
    propertyListLen = reader.readUint32LE();
  }

  // Null record sentinel: all fields are zero
  if (endOffset === 0 && numProperties === 0 && propertyListLen === 0) {
    // Read the name length byte (will be 0) but it was already consumed as part of the sentinel check
    // Actually for the sentinel, the nameLen is also part of the zero block.
    // The sentinel is 13 bytes for <7500 (3*4 + 1) and 25 bytes for >=7500 (3*8 + 1).
    // We've already read the first 12 or 24 bytes. Read the remaining 1 byte (nameLen).
    reader.readUint8(); // nameLen = 0
    return null;
  }

  const nameLen = reader.readUint8();
  const name = reader.readString(nameLen);

  // Read properties
  const properties: FbxProperty[] = [];
  const propStartOffset = reader.offset;
  for (let i = 0; i < numProperties; i++) {
    properties.push(readProperty(reader));
  }

  // Verify property list length (skip if mismatch to be lenient)
  const actualPropLen = reader.offset - propStartOffset;
  if (actualPropLen !== propertyListLen && propertyListLen > 0) {
    // Adjust offset if needed — some files may have padding
    reader.offset = propStartOffset + propertyListLen;
  }

  // Read nested children until null sentinel or endOffset
  const children: FbxNode[] = [];
  if (reader.offset < endOffset) {
    while (reader.offset < endOffset - sentinelSize) {
      const child = readNodeRecord(reader);
      if (child === null) break;
      children.push(child);
    }
    // Skip past the null sentinel / align to endOffset
    reader.offset = endOffset;
  }

  return { name, properties, children };
}

/**
 * Parse the top-level nodes of an FBX binary file.
 */
function parseTopLevelNodes(reader: FbxBinaryReader): FbxNode[] {
  const nodes: FbxNode[] = [];
  const sentinelSize = reader.version >= 7500 ? 25 : 13;

  while (reader.remaining > sentinelSize) {
    const node = readNodeRecord(reader);
    if (node === null) break;
    nodes.push(node);
  }

  return nodes;
}

// ─── FBX Node Helpers ───────────────────────────────────────────

/** Find a child node by name. */
function findChild(node: FbxNode, name: string): FbxNode | undefined {
  return node.children.find(c => c.name === name);
}

/** Find all children with a given name. */
function findChildren(nodes: FbxNode[], name: string): FbxNode[] {
  return nodes.filter(n => n.name === name);
}

/** Find all nodes with a given name recursively across a node list. */
function findNodesRecursive(nodes: FbxNode[], name: string): FbxNode[] {
  const result: FbxNode[] = [];
  for (const node of nodes) {
    if (node.name === name) result.push(node);
    result.push(...findNodesRecursive(node.children, name));
  }
  return result;
}

/** Get the first string property value of a node, or undefined. */
function getStringProp(node: FbxNode, index = 0): string | undefined {
  let strCount = 0;
  for (const p of node.properties) {
    if (p.type === 'S') {
      if (strCount === index) return p.value;
      strCount++;
    }
  }
  return undefined;
}

/** Get the first numeric property as a number. */
function getNumericProp(node: FbxNode, index = 0): number | undefined {
  let numCount = 0;
  for (const p of node.properties) {
    if (p.type === 'I' || p.type === 'F' || p.type === 'D' || p.type === 'Y') {
      if (numCount === index) return p.value;
      numCount++;
    }
    if (p.type === 'L') {
      if (numCount === index) return Number(p.value);
      numCount++;
    }
  }
  return undefined;
}

/** Get the int64/long first property as bigint (used for FBX IDs). */
function getIdProp(node: FbxNode): bigint | undefined {
  for (const p of node.properties) {
    if (p.type === 'L') return p.value;
  }
  return undefined;
}

/** Get a Float64Array from a child node's property. */
function getFloat64ArrayFromChild(parent: FbxNode, childName: string): Float64Array | null {
  const child = findChild(parent, childName);
  if (!child) return null;
  for (const p of child.properties) {
    if (p.type === 'd') return p.value;
  }
  return null;
}

/** Get an Int32Array from a child node's property. */
function getInt32ArrayFromChild(parent: FbxNode, childName: string): Int32Array | null {
  const child = findChild(parent, childName);
  if (!child) return null;
  for (const p of child.properties) {
    if (p.type === 'i') return p.value;
  }
  return null;
}

// ─── Import ─────────────────────────────────────────────────────

// @archigraph file.fbx
/**
 * Import a binary FBX file (version 7400+).
 *
 * Parses:
 * - Geometry nodes: vertices from "Vertices" property, faces from "PolygonVertexIndex"
 * - Material nodes: diffuse color and opacity
 * - Model hierarchy: parent-child connections
 * - Multiple meshes in a single file
 */
export async function importFbx(data: ArrayBuffer): Promise<FbxImportResult> {
  if (data.byteLength < FBX_HEADER_SIZE) {
    throw new Error('File too small to be a valid FBX binary file.');
  }

  const u8 = new Uint8Array(data);

  // Validate magic bytes
  for (let i = 0; i < FBX_MAGIC_BYTES.length; i++) {
    if (u8[i] !== FBX_MAGIC_BYTES[i]) {
      // Check if this might be ASCII FBX
      const headerText = new TextDecoder().decode(u8.slice(0, Math.min(256, u8.length)));
      if (headerText.includes('FBXHeaderExtension')) {
        throw new Error(
          'ASCII FBX format detected but not supported. ' +
          'Convert to binary FBX using an FBX converter or use glTF/OBJ format instead.',
        );
      }
      throw new Error('Unrecognized file format: not a valid FBX binary file.');
    }
  }

  const reader = new FbxBinaryReader(data);
  reader.offset = FBX_MAGIC_BYTES.length;

  // Read the two bytes after magic (0x1A 0x00)
  const byte1 = reader.readUint8();
  const byte2 = reader.readUint8();
  if (byte1 !== 0x1A || byte2 !== 0x00) {
    throw new Error('Invalid FBX header: expected 0x1A 0x00 after magic string.');
  }

  // Read version
  const version = reader.readUint32LE();
  reader.version = version;

  if (version < 7100) {
    throw new Error(`FBX version ${version} is too old. Minimum supported version is 7100.`);
  }

  // Parse all top-level nodes
  let topNodes: FbxNode[];
  try {
    topNodes = parseTopLevelNodes(reader);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse FBX node structure: ${msg}`);
  }

  // Extract geometry, materials, and connections
  const allVertices: Vec3[] = [];
  const allFaces: Array<{ vertexIndices: number[] }> = [];
  const allNormals: Vec3[] = [];
  const allMaterials: Array<{ name: string; diffuseColor: Vec3 }> = [];

  // Find Objects section
  const objectsNode = topNodes.find(n => n.name === 'Objects');
  if (!objectsNode) {
    // Some minimal FBX files might not have Objects — return empty
    return { vertices: [], faces: [], normals: [], materials: [] };
  }

  // Process Geometry nodes
  const geometryNodes = objectsNode.children.filter(
    n => n.name === 'Geometry' && getSubType(n) === 'Mesh',
  );

  let vertexOffset = 0;

  for (const geomNode of geometryNodes) {
    // Extract vertices from "Vertices" child
    const verticesArray = getFloat64ArrayFromChild(geomNode, 'Vertices');
    if (verticesArray) {
      const count = Math.floor(verticesArray.length / 3);
      for (let i = 0; i < count; i++) {
        allVertices.push({
          x: verticesArray[i * 3],
          y: verticesArray[i * 3 + 1],
          z: verticesArray[i * 3 + 2],
        });
      }
    }

    // Extract faces from "PolygonVertexIndex" child
    const indicesArray = getInt32ArrayFromChild(geomNode, 'PolygonVertexIndex');
    if (indicesArray) {
      let currentFace: number[] = [];
      for (let i = 0; i < indicesArray.length; i++) {
        const idx = indicesArray[i];
        if (idx < 0) {
          // Last index of polygon: bitwise NOT to get actual index
          currentFace.push(~idx + vertexOffset);
          allFaces.push({ vertexIndices: [...currentFace] });
          currentFace = [];
        } else {
          currentFace.push(idx + vertexOffset);
        }
      }
      // Handle malformed data: if there's an unterminated polygon
      if (currentFace.length > 0) {
        allFaces.push({ vertexIndices: [...currentFace] });
      }
    }

    // Extract normals from "LayerElementNormal" if present
    const normalLayer = findChild(geomNode, 'LayerElementNormal');
    if (normalLayer) {
      const normalsArray = getFloat64ArrayFromChild(normalLayer, 'Normals');
      if (normalsArray) {
        const count = Math.floor(normalsArray.length / 3);
        for (let i = 0; i < count; i++) {
          allNormals.push({
            x: normalsArray[i * 3],
            y: normalsArray[i * 3 + 1],
            z: normalsArray[i * 3 + 2],
          });
        }
      }
    }

    vertexOffset = allVertices.length;
  }

  // Process Material nodes
  const materialNodes = objectsNode.children.filter(n => n.name === 'Material');
  for (const matNode of materialNodes) {
    const name = getStringProp(matNode, 1) ?? getStringProp(matNode, 0) ?? 'Unnamed Material';
    // Clean up FBX name format: "Material::MaterialName" -> "MaterialName"
    const cleanName = name.includes('\x00\x01') ? name.split('\x00\x01').pop()! : name;

    let diffuseColor: Vec3 = { x: 0.8, y: 0.8, z: 0.8 };

    // Look for Properties70 child which contains material properties
    const props70 = findChild(matNode, 'Properties70');
    if (props70) {
      for (const pNode of props70.children) {
        if (pNode.name !== 'P') continue;
        const propName = getStringProp(pNode, 0);
        if (propName === 'DiffuseColor') {
          // DiffuseColor properties: P: "DiffuseColor", "Color", "", "A", R, G, B
          const numericProps = pNode.properties.filter(
            p => p.type === 'D' || p.type === 'F',
          );
          if (numericProps.length >= 3) {
            const vals = numericProps.map(p => (p as { type: 'D' | 'F'; value: number }).value);
            diffuseColor = { x: vals[0], y: vals[1], z: vals[2] };
          }
        }
      }
    }

    allMaterials.push({ name: cleanName, diffuseColor });
  }

  return {
    vertices: allVertices,
    faces: allFaces,
    normals: allNormals,
    materials: allMaterials,
  };
}

/** Extract the sub-type string from an FBX object node (second string property). */
function getSubType(node: FbxNode): string | undefined {
  let strCount = 0;
  for (const p of node.properties) {
    if (p.type === 'S') {
      if (strCount === 1) return p.value;
      strCount++;
    }
  }
  return undefined;
}

// ─── Export ─────────────────────────────────────────────────────

// @archigraph file.fbx

/**
 * Export mesh data as a binary FBX 7500 file.
 *
 * Produces a valid FBX binary with:
 * - FBXHeaderExtension with metadata
 * - GlobalSettings
 * - Objects section: Geometry, Model, Material nodes
 * - Connections section linking Model -> Geometry and Model -> Material
 * - Proper null record sentinels and footer
 */
export function exportFbx(
  mesh: IMesh,
  materials: MaterialDef[] = [],
  options: FbxExportOptions = {},
): ArrayBuffer {
  const { title = 'DraftDown Model', creator = 'DraftDown' } = options;

  // Collect geometry data
  const vertexPositions: number[] = [];
  const faceIndices: number[] = [];
  const vertexIdToIdx = new Map<string, number>();
  let nextIdx = 0;

  for (const v of mesh.vertices.values()) {
    vertexIdToIdx.set(v.id, nextIdx++);
    vertexPositions.push(v.position.x, v.position.y, v.position.z);
  }

  for (const face of mesh.faces.values()) {
    const vids = face.vertexIds;
    for (let i = 0; i < vids.length; i++) {
      const idx = vertexIdToIdx.get(vids[i]) ?? 0;
      // FBX convention: last index of a polygon is bitwise NOT'd
      if (i === vids.length - 1) {
        faceIndices.push(~idx);
      } else {
        faceIndices.push(idx);
      }
    }
  }

  // Assign FBX node IDs (arbitrary unique 64-bit integers)
  const geometryId = BigInt(0x0001000000000001);
  const modelId = BigInt(0x0002000000000001);
  const materialIds = materials.map((_, i) => BigInt(0x0003000000000001) + BigInt(i));

  // Build FBX node tree
  const fbxNodes: FbxNode[] = [];

  // 1. FBXHeaderExtension
  fbxNodes.push(buildHeaderExtension(title, creator));

  // 2. GlobalSettings
  fbxNodes.push(buildGlobalSettings());

  // 3. Documents
  fbxNodes.push(buildDocuments());

  // 4. References (empty)
  fbxNodes.push({ name: 'References', properties: [], children: [] });

  // 5. Definitions
  fbxNodes.push(buildDefinitions(materials.length));

  // 6. Objects
  const objectsChildren: FbxNode[] = [];

  // Geometry node
  objectsChildren.push(buildGeometryNode(geometryId, vertexPositions, faceIndices));

  // Model node
  objectsChildren.push(buildModelNode(modelId, title));

  // Material nodes
  for (let i = 0; i < materials.length; i++) {
    objectsChildren.push(buildMaterialNode(materialIds[i], materials[i]));
  }

  fbxNodes.push({ name: 'Objects', properties: [], children: objectsChildren });

  // 7. Connections
  const connectionChildren: FbxNode[] = [];
  // Model -> root (scene)
  connectionChildren.push(buildConnection('OO', modelId, BigInt(0)));
  // Geometry -> Model
  connectionChildren.push(buildConnection('OO', geometryId, modelId));
  // Materials -> Model
  for (const matId of materialIds) {
    connectionChildren.push(buildConnection('OO', matId, modelId));
  }
  fbxNodes.push({ name: 'Connections', properties: [], children: connectionChildren });

  // Serialize the node tree to binary
  return serializeFbxBinary(fbxNodes);
}

// ─── FBX Node Builders ──────────────────────────────────────────

function buildHeaderExtension(title: string, creator: string): FbxNode {
  return {
    name: 'FBXHeaderExtension',
    properties: [],
    children: [
      {
        name: 'FBXHeaderVersion',
        properties: [{ type: 'I', value: 1003 }],
        children: [],
      },
      {
        name: 'FBXVersion',
        properties: [{ type: 'I', value: FBX_VERSION_EXPORT }],
        children: [],
      },
      {
        name: 'Creator',
        properties: [{ type: 'S', value: creator }],
        children: [],
      },
      {
        name: 'SceneInfo',
        properties: [
          { type: 'S', value: 'GlobalInfo\x00\x01SceneInfo' },
          { type: 'S', value: 'UserData' },
        ],
        children: [
          {
            name: 'Type',
            properties: [{ type: 'S', value: 'UserData' }],
            children: [],
          },
          {
            name: 'Version',
            properties: [{ type: 'I', value: 100 }],
            children: [],
          },
          {
            name: 'Properties70',
            properties: [],
            children: [
              buildP70String('DocumentUrl', '', '', '', ''),
              buildP70String('SrcDocumentUrl', '', '', '', ''),
              buildP70String('Original|ApplicationVendor', '', '', '', creator),
              buildP70String('Original|ApplicationName', '', '', '', creator),
              buildP70String('Title', '', '', '', title),
            ],
          },
        ],
      },
    ],
  };
}

function buildGlobalSettings(): FbxNode {
  return {
    name: 'GlobalSettings',
    properties: [],
    children: [
      {
        name: 'Version',
        properties: [{ type: 'I', value: 1000 }],
        children: [],
      },
      {
        name: 'Properties70',
        properties: [],
        children: [
          buildP70Int('UpAxis', 1),
          buildP70Int('UpAxisSign', 1),
          buildP70Int('FrontAxis', 2),
          buildP70Int('FrontAxisSign', 1),
          buildP70Int('CoordAxis', 0),
          buildP70Int('CoordAxisSign', 1),
          buildP70Double('UnitScaleFactor', 1.0),
        ],
      },
    ],
  };
}

function buildDocuments(): FbxNode {
  return {
    name: 'Documents',
    properties: [],
    children: [
      {
        name: 'Count',
        properties: [{ type: 'I', value: 1 }],
        children: [],
      },
      {
        name: 'Document',
        properties: [
          { type: 'L', value: BigInt(0) },
          { type: 'S', value: '' },
          { type: 'S', value: 'Scene' },
        ],
        children: [
          {
            name: 'RootNode',
            properties: [{ type: 'L', value: BigInt(0) }],
            children: [],
          },
        ],
      },
    ],
  };
}

function buildDefinitions(materialCount: number): FbxNode {
  const totalCount = 1 + 1 + 1 + materialCount; // GlobalSettings + Geometry + Model + Materials
  return {
    name: 'Definitions',
    properties: [],
    children: [
      {
        name: 'Version',
        properties: [{ type: 'I', value: 100 }],
        children: [],
      },
      {
        name: 'Count',
        properties: [{ type: 'I', value: totalCount }],
        children: [],
      },
      buildObjectType('GlobalSettings', 1),
      buildObjectType('Geometry', 1),
      buildObjectType('Model', 1),
      ...(materialCount > 0 ? [buildObjectType('Material', materialCount)] : []),
    ],
  };
}

function buildObjectType(typeName: string, count: number): FbxNode {
  return {
    name: 'ObjectType',
    properties: [{ type: 'S', value: typeName }],
    children: [
      {
        name: 'Count',
        properties: [{ type: 'I', value: count }],
        children: [],
      },
    ],
  };
}

function buildGeometryNode(id: bigint, vertices: number[], indices: number[]): FbxNode {
  return {
    name: 'Geometry',
    properties: [
      { type: 'L', value: id },
      { type: 'S', value: 'Geometry\x00\x01Mesh' },
      { type: 'S', value: 'Mesh' },
    ],
    children: [
      {
        name: 'Vertices',
        properties: [{ type: 'd', value: new Float64Array(vertices) }],
        children: [],
      },
      {
        name: 'PolygonVertexIndex',
        properties: [{ type: 'i', value: new Int32Array(indices) }],
        children: [],
      },
      {
        name: 'GeometryVersion',
        properties: [{ type: 'I', value: 124 }],
        children: [],
      },
    ],
  };
}

function buildModelNode(id: bigint, name: string): FbxNode {
  return {
    name: 'Model',
    properties: [
      { type: 'L', value: id },
      { type: 'S', value: `Model\x00\x01${name}` },
      { type: 'S', value: 'Mesh' },
    ],
    children: [
      {
        name: 'Version',
        properties: [{ type: 'I', value: 232 }],
        children: [],
      },
      {
        name: 'Properties70',
        properties: [],
        children: [
          buildP70Vec3('Lcl Translation', 0, 0, 0),
          buildP70Vec3('Lcl Rotation', 0, 0, 0),
          buildP70Vec3('Lcl Scaling', 1, 1, 1),
        ],
      },
    ],
  };
}

function buildMaterialNode(id: bigint, material: MaterialDef): FbxNode {
  return {
    name: 'Material',
    properties: [
      { type: 'L', value: id },
      { type: 'S', value: `Material\x00\x01${material.name}` },
      { type: 'S', value: '' },
    ],
    children: [
      {
        name: 'Version',
        properties: [{ type: 'I', value: 102 }],
        children: [],
      },
      {
        name: 'ShadingModel',
        properties: [{ type: 'S', value: 'phong' }],
        children: [],
      },
      {
        name: 'Properties70',
        properties: [],
        children: [
          buildP70Color('DiffuseColor', material.color.r, material.color.g, material.color.b),
          buildP70Double('Opacity', material.opacity),
          buildP70Double('Roughness', material.roughness),
          buildP70Double('Metalness', material.metalness),
        ],
      },
    ],
  };
}

function buildConnection(connType: string, childId: bigint, parentId: bigint): FbxNode {
  return {
    name: 'C',
    properties: [
      { type: 'S', value: connType },
      { type: 'L', value: childId },
      { type: 'L', value: parentId },
    ],
    children: [],
  };
}

// ─── Properties70 P node builders ───────────────────────────────

function buildP70String(name: string, t1: string, t2: string, flags: string, value: string): FbxNode {
  return {
    name: 'P',
    properties: [
      { type: 'S', value: name },
      { type: 'S', value: t1 },
      { type: 'S', value: t2 },
      { type: 'S', value: flags },
      { type: 'S', value: value },
    ],
    children: [],
  };
}

function buildP70Int(name: string, value: number): FbxNode {
  return {
    name: 'P',
    properties: [
      { type: 'S', value: name },
      { type: 'S', value: 'int' },
      { type: 'S', value: 'Integer' },
      { type: 'S', value: '' },
      { type: 'I', value },
    ],
    children: [],
  };
}

function buildP70Double(name: string, value: number): FbxNode {
  return {
    name: 'P',
    properties: [
      { type: 'S', value: name },
      { type: 'S', value: 'double' },
      { type: 'S', value: 'Number' },
      { type: 'S', value: '' },
      { type: 'D', value },
    ],
    children: [],
  };
}

function buildP70Vec3(name: string, x: number, y: number, z: number): FbxNode {
  return {
    name: 'P',
    properties: [
      { type: 'S', value: name },
      { type: 'S', value: 'Lcl Translation' },
      { type: 'S', value: '' },
      { type: 'S', value: 'A' },
      { type: 'D', value: x },
      { type: 'D', value: y },
      { type: 'D', value: z },
    ],
    children: [],
  };
}

function buildP70Color(name: string, r: number, g: number, b: number): FbxNode {
  return {
    name: 'P',
    properties: [
      { type: 'S', value: name },
      { type: 'S', value: 'Color' },
      { type: 'S', value: '' },
      { type: 'S', value: 'A' },
      { type: 'D', value: r },
      { type: 'D', value: g },
      { type: 'D', value: b },
    ],
    children: [],
  };
}

// ─── FBX Binary Serialization ───────────────────────────────────

/**
 * Serialize FBX node tree to a complete binary FBX 7500 buffer.
 */
function serializeFbxBinary(nodes: FbxNode[]): ArrayBuffer {
  const writer = new FbxBinaryWriter();

  // Write header
  writer.writeBytes(FBX_MAGIC_BYTES);
  writer.writeUint8(0x1A);
  writer.writeUint8(0x00);
  writer.writeUint32LE(FBX_VERSION_EXPORT);

  // Write all top-level nodes
  for (const node of nodes) {
    writeNodeRecord(writer, node);
  }

  // Write null sentinel (25 zero bytes for FBX 7500: 3*8 + 1)
  writer.writeZeros(25);

  // Write FBX footer
  writeFbxFooter(writer);

  return writer.toArrayBuffer();
}

/**
 * Serialize a single FBX property to the writer.
 */
function writeProperty(writer: FbxBinaryWriter, prop: FbxProperty): void {
  switch (prop.type) {
    case 'Y':
      writer.writeUint8(PROP_Y);
      writer.writeInt16LE(prop.value);
      break;
    case 'C':
      writer.writeUint8(PROP_C);
      writer.writeUint8(prop.value ? 1 : 0);
      break;
    case 'I':
      writer.writeUint8(PROP_I);
      writer.writeInt32LE(prop.value);
      break;
    case 'F':
      writer.writeUint8(PROP_F);
      writer.writeFloat32LE(prop.value);
      break;
    case 'D':
      writer.writeUint8(PROP_D);
      writer.writeFloat64LE(prop.value);
      break;
    case 'L':
      writer.writeUint8(PROP_L);
      writer.writeInt64LE(prop.value);
      break;
    case 'S': {
      writer.writeUint8(PROP_S);
      const encoded = new TextEncoder().encode(prop.value);
      writer.writeUint32LE(encoded.length);
      writer.writeBytes(encoded);
      break;
    }
    case 'R':
      writer.writeUint8(PROP_R);
      writer.writeUint32LE(prop.value.length);
      writer.writeBytes(prop.value);
      break;
    case 'd': {
      writer.writeUint8(PROP_d);
      const arr = prop.value;
      writer.writeUint32LE(arr.length);  // array length
      writer.writeUint32LE(0);           // encoding (0 = raw)
      writer.writeUint32LE(arr.length * 8); // compressed length (same as raw)
      const buf = new ArrayBuffer(arr.length * 8);
      const view = new DataView(buf);
      for (let i = 0; i < arr.length; i++) {
        view.setFloat64(i * 8, arr[i], true);
      }
      writer.writeBytes(new Uint8Array(buf));
      break;
    }
    case 'f': {
      writer.writeUint8(PROP_f);
      const arr = prop.value;
      writer.writeUint32LE(arr.length);
      writer.writeUint32LE(0);
      writer.writeUint32LE(arr.length * 4);
      const buf = new ArrayBuffer(arr.length * 4);
      const view = new DataView(buf);
      for (let i = 0; i < arr.length; i++) {
        view.setFloat32(i * 4, arr[i], true);
      }
      writer.writeBytes(new Uint8Array(buf));
      break;
    }
    case 'i': {
      writer.writeUint8(PROP_i);
      const arr = prop.value;
      writer.writeUint32LE(arr.length);
      writer.writeUint32LE(0);
      writer.writeUint32LE(arr.length * 4);
      const buf = new ArrayBuffer(arr.length * 4);
      const view = new DataView(buf);
      for (let i = 0; i < arr.length; i++) {
        view.setInt32(i * 4, arr[i], true);
      }
      writer.writeBytes(new Uint8Array(buf));
      break;
    }
    case 'l': {
      writer.writeUint8(PROP_l);
      const arr = prop.value;
      writer.writeUint32LE(arr.length);
      writer.writeUint32LE(0);
      writer.writeUint32LE(arr.length * 8);
      const buf = new ArrayBuffer(arr.length * 8);
      const view = new DataView(buf);
      for (let i = 0; i < arr.length; i++) {
        view.setBigInt64(i * 8, arr[i], true);
      }
      writer.writeBytes(new Uint8Array(buf));
      break;
    }
    case 'b': {
      writer.writeUint8(PROP_b);
      const arr = prop.value;
      writer.writeUint32LE(arr.length);
      writer.writeUint32LE(0);
      writer.writeUint32LE(arr.length);
      writer.writeBytes(arr);
      break;
    }
  }
}

/**
 * Calculate the byte size of a serialized property.
 */
function propertyByteSize(prop: FbxProperty): number {
  switch (prop.type) {
    case 'Y': return 1 + 2;
    case 'C': return 1 + 1;
    case 'I': return 1 + 4;
    case 'F': return 1 + 4;
    case 'D': return 1 + 8;
    case 'L': return 1 + 8;
    case 'S': return 1 + 4 + new TextEncoder().encode(prop.value).length;
    case 'R': return 1 + 4 + prop.value.length;
    case 'd': return 1 + 12 + prop.value.length * 8;
    case 'f': return 1 + 12 + prop.value.length * 4;
    case 'i': return 1 + 12 + prop.value.length * 4;
    case 'l': return 1 + 12 + prop.value.length * 8;
    case 'b': return 1 + 12 + prop.value.length;
  }
}

/**
 * Calculate the total byte size of a node record (including children and sentinel).
 * Used to compute EndOffset values before writing.
 */
function nodeRecordByteSize(node: FbxNode): number {
  // Header: EndOffset(8) + NumProperties(8) + PropertyListLen(8) + NameLen(1) + Name
  const headerSize = 8 + 8 + 8 + 1 + new TextEncoder().encode(node.name).length;

  // Properties
  let propSize = 0;
  for (const prop of node.properties) {
    propSize += propertyByteSize(prop);
  }

  // Children
  let childrenSize = 0;
  if (node.children.length > 0) {
    for (const child of node.children) {
      childrenSize += nodeRecordByteSize(child);
    }
    childrenSize += 25; // null sentinel for FBX 7500 (3*8 + 1)
  }

  return headerSize + propSize + childrenSize;
}

/**
 * Write a complete FBX node record to the writer.
 * FBX 7500 format: EndOffset(u64), NumProperties(u64), PropertyListLen(u64), NameLen(u8), Name, Properties, Children, NullSentinel
 */
function writeNodeRecord(writer: FbxBinaryWriter, node: FbxNode): void {
  const nameBytes = new TextEncoder().encode(node.name);
  const totalSize = nodeRecordByteSize(node);
  const endOffset = writer.size + totalSize;

  // Calculate property list byte length
  let propListLen = 0;
  for (const prop of node.properties) {
    propListLen += propertyByteSize(prop);
  }

  // Write header (FBX 7500 uses 64-bit offsets stored as two uint32s in LE)
  // Since JS doesn't handle u64 natively, we write as BigInt
  writer.writeInt64LE(BigInt(endOffset));
  writer.writeInt64LE(BigInt(node.properties.length));
  writer.writeInt64LE(BigInt(propListLen));
  writer.writeUint8(nameBytes.length);
  writer.writeBytes(nameBytes);

  // Write properties
  for (const prop of node.properties) {
    writeProperty(writer, prop);
  }

  // Write children
  if (node.children.length > 0) {
    for (const child of node.children) {
      writeNodeRecord(writer, child);
    }
    // Null sentinel
    writer.writeZeros(25);
  }
}

/**
 * Write the FBX binary footer.
 * The footer consists of:
 * 1. Padding to align to 16 bytes (with specific fill bytes)
 * 2. Footer magic (16 bytes)
 * 3. Padding (4 bytes of zeros)
 * 4. Version number (u32 LE)
 * 5. 120 zero bytes
 * 6. FBX footer magic: 0xFA BC AB 09 D0 C8 D4 66 B1 76 FB 83 1C F7 26 7E
 */
function writeFbxFooter(writer: FbxBinaryWriter): void {
  // Pad to 16-byte boundary
  const currentSize = writer.size;
  const padSize = (16 - (currentSize % 16)) % 16;
  if (padSize > 0) {
    // FBX uses specific padding bytes
    const padding = new Uint8Array(padSize);
    for (let i = 0; i < padSize; i++) {
      padding[i] = 0;
    }
    writer.writeBytes(padding);
  }

  // Footer unknown block (16 bytes, all zeros in most files)
  writer.writeZeros(16);

  // Padding
  writer.writeUint32LE(0);

  // Version
  writer.writeUint32LE(FBX_VERSION_EXPORT);

  // 120 zero bytes
  writer.writeZeros(120);

  // FBX footer magic
  const footerMagic = new Uint8Array([
    0xFA, 0xBC, 0xAB, 0x09, 0xD0, 0xC8, 0xD4, 0x66,
    0xB1, 0x76, 0xFB, 0x83, 0x1C, 0xF7, 0x26, 0x7E,
  ]);
  writer.writeBytes(footerMagic);
}
