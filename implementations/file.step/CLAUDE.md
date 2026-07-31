# STEP Format Import

This component reads STEP (ISO 10303) CAD files and converts their B-Rep solid geometry into DraftDown's mesh-based internal representation.

## Responsibility

Parse STEP files containing mechanical CAD data and produce DraftDown mesh geometry. Handle part assemblies, hierarchical structure, material colors, and coordinate system transformations. This is an import-only capability — DraftDown's mesh representation cannot be reliably converted back to NURBS-based STEP geometry.

## File Format

- **Format**: STEP (Standard for the Exchange of Product model data), ISO 10303
- **Common extensions**: `.step`, `.stp`
- **Content**: NURBS surfaces, B-Rep solids, assemblies, part metadata, material properties
- **Coordinate system**: Right-handed, typically in millimeters

## Data Operations

**Reads from**: Local File System (`datastore.filesystem`)
- User-selected STEP file path provided at import time
- File contains STEP AP203 or AP214 protocol geometry

**Produces**: DraftDown scene geometry
- Triangle meshes representing tessellated solids
- Assembly hierarchy with part names and transforms
- Material colors (RGB) extracted from STEP attributes
- Coordinate transforms applied to convert STEP world space to DraftDown units

## API Surface

Must provide a function or class exposing:

**Import operation**:
- **Input**: Absolute file path to `.step` or `.stp` file
- **Output**: Structured geometry data including:
  - Array of mesh objects (vertices, faces, normals)
  - Part hierarchy (parent/child relationships, names, instance transforms)
  - Material assignments (per-part color or shared materials)
  - Import metadata (units, source file info, warnings)
- **Errors**: File not found, parse failure, unsupported STEP features, invalid geometry

**Configuration options**:
- Tessellation tolerance (controls mesh density from NURBS surfaces)
- Unit conversion (e.g., mm → DraftDown world units)
- Assembly flattening vs. hierarchy preservation
- Color/material import toggle

## Dependencies

**OpenCascade Technology (OCCT)**:
- Native C++ library for STEP parsing and B-Rep geometry
- Access via Node.js native addon (e.g., `node-occ` or custom binding)
- Provides STEP reader (`STEPControl_Reader`), shape analysis, and tessellation (`BRepMesh_IncrementalMesh`)

**DraftDown geometry pipeline**:
- Must convert OCCT topology (`TopoDS_Shape`) to triangle meshes
- Apply transforms from assembly structure
- Integrate with DraftDown's scene graph and material system

## Technical Constraints

**Implementation language**: TypeScript (with native module for OCCT)

**Complexity**: Complex
- STEP files encode sophisticated geometry (NURBS, fillets, blends)
- Assembly trees can be deeply nested with instancing and transforms
- Tessellation quality vs. performance tradeoffs
- Error handling for malformed or unsupported STEP features

**Performance**:
- Large assemblies (>1000 parts) must import in reasonable time (<30s)
- Tessellation must be parallelizable or async to avoid UI blocking
- Memory usage must remain bounded (stream processing if possible)

**Platform**:
- Must work in Electron desktop environment (Windows, macOS, Linux)
- Native module must be compiled for all target platforms
- No cloud or network dependencies

## Security Constraints

**Data classification**: User CAD files — may contain proprietary or confidential designs

**Trust boundaries**:
- STEP files are untrusted input; must validate structure before parsing
- OCCT library is a trusted third-party dependency but may have vulnerabilities
- No execution of embedded scripts or external references

**Filesystem access**:
- Read-only access to user-selected file path
- No automatic file discovery or directory traversal
- Must respect Electron's file picker security model

## Integration Points

**Called by**:
- File → Import menu action
- Drag-and-drop file handler (when `.step` or `.stp` detected)
- Plugin API for automated imports

**Depends on**:
- `datastore.filesystem` for file read operations
- OpenCascade native module for STEP parsing
- DraftDown scene graph for geometry insertion
- Material system for color assignment

**Tested by**:
- `test.e2e.file_io` end-to-end test suite
  - Validates import of sample STEP files (single part, assembly, colored parts)
  - Verifies mesh correctness, hierarchy preservation, and material assignment
  - Checks error handling for corrupt or invalid files

## Sub-components

Must implement within this codebase:

1. **STEP File Reader**
   - Wraps OCCT `STEPControl_Reader` via native binding
   - Validates file structure and protocol version
   - Extracts root shape and assembly tree

2. **B-Rep Tessellator**
   - Converts OCCT `TopoDS_Shape` to triangle meshes
   - Configures tessellation parameters (deflection, angle tolerance)
   - Computes normals and UV coordinates if needed

3. **Assembly Processor**
   - Traverses STEP assembly graph (`XCAFDoc_ShapeTool`)
   - Extracts part names, instance transforms, and references
   - Builds DraftDown scene hierarchy

4. **Material Extractor**
   - Reads color assignments from STEP attributes (`XCAFDoc_ColorTool`)
   - Maps STEP colors (RGB) to DraftDown materials
   - Handles per-part and per-face color assignments

5. **Unit Converter**
   - Detects STEP file units (mm, inches, meters)
   - Scales geometry to DraftDown world space
   - Applies coordinate system handedness if needed

6. **Error Reporter**
   - Collects warnings (unsupported features, degenerate geometry)
   - Provides user-friendly messages for import failures
   - Logs detailed errors for debugging

## Reference Data Structures

**STEP Geometry**:
- Entities: Part, Assembly, Surface, Solid, Shell, Face, Edge, Vertex
- Transforms: 4×4 matrices (translation, rotation, scale)
- Colors: RGB triplets (0–1 range)

**DraftDown Mesh**:
- Vertices: `Float32Array` of [x, y, z] coordinates
- Faces: `Uint32Array` of vertex indices (triangles)
- Normals: `Float32Array` of [nx, ny, nz] per vertex
- Materials: Reference to shared material ID or inline color

**Configuration**:
```typescript
interface StepImportOptions {
  tessellationTolerance: number;  // e.g., 0.01 for coarse, 0.001 for fine
  unitScale: number;              // multiplier to convert STEP units to DraftDown
  preserveHierarchy: boolean;     // true to import assembly structure
  importColors: boolean;          // false to ignore STEP color attributes
}
```

## Existing Code

No existing implementation. This is a new component to be built from scratch.