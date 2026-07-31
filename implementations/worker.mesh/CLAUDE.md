# Mesh Processing Worker

## Overview

The Mesh Processing Worker is a dedicated Web Worker responsible for executing computationally intensive mesh operations in the background, preventing UI thread blocking. This worker handles boolean operations (union, subtract, intersect), mesh triangulation, decimation, face intersection computation, normal calculation, and mesh validation.

## Responsibilities

- Execute boolean operations on meshes using Manifold WASM
- Triangulate polygon meshes into triangle meshes
- Decimate meshes to reduce face count while preserving shape
- Compute face intersections between two meshes
- Calculate vertex normals with configurable smooth angle thresholds
- Validate mesh topology and report issues
- Report progress for long-running operations
- Manage lifecycle of Manifold WASM module (lazy loading)

## Message Protocol

### Inbound Messages (Main Thread → Worker)

The worker receives `MeshWorkerRequest` messages via `postMessage()`:

**Boolean Operation Request**
- `type`: `'boolean'`
- `id`: Unique operation identifier (string)
- `op`: Operation type (`'union'` | `'subtract'` | `'intersect'`)
- `meshA`: First mesh operand (TransferableMesh)
- `meshB`: Second mesh operand (TransferableMesh)

**Triangulation Request**
- `type`: `'triangulate'`
- `id`: Unique operation identifier (string)
- `mesh`: Mesh to triangulate (TransferableMesh)

**Decimation Request**
- `type`: `'decimate'`
- `id`: Unique operation identifier (string)
- `mesh`: Mesh to decimate (TransferableMesh)
- `targetFaceCount`: Desired face count after decimation (number)

**Face Intersection Request**
- `type`: `'intersect-faces'`
- `id`: Unique operation identifier (string)
- `meshA`: First mesh (TransferableMesh)
- `meshB`: Second mesh (TransferableMesh)

**Normal Computation Request**
- `type`: `'compute-normals'`
- `id`: Unique operation identifier (string)
- `mesh`: Mesh for normal computation (TransferableMesh)
- `smoothAngle`: Angle threshold for smooth shading in degrees (number)

**Validation Request**
- `type`: `'validate'`
- `id`: Unique operation identifier (string)
- `mesh`: Mesh to validate (TransferableMesh)

### Outbound Messages (Worker → Main Thread)

The worker sends `MeshWorkerResponse` messages:

**Result Message**
- `type`: `'result'`
- `id`: Operation identifier matching the request
- `mesh`: Resulting mesh (TransferableMesh)

**Progress Message**
- `type`: `'progress'`
- `id`: Operation identifier
- `percent`: Completion percentage (0-100)
- `message`: Human-readable progress description (string)

**Error Message**
- `type`: `'error'`
- `id`: Operation identifier
- `error`: Error description (string)

**Validation Result Message**
- `type`: `'validation'`
- `id`: Operation identifier
- `result`: Validation result structure (ValidationResult)

## Data Format

### TransferableMesh

Mesh data transferred between threads using Transferable ArrayBuffers:

- `positions`: Float64Array — Vertex positions as `[x,y,z, x,y,z, ...]`
- `indices`: Uint32Array — Triangle face indices as `[i,j,k, i,j,k, ...]`
- `faceGroups`: Uint32Array (optional) — Material index per face
- `normals`: Float32Array (optional) — Per-vertex normals
- `uvs`: Float32Array (optional) — Per-vertex UV coordinates

All typed arrays must be transferred, not copied, using the Transferable object mechanism in `postMessage()`.

### ValidationResult

Structure returned by mesh validation (shape TBD by implementer based on topology checks performed).

## Dependencies

### External Libraries

**Manifold WASM (`lib.manifold_wasm`)**
- Lazy-loaded WASM module for solid geometry operations
- Fetched and instantiated on first boolean operation
- Provides boolean operations: union, subtract, intersect
- Provides mesh repair and validation capabilities

### Computed Outputs

**Half-Edge Mesh (`mesh.halfedge`)**
- Worker computes mesh topology that can be converted to half-edge representation
- Results may be consumed by the half-edge mesh data structure

**Manifold Solid Engine (`solid.manifold`)**
- Worker computes manifold-compliant meshes
- Results integrate with the Manifold solid modeling pipeline

## Communication Partners

**Main Renderer Process (`process.renderer`)**
- Sends operation requests to worker
- Receives results, progress updates, and error messages
- Manages worker lifecycle (creation, termination)
- Handles transferable buffer ownership

**Electron Main Process (`process.main`)**
- Contains this worker (worker bundle loaded from main process resources)

## Performance Requirements

### Critical Performance Constraints

- **Zero-copy transfer**: Use Transferable ArrayBuffers exclusively — copying large meshes would introduce unacceptable latency
- **Non-blocking**: All operations must run on worker thread — never block the UI
- **Progress reporting**: Long operations (>1 second) must report progress at reasonable intervals (e.g., every 5-10% completion or 200ms)
- **Memory efficiency**: Release transferred buffers immediately after processing
- **SharedArrayBuffer support**: Enable SharedArrayBuffer usage for shared geometry access where applicable (requires proper COOP/COEP headers)

### Optimization Notes

- Manifold WASM module must be cached after first load
- Reuse WASM module instance across operations
- Consider worker pooling for parallel operations (implementation detail)
- Profile memory usage for large meshes (>100k faces)

## Security and Data Classification

### Data Classification

- **Internal computational data**: All mesh data is user-generated geometry — treat as private user content
- **No external transmission**: All processing occurs locally; no data leaves the worker thread except via postMessage to parent renderer

### Memory Safety

- Validate all incoming typed array bounds before processing
- Prevent buffer overflows in WASM operations
- Handle WASM exceptions and convert to structured error messages
- Ensure proper cleanup of WASM heap allocations

### Isolation

- Worker runs in isolated JavaScript context (Web Worker sandbox)
- No DOM access, no localStorage, no network access
- Only communication channel is postMessage

## Contained Sub-Components

This worker must internally implement:

1. **Message router**: Dispatch incoming messages to appropriate operation handlers
2. **Operation queue**: Track pending operations by ID, handle concurrent requests
3. **Progress tracker**: Calculate and report progress for long-running operations
4. **WASM loader**: Lazy load and initialize Manifold WASM module
5. **Mesh converter**: Convert TransferableMesh ↔ Manifold native format
6. **Error handler**: Catch operation failures and format error responses

## Testing Requirements

**Geometry Performance Tests (`test.perf.geometry`)**
- Must validate worker message protocol correctness
- Must measure operation timing (boolean ops, triangulation, decimation)
- Must verify zero-copy transfer behavior (buffers become detached after transfer)
- Must test concurrent operation handling
- Must validate progress reporting accuracy
- Must test error conditions (invalid mesh, WASM load failure, out-of-memory)

## Implementation Notes

### Language and Complexity

- **Language**: TypeScript
- **Complexity**: Complex (WASM integration, async operation management, buffer transfer protocol)

### WASM Loading Strategy

- Manifold WASM file is bundled with the application
- Worker fetches WASM from relative path (determined by build configuration)
- First boolean operation triggers lazy load
- Subsequent operations reuse loaded module
- Load failure must result in clear error message to main thread

### Buffer Ownership

After transferring a buffer via postMessage with Transferable objects:
- Sender loses access to the buffer (becomes detached/neutered)
- Receiver gains exclusive ownership
- Worker must transfer result buffers back using the same mechanism
- Main thread regains ownership of result buffers

### TypeScript Interfaces

The typed interfaces shown in `x.docs.notes` define the contract between worker and main thread. Implementation must strictly adhere to these types.