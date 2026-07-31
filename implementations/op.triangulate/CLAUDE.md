# Triangulate Operation

## What This Component Is

The Triangulate operation (`op.triangulate`) converts all selected N-gon faces in a half-edge mesh into triangles. This is a destructive modeling operation that permanently modifies mesh topology by splitting polygonal faces with 4 or more vertices into sets of triangular faces. It must handle complex face geometry including non-convex faces and faces with holes.

## Responsibilities

- Accept a selection of faces from the half-edge mesh
- Decompose each N-gon face (n ≥ 4) into a set of triangular faces
- Preserve mesh connectivity and manifold properties during triangulation
- Maintain face orientation and normal direction
- Preserve vertex positions, attributes, and associated data
- Support both ear-clipping and constrained Delaunay triangulation algorithms
- Provide deterministic, reproducible results for the same input geometry
- Handle edge cases: colinear vertices, degenerate faces, self-intersecting boundaries
- Integrate with the undo/redo system as a reversible operation

## APIs and Interfaces

### Exposed

Must provide an operation interface callable by the modeling layer:

**Operation Execution**
- Accept input: set of face IDs to triangulate
- Accept options: triangulation algorithm preference (ear-clipping vs. Delaunay)
- Return: operation result containing modified face IDs, new face IDs, edge IDs, success status
- Throw: errors for invalid input (non-existent faces, already triangular faces if filtered)

**Undo/Redo Integration**
- Generate reversible operation data for history manager
- Provide inverse operation data to restore original N-gon topology
- Must be callable multiple times on the same mesh state (idempotent after first application)

### Consumed

**Half-Edge Mesh (`mesh.halfedge`)**
- Read face boundary loops (ordered vertex sequences)
- Read vertex positions (3D coordinates)
- Read edge connectivity
- Write new face records
- Write new half-edge records
- Delete or mark original N-gon faces as replaced
- Query face vertex count
- Access face holes if present

**Core Geometry Engine (`engine.geometry`)**
- May delegate geometric computations (angle calculations, point-in-triangle tests)
- May use provided triangulation algorithms if available

**Undo/Redo Manager (`data.history`)**
- Register operation for history tracking
- Provide operation delta (before/after state)

## Data Read/Write

### Read
- Face IDs from current selection
- Vertex positions (x, y, z coordinates)
- Face boundary topology (half-edge loops)
- Face hole topology if present
- Vertex attributes (UVs, normals, colors) associated with face corners
- Current mesh state from half-edge data structure

### Write
- New triangular face records in half-edge mesh
- New half-edge records connecting triangle vertices
- Updated face adjacency relationships
- Preserved vertex attribute data mapped to new triangular faces
- Operation metadata for undo/redo (original face IDs, new face IDs, vertex ordering)

### Storage Location
- All data read/written through the half-edge mesh data structure in memory
- No persistent storage at operation level
- History data stored by `data.history` manager

## Security and Data Constraints

### Data Classification
- **Geometric data**: User-created 3D models — treated as local user content
- **Operation parameters**: Configuration choices — non-sensitive

### Trust Boundaries
- Input geometry comes from trusted local mesh structure
- No external data sources
- No network communication
- Operates entirely within the Electron process sandbox

### Validation Requirements
- Validate all face IDs exist in mesh before processing
- Verify face vertex counts (must be ≥ 3, operation applies to n ≥ 4)
- Detect and handle degenerate geometry (zero-area faces, duplicate vertices)
- Ensure triangulation produces valid manifold topology
- Verify no self-intersecting faces are created
- Confirm all new triangles have consistent winding order

## Dependencies

### Direct Dependencies

**Half-Edge Mesh (`mesh.halfedge`)**
- Required for all mesh topology access and modification
- Provides the data structure this operation mutates

**Core Geometry Engine (`engine.geometry`)**
- May provide geometric utilities (distance, angle, orientation tests)
- May provide triangulation algorithm implementations

**Undo/Redo Manager (`data.history`)**
- Required for operation registration and history integration

### Depended Upon By

**Geometry Integration Tests (`test.integration.geometry`)**
- Tests verify correct triangulation behavior across various face types
- Tests validate manifold preservation
- Tests confirm undo/redo correctness

**Export operations** (implied by description: "Required before STL export")
- STL and other triangle-only formats depend on this operation being available
- Rendering operations that require triangulated meshes

## Algorithmic Requirements

### Triangulation Methods

**Ear-Clipping Algorithm**
- Must support simple polygons (no holes)
- Iteratively clip "ear" triangles (vertices where diagonal lies inside polygon)
- Suitable for convex and moderately non-convex faces

**Constrained Delaunay Triangulation**
- Must handle faces with holes
- Must respect boundary edges as constraints
- Produces better triangle quality (avoids sliver triangles)
- More complex but handles difficult cases

### Geometry Handling
- Preserve planarity for planar faces
- Handle non-planar faces by projecting to best-fit plane or using 3D triangulation
- Maintain original vertex positions exactly (no vertex insertion)
- Respect existing edges that must remain as boundaries

### Face with Holes
- Outer boundary defines face perimeter
- Inner boundaries define holes that must not contain triangle interiors
- All boundaries must be respected as constraints in triangulation

## Constraints

### Destructive Operation
- Marked as `destructive: true` — original N-gon topology is lost
- Must be paired with undo capability to allow reversal
- User must confirm or be warned before execution (UI responsibility)

### No Preview
- Marked as `preview: false` — operation commits immediately
- Cannot show live preview before confirmation
- Must complete in single atomic operation

### Performance
- Complexity: O(n²) for ear-clipping, O(n log n) for Delaunay per face
- Must handle faces with dozens to hundreds of vertices efficiently
- Should batch process multiple faces in single operation call
- Consider spatial indexing for Delaunay implementations

### Topology Preservation
- Mesh must remain manifold after operation
- Edge connectivity must remain consistent
- No T-junctions or non-manifold edges introduced
- Face count increases: one N-gon becomes (N-2) triangles

## Component Structure

No sub-components are defined. This is a single operation implementation responsible for:
- Algorithm selection logic
- Triangulation computation
- Mesh modification application
- History integration

Implementation should be self-contained within the `op.triangulate` folder.

## Testing Requirements

Must be tested by `test.integration.geometry`:
- Triangulate square face (4 vertices) → 2 triangles
- Triangulate pentagon, hexagon, higher N-gons
- Triangulate non-convex faces
- Triangulate faces with holes
- Triangulate coplanar vs. non-planar faces
- Verify manifold preservation
- Verify vertex attribute preservation (UVs, normals)
- Verify undo/redo correctness (restore original N-gon)
- Verify operation fails gracefully on invalid input
- Performance benchmarks for faces with 10, 100, 1000 vertices