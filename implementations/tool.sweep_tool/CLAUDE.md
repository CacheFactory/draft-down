# Sweep Tool

## Identity

- **ID**: `tool.sweep_tool`
- **UUID**: `udD539qm`
- **Layer**: interaction
- **Category**: modify
- **Language**: TypeScript
- **Complexity**: complex

## Purpose

The Sweep Tool performs sweep extrusions by extruding a face profile along a path of connected edges. It creates complex 3D shapes such as cornices, pipes, moldings, and lathe-turned objects by sweeping the profile perpendicular to the path at each segment.

## Activation & UI

- **Keyboard shortcut**: `Shift+F`
- **Cursor**: crosshair
- **Icon**: `sweep`
- **Toolbar**: contained in Drawing Toolbar (`toolbar.drawing`)

## Operating Modes

The tool supports two interaction patterns:

### Pre-selection Mode
1. User pre-selects a path (sequence of connected edges)
2. User activates the tool
3. User clicks a face to use as the profile
4. Tool immediately performs the sweep operation

### Interactive Mode
1. User activates the tool
2. User clicks a face to use as the profile
3. User drags the cursor along edges to define the path
4. Tool performs the sweep operation on mouse release or path completion

## Input Requirements

### Profile Face
- Must be a single, coplanar face from the existing geometry
- Face selection must be unambiguous (single click hit)
- Profile orientation determines the initial sweep direction

### Path Edges
- Must form a continuous, connected sequence
- Can include linear segments and curves
- Path can be open or closed (closed paths create ring-like swept geometry)
- Edge connectivity must be topologically valid

## Geometry Constraints

### Snap Behavior
- Must use Snap Point Constraint (`constraint.snap_point`) for path edge selection
- Snapping ensures accurate path construction during interactive mode
- Snap feedback must be visible during drag operation

### Sweep Orientation
- Profile face must remain perpendicular to the path tangent at each point
- Profile plane normal must align with the path direction vector
- At path vertices, handle corner transitions smoothly (may require profile rotation or scaling)

## Operations & Data Flow

### Scene Modification
- Modifies Scene Manager (`data.scene`) to add new swept geometry
- Must create new solid geometry from the sweep operation
- Original profile face and path edges may be retained or consumed based on operation semantics

### Sweep Operation
- Invokes Sweep operation (`op.sweep`) with:
  - Profile face geometry (vertex positions, face normal)
  - Path edge sequence (ordered list of edge endpoints and curves)
  - Orientation constraints (perpendicularity requirement)

### Expected Input Data Shape
```typescript
{
  profileFace: {
    vertices: Vector3[],
    normal: Vector3,
    faceId: string
  },
  path: {
    edges: Array<{
      edgeId: string,
      startPoint: Vector3,
      endPoint: Vector3,
      curveData?: BezierCurve | ArcCurve
    }>,
    isClosed: boolean
  }
}
```

## Constraints & Validation

### Pre-flight Checks
- Profile face must be valid and non-degenerate
- Path must have at least one edge
- Path edges must form a connected chain
- Profile face and path must not be coplanar (would produce zero-volume sweep)

### Error Handling
- If profile selection is invalid, show error feedback and wait for valid selection
- If path is incomplete or disconnected, show error and require re-selection
- If sweep operation fails (self-intersections, degenerate geometry), rollback and notify user

### Performance Considerations
- Complex paths (many segments) or high-resolution profiles may require progress indication
- Sweep computation should be non-blocking (use async/await or workers if needed)
- Preview rendering during interactive drag must remain responsive

## Tool Lifecycle

### Activation
1. User triggers via shortcut or toolbar
2. Tool changes cursor to crosshair
3. If path is pre-selected, enter "select profile" state
4. If nothing is selected, enter "select profile or path" state

### Deactivation
- On successful sweep completion
- On user canceling (Escape key)
- On user selecting another tool
- Must clean up any temporary preview geometry

### State Management
- Track current mode (awaiting profile, awaiting path, dragging path)
- Track selected profile face
- Track accumulated path edges during interactive mode
- Maintain undo checkpoint before operation execution

## Integration Points

### Depends On
- **Sweep** (`op.sweep`): core sweep algorithm and geometry generation
- **Scene Manager** (`data.scene`): reading existing geometry, writing new geometry
- **Snap Point Constraint** (`constraint.snap_point`): snap feedback during path selection

### Used By
- **Drawing Toolbar** (`toolbar.drawing`): tool activation
- **Tool E2E Tests** (`test.e2e.tools`): automated testing of tool behavior

## Security & Data Classification

- Operates entirely on local geometry data
- No network access required
- No sensitive data handling
- All computation is client-side in the Electron process

## Testing Requirements

Must be tested by Tool E2E Tests (`test.e2e.tools`) covering:
- Pre-selection mode workflow
- Interactive drag mode workflow
- Path validation (connected edges, closed paths)
- Profile selection validation
- Sweep operation success and rollback on failure
- Undo/redo integration
- Edge cases (self-intersecting paths, coplanar profile/path, degenerate geometry)

## References

