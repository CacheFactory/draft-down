// @archigraph file.dxf-format
// AutoCAD DXF import/export for DraftDown

import { Vec3 } from '../../src/core/types';
import { IMesh } from '../../src/core/interfaces';

// ─── Types ──────────────────────────────────────────────────────

export interface DxfImportResult {
  lines: Array<{ start: Vec3; end: Vec3; layer: string }>;
  faces3d: Array<{ vertices: [Vec3, Vec3, Vec3] | [Vec3, Vec3, Vec3, Vec3]; layer: string }>;
  polylines: Array<{ vertices: Vec3[]; closed: boolean; layer: string }>;
  arcs: Array<{ center: Vec3; radius: number; startAngle: number; endAngle: number; layer: string }>;
  circles: Array<{ center: Vec3; radius: number; layer: string }>;
}

export interface DxfExportOptions {
  /** DXF layer name for geometry */
  layerName?: string;
  /** Decimal precision for coordinates */
  precision?: number;
}

// ─── DXF Writer Helpers ─────────────────────────────────────────

function dxfPair(code: number, value: string | number): string {
  return `${code}\n${value}`;
}

function dxfSection(name: string, content: string): string {
  return [
    dxfPair(0, 'SECTION'),
    dxfPair(2, name),
    content,
    dxfPair(0, 'ENDSEC'),
  ].join('\n');
}

function dxfVertex(groupBase: number, v: Vec3, precision: number): string {
  return [
    dxfPair(groupBase, v.x.toFixed(precision)),
    dxfPair(groupBase + 10, v.y.toFixed(precision)),
    dxfPair(groupBase + 20, v.z.toFixed(precision)),
  ].join('\n');
}

// ─── Export ─────────────────────────────────────────────────────

// Fixed handles for the drawing skeleton objects (hex strings). Entity
// handles are allocated sequentially above ENTITY_HANDLE_BASE; $HANDSEED
// is written past them all.
const DXF_H = {
  ltypeTable: '5', ltypeByBlock: '14', ltypeByLayer: '15', ltypeContinuous: '16',
  layerTable: '2', layer0: '10', layerCustom: '17',
  styleTable: '3', styleStandard: '11',
  appidTable: '9', appidAcad: '12',
  blockRecTable: '1', blockRecModel: '1F', blockRecPaper: '1B',
  blockModelBegin: '20', blockModelEnd: '21',
  blockPaperBegin: '1C', blockPaperEnd: '1D',
  vportTable: '8', vportActive: '29',
} as const;
const ENTITY_HANDLE_BASE = 0x100;

