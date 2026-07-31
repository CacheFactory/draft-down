# Move Tool

## Identity

- **ID**: `tool.move`
- **UUID**: `56EqChJo`
- **Kind**: tool
- **Layer**: interaction
- **Category**: modify
- **Shortcut**: `M`

## What This Component Does

The Move Tool allows users to reposition selected 3D entities in the scene by clicking to establish a base point and then clicking a destination. It supports interactive movement with real-time preview, intelligent inference snapping (axes, points, edges, faces), precise numeric input via the Value Control Box (VCB), copy mode via Ctrl modifier, and linear array creation via VCB commands.

The tool must handle vertex/edge moves that affect connected geometry, automatically folding faces to maintain valid topology when coplanarity would be broken.

## Responsibilities

- Accept selection of entities to move from the Scene Manager's active selection
- Track multi-phase interaction: idle → base-point-picked → moving → complete
- Capture base point from user click with inference snapping
- Compute displacement vector from base point to current cursor position
- Apply real-time preview of moved/copied geometry during movement phase
- Lock movement to specific axes (X, Y, Z) when arrow keys are pressed
- Toggle between move mode and copy mode when Ctrl key is held
- Parse VCB input for:
  - Explicit distance along current movement direction (e.g., "500")
  - Explicit offset vector (e.g., "100,200,50")
  - Array multiplier after copy-move (e.g., "x3" for 3 total copies)
  - Array division after copy-move (e.g., "/3" for 3 evenly-spaced copies)
- Commit move or copy operation to Scene Manager with transaction support
- Create linear arrays by repeating the last move vector N times
- Handle auto-folding of connected faces when moving shared vertices/edges
- Cancel operation on Escape key, reverting any preview changes
- Clear selection and reset state on tool deactivation

## API Surface

### Tool Lifecycle

**Activation**:
- `activate(ctx: ToolContext): void` — initialize state, read current selection from SelectionManager, set cursor

**Deactivation**:
- `deactivate(): void` — cancel any active transaction, clear preview geometry, reset state

### Input Handlers

**Mouse Events**:
- `onMouseDown(event: MouseEvent3D): void` — pick base point (first click) or destination (second click)
- `onMouseMove(event: MouseEvent3D): void` — update preview with displacement from base point to cursor
- `onMouseUp(event: MouseEvent3D): void` — finalize point selection if applicable

**Keyboard Events**:
- `onKeyDown(event: KeyEvent): void` — handle Ctrl (toggle copy mode), arrow keys (lock axis), Escape (cancel)

**VCB Input**:
- `onVCBInput(value: string): void` — parse numeric distance, offset vector, or array commands

### Exposed State

```typescript
interface MoveToolState {
  phase: 'idle' | 'base-point-picked' | 'moving';
  entities: Entity[];
  basePoint: Vector3 | null;
  currentOffset: Vector3;
  copyMode: boolean;
  lockedAxis: 'x' | 'y' | 'z' | null;
  lastMoveVector: Vector3 | null;
  activeTransaction: Transaction | null;
}
```

### Operations

```typescript
interface MoveResult {
  movedEntities: Entity[];
  copiedEntities: Entity[] | null;
  displacement: Vector3;
}
```

## Data Reads/Writes

### Reads

- **SelectionManager**: current selection of entities to move (on activation)
- **Scene Manager**: entity positions, connectivity, face normals (for inference and auto-fold)
- **Inference Engine**: snap points, on-axis constraints, distance constraints (via constraint components)
- **Mouse/Keyboard Input**: cursor position, modifier keys, VCB input text

### Writes

- **Scene Manager**: entity positions (move operation), new entities (copy operation)
- **HistoryManager**: transaction wrapping move/copy operations for undo/redo
- **Cursor**: visual cursor state (move cursor during operation)
- **Preview Geometry**: temporary rendering of moved/copied entities during interaction

## Dependencies

### Consumed Components

