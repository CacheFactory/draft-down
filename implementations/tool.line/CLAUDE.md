# Line Tool

**Component ID:** `tool.line`  
**UUID:** `WXBGmpCI`  
**Layer:** interaction  
**Category:** draw

## Purpose

The Line Tool enables users to draw edges (lines) in 3D space by clicking to place points. It implements intelligent geometric inference — automatically snapping to axes, endpoints, midpoints, edges, faces, and maintaining perpendicular/parallel relationships. Users can type exact distances into the Value Control Box (VCB) to constrain edge length or position. When edges form a closed coplanar loop, the tool automatically creates a face.

## User Interaction Flow

### Drawing Phases

1. **Idle Phase**: Tool is active, waiting for first click
2. **Drawing Phase**: User has placed at least one point, rubber-band line follows cursor to preview next segment

### Input Methods

- **Mouse click**: Place point at current cursor position (respecting active inference)
- **Mouse move**: Update inference and rubber-band preview
- **Esc key**: Finish current polyline and return to idle
- **Enter key**: Finish current polyline and return to idle
- **Arrow keys**: Lock drawing to specific axis (X/Y/Z)
- **VCB input**: Set exact dimensions for next segment

## Geometric Inference Requirements

The tool must continuously evaluate the cursor position against existing geometry and provide visual feedback. It uses these constraints from the inference system:

- **On-Axis Constraint** (`constraint.on_axis`): Snap to red (X), green (Y), or blue (Z) axes from the last placed point
- **Snap Point Constraint** (`constraint.snap_point`): Snap to existing vertices, edge midpoints, face centers
- **Parallel Constraint** (`constraint.parallel`): Infer when cursor aligns parallel to an existing edge
- **Perpendicular Constraint** (`constraint.perpendicular`): Infer when cursor aligns perpendicular to an existing edge
- **Distance Constraint** (`constraint.distance`): When VCB input is provided, constrain the next point's distance

Multiple inferences may be active simultaneously. The tool must prioritize and display the most relevant one, typically through color-coded rubber-band lines and tooltip overlays.

## VCB (Value Control Box) Input Formats

Users can type values to constrain the next edge:

- **Single number** (e.g., `500`): Sets edge length to 500 units in the current direction
- **Two numbers** (e.g., `300,200`): Sets relative X,Y offset from the start point (Z=0)
- **Three numbers** (e.g., `100,200,50`): Sets relative X,Y,Z offset from the start point
- Negative numbers are valid and indicate direction reversal

When VCB input is active, the rubber-band line must respect the typed constraint while still showing inference hints where applicable.

## Axis Locking

Arrow key presses lock drawing to a specific axis:

- **Left/Right arrow**: Lock to red axis (X)
- **Up/Down arrow**: Lock to green axis (Y)  
- **Page Up/Down or other key**: Lock to blue axis (Z)

Axis lock overrides other inferences except VCB distance input. Visual feedback must clearly indicate the active axis lock (e.g., bold colored line).

## Edge Creation

Each click places a point and creates an edge from the previous point to the new point:

- If the new point coincides with an existing vertex (within snap tolerance), reuse that vertex
- Otherwise, create a new vertex
- Create an edge connecting the two vertices
- Add the edge to the scene geometry

## Face Auto-Detection

After each edge is created, the tool must check whether the new edge completes a closed loop:

1. Starting from the new edge's endpoint, traverse connected edges
2. If a path returns to the start vertex:
   - Verify all edges in the loop are coplanar (within geometric tolerance)
   - If coplanar, automatically create a Face from the edge loop
   - Use consistent winding order to determine face normal
3. Only one face should be created per closed loop

This auto-detection enables users to quickly sketch closed shapes without explicitly invoking a face-creation command.

## Scene Modification

The tool modifies the Scene Manager (`data.scene`) by:

- Adding new `Vertex` entities at clicked points (or reusing existing vertices within snap tolerance)
- Adding new `Edge` entities connecting vertices
- Adding new `Face` entities when closed loops are detected
- All modifications must occur within a history transaction to support undo/redo

## Transaction Management

- When the first point is placed, open a new transaction in the History Manager
- Accumulate all edge and face creations within this transaction
- When the user finishes drawing (Esc, Enter, or switches tools), commit the transaction
- If the user cancels or no edges were created, roll back the transaction

## Visual Preview

The tool must render real-time visual feedback:

- **Rubber-band line**: Animated line from the last placed point to the cursor position
  - Color indicates active inference (red/green/blue for axes, cyan for parallel, magenta for perpendicular, etc.)
  - Line style may vary (dashed, dotted) to indicate constraint strength
- **Inference tooltip**: Text overlay near cursor showing inference type and measurement (e.g., "On Red Axis", "Perpendicular", "500mm")
- **Axis lock indicator**: Persistent UI element showing which axis is locked (if any)
- **Preview vertices**: Small markers at snap points

Preview geometry must not be part of the scene data — it exists only in the rendering layer and is cleared when the tool deactivates.

## Tool Lifecycle

