# Manifold Solid Engine

## Overview

The Manifold Solid Engine is the core computational geometry component responsible for robust CSG (Constructive Solid Geometry) boolean operations in DraftDown. It wraps the Manifold library (compiled to WebAssembly) to perform high-performance solid modeling operations on 3D geometry.

This component acts as the bridge between DraftDown's B-Rep geometry representation and Manifold's mesh-based processing. It validates input geometry, performs transformations, executes operations, and converts results back to the application's native format.

**Component ID**: `solid.manifold` (uuid: `TECynygY`)  
**Layer**: geometry  
**Implementation Language**: TypeScript  
**Complexity**: Complex

---

## Responsibilities

### Geometry Conversion
- Convert DraftDown B-Rep geometry to Manifold mesh format
- Convert Manifold mesh results back to DraftDown B-Rep geometry
- Preserve geometry metadata, material assignments, and topology references during round-trip conversion

### Boolean Operations
- Execute union operations on two or more solid bodies
- Execute subtraction operations (cutting one solid from another)
- Execute intersection operations (keeping only overlapping volume)
- Support Minkowski sum operations

### Geometry Validation
- Validate that input geometry is a proper 2-manifold (watertight, no self-intersections, consistent face orientation)
- Detect and report non-manifold conditions before attempting operations
- Validate output geometry integrity after operations

### Performance-Critical Processing
- Leverage WASM-compiled Manifold library for near-native performance
- Implement parallel face classification where applicable
- Meet performance target: Boolean union of two 10K-face solids < 100ms
- Execute all operations synchronously or asynchronously as appropriate for worker context

---

## API Surface

### Primary Operation Methods

Must expose methods that:
- Accept two or more solid geometries as input
- Accept operation type (union, subtract, intersect, minkowski)
- Return resulting solid geometry or error with diagnostic information
- Support both single operations and batched operations for efficiency

### Validation Methods

Must expose methods that:
- Check if geometry is manifold-valid before operations
- Return detailed validation results indicating specific problems (holes, self-intersections, inconsistent normals)
- Provide repair suggestions where possible

### Conversion Methods

Must expose methods that:
- Convert from DraftDown B-Rep to Manifold mesh format
- Convert from Manifold mesh format back to DraftDown B-Rep
- Handle edge cases: degenerate faces, coincident vertices, floating-point precision issues

---

## Data Contracts

### Input Geometry Format

Accepts DraftDown B-Rep geometry containing:
- Face definitions with vertex indices
- Vertex positions as float64 coordinates
- Face normal vectors
- Edge connectivity information
- Material/layer assignments per face

### Output Geometry Format

Returns DraftDown B-Rep geometry containing:
- Modified or new face definitions
- Updated vertex positions and normals
- Preserved or updated material/layer assignments
- Topology metadata indicating which faces resulted from boolean operations

### Error Information

Returns structured error objects containing:
- Error type classification (validation failure, operation failure, conversion error)
- Affected geometry IDs or face indices
- Human-readable diagnostic message
- Suggested remediation steps where applicable

---

## Precision and Topology Requirements

### Precision
- All internal calculations must maintain float64 precision
- Conversion to/from Manifold format must not introduce precision loss beyond library limitations
- Handle near-coincident geometry within numerical tolerances

### Topology
- All input geometry must be manifold (watertight, orientable 2-manifold)
- Operations must produce manifold output or fail with clear error
- Preserve or establish consistent face winding (outward-facing normals)

### Representation
- Primary representation: CSG operations on solid bodies
- Internal processing: mesh-based via Manifold library
- Output: B-Rep compatible with DraftDown's geometry model

---

## Integration Points

### Dependencies

**Manifold WASM Module** (`native.manifold`)
- Compiled WebAssembly binary providing Manifold library functionality
- Load and initialize WASM module at component startup
- Handle WASM memory management and interface binding

**Mesh Processing Worker** (`worker.mesh`)
- Offload heavy operations to worker thread to maintain UI responsiveness
- Communicate geometry data and operation requests via structured messages
- Receive results and errors asynchronously

**Model Document** (`data.document`)
- Read solid geometry definitions from document model
- Write operation results back to document model
- Maintain transactional integrity during multi-step operations

### Consumers

**Boolean Operations** (`op.boolean_union`, `op.boolean_subtract`, `op.boolean_intersect`)
- Receive operation requests with specific boolean types
- Execute requested operations and return results
- Report operation progress and errors

**Extrude (Push/Pull)** (`op.extrude`)
- Support extrusion operations that intersect with existing geometry
- Perform boolean union or subtraction as part of push/pull workflow
- Handle partial face extrusions requiring solid splitting

---

## Security and Data Constraints

### Data Classification
- Geometry data is user-created content, treated as confidential
- No geometry data leaves the local machine
- All operations execute locally via WASM

### Memory Safety
- WASM module operates in sandboxed environment
- Validate geometry size before operations to prevent memory exhaustion
- Handle WASM heap allocation failures gracefully

### Trust Boundaries
- Validate all geometry input from document model (untrusted user content)
- Sanitize geometry before passing to WASM module
- Validate WASM operation results before writing back to document

### Resource Limits
- Enforce maximum face count limits to prevent denial-of-service via oversized geometry
- Implement operation timeouts for long-running boolean operations
- Monitor WASM heap usage and fail gracefully on allocation errors

---

## Testing Requirements

**Geometry Integration Tests** (`test.integration.geometry`)
- Verify round-trip conversion accuracy (B-Rep → Manifold → B-Rep)
- Validate boolean operation correctness on known test cases
- Test error handling for invalid/non-manifold input
- Verify preservation of material and layer assignments

**Geometry Performance Tests** (`test.perf.geometry`)
- Benchmark boolean union on 10K-face solids (target < 100ms)
- Measure conversion overhead
- Profile memory usage during operations
- Test parallel processing efficiency

---

## Performance Targets

- Boolean union of two 10K-face solids: < 100ms
- Geometry validation: < 10ms for typical models (< 5K faces)
- Round-trip conversion overhead: < 5% of operation time
- WASM module initialization: < 500ms on component load

Optimizations must leverage:
- Manifold library compiled to WASM for near-native speed
- Parallel face classification where library supports it
- Worker thread offloading for non-blocking UI

---

## Sub-Components

This component must implement:

1. **B-Rep to Manifold Converter**
   - Transform DraftDown face/vertex data to Manifold mesh format
   - Handle coordinate system transformations if needed
   - Preserve topology and metadata associations

2. **Manifold to B-Rep Converter**
   - Transform Manifold mesh results back to B-Rep
   - Reconstruct face/edge topology from mesh
   - Restore or update material/layer assignments

3. **Operation Dispatcher**
   - Route boolean operation requests to appropriate Manifold API calls
   - Manage operation sequencing for multi-body operations
   - Handle operation failure and rollback

4. **Validation Engine**
   - Check manifold properties before operations
   - Detect holes, self-intersections, inconsistent normals
   - Generate diagnostic reports with remediation suggestions

5. **WASM Interface Layer**
   - Load and initialize Manifold WASM module
   - Manage memory allocation and data marshaling
   - Handle WASM error codes and exception translation

---

## References

- Manifold library: https://github.com/elalish/manifold
- CSG representation: industry-standard constructive solid geometry approach
- Float64 precision: IEEE 754 double-precision floating point