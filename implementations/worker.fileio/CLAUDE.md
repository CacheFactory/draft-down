# File I/O Worker

## Identity

- **Component ID**: `worker.fileio`
- **UUID**: `t7DdLeOV`
- **Type**: Web Worker (TypeScript)
- **Layer**: System

## Purpose

This Web Worker offloads file import and export operations from the main thread, enabling non-blocking parsing of 3D file formats (OBJ, STL, glTF, DXF, FBX, STEP) and generation of export data. It transforms raw file data (ArrayBuffer) into typed geometry structures (`ImportedScene`) and converts internal mesh representations into standard file formats for export.

## Responsibilities

### Import Operations
- Parse incoming file data in multiple formats into structured geometry
- Extract mesh data: vertices (positions), indices, normals, UVs
- Extract material definitions: colors, roughness, metalness, embedded textures
- Reconstruct scene hierarchy with transforms
- Report progress for long-running operations (especially STEP files)

### Export Operations
- Convert `TransferableMesh` structures to target file formats
- Serialize materials with embedded texture data
- Apply format-specific encoding (ASCII, binary)
- Compress data when required by format

### Error Handling
- Validate file headers and format signatures
- Report parsing errors with operation ID
- Handle corrupted or malformed file data gracefully

## API Contract

### Incoming Messages (Main Thread → Worker)

#### Import Request
```typescript
{
  type: 'import';
  id: string;              // Unique operation identifier
  format: 'obj' | 'stl' | 'gltf' | 'dxf' | 'fbx' | 'step';
  data: ArrayBuffer;       // Raw file bytes
  options?: any;           // Format-specific parsing options
}
```

#### Export Request
```typescript
{
  type: 'export';
  id: string;
  format: 'obj' | 'stl' | 'gltf' | 'dxf' | 'fbx';
  mesh: TransferableMesh;
  materials?: SerializedMaterial[];
  options?: any;           // Format-specific export options
}
```

### Outgoing Messages (Worker → Main Thread)

#### Import Result
```typescript
{
  type: 'import-result';
  id: string;
  result: ImportedScene;
}
```

**ImportedScene Structure:**
```typescript
{
  meshes: ImportedMesh[];
  materials: SerializedMaterial[];
  hierarchy: SceneNode[];
}
```

**ImportedMesh:**
- `name`: string
- `positions`: Float64Array (x,y,z triplets)
- `indices`: Uint32Array (triangle vertex indices)
- `normals`: Float32Array (optional, x,y,z triplets)
- `uvs`: Float32Array (optional, u,v pairs)
- `materialIndex`: number (index into materials array)

**SerializedMaterial:**
- `name`: string
- `albedoColor`: [r, g, b] (0-1 range)
- `roughness`: number (0-1)
- `metalness`: number (0-1)
- `opacity`: number (0-1)
- `albedoTextureData`: ArrayBuffer (optional, embedded PNG/JPG)
- `albedoTextureFormat`: 'png' | 'jpg' (optional)

**SceneNode:**
- `name`: string
- `meshIndices`: number[] (references into meshes array)
- `transform`: number[] (16 floats, 4x4 column-major matrix)
- `children`: SceneNode[] (recursive hierarchy)

#### Export Result
```typescript
{
  type: 'export-result';
  id: string;
  data: ArrayBuffer;       // Encoded file bytes
}
```

#### Progress Update
```typescript
{
  type: 'progress';
  id: string;
  percent: number;         // 0-100
  message: string;         // Human-readable status
}
```

#### Error
```typescript
{
  type: 'error';
  id: string;
  error: string;           // Error message
}
```

## Format-Specific Requirements

### OBJ (Wavefront)
- Parse ASCII text lines: `v`, `vn`, `vt`, `f`, `usemtl`, `mtllib`
- Handle faces with format `f v/vt/vn`
- Support both triangles and quads (triangulate quads)
- Parse companion `.mtl` files referenced by `mtllib`
- Extract `Kd` (diffuse), `Ks` (specular), `Ns` (shininess), `map_Kd` (texture) from MTL

### STL (Stereolithography)
- Detect binary vs ASCII by checking first 80 bytes for "solid" keyword
- Binary: read 80-byte header, uint32 triangle count, then 50-byte records (normal + 3 vertices + padding)
- ASCII: parse `solid`, `facet normal`, `outer loop`, `vertex`, `endloop`, `endfacet`, `endsolid`
- Generate normals from triangle winding if not provided

