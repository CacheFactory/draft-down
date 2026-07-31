# OpenCascade WASM Module

## What This Component Is

This is a WebAssembly-compiled bridge to OpenCascade Technology (OCCT), specifically providing STEP and IGES file import capabilities for DraftDown. It is a native C++ module that exposes a minimal API surface focused exclusively on importing mechanical CAD data from STEP/IGES formats and converting it to tessellated triangle meshes suitable for DraftDown's half-edge mesh format.

This module runs in the Electron main process within a dedicated file I/O worker. It is **not** loaded at application startup — it must be loaded on-demand only when a user initiates a STEP or IGES import operation.

## Responsibilities

- Parse STEP (ISO 10303-21) and IGES (Initial Graphics Exchange Specification) files
- Extract B-Rep (Boundary Representation) solid geometry from the parsed CAD files
- Tessellate B-Rep surfaces into triangle meshes with configurable tolerance
- Convert tessellated mesh data into a format compatible with DraftDown's half-edge mesh representation
- Provide error handling for malformed or unsupported CAD files
- Report import progress for long-running operations

## APIs Exposed

The module must expose a synchronous or asynchronous API callable from the Electron main process. The API surface must include:

### Import Function
- **Input**: 
  - File path or buffer containing STEP/IGES data
  - Tessellation parameters (linear deflection, angular deflection)
  - Optional import options (unit conversion, coordinate system transformations)
- **Output**:
  - Array of mesh objects, each containing:
    - Vertex positions (flat array of floats: x, y, z, x, y, z, ...)
    - Triangle indices (flat array of integers, each triplet defines a triangle)
    - Optional face metadata (original CAD face identifiers, material properties)
  - File metadata (unit system, coordinate system, assembly structure if present)
  - Import status (success, warnings, errors)

### Error Reporting
- Must distinguish between:
  - File format errors (corrupted, unsupported version)
  - Geometry errors (non-manifold surfaces, degenerate faces)
  - Resource errors (out of memory, file too large)

## Data Consumed

- **Input Files**: STEP (.step, .stp) or IGES (.iges, .igs) files from local filesystem
  - Files may be read as paths (preferred) or as binary buffers
  - Files may range from kilobytes to hundreds of megabytes
- **Configuration**: Tessellation tolerance parameters passed at import time

## Data Produced

- **Triangle Mesh Data**: Must be compatible with DraftDown's half-edge mesh format
  - Vertices must be deduplicated
  - Normals may be computed or omitted (DraftDown can compute them)
  - Face-vertex relationships must be manifold (no T-junctions, consistent winding)
- **Import Metadata**: CAD file properties that may be useful for import dialog or logging

## Security & Trust Boundaries

- **Data Classification**: User-provided CAD files are untrusted input
  - Files may be malformed, malicious, or extremely large
  - Must not expose buffer overflows, infinite loops, or uncontrolled memory allocation
  - Parsing must have configurable resource limits (max faces, max file size)
- **Execution Context**: Runs in Electron main process in a worker thread
  - Must not block the main thread
  - Must not access filesystem outside the provided file path
  - Must not make network requests
- **Memory Safety**: WASM sandbox provides baseline isolation, but C++ code must:
  - Validate all array bounds
  - Handle allocation failures gracefully
  - Free all allocated memory (no leaks on import failure)

## Dependencies

- **Depends on**:
  - `lib.opencascade_wasm` (uuid: `RWr5M7PK`, `jUIPHx0H`): The compiled OpenCascade WASM binary
    - Must include OCCT modules: `TKernel`, `TKMath`, `TKBRep`, `TKSTEP`, `TKIGES`, `TKMesh`
    - Compiled with Emscripten with SIMD optimizations enabled
- **Implements**:
  - `engine.geometry` (uuid: `aUabPP3z`, `kwsNp3J7`): Implements the STEP/IGES import portion of the Core Geometry Engine's contract
- **Contained by**:
  - `process.main` (uuid: `dUsDo93F`, `3T8Ma6lH`): Runs within Electron main process

## Depended On By

The Core Geometry Engine (`engine.geometry`) expects this module to be available for STEP/IGES import operations. The File I/O subsystem within the main process will invoke this module when the user selects "Import STEP" or "Import IGES" from the application.

## Sub-Components

This module must implement:

1. **STEP Parser Binding**: Interface to OCCT's `STEPControl_Reader`
2. **IGES Parser Binding**: Interface to OCCT's `IGESControl_Reader`
3. **Tessellation Engine**: Wraps OCCT's `BRepMesh_IncrementalMesh` for converting B-Rep to mesh
4. **Mesh Extractor**: Walks OCCT topology structures (`TopoDS_Face`, `TopoDS_Edge`) and extracts tessellated triangles
5. **Data Marshaller**: Converts OCCT's internal mesh representation to flat arrays suitable for JavaScript consumption
6. **Error Handler**: Maps OCCT exceptions and error codes to DraftDown-friendly error messages

## Performance Constraints

- **Performance Critical**: Yes. STEP files with thousands of faces must import in reasonable time (under 30 seconds for 10MB files on typical hardware)
- **Optimizations Required**:
  - WASM compiled with `-O3` and SIMD enabled
  - Selective module loading: only load OCCT modules needed for import (not visualization, not modeling)
  - Lazy initialization: do not instantiate OCCT objects until `import()` is called
  - Streaming: for very large files, consider streaming mesh data back to JavaScript incrementally rather than building entire mesh in memory
- **Resource Limits**:
  - Must reject files larger than a configurable threshold (default 500MB)
  - Must reject meshes with more than a configurable face count (default 10 million triangles)
  - Must enforce a timeout on import operations (default 5 minutes)

## Implementation Notes

- **Language**: C++ compiled to WebAssembly via Emscripten
- **API Style**: N-API or direct WASM function exports — choose based on what integrates best with Electron's worker threads
- **Complexity**: Complex — involves wrapping a large C++ library with intricate object hierarchies and error handling

The implementer must decide:
- Whether to use synchronous WASM calls or async via Web Workers
- How to structure the N-API or direct WASM interface
- How to handle OCCT's exception model in JavaScript
- Whether to expose raw OCCT handles or fully translate to JSON/typed arrays
- How to balance memory usage vs. import speed (e.g., batch processing)

## Existing Code References

None specified. This is a new module to be created for DraftDown.