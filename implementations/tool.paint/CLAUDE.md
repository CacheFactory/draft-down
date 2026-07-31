# Paint Bucket Tool

## What This Component Is

The Paint Bucket Tool is an interactive tool that allows users to apply materials and colors to 3D geometry faces in the DraftDown CAD application. It supports multiple interaction modes: single-face painting, material sampling, bulk application to matching materials, and flood-fill to connected faces. Materials include visual properties like albedo color, texture maps, opacity, and physically-based rendering (PBR) parameters.

This tool is activated via keyboard shortcut `B` or by clicking its icon in the main toolbar (`toolbar.main`). When active, the cursor changes to a pointer style.

## What This Component Must Do

### Material Application Modes

**Single Face Application (Default Click)**
- Click a face to apply the currently selected material to that face only
- Must perform hit testing against scene geometry to identify the clicked face
- Must update the face's material properties in the Scene Manager (`data.scene`)
- Must provide visual feedback during hover and after application

**Material Sampling (Alt+Click)**
- Alt+click a face to sample its current material
- Must extract all material properties from the clicked face
- Must set the sampled material as the new current material for subsequent applications
- The sampled material becomes the active material in the material selection UI

**Bulk Same-Material Application (Shift+Click)**
- Shift+click a face to apply the current material to all faces that currently share the same material as the clicked face
- Must identify all faces in the scene with matching material properties
- Must batch-update all matching faces atomically

**Connected Face Flood-Fill (Ctrl+Click)**
- Ctrl+click a face to apply the current material to all faces connected to the clicked face that share its current material
- Must perform flood-fill traversal through connected coplanar or edge-adjacent faces
- Only fills faces with the same material as the initial clicked face
- Must respect geometry boundaries and discontinuities

### Material Properties

Materials must support:
- **Albedo Color**: RGB or RGBA color values
- **Texture Map**: Reference to texture image file (path or ID)
- **Opacity**: Transparency value (0.0 = fully transparent, 1.0 = fully opaque)
- **PBR Properties**: Metalness, roughness, normal maps, and other physically-based rendering parameters

### Interaction Requirements

- Must use the Snap Point Constraint (`constraint.snap_point`) for cursor positioning and face hit detection
- Must provide real-time visual feedback showing which face will be painted on hover
- Must handle mouse events: click, alt+click, shift+click, ctrl+click
- Must support undo/redo for all paint operations via the Scene Manager's command system
- Must maintain tool state when switching between tools and returning

### Scene Manager Integration

- **Modifies**: `data.scene` — All material changes must be persisted through the Scene Manager's API
- Must call appropriate Scene Manager methods to:
  - Update face material properties
  - Query current face materials for sampling
  - Query all faces for bulk operations
  - Record operations for undo/redo history
- Must respect the Scene Manager's transaction boundaries for atomic multi-face updates

### Snap Point Constraint Usage

- **Uses**: `constraint.snap_point` — For cursor positioning and hit testing
- Must query the constraint system to:
  - Identify faces under the cursor position
  - Get precise 3D coordinates for click events
  - Receive hover feedback for visual highlighting

## Data Read/Write

**Reads**:
- Current material selection (from material palette or UI state)
- Face geometry and current material assignments from Scene Manager
- Mouse/cursor position and modifier key states
- Snap constraint results for face identification

**Writes**:
- Face material properties to Scene Manager
- Current active material when sampling
- Tool state (active/inactive, current material, hover face)
- Undo/redo commands to Scene Manager

## Security Constraints

- **Data Classification**: Geometry and material data is user content — handle as user-editable data
- **Trust Boundary**: All operations are local to the user's machine; no external data transmission
- **File System Access**: Texture map references must use validated file paths when loading external images
- **Input Validation**: Must validate material property values (e.g., color ranges, opacity bounds, valid texture paths)

## Dependencies

**Depends On**:
- `data.scene` (Scene Manager) — For reading geometry, querying faces, and persisting material changes
- `constraint.snap_point` (Snap Point Constraint) — For cursor positioning and face hit detection
- Material selection UI component (implied) — Source of current material to apply
- Mouse/keyboard input system — For detecting clicks and modifier keys

**Depended On By**:
- `toolbar.main` (Main Toolbar) — Contains this tool as an activatable option
- `test.e2e.tools` (Tool E2E Tests) — Validates paint tool functionality through automated tests

## APIs and Contracts

### Tool Lifecycle API (Expected)

Must implement standard tool interface:
- `activate()` — Called when tool becomes active (shortcut `B` pressed or toolbar clicked)
- `deactivate()` — Called when switching to another tool
- `onMouseMove(event)` — Handle cursor movement for hover feedback
- `onMouseDown(event)` — Handle click events with modifier key detection
- `onMouseUp(event)` — Complete paint operation if needed
- `getCursor()` — Return cursor type (specified as `"pointer"`)

### Scene Manager Material API (Expected Calls)

- `getFaceAtPoint(x, y, z)` or `getFaceByRaycast(ray)` — Identify clicked face
- `getFaceMaterial(faceId)` — Retrieve material properties from a face
- `setFaceMaterial(faceId, material)` — Apply material to single face
- `setMultipleFaceMaterials(faceIds[], material)` — Batch update for bulk operations
- `getAllFacesWithMaterial(material)` — Query for shift+click bulk mode
- `getConnectedFaces(faceId, material)` — Query for ctrl+click flood-fill
- Must work within Scene Manager's command/transaction system for undo support

### Material Data Shape

Material objects must include:
```
{
  albedoColor: { r, g, b, a? },
  textureMap?: string | TextureReference,
  opacity: number,
  metalness?: number,
  roughness?: number,
  normalMap?: string | TextureReference,
  // Additional PBR properties as needed
}
```

### Snap Constraint API (Expected Calls)

- Query constraint system for face under cursor
- Receive face ID or geometry reference from constraint results
- Use constraint feedback for hover visualization

## Testing Requirements

- Must be tested by `test.e2e.tools` (Tool E2E Tests)
- Tests must validate:
  - Single-face material application
  - Material sampling with alt+click
  - Bulk same-material updates with shift+click
  - Connected face flood-fill with ctrl+click
  - Undo/redo correctness for all modes
  - Proper tool activation/deactivation
  - Keyboard shortcut `B` activates tool

## Contained Sub-Components

None — this is a leaf component. All functionality is contained within this tool implementation.

## Existing Code References

No existing code paths specified. This is a new implementation within the DraftDown architecture.

## Implementation Constraints

- **Language**: TypeScript
- **Complexity**: Moderate
- **Category**: Modify tool (alters existing geometry properties)
- **Icon**: `paint-bucket`
- Must integrate with Electron desktop environment
- Must maintain interactive performance during hover and click operations
- Must handle large scenes with many faces efficiently for bulk operations