- **Activation**: Called when user selects the tool from the Drawing Toolbar (`toolbar.drawing`) or Application Menu (`menu.main`), or presses shortcut `L`
  - Initialize tool state (idle phase, empty points array)
  - Set cursor to crosshair
  - Begin listening for mouse and keyboard events
- **Deactivation**: Called when user switches to another tool or presses Esc in idle phase
  - Finish any in-progress drawing
  - Commit or rollback active transaction
  - Clear preview geometry
  - Restore default cursor

## Data Structures

### Tool State

The tool must maintain:

- **Phase**: `idle` or `drawing`
- **Points array**: Accumulated 3D positions of placed points in the current polyline
- **Current inference**: The active inference result from the inference engine (or null)
- **Active transaction**: Reference to the current History transaction (or null)
- **Locked axis**: Which axis is locked by arrow key input (`x`, `y`, `z`, or null)

### Output

When drawing finishes, the tool produces:

- **Edges**: Array of newly created Edge entities
- **Faces**: Array of auto-detected Face entities from closed loops
- **Vertices**: Array of new or snapped-to Vertex entities

## API Contracts

### Consumes (from dependencies)

- **Gesture Events**:
  - `gesture.click`: Provides `MouseEvent3D` with 3D ray and intersection data
  - `gesture.keyboard_value`: Provides VCB input strings
- **Constraints** (via inference engine):
  - Each constraint component exposes an `evaluate(context)` method returning `InferenceResult | null`
- **Scene Manager** (`data.scene`):
  - `addVertex(position: Vector3): Vertex`
  - `addEdge(v1: Vertex, v2: Vertex): Edge`
  - `addFace(edges: Edge[]): Face`
  - `findVertexAt(position: Vector3, tolerance: number): Vertex | null`
- **History Manager**:
  - `beginTransaction(name: string): Transaction`
  - `commitTransaction(transaction: Transaction): void`
  - `rollbackTransaction(transaction: Transaction): void`

### Exposes

The tool implements the standard `ITool` interface:

```typescript
interface ITool {
  readonly id: string;
  readonly category: string;
  readonly shortcut: string;
  readonly cursor: string;
  
  activate(ctx: ToolContext): void;
  deactivate(): void;
  
  onMouseDown(event: MouseEvent3D): void;
  onMouseMove(event: MouseEvent3D): void;
  onMouseUp(event: MouseEvent3D): void;
  onKeyDown(event: KeyEvent): void;
}
```

Additionally, it must handle:

```typescript
onVCBInput(value: string): void;
```

## Constraints and Requirements

### Geometric Tolerances

- **Snap tolerance**: Cursor must be within a configurable distance (e.g., 5 pixels in screen space) to trigger snap inference
- **Coplanarity tolerance**: Edges forming a loop must have normals within a configurable angle (e.g., 1 degree) to be considered coplanar

### Performance

- Inference evaluation must complete within 16ms to maintain 60fps during mouse movement
- The tool must handle scenes with thousands of existing edges without stuttering

### Data Integrity

- Vertices must not be duplicated — always check for existing vertices within snap tolerance before creating new ones
- Edges must not overlap exactly — if the user clicks the same two vertices twice, warn or prevent duplicate edge creation
- Face winding order must be consistent with the scene's coordinate system handedness

### Security and Trust

- All geometry computation occurs locally within the Electron renderer process
- Tool operates on the scene data model in memory — no external data access
- User input from VCB must be sanitized to prevent injection of non-numeric characters

## Dependencies

The Line Tool depends on:

- **On-Axis Constraint** (`constraint.on_axis`): Provides axis-locking inference
- **Parallel Constraint** (`constraint.parallel`): Detects parallel alignment with existing edges
- **Perpendicular Constraint** (`constraint.perpendicular`): Detects perpendicular alignment
- **Snap Point Constraint** (`constraint.snap_point`): Snaps to vertices, midpoints, face centers
- **Distance Constraint** (`constraint.distance`): Enforces VCB-specified distances
- **Scene Manager** (`data.scene`): Stores and queries geometry

Each constraint folder (`../constraint.*/`) provides the inference logic for its respective geometric relationship.

## Testing

The tool is covered by:

- **Tool E2E Tests** (`test.e2e.tools`): Located in `../test.e2e.tools/`
  - Must include test cases for:
    - Single edge creation with no inference
    - Axis-locked drawing (arrow key inputs)
    - Snapping to existing vertices and midpoints
    - VCB input (single, double, triple number formats)
    - Face auto-detection from closed triangular, rectangular, and polygonal loops
    - Undo/redo of edge and face creation
    - Canceling mid-draw with Esc

## UI Integration

The tool is accessible from:

- **Drawing Toolbar** (`toolbar.drawing`): Icon button with `line` icon
- **Application Menu** (`menu.main`): Menu item under Draw → Line
- **Keyboard shortcut**: `L`

When active, the cursor changes to `crosshair` style.

## Notes

- The typed interface example in `x.docs.notes` provides a reference implementation signature — actual implementation may vary but must fulfill the same contracts
- The tool must gracefully handle edge cases: clicking in empty space far from geometry, clicking the same point twice, attempting to create zero-length edges
- Preview rendering should use a separate rendering pass or layer to avoid Z-fighting with actual geometry