### glTF
- Parse JSON descriptor + binary buffers (`.gltf` or `.glb`)
- Support glTF 2.0 specification
- Decode accessors: buffer views, component types, element counts
- Extract meshes with primitives (positions, normals, texcoords, indices)
- Parse materials: baseColorFactor, metallicFactor, roughnessFactor
- Reconstruct node hierarchy with TRS (translation/rotation/scale) transforms
- Handle embedded base64 textures

### DXF (AutoCAD)
- Parse ASCII section structure: `0\nSECTION`, `2\nENTITIES`, `0\nENDSEC`
- Extract entity types: LINE, 3DFACE, CIRCLE, ARC, POLYLINE, LWPOLYLINE, BLOCK, INSERT
- Read group codes: 10/20/30 (X/Y/Z), 11/21/31 (second point), 40 (radius)
- Tessellate circles and arcs into line segments
- Flatten block references via INSERT entities with transforms

### FBX (Filmbox)
- Detect binary vs ASCII by magic bytes
- Use third-party FBX parser library for binary decoding
- Extract geometry nodes with vertex/index buffers
- Parse material layers and texture references
- Reconstruct scene graph from node parent-child relationships
- Apply global scale if specified in file header

### STEP (ISO 10303)
- Load OpenCascade WASM module on first STEP import (lazy initialization)
- Report progress during WASM instantiation (~5-10 seconds)
- Pass file bytes to OpenCascade `ReadSTEP` function
- Receive tessellated triangle mesh from OpenCascade
- Extract topology: faces, edges, vertices
- Generate normals from face topology
- Release WASM memory after processing

## Dependencies

### External Libraries
- **OpenCascade WASM** (component: `lib.opencascade_wasm`): Required for STEP file parsing. Loaded on-demand when first STEP import is requested.
- Third-party parsers as needed: `fbx-parser` for FBX, adapted `three/examples/jsm/loaders/GLTFLoader` for glTF.

### Data Structures
- **TransferableMesh**: Defined by Mesh Worker (`worker.mesh`). Contains positions, indices, optional attributes.
- Shared typed arrays: `Float64Array`, `Float32Array`, `Uint32Array` — transferred via structured clone or `Transferable` objects.

## Data Flow

### Import Path
1. Main thread sends `import` message with `data: ArrayBuffer` (transferred)
2. Worker detects format and routes to appropriate parser
3. Parser extracts geometry, materials, hierarchy
4. Worker constructs `ImportedScene` with typed arrays
5. Worker posts `import-result` message (typed arrays transferred back)

### Export Path
1. Main thread sends `export` message with `mesh: TransferableMesh` and `materials`
2. Worker routes to format-specific encoder
3. Encoder serializes data to ArrayBuffer
4. Worker posts `export-result` with `data: ArrayBuffer` (transferred)

### Progress Reporting
- Long operations (STEP import, large glTF files) post `progress` messages periodically
- Progress messages include operation ID, percentage (0-100), and status text

## Security & Constraints

### Data Classification
- **File data**: User-uploaded or user-generated files. Treat as untrusted input.
- **Parsing**: Validate file structure; reject malformed data with error messages.
- **Memory**: Limit file size to prevent OOM. Suggest max 500MB per file.

### Sandboxing
- Worker runs in isolated context (no DOM, no Node.js APIs in renderer)
- No network access
- No filesystem access (data passed as ArrayBuffer)

### WASM Execution
- OpenCascade WASM runs in same worker context
- WASM module loaded from local bundle — no CDN dependencies
- WASM memory must be released after STEP processing

## Integration Points

### Main Renderer Process (`process.renderer`)
- **Sends**: `import` and `export` requests
- **Receives**: `import-result`, `export-result`, `progress`, `error` responses
- Transfers `ArrayBuffer` objects to/from worker to avoid copying

### Electron Main Process (`process.main`)
- Worker script loaded from bundled assets
- No direct communication with main process

### Testing (`test.e2e.file_io`)
- E2E tests verify import/export round-trips for all formats
- Tests validate geometry correctness, material preservation, hierarchy reconstruction
- Tests check progress reporting and error handling

## Performance Requirements

- Parse typical OBJ/STL files (<10MB) in under 1 second
- Report progress every 500ms for operations longer than 2 seconds
- STEP import may take 10-30 seconds for complex models — progress updates mandatory
- Use transferable objects for all `ArrayBuffer` data to avoid copying
- Release temporary buffers after parsing to minimize memory footprint

## Contained Sub-Components

None. This is a single worker implementation with internal format-specific parsing/encoding logic.

## Existing Code References

No existing implementation. This is a greenfield component.

---

**Reference**: Implementation folder is `./` (current directory).