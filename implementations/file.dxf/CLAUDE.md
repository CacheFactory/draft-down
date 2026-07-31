# DXF Format Handler

## Overview

This component provides **AutoCAD DXF (Drawing Exchange Format) import and export** capabilities for DraftDown. It enables interoperability with external CAD systems by reading and writing DXF files, a widely-adopted format for exchanging 2D and 3D geometric data.

**Responsibility**: Bidirectional translation between DraftDown's internal geometry representation and the DXF file format, handling 2D/3D entities, unit conversion, and coordinate system transformations.

**Archigraph ID**: `file.dxf` (uuid: `J9iodp3B`)

---

## Required Capabilities

### Import (DXF → DraftDown)

Must read DXF files from the local file system and extract:

- **2D Entities**: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE
- **3D Entities**: 3DFACE, LINE (with Z coordinates)
- **Block Definitions**: Named reusable geometry groups (BLOCK/INSERT entities)
- **Layer Information**: Entity organization and visibility metadata
- **Units**: Drawing units metadata (inches, millimeters, etc.)

Must convert:
- DXF coordinate system to DraftDown's coordinate system
- DXF units to DraftDown's internal units
- DXF blocks to DraftDown groups
- 2D entities (when Z=0) to appropriate 3D representations

### Export (DraftDown → DXF)

Must write DXF files to the local file system containing:

- **Edges**: Exported as LINE entities with start/end points
- **Faces**: Exported as 3DFACE entities with 3 or 4 vertices
- **Groups**: Exported as BLOCK definitions with INSERT references
- **Layers**: Organized by geometry type or user-defined layers

Must convert:
- DraftDown coordinates to DXF coordinate system
- DraftDown internal units to target DXF units
- Curved edges to appropriate approximations (polylines or arc segments)

Must generate valid DXF structure:
- Required header section with AutoCAD version compatibility
- TABLES section (layers, linetypes, text styles)
- BLOCKS section for group definitions
- ENTITIES section for geometry
- Proper section terminators and entity handles

---

## Data Interfaces

### File System Operations

**Reads from**: Local File System (`datastore.filesystem`)
- Input: DXF file path (string)
- Format: ASCII or Binary DXF (R12 through R2018+ compatibility recommended)
- Expected location: User-selected file paths via file picker dialogs

**Writes to**: Local File System (`datastore.filesystem`)
- Output: DXF file path (string)
- Format: ASCII DXF (version R12 or R2013 for broad compatibility)
- Expected location: User-selected save paths via file picker dialogs

### DraftDown Internal Geometry

Must consume/produce geometry data matching DraftDown's internal representation:

**Vertices**: 3D points (x, y, z coordinates)

**Edges**: Line segments or curves defined by:
- Start/end vertices
- Optional curve data (arc center, radius, angles)

**Faces**: Planar surfaces defined by:
- Ordered vertex loops
- Normal vectors
- Optional material/color properties

**Groups/Components**: Hierarchical collections of geometry with:
- Local transformation matrix
- Named identifiers
- Nested group references

---

## Coordinate System & Unit Handling

### Coordinate System Transformations

**DXF Standard**:
- Right-handed coordinate system
- +Z typically "up" in 3D views
- +X right, +Y forward

Must handle coordinate system mapping if DraftDown uses different conventions.

### Unit Conversion

Must support conversion between:
- DraftDown's internal unit system (assumed to be consistent across application)
- DXF drawing units: inches, feet, millimeters, centimeters, meters
- DXF $INSUNITS header variable indicates drawing units
- DXF $MEASUREMENT variable (0=Imperial, 1=Metric)

Must provide mechanism to:
- Detect source units on import
- Allow user to specify target units on export
- Apply scaling factor uniformly to all geometric data

---

## Error Handling Requirements

Must handle and report:

