# Tape Measure Tool

## Component Identity

**ID**: `tool.tape_measure`  
**UUID**: `9yqt3Wjr`  
**Kind**: tool  
**Layer**: interaction  
**Shortcut**: `T`

## Purpose

The Tape Measure Tool enables users to measure distances between points and create construction geometry for alignment and snapping. It provides three distinct modes of operation:

1. **Distance Measurement**: Click two points to measure and display the distance in the VCB (Value Control Box)
2. **Parallel Construction Lines**: Click an edge, then type an offset distance to create an infinite parallel construction line
3. **Construction Points**: Click a point in space to create a construction point for alignment

Construction geometry (lines and points) is infinite, non-renderable as solid geometry, and exists solely for snapping and alignment purposes.

## API Contract

### Tool Activation
- Activated via keyboard shortcut `T` or selection from Drawing Toolbar (`toolbar.drawing`)
- Cursor must change to `crosshair` when active
- Tool remains active until another tool is selected

### Interaction Modes

**Mode 1: Distance Measurement**
- User clicks first point (with snapping via `constraint.snap_point`)
- User clicks second point (with snapping via `constraint.snap_point`)
- Distance is calculated using `constraint.distance`
- Distance value is displayed in VCB in current document units
- Temporary visual indicator (line) drawn between points during measurement
- Measurement completes; tool remains active for next operation

**Mode 2: Parallel Construction Line**
- User clicks an edge (must detect edge entity from scene)
- Tool enters offset input mode, listening for VCB numeric input
- User types offset distance value
- Construction line created parallel to selected edge at specified offset distance
- Construction line is infinite in both directions along edge direction
- Construction line added to scene via `data.scene` (Scene Manager)
- Tool remains active for next operation

**Mode 3: Construction Point**
- User clicks point in 3D space (with snapping via `constraint.snap_point`)
- Construction point created at clicked location
- Construction point added to scene via `data.scene`
- Tool remains active for next operation

### Input Handling
- Must handle mouse click events for point/edge selection
- Must handle keyboard input for numeric distance values routed to/from VCB
- Must respond to `Escape` key to cancel current operation and return to idle state
- Must handle tool deactivation when another tool is selected

## Dependencies

### Scene Manager (`data.scene`)
- **Purpose**: Persist construction geometry entities
- **Operations**:
  - Add construction line entity with geometry data (position, direction, infinite flag)
  - Add construction point entity with 3D position
  - Query scene for edge entities when user clicks near edges
  - Query scene for existing geometry to enable snapping

### Snap Point Constraint (`constraint.snap_point`)
- **Purpose**: Enable precise point placement
- **Operations**:
  - Resolve clicked screen position to snapped 3D point
  - Snap to vertices, edge midpoints, face centers, construction points
  - Provide visual feedback during snap operations
  - Must work for both measurement points and construction point creation

### Distance Constraint (`constraint.distance`)
- **Purpose**: Calculate distances between points
- **Operations**:
  - Calculate 3D Euclidean distance between two points
  - Return distance in scene units (must convert to current document unit system for VCB display)

## Data Structures

### Construction Line Entity
Must store:
- Origin point (3D vector)
- Direction vector (3D normalized)
- Infinite flag (always true)
- Entity type identifier (for scene manager discrimination)
- Visual properties (layer, color, line style - typically dashed or dotted)

### Construction Point Entity
Must store:
- Position (3D vector)
- Entity type identifier
- Visual properties (size, color, symbol style)

## Visual Rendering

### During Active Measurement
- Render temporary line from first point to current cursor position
- Update dynamically as cursor moves
- Line should have distinct visual style (e.g., dashed, colored)
- Display current distance measurement at cursor or along line

### Construction Geometry Display
- Construction lines: Infinite dashed/dotted lines, distinct color (often blue or magenta)
- Construction points: Small cross or dot symbols, same distinct color
- Construction geometry must be on separate render layer from solid geometry
- Must be selectable for deletion but not for solid modeling operations

### VCB Integration
- Display "Distance:" label with numeric value during measurement
- Display "Offset:" label with input field during parallel line creation
- VCB must show units (inches, feet, meters, etc.) according to document settings
- VCB must accept numeric input with optional unit suffix override (e.g., "5.5m")

## Edge Detection Requirements

When user clicks for parallel construction line:
- Must perform raycasting against scene geometry
- Must identify clicked edge (line segment between two vertices)
- Must distinguish edges from faces/vertices
- Must provide visual feedback when hovering over valid edge (highlight)
- If click misses edge, ignore click or provide user feedback

## Constraints

### Security & Data Classification
- Construction geometry is part of document state — same classification as document
- No external data transmission required
- All computation occurs locally

### Performance
- Distance calculations must be real-time (< 16ms for smooth cursor tracking)
- Construction geometry must not degrade scene rendering performance
- Raycasting for edge detection must complete within interaction frame budget

### State Management
- Tool must maintain state machine: idle → first_point_selected → measurement_complete, or idle → edge_selected → offset_input → line_created
- Must clean up temporary visual indicators when measurement completes or operation cancels
- Must preserve construction geometry across tool switches (persisted in scene)

### Coordinate Systems
- All points and distances in scene coordinate space
- Must handle coordinate transformations if scene uses different units internally vs. display
- Construction lines are infinite — rendering system must clip to viewport bounds

## User Feedback Requirements

- Visual cursor change to crosshair when tool active
- Snap point visual indicators (from `constraint.snap_point`)
- Hover highlight on edges when in parallel line mode
- Temporary measurement line while measuring
- VCB updates during all operations
- Tooltip or status bar text indicating current tool mode/state

## Testing Surface

Must support E2E testing via `test.e2e.tools`:
- Programmatic tool activation
- Simulated click events at specific 3D coordinates
- VCB input injection for offset distances
- Verification of construction geometry creation in scene
- Verification of measurement values
- State machine transitions (mode changes, cancellation)

## Cleanup & Lifecycle

- Must unregister event listeners when tool deactivated
- Must clear temporary visual indicators when tool deactivated
- Must clear hover states when tool deactivated
- Construction geometry persists in scene after tool deactivation (part of document)