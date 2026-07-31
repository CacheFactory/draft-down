# Push/Pull Tool

## Identity
- **Component ID**: `tool.pushpull`
- **Kind**: Tool (interaction layer)
- **Language**: TypeScript
- **Complexity**: Complex

## Purpose

The Push/Pull Tool is DraftDown's signature interaction pattern. It allows users to click a planar face and drag to extrude it into a 3D solid. Dragging away from the face adds material; dragging into an existing solid cuts away material. Double-clicking repeats the last extrusion distance. Users can type exact distances via keyboard value input (VCB).

## Responsibilities

- Detect and highlight face under cursor during hover
- Accept mouse down on a face to begin extrusion operation
- Track drag distance along face normal and update real-time preview
- Support double-click to repeat last extrusion distance
- Accept keyboard value input to specify exact distance
- Distinguish between adding material (positive distance) and cutting material (negative distance / push into solid)
- Optional Ctrl mode: create new face instead of moving original face
- Commit extrusion operation to scene on mouse up
- Maintain tool state across activation/deactivation for double-click repeat

## Tool Lifecycle

### Activation
- Tool activated via:
  - Drawing Toolbar button
  - Application Menu item
  - Keyboard shortcut `P`
- Initialize tool state: `{ phase: 'idle', targetFace: null, lastDistance: null, ... }`
- Load configuration for min distance threshold, snap behavior, auto-boolean settings
- Set cursor to `move`

### Input Events
- **Mouse Down**: Pick face under cursor, store as `targetFace`, capture face normal, transition to `face-picked` phase
- **Mouse Move**: If in `dragging` phase, compute distance along face normal, update preview geometry
- **Mouse Up**: If in `dragging` phase, commit extrusion, store distance in `lastDistance`, return to `idle`
- **Double-Click**: If over a face, pick face and immediately extrude by `lastDistance`
- **Key Down**:
  - `Ctrl`: Toggle `createNewFace` mode (leave original face, create offset copy)
  - `Esc`: Cancel operation, revert preview, return to `idle`
- **VCB Input**: Parse numeric distance (with optional unit suffix), apply as exact extrusion distance, commit

### Deactivation
- Persist `lastDistance` for next activation (double-click repeat)
- Clean up preview geometry if any uncommitted state exists
- Restore default cursor

## Core Operations

### Face Selection
- Ray cast from mouse position into scene
- Filter hits to faces only (ignore edges, vertices, other primitives)
- Return face nearest to camera
- Retrieve face normal vector as extrusion direction

### Distance Computation
- On mouse move during drag, project cursor ray onto line along face normal
- Calculate signed distance from drag start point
- Apply snap constraints if enabled (snap to coplanar faces, snap to specific increments)
- Enforce minimum distance threshold (avoid zero-height extrusions)

### Preview Update
- Call extrusion operation with current distance, preview flag enabled
- Operation returns temporary geometry (extruded mesh)
- Render preview geometry in scene with distinct material/outline
- Update on every mouse move during drag

### Extrusion Commit
- Validate final distance meets minimum threshold
- Determine extrusion mode:
  - Positive distance: extend face outward (add material)
  - Negative distance: check if pushing into existing solid (boolean subtract)
- Invoke `op.extrude` with parameters:
  - Target face
  - Distance
  - Direction (face normal)
  - `createNewFace` flag (Ctrl mode)
- If negative distance and face bounds intersect solid, invoke `op.boolean_subtract` instead
- Wrap operation in transaction for undo/redo support
- Update Scene Manager with resulting geometry
- Clear preview geometry
- Store distance in `lastDistance`

### Boolean Detection
- When distance is negative, check if extruded volume intersects any existing solid geometry
- Use bounding box intersection test first (fast rejection)
- If intersection detected, treat as cut operation instead of simple extrusion

### Double-Click Repeat
- Requires `lastDistance` to be non-null (tool used at least once in this session)
- Pick face under cursor
- If face exists, immediately invoke extrusion with `lastDistance`
- No drag phase — instant commit

## API Dependencies

### Invokes
- **`op.extrude`** (id: `op.extrude`)
  - Method: `extrude(params: ExtrudeParams): ExtrudeResult`
  - Params: `{ face: Face, distance: number, direction: Vector3, createNewFace: boolean, preview: boolean }`
  - Returns extruded mesh geometry with new faces, edges, vertices

