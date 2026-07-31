# On-Axis Constraint

**Component ID:** `constraint.on_axis`  
**UUID:** `Mx6PeYve`  
**Layer:** modeling  
**Type:** parallel constraint (non-parametric)

## Purpose

The On-Axis Constraint is the most fundamental inference constraint in DraftDown, providing the signature "DraftDown feel" of guided drawing. It snaps cursor movement and geometry creation to align with the principal Red (X), Green (Y), or Blue (Z) axes of the global coordinate system. When active, it displays a colored inference line matching the axis being snapped to, giving immediate visual feedback that the user is drawing parallel to a major axis.

This constraint must be available during interactive drawing and transformation operations. It does not update parametrically after geometry is created — it applies only during the active operation.

## Responsibilities

- Detect when a cursor position or direction vector is nearly parallel to the X, Y, or Z axis
- Snap the position or vector to be exactly parallel to the closest matching axis
- Provide axis lock functionality where the user can force alignment to a specific axis (typically via arrow key input)
- Generate visual feedback data describing the axis line to be rendered (axis direction, color, and position)
- Integrate with the Inference Engine to register and activate this constraint during appropriate tool operations

## API Contract

### Input Data

**Candidate Point or Vector:**
- 3D position (Vector3) being evaluated for axis alignment
- Optional: direction vector if constraining a direction rather than absolute position
- Reference point (typically the operation start point) if snapping a position

**Context:**
- Current tool state or operation type
- User axis lock state (none, X-locked, Y-locked, Z-locked)
- Tolerance threshold for automatic snapping (angle or distance threshold)

### Output Data

**Constraint Result:**
- Boolean: whether constraint is active
- Constrained point or vector (Vector3) snapped to axis
- Axis identifier: "X", "Y", or "Z"
- Axis color: red (#FF0000), green (#00FF00), or blue (#0000FF)
- Inference line geometry for rendering: start point, end point, color

**Priority:** Must indicate priority level for the Inference Engine to resolve conflicts with other constraints

### Methods

Must expose methods to:
- `evaluate(point: Vector3, context: ConstraintContext): ConstraintResult | null` — Test if point should snap to axis
- `lock(axis: 'X' | 'Y' | 'Z'): void` — Force lock to specific axis
- `unlock(): void` — Clear axis lock
- `getAxisDirection(axis: 'X' | 'Y' | 'Z'): Vector3` — Return unit vector for axis
- `generateInferenceLine(result: ConstraintResult): InferenceLineGeometry` — Create visual feedback data

## Data Consumed

- User input: cursor position in 3D space (from raycasting or plane intersection)
- User input: arrow key presses (up/down for Z, left/right for X, modifier for Y)
- Inference Engine: current constraint context and active operation
- Global coordinate system: axis definitions and directions

## Data Produced

- Snapped 3D coordinates or direction vectors
- Inference line rendering data: geometry, color, visibility
- Constraint state: active axis, lock status

## Dependencies

### Consumed Components

- **Inference Engine** (`engine.inference`): Registers with and receives activation from the inference engine. Queries context about current operation and other active constraints.
- **Math/Vector Library** (Three.js Vector3): Uses vector math for distance calculations, dot products, and axis projections.

### Used By

- **Line Tool** (`tool.line`): Applies axis constraint during line segment creation
- **Rectangle Tool** (`tool.rectangle`): Constrains rectangle edges to axis-aligned directions
- **Move Tool** (`tool.move`): Snaps movement vectors to axis directions
- **Circle Tool** (`tool.circle`): May constrain circle plane normal or radius direction to axes
- **Arc Tool** (`tool.arc`): May constrain arc geometry to axis-aligned planes
- **Rotate Tool** (`tool.rotate`): May constrain rotation axis to principal axes

### Modifies

- **Inference Engine** (`engine.inference`): Registers constraint handlers, updates constraint priority during tool operations
- **Polyline Curve** (`curve.polyline`): Applies constrained points during polyline vertex creation

## Behavior Requirements

### Automatic Snapping

- When no axis is locked, evaluate cursor position against all three axes
- Calculate angular deviation or distance from each axis
- If within tolerance threshold, snap to closest axis
- Tolerance must be tuned to feel responsive but not "sticky" — typically 5-15 degrees for direction vectors
- Prefer the axis most closely aligned with cursor movement direction

### Axis Lock

- User must be able to lock to X, Y, or Z via keyboard input (arrow keys)
- Lock state persists until explicitly unlocked or operation completes
- Locked axis takes absolute priority over other constraints
- Visual feedback must clearly indicate lock state (brighter/thicker line, persistent display)

### Visual Feedback

- Display colored inference line extending from reference point along the active axis
- Line color: red for X, green for Y, blue for Z (standard CAD convention)
- Line must extend in both directions from reference point or only in direction of cursor
- Line appearance may intensify when locked vs. automatically snapped

### Coordinate System

- Axes are defined in global space, not relative to camera or selection
- X: typically horizontal right (red)
- Y: typically horizontal forward/back (green)
- Z: typically vertical up (blue)
- Must work correctly regardless of camera orientation

### Integration with Inference Engine

- Register as a parallel constraint type
- Declare priority level (high, as fundamental constraint)
- Respond to activation/deactivation signals from engine
- Coexist with other constraints: may be overridden by exact point snaps (endpoints, midpoints) but should remain visible

## Performance Requirements

- Constraint evaluation must complete in <1ms to maintain 60fps interaction
- No allocations or heavy computation per frame
- Cache axis direction vectors and color constants

## Security and Data Classification

- No sensitive data
- All computation is local, ephemeral during tool operation
- No persistence beyond operation lifetime
- No network interaction

## Implementation Constraints

- TypeScript implementation
- Must integrate with Three.js Vector3 and math utilities
- Must follow Inference Engine plugin/constraint registration pattern
- No external dependencies beyond Three.js and inference engine interface
- Simple complexity — straightforward geometric calculation and state management

## Known Issues and Considerations

- Priority relative to other constraints must be carefully tuned
- Tolerance thresholds may need per-tool customization
- Axis lock key bindings must not conflict with other application shortcuts
- Must gracefully handle edge cases: cursor exactly on axis, rapid axis switching
- Visual line rendering is responsibility of inference visualization layer, not this constraint itself

## Testing Requirements

- Verify snapping accuracy: constrained points are exactly on axis
- Verify tolerance behavior: snaps within threshold, ignores beyond
- Verify axis lock: persists correctly, overrides automatic snapping
- Verify priority: interacts correctly with other inference constraints
- Verify visual output: correct axis identification and color mapping
- Test all three axes independently
- Test axis switching during continuous mouse movement