export function exportDxf(mesh: IMesh, options: DxfExportOptions = {}): string {
  const {
    layerName = '0',
    precision = 6,
  } = options;

  // Every entity needs a unique handle (5), an owner (330 → model space
  // block record), and subclass markers (100) — without them DWG converters
  // (LibreDWG dxf2dwg) silently drop the entities, and AutoCAD complains.
  let nextHandle = ENTITY_HANDLE_BASE;
  const entityHandle = () => (nextHandle++).toString(16).toUpperCase();
  const entityPrefix = (type: string, subclass: string) => [
    dxfPair(0, type),
    dxfPair(5, entityHandle()),
    dxfPair(330, DXF_H.blockRecModel),
    dxfPair(100, 'AcDbEntity'),
    dxfPair(8, layerName),
    dxfPair(100, subclass),
  ].join('\n');

  const entities: string[] = [];

  // Export edges as LINE entities
  for (const edge of mesh.edges.values()) {
    const startVertex = mesh.vertices.get(edge.startVertexId);
    const endVertex = mesh.vertices.get(edge.endVertexId);
    if (!startVertex || !endVertex) continue;

    entities.push([
      entityPrefix('LINE', 'AcDbLine'),
      dxfVertex(10, startVertex.position, precision),
      dxfVertex(11, endVertex.position, precision),
    ].join('\n'));
  }

  // Export faces as 3DFACE entities
  for (const face of mesh.faces.values()) {
    const vids = face.vertexIds;
    if (vids.length < 3) continue;

    // Fan-triangulate n-gons into 3DFACEs (3 or 4 vertex faces)
    const positions: Vec3[] = [];
    for (const vid of vids) {
      const v = mesh.vertices.get(vid);
      if (v) positions.push(v.position);
    }

    if (positions.length === 3) {
      // 3-vertex face: emit one 3DFACE with 4th vertex = 3rd vertex
      entities.push([
        entityPrefix('3DFACE', 'AcDbFace'),
        dxfVertex(10, positions[0], precision),
        dxfVertex(11, positions[1], precision),
        dxfVertex(12, positions[2], precision),
        dxfVertex(13, positions[2], precision), // duplicate last for triangle
      ].join('\n'));
    } else if (positions.length === 4) {
      entities.push([
        entityPrefix('3DFACE', 'AcDbFace'),
        dxfVertex(10, positions[0], precision),
        dxfVertex(11, positions[1], precision),
        dxfVertex(12, positions[2], precision),
        dxfVertex(13, positions[3], precision),
      ].join('\n'));
    } else {
      // Fan-triangulate into 3DFACE triangles
      for (let i = 1; i < positions.length - 1; i++) {
        entities.push([
          entityPrefix('3DFACE', 'AcDbFace'),
          dxfVertex(10, positions[0], precision),
          dxfVertex(11, positions[i], precision),
          dxfVertex(12, positions[i + 1], precision),
          dxfVertex(13, positions[i + 1], precision),
        ].join('\n'));
      }
    }
  }

  // Complete R2000 drawing skeleton: HEADER with $HANDSEED, symbol tables
  // (VPORT/LTYPE/LAYER/STYLE/APPID/BLOCK_RECORD) with handles and subclass
  // markers, and a BLOCKS section defining *Model_Space/*Paper_Space.
  // A bare ENTITIES-only DXF is readable by many viewers, but DWG
  // converters and AutoCAD need the skeleton to resolve layers, linetypes,
  // and entity ownership.
  const header = [
    dxfPair(9, '$ACADVER'),
    dxfPair(1, 'AC1015'), // AutoCAD 2000
    dxfPair(9, '$HANDSEED'),
    dxfPair(5, Math.max(nextHandle + 1, 0xffff).toString(16).toUpperCase()),
    dxfPair(9, '$INSUNITS'),
    dxfPair(70, 6), // meters
  ].join('\n');

  const table = (name: string, tableHandle: string, tableEntries: string[]) => [
    dxfPair(0, 'TABLE'), dxfPair(2, name), dxfPair(5, tableHandle), dxfPair(330, '0'),
    dxfPair(100, 'AcDbSymbolTable'), dxfPair(70, tableEntries.length),
    ...tableEntries, dxfPair(0, 'ENDTAB'),
  ].join('\n');

  const ltypeEntry = (h: string, name: string) => [
    dxfPair(0, 'LTYPE'), dxfPair(5, h), dxfPair(330, DXF_H.ltypeTable),
    dxfPair(100, 'AcDbSymbolTableRecord'), dxfPair(100, 'AcDbLinetypeTableRecord'),
    dxfPair(2, name), dxfPair(70, 0), dxfPair(3, ''), dxfPair(72, 65),
    dxfPair(73, 0), dxfPair(40, '0.0'),
  ].join('\n');

  const layerEntry = (h: string, name: string) => [
    dxfPair(0, 'LAYER'), dxfPair(5, h), dxfPair(330, DXF_H.layerTable),
    dxfPair(100, 'AcDbSymbolTableRecord'), dxfPair(100, 'AcDbLayerTableRecord'),
    dxfPair(2, name), dxfPair(70, 0), dxfPair(62, 7), dxfPair(6, 'CONTINUOUS'),
  ].join('\n');

  const blockRecEntry = (h: string, name: string) => [
    dxfPair(0, 'BLOCK_RECORD'), dxfPair(5, h), dxfPair(330, DXF_H.blockRecTable),
    dxfPair(100, 'AcDbSymbolTableRecord'), dxfPair(100, 'AcDbBlockTableRecord'),
    dxfPair(2, name),
  ].join('\n');

  const layerEntries = [layerEntry(DXF_H.layer0, '0')];
  if (layerName !== '0') layerEntries.push(layerEntry(DXF_H.layerCustom, layerName));

  const tables = [
    table('VPORT', DXF_H.vportTable, [[
      dxfPair(0, 'VPORT'), dxfPair(5, DXF_H.vportActive), dxfPair(330, DXF_H.vportTable),
      dxfPair(100, 'AcDbSymbolTableRecord'), dxfPair(100, 'AcDbViewportTableRecord'),
      dxfPair(2, '*Active'), dxfPair(70, 0),
    ].join('\n')]),
    table('LTYPE', DXF_H.ltypeTable, [
      ltypeEntry(DXF_H.ltypeByBlock, 'ByBlock'),
      ltypeEntry(DXF_H.ltypeByLayer, 'ByLayer'),
      ltypeEntry(DXF_H.ltypeContinuous, 'CONTINUOUS'),
    ]),
    table('LAYER', DXF_H.layerTable, layerEntries),
    table('STYLE', DXF_H.styleTable, [[
      dxfPair(0, 'STYLE'), dxfPair(5, DXF_H.styleStandard), dxfPair(330, DXF_H.styleTable),
      dxfPair(100, 'AcDbSymbolTableRecord'), dxfPair(100, 'AcDbTextStyleTableRecord'),
      dxfPair(2, 'Standard'), dxfPair(70, 0), dxfPair(40, '0.0'), dxfPair(41, '1.0'),
      dxfPair(50, '0.0'), dxfPair(71, 0), dxfPair(42, '2.5'), dxfPair(3, 'txt'), dxfPair(4, ''),
    ].join('\n')]),
    table('APPID', DXF_H.appidTable, [[
      dxfPair(0, 'APPID'), dxfPair(5, DXF_H.appidAcad), dxfPair(330, DXF_H.appidTable),
      dxfPair(100, 'AcDbSymbolTableRecord'), dxfPair(100, 'AcDbRegAppTableRecord'),
      dxfPair(2, 'ACAD'), dxfPair(70, 0),
    ].join('\n')]),
    table('BLOCK_RECORD', DXF_H.blockRecTable, [
      blockRecEntry(DXF_H.blockRecModel, '*Model_Space'),
      blockRecEntry(DXF_H.blockRecPaper, '*Paper_Space'),
    ]),
  ].join('\n');

  const blockDef = (begin: string, end: string, owner: string, name: string) => [
    dxfPair(0, 'BLOCK'), dxfPair(5, begin), dxfPair(330, owner),
    dxfPair(100, 'AcDbEntity'), dxfPair(8, '0'), dxfPair(100, 'AcDbBlockBegin'),
    dxfPair(2, name), dxfPair(70, 0),
    dxfPair(10, '0.0'), dxfPair(20, '0.0'), dxfPair(30, '0.0'),
    dxfPair(3, name), dxfPair(1, ''),
    dxfPair(0, 'ENDBLK'), dxfPair(5, end), dxfPair(330, owner),
    dxfPair(100, 'AcDbEntity'), dxfPair(8, '0'), dxfPair(100, 'AcDbBlockEnd'),
  ].join('\n');

  const blocks = [
    blockDef(DXF_H.blockModelBegin, DXF_H.blockModelEnd, DXF_H.blockRecModel, '*Model_Space'),
    blockDef(DXF_H.blockPaperBegin, DXF_H.blockPaperEnd, DXF_H.blockRecPaper, '*Paper_Space'),
  ].join('\n');

  const dxf = [
    dxfSection('HEADER', header),
    dxfSection('TABLES', tables),
    dxfSection('BLOCKS', blocks),
    dxfSection('ENTITIES', entities.join('\n')),
    dxfPair(0, 'EOF'),
  ].join('\n');

  return dxf;
}

