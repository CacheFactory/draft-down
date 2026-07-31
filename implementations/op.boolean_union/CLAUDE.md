# Boolean Union Operation

## What This Component Is

The Boolean Union operation merges two solid groups or components into a single watertight solid. It is a destructive modeling operation that combines the volumes of two input solids, eliminating interior boundaries and producing a unified mesh with merged external faces. This operation supports live preview and is performance-critical for interactive modeling workflows.

## Responsibilities

- Accept two solid geometry inputs (groups or components) and produce a single merged solid
- Invoke the Manifold library via native module to perform robust CSG union computation
- Handle geometric edge cases: coincident faces, touching edges, near-miss geometry, degenerate triangles
- Ensure result is a valid, watertight manifold mesh
- Provide live preview capability for interactive feedback before committing the operation
- Report operation success/failure with meaningful error messages
- Emit geometry modification events for undo/redo tracking
- Maintain performance suitable for real-time interaction (target: <500ms for typical models, <2s for complex meshes)

## APIs Exposed

### Operation Interface

**Method**: `executeUnion(solidA: SolidReference, solidB: SolidReference, options?: UnionOptions): UnionResult`

- `SolidReference`: Identifier for a solid group or component in the Core Geometry Engine
- `UnionOptions`:
  - `preview: boolean` — If true, compute but don't commit to scene
  - `tolerance: number` — Geometric tolerance for near-coincident features (default from Manifold engine)
- `UnionResult`:
  - `success: boolean`
  - `resultSolid?: SolidReference` — New solid ID if successful
  - `errors?: string[]` — Validation or computation errors
  - `metadata?: { faceCount: number, vertexCount: number, volumeBefore: number, volumeAfter: number }`

**Method**: `validateInputs(solidA: SolidReference, solidB: SolidReference): ValidationResult`

- Returns whether both solids are valid manifolds suitable for boolean operations
- `ValidationResult`: `{ valid: boolean, issues?: string[] }`

## APIs Consumed

### Manifold Solid Engine (`solid.manifold`)

- **Mesh conversion**: Convert DraftDown solid data to Manifold mesh format
- **Boolean computation**: `manifold.union(meshA, meshB)` — core CSG operation
- **Result conversion**: Convert Manifold result back to DraftDown geometry
- **Error handling**: Interpret Manifold errors (non-manifold input, computation failure)

### Core Geometry Engine (`engine.geometry`)

- **Read solid data**: Query mesh topology (vertices, faces, edges) for input solids
- **Write result geometry**: Create new solid entity with union result mesh
- **Update scene graph**: Replace or remove original solids if operation is destructive
- **Entity lifecycle**: Handle creation, deletion, and reference management

### Undo/Redo Manager (`data.history`)

- **Record operation**: Push union command to history stack with input solid IDs and result
- **Undo support**: Restore original two solids, delete union result
- **Redo support**: Re-apply union and restore result solid

## Data Read/Write

### Read

- Input solid mesh data from Core Geometry Engine:
  - Vertex positions (float arrays)
  - Face indices (integer triplets)
  - Material/layer assignments
  - Transform matrices (world-space positioning)
- Geometric tolerance settings from application preferences
- Preview mode flag from tool invocation context

### Write

- New solid mesh to Core Geometry Engine:
  - Result vertex positions
  - Result face topology
  - Inherited or merged material properties
  - Bounding box and spatial metadata
- Operation history entry to Undo/Redo Manager:
  - Command type: "boolean_union"
  - Input solid UUIDs
  - Result solid UUID
  - Timestamp
- Performance metrics (optional):
  - Execution time
  - Input/output mesh complexity

## Data Classification & Security

- **Geometry data**: User-created 3D models — sensitive, confidential to user
  - Must remain local, never transmitted externally
  - Stored in Core Geometry Engine's in-memory structures and persisted to local disk
- **Operation history**: Undo stack entries — confidential to user
  - Stored in-memory and in local project file
- **Performance telemetry**: If collected, must be anonymized and opt-in
- **No authentication required**: Single-user desktop application with file-based access control

## Trust Boundaries

- **Native module boundary**: Manifold library is a compiled C++ module accessed via Node.js native bindings
  - Input meshes must be validated before passing to native code
  - Catch and handle native crashes or exceptions gracefully
  - Do not trust Manifold to validate manifoldness — pre-validate in TypeScript layer
