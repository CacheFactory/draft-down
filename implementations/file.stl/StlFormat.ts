// @archigraph file.stl-format
// STL (stereolithography) import/export for DraftDown

import { Vec3 } from '../../src/core/types';
import { IMesh, IVertex, IFace } from '../../src/core/interfaces';

// ─── Types ──────────────────────────────────────────────────────

export interface StlTriangle {
  normal: Vec3;
  v1: Vec3;
  v2: Vec3;
  v3: Vec3;
  attributeByteCount: number;
}

export interface StlImportResult {
  triangles: StlTriangle[];
  vertices: Vec3[];
  /** Maps each face (3 consecutive vertex indices) */
  faceIndices: Array<[number, number, number]>;
  name: string;
}

export interface StlExportOptions {
  binary?: boolean;
  name?: string;
}

// ─── Triangulation Helper ───────────────────────────────────────

/**
 * Fan-triangulate a polygon defined by ordered vertices.
 * Returns arrays of 3 vertices per triangle.
 */
function triangulateFace(positions: Vec3[]): Array<[Vec3, Vec3, Vec3]> {
  if (positions.length < 3) return [];
  const triangles: Array<[Vec3, Vec3, Vec3]> = [];
  // Simple fan triangulation from vertex 0
  for (let i = 1; i < positions.length - 1; i++) {
    triangles.push([positions[0], positions[i], positions[i + 1]]);
  }
  return triangles;
}

function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  const ux = v2.x - v1.x, uy = v2.y - v1.y, uz = v2.z - v1.z;
  const vx = v3.x - v1.x, vy = v3.y - v1.y, vz = v3.z - v1.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: nx / len, y: ny / len, z: nz / len };
}

// ─── Binary STL Export ──────────────────────────────────────────

export function exportStlBinary(mesh: IMesh, options: StlExportOptions = {}): ArrayBuffer {
  const { name = 'DraftDown Export' } = options;

  // Collect all triangles from faces
  const allTriangles: Array<{ normal: Vec3; v1: Vec3; v2: Vec3; v3: Vec3 }> = [];

  for (const face of mesh.faces.values()) {
    const positions: Vec3[] = [];
    for (const vid of face.vertexIds) {
      const v = mesh.vertices.get(vid);
      if (v) positions.push(v.position);
    }

    const tris = triangulateFace(positions);
    for (const [p1, p2, p3] of tris) {
      const normal = computeNormal(p1, p2, p3);
      allTriangles.push({ normal, v1: p1, v2: p2, v3: p3 });
    }
  }

  // Binary STL: 80-byte header + 4-byte count + 50 bytes per triangle
  const triCount = allTriangles.length;
  const bufferSize = 80 + 4 + triCount * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // Write header (80 bytes, padded with zeros)
  const headerBytes = new TextEncoder().encode(name.substring(0, 79));
  u8.set(headerBytes, 0);

  // Triangle count
  view.setUint32(80, triCount, true);

  // Write triangles
  let offset = 84;
  for (const tri of allTriangles) {
    // Normal
    view.setFloat32(offset, tri.normal.x, true); offset += 4;
    view.setFloat32(offset, tri.normal.y, true); offset += 4;
    view.setFloat32(offset, tri.normal.z, true); offset += 4;
    // Vertex 1
    view.setFloat32(offset, tri.v1.x, true); offset += 4;
    view.setFloat32(offset, tri.v1.y, true); offset += 4;
    view.setFloat32(offset, tri.v1.z, true); offset += 4;
    // Vertex 2
    view.setFloat32(offset, tri.v2.x, true); offset += 4;
    view.setFloat32(offset, tri.v2.y, true); offset += 4;
    view.setFloat32(offset, tri.v2.z, true); offset += 4;
    // Vertex 3
    view.setFloat32(offset, tri.v3.x, true); offset += 4;
    view.setFloat32(offset, tri.v3.y, true); offset += 4;
    view.setFloat32(offset, tri.v3.z, true); offset += 4;
    // Attribute byte count
    view.setUint16(offset, 0, true); offset += 2;
  }

  return buffer;
}

// ─── ASCII STL Export ───────────────────────────────────────────

export function exportStlAscii(mesh: IMesh, options: StlExportOptions = {}): string {
  const { name = 'DraftDown' } = options;
  const lines: string[] = [];
  lines.push(`solid ${name}`);

  for (const face of mesh.faces.values()) {
    const positions: Vec3[] = [];
    for (const vid of face.vertexIds) {
      const v = mesh.vertices.get(vid);
      if (v) positions.push(v.position);
    }

    const tris = triangulateFace(positions);
    for (const [p1, p2, p3] of tris) {
      const n = computeNormal(p1, p2, p3);
      lines.push(`  facet normal ${n.x.toExponential(6)} ${n.y.toExponential(6)} ${n.z.toExponential(6)}`);
      lines.push('    outer loop');
      lines.push(`      vertex ${p1.x.toExponential(6)} ${p1.y.toExponential(6)} ${p1.z.toExponential(6)}`);
      lines.push(`      vertex ${p2.x.toExponential(6)} ${p2.y.toExponential(6)} ${p2.z.toExponential(6)}`);
      lines.push(`      vertex ${p3.x.toExponential(6)} ${p3.y.toExponential(6)} ${p3.z.toExponential(6)}`);
      lines.push('    endloop');
      lines.push('  endfacet');
    }
  }

  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}