// ─── Import ─────────────────────────────────────────────────────

export function importDxf(text: string): DxfImportResult {
  const lines: DxfImportResult['lines'] = [];
  const faces3d: DxfImportResult['faces3d'] = [];
  const polylines: DxfImportResult['polylines'] = [];
  const arcs: DxfImportResult['arcs'] = [];
  const circles: DxfImportResult['circles'] = [];

  // Parse DXF into group code/value pairs
  const rawLines = text.split(/\r?\n/);
  const pairs: Array<{ code: number; value: string }> = [];
  for (let i = 0; i < rawLines.length - 1; i += 2) {
    const code = parseInt(rawLines[i].trim(), 10);
    const value = rawLines[i + 1]?.trim() ?? '';
    if (!isNaN(code)) {
      pairs.push({ code, value });
    }
  }

  // Find ENTITIES section
  let inEntities = false;
  let i = 0;

  while (i < pairs.length) {
    const { code, value } = pairs[i];

    if (code === 0 && value === 'SECTION') {
      if (i + 1 < pairs.length && pairs[i + 1].code === 2 && pairs[i + 1].value === 'ENTITIES') {
        inEntities = true;
        i += 2;
        continue;
      }
    }

    if (code === 0 && value === 'ENDSEC') {
      inEntities = false;
      i++;
      continue;
    }

    if (!inEntities) {
      i++;
      continue;
    }

    // Parse LINE entity
    if (code === 0 && value === 'LINE') {
      const entity: Record<number, number> = {};
      let layer = '0';
      i++;
      while (i < pairs.length && !(pairs[i].code === 0)) {
        if (pairs[i].code === 8) layer = pairs[i].value;
        entity[pairs[i].code] = parseFloat(pairs[i].value);
        i++;
      }
      lines.push({
        start: { x: entity[10] ?? 0, y: entity[20] ?? 0, z: entity[30] ?? 0 },
        end: { x: entity[11] ?? 0, y: entity[21] ?? 0, z: entity[31] ?? 0 },
        layer,
      });
      continue;
    }

    // Parse 3DFACE entity
    if (code === 0 && value === '3DFACE') {
      const entity: Record<number, number> = {};
      let layer = '0';
      i++;
      while (i < pairs.length && !(pairs[i].code === 0)) {
        if (pairs[i].code === 8) layer = pairs[i].value;
        entity[pairs[i].code] = parseFloat(pairs[i].value);
        i++;
      }
      const v0: Vec3 = { x: entity[10] ?? 0, y: entity[20] ?? 0, z: entity[30] ?? 0 };
      const v1: Vec3 = { x: entity[11] ?? 0, y: entity[21] ?? 0, z: entity[31] ?? 0 };
      const v2: Vec3 = { x: entity[12] ?? 0, y: entity[22] ?? 0, z: entity[32] ?? 0 };
      const v3: Vec3 = { x: entity[13] ?? 0, y: entity[23] ?? 0, z: entity[33] ?? 0 };

      // Check if v3 == v2 (triangle, not quad)
      const isTriangle =
        Math.abs(v3.x - v2.x) < 1e-10 &&
        Math.abs(v3.y - v2.y) < 1e-10 &&
        Math.abs(v3.z - v2.z) < 1e-10;

      if (isTriangle) {
        faces3d.push({ vertices: [v0, v1, v2], layer });
      } else {
        faces3d.push({ vertices: [v0, v1, v2, v3], layer });
      }
      continue;
    }

    // Parse POLYLINE entity (simplified)
    if (code === 0 && value === 'POLYLINE') {
      let layer = '0';
      let closed = false;
      const verts: Vec3[] = [];
      i++;
      // Read polyline flags
      while (i < pairs.length && pairs[i].code !== 0) {
        if (pairs[i].code === 8) layer = pairs[i].value;
        if (pairs[i].code === 70) closed = (parseInt(pairs[i].value) & 1) !== 0;
        i++;
      }
      // Read VERTEX entities until SEQEND
      while (i < pairs.length) {
        if (pairs[i].code === 0 && pairs[i].value === 'SEQEND') {
          i++;
          break;
        }
        if (pairs[i].code === 0 && pairs[i].value === 'VERTEX') {
          const vent: Record<number, number> = {};
          i++;
          while (i < pairs.length && pairs[i].code !== 0) {
            vent[pairs[i].code] = parseFloat(pairs[i].value);
            i++;
          }
          verts.push({ x: vent[10] ?? 0, y: vent[20] ?? 0, z: vent[30] ?? 0 });
          continue;
        }
        i++;
      }
      if (verts.length > 0) {
        polylines.push({ vertices: verts, closed, layer });
      }
      continue;
    }

    // Parse LWPOLYLINE entity: repeating 10/20 pairs on a common elevation
    if (code === 0 && value === 'LWPOLYLINE') {
      let layer = '0';
      let closed = false;
      let elevation = 0;
      const verts: Vec3[] = [];
      i++;
      while (i < pairs.length && pairs[i].code !== 0) {
        const c = pairs[i].code;
        if (c === 8) layer = pairs[i].value;
        if (c === 70) closed = (parseInt(pairs[i].value, 10) & 1) !== 0;
        if (c === 38) elevation = parseFloat(pairs[i].value) || 0;
        if (c === 10) verts.push({ x: parseFloat(pairs[i].value) || 0, y: 0, z: 0 });
        if (c === 20 && verts.length > 0) verts[verts.length - 1].y = parseFloat(pairs[i].value) || 0;
        i++;
      }
      for (const v of verts) v.z = elevation;
      if (verts.length > 1) polylines.push({ vertices: verts, closed, layer });
      continue;
    }

    // Parse ARC entity
    if (code === 0 && value === 'ARC') {
      const entity: Record<number, number> = {};
      let layer = '0';
      i++;
      while (i < pairs.length && pairs[i].code !== 0) {
        if (pairs[i].code === 8) layer = pairs[i].value;
        entity[pairs[i].code] = parseFloat(pairs[i].value);
        i++;
      }
      if ((entity[40] ?? 0) > 0) {
        arcs.push({
          center: { x: entity[10] ?? 0, y: entity[20] ?? 0, z: entity[30] ?? 0 },
          radius: entity[40],
          startAngle: entity[50] ?? 0,
          endAngle: entity[51] ?? 360,
          layer,
        });
      }
      continue;
    }

    // Parse CIRCLE entity
    if (code === 0 && value === 'CIRCLE') {
      const entity: Record<number, number> = {};
      let layer = '0';
      i++;
      while (i < pairs.length && pairs[i].code !== 0) {
        if (pairs[i].code === 8) layer = pairs[i].value;
        entity[pairs[i].code] = parseFloat(pairs[i].value);
        i++;
      }
      if ((entity[40] ?? 0) > 0) {
        circles.push({
          center: { x: entity[10] ?? 0, y: entity[20] ?? 0, z: entity[30] ?? 0 },
          radius: entity[40],
          layer,
        });
      }
      continue;
    }

    i++;
  }

  return { lines, faces3d, polylines, arcs, circles };
}
