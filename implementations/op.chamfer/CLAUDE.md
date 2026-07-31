# Chamfer Operation

## What This Component Is

The Chamfer operation (`op.chamfer`) is a destructive 3D modeling operation that bevels selected edges by cutting a flat face at a specified distance from the edge. Unlike fillet operations that create curved surfaces, chamfer creates flat angled faces between adjacent surfaces. This operation supports both uniform chamfering (equal distance on both sides) and asymmetric chamfering (different distances from each adjacent face).

This is a **destructive operation** that permanently modifies the underlying geometry and supports **live preview** mode for real-time visual feedback before committing changes.

## Responsibilities

- Accept edge selection and chamfer distance parameters from the user
- Validate that selected edges are suitable for chamfering
- Calculate the geometry for flat chamfer faces based on distance parameters
- Modify the half-edge mesh structure to insert chamfer faces
- Update the core geometry engine with the modified topology
- Support both symmetric (single distance) and asymmetric (dual distance) chamfering
- Provide real-time preview of chamfer results before final application
- Emit geometry change events for undo/redo management
- Handle edge cases: adjacent edges, boundary edges, degenerate geometry
- Maintain topological validity after modification

## APIs Exposed

### Chamfer Execution
- **Input parameters**:
  - `edges`: Array of edge identifiers (half-edge IDs or edge references from `mesh.halfedge`)
  - `distance`: Primary chamfer distance (number, in model units)
  - `distance2`: Optional secondary distance for asymmetric chamfer (number)
  - `preview`: Boolean indicating preview mode vs. final application
- **Output**:
  - Success/failure status
  - Modified geometry reference or preview geometry
  - List of created faces (chamfer surfaces)
  - Error messages for invalid selections or geometric failures

### Validation API
- **Input**: Edge selection and distance parameters
- **Output**: Boolean validity + array of validation messages (e.g., "Edge too short for specified distance", "Chamfer would create degenerate geometry")

## APIs Consumed

### From Half-Edge Mesh (`mesh.halfedge`)
- Edge queries: Retrieve edge geometry, adjacent faces, vertex positions
- Edge topology: Get connected edges, face loops, vertex neighborhoods
- Mesh modification: Insert new vertices, create new faces, split edges, update connectivity
- Topology validation: Check mesh validity after modifications

### From Core Geometry Engine (`engine.geometry`)
- Solid geometry updates: Commit modified mesh to the geometry engine
- Boolean operations: Handle cases where chamfer requires geometry subtraction
- Manifold validation: Ensure resulting geometry maintains manifold properties
- Bounding volume updates: Recalculate bounding boxes after modification

## Data Read/Write

### Read
- **Half-edge mesh structure**: Edge connectivity, vertex positions, face normals from `mesh.halfedge`
- **Selection state**: Currently selected edges from user interaction layer
- **Material assignments**: Surface materials that must be preserved or assigned to new chamfer faces
- **Model units**: Current document unit settings for distance interpretation

### Write
- **Modified mesh geometry**: Updated vertex positions, new faces, revised edge connectivity to `mesh.halfedge`
- **Geometry engine state**: Updated solid representation to `engine.geometry`
- **History records**: Operation parameters and affected geometry to `data.history` for undo/redo
- **Selection state**: Updated selection after operation (typically clears or shifts to new geometry)

## Dependencies

### Required Components
- **Half-Edge Mesh** (`mesh.halfedge`): Provides the data structure for querying and modifying mesh topology
- **Core Geometry Engine** (`engine.geometry`): Manages the authoritative solid geometry representation
- **Undo/Redo Manager** (`data.history`): Records operation state for reversal and reapplication

### Integration Points
- Must integrate with edge selection system to receive valid edge references
- Must coordinate with 3D renderer for preview visualization
- Must respect geometry modification locks and read-only states

## Dependent Components

- **Undo/Redo Manager** (`data.history`): Depends on this component to provide serializable operation state
- **Geometry Integration Tests** (`test.integration.geometry`): Tests this component's correctness and edge case handling

## Security Constraints

- **Data Classification**: Model geometry is user-created content, typically confidential
- **Local Processing**: All computation must occur locally; no cloud transmission
- **Memory Safety**: Must handle large meshes without unbounded memory growth
- **Input Validation**: Must validate distance parameters to prevent numerical instability or crashes

## Contained Sub-Components

### Chamfer Geometry Calculator
- Computes new vertex positions for chamfer corners
- Calculates chamfer face plane equations from distance parameters
- Handles both symmetric and asymmetric distance modes
- Resolves geometric intersections when adjacent edges are chamfered

### Topology Modifier
- Inserts new vertices into the half-edge mesh
- Creates chamfer faces with proper winding order
- Updates edge connectivity around chamfered edges
- Maintains half-edge invariants during modification

### Preview Generator
- Produces temporary geometry for real-time preview
- Supports incremental preview updates as parameters change
- Does not commit changes to undo history during preview

### Edge Case Handler
- Detects and handles boundary edges (edges with only one adjacent face)
- Manages chamfers on adjacent/connected edges
- Prevents degenerate geometry (zero-area faces, coincident vertices)
- Validates minimum edge length vs. chamfer distance

## Constraints

- **Manifold Preservation**: Must maintain manifold topology after chamfering
- **Distance Limits**: Chamfer distance cannot exceed half the edge length or cause face inversion
- **Adjacent Edge Interaction**: When multiple adjacent edges are chamfered, must resolve corner geometry correctly
- **Numeric Precision**: Must handle floating-point precision issues near degenerate cases
- **Performance**: Preview updates must feel interactive (<100ms for typical selections)
- **Reversibility**: All modifications must be fully reversible via undo/redo

## Quality Requirements

- Must handle selections of 1 to 1000+ edges without performance degradation
- Must produce geometrically valid results (no self-intersections, no gaps)
- Preview mode must accurately represent final result
- Error messages must be specific and actionable for users
- Must integrate cleanly with existing undo/redo history workflow

## Component Metadata

- **Layer**: modeling
- **Kind**: operation
- **Implementation Language**: TypeScript
- **Complexity**: Moderate
- **Performance**: Not explicitly marked as performance-critical, but preview responsiveness is important