# Arc Tool

## Component Identity
- **ID**: `tool.arc`
- **UUID**: `28E5lsDz`
- **Kind**: tool
- **Layer**: interaction
- **Language**: TypeScript
- **Complexity**: Moderate

## Purpose

The Arc Tool enables users to draw circular arcs in 3D space using a three-click workflow: start point, end point, then bulge distance to define the arc's curvature. The tool creates arc edges that can form tangent connections with adjacent line segments. It supports Value Control Box (VCB) input for precise radius specification or segment count control.

## Responsibilities

- Capture three sequential mouse clicks to define arc geometry: start point, end point, bulge point
- Provide real-time visual feedback showing preview arc as the user moves through each step
- Accept VCB numeric input to constrain radius or specify number of segments
- Create arc edge geometry and commit it to the scene
- Support two arc modes: 2-point arc (start/end + bulge) and pie arc (includes radial lines to center)
- Maintain tangent connections with adjacent line edges when appropriate
- Integrate with the constraint system for snapping and axis alignment
- Display crosshair cursor during arc drawing operations
- Respond to keyboard shortcut "A" for activation

## Tool Lifecycle States

The Arc Tool must progress through distinct interaction states:

1. **Inactive** — Tool not selected
2. **Awaiting Start Point** — User must click to define arc start
3. **Awaiting End Point** — User must click to define arc end (start point locked)
4. **Awaiting Bulge** — User must click to define arc curvature (start and end locked)
5. **Complete** — Arc committed to scene, tool returns to awaiting start point or deactivates

VCB input may modify behavior at specific states (e.g., entering a radius value during bulge selection).

## APIs Consumed

### Scene Manager (`data.scene`)
- **Modifies** scene data to add newly created arc edges
- Must read current scene geometry to determine tangent candidates
- Must respect existing edge endpoints for potential tangent connections
- Data structures: edge entities with arc geometry properties (center point, radius, start angle, end angle, normal vector)

### Constraint System
- **Snap Point Constraint** (`constraint.snap_point`): snaps click points to existing vertices, edge midpoints, face centers
- **On-Axis Constraint** (`constraint.on_axis`): constrains movement to primary axes (red/green/blue) or inference directions
- **Distance Constraint** (`constraint.distance`): enables VCB distance input to control radius or bulge magnitude

The tool must query constraints during each mouse move and click event to provide feedback and lock coordinates.

## APIs Exposed

### Tool Interface Contract
All tools must implement a common interface for activation, deactivation, event handling, and state management. The Arc Tool must expose:

- **Activate**: Called when tool is selected from Drawing Toolbar or via "A" shortcut
- **Deactivate**: Called when user selects different tool or presses Escape
- **Mouse Move**: Update preview geometry based on current cursor position and active constraints
- **Mouse Click**: Advance through states (start → end → bulge), commit geometry on final click
- **Key Press**: Handle VCB input, Escape to cancel, modifier keys for constraint toggling
- **Render Preview**: Provide visual feedback geometry to be drawn in viewport (dashed lines, preview arc)
- **Get Cursor**: Return "crosshair" cursor identifier
- **Get Status Text**: Return instructional text for status bar (e.g., "Click to set start point", "Type radius")

### VCB Input Contract
- Accept numeric input interpreted as radius (in current units) when awaiting bulge point
- Accept numeric input followed by "s" to specify segment count (e.g., "12s" for 12-segment arc)
- VCB entries constrain the subsequent click or complete the arc immediately if geometry is fully determined

## Data Written

### Arc Edge Geometry
Each created arc must be stored as an edge entity containing:
- **Start point** (3D coordinates)
- **End point** (3D coordinates)
- **Center point** (calculated from start, end, and bulge)
- **Radius** (distance from center to arc)
- **Start angle** and **end angle** (in the plane of the arc)
- **Normal vector** (defines the plane containing the arc)
- **Segment count** (number of line segments used to approximate the arc for rendering/export)
- **Tangent metadata** (references to connected edges if tangent joins exist)

Arc edges must integrate into the Scene Manager's edge collection and participate in face formation when edge loops are closed.

## Data Read

### Scene Geometry
- Existing vertices for snap point constraints
- Existing edges for tangent inference and connection detection
- Current face geometry to determine context for new arc placement
- Active construction geometry or guides

### User Preferences
- Default segment count for arc tessellation
- Unit system for VCB input interpretation
- Snap tolerance settings
- Constraint sensitivity settings

## Security Constraints

- **Data Classification**: All drawing data is user-generated local content (unclassified)
- **Trust Boundaries**: Tool runs entirely within the Electron main/renderer process boundary; no network communication
- **Input Validation**: VCB numeric input must be sanitized and validated (positive values for radius, integer segment counts in reasonable range 3-360)
- **Resource Limits**: Must handle degenerate cases gracefully (zero-radius arcs, collinear points, excessively high segment counts)

## Component Dependencies

### Required Components
- **Scene Manager** (`data.scene`): stores and retrieves edge geometry
- **Snap Point Constraint** (`constraint.snap_point`): provides point snapping during clicks
- **On-Axis Constraint** (`constraint.on_axis`): enables axis-locked movement
- **Distance Constraint** (`constraint.distance`): processes VCB distance input

