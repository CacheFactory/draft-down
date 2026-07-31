# Polygon Tool

## Purpose

The Polygon Tool enables users to draw regular polygons with 3 to 100 sides in the 3D workspace. It creates a planar face bounded by N edges, positioned at a user-specified center point with a user-specified radius. The default polygon is a hexagon (6 sides).

## Behavior

### Input Sequence

1. **Side Count Entry (Optional)**: User may type a number (3-100) before clicking to specify the number of sides. If no number is entered, default to 6 sides.
2. **Center Point Selection**: User clicks to establish the polygon center point in 3D space.
3. **Radius Definition**: User drags from center to define the polygon radius, then clicks to commit.

### Activation

- Keyboard shortcut: `Shift+P`
- Selectable from Drawing Toolbar (`toolbar.drawing`)
- When active, cursor changes to `crosshair`
- Icon identifier: `"polygon"`
- Category: `"draw"`

### Output

The tool creates geometry in the Scene Manager (`data.scene`) consisting of:
- A planar face (polygon) with N edges
- The face lies in a plane defined by the center point and current drawing context
- All vertices positioned equidistant from center (radius)
- Vertices evenly distributed around the circle (360/N degrees apart)

## Integration Points

### Scene Manager (`data.scene`)

**Modifies** the scene by adding new polygon geometry. Must invoke appropriate API to:
- Create a new face entity
- Define N edge entities forming the polygon boundary
- Position vertices in 3D space according to center and radius
- Ensure face normal orientation is correct for the active drawing plane

### Snap Point Constraint (`constraint.snap_point`)

**Uses** point snapping to:
- Snap the polygon center to nearby vertices, edge midpoints, face centers, or inference points
- Provide visual feedback when snap conditions are met
- Lock center position to snapped location when user clicks

### Distance Constraint (`constraint.distance`)

**Uses** distance constraint to:
- Display live radius measurement as user drags
- Allow numeric entry of exact radius value
- Snap radius to standard increments if configured
- Display distance feedback in user-preferred units

## Data Requirements

### Input Data

- Number of sides: integer in range [3, 100]
- Center point: 3D coordinate (x, y, z)
- Radius: positive floating-point distance value
- Drawing plane context: orientation and position of plane where polygon will be created

### Constraints

- Polygon must be planar (all vertices coplanar)
- Minimum 3 sides, maximum 100 sides
- Radius must be positive (non-zero)
- Vertices must be positioned precisely for regular polygon (equal edge lengths, equal interior angles)

## User Interface

### Visual Feedback During Interaction

- Preview circle or polygon outline as user drags
- Display current radius value
- Show current side count if user has typed a number
- Highlight snap points when center position will snap
- Display polygon preview with correct number of sides while dragging

### Numeric Input

- Accept typed numbers (3-100) for side count before clicking center
- Accept typed distance values for radius during drag operation
- Provide visual indication of entered values

## State Management

### Tool Lifecycle

- **Inactive**: Tool is available but not selected
- **Active/Awaiting Input**: Tool is selected, waiting for side count entry or center click
- **Center Defined**: Center point established, waiting for radius drag
- **Dragging**: User is actively defining radius
- **Complete**: Polygon created, tool returns to awaiting input or deactivates

### Cleanup

- Clear any preview geometry when tool deactivates
- Clear numeric input buffer when tool deactivates or operation completes
- Reset to default side count (6) when tool is reactivated

## Testing Surface

Tool E2E Tests (`test.e2e.tools`) must verify:
- Default hexagon creation (no side count specified)
- Custom side counts (3, 4, 5, 8, 12, 100 sides)
- Center point snapping behavior
- Radius numeric entry
- Cancellation/escape behavior
- Geometry correctness (planarity, equal edge lengths, proper vertex count)
- Integration with Scene Manager (geometry appears in scene)

## Security and Data Classification

- All operations are local
- No external data transmission
- User drawing data handled according to local file security model
- No authentication required for tool usage

## Implementation Constraints

- Language: TypeScript
- Complexity: Simple
- Must integrate with existing DraftDown tool architecture
- Must respond to tool activation/deactivation events
- Must respect current drawing context (active plane, units, snap settings)