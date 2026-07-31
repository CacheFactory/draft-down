# Rectangle Tool

**Component ID:** `tool.rectangle` (uuid: `QWmYWzAR`)  
**Layer:** interaction  
**Kind:** tool

## Purpose

The Rectangle Tool enables users to create rectangular faces in 3D space by clicking two opposite corners. It provides intelligent constraint snapping, proportional helpers (golden ratio, square), keyboard-based axis locking, and VCB (Value Control Box) input for precise dimensions.

## Responsibilities

- Capture two mouse clicks to define opposite corners of a rectangle
- Create a face with 4 edges in the active drawing context
- Apply inference engine snapping to axes and existing geometry
- Provide visual feedback during rectangle creation (preview, dimensions, constraints)
- Lock to specific axes when arrow keys are pressed (Right=Red/X, Left=Green/Y, Up=Blue/Z)
- Snap to proportional relationships (golden ratio, square) when near those proportions
- Parse VCB input in the format `width,height` to create exact-dimension rectangles
- Maintain tool state across activation, interaction, and deactivation

## User Interaction Flow

1. Tool activated via shortcut `R`, toolbar button, or menu selection
2. Cursor changes to `crosshair`
3. First click establishes anchor corner
4. Mouse movement shows live preview of rectangle
5. Inference engine displays snap points, axis locks, and proportional helpers
6. Optional: Arrow keys lock to specific axes
7. Optional: Type `width,height` in VCB for exact dimensions
8. Second click or Enter (after VCB input) commits the rectangle
9. Tool remains active for drawing additional rectangles or ESC to deactivate

## APIs and Interfaces

### Tool Lifecycle

Must implement standard tool interface:

- **activate()** — Called when tool becomes active; set cursor, initialize state
- **deactivate()** — Called when tool becomes inactive; clean up previews, state
- **onMouseDown(event)** — Handle mouse click events
- **onMouseMove(event)** — Handle mouse movement for preview and inference
- **onKeyDown(event)** — Handle arrow keys for axis locking, ESC for cancel, Enter for commit
- **onVCBInput(input: string)** — Handle Value Control Box text input

### Geometry Creation

Must create rectangle geometry via modeling layer API:

- **createRectangleFace(corner1: Point3D, corner2: Point3D): Face** — Create a face with 4 edges
- Points must be coplanar
- Edges must form a closed loop
- Face must be properly oriented (normal calculation)

### Tool Registration

Must register with tool system:

- **id**: `tool.rectangle`
- **category**: `draw`
- **shortcut**: `R`
- **cursor**: `crosshair`
- **icon**: `rectangle`

## Dependencies

### Constraint System

Uses three constraint components for inference snapping:

- **On-Axis Constraint** (`constraint.on_axis`) — Snaps rectangle sides parallel to X, Y, or Z axes; enforces axis locking when arrow keys pressed
- **Snap Point Constraint** (`constraint.snap_point`) — Snaps corners to existing vertices, midpoints, edges, faces
- **Distance Constraint** (`constraint.distance`) — Shows dimension feedback during drawing

Each constraint provides:
- `evaluate(point: Point3D, context: ConstraintContext): ConstraintResult` — Returns snapped point and metadata
- Visual feedback data for rendering snap indicators

### UI Integration

- **Drawing Toolbar** (`toolbar.drawing`) — Contains tool button for activation
- **Application Menu** (`menu.main`) — Contains menu item for activation
- Both trigger tool activation via tool manager

### Inference Engine

Must query inference engine (not explicitly in archigraph but implied by constraint usage):

- Provide current mouse position, existing geometry context
- Receive snap suggestions, axis locks, proportional helpers
- Display visual feedback (snap points, dimension text, colored axis lines)

## Data Flow

### Input
- Mouse position (screen coordinates → 3D world coordinates via camera/viewport)
- Arrow key events (Right/Left/Up for axis locking)
- VCB text input (format: `width,height` in current units)
- Existing geometry context (vertices, edges, faces for snapping)