// ─── Convenience export ─────────────────────────────────────────

export function exportStl(mesh: IMesh, options: StlExportOptions = {}): ArrayBuffer | string {
  if (options.binary !== false) {
    return exportStlBinary(mesh, options);
  }
  return exportStlAscii(mesh, options);
}

// ─── Binary STL Import ──────────────────────────────────────────

function importStlBinary(data: ArrayBuffer): StlImportResult {
  const view = new DataView(data);
  const u8 = new Uint8Array(data);

  // Read header for name
  const headerBytes = u8.slice(0, 80);
  const name = new TextDecoder().decode(headerBytes).replace(/\0+$/, '').trim();

  const triCount = view.getUint32(80, true);
  const triangles: StlTriangle[] = [];
  const vertices: Vec3[] = [];
  const faceIndices: Array<[number, number, number]> = [];

  // De-duplicate vertices by position (within epsilon)
  const vertexMap = new Map<string, number>();
  const EPSILON_DIGITS = 6;

  function getOrAddVertex(v: Vec3): number {
    const key = `${v.x.toFixed(EPSILON_DIGITS)},${v.y.toFixed(EPSILON_DIGITS)},${v.z.toFixed(EPSILON_DIGITS)}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const idx = vertices.length;
    vertices.push(v);
    vertexMap.set(key, idx);
    return idx;
  }

  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    if (offset + 50 > data.byteLength) break;

    const normal: Vec3 = {
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
    };
    offset += 12;

    const v1: Vec3 = {
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
    };
    offset += 12;

    const v2: Vec3 = {
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
    };
    offset += 12;

    const v3: Vec3 = {
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
    };
    offset += 12;

    const attrByteCount = view.getUint16(offset, true);
    offset += 2;

    triangles.push({ normal, v1, v2, v3, attributeByteCount: attrByteCount });

    const i1 = getOrAddVertex(v1);
    const i2 = getOrAddVertex(v2);
    const i3 = getOrAddVertex(v3);
    faceIndices.push([i1, i2, i3]);
  }

  return { triangles, vertices, faceIndices, name };
}

// ─── ASCII STL Import ───────────────────────────────────────────

function importStlAscii(text: string): StlImportResult {
  const triangles: StlTriangle[] = [];
  const vertices: Vec3[] = [];
  const faceIndices: Array<[number, number, number]> = [];
  const vertexMap = new Map<string, number>();
  const EPSILON_DIGITS = 6;

  function getOrAddVertex(v: Vec3): number {
    const key = `${v.x.toFixed(EPSILON_DIGITS)},${v.y.toFixed(EPSILON_DIGITS)},${v.z.toFixed(EPSILON_DIGITS)}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const idx = vertices.length;
    vertices.push(v);
    vertexMap.set(key, idx);
    return idx;
  }

  // Extract solid name
  const solidMatch = text.match(/^solid\s+(.*)/m);
  const name = solidMatch ? solidMatch[1].trim() : '';

  // Parse facets
  const facetRegex = /facet\s+normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+outer\s+loop\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+endloop\s+endfacet/g;

  let match: RegExpExecArray | null;
  while ((match = facetRegex.exec(text)) !== null) {
    const normal: Vec3 = {
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      z: parseFloat(match[3]),
    };
    const v1: Vec3 = { x: parseFloat(match[4]), y: parseFloat(match[5]), z: parseFloat(match[6]) };
    const v2: Vec3 = { x: parseFloat(match[7]), y: parseFloat(match[8]), z: parseFloat(match[9]) };
    const v3: Vec3 = { x: parseFloat(match[10]), y: parseFloat(match[11]), z: parseFloat(match[12]) };

    triangles.push({ normal, v1, v2, v3, attributeByteCount: 0 });

    const i1 = getOrAddVertex(v1);
    const i2 = getOrAddVertex(v2);
    const i3 = getOrAddVertex(v3);
    faceIndices.push([i1, i2, i3]);
  }

  return { triangles, vertices, faceIndices, name };
}

// ─── Auto-detect Import ─────────────────────────────────────────

/**
 * Import an STL file. Automatically detects whether the data is
 * binary or ASCII format.
 */
export function importStl(data: ArrayBuffer): StlImportResult {
  // Heuristic: ASCII STL starts with "solid" keyword
  // But some binary STL also start with "solid" in the header,
  // so also check if the file size matches the expected binary size.
  const u8 = new Uint8Array(data);
  const header = new TextDecoder().decode(u8.slice(0, 5));

  if (header === 'solid' && data.byteLength > 84) {
    // Check if file size matches binary format
    const view = new DataView(data);
    const triCount = view.getUint32(80, true);
    const expectedBinarySize = 84 + triCount * 50;

    if (expectedBinarySize !== data.byteLength) {
      // Likely ASCII
      const text = new TextDecoder().decode(u8);
      return importStlAscii(text);
    }
  }

  if (data.byteLength <= 84) {
    // Too small for binary, try ASCII
    const text = new TextDecoder().decode(u8);
    return importStlAscii(text);
  }

  return importStlBinary(data);
}