- **File access errors**: File not found, permission denied, disk full
- **Parse errors**: Invalid DXF syntax, unsupported entity types, corrupted data
- **Geometry errors**: Invalid coordinates (NaN, Infinity), degenerate entities (zero-length lines, zero-area faces)
- **Version incompatibility**: Unsupported DXF version, missing required sections
- **Encoding issues**: Non-ASCII characters, incorrect text encoding

Must provide:
- Clear error messages indicating file location and nature of problem
- Line/entity numbers for parse errors when feasible
- Graceful degradation: import partial geometry if possible, skip unsupported entities with warnings

---

## Security & Data Classification

**Data Classification**: User-generated design files — treat as **user confidential data**

**Security Constraints**:
- File operations must respect OS-level file permissions
- No network access required or permitted (local-only operation)
- No telemetry or logging of file contents
- File paths must be sanitized to prevent path traversal attacks
- Memory must be released after processing large files to prevent DoS

**Trust Boundary**: Files from external sources (user-provided or downloaded) are untrusted input. Must validate all parsed data before use.

---

## Performance Requirements

- **Import**: Should handle files up to 100MB with reasonable performance (under 30 seconds on modern desktop hardware)
- **Export**: Should export models with 100,000+ entities within 30 seconds
- **Memory**: Should stream large files when possible rather than loading entirely into memory
- **Progress**: Should provide progress indication for operations exceeding 3 seconds

---

## Testing Requirements

Must be covered by **File I/O E2E Tests** (`test.e2e.file_io`):

- Round-trip accuracy: Import then export should preserve geometry within acceptable tolerance (0.001 units)
- Entity type coverage: All supported entity types must have test cases
- Unit conversion accuracy: Verify correct scaling for common unit pairs
- Block/group handling: Verify nested groups export and import correctly
- Edge cases: Empty files, single-entity files, very large files, malformed DXF
- Coordinate system: Verify correct orientation after import/export

---

## Dependencies

**External Libraries** (Recommended for DXF parsing):
- May use existing DXF parsing libraries (e.g., dxf-parser, node-dxf) for read operations
- May use DXF generation libraries (e.g., dxf-writer, dxf) for write operations
- Must ensure licenses are compatible with DraftDown's distribution model

**Internal Dependencies**:
- DraftDown geometry kernel (for internal representation of vertices, edges, faces, groups)
- File system access APIs (Electron/Node.js fs module)
- Unit conversion utilities (if centralized elsewhere in application)

**Depended On By**:
- File import/export UI components
- File I/O E2E test suite (`test.e2e.file_io`)
- Plugin API (if plugins can trigger DXF import/export)

---

## Implementation Notes

**Language**: TypeScript

**Complexity**: Moderate — DXF format is well-documented but verbose. Parsing requires handling numerous entity types and format variations across AutoCAD versions.

**Key Considerations**:
- DXF uses group codes (integer prefixes) to identify field types — parser must handle this structure
- Binary DXF is more compact but ASCII is more widely compatible
- Handle both LF and CRLF line endings
- DXF uses section markers (0 SECTION, 2 HEADER, etc.) — parser must track current section context
- Entity handles and references must be tracked for block definitions and insertions

---

## Format-Specific Options

Should support configuration for:

**Import Options**:
- Target unit system (inherit from file, override to specific unit)
- Layer filtering (import all layers vs. selected layers)
- Block expansion (expand all blocks inline vs. preserve as groups)

**Export Options**:
- DXF version (R12 for maximum compatibility, R2013 for modern features)
- ASCII vs. Binary format
- Unit specification (match source, convert to target unit)
- Precision (number of decimal places for coordinates)
- Layer assignment strategy (single layer, by entity type, by group)

---

## Validation Requirements

**On Import**:
- Verify required DXF sections present (HEADER, ENTITIES at minimum)
- Validate entity coordinates are finite numbers
- Ensure block references point to defined blocks
- Verify vertex indices for 3DFACE entities are in bounds

**On Export**:
- Ensure all faces have at least 3 vertices
- Verify no dangling references to undefined groups/blocks
- Confirm all coordinates are finite numbers
- Validate entity handles are unique