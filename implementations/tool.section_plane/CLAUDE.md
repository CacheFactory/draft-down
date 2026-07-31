# Section Plane Tool

## What This Component Is

The Section Plane Tool (`tool.section_plane`) enables users to create and manipulate section planes that cut through the 3D model to reveal interior geometry. It is an interactive tool in the view category, activated via `Shift+X` keyboard shortcut or from the Views Toolbar. When active, the tool displays a crosshair cursor and allows placement of section planes aligned to face normals.

## Responsibilities

- Detect face clicks and create section planes aligned to the clicked face's normal vector
- Allow manipulation of section planes: translation, rotation
- Toggle section planes between active and inactive states
- Support multiple section planes in the scene with only one active at a time
- Trigger viewport clipping of all geometry behind the active section plane
- Display section fill (hatching) on cut faces where the active plane intersects geometry
- Persist section plane entities in the scene

## APIs Exposed

The component must implement the standard tool interface:

- **Activation**: Respond to tool selection from Views Toolbar or `Shift+X` shortcut
- **Deactivation**: Clean up when another tool is selected
- **Mouse Events**: Handle click, drag, move events for placement and manipulation
- **Keyboard Events**: Handle shortcut and modifier keys during tool use
- **Selection Events**: Respond to section plane selection for manipulation

## Data Consumed

### From Scene Manager (`data.scene`)

- Face geometry data: positions, normals, parent entity references
- Existing section plane entities: position, orientation, active state, fill settings
- Scene graph hierarchy for traversing geometry to detect intersections
- Camera data for viewport-relative positioning and orientation feedback

### From Snap Point Constraint (`constraint.snap_point`)

- Snap targets when positioning or moving section planes
- Inference points for aligning planes to geometric features

## Data Written

### To Scene Manager (`data.scene`)

- **Section Plane Entities**: New section plane objects with:
  - Position (3D point)
  - Normal vector (unit vector defining plane orientation)
  - Active state (boolean)
  - Fill enabled (boolean)
  - Unique identifier
  - Bounding representation (quad or bounded plane mesh)
- **Updates to Existing Section Planes**:
  - Modified position after move operations
  - Modified orientation after rotation
  - Toggled active state
  - Toggled fill state
- **Scene Modification Events**: Trigger scene graph updates and re-render

## Data Shapes

### Section Plane Entity

```
{
  id: string (unique identifier)
  type: "SectionPlane"
  position: Vector3 (point on plane)
  normal: Vector3 (unit vector perpendicular to plane)
  active: boolean (whether plane clips geometry)
  fillEnabled: boolean (whether to show hatching on cut faces)
  visualBounds: {
    width: number
    height: number
  }
  metadata: {
    createdAt: timestamp
    createdBy: "section_plane_tool"
  }
}
```

### Face Data (consumed)

```
{
  id: string
  vertices: Vector3[]
  normal: Vector3
  material: MaterialReference
  parentEntity: EntityReference
}
```

## Security Constraints

- **Data Classification**: All section plane data is user-generated local content
- **Trust Boundary**: Section planes are first-party geometry entities with no external data sources
- **Validation**: Ensure normal vectors are unit length; validate position coordinates are finite numbers
- **Resource Limits**: Limit total number of section planes to prevent performance degradation (reasonable cap: 50-100 planes)

## Component Dependencies

### Depends On

- **Scene Manager** (`data.scene`): Reads geometry, writes section plane entities, triggers viewport updates
- **Snap Point Constraint** (`constraint.snap_point`): Queries snap targets during placement and manipulation

### Depended On By

- **Views Toolbar** (`toolbar.views`): Triggers tool activation
- **Tool E2E Tests** (`test.e2e.tools`): Validates tool behavior

## Interaction Requirements

### Placement Workflow

1. User activates tool (Views Toolbar click or `Shift+X`)
2. User hovers over model faces; tool highlights hovered face
3. User clicks a face
4. Section plane created at click point, aligned to face normal
5. Section plane enters manipulation mode for immediate adjustment
6. User can commit placement (click elsewhere) or cancel (Esc)

### Manipulation Workflow

1. User selects existing section plane
2. Tool displays manipulation handles: move arrows, rotation arcs
3. User drags handles to adjust position or orientation
4. Snap Point Constraint provides inference feedback
5. User commits or cancels changes

### Active State Management

- Only one section plane can be active at a time
- Activating a different plane deactivates the current one
- Active plane applies real-time clipping in viewport
- Inactive planes remain visible but do not affect geometry rendering

### Section Fill

- When active plane intersects solid geometry, cut faces are identified
- Cut faces display hatching pattern (default: parallel lines at 45° angle)
- Fill style and visibility controlled by section plane entity properties

## Constraints

- **Single Active Plane**: Enforce one active section plane maximum
- **Normal Vector Integrity**: Section plane normals must remain unit vectors
- **Performance**: Clipping and section fill must render at interactive frame rates (>30 FPS) for typical models (<100k triangles)
- **Precision**: Plane positioning accurate to model tolerance (typically 0.001 units)
- **Undo/Redo**: All section plane operations (create, move, rotate, activate, delete) must be undoable

## Visual Representation

- Section plane displays as a bounded rectangular plane with distinct visual styling
- Active planes have different appearance than inactive planes (e.g., solid vs. dashed boundary)
- Manipulation handles appear on selected planes
- Section fill hatching overlays cut geometry faces
- Plane extends beyond visible bounds but has finite visual representation

## Integration Points

- **Viewport Rendering**: Section plane clipping affects WebGL rendering pipeline
- **Selection System**: Section planes are selectable entities in the scene
- **Camera System**: Section plane visibility may depend on camera position/frustum
- **Export**: Section planes may be included in exported views but are not geometry for export
- **Plugins**: Plugin API may need to query or create section planes programmatically

## Non-Requirements

- This component does not handle:
  - Scene persistence to disk (Scene Manager responsibility)
  - Undo/redo stack management (handled by application-level history system)
  - Rendering implementation details (Three.js renderer responsibility)
  - UI panel for section plane properties list (separate UI component)
  - Advanced section fill patterns beyond standard hatching (future enhancement)