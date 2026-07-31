# Manifold WASM Module

This component provides the WebAssembly interface to the Manifold geometry kernel, enabling high-performance CSG (Constructive Solid Geometry) boolean operations on triangle meshes within DraftDown. It bridges the JavaScript runtime with the compiled C++ Manifold library.

## Responsibilities

- Load and initialize the Manifold WASM binary (`lib.manifold_wasm`)
- Expose JavaScript-callable APIs for CSG operations (union, subtract, intersect)
- Manage memory transfer between JavaScript heap and WASM linear memory
- Handle indexed triangle mesh format conversion between JavaScript objects and WASM structures
- Provide batch operation interfaces to minimize memory copying overhead
- Execute computations off the main thread (in mesh processing worker context)
- Implement error handling for malformed meshes and operation failures

## APIs Exposed

### Initialization
- `initialize(wasmPath: string): Promise<void>` — Load WASM binary and prepare runtime
- `isReady(): boolean` — Check if module is initialized

### CSG Operations
Each operation accepts indexed triangle meshes and returns a result mesh:

**Input Mesh Format:**
```typescript
{
  positions: Float32Array,  // [x,y,z, x,y,z, ...] vertex positions
  indices: Uint32Array      // [a,b,c, a,b,c, ...] triangle vertex indices
}
```

**Output Mesh Format:** Same structure as input

- `union(meshA, meshB): ResultMesh` — Boolean union
- `subtract(meshA, meshB): ResultMesh` — Boolean subtraction (A - B)
- `intersect(meshA, meshB): ResultMesh` — Boolean intersection

### Batch Operations
- `batchUnion(meshes: Mesh[]): ResultMesh` — Union multiple meshes in single call
- `batchOperation(operations: Operation[]): ResultMesh[]` — Execute multiple operations with shared memory

**Operation Format:**
```typescript
{
  type: 'union' | 'subtract' | 'intersect',
  operands: [meshId, meshId]
}
```

### Memory Management
- `allocateMesh(vertexCount: number, triangleCount: number): MeshHandle` — Pre-allocate WASM memory
- `freeMesh(handle: MeshHandle): void` — Release WASM memory
- `getMemoryUsage(): { used: number, available: number }` — Query memory state

## Data Handled

### Reads
- Manifold WASM binary at path provided to `initialize()`
- JavaScript typed arrays (Float32Array, Uint32Array) containing mesh geometry
- Operation parameters defining CSG operation types

### Writes
- Result mesh geometry as JavaScript typed arrays
- Error messages and operation status codes
- Memory usage statistics

### Memory Constraints
- WASM linear memory limited to 2GB (32-bit address space)
- Must pre-allocate memory pools for large batch operations
- Zero-copy transfer where possible using SharedArrayBuffer (if available)

## Security Constraints

### Data Classification
- **Public**: Mesh geometry data (positions, indices) — stored in user's local project files
- **Public**: Operation parameters and results

### Isolation
- Executes in Web Worker context, isolated from main thread
- WASM sandbox provides memory safety boundaries
- No network access required or permitted
- No filesystem access (WASM binary loaded by parent process)

### Trust Boundaries
- Trusts parent Worker/Main process to provide valid WASM binary
- Validates all mesh inputs for structural integrity (valid indices, non-degenerate triangles)
- Must not crash on malformed input — return error instead

## Dependencies

### Upstream
- **Manifold (WASM)** (`lib.manifold_wasm`) — The compiled WebAssembly binary and TypeScript definitions
  - Provides the actual CSG computation implementation
  - Must be loaded before any operations are called

### Downstream Consumers
- **Manifold Solid Engine** (`solid.manifold`) — Calls this module to perform solid modeling operations
  - Implements high-level solid geometry API
  - Manages solid body state and validation
- **Core Geometry Engine** (`engine.geometry`) — Uses this module for boolean operations on mesh geometry
  - Provides mesh data from scene entities
  - Integrates CSG results back into scene graph

### Runtime Context
- **Electron Main Process** (`process.main`) — Contains this module in the application bundle
  - Responsible for packaging WASM binary with application
- Typically instantiated within a Web Worker for off-thread execution
- May be called from main thread during startup/initialization

## Performance Requirements

**Critical Performance Component** — Geometry operations must be responsive during interactive modeling:

- Union/subtract/intersect on meshes <10K triangles: <100ms
- Batch operations should minimize memory allocation overhead
- WASM SIMD instructions must be enabled at compile time
- Pre-allocated memory pools for repeated operations (push/pull workflow)

**Optimizations Applied:**
- WASM compiled with SIMD support (`-msimd128`)
- Memory pool reuse across operations
- Batch API reduces JavaScript ↔ WASM crossing overhead
- Shared memory transfer where browser supports

## Testing Requirements

Covered by:
- **Geometry Performance Tests** (`test.perf.geometry`) — Benchmarks CSG operation performance
  - Tests operation time vs. mesh complexity
  - Validates memory usage stays within bounds
  - Verifies batch operations provide expected speedup

## Implementation Notes

This module does NOT implement the CSG algorithms — it wraps the Manifold C++ library compiled to WASM. The implementation here provides:

1. JavaScript binding layer
2. Memory management between JS and WASM heaps
3. Data format conversion (JavaScript typed arrays ↔ Manifold mesh structures)
4. Error handling and validation
5. Batch operation orchestration

The actual geometric computation happens inside the `lib.manifold_wasm` binary.

## References

- Manifold upstream: https://github.com/elalish/manifold
- WASM binary built from Manifold source with Emscripten
- API must match Manifold's public interface for CSG operations