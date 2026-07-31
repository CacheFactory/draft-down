// @archigraph file.obj-format
// Wavefront .obj import/export for DraftDown

import { Vec3 } from '../../src/core/types';
import { IVertex, IFace, IMesh } from '../../src/core/interfaces';

// ─── Types ──────────────────────────────────────────────────────

export interface ObjExportOptions {
  /** Include normals in export */
  normals?: boolean;
  /** Include texture coordinates (if available) */
  texCoords?: boolean;
  /** Material library filename (e.g. "model.mtl") */
  mtlLib?: string;
  /** Flip winding order */
  flipWinding?: boolean;
  /** Scale factor applied to all vertices */
  scale?: number;
}

export interface ObjMaterial {
  name: string;
  diffuseColor?: Vec3;
  specularColor?: Vec3;
  ambientColor?: Vec3;
  opacity?: number;
  shininess?: number;
  diffuseMap?: string;
  normalMap?: string;
}

export interface ObjImportResult {
  vertices: Vec3[];
  normals: Vec3[];
  texCoords: Array<{ u: number; v: number }>;
  faces: Array<{
    vertexIndices: number[];
    normalIndices: number[];
    texCoordIndices: number[];
    materialName: string | null;
    holeStartIndices?: number[];
    groupName?: string;
  }>;
  materialLibraries: string[];
  objectNames: string[];
  groupNames: string[];
}

// ─── Export ─────────────────────────────────────────────────────

