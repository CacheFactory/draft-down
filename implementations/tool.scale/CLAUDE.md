# Scale Tool

## What This Component Is

The Scale Tool is an interactive modeling tool that allows users to resize selected 3D entities in the scene. It operates by displaying a visual bounding box around the selection with interactive grip handles at corners, edges, and faces. Users drag these grips to scale geometry along one, two, or all three axes. The tool supports both proportional and non-proportional scaling, with modifier key options and numerical input via the Value Control Box (VCB).

This is a transformation tool in the "modify" category, activated by keyboard shortcut "S" and displaying a "scale" cursor icon.

## Responsibilities

- Display a bounding box with grip handles around selected entities when the tool is active
- Interpret drag gestures on different grip types (corner, edge, face) to scale geometry appropriately
- Apply scale transformations to selected entities in real-time during drag operations
- Support modifier keys (Ctrl) to toggle scaling about object center vs. about opposite grip
- Accept numerical input from VCB in formats: single scale factor (uniform) or "width,height,depth" (non-uniform)
- Maintain proper geometric constraints during scaling operations
- Update the scene with modified geometry upon completion
- Provide visual feedback (grip highlights, bounding box updates) during interaction

## APIs Exposed

### Tool Lifecycle
Must implement standard tool interface methods:
- **Activation**: Initialize when tool becomes active (keyboard shortcut "S" or toolbar selection)
- **Deactivation**: Clean up visual overlays and state when tool is deactivated
- **Event handling**: Process mouse events (move, down, up), keyboard events (Ctrl modifier, Esc to cancel), VCB input

### Input Handling
- **Drag gesture events**: Accept drag start, drag move, drag end events from `gesture.drag` (id: `gesture.drag`)
- **VCB input**: Parse and apply numerical scale values:
  - Single number: uniform scale factor (e.g., "2" scales 2x in all dimensions)
  - Three comma-separated numbers: non-uniform scale per axis (e.g., "2,1,0.5")

### Visual Feedback
- Render bounding box geometry overlaid on viewport
- Render grip handles at 26 locations (8 corners, 12 edges, 6 faces)
- Highlight active grip during hover and drag
- Update bounding box size in real-time during drag

## APIs Consumed

### Scene Manager (`data.scene`)
- **Read**: Query currently selected entities and their geometry bounds
- **Write**: Apply scale transformations to selected entities
- **Modify edge** (uuid: `AaKRWZcp`): Submit scaled geometry back to scene

### Snap Point Constraint (`constraint.snap_point`)
- **Uses edges** (uuids: `F5r82bnn`, `cVGpUukm`): Apply snapping behavior to grip positions when enabled, allowing scale operations to snap to significant points in the scene

### Distance Constraint (`constraint.distance`)
- **Uses edges** (uuids: `ms4UYB31`, `1bW52QSe`): Measure and constrain distances during scaling, ensuring scale factors align with user input or scene constraints

### Drag Gesture (`gesture.drag`)
- **Triggered by edge** (uuid: `GoUZoIZx`): Receive drag events when user interacts with grip handles

## Data Read/Write

### Read
- **Selection state**: Which entities are currently selected (from Scene Manager)
- **Entity geometry**: Bounding boxes, vertex positions, transformation matrices of selected entities
- **Modifier key state**: Ctrl key for center-scaling mode
- **VCB input stream**: Numerical scale values entered by user

### Write
- **Entity transformations**: Updated scale matrices or direct vertex modifications for selected entities
- **VCB display**: Current scale factor or dimensions during drag operation
- **Visual overlay state**: Bounding box and grip geometry rendered to viewport

### Data Classification
- **User geometry**: User-created 3D models (INTERNAL, persistent, backed up)
- **Tool state**: Ephemeral UI state (grips, bounding boxes) — not persisted
- **User input**: VCB values, modifier keys (transient)

## Security Constraints

- **Local-only execution**: All scaling computations run in desktop Electron process, no network calls
- **Data validation**: VCB input must be validated (numerical ranges, format checking) to prevent malformed geometry
- **Memory safety**: Bounding box calculations and grip interactions must handle edge cases (zero-size entities, degenerate geometry) without crashes
- **User intent preservation**: Scale operations must be cancelable (Esc key) and undoable without corrupting scene state

## Dependencies

### Hard Dependencies
- **Scene Manager** (`data.scene`): Required for reading selection and writing scaled geometry
- **Drag Gesture** (`gesture.drag`): Required for interpreting user grip dragging
- **Drawing Toolbar** (`toolbar.drawing`): Hosts this tool in the UI (contains edge uuid: `x7YwwFNI`)

### Optional Dependencies
- **Snap Point Constraint** (`constraint.snap_point`): Enhances UX by snapping grip positions to scene points
- **Distance Constraint** (`constraint.distance`): Provides measurement feedback during scaling

### Dependents
- **Tool E2E Tests** (`test.e2e.tools`): Integration tests covering scale tool behavior (test edges uuids: `lCIfsQrW`, `CT551s2j`)

## Sub-Components to Implement

### Grip Handle System
- **Corner grips** (8 total): Scale uniformly in all dimensions, anchored at opposite corner
- **Edge grips** (12 total): Scale along one axis perpendicular to edge, anchored at opposite edge
- **Face grips** (6 total): Scale along two axes in face plane, anchored at opposite face

### Bounding Box Calculator
- Compute axis-aligned or oriented bounding box for arbitrary selection
- Update bounding box in real-time as geometry scales
- Handle multi-entity selections (union of bounds)

### Scale Transform Applier
- Apply scale matrices to entity geometry
- Support two modes:
  - **From opposite grip**: Scale relative to grip opposite the one being dragged (default)
  - **From center**: Scale relative to bounding box center (Ctrl modifier)
- Maintain entity relationships (groups, components) during scaling

### VCB Parser
- Parse single numerical input as uniform scale factor
- Parse "x,y,z" format as per-axis scale factors
- Display current scale factor(s) during drag operation
- Apply parsed values when user confirms input (Enter key)

### Visual Overlay Renderer
- Render bounding box edges in viewport
- Render grip handles with hover/active states
- Use appropriate cursor ("scale" cursor type)
- Clear overlays on tool deactivation

## Existing Code References

Implementation language is TypeScript. Complexity is classified as "moderate".

Related components with implementation folders:
- Scene Manager: `../data.scene/`
- Snap Point Constraint: `../constraint.snap_point/`
- Distance Constraint: `../constraint.distance/`
- Tool E2E Tests: `../test.e2e.tools/`

## Constraints

- **Real-time performance**: Bounding box and grip rendering must maintain 60fps during drag operations
- **Precision**: Support scaling with floating-point precision, but VCB input should round to reasonable decimal places for UX
- **Degeneracy handling**: Do not allow scaling to zero or negative dimensions (clamp to minimum epsilon)
- **Transformation integrity**: Scaled geometry must remain valid (no flipped normals, self-intersections introduced by tool itself)
- **Modifier key consistency**: Ctrl behavior (scale about center) must be toggle-able during drag, not locked at drag start