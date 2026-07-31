# Smooth Modifier

## Identity
- **Component ID**: `mod.smooth`
- **UUID**: `1m0uhGig`
- **Type**: Modifier
- **Layer**: Modeling

## Purpose

The Smooth Modifier softens and smooths 3D geometry through two mechanisms:

1. **Smooth Normals**: Soften visual appearance by blending normals across edges below an angle threshold (similar to DraftDown's Soften Edges feature). Edges above the threshold remain hard/sharp.

2. **Geometric Subdivision**: Apply Catmull-Clark subdivision to actually modify mesh geometry, creating smoother surfaces with increased face density.

This modifier must be stackable, allowing combination with other modifiers in a modifier stack.

## Functional Requirements

### Input Parameters

The modifier must accept:
- **Angle threshold** (degrees): Edges with adjacent face angles below this value get smoothed normals. Typical range: 0-180°, common default: 30-45°.
- **Subdivision level** (integer): Number of Catmull-Clark subdivision iterations to apply. Range: 0-4, where 0 means no geometric subdivision.
- **Smooth normals only** (boolean): If true, only apply normal smoothing without geometric subdivision.
- **Selection scope**: Apply to entire mesh or selected faces/edges/vertices only.

### Operations

The modifier must:
- Calculate face normals for all faces in the target mesh
- Identify edges where adjacent face angles fall below the threshold
- For qualifying edges, compute averaged/smoothed vertex normals
- When subdivision level > 0, apply Catmull-Clark subdivision algorithm to generate new geometry
- Preserve UV coordinates and material assignments where possible
- Maintain mesh topology validity (manifold, no holes, correct winding)

### Edge Smoothing Logic

- Calculate angle between adjacent face normals for each edge
- Edges below threshold: vertices share smoothed normals (averaged from connected faces)
- Edges above threshold: vertices have distinct normals per face (hard edge)
- Handle boundary edges appropriately (no adjacent face on one side)

### Catmull-Clark Subdivision

When subdivision is requested:
- Replace each face with new faces according to Catmull-Clark rules
- Generate face points (centroid of each face)
- Generate edge points (average of edge midpoint and adjacent face points)
- Update vertex points (weighted average of original vertex, edge midpoints, and face centroids)
- Increase mesh resolution by factor of ~4 per subdivision level

## Data Dependencies

### Read Access

- **Half-Edge Mesh** (`mesh.halfedge`): Access to mesh topology, vertices, edges, faces, and their connectivity
- Face normals and vertex normals
- Material/surface properties per face
- UV coordinates if present
- Selection state (which elements are selected)

### Write Access

- **Core Geometry Engine** (`engine.geometry`): Submit modified mesh data back to geometry engine
- **Half-Edge Mesh**: Update vertex positions, normals, face definitions
- Create new mesh elements if subdivision is applied
- Update normal vectors for smooth shading

### Undo/Redo Integration

- **Undo/Redo Manager** (`data.history`): Register modifier operations as undoable actions
- Must capture pre-modification mesh state
- Support full rollback of both normal smoothing and subdivision operations
- Store modifier parameters with history entry for reproducibility

## API Surface

### Modifier Interface

Must implement standard modifier interface expected by the modifier stack system:

```
apply(mesh, parameters) -> modifiedMesh
- Applies smoothing to the input mesh based on parameters
- Returns new mesh instance or modifies in place per system convention

canApply(mesh) -> boolean
- Validates whether this modifier can be applied to the given mesh
- Checks for minimum requirements (must be manifold, must have faces, etc.)

getParameters() -> parameterSchema
- Returns definition of configurable parameters with types, ranges, defaults

preview(mesh, parameters) -> previewData
- Generates preview/visualization of modifier effects without committing changes
- Used for real-time feedback in UI

serialize() -> modifierState
- Exports modifier configuration to JSON for saving/loading

deserialize(modifierState) -> void
- Restores modifier configuration from saved state
```

### Events/Callbacks

If the system uses event-driven architecture:
- Emit `modifier.applied` event with mesh ID and modifier details
- Emit `modifier.preview` for real-time preview updates
- Listen for mesh updates that might invalidate cached calculations

## Integration Points

### Upstream Dependencies

- **Half-Edge Mesh** (`mesh.halfedge`): Provides mesh data structure and topology queries
  - Query adjacent faces for an edge
  - Query connected edges/faces for a vertex
  - Iterate through all edges, faces, vertices
  - Access vertex positions and face definitions

- **Core Geometry Engine** (`engine.geometry`): Provides geometry manipulation capabilities
  - Mesh validation and repair
  - Normal computation utilities
  - Possibly subdivision utilities if engine provides them

### Downstream Consumers

- Modifier stack system (applies this modifier in sequence with others)
- Rendering pipeline (uses smoothed normals for shading)
- Export system (includes modified geometry in output files)

## Security & Data Classification

- **Data Classification**: Internal modeling data — user-created 3D geometry
- **Trust Boundary**: Operates entirely within local desktop application process
- **Validation**: Must validate input meshes to prevent crashes on invalid geometry
  - Check for manifold topology
  - Verify no NaN/Infinity in vertex positions
  - Confirm face winding consistency
- **Resource Limits**: Subdivision can exponentially increase geometry size
  - Enforce maximum subdivision level (recommended: 4)
  - Warn user if resulting mesh would exceed memory/performance thresholds
  - Typical limit: ~1M faces on consumer hardware

## Performance Constraints

- **Interactive Performance**: Angle-based normal smoothing should complete in <100ms for meshes up to 10K faces
- **Subdivision**: One subdivision level should complete in <500ms for 5K face mesh
- **Preview Mode**: Must support real-time preview at reduced quality (e.g., skip subdivision, only show edge smoothing)
- **Caching**: Cache computed normals and edge angles when parameters don't change
- **Cancellation**: Support cancellation for long-running subdivision operations

## Implementation Constraints

- **Language**: TypeScript
- **Complexity**: Moderate
- **Stackable**: Must support inclusion in modifier stacks
- **Non-Destructive**: Should preserve original mesh data for undo or modifier reordering
- **Deterministic**: Same inputs must produce identical outputs for undo/redo consistency

## Quality Requirements

- **Topology Preservation**: Modified mesh must remain manifold (if input was manifold)
- **Normal Continuity**: Smoothed normals must be continuous across smoothed edges
- **Visual Quality**: No visible cracks or artifacts at smooth/hard edge boundaries
- **Numerical Stability**: Handle degenerate cases (zero-length edges, coplanar faces)
- **Material Preservation**: Maintain material assignments on faces after subdivision

## Sub-Components

### Edge Angle Calculator
- Computes angle between normals of faces adjacent to each edge
- Handles boundary edges (only one adjacent face)
- Returns angle in degrees or marks edge as boundary

### Normal Averager
- For vertices on smoothed edges, computes weighted average of connected face normals
- Handles mixed smooth/hard edges meeting at a vertex
- Normalizes resulting vectors

### Catmull-Clark Subdivider
- Implements full Catmull-Clark subdivision algorithm
- Generates new vertices, edges, and faces
- Preserves crease edges (hard edges remain hard after subdivision)
- Handles boundary edges according to Catmull-Clark boundary rules

### Mesh Validator
- Checks mesh manifoldness before and after operations
- Verifies no duplicate vertices or faces
- Confirms consistent face winding

## Edge Cases

- **Planar meshes**: All edges may fall below threshold — entire mesh becomes smooth
- **Very sharp angles**: Edges approaching 180° should remain hard
- **Boundary loops**: Open meshes have boundary edges with only one face
- **Creases**: Some edges should remain hard even after subdivision (support crease tagging)
- **Mixed selections**: Partially selected meshes — handle boundary between selected/unselected
- **Zero-area faces**: Degenerate geometry should be handled gracefully or rejected
- **Non-manifold edges**: Edges with >2 adjacent faces — reject or handle specially

## Related Components

- **Half-Edge Mesh** (`mesh.halfedge`) at `../mesh.halfedge/`: Mesh data structure
- **Undo/Redo Manager** (`data.history`) at `../data.history/`: Operation history
- **Core Geometry Engine** (`engine.geometry`) at `../engine.geometry/`: Geometry operations