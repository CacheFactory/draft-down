# Undo/Redo Manager

**Component ID**: `data.history` (uuid: `sF6Q1SXe`)

## Purpose

The Undo/Redo Manager implements a command-pattern transaction system that records geometry and scene state changes as minimal deltas. It enables users to undo and redo modeling operations with fine-grained control, grouping complex multi-step operations into single logical transactions. This component operates in-memory only (not persistent to disk by default) and maintains separate undo/redo stacks with configurable maximum depth.

## Responsibilities

### Transaction Management
- Begin, commit, and abort transactions wrapping user actions
- Group multiple deltas into named, atomic transactions (e.g., "Push/Pull", "Sweep")
- Maintain transaction ordering and timestamps
- Enforce single active transaction at a time
- Clear redo stack when new transaction is committed after undo

### Delta Recording
During an active transaction, capture minimal state changes:
- **Mesh deltas**: Record geometry changes via `MeshDelta` structures (vertices, edges, faces, half-edges)
- **Entity operations**: Record entity add/remove/modify with serialized snapshots
- **Material changes**: Record before/after material state
- **Selection changes**: Record selection set transitions
- **Layer changes**: Record layer state modifications

### Undo/Redo Execution
- Execute undo by applying inverse deltas from the undo stack
- Execute redo by reapplying deltas from the redo stack
- Return the transaction object to caller for inspection
- Emit events on stack changes
- Provide human-readable names for undo/redo actions ("Undo Push/Pull")

### Stack Inspection
- Expose read-only views of undo and redo stacks
- Report undo/redo availability and action names
- Track total transaction count

### Configuration
- Enforce configurable maximum steps (default: 100)
- Discard oldest transactions when limit exceeded
- Support clearing entire history
- Allow runtime adjustment of max steps

## API Contract

### Core Interface

```typescript
interface IHistoryManager {
  // Transaction lifecycle
  beginTransaction(name: string): Transaction;
  commitTransaction(): void;
  abortTransaction(): void;
  isInTransaction(): boolean;

  // Delta recording
  recordMeshDelta(meshId: string, delta: MeshDelta): void;
  recordEntityAdd(entity: SerializedEntity): void;
  recordEntityRemove(entity: SerializedEntity): void;
  recordEntityChange(entityId: string, before: Partial<SerializedEntity>, after: Partial<SerializedEntity>): void;

  // Undo/Redo
  undo(): Transaction | null;
  redo(): Transaction | null;
  canUndo(): boolean;
  canRedo(): boolean;
  getUndoName(): string | null;
  getRedoName(): string | null;

  // Stack inspection
  getUndoStack(): ReadonlyArray<Transaction>;
  getRedoStack(): ReadonlyArray<Transaction>;
  getTransactionCount(): number;

  // Configuration
  setMaxSteps(max: number): void;
  clear(): void;

  // Events
  on(event: 'transaction-committed' | 'undo' | 'redo' | 'stack-changed', handler: (t: Transaction) => void): void;
  off(event: string, handler: Function): void;
}
```

### Data Types

```typescript
interface Transaction {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;
  readonly deltas: Delta[];
}

type Delta =
  | { type: 'mesh'; meshId: string; delta: MeshDelta }
  | { type: 'entity-add'; entity: SerializedEntity }
  | { type: 'entity-remove'; entity: SerializedEntity }
  | { type: 'entity-change'; entityId: string; before: Partial<SerializedEntity>; after: Partial<SerializedEntity> }
  | { type: 'material-change'; materialId: string; before: MaterialState; after: MaterialState }
  | { type: 'selection-change'; before: string[]; after: string[] }
  | { type: 'layer-change'; layerId: string; before: LayerState; after: LayerState };
```

### Events
- `transaction-committed`: Fired when a transaction is committed with the transaction object
- `undo`: Fired when undo executes with the undone transaction
- `redo`: Fired when redo executes with the redone transaction
- `stack-changed`: Fired when stack composition changes (new transaction, clear, max steps reached)

## Data Operations

### Reads
- **MeshDelta structures**: Consumed from geometry operations to record vertex/edge/face changes
- **SerializedEntity**: Entity state snapshots for add/remove/change operations
- **MaterialState**: Material property snapshots
- **LayerState**: Layer configuration snapshots
- **Selection sets**: Entity ID arrays for selection tracking

### Writes
- **Local File System** (edge uuid: `CZ8is5tO`): Optional persistence of transaction history (when `x.history.persistent` is true, though defaults to false)

