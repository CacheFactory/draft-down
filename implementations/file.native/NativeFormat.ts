// @archigraph file.native-format
// Native .sketch binary format for DraftDown

import { Vec3, Color, Transform, Quaternion, LengthUnit, MaterialDef } from '../../src/core/types';
import {
  IModelDocument, DocumentMetadata, IVertex, IEdge, IFace,
  ILayer, IScenePage, IGroup, IComponentDefinition,
} from '../../src/core/interfaces';

// ─── Constants ──────────────────────────────────────────────────

const MAGIC = 0x53_4B_43_48; // 'SKCH' in big-endian
const FORMAT_VERSION = 1;

const enum SectionType {
  Metadata   = 0x01,
  Vertices   = 0x02,
  Edges      = 0x03,
  Faces      = 0x04,
  Materials  = 0x05,
  Layers     = 0x06,
  SceneGraph = 0x07,
  Pages      = 0x08,
  Components = 0x09,
  End        = 0xFF,
}

// ─── Helpers ────────────────────────────────────────────────────

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeJSON(obj: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(obj));
}

function decodeJSON<T>(bytes: Uint8Array): T {
  return JSON.parse(textDecoder.decode(bytes)) as T;
}

function writeVec3(view: DataView, offset: number, v: Vec3): number {
  view.setFloat64(offset, v.x, true);
  view.setFloat64(offset + 8, v.y, true);
  view.setFloat64(offset + 16, v.z, true);
  return offset + 24;
}

function readVec3(view: DataView, offset: number): { v: Vec3; offset: number } {
  const v: Vec3 = {
    x: view.getFloat64(offset, true),
    y: view.getFloat64(offset + 8, true),
    z: view.getFloat64(offset + 16, true),
  };
  return { v, offset: offset + 24 };
}

// ─── Section Writing ────────────────────────────────────────────

function writeSectionHeader(view: DataView, offset: number, type: SectionType, size: number): number {
  view.setUint8(offset, type);
  view.setUint32(offset + 1, size, true);
  return offset + 5;
}

function buildMetadataSection(metadata: DocumentMetadata): Uint8Array {
  return encodeJSON(metadata);
}

function buildVerticesSection(vertices: Map<string, IVertex>): ArrayBuffer {
  // Layout per vertex: id-length(u16) + id(utf8) + position(3xf64) + flags(u8)
  const entries: Array<{ idBytes: Uint8Array; v: IVertex }> = [];
  let totalSize = 0;
  for (const v of vertices.values()) {
    const idBytes = textEncoder.encode(v.id);
    entries.push({ idBytes, v });
    totalSize += 2 + idBytes.length + 24 + 1; // u16 + id + 3*f64 + flags
  }

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let off = 0;

  for (const { idBytes, v } of entries) {
    view.setUint16(off, idBytes.length, true);
    off += 2;
    u8.set(idBytes, off);
    off += idBytes.length;
    off = writeVec3(view, off, v.position);
    const flags = (v.selected ? 1 : 0) | (v.hidden ? 2 : 0);
    view.setUint8(off, flags);
    off += 1;
  }
  return buf;
}

function buildEdgesSection(edges: Map<string, IEdge>): Uint8Array {
  return encodeJSON(
    Array.from(edges.values()).map(e => ({
      id: e.id,
      sv: e.startVertexId,
      ev: e.endVertexId,
      soft: e.soft,
      smooth: e.smooth,
      mi: e.materialIndex,
      sel: e.selected,
      hid: e.hidden,
    })),
  );
}

function buildFacesSection(faces: Map<string, IFace>): Uint8Array {
  return encodeJSON(
    Array.from(faces.values()).map(f => ({
      id: f.id,
      vids: f.vertexIds,
      n: f.normal,
      pl: f.plane,
      mi: f.materialIndex,
      bmi: f.backMaterialIndex,
      sel: f.selected,
      hid: f.hidden,
      area: f.area,
    })),
  );
}

function buildMaterialsSection(materials: Map<string, MaterialDef>): Uint8Array {
  return encodeJSON(Array.from(materials.values()));
}

function buildLayersSection(layers: Map<string, ILayer>): Uint8Array {
  return encodeJSON(Array.from(layers.values()));
}

function buildSceneGraphSection(root: IGroup): Uint8Array {
  return encodeJSON(root);
}

function buildPagesSection(pages: IScenePage[]): Uint8Array {
  return encodeJSON(pages);
}

function buildComponentsSection(defs: Map<string, IComponentDefinition>): Uint8Array {
  return encodeJSON(Array.from(defs.values()));
}

// ─── Serialize ──────────────────────────────────────────────────