### Uses
- **`constraint.distance`** (id: `constraint.distance`)
  - Used during drag to snap distance to specific increments or match existing geometry dimensions

- **`constraint.snap_point`** (id: `constraint.snap_point`)
  - Used to snap drag endpoint to coplanar face boundaries or other inference points

### Modifies
- **`data.scene`** (id: `data.scene`)
  - Reads: Current scene geometry, face data structures
  - Writes: Updated geometry after extrusion commit
  - Methods: `addGeometry()`, `removeGeometry()`, `beginTransaction()`, `commitTransaction()`

## Data Structures

### Tool State
```typescript
interface PushPullState {
  phase: 'idle' | 'face-picked' | 'dragging';
  targetFace: Face | null;
  faceNormal: Vector3 | null;
  dragStartPoint: Vector3 | null;
  currentDistance: number;
  lastDistance: number | null; // persisted across activations
  createNewFace: boolean; // Ctrl modifier state
  preview: ExtrudeResult | null;
  activeTransaction: Transaction | null;
}
```

### Configuration
```typescript
interface PushPullConfig {
  minDistance: number; // e.g., 0.001 units (epsilon)
  snapToExistingFaces: boolean;
  autoBooleanSubtract: boolean; // enable/disable auto-cut detection
}
```

### Extrusion Parameters
- `face`: Face primitive to extrude
- `distance`: Signed distance (positive = away from face, negative = into solid)
- `direction`: Vector3 (typically face normal)
- `createNewFace`: boolean (leave original vs. move original)
- `preview`: boolean (temporary vs. committed geometry)

## Constraints

### Geometry Requirements
- Target must be a planar face (no curved surfaces)
- Face must have valid boundary edges (closed loop)
- Minimum distance threshold enforced to prevent degenerate geometry
- Extrusion must not create self-intersecting geometry (validation in `op.extrude`)

### Performance
- Preview updates must run at interactive frame rate (60 FPS target during drag)
- Ray casting and face picking must complete within frame budget (~16ms)
- Boolean detection (push into solid) uses spatial acceleration structures (bounding boxes, octrees)

### Interaction
- Tool must respond to gesture events: `gesture.drag`, `gesture.double_click`, `gesture.keyboard_value`
- Cursor must change to `move` during active tool state
- Preview geometry rendered with distinct styling (e.g., dashed outline, transparent fill)

### Data Integrity
- All committed operations wrapped in undo/redo transactions
- Preview geometry never persisted to scene permanently
- `lastDistance` stored in tool instance (not scene data) — session-scoped only

## Security & Trust

- **Data Classification**: Unclassified (local 3D scene geometry)
- **Trust Boundary**: Runs entirely in desktop application renderer process — no network communication
- **Input Validation**: 
  - Validate face selection exists before extrusion
  - Validate distance input parses to valid number
  - Validate distance meets minimum threshold
- **No Sensitive Data**: Tool operates on user-created geometry only

## Integration Points

### Triggered By
- **Drawing Toolbar** (`toolbar.drawing`): Button click activates tool
- **Application Menu** (`menu.main`): Menu item selection activates tool
- **Keyboard shortcut**: `P` key activates tool
- **Double-Click Gesture** (`gesture.double_click`): Repeats last distance
- **Drag Gesture** (`gesture.drag`): Drives interactive extrusion
- **Keyboard Value Input** (`gesture.keyboard_value`): Accepts typed distance

### Testing
- **Tool E2E Tests** (`test.e2e.tools`):
  - Test face picking accuracy
  - Test distance computation during drag
  - Test double-click repeat behavior
  - Test boolean cut detection
  - Test VCB input parsing and application
  - Test Ctrl modifier behavior (new face mode)
  - Test undo/redo of extrusion operations

## Implementation Notes

- Extrusion algorithm (from x.docs.notes):
  1. Pick face → get face normal as extrude direction
  2. For each boundary edge, create side face (quad)
  3. Clone original face and translate by `normal * distance`
  4. Connect side faces to cloned face edges
  5. If `distance < 0`, flip direction (push into solid)
  6. If pushing into existing solid, delegate to `op.boolean_subtract`
  7. Merge coplanar adjacent faces when applicable

- Double-click repeat stores `lastDistance` statically across tool activations

- Reference implementation pattern: DraftDown's Push/Pull tool behavior 

## External References