## Dependencies

### Consumes From
- **Geometry Mesh Data** (`../data.geometry.mesh/`): `MeshDelta` structures describing vertex, edge, face, half-edge changes
- **Entity Serialization**: Requires entity serialization format for snapshot capture
- **Material State**: Material property structures
- **Layer State**: Layer configuration structures

### Manages Transactions For
All modeling operations and modifiers must integrate with this history system:
- `../op.extrude/` — Extrude (Push/Pull)
- `../op.sweep/` — Sweep
- `../op.offset/` — Offset Edges
- `../op.boolean_union/` — Boolean Union
- `../op.boolean_subtract/` — Boolean Subtract
- `../op.boolean_intersect/` — Boolean Intersect
- `../op.intersect_faces/` — Intersect Faces
- `../mod.array/` — Array Modifier
- `../mod.mirror/` — Mirror Modifier
- `../mod.smooth/` — Smooth Modifier
- `../op.subdivide/` — Subdivide
- `../op.triangulate/` — Triangulate
- `../op.fillet/` — Fillet
- `../op.chamfer/` — Chamfer

Each operation must call `beginTransaction()`, record appropriate deltas, and `commitTransaction()` on success or `abortTransaction()` on failure.

### Contained By
- **Main Renderer Process** (`../process.renderer/`, edge uuid: `V22OtWfn`): History manager runs in renderer process, accessible to modeling operations

## Constraints

### Memory Efficiency
- **Delta-based storage**: Store minimal diffs, not full model snapshots
- **Copy-on-write**: MeshDelta must use copy-on-write for vertex position arrays — only modified vertices stored
- **Max steps enforcement**: Default 100 transactions. Oldest transactions discarded when limit reached
- **Redo invalidation**: Any new transaction after undo must clear the entire redo stack

### Transaction Semantics
- **Atomicity**: All deltas in a transaction must be applied/unapplied together
- **Single active transaction**: Only one transaction can be in progress at a time
- **Transaction grouping**: Complex operations creating many changes (e.g., Sweep) must wrap all changes in a single transaction so one Ctrl+Z undoes everything
- **Ordering**: Deltas within a transaction must maintain recording order for correct inversion

### Undo/Redo Behavior
- **Inverse operations**: Undo must correctly invert each delta type:
  - Mesh delta: Apply inverse delta
  - Entity-add: Remove entity
  - Entity-remove: Re-add entity
  - Entity-change: Restore `before` state
  - Material-change: Restore `before` material
  - Selection-change: Restore `before` selection
  - Layer-change: Restore `before` layer state
- **Redo reapplication**: Redo must reapply original deltas exactly as recorded

### Data Classification
- **Memory-only by default**: `x.history.persistent` defaults to `false`
- **Local data only**: All transaction data remains on user's machine
- **No sensitive data**: Transaction deltas contain geometry and scene state only — no user credentials or PII

### Error Handling
- **Abort on failure**: If any delta application fails during undo/redo, abort the entire transaction and maintain stack consistency
- **Rollback current transaction**: `abortTransaction()` must discard all recorded deltas and allow new transaction to begin
- **Transaction guards**: Calling transaction methods when not in transaction should throw or no-op gracefully

## Configuration

### Runtime Configuration
- **maxSteps** (`x.history.maxSteps`): Maximum undo steps (default: 100, type: number)
- **persistent** (`x.history.persistent`): Save undo history to disk (default: false, type: boolean)

### Implementation Metadata
- **Language**: TypeScript (`x.impl.language`)
- **Complexity**: Complex (`x.impl.complexity`)

## Testing Requirements

### Integration Tests
- **Scene & Data Integration Tests** (`../test.integration.scene/`, edge uuids: `OMksuMzl`, `q7jSn9jL`): Must verify:
  - Transaction commit/abort behavior
  - Undo/redo correctness for all delta types
  - Stack limit enforcement
  - Redo invalidation on new transaction
  - Event emission timing
  - Complex operation grouping (multi-delta transactions)
  - Memory usage with large transaction counts

### Test Coverage
- Transaction lifecycle (begin/commit/abort)
- Delta recording for each type
- Undo/redo with various delta combinations
- Stack inspection methods
- Max steps enforcement and oldest transaction eviction
- Redo stack clearing on new commit after undo
- Event listener registration and firing
- Error cases (invalid transaction state, failed delta application)