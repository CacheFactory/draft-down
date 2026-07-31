# Offset Tool

## What This Component Is

The Offset Tool is an interactive tool in DraftDown's drawing toolbar that enables users to create offset copies of edges or faces in the 3D modeling environment. It provides a click-drag-release interaction pattern for visually specifying offset distances, keyboard-driven exact distance entry via the VCB (Value Control Box), and double-click repeat functionality for repeated offsets at the same distance.

This tool translates user input (mouse movements, clicks, keyboard) into geometry operations that create inset or outset copies of edge loops around selected faces.

## Responsibilities

- Activate when selected from the Drawing Toolbar or via the 'F' keyboard shortcut
- Change the cursor to crosshair when active
- Detect and highlight faces under the cursor for offset selection
- Accept face selection via click
- Track mouse position during drag to compute offset distance dynamically
- Display real-time preview of offset geometry during drag
- Support typed numerical input for exact offset distance via VCB
- Commit offset operation on mouse release or VCB entry confirmation
- Remember last offset distance for double-click repeat functionality
- Deactivate and return to default tool state after operation completion
- Handle cancel/escape to abort operation in progress

## APIs Exposed

This tool must implement the standard DraftDown tool interface (exact method signatures to be defined by the tool manager, but typically includes):

- `activate()`: Called when tool becomes active
- `deactivate()`: Called when tool becomes inactive
- `onMouseMove(event)`: Handle mouse movement for hover feedback and drag distance
- `onMouseDown(event)`: Handle initial face selection click
- `onMouseDrag(event)`: Handle drag to specify offset distance
- `onMouseUp(event)`: Commit offset operation
- `onDoubleClick(event)`: Repeat last offset on newly selected face
- `onKeyDown(event)`: Handle VCB input and escape key
- `onVCBEntry(value)`: Handle exact distance entry from VCB
- `getCursor()`: Returns `"crosshair"`
- `getIcon()`: Returns `"offset"`

## APIs Consumed

### Offset Edges Operation (`op.offset`)
Invokes the core offset edges operation to perform the actual geometry modification. Must pass:
- Selected face entity reference
- Offset distance (positive for outset, negative for inset)
- Geometry context/scene reference

### Snap Point Constraint (`constraint.snap_point`)
Uses snap point constraint during interaction to:
- Snap cursor to geometry vertices during drag
- Provide visual feedback for snap points
- Lock offset distance to snapped geometry

### Distance Constraint (`constraint.distance`)
Uses distance constraint during interaction to:
- Measure and constrain offset distance during drag
- Display distance dimension overlay
- Validate and format VCB distance input

## Data Read/Write

### Read
- Current selection state (what face is under cursor or selected)
- Scene geometry data to determine valid offset targets
- Last offset distance value (stored in tool state or user preferences)
- VCB input text
- Mouse position in viewport coordinates
- Camera/viewport transform for screen-to-world projection

### Write
- Tool state (active, face selected, dragging, awaiting VCB input)
- Preview geometry to rendering layer (temporary visual feedback)
- Committed geometry via `op.offset` invocation
- Last offset distance to persistent state
- VCB display text (showing current offset distance)
- Cursor state to UI layer
- Status bar hints/instructions

## Security Constraints

**Data Classification**: All data handled is user-generated 3D model data — no sensitive information.

**Trust Boundaries**: 
- Operates entirely within the Electron desktop application sandbox
- No network communication
- No cloud dependencies
- User input validation required only for VCB numerical entry (must handle malformed input gracefully)

**Constraints**:
- Must not modify geometry until user confirms operation (mouse up or VCB enter)
- Must not persist changes on cancel/escape
- Preview geometry must be clearly distinguished from committed geometry

## Dependencies

### Direct Dependencies
- **Offset Edges Operation** (`op.offset`): Core geometric operation this tool invokes
- **Snap Point Constraint** (`constraint.snap_point`): Provides snapping during interaction
- **Distance Constraint** (`constraint.distance`): Measures and constrains offset distance
- Tool Manager (implicit): Registers tool, handles activation/deactivation
- VCB Component (implicit): Receives keyboard input for exact distances
- Rendering System (implicit): Displays preview geometry

### Dependents
- **Drawing Toolbar** (`toolbar.drawing`): Contains this tool as a selectable option
- **Tool E2E Tests** (`test.e2e.tools`): Validates tool behavior through automated tests

## Sub-Components to Implement

Within this tool's implementation, the following sub-components must be built:

### 1. Face Selection Handler
Detects faces under cursor, highlights them, and captures face selection on click.

### 2. Offset Distance Calculator
Computes offset distance from initial click point to current drag position, accounting for camera projection and geometry normal direction.

### 3. Preview Renderer
Generates and displays temporary preview of offset edges during drag operation without modifying actual geometry.

### 4. VCB Input Parser
Parses and validates typed distance values, supporting units if applicable (e.g., "5mm", "2in", or unitless numbers).

### 5. Double-Click State Manager
Tracks timing and context of clicks to detect double-click and retrieve last offset distance.

### 6. Operation Committer
Coordinates final invocation of `op.offset` with calculated or entered distance value.

## Requirements and Constraints

### Interaction Flow
1. Tool activated → cursor changes to crosshair, status bar shows instructions
2. Hover over face → face highlights
3. Click face → face selected, enter drag mode
4. Drag outward/inward → preview shows offset at current distance, VCB displays distance
5. Release mouse → commit offset operation, deselect, return to hover state
6. OR: Type distance → VCB captures input, preview updates
7. OR: Press Enter → commit offset at typed distance
8. OR: Press Escape → cancel operation, clear selection
9. Double-click face → immediately apply last offset distance to that face

### Distance Behavior
- Outward drag (away from face center) = positive offset (outset)
- Inward drag (toward face center) = negative offset (inset)
- Distance must be measurable in scene units
- VCB must support direct numerical entry overriding visual drag distance

### Edge Cases
- Offset distance too large causing self-intersection: defer to `op.offset` to handle or reject
- Offset on non-planar face: defer to `op.offset` to handle
- Double-click with no previous offset: use default distance (e.g., 1 unit) or prompt user
- VCB input invalid: show error, remain in input mode

### Performance
- Preview geometry must update smoothly during drag (target 60fps)
- Face highlighting must be responsive on hover

### User Experience
- Clear visual distinction between preview and committed geometry (e.g., dashed lines, different color)
- Snap feedback must be immediate and obvious
- VCB must be prominently visible during operation
- Status bar must guide user through each step

## Existing Code References

None specified. This is a new implementation within the DraftDown codebase. Follow established patterns from other tools in the `interaction` layer (e.g., push/pull tool, line tool) for consistency in tool lifecycle management, event handling, and preview rendering.