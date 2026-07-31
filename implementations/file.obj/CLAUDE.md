# OBJ Format Handler

This component implements Wavefront OBJ file format support for DraftDown, enabling bidirectional conversion between DraftDown's internal geometry representation and the widely-used OBJ format.

## Responsibilities

This component must:

- **Import** OBJ files from the local file system, parsing vertices, normals, texture coordinates (UVs), faces, groups, and material references
- **Export** DraftDown geometry to OBJ format, writing complete geometry with material assignments
- **Parse** OBJ geometry data including vertex positions (`v`), normals (`vn`), texture coordinates (`vt`), and face definitions (`f`)
- **Handle** n-gon faces without forcing triangulation (preserve original face topology)
- **Process** OBJ groups (`g` statements) and map them to appropriate DraftDown structures
- **Reference** external material library files (.mtl) during import
- **Generate** material references during export that map DraftDown PBR materials to OBJ/MTL format
- **Support** optional inclusion of normals, materials, and triangulation based on configuration
- **Validate** file structure and report parsing errors clearly

## File Format Specification

### OBJ Format Elements

The handler must support these OBJ elements:

- `v x y z [w]` — Vertex positions (w optional, defaults to 1.0)
- `vn x y z` — Vertex normals
- `vt u [v] [w]` — Texture coordinates (v and w optional)
- `f v1/vt1/vn1 v2/vt2/vn2 ...` — Face definitions with vertex/texture/normal indices
- `g groupName` — Group declarations
- `usemtl materialName` — Material assignments
- `mtllib filename.mtl` — Material library file references
- `o objectName` — Object name declarations
- `s on|off|number` — Smoothing group declarations

Faces may reference indices in formats:
- `f v1 v2 v3` (vertex only)
- `f v1/vt1 v2/vt2 v3/vt3` (vertex/texture)
- `f v1//vn1 v2//vn2 v3//vn3` (vertex/normal)
- `f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3` (vertex/texture/normal)

Indices are 1-based and may be negative (relative to end of current list).

### Material Library (.mtl) Format

Must understand MTL file references for material properties that map to DraftDown's PBR material system.

## Data Interfaces

### Import API

**Input:**
- File path to OBJ file on local file system
- Import options:
  - `includeNormals: boolean` — whether to parse and use normal data
  - `includeMaterials: boolean` — whether to parse material references and load .mtl files
  - `triangulate: boolean` — whether to convert n-gons to triangles

**Output:**
- Parsed geometry data containing:
  - Vertex positions (array of 3D coordinates)
  - Face topology (vertex indices, optional texture/normal indices)
  - Groups/objects (organizational hierarchy)
  - Material assignments per face or group
  - Optional: vertex normals, texture coordinates
  - Metadata: object names, group names, smoothing groups

### Export API

**Input:**
- DraftDown geometry representation containing:
  - Vertex positions
  - Face topology
  - Material assignments
  - Optional: groups, normals, texture coordinates
- Export options:
  - `includeNormals: boolean` — whether to write vertex normals
  - `includeMaterials: boolean` — whether to write material references and generate .mtl file
  - `triangulate: boolean` — whether to convert faces to triangles before export

**Output:**
- OBJ file written to specified path on local file system
- Optional: MTL file written to same directory if materials are included

## Data Storage

### File System Operations

**Reads from:** Local File System (datastore.filesystem)
- OBJ files (.obj extension)
- MTL material library files (.mtl extension) when materials are enabled
- Paths are absolute or relative to application working directory

**Writes to:** Local File System (datastore.filesystem)
- OBJ files at user-specified paths
- MTL files in same directory as OBJ file when materials are enabled
- Must handle file write errors (permissions, disk space, invalid paths)

## Dependencies

### Consumed Services

- **Local File System**: Must read and write files synchronously or asynchronously from local disk

### Consumed By

- **File I/O E2E Tests** (test.e2e.file_io): This handler is tested by end-to-end file import/export test suites

## Material Mapping Requirements

The component must translate between OBJ/MTL material properties and DraftDown's PBR material system. While the exact mapping is implementation-dependent, it must handle:

- Diffuse color/texture → base color
- Specular properties → metallic/roughness approximations
- Ambient and emissive properties
- Opacity/transparency
- Texture map references

The mapping should preserve material fidelity as much as possible during round-trip import/export operations.

## Geometry Handling Requirements

- **Coordinate System**: Must respect DraftDown's coordinate system conventions and transform if needed
- **Face Winding**: Preserve or normalize face winding order (clockwise vs counter-clockwise)
- **N-gons**: When `triangulate: false`, preserve faces with more than 3 vertices
- **Degenerate Geometry**: Handle or warn about degenerate faces (zero area, duplicate vertices)
- **Index Ranges**: Validate vertex/normal/texture indices are within bounds
- **Relative Indices**: Support negative indices that reference elements relative to current position

## Error Handling

Must detect and report:
- Invalid file format or syntax errors with line numbers
- Missing referenced vertices, normals, or texture coordinates
- Referenced .mtl files that don't exist or can't be read
- Out-of-range indices
- Malformed face definitions
- File system errors (not found, permission denied, disk full)

Errors should provide actionable messages to help users correct issues with their OBJ files.

## Configuration Options

As specified in `x.file.options`:
- `includeNormals: boolean` (default: true) — Enable normal import/export
- `includeMaterials: boolean` (default: true) — Enable material library handling
- `triangulate: boolean` (default: false) — Force triangulation of n-gon faces

These options affect both import and export behavior.

## Implementation Constraints

- **Language**: TypeScript
- **Complexity**: Moderate — requires text parsing, index management, file I/O, and material mapping
- **Performance**: Should handle reasonably large OBJ files (100k+ vertices) without blocking UI
- **Compatibility**: Must produce OBJ files compatible with common 3D software (Blender, Maya, 3ds Max)

## Testing Requirements

This component is validated by **File I/O E2E Tests** (test.e2e.file_io), which verify:
- Successful import of valid OBJ files
- Successful export of DraftDown geometry to OBJ
- Round-trip preservation of geometry data
- Correct handling of materials, normals, and groups
- Error handling for malformed files
- Option flag behavior (triangulation, material inclusion, normal inclusion)