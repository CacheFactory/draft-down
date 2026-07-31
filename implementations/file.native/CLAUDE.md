# DraftDown Native Format (.scf)

**Component ID**: `file.native` (uuid: `GmIenGm4`)  
**Layer**: data  
**Type**: file_format

## Purpose

The DraftDown native file format (.scf) is a custom binary format for persisting and loading 3D models in DraftDown. It must provide fast, reliable serialization of all model data including geometry, materials, scene structure, and metadata, with support for incremental saves to minimize write times for large models.

## Responsibilities

### File Structure

The .scf file must be organized into distinct sections:

1. **Header Section**
   - Version identifier (semver-compatible)
   - File-level checksum for integrity verification
   - Metadata about section locations and sizes

2. **Geometry Section**
   - Boundary Representation (B-Rep) data:
     - Vertex positions (3D coordinates)
     - Edge definitions (vertex pairs, curve data)
     - Face definitions (edge loops, surface data)
   - Topology relationships between vertices, edges, and faces
   - Precision sufficient for CAD operations

3. **Materials Section**
   - Material definitions (properties, colors, reflectance)
   - Embedded texture data (image formats: PNG, JPEG)
   - Material-to-geometry assignments
   - Texture coordinate mappings (UVs)

4. **Scene Structure Section**
   - Hierarchical organization:
     - Groups (logical containers)
     - Components (reusable instances)
     - Layers (visibility and organization)
   - Instance transforms (position, rotation, scale)
   - Component definitions vs. instances

5. **Metadata Section**
   - Scene/page definitions (multiple viewports or design options)
   - Camera positions and settings
   - Style configurations (edge display, rendering modes)
   - Custom user properties and annotations

### Compression

All sections except the header must support zlib compression. Compression must be applied per-section to enable selective decompression during partial reads.

The `compressed` option must control whether compression is enabled (default: true).

### Incremental Save

The format must support incremental saves where only modified sections are rewritten. This requires:

- Section-based file layout with fixed offsets or offset tables
- Ability to identify which sections have changed since last save
- Atomic file updates (write to temp, then rename) to prevent corruption

### Versioning

The format version must be stored in the header. The system must:

- Write files at version 1.0 initially
- Include format version in all file headers
- Provide forward compatibility guidance (how future versions should handle unknown sections)

## Data Operations

### Writes to Local File System

Must persist complete model state to disk:

- **Path**: User-specified file path with .scf extension
- **Atomicity**: Use temporary file + rename to ensure no partial writes
- **Error handling**: Report disk full, permission denied, path invalid
- **Performance target**: Incremental saves should complete in <1s for models up to 100K polygons

### Reads from Local File System

Must reconstruct complete model state from disk:

- **Path**: User-specified .scf file
- **Validation**: Verify checksum, version compatibility
- **Error handling**: Detect corruption, version mismatches, missing sections
- **Migration**: Handle older format versions (when they exist)

## APIs and Contracts

### Export Interface

Must provide a method to serialize the current model state:

**Input**:
- Complete scene graph (geometry, materials, structure, metadata)
- File path
- Options object with fields:
  - `compressed`: boolean (default true)
  - `includeTextures`: boolean (default true)
  - `version`: string (default "1.0")

**Output**:
- Success/failure status
- Error details if failed
- File statistics (size, section counts)

**Side effects**:
- Writes .scf file to specified path
- May write temporary files during atomic save

### Import Interface

Must provide a method to deserialize a .scf file:

**Input**:
- File path to .scf file
- Options object with fields:
  - `includeTextures`: boolean (default true) — whether to load embedded textures

**Output**:
- Complete scene graph data structure matching export input format
- File metadata (version, save timestamp)
- Warnings for any non-critical issues (missing textures, deprecated features)

**Errors**:
- File not found
- Corrupted file (checksum mismatch)
- Unsupported version
- Invalid section data

## Dependencies

### Inbound Dependencies

**Plugin System** (`plugin.system`):
- Plugins must be able to register custom section handlers
- Plugins may define additional metadata sections
- Plugins must respect the core format structure (cannot break header/checksum)

### Outbound Dependencies

**Local File System** (`datastore.filesystem`):
- All file I/O operations (read, write, rename, delete)
- Temporary file creation for atomic writes

## Data Security and Integrity

### Data Classification

Model files may contain:
- **Public**: Tutorial models, example files
- **Confidential**: Proprietary designs, client work

The format must:
- Store all data in user-controlled local files
- Not transmit data over network
- Not include telemetry or analytics in saved files

### Integrity Verification

- Header must include checksum covering all sections
- Checksum algorithm must be specified in documentation (e.g., CRC32 or SHA-256)
- On load, verify checksum matches file contents
- Reject files with checksum mismatches

### Trust Boundaries

Files loaded from disk cross a trust boundary:
- Validate all section sizes before allocation
- Bounds-check all array accesses
- Reject files with malformed section headers
- Limit maximum file size to prevent memory exhaustion

## Testing Requirements

**File I/O E2E Tests** (`test.e2e.file_io`) must verify:

1. **Round-trip fidelity**:
   - Save a model, load it back, verify exact geometry match
   - Verify materials, textures, scene structure preserved
   - Test with compressed and uncompressed files

2. **Incremental save**:
   - Modify only materials, verify only material section changes
   - Verify performance improvement over full save

3. **Error handling**:
   - Corrupted file detection
   - Invalid checksum rejection
   - Missing section handling

4. **Large model performance**:
   - Models with 100K+ polygons
   - Models with 100+ embedded textures

5. **Plugin integration**:
   - Save and load files with plugin-defined sections
   - Verify core sections not corrupted by plugin data

## Constraints

- **Format name**: Must use `.scf` file extension
- **Platform**: Must work identically on Windows, macOS, Linux (Electron environments)
- **Endianness**: Must specify byte order in format (recommend little-endian)
- **Maximum file size**: Must handle files up to 2GB (practical limit for 32-bit offsets)
- **Language**: Implementation in TypeScript
- **Complexity**: Complex (binary parsing, compression, multi-section management)

## Notes

This is a custom binary format inspired by DraftDown's .skp structure but not compatible with it. The "SKP" enum value in `x.file.format` is used as the closest match in the enumeration, but this component defines its own independent format specification.

The format must prioritize:
1. Data integrity (checksums, atomic writes)
2. Performance (compression, incremental saves)
3. Extensibility (plugin sections, forward compatibility)
4. Simplicity (clear section boundaries, documented structure)