# Circle Tool

## What This Component Is

The Circle Tool (`tool.circle`) is an interactive drawing tool that enables users to create circular geometry in 3D space. It produces polygon approximations of circles that automatically form faces when drawn on a plane or coplanar with existing geometry. The tool operates in a two-step click interaction: first click defines the circle's center point, second click defines a point on the circumference (establishing the radius). Users can alternatively type exact radius values during the operation.

This component is activated via keyboard shortcut `C` or through the Drawing Toolbar and Application Menu. When active, it changes the cursor to crosshair mode and responds to mouse events, keyboard input, and the inference/constraint system.

## Responsibilities

- Accept user input to define circle center and radius through click interactions
- Display real-time preview of the circle during the drawing operation
- Parse and validate numeric input from the Value Control Box (VCB) for exact radius specification
- Parse segment count input (format: `s` + number) before drawing to control circle tessellation
- Apply default segment count of 24 if not specified
- Generate polygon vertices approximating a circle with the specified segment count
- Submit completed circle geometry to the Scene Manager as a closed polygon face
- Integrate with the constraint system to snap center point to existing geometry
- Maintain tool state across mouse move, click, and keyboard events
- Provide visual feedback (preview geometry) during the two-step operation

## APIs and Interactions

### Activation
- Registered with Drawing Toolbar (`toolbar.drawing`) and Application Menu (`menu.main`) as an activatable tool
- Responds to keyboard shortcut `C`
- Sets cursor to `crosshair` when active

### Input Events
Must respond to:
- Mouse move events (for preview and inference feedback)
- Mouse click events (center point selection, radius point selection)
- Keyboard input for:
  - Numeric values (radius in current units)
  - Segment count specification (`s` followed by number, e.g., `s48`)
  - Escape key (cancel operation)
- VCB input stream for typed numeric values

### Constraint System Integration
Uses the following constraints via the constraint layer:
- **Snap Point Constraint** (`constraint.snap_point`): Snaps the center point to vertices, edge midpoints, face centers, and other inference points in existing geometry
- **On-Axis Constraint** (`constraint.on_axis`): Constrains radius point movement along primary axes when appropriate inference conditions are met
- **Distance Constraint** (`constraint.distance`): Interprets and validates numeric distance input for exact radius specification

### Scene Manager Integration
Modifies the Scene Manager (`data.scene`) by:
- Submitting completed circle geometry as a polygon entity
- Circle geometry must be represented as a closed sequence of 3D points forming a coplanar polygon
- The polygon must have properties that allow it to form a face when coplanar with existing geometry or on a principal plane

Expected data shape for circle submission:
- Array of 3D vertex positions (Vector3 or equivalent with x, y, z coordinates)
- Vertices ordered to form a closed loop
- Segment count between minimum (e.g., 3) and reasonable maximum (e.g., 100+)
- Metadata indicating this is a closed polygon that should form a face

## Data Reading and Writing

### Reads
- Current mouse position in 3D space (via viewport/camera projection)
- Existing scene geometry for inference and snapping (via Scene Manager or constraint system)
- User keyboard input (numeric values, segment count commands)
- Current unit system and precision settings (for VCB display and input parsing)
- Active constraints and inference results from the constraint system

### Writes
- Completed circle polygon to Scene Manager as new geometry
- Visual preview geometry to the rendering system (temporary, not persisted)
- Tool state and mode to UI indicators (e.g., VCB prompt, status text)

### Data Classification
- **Public**: Tool metadata (name, icon, shortcut) exposed to UI components
- **Internal**: Transient state (current center point, radius, segment count, preview vertices)
- **Scene Data**: Final geometry written to Scene Manager is part of the user's model data (saved with project)

## Security and Trust Boundaries

- Runs in Electron renderer process (trusted local context)
- No network communication required
- User input (numeric values, segment counts) must be validated:
  - Numeric radius must be positive and within reasonable bounds
  - Segment count must be integer ≥ 3 and ≤ reasonable maximum
  - Invalid input should provide clear feedback without crashing
- Geometry generation must handle edge cases:
  - Zero or near-zero radius
  - Extreme segment counts
  - Degenerate cases where center and radius point are identical

## Component Dependencies

### Required Dependencies
- **Scene Manager** (`data.scene`): Target for completed geometry submission
- **Snap Point Constraint** (`constraint.snap_point`): Provides inference snapping for center point
- **On-Axis Constraint** (`constraint.on_axis`): Enables axis-aligned radius definition
- **Distance Constraint** (`constraint.distance`): Validates and interprets typed radius values

### Dependents
- **Drawing Toolbar** (`toolbar.drawing`): Contains this tool as an activatable option
- **Application Menu** (`menu.main`): Contains this tool in menu structure
- **Tool E2E Tests** (`test.e2e.tools`): Validates tool behavior through automated tests

## Sub-Components and Internal Structure

The Circle Tool must implement:

1. **State Machine**: Manages tool states:
   - Inactive (tool not selected)
   - Awaiting center point (first click)
   - Awaiting radius point (second click, with preview)
   - Segment count specification mode (after typing `s`)

2. **Input Handler**: Processes:
   - Mouse events (click, move)
   - Keyboard events (VCB input, escape, segment count specification)
   - Coordinate transformation from screen to 3D space

3. **Geometry Generator**: 
   - Computes circle vertices as polygon approximation
   - Takes center point, radius, segment count, and normal vector
   - Produces array of 3D vertex positions
   - Vertices must be coplanar and form a valid closed polygon

4. **Preview Renderer**:
   - Generates real-time visual feedback during radius definition
   - Shows circle outline with current segment count
   - Updates on mouse move and parameter changes

5. **VCB Interface**:
   - Displays current mode prompt (e.g., "Specify radius:")
   - Accepts and validates numeric input
   - Parses segment count specification (e.g., "s24")
   - Shows current radius value during operation

6. **Constraint Integration Layer**:
   - Queries constraint system for snap points during center selection
   - Applies axis constraints during radius definition
   - Validates distance input through Distance Constraint

## Plane and Orientation Behavior

The circle must be drawn on a plane determined by:
- If center point snaps to an existing face: use that face's normal
- If no face context: use the current working plane or camera's up vector
- The radius point selection defines the circle's size but not its out-of-plane orientation
- Circle vertices must all lie on the determined plane

## Implementation Constraints

- Implementation language: TypeScript
- Complexity level: Moderate
- Must integrate with existing tool activation/deactivation framework
- Must follow DraftDown's tool interface contract (assumed to exist for tools in this layer)
- Coordinate system: right-handed 3D (consistent with Three.js)
- Units: Must respect current document unit system (e.g., inches, meters, millimeters)

## Testing Requirements

- Tested by Tool E2E Tests (`test.e2e.tools`)
- Must support automated testing of:
  - Two-click circle creation
  - Typed radius input via VCB
  - Segment count specification
  - Center point snapping to existing geometry
  - Circle creation on different planes and orientations
  - Cancellation behavior (Escape key)
  - Invalid input handling

## References

- Archigraph ID: `tool.circle`
- UUID: `wnTrJPzS`
- Layer: interaction
- Kind: tool
- Related implementation folders:
  - `../data.scene/` — Scene Manager
  - `../constraint.snap_point/` — Snap Point Constraint
  - `../constraint.on_axis/` — On-Axis Constraint
  - `../constraint.distance/` — Distance Constraint
  - `../test.e2e.tools/` — Tool E2E Tests