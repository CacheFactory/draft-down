# Rotate Tool

**Component ID**: `tool.rotate` (UUID: `WZyKJ6DX`)  
**Layer**: interaction  
**Category**: modify  
**Shortcut**: `Q`

## Purpose

The Rotate Tool enables users to rotate selected 3D entities around a specified axis. It provides a three-click workflow: set rotation center, set start angle, set end angle. Users can also type exact angles during the operation. The tool displays a real-time protractor visualization showing the current rotation angle and provides inference feedback during axis selection and angle input.

## Responsibilities

- Accept user input to define rotation center point, start angle reference, and end angle
- Display a visual protractor during the rotation operation showing current angle
- Apply rotation transformations to selected entities in the scene
- Support creation of rotated copies when modifier keys are held (Ctrl+Rotate)
- Lock rotation axis when arrow keys are pressed during operation
- Accept typed numeric angle values through the VCB (Value Control Box)
- Provide inference feedback during axis selection and angle specification
- Maintain rotation state across the three-click interaction sequence

## User Interaction Flow

1. **Click 1**: Set rotation center point (inference to existing geometry vertices/edges/faces)
2. **Click 2**: Set rotation start angle reference (inference to cardinal directions, on-axis positions)
3. **Click 3 or Type**: Set final rotation angle (type exact value or click position)
   - Optional: Press arrow keys to lock rotation to specific axis (X, Y, Z)
   - Optional: Hold Ctrl to create a rotated copy instead of modifying in place

## APIs Exposed

Must register as a tool with:
- Tool identifier: `tool.rotate`
- Keyboard shortcut: `Q`
- Cursor type: `rotate`
- Icon: `rotate`
- Category: `modify`

Must implement tool lifecycle methods:
- Activation (when tool is selected)
- Deactivation (when tool is deselected)
- Mouse move handlers (for preview and inference)
- Mouse click handlers (for three-step workflow)
- Keyboard input handlers (arrow keys for axis lock, numeric input for angle)
- Modifier key detection (Ctrl for copy mode)

Must provide visual feedback:
- Rotation axis indicator
- Protractor arc showing current angle
- Rotation preview on selected entities
- Inference markers at snap points and on-axis positions

## Data Dependencies

### Reads

- **Selected entities** from Scene Manager (`data.scene`)
  - Entity IDs, geometry data, current transformations
  - Selection must include at least one entity to rotate

- **Mouse position** from Drag Gesture (`gesture.drag`)
  - Screen coordinates converted to 3D world coordinates
  - Used for all three click positions and hover preview

- **Constraint inference results** from:
  - Snap Point Constraint (`constraint.snap_point`) — for rotation center and angle references
  - On-Axis Constraint (`constraint.on_axis`) — for axis-aligned rotation locks
  - Distance Constraint (`constraint.distance`) — for angle magnitude inference

- **Keyboard state**
  - Arrow key presses (axis lock)
  - Ctrl key state (copy mode)
  - Numeric input (exact angle values)

### Writes

- **Modified entity transformations** to Scene Manager (`data.scene`)
  - Applies rotation matrix to selected entities
  - Creates new entities if in copy mode
  - Updates entity geometry and transformation state

- **Tool state** (internal)
  - Current step (1, 2, or 3)
  - Rotation center point (3D coordinates)
  - Start angle reference point (3D coordinates)
  - Current angle value (degrees or radians)
  - Locked axis (if any)
  - Copy mode flag

## Component Dependencies

### Scene Manager (`data.scene`)
- **Reads**: Current selection, entity geometry, entity transformations
- **Writes**: Updated entity transformations, new entities (if copy mode)
- **Methods used**: 
  - Get selected entities
  - Apply transformation to entities
  - Clone entities (for copy mode)
  - Commit changes to undo stack

### Constraint System

#### Snap Point Constraint (`constraint.snap_point`)
- Used for inferring rotation center to existing vertices, edge midpoints, face centers
- Used for inferring angle reference points to geometry features
- Provides candidate snap points during mouse hover and click operations

#### On-Axis Constraint (`constraint.on_axis`)
- Used when arrow keys are pressed to lock rotation to X, Y, or Z axis
- Constrains rotation plane perpendicular to locked axis
- Provides visual feedback showing locked axis direction

#### Distance Constraint (`constraint.distance`)
- Used for inferring standard angles (15°, 30°, 45°, 90° increments)
- Provides angle magnitude snapping during rotation preview

### Drag Gesture (`gesture.drag`)
- Receives mouse movement and click events
- Provides 3D world coordinates from screen coordinates
- Triggers tool state transitions on click events

### Drawing Toolbar (`toolbar.drawing`) and Application Menu (`menu.main`)
- Tool is accessible from these UI components
- Must respond to activation requests from toolbar and menu

## Constraints

### Data Classification
- All tool state is ephemeral session data (no persistence required)
- Entity geometry modifications are persisted through Scene Manager
- Undo/redo handled by Scene Manager's operation stack

### Performance Requirements
- Rotation preview must render at interactive frame rates (>30 fps)
- Protractor visualization must update smoothly during mouse movement
- Support rotation of up to 1000 selected entities without lag

### Precision Requirements
- Rotation angles accurate to at least 0.1 degrees
- Typed angle values must be parsed and applied exactly
- Rotation center must snap precisely to inferred points

### Security/Trust Boundaries
- Tool operates on user's local scene data only
- No network operations
- All transformations are reversible through undo system

## Visual Feedback Requirements

The tool must render the following during operation:

1. **Rotation center marker** — visible after first click
2. **Rotation axis indicator** — line or arrow showing axis of rotation
3. **Protractor arc** — circular arc showing angle from start to current position
4. **Angle label** — numeric display of current angle in degrees
5. **Preview geometry** — ghosted/outlined preview of rotated entities
6. **Inference markers** — for snap points, on-axis positions, angle increments
7. **Cursor change** — to `rotate` cursor type when tool is active

## Validation Rules

- At least one entity must be selected before tool activates (or tool prompts for selection)
- Rotation center cannot be at the exact position of start angle reference (would create degenerate rotation)
- Rotation angle of 0° results in no transformation (no-op)
- Copy mode creates new entities without deleting originals

## Coordinate Systems

- Rotation center and angle references are in world coordinates
- Rotation axis is defined in world space
- Arrow key axis locks correspond to world X, Y, Z axes
- Entity transformations are applied in local entity space and accumulated to world space

## Error Conditions

- **No selection**: Display message or prevent tool activation
- **Degenerate rotation**: If center and angle reference are coincident, show error
- **Invalid typed angle**: If VCB input cannot be parsed, show validation error
- **Geometry operation failure**: If Scene Manager rejects transformation, revert to pre-rotation state

## Testing Requirements

Must be tested by Tool E2E Tests (`test.e2e.tools`):
- Three-click rotation workflow with various entity types
- Typed angle input through VCB
- Ctrl+Rotate copy mode
- Arrow key axis locking
- Inference snapping at each step
- Undo/redo of rotation operations
- Multiple entity selection rotation
- Edge cases (0° rotation, 360° rotation, negative angles)