# Subdivide Operation

**Component ID:** `op.subdivide`  
**Layer:** modeling  
**Type:** operation

## Purpose

This component subdivides selected faces in a 3D mesh by splitting edges and creating new vertices. It must support two subdivision strategies:

1. **Catmull-Clark subdivision** — smooth subdivision for organic modeling, creating curved surfaces
2. **Simple midpoint subdivision** — adds geometric detail by splitting faces at edge midpoints

This is a destructive operation that modifies geometry in place and supports live preview before committing changes.

## Responsibilities

- Accept a selection of faces from a half-edge mesh
- Apply the chosen subdivision algorithm (Catmull-Clark or simple)
- Create new vertices, edges, and faces according to subdivision rules
- Maintain mesh topology and connectivity through the half-edge data structure
- Preserve or interpolate vertex attributes (normals, UVs, colors) where applicable
- Provide preview capability before finalizing the operation
- Integrate with undo/redo system for operation history
- Validate that subdivision maintains manifold geometry

## API Contract

### Input

- **Target mesh**: reference to half-edge mesh structure (`mesh.halfedge`)
- **Face selection**: set of face IDs to subdivide
- **Subdivision type**: enum or string (`"catmull-clark"` | `"simple"`)
- **Iterations**: number of subdivision passes (typically 1-3)
- **Preview mode**: boolean flag for non-destructive preview

### Output

- **Modified mesh**: updated half-edge mesh with subdivided geometry
- **Operation result**: success/failure status, new element counts
- **Undo data**: serializable state for reverting the operation

### Methods/Functions

Must expose functionality for:

- Executing subdivision on selected faces
- Previewing subdivision without committing changes
- Canceling preview and restoring original state
- Providing operation metadata for undo/redo integration

## Data Dependencies

### Reads

- **Half-edge mesh structure** (`mesh.halfedge`): vertices, edges, faces, connectivity
- **Selection state**: which faces are selected for subdivision
- **Vertex attributes**: positions, normals, UV coordinates, custom attributes

### Writes

- **Mesh topology** via `mesh.halfedge`: new vertices, edges, faces
- **Vertex positions**: computed subdivision positions
- **Vertex attributes**: interpolated or computed normals, UVs
- **Operation history** via `data.history`: serializable undo/redo state

### Modifies

- **Core Geometry Engine** (`engine.geometry`): triggers geometry updates and re-validation

## Dependencies

### Required Components

- **Half-Edge Mesh** (`mesh.halfedge` at `../mesh.halfedge/`): provides mesh data structure and topology operations
- **Core Geometry Engine** (`engine.geometry` at `../engine.geometry/`): coordinates geometry updates and validation
- **Undo/Redo Manager** (`data.history` at `../data.history/`): records operation state for history management

### Dependents

- **Geometry Integration Tests** (`test.integration.geometry` at `../test.integration.geometry/`): validates subdivision correctness

## Subdivision Requirements

### Catmull-Clark Rules

- For each face, create a face point at the centroid
- For each edge, create an edge point as average of edge midpoint and adjacent face points
- For each original vertex, compute new position based on adjacent edge points and face points
- Connect points to form quadrilateral faces
- Must handle boundary edges appropriately (no adjacent face on one side)
- Should preserve sharp creases if edge/vertex sharpness metadata exists

### Simple Subdivision Rules

- Split each edge at its midpoint
- Create a center point for each face
- Connect edge midpoints to face center and to adjacent edge midpoints
- Simpler topology, no smoothing applied to vertex positions

### Attribute Interpolation

- Normals: recompute after subdivision or interpolate and normalize
- UV coordinates: interpolate linearly based on subdivision weights
- Vertex colors: interpolate using subdivision weights
- Custom attributes: apply same interpolation scheme as positions

## Constraints

### Topology

- Must maintain manifold mesh after subdivision
- Must preserve mesh connectivity and half-edge invariants
- Cannot subdivide if selection includes non-manifold edges
- Must handle boundary loops correctly

### Performance

- Complexity is moderate — subdivision is computationally intensive
- Should handle meshes with thousands of faces efficiently
- Preview mode must be responsive for interactive feedback
- Consider spatial indexing or caching for repeated preview updates

### Data Classification

- **Internal**: all mesh data is local, no external data flows
- **Trust boundary**: input validation required for face selection and parameters
- **No encryption required**: local desktop application, no network transmission

## Security & Validation

- Validate face selection references exist in mesh
- Validate subdivision iteration count is within reasonable bounds (e.g., 1-5)
- Check for degenerate geometry that could cause infinite loops or crashes
- Ensure subdivision doesn't create vertices at identical positions (zero-length edges)
- Verify half-edge mesh remains valid after operation

## Integration Points

### With Undo/Redo Manager

- Capture mesh state before subdivision for undo capability
- Provide serializable operation descriptor (type, parameters, selection)
- Support redo by re-applying operation with stored parameters
- Optimize state capture — may store delta instead of full mesh copy

### With Core Geometry Engine

- Notify engine of topology changes after subdivision
- Trigger bounding box recalculation
- Invalidate rendering caches that depend on face/vertex counts
- Request re-validation of solid geometry if applicable

### With Half-Edge Mesh

- Use mesh API for creating vertices, edges, faces
- Maintain half-edge connectivity during topology modifications
- Update vertex positions through mesh interface
- Query and update vertex attributes through mesh accessors

## Edge Cases

- **Empty selection**: no-op, return success
- **Single face**: subdivide isolated face, handle boundary edges
- **Non-planar quads**: Catmull-Clark handles naturally, simple subdivision may need triangulation
- **Boundary edges**: no face point on open side, adjust edge point calculation
- **Multiple iterations**: apply subdivision recursively, preserve selection semantics
- **Preview cancellation**: must cleanly restore original mesh state
- **Very small faces**: avoid creating degenerate geometry, may need minimum edge length threshold

## Implementation Guidance

The implementation should:

- Use the half-edge mesh API for all topology modifications
- Compute new vertex positions before creating new topology to avoid invalidating references
- Build subdivision in phases: compute points, create topology, update positions
- Consider using lookup tables or maps to track old-to-new element correspondence
- For Catmull-Clark, implement standard subdivision surface formulas from literature
- For simple subdivision, use straightforward edge midpoint and face centroid calculations
- Ensure preview mode creates a temporary mesh copy or stores original state
- Profile subdivision performance on typical mesh sizes (1K-10K faces)

---

**Reference Paths:**
- Half-Edge Mesh: `../mesh.halfedge/`
- Undo/Redo Manager: `../data.history/`
- Core Geometry Engine: `../engine.geometry/`
- Integration Tests: `../test.integration.geometry/`