### Output
- Rectangular face with 4 edges added to active model
- Visual preview geometry (temporary, not persisted until commit)
- UI feedback: dimension tooltips, snap indicators, axis lock indicators

### State Management

Must maintain internal state:

- **idle** — Tool active, waiting for first click
- **first_point_set** — Anchor corner defined, previewing rectangle
- **axis_locked** — Arrow key pressed, constrained to specific axis
- **vcb_input_mode** — User typing dimensions, awaiting Enter or commit

State must reset after each rectangle created to allow continuous drawing.

## Proportional Snapping

Must detect and snap to:

- **Square** — When width/height ratio approaches 1:1 (within threshold, e.g., 0.95–1.05)
- **Golden Ratio** — When width/height ratio approaches φ (1.618) or 1/φ (0.618) within threshold

Visual indicator must show when snap is active ("Square" or "Golden Ratio" label near cursor).

## VCB Input Parsing

When user types while tool is active:

- Input format: `{width},{height}` (e.g., `10,5` or `100mm,50mm`)
- Parse units if provided, otherwise use current document units
- Validate: both values must be positive numbers
- On Enter key: create rectangle with exact dimensions from last clicked point
- On invalid input: show error feedback, do not commit

## Axis Locking

When arrow keys pressed during rectangle drawing:

- **Right Arrow** → Lock to Red axis (X-axis)
- **Left Arrow** → Lock to Green axis (Y-axis)  
- **Up Arrow** → Lock to Blue axis (Z-axis)
- **Down Arrow or Shift** → Unlock (return to free drawing)

Visual feedback: highlight locked axis in UI, constrain rectangle expansion along that axis.

## Security and Data Classification

- **Data Classification**: Internal tool state, geometry data
- **Trust Boundary**: All execution local to user's desktop; no network transmission
- **Input Validation**: Validate VCB numeric input to prevent injection or parsing errors
- **Geometry Validation**: Ensure created rectangles are valid (non-degenerate, coplanar, closed loop)

## Performance Constraints

- Preview updates must render at ≥30 FPS during mouse movement
- Constraint evaluation must complete in <16ms per frame to avoid input lag
- VCB parsing must be instantaneous (<10ms)

## Testing Requirements

Must be covered by **Tool E2E Tests** (`test.e2e.tools`):

- Activate tool via shortcut, toolbar, menu
- Create basic rectangle with two clicks
- Axis locking with arrow keys
- VCB input for exact dimensions (valid and invalid input)
- Snap to existing geometry (vertices, edges, midpoints)
- Proportional snapping (square, golden ratio)
- Continuous drawing (multiple rectangles without reactivating tool)
- Cancel with ESC key
- Edge cases: overlapping corners, degenerate rectangles (same point clicked twice)

## UI/UX Requirements

- Cursor must change to `crosshair` when tool is active
- First click shows no preview (only establishes anchor)
- After first click, live preview shows rectangle outline
- Dimension text displays current width and height near cursor
- Snap indicators show when near snap points (different visual for point, edge, axis, proportional)
- Axis lock shows colored line (red/green/blue) when arrow key pressed
- Tool remains active after rectangle creation (allows chaining multiple rectangles)

## Implementation Notes

- Language: TypeScript
- Complexity: Moderate
- Must integrate with existing tool manager for activation/deactivation lifecycle
- Must respect active drawing context (e.g., drawing on specific face plane vs. ground plane)
- Coordinate system: 3D world space; must handle camera projection for mouse position
- Units: Must respect document unit settings (inches, mm, meters, etc.)

## Related Components

- **Drawing Toolbar** — UI container for tool button
- **Application Menu** — Menu item for tool activation
- **On-Axis Constraint** — Axis snapping and locking logic
- **Snap Point Constraint** — Point/edge/face snapping logic
- **Distance Constraint** — Dimension display logic
- **Tool E2E Tests** — Automated test coverage