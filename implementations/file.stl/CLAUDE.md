# STL Format Handler

## What This Component Is

A file format handler that imports and exports 3D models in the STL (STereoLithography) format for 3D printing workflows. This component bridges DraftDown's internal triangle mesh representation with the STL file format used by 3D printers and slicing software.

The handler must support both reading STL files (ASCII and binary variants) into the application's internal mesh structure and writing internal meshes out to binary STL files.

## Responsibilities

### Import (STL → Internal Mesh)
- Read both ASCII and binary STL file formats from the local filesystem
- Parse STL triangle definitions (vertex coordinates and normals) into the application's internal triangle mesh data structure
- Validate file integrity during import (e.g., correct file structure, valid numeric values)
- Detect and handle degenerate triangles (zero-area, duplicate vertices)

### Export (Internal Mesh → STL)
- Triangulate all face geometry in the internal model representation
- Write triangle mesh data to binary STL format on the local filesystem
- Generate or preserve surface normals for each triangle
- Ensure output files conform to STL specification for compatibility with 3D printing software

### Validation & Analysis
- Check mesh manifoldness (each edge shared by exactly two triangles)
- Verify mesh is watertight (no holes or gaps)
- Calculate and report total volume of the solid
- Calculate and report total surface area
- Identify potential 3D printing issues:
  - Non-manifold edges or vertices
  - Inverted normals
  - Intersecting triangles
  - Thin walls or features below printer resolution thresholds

### Configuration
The handler must respect these options (provided as JSON):
- `binary`: boolean flag (true = write binary STL, false = write ASCII STL; always accept both on import)
- `checkManifold`: boolean flag to enable/disable manifold validation

## Data Contracts

### Input: STL File
- **Source**: Local File System (datastore ID: `datastore.filesystem`)
- **Format**: Binary or ASCII STL
- **Binary STL structure**:
  - 80-byte header
  - 4-byte unsigned integer (triangle count)
  - For each triangle: 12 floats (normal vector + 3 vertices, each vertex = 3 floats) + 2-byte attribute
- **ASCII STL structure**:
  - `solid [name]` header
  - For each facet: `facet normal` + `outer loop` + 3 `vertex` lines + `endloop` + `endfacet`
  - `endsolid [name]` footer

### Output: STL File
- **Destination**: Local File System (datastore ID: `datastore.filesystem`)
- **Format**: Binary STL by default (configurable via options)
- Must include valid normals for each triangle
- Coordinate units should match internal representation (assumed to be millimeters for 3D printing)

### Internal Mesh Data Structure
The component must interface with DraftDown's internal triangle mesh representation. This structure is not defined here but must support:
- Enumeration of all faces/triangles
- Access to vertex positions (3D coordinates)
- Face triangulation operations (converting n-gons to triangles)
- Normal vector data (per-face or computed from vertices)

### Validation Report
When validation is enabled, output a report structure containing:
- `isManifold`: boolean
- `isWatertight`: boolean
- `volume`: number (cubic units)
- `surfaceArea`: number (square units)
- `issues`: array of objects with:
  - `type`: string (e.g., "non-manifold-edge", "inverted-normal", "degenerate-triangle")
  - `severity`: string ("error", "warning")
  - `location`: optional coordinate or face index reference
  - `message`: human-readable description

## Dependencies

### Consumed
- **Local File System** (datastore.filesystem): for reading and writing `.stl` files
- **Internal Triangle Mesh API**: for accessing geometry data and performing triangulation
- **Manifold Geometry Library**: likely used for validation operations (manifoldness, volume, surface area calculations)

### Depended Upon By
- **File I/O E2E Tests** (test.e2e.file_io): validates STL import/export round-trip correctness and error handling

## Security & Data Constraints

### Data Classification
- STL files are user-generated 3D model data (likely company confidential or user proprietary)
- No personally identifiable information expected
- File paths and model metadata should be handled securely

### Trust Boundaries
- **Untrusted input**: STL files from external sources (downloads, email attachments)
- Must validate file structure before parsing to prevent malformed input from crashing the application
- Large files or excessive triangle counts must be handled gracefully (e.g., progress indicators, memory limits)

### File System Access
- Read access: must handle files that are locked, missing, or unreadable
- Write access: must handle permission errors, disk full conditions, and path validation
- No network access required — all operations are local

## Testing Requirements

The component is tested by `test.e2e.file_io` (ID: test.e2e.file_io), which must verify:
- Round-trip fidelity: export then import preserves geometry within tolerance
- Binary and ASCII import correctness
- Binary export correctness
- Validation reporting accuracy (manifold/non-manifold cases)
- Error handling for malformed files
- Performance with large triangle counts

## Implementation Notes

- **Language**: TypeScript
- **Complexity**: Simple — focused file format handler with well-defined structure
- **No cloud dependencies**: all processing occurs locally in the Electron application
- The component should integrate cleanly with DraftDown's existing file I/O architecture
- Consider streaming or chunked processing for very large STL files to maintain UI responsiveness