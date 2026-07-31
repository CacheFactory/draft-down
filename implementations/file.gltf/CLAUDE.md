# glTF Format Handler

## Purpose

This component provides bidirectional glTF 2.0 file format support for DraftDown. It enables import and export of 3D models in the glTF format, the industry-standard "JPEG of 3D" designed for efficient transmission and rendering of 3D scenes.

## Responsibilities

- **Import** glTF files (.gltf or .glb) from the local filesystem into DraftDown's internal scene representation
- **Export** DraftDown scenes to glTF format, producing either binary .glb files or text .gltf with separate .bin and texture files
- Translate between DraftDown's internal data model and glTF's JSON/binary structure
- Map DraftDown PBR materials to glTF PBR metalness/roughness materials and vice versa
- Handle scene hierarchy, mesh geometry, materials, textures, and transform data
- Optionally compress mesh data using Draco compression
- Embed textures in binary glTF files when configured
- Validate glTF files meet the 2.0 specification during import

## File Format Details

### Import Capabilities

Must read and convert:
- **Geometry**: Vertex positions, normals, UVs, indices from glTF buffers/accessors
- **Materials**: PBR metalness/roughness materials with base color, metallic factor, roughness factor, normal maps, occlusion maps, emissive properties
- **Textures**: Embedded or external texture images referenced by materials
- **Scene Hierarchy**: Node transforms, parent-child relationships, mesh assignments
- **Meshes**: Primitives with material assignments

### Export Capabilities

Must write:
- **Binary Format** (.glb): Single-file binary glTF with embedded buffers and textures
- **Separate Format** (.gltf): JSON descriptor with separate .bin buffer file and texture image files
- **Geometry Encoding**: Efficient buffer layouts with proper accessors, buffer views
- **Material Translation**: Convert DraftDown PBR materials to glTF PBR metalness/roughness specification
- **Texture Handling**: Embed textures in .glb or write separate files for .gltf format
- **Scene Graph**: Node hierarchy with transforms, mesh references
- **Optional Draco Compression**: Apply Draco mesh compression when enabled

### Configuration Options

Support these options (provided as JSON string in `x.file.options`):
- `binary` (boolean): Export as .glb (true) or .gltf + separate files (false)
- `embedTextures` (boolean): Embed textures in binary format vs. separate files
- `draco` (boolean): Enable Draco mesh compression for reduced file size

Default configuration:
```json
{
  "binary": true,
  "embedTextures": true,
  "draco": false
}
```

## Data Interfaces

### Filesystem Operations

**Reads from Local File System** (datastore.filesystem):
- File paths provided by user file picker dialogs or drag-and-drop
- Read binary .glb files or text .gltf files with associated resources
- Read referenced texture images and .bin buffer files for .gltf format

**Writes to Local File System** (datastore.filesystem):
- Write .glb binary files with embedded data
- Write .gltf JSON files with metadata and scene structure
- Write separate .bin buffer files for geometry data
- Write texture image files (PNG, JPEG) when not embedded

### Internal Data Model

Must consume from DraftDown's internal scene representation:
- Scene graph nodes with transforms (position, rotation, scale)
- Mesh geometry (vertices, faces, normals, UVs)
- PBR material definitions with texture references
- Texture image data and metadata

Must produce for DraftDown's internal scene representation:
- Parsed scene hierarchy
- Decoded mesh geometry
- Material properties mapped to DraftDown's PBR system
- Loaded texture images

## Material Mapping Requirements

### DraftDown → glTF
- Map DraftDown PBR materials to glTF `pbrMetallicRoughness` workflow
- Translate base color, metallic factor, roughness factor
- Map normal maps, ambient occlusion maps, emissive properties
- Handle texture coordinate channels and transforms
- Set appropriate alpha mode (opaque, blend, mask)

### glTF → DraftDown
- Convert glTF PBR materials to DraftDown's internal PBR representation
- Preserve metallic/roughness workflow parameters
- Load and assign texture maps to appropriate material channels
- Handle double-sided flags, alpha modes, alpha cutoff values
- Apply default values for missing properties per glTF specification

## Dependencies

### External Libraries
Must integrate with Three.js's glTF loader/exporter or equivalent TypeScript-compatible glTF library for:
- Binary parsing and serialization
- Buffer/accessor management
- glTF specification compliance
- Draco compression/decompression (optional feature)

### DraftDown Components
Depends on:
- Scene graph representation (read during export, populate during import)
- Material system for PBR property mapping
- Texture management system for image loading/saving
- File system access APIs for read/write operations

Depended on by:
- User-facing import/export commands in the application UI
- File I/O E2E Tests (test.e2e.file_io)

## Constraints

### Data Classification
- **Public**: All imported/exported glTF data is user-generated content on local filesystem
- **No Sensitive Data**: No encryption, authentication, or cloud storage involved
- **Local Only**: All operations execute locally in the Electron process

### Trust Boundaries
- **Untrusted Input**: Imported glTF files from users are untrusted; must validate structure
- **No Code Execution**: glTF files must not execute arbitrary code or scripts
- **Resource Limits**: Large files must not cause memory exhaustion or application hangs

### Format Compliance
- Must conform to glTF 2.0 specification
- Should validate required fields and data types during import
- Must write valid glTF that passes official validators
- Extensions beyond core spec are optional

### Performance
- Import/export operations are synchronous but should remain responsive for typical models
- Progress indication for large files is recommended
- Draco compression trades file size for processing time

## Testing

Tested by **File I/O E2E Tests** (test.e2e.file_io):
- Round-trip import/export preserving geometry and materials
- Binary .glb and text .gltf format compatibility
- Texture embedding and external file handling
- Draco compression option validation
- Material mapping accuracy
- Scene hierarchy preservation
- Error handling for malformed files

## Error Handling

Must handle:
- Malformed glTF JSON or binary data
- Missing required fields per specification
- Invalid buffer/accessor references
- Unsupported extensions or versions
- File system access errors (permissions, disk space)
- Texture loading failures
- Memory limits for large models

Should provide clear error messages indicating:
- What validation failed
- Which file or resource caused the error
- Suggested remediation when possible