export function exportObj(
  mesh: IMesh,
  materialNames?: Map<number, string>,
  options: ObjExportOptions = {},
): string {
  const {
    normals: includeNormals = true,
    mtlLib,
    flipWinding = false,
    scale = 1.0,
  } = options;

  const lines: string[] = [];
  lines.push('# Exported from DraftDown');
  lines.push(`# Vertices: ${mesh.vertices.size}, Faces: ${mesh.faces.size}`);
  lines.push('');

  if (mtlLib) {
    lines.push(`mtllib ${mtlLib}`);
    lines.push('');
  }

  // Build vertex index map: vertex id -> 1-based index
  const vertexIndexMap = new Map<string, number>();
  let vIdx = 1;

  // Write vertices
  for (const vertex of mesh.vertices.values()) {
    vertexIndexMap.set(vertex.id, vIdx++);
    const p = vertex.position;
    lines.push(`v ${(p.x * scale).toFixed(6)} ${(p.y * scale).toFixed(6)} ${(p.z * scale).toFixed(6)}`);
  }
  lines.push('');

  // Write normals
  const normalIndexMap = new Map<string, number>();
  if (includeNormals) {
    let nIdx = 1;
    for (const face of mesh.faces.values()) {
      normalIndexMap.set(face.id, nIdx++);
      const n = face.normal;
      lines.push(`vn ${n.x.toFixed(6)} ${n.y.toFixed(6)} ${n.z.toFixed(6)}`);
    }
    lines.push('');
  }

  // Group faces by material
  const facesByMaterial = new Map<number, IFace[]>();
  for (const face of mesh.faces.values()) {
    const mi = face.materialIndex;
    if (!facesByMaterial.has(mi)) {
      facesByMaterial.set(mi, []);
    }
    facesByMaterial.get(mi)!.push(face);
  }

  // Write faces grouped by material
  for (const [matIdx, faces] of facesByMaterial) {
    if (materialNames?.has(matIdx)) {
      lines.push(`usemtl ${materialNames.get(matIdx)}`);
    }

    for (const face of faces) {
      const vids = flipWinding ? [...face.vertexIds].reverse() : face.vertexIds;
      const nIdx = normalIndexMap.get(face.id);
      const faceTokens = vids.map(vid => {
        const vi = vertexIndexMap.get(vid);
        if (!vi) return '';
        if (includeNormals && nIdx !== undefined) {
          return `${vi}//${nIdx}`;
        }
        return `${vi}`;
      });
      lines.push(`f ${faceTokens.join(' ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── MTL Export ─────────────────────────────────────────────────

export function exportMtl(materials: ObjMaterial[]): string {
  const lines: string[] = [];
  lines.push('# Material Library exported from DraftDown');
  lines.push('');

  for (const mat of materials) {
    lines.push(`newmtl ${mat.name}`);
    if (mat.ambientColor) {
      lines.push(`Ka ${mat.ambientColor.x.toFixed(4)} ${mat.ambientColor.y.toFixed(4)} ${mat.ambientColor.z.toFixed(4)}`);
    }
    if (mat.diffuseColor) {
      lines.push(`Kd ${mat.diffuseColor.x.toFixed(4)} ${mat.diffuseColor.y.toFixed(4)} ${mat.diffuseColor.z.toFixed(4)}`);
    }
    if (mat.specularColor) {
      lines.push(`Ks ${mat.specularColor.x.toFixed(4)} ${mat.specularColor.y.toFixed(4)} ${mat.specularColor.z.toFixed(4)}`);
    }
    if (mat.shininess !== undefined) {
      lines.push(`Ns ${mat.shininess.toFixed(4)}`);
    }
    if (mat.opacity !== undefined) {
      lines.push(`d ${mat.opacity.toFixed(4)}`);
    } else {
      lines.push('d 1.0000');
    }
    lines.push('illum 2');
    if (mat.diffuseMap) {
      lines.push(`map_Kd ${mat.diffuseMap}`);
    }
    if (mat.normalMap) {
      lines.push(`map_bump ${mat.normalMap}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Import ─────────────────────────────────────────────────────

export function importObj(text: string): ObjImportResult {
  const vertices: Vec3[] = [];
  const normals: Vec3[] = [];
  const texCoords: Array<{ u: number; v: number }> = [];
  const faces: ObjImportResult['faces'] = [];
  const materialLibraries: string[] = [];
  const objectNames: string[] = [];
  const groupNames: string[] = [];

  let currentMaterial: string | null = null;
  let currentGroup: string | null = null;
  let pendingHoles: number[] | null = null;

  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) {
      // Parse "# holes 8 12 ..." comments for faces with inner loops
      if (line.startsWith('# holes ')) {
        pendingHoles = line.slice(8).trim().split(/\s+/).map(Number);
      }
      continue;
    }

    const parts = line.split(/\s+/);
    const keyword = parts[0];

    switch (keyword) {
      case 'v': {
        vertices.push({
          x: parseFloat(parts[1]) || 0,
          y: parseFloat(parts[2]) || 0,
          z: parseFloat(parts[3]) || 0,
        });
        break;
      }

      case 'vn': {
        normals.push({
          x: parseFloat(parts[1]) || 0,
          y: parseFloat(parts[2]) || 0,
          z: parseFloat(parts[3]) || 0,
        });
        break;
      }

      case 'vt': {
        texCoords.push({
          u: parseFloat(parts[1]) || 0,
          v: parseFloat(parts[2]) || 0,
        });
        break;
      }

      case 'f': {
        const vertexIndices: number[] = [];
        const normalIndices: number[] = [];
        const texCoordIndices: number[] = [];

        for (let i = 1; i < parts.length; i++) {
          const segments = parts[i].split('/');
          // OBJ indices are 1-based; convert to 0-based
          const vi = parseInt(segments[0], 10);
          vertexIndices.push(vi > 0 ? vi - 1 : vertices.length + vi);

          if (segments.length > 1 && segments[1] !== '') {
            const ti = parseInt(segments[1], 10);
            texCoordIndices.push(ti > 0 ? ti - 1 : texCoords.length + ti);
          }

          if (segments.length > 2 && segments[2] !== '') {
            const ni = parseInt(segments[2], 10);
            normalIndices.push(ni > 0 ? ni - 1 : normals.length + ni);
          }
        }

        const faceEntry: ObjImportResult['faces'][0] = {
          vertexIndices,
          normalIndices,
          texCoordIndices,
          materialName: currentMaterial,
        };
        if (pendingHoles) {
          faceEntry.holeStartIndices = pendingHoles;
          pendingHoles = null;
        }
        if (currentGroup && currentGroup !== 'default') {
          faceEntry.groupName = currentGroup;
        }
        faces.push(faceEntry);
        break;
      }

      case 'mtllib': {
        materialLibraries.push(parts.slice(1).join(' '));
        break;
      }

      case 'usemtl': {
        currentMaterial = parts.slice(1).join(' ');
        break;
      }

      case 'o': {
        objectNames.push(parts.slice(1).join(' '));
        break;
      }

      case 'g': {
        const gn = parts.slice(1).join(' ');
        groupNames.push(gn);
        currentGroup = gn;
        break;
      }

      // Ignore: s (smoothing groups), l (lines), etc.
      default:
        break;
    }
  }

  return {
    vertices,
    normals,
    texCoords,
    faces,
    materialLibraries,
    objectNames,
    groupNames,
  };
}

// ─── Parse MTL ──────────────────────────────────────────────────

export function parseMtl(text: string): ObjMaterial[] {
  const materials: ObjMaterial[] = [];
  let current: ObjMaterial | null = null;

  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const keyword = parts[0];

    switch (keyword) {
      case 'newmtl':
        if (current) materials.push(current);
        current = { name: parts.slice(1).join(' ') };
        break;

      case 'Ka':
        if (current) {
          current.ambientColor = {
            x: parseFloat(parts[1]) || 0,
            y: parseFloat(parts[2]) || 0,
            z: parseFloat(parts[3]) || 0,
          };
        }
        break;

      case 'Kd':
        if (current) {
          current.diffuseColor = {
            x: parseFloat(parts[1]) || 0,
            y: parseFloat(parts[2]) || 0,
            z: parseFloat(parts[3]) || 0,
          };
        }
        break;

      case 'Ks':
        if (current) {
          current.specularColor = {
            x: parseFloat(parts[1]) || 0,
            y: parseFloat(parts[2]) || 0,
            z: parseFloat(parts[3]) || 0,
          };
        }
        break;

      case 'Ns':
        if (current) current.shininess = parseFloat(parts[1]) || 0;
        break;

      case 'd':
        if (current) current.opacity = parseFloat(parts[1]) || 1;
        break;

      case 'Tr':
        if (current) current.opacity = 1 - (parseFloat(parts[1]) || 0);
        break;

      case 'map_Kd':
        if (current) current.diffuseMap = parts.slice(1).join(' ');
        break;

      case 'map_bump':
      case 'bump':
        if (current) current.normalMap = parts.slice(1).join(' ');
        break;

      default:
        break;
    }
  }

  if (current) materials.push(current);

  return materials;
}

// ─── Merge coplanar adjacent faces ──────────────────────────────

/**
 * Merges coplanar adjacent faces (typically triangles from DraftDown triangulation)
 * back into single polygon faces. Uses union-find to group faces, then reconstructs
 * boundary polygons for each group.
 */
export function mergeCoplanarFaces(
  vertices: Vec3[],
  faces: ObjImportResult['faces'],
): ObjImportResult['faces'] {
  if (faces.length < 2) return faces;
  const t0 = performance.now();

  const NORMAL_TOL = 0.002;
  const DIST_TOL = 0.005; // meters

  // Compute plane for each face
  const planes: Array<{ nx: number; ny: number; nz: number; d: number }> = [];
  for (const face of faces) {
    const idx = face.vertexIndices;
    if (idx.length < 3) { planes.push({ nx: 0, ny: 0, nz: 1, d: 0 }); continue; }
    const v0 = vertices[idx[0]], v1 = vertices[idx[1]], v2 = vertices[idx[2]];
    const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
    const e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const d = nx * v0.x + ny * v0.y + nz * v0.z;
    planes.push({ nx, ny, nz, d });
  }

  // Build edge-to-faces adjacency
  const edgeToFaces = new Map<string, number[]>();
  for (let fi = 0; fi < faces.length; fi++) {
    const idx = faces[fi].vertexIndices;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[i], b = idx[(i + 1) % idx.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const arr = edgeToFaces.get(key);
      if (arr) arr.push(fi);
      else edgeToFaces.set(key, [fi]);
    }
  }

  // Union-find
  const parent = new Int32Array(faces.length);
  const ufRank = new Int32Array(faces.length);
  for (let i = 0; i < faces.length; i++) parent[i] = i;
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function unite(a: number, b: number) {
    a = find(a); b = find(b);
    if (a === b) return;
    if (ufRank[a] < ufRank[b]) { const t = a; a = b; b = t; }
    parent[b] = a;
    if (ufRank[a] === ufRank[b]) ufRank[a]++;
  }

  // Merge coplanar adjacent faces with same material
  for (const faceIndices of edgeToFaces.values()) {
    if (faceIndices.length !== 2) continue;
    const [fi, fj] = faceIndices;
    const pi = planes[fi], pj = planes[fj];
    // Check same normal direction (not anti-parallel)
    const dot = pi.nx * pj.nx + pi.ny * pj.ny + pi.nz * pj.nz;
    if (dot < 1 - NORMAL_TOL) continue;
    // Check same plane distance
    if (Math.abs(pi.d - pj.d) > DIST_TOL) continue;
    // Check same material
    if (faces[fi].materialName !== faces[fj].materialName) continue;
    // Check same group (don't merge across component boundaries)
    if (faces[fi].groupName !== faces[fj].groupName) continue;
    unite(fi, fj);
  }

  // Group faces by root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < faces.length; i++) {
    const root = find(i);
    const arr = groups.get(root);
    if (arr) arr.push(i);
    else groups.set(root, [i]);
  }

  const result: ObjImportResult['faces'] = [];
  let mergedCount = 0;

  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(faces[group[0]]);
      continue;
    }

    // Collect edges; boundary edges appear once, internal appear twice
    const edgeCounts = new Map<string, number>();
    for (const fi of group) {
      const idx = faces[fi].vertexIndices;
      for (let i = 0; i < idx.length; i++) {
        const a = idx[i], b = idx[(i + 1) % idx.length];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }

    // Build boundary adjacency: vertex → next vertex (preserving winding)
    const boundaryNext = new Map<number, number>();
    for (const fi of group) {
      const idx = faces[fi].vertexIndices;
      for (let i = 0; i < idx.length; i++) {
        const a = idx[i], b = idx[(i + 1) % idx.length];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (edgeCounts.get(key) === 1) {
          boundaryNext.set(a, b);
        }
      }
    }

    // Walk boundary loops
    const visited = new Set<number>();
    const loops: number[][] = [];
    for (const startV of boundaryNext.keys()) {
      if (visited.has(startV)) continue;
      const loop: number[] = [];
      let v = startV;
      let safety = boundaryNext.size + 1;
      while (!visited.has(v) && safety-- > 0) {
        visited.add(v);
        loop.push(v);
        const next = boundaryNext.get(v);
        if (next === undefined) break;
        v = next;
      }
      if (loop.length >= 3) loops.push(loop);
    }

    if (loops.length === 0) {
      for (const fi of group) result.push(faces[fi]);
      continue;
    }

    // Multiple loops: one is the outer boundary, the rest are holes (windows/doors).
    // Identify the outer loop as the one with largest absolute signed area.
    if (loops.length > 1) {
      // Compute a 2D projection axis from the face normal
      const pl = planes[group[0]];
      const absnx = Math.abs(pl.nx), absny = Math.abs(pl.ny), absnz = Math.abs(pl.nz);
      let projU: (v: Vec3) => number, projV: (v: Vec3) => number;
      if (absnx >= absny && absnx >= absnz) {
        projU = v => v.y; projV = v => v.z;
      } else if (absny >= absnx && absny >= absnz) {
        projU = v => v.x; projV = v => v.z;
      } else {
        projU = v => v.x; projV = v => v.y;
      }

      // Compute signed area for each loop to find the outer one
      const signedArea = (loop: number[]): number => {
        let area = 0;
        for (let i = 0; i < loop.length; i++) {
          const a = vertices[loop[i]], b = vertices[loop[(i + 1) % loop.length]];
          area += projU(a) * projV(b) - projU(b) * projV(a);
        }
        return area / 2;
      };

      let outerIdx = 0;
      let maxArea = -Infinity;
      for (let i = 0; i < loops.length; i++) {
        const absArea = Math.abs(signedArea(loops[i]));
        if (absArea > maxArea) { maxArea = absArea; outerIdx = i; }
      }

      // Ensure outer loop has positive winding (CCW in projected plane)
      const outerLoop = loops[outerIdx];
      if (signedArea(outerLoop) < 0) outerLoop.reverse();

      // Build merged vertex list: outer loop first, then hole loops
      const mergedVertexIndices = [...outerLoop];
      const holeStarts: number[] = [];
      for (let i = 0; i < loops.length; i++) {
        if (i === outerIdx) continue;
        holeStarts.push(mergedVertexIndices.length);
        // Ensure hole loops have negative winding (CW = opposite of outer)
        const holeLoop = loops[i];
        if (signedArea(holeLoop) > 0) holeLoop.reverse();
        mergedVertexIndices.push(...holeLoop);
      }

      // Build vertex→texCoord map from original faces
      const vertexToTexCoord = new Map<number, number>();
      for (const fi of group) {
        const f = faces[fi];
        for (let i = 0; i < f.vertexIndices.length; i++) {
          if (i < f.texCoordIndices.length) {
            vertexToTexCoord.set(f.vertexIndices[i], f.texCoordIndices[i]);
          }
        }
      }

      const merged: ObjImportResult['faces'][0] = {
        vertexIndices: mergedVertexIndices,
        normalIndices: [],
        texCoordIndices: vertexToTexCoord.size > 0
          ? mergedVertexIndices.map(vi => vertexToTexCoord.get(vi) ?? 0)
          : [],
        materialName: faces[group[0]].materialName,
        holeStartIndices: holeStarts,
        groupName: faces[group[0]].groupName,
      };
      result.push(merged);
      mergedCount += group.length - 1;
      continue;
    }

    const mergedVertexIndices = [...loops[0]];
    const holeStarts: number[] = [];

    // Build vertex→texCoord map from original faces
    const vertexToTexCoord = new Map<number, number>();
    for (const fi of group) {
      const f = faces[fi];
      for (let i = 0; i < f.vertexIndices.length; i++) {
        if (i < f.texCoordIndices.length) {
          vertexToTexCoord.set(f.vertexIndices[i], f.texCoordIndices[i]);
        }
      }
    }

    const merged: ObjImportResult['faces'][0] = {
      vertexIndices: mergedVertexIndices,
      normalIndices: [],
      texCoordIndices: vertexToTexCoord.size > 0
        ? mergedVertexIndices.map(vi => vertexToTexCoord.get(vi) ?? 0)
        : [],
      materialName: faces[group[0]].materialName,
      groupName: faces[group[0]].groupName,
    };
    if (holeStarts.length > 0) merged.holeStartIndices = holeStarts;

    result.push(merged);
    mergedCount += group.length - 1;
  }

  console.log(`[mergeCoplanar] ${faces.length} faces → ${result.length} faces (merged ${mergedCount}) in ${(performance.now() - t0).toFixed(0)}ms`);
  return result;
}