- **Geometry engine boundary**: Core Geometry Engine owns authoritative mesh data
  - Boolean union reads data by reference, does not mutate in place
  - New geometry entities are created atomically
  - No partial updates — operation either succeeds fully or fails cleanly

## Dependencies

### Required Components

- **Manifold Solid Engine** (`solid.manifold`): Provides native boolean computation, mesh validation, and manifold repair
- **Core Geometry Engine** (`engine.geometry`): Manages scene graph, solid entities, mesh storage
- **Undo/Redo Manager** (`data.history`): Records operations for undo/redo

### Dependent Components

- **Solid Tools** (`tool.solid_tools`): User-facing tool that invokes union operations based on selection
- **Geometry Integration Tests** (`test.integration.geometry`): Validates correctness across edge cases
- **Geometry Performance Tests** (`test.perf.geometry`): Ensures performance targets are met

## Contained Sub-Components

All implementation resides within this component's codebase. Sub-modules to implement:

### 1. Input Validation Module

- Verify both input solids exist and are valid manifold meshes
- Check for degenerate geometry (zero-volume solids, collapsed faces)
- Validate transform matrices are non-singular
- Return actionable error messages for invalid inputs

### 2. Manifold Adapter

- Convert DraftDown mesh format to Manifold's expected structure (vertex arrays, index arrays)
- Apply world-space transforms if needed (union operates in world coordinates)
- Invoke Manifold's union API with appropriate error handling
- Convert Manifold result back to DraftDown format
- Map Manifold errors to user-facing messages ("Non-manifold input detected on Solid A")

### 3. Geometry Writer

- Create new solid entity in Core Geometry Engine with result mesh
- Assign material properties (merge rules: if materials differ, use material from Solid A)
- Update spatial indices and bounding volumes
- Handle layer assignment (place result on active layer or inherited layer)

### 4. History Integration

- Package operation into undoable command with closure capturing input/output IDs
- Implement undo: delete result solid, restore original solids
- Implement redo: re-execute union or restore cached result
- Handle edge cases: what if input solids were deleted before undo?

### 5. Preview System

- If `preview: true`, compute union but mark result as temporary/non-persistent
- Render preview geometry with visual distinction (e.g., transparency, wireframe overlay)
- On preview cancellation, delete temporary result
- On preview confirmation, commit result to scene

### 6. Performance Monitoring

- Instrument operation with timing measurements
- Log warnings if execution exceeds target thresholds
- Track mesh complexity metrics (input/output triangle counts)
- Provide profiling hooks for performance test suite

## Edge Cases to Handle

- **Coincident faces**: Faces from both solids lie in same plane — Manifold should merge correctly
- **Touching edges/vertices**: Solids share edge or vertex but not face — should weld cleanly
- **Near-miss geometry**: Faces nearly coincident within tolerance — apply snapping or report error
- **Non-manifold input**: Input solid has holes, t-junctions, or self-intersections — validate and reject
- **Degenerate output**: Union results in zero-volume solid (e.g., two coincident cubes) — handle gracefully
- **Numerical precision**: Very small or very large coordinates — use Manifold's tolerance settings
- **Interrupted operations**: User cancels long-running union — support cancellation tokens
- **Memory pressure**: Very large meshes (>1M triangles) — monitor memory usage, fail gracefully if exceeded

## Performance Requirements

- **Target latency**: <500ms for typical models (10K–100K triangles combined)
- **Maximum latency**: <2s for complex models (up to 500K triangles)
- **Preview responsiveness**: Preview updates should feel interactive (<200ms for preview mesh generation)
- **Memory overhead**: Temporary allocations should not exceed 2x input mesh size
- **Scalability**: Must handle unions of solids with 100K+ triangles each without crashing

## Constraints

- Must operate entirely locally — no network calls, no cloud processing
- Must not corrupt scene graph state on failure
- Must produce valid manifold output or fail with clear error
- Destructive operation: original input solids are typically deleted or hidden post-union (configurable)
- Must integrate with existing undo/redo system without breaking undo stack

## Existing Code References

None — this is a new implementation. Refer to:

- Manifold library documentation for API contracts
- Core Geometry Engine schema for solid data structures (see `../engine.geometry/`)
- Undo/Redo Manager command interface (see `../data.history/`)