- **On-Axis Constraint** (`constraint.on_axis`): lock movement to X, Y, or Z axis
- **Snap Point Constraint** (`constraint.snap_point`): snap base point and destination to vertices, edge midpoints, face centers
- **Distance Constraint** (`constraint.distance`): interpret numeric VCB input as distance along movement direction
- **Scene Manager** (`data.scene`): read entity data, write position updates, create copies
- **Selection Manager**: read current selection
- **History Manager**: wrap operations in transactions
- **Inference Engine**: integrate constraint results for snapping behavior
- **VCB**: read user-typed numeric input

### Depended On By

- **Drawing Toolbar** (`toolbar.drawing`): menu item to activate tool
- **Application Menu** (`menu.main`): menu item to activate tool
- **Drag Gesture** (`gesture.drag`): may trigger tool activation or send drag events
- **Keyboard Value Input** (`gesture.keyboard_value`): sends VCB input to tool
- **Tool E2E Tests** (`test.e2e.tools`): validates tool behavior

## Contained Sub-Components

All logic must be implemented within this component's codebase:

1. **Base Point Selection**: capture first click with inference, store as origin
2. **Displacement Computation**: calculate vector from base point to cursor, respecting locked axes
3. **Preview Rendering**: show real-time preview of entities at new positions during move phase
4. **Move Application**: update entity positions in Scene Manager, wrap in transaction
5. **Copy Application**: duplicate entities, position copies at offset, wrap in transaction
6. **Array Creation**: repeat copy operation N times with evenly-spaced offsets
7. **Auto-Fold Logic**: detect when moving shared vertices/edges would break coplanarity, fold connected faces along shared edges
8. **VCB Parser**: interpret numeric input as distance, offset, or array command
9. **Axis Lock**: constrain movement to single axis based on arrow key input
10. **Copy Mode Toggle**: switch between move and copy based on Ctrl key state

## Security Constraints

- **Data Classification**: Scene data and user input are INTERNAL (local desktop application)
- **Trust Boundaries**: All computation happens in local Electron renderer process — no external network access
- **Input Validation**: VCB input must be sanitized to prevent injection of malicious expressions (evaluate only numeric literals and simple operators)
- **Transaction Integrity**: Ensure all scene modifications are wrapped in transactions to prevent partial state corruption on failure

## Constraints

- **Inference Integration**: Must respect inference results from constraint components — do not reimpute snapping logic
- **Performance**: Preview updates must not block UI thread; consider throttling mouse move events if scene is large
- **Undo/Redo**: All move/copy operations must be reversible via HistoryManager transactions
- **Entity Validity**: Auto-fold logic must preserve manifold geometry — do not create invalid faces or edges
- **Array Semantics**: "x3" creates 3 total copies (2 additional), "/3" creates 3 total copies evenly spaced along displacement
- **Axis Lock Persistence**: Locked axis remains active until user presses different arrow key, Escape, or completes operation
- **Copy Mode Ephemeral**: Copy mode only active while Ctrl is held — release reverts to move mode

## VCB Input Formats

- **Distance**: `"500"` → move exactly 500 units along current displacement direction
- **Offset Vector**: `"100,200,50"` → move exactly by vector (100, 200, 50)
- **Array Multiplier**: `"x3"` → after copy-move, create 2 additional copies (3 total) evenly spaced
- **Array Divisor**: `"/3"` → after copy-move, create 2 additional copies (3 total) evenly spaced

Array commands are only valid immediately after a successful copy-move operation.

## Auto-Fold Behavior

When moving a vertex or edge that is shared by multiple faces:

1. Detect if the move would cause connected faces to become non-coplanar
2. If so, automatically fold connected faces along the shared edge
3. Preserve face orientation and topology
4. Do not create duplicate vertices or invalid geometry

This prevents users from accidentally breaking manifold constraints during typical modeling operations.

## Implementation Language

TypeScript (specified in `x.impl.language`)

## References

- Sibling implementation: `../constraint.on_axis/`
- Sibling implementation: `../constraint.snap_point/`
- Sibling implementation: `../constraint.distance/`
- Sibling implementation: `../data.scene/`
- Test coverage: `../test.e2e.tools/`