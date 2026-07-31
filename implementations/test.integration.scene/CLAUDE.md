# Scene & Data Integration Tests

## What This Component Is

This is an integration test suite that validates the interaction between core data management systems in DraftDown: scene management, selection tracking, undo/redo history, material assignment, and the inference engine. These tests run headless and must complete within CI/CD pipelines.

Unlike unit tests that isolate single functions, these tests verify that multiple subsystems work together correctly — for example, that creating a group, selecting it, undoing the creation, and redoing it all produces the correct scene graph state and selection events.

## Test Framework and Execution

This suite must use **Vitest** as the test framework. Each test has a default timeout of **10,000ms** (10 seconds). Tests must run in CI environments without requiring a display or GPU.

## What This Suite Must Test

### Scene Manager Integration

Test that the Scene Manager correctly:

- Creates groups from collections of entities and establishes correct parent-child relationships in the scene graph
- Enters and exits editing contexts, isolating group contents and hiding/showing appropriate entities
- Manages component instances that share a single definition mesh
- Creates new component definitions when making instances unique
- Creates and applies layers, controlling entity visibility based on layer state
- Maintains scene graph hierarchy integrity across all operations

### Selection Manager Integration

Test that the Selection Manager correctly:

- Replaces current selection when `select()` is called (single-select mode)
- Adds to or removes from selection when `toggle()` is called (multi-select mode)
- Emits `selection-changed` events with correct `added` and `removed` entity lists
- Implements `selectConnected()` to find all geometry connected to a selected face, edge, or vertex
- Supports selection modes: object, face, edge, vertex
- Maintains selection state consistency with scene graph changes

### History Manager Integration

Test that the Undo/Redo Manager correctly:

- Reverses the last transaction when `undo()` is called, restoring mesh geometry, scene graph, and selection state
- Re-applies an undone transaction when `redo()` is called
- Clears the redo stack when a new action is performed after an undo
- Respects `maxSteps` limit, discarding oldest transactions when the limit is exceeded
- Aborts in-progress transactions with `abortTransaction()`, rolling back partial changes
- Groups nested transactions so a single undo reverses an entire complex operation (e.g., Sweep extrusion creating many edges)
- Labels transactions with descriptive names for UI display

### Material Manager Integration

Test that materials are correctly:

- Assigned to faces and entities
- Persisted across undo/redo operations
- Referenced when entities are grouped or made into components
- Applied to component instances (may be per-instance or per-definition depending on design)

### Inference Engine Integration

Test that the Inference Engine correctly:

- Detects endpoint snaps when the cursor is near edge or vertex endpoints
- Detects midpoint snaps when the cursor is near edge midpoints
- Detects on-axis snaps when moving along X, Y, or Z axis from a starting point (requires `context.toolStartPoint`)
- Detects parallel inferences when moving parallel to a reference edge
- Detects perpendicular inferences when moving perpendicular to a reference edge
- Detects on-edge and on-face snaps
- Prioritizes inferences: endpoint > midpoint > on-edge > on-face when multiple candidates exist
- Completes inference computation within **2ms performance budget**
- Handles large meshes (100,000+ faces) without exceeding the performance budget

## Test Fixtures Required

This suite depends on **Test Model Fixtures** (`test.fixture.models`) to provide:

- **Empty scene**: A scene with no entities, used as a clean starting state
- **Scene with groups**: A scene containing nested groups and standalone entities
- **Scene with components**: A scene with component definitions and multiple instances
- **Scene with layers**: A scene with entities assigned to different layers
- **Unit cube mesh**: A simple 6-face cube for basic geometry tests
- **Generated mesh**: A procedurally generated mesh with a specified face count (e.g., 100,000 faces) for performance testing

Fixtures must provide methods like:
- `TestFixtures.createEmptyScene()`
- `TestFixtures.createGroupedScene()` — returns `{ scene, groups }`
- `TestFixtures.createComponentScene()` — returns `{ scene, definitions }`
- `TestFixtures.createLayeredScene()` — returns `{ scene, layers }`
- `TestFixtures.createUnitCube()` — returns a mesh entity
- `TestFixtures.createGeneratedMesh(faceCount: number)` — returns a large mesh

## Dependencies

This suite tests the following components and must import them:

- **Scene Manager** (`data.scene`): Provides scene graph, group creation, editing contexts, component management, layer management
- **Selection Manager** (`data.selection`): Provides selection state, multi-select, event emission
- **Undo/Redo Manager** (`data.history`): Provides transaction management, undo/redo stack
- **Material Manager** (implied, may be part of Scene Manager or a separate module): Provides material assignment and retrieval
- **Inference Engine** (referenced as `geometry/inference` in the test code): Provides snap detection and inference computation

The suite must also import **Vitest** (`describe`, `it`, `expect`, `beforeEach`, `afterEach`) for test structure and assertions.

## Test Coverage Requirements

The suite must cover:

- Scene graph hierarchy operations (add, remove, group, ungroup, enter/exit editing context)
- Group and component creation, modification, and deletion
- Layer management (create, delete, hide/show, assign entities)
- Selection modes: object, face, edge, vertex
- Multi-select operations (add, remove, toggle, select all, select none)
- Selection events and listener notification
- Undo/redo stack behavior (undo, redo, clear, max steps)
- Transaction grouping and nested transactions
- Transaction abort and rollback
- Material assignment and persistence
- Inference engine snap types (endpoint, midpoint, on-edge, on-face, on-axis, parallel, perpendicular)
- Inference priority rules
- Inference performance under load

## Data Access

Tests must interact with:

- Scene graph structure (entities, groups, components, layers)
- Selection state (selected entities, selection mode)
- History stack (undo/redo stack, current transaction)
- Material assignments (face-to-material mapping)
- Inference results (snap type, position, reference entities)

Tests must not persist data to disk or depend on external files unless explicitly loading test fixtures.

## Security and Constraints

- Tests run **headless** — no GPU, no display, no user interaction
- Tests must not modify the user's file system outside of temporary test directories
- Tests must not make network requests
- Tests must complete within the 10-second timeout
- Inference performance tests must complete within **2ms** per inference query

## Success Criteria

Tests pass if:

- Scene graph operations produce correct entity relationships and hierarchy
- Selection state matches expected entities and emits correct events
- Undo/redo produces correct geometry, scene graph, and selection state
- Materials persist correctly across operations
- Inference engine returns correct snap types and positions
- Inference performance meets the 2ms budget even for large meshes

Tests fail if:

- Scene graph becomes inconsistent (orphaned entities, circular references)
- Selection events are missing or contain incorrect entity lists
- Undo/redo produces incorrect state or crashes
- Inference engine returns incorrect snap types, misses obvious snaps, or exceeds performance budget

## What This Component Is Not Responsible For

- Rendering or visual output (headless tests)
- User interaction or input handling
- Performance profiling or benchmarking beyond the inference engine 2ms budget
- Testing individual component internals (unit tests cover that)
- Testing UI components or Electron integration (separate UI test suites)