export function serialize(document: IModelDocument): ArrayBuffer {
  const mesh = document.geometry.getMesh();

  // Build all sections
  const sections: Array<{ type: SectionType; data: Uint8Array | ArrayBuffer }> = [
    { type: SectionType.Metadata,   data: buildMetadataSection(document.metadata) },
    { type: SectionType.Vertices,   data: buildVerticesSection(mesh.vertices) },
    { type: SectionType.Edges,      data: buildEdgesSection(mesh.edges) },
    { type: SectionType.Faces,      data: buildFacesSection(mesh.faces) },
    { type: SectionType.Materials,  data: buildMaterialsSection(document.materials.materials) },
    { type: SectionType.Layers,     data: buildLayersSection(document.scene.layers) },
    { type: SectionType.SceneGraph, data: buildSceneGraphSection(document.scene.root) },
    { type: SectionType.Pages,      data: buildPagesSection(document.scene.scenePages) },
    { type: SectionType.Components, data: buildComponentsSection(document.scene.componentDefinitions) },
  ];

  // Calculate total size: header(8) + sections(5 + data each) + end-marker(5)
  const headerSize = 8; // magic(4) + version(4)
  let totalSize = headerSize;
  for (const s of sections) {
    totalSize += 5 + (s.data instanceof ArrayBuffer ? s.data.byteLength : s.data.length);
  }
  totalSize += 5; // end section header

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let offset = 0;

  // Write header
  view.setUint32(offset, MAGIC, false); // big-endian for readable magic
  offset += 4;
  view.setUint32(offset, FORMAT_VERSION, true);
  offset += 4;

  // Write sections
  for (const s of sections) {
    const bytes = s.data instanceof ArrayBuffer ? new Uint8Array(s.data) : s.data;
    offset = writeSectionHeader(view, offset, s.type, bytes.length);
    u8.set(bytes, offset);
    offset += bytes.length;
  }

  // End marker
  writeSectionHeader(view, offset, SectionType.End, 0);

  return buffer;
}

// ─── Parsed Document Data ───────────────────────────────────────

export interface ParsedNativeData {
  metadata: DocumentMetadata;
  vertices: IVertex[];
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
    normal: Vec3;
    plane: { normal: Vec3; distance: number };
    materialIndex: number;
    backMaterialIndex: number;
    selected: boolean;
    hidden: boolean;
    area: number;
  }>;
  materials: MaterialDef[];
  layers: ILayer[];
  sceneGraph: IGroup;
  pages: IScenePage[];
  components: IComponentDefinition[];
}

// ─── Deserialize ────────────────────────────────────────────────

export function deserialize(data: ArrayBuffer): ParsedNativeData {
  const view = new DataView(data);
  const u8 = new Uint8Array(data);
  let offset = 0;

  // Read header
  const magic = view.getUint32(offset, false);
  offset += 4;
  if (magic !== MAGIC) {
    throw new Error(`Invalid file: expected magic 0x${MAGIC.toString(16)}, got 0x${magic.toString(16)}`);
  }

  const version = view.getUint32(offset, true);
  offset += 4;
  if (version > FORMAT_VERSION) {
    throw new Error(`Unsupported format version ${version} (max supported: ${FORMAT_VERSION})`);
  }

  const result: Partial<ParsedNativeData> = {};

  // Read sections
  while (offset < data.byteLength) {
    const sectionType = view.getUint8(offset) as SectionType;
    const sectionSize = view.getUint32(offset + 1, true);
    offset += 5;

    if (sectionType === SectionType.End) break;

    const sectionBytes = u8.slice(offset, offset + sectionSize);
    offset += sectionSize;

    switch (sectionType) {
      case SectionType.Metadata:
        result.metadata = decodeJSON<DocumentMetadata>(sectionBytes);
        break;

      case SectionType.Vertices:
        result.vertices = parseVerticesSection(sectionBytes);
        break;

      case SectionType.Edges:
        result.edges = decodeJSON(sectionBytes);
        break;

      case SectionType.Faces:
        result.faces = decodeJSON(sectionBytes);
        break;

      case SectionType.Materials:
        result.materials = decodeJSON<MaterialDef[]>(sectionBytes);
        break;

      case SectionType.Layers:
        result.layers = decodeJSON<ILayer[]>(sectionBytes);
        break;

      case SectionType.SceneGraph:
        result.sceneGraph = decodeJSON<IGroup>(sectionBytes);
        break;

      case SectionType.Pages:
        result.pages = decodeJSON<IScenePage[]>(sectionBytes);
        break;

      case SectionType.Components:
        result.components = decodeJSON<IComponentDefinition[]>(sectionBytes);
        break;

      default:
        // Skip unknown sections for forward compatibility
        break;
    }
  }

  return result as ParsedNativeData;
}

function parseVerticesSection(bytes: Uint8Array): IVertex[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertices: IVertex[] = [];
  let off = 0;

  while (off < bytes.length) {
    const idLen = view.getUint16(off, true);
    off += 2;
    const id = textDecoder.decode(bytes.slice(off, off + idLen));
    off += idLen;
    const { v: position, offset: newOff } = readVec3(view, off);
    off = newOff;
    const flags = view.getUint8(off);
    off += 1;

    vertices.push({
      id,
      position,
      selected: (flags & 1) !== 0,
      hidden: (flags & 2) !== 0,
    });
  }

  return vertices;
}