### Optional Integrations
- Tangent inference engine (may be part of Scene Manager or separate geometry utility)
- Undo/redo system must be able to reverse arc creation

### Dependents
- **Drawing Toolbar** (`toolbar.drawing`): activates this tool when arc icon clicked or "A" pressed
- **Tool E2E Tests** (`test.e2e.tools`): exercises full interaction workflow

## Geometry Calculations

The Arc Tool must perform or delegate these calculations:

1. **Arc from Three Points**: Given start, end, and bulge point, compute center and radius
2. **Bulge to Center Conversion**: Translate bulge distance (perpendicular offset from chord) to arc parameters
3. **Tangent Detection**: Identify when arc endpoints align with adjacent line edges at tangent angles
4. **Segment Tessellation**: Divide arc into linear segments for rendering based on segment count or angle tolerance
5. **Plane Calculation**: Determine normal vector for the arc plane from the three input points
6. **Degenerate Case Handling**: 
   - Collinear points (bulge = 0) → create straight line edge instead
   - Start = end → invalid, prompt user
   - Infinite radius → fall back to line

## Interaction Modes

### 2-Point Arc Mode (Default)
1. Click start point
2. Click end point
3. Click or drag to define bulge distance perpendicular to chord
4. Arc edge created between start and end

### Pie Arc Mode
Same as 2-point mode, but additionally creates two radial edges from arc endpoints to center point, forming a pie-slice closed loop. Mode toggle may be via modifier key or toolbar option.

### VCB Behaviors
- **Radius Input**: Typing a number (e.g., "50") at bulge step constrains radius to that value; next click only determines arc direction
- **Segment Input**: Typing number + "s" (e.g., "24s") sets segment count for this arc
- **Lock and Continue**: If radius entered via VCB, tool may auto-complete arc if direction is inferrable (e.g., arc on-axis)

## Preview Rendering Requirements

During each state transition, the tool must provide preview geometry:
- **After start click**: Draw temporary point indicator at start
- **After end click**: Draw dashed line from start to end (chord), show preview arc as mouse moves for bulge selection
- **During bulge drag**: Continuously update preview arc curve and bulge distance dimension line
- **VCB active**: Display constraint feedback (locked radius circle or segment count annotation)

Preview geometry must not be committed to the scene but rendered in a distinct style (dashed, lighter color, or highlighted).

## Constraints and Inference

### Snap Point Constraint
- At each click, the tool queries available snap points within tolerance
- Snapped points take priority over free-space clicks
- Visual feedback indicates snap target before click is committed

### On-Axis Constraint
- Holding Shift or triggering axis lock constrains mouse movement to red/green/blue axes or inferred directions
- Inference directions may include tangent lines to existing curves or perpendicular lines to edges
- Axis-locked preview updates in real time

### Distance Constraint
- VCB entries activate distance constraint mode
- Numeric radius input creates a circle constraint centered at the midpoint of start-end chord
- Next click must fall on this constraint circle (or axis-locked radius)

## Edge Cases and Error Handling

- **Collinear Points**: If bulge point falls on the line between start and end, create a straight edge instead of an arc
- **Duplicate Points**: If start = end or end = bulge, display error message and return to previous state
- **Extreme Radii**: Limit radius to reasonable range (e.g., 0.01 to 10,000 in current units)
- **Excessive Segments**: Cap segment count at 360 to prevent performance issues
- **Escape Key**: Cancel current arc operation and return to awaiting start point or deactivate tool
- **Out-of-Plane Clicks**: In strict 2D mode, project clicks onto active plane; in 3D mode, allow arbitrary arc planes

## Testing Requirements

The **Tool E2E Tests** (`test.e2e.tools`) must validate:
- Complete 3-click arc creation workflow
- VCB radius input during bulge step
- VCB segment count input
- Snap point constraint integration (arc starts/ends at existing vertices)
- On-axis constraint behavior (arc constrained to axis-aligned planes)
- Tangent connection detection with adjacent edges
- Escape key cancellation at each state
- Degenerate input handling (collinear points, zero radius)
- Pie arc mode (if implemented)

## Integration Points

### Drawing Toolbar (`toolbar.drawing`)
- Tool icon: "arc"
- Keyboard shortcut: "A"
- Cursor: "crosshair"
- Category: "draw"

The toolbar must activate this tool when the arc icon is clicked or "A" is pressed, and deactivate it when another tool is selected.

### Scene Manager (`data.scene`)
- Tool commits arc edge entities via Scene Manager API
- Tool queries existing geometry for tangent detection
- Tool must trigger scene re-render after arc creation
- Undo/redo operations must be recorded for arc creation

## Notes

- The term "bulge" refers to the perpendicular distance from the chord (start-end line) to the arc at its midpoint
- A positive bulge creates a counter-clockwise arc; negative bulge creates clockwise arc (convention depends on coordinate system handedness)
- Tangent connections are automatic when arc endpoints align with adjacent line edges at calculated tangent angles (typically within a small tolerance)
- The tool should infer arc plane from the three clicked points; in native-style behavior, this often defaults to the active drawing plane if points are coplanar with it