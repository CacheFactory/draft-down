# Intersect Faces Operation

## What This Component Is

The Intersect Faces operation (`op.intersect_faces`) computes geometric intersections between overlapping faces in a 3D model and creates new edges at every intersection line. This is DraftDown's Intersect Faces command, essential for organic modeling workflows where complex geometry is built by intersecting primitives.

This is a **destructive boolean operation** that permanently modifies the underlying geometry. It does not provide live preview.

## Responsibility

This operation must:

- Detect all face-face intersections within a specified scope
- Compute precise intersection curves where faces overlap
- Split faces along these intersection lines by inserting new edges
- Preserve geometric validity of the half-edge mesh throughout
- Support three distinct intersection modes with different scopes
- Integrate with undo/redo system to allow operation rollback

## Intersection Modes

The operation must support three modes that define the scope of intersection detection:

1. **Intersect with Model**: Compute intersections between selected geometry and all visible geometry in the entire model
2. **Intersect with Selection**: Compute intersections only within the currently selected geometry set
3. **Intersect with Context**: Compute intersections within the current editing context (active group or component instance)

The mode determines which faces are candidates for intersection testing.

## Input Requirements

The operation receives:

- A selection set of faces/edges/vertices identifying the primary geometry
- An intersection mode (model/selection/context)
- The current editing context (which group/component is active, if any)
- Visibility state of all geometry in the model

## Output Requirements

The operation must:

- Insert new edges into the half-edge mesh at all computed intersection curves
- Split faces that are divided by intersection edges
- Maintain half-edge topology invariants (manifold edges, face loops, twin relationships)
- Return a result indicating success or failure with error details
- Produce geometry changes compatible with the undo/redo system

## Geometric Constraints

- Intersection curves must be computed with numerical precision appropriate for architectural modeling (tolerance ~1e-6 model units)
- New edges must exactly coincide with the mathematical intersection of face planes
- Faces must be split precisely at intersection edges without gaps or overlaps
- Degenerate cases (coplanar faces, edge-on-face, vertex-on-face) must be handled correctly
- Small/thin geometry created by near-tangent intersections should be handled gracefully

## Data Read/Write

**Reads:**
- Half-edge mesh topology from `mesh.halfedge`
- Face geometry (vertices, normals, plane equations) from `engine.geometry`
- Selection state from the application's selection manager
- Visibility flags from the scene graph
- Current editing context from the component/group hierarchy

**Writes:**
- New edges, vertices, and face splits to `mesh.halfedge`
- Updated face topology to `engine.geometry`
- Operation record to `data.history` for undo/redo

## Dependencies

**Depends on:**

- **Half-Edge Mesh** (`mesh.halfedge`): Provides the topological data structure that this operation modifies. Must use the mesh's API for inserting edges, splitting faces, and querying topology.

- **Core Geometry Engine** (`engine.geometry`): Provides geometric primitives and intersection algorithms (plane-plane intersection, line-plane intersection, point-in-polygon tests). Must use the engine's geometric computation functions rather than implementing low-level math.

**Depended on by:**

- **Undo/Redo Manager** (`data.history`): Manages this operation as a reversible command. Must provide operation state that can be captured, undone, and redone.

- **Geometry Integration Tests** (`test.integration.geometry`): Validates intersection correctness across various geometric configurations. Must expose testable interfaces.

## Security & Trust Boundaries

- **Data Classification**: Model geometry is user-created content, classified as user data
- **Trust Boundary**: All computation is local; no external network calls
- **Input Validation**: Must validate that input geometry is well-formed and that the selection set contains valid mesh elements before processing
- **Resource Limits**: Must prevent infinite loops or excessive memory allocation on pathological geometry (e.g., thousands of micro-faces)

## Performance Characteristics

This operation is **performance-critical** (`x.perf.critical: true`). Intersection testing is O(n²) in the worst case when comparing all faces against all other faces.

**Performance requirements:**

- Must handle models with thousands of faces without blocking the UI for more than a few seconds
- Should use spatial acceleration structures (bounding boxes, spatial hashing, octrees) to reduce the number of face-pair tests
- Must report progress for long-running intersections to keep the UI responsive
- Should abort gracefully if the operation takes longer than a reasonable timeout

**Not required to:**
- Run asynchronously (though implementer may choose to do so)
- Provide incremental results during computation

## Integration Points

**With Undo/Redo Manager:**
- Must implement an operation record that captures the pre-intersection mesh state
- Must provide undo/redo methods that can restore/replay the operation
- Operation must be atomic (either fully succeeds or fully fails)

**With Half-Edge Mesh:**
- Must use mesh modification methods that preserve topological invariants
- Must not directly manipulate mesh data structures; use the mesh's public API
- Must handle edge cases like boundary edges, non-manifold geometry if the mesh supports them

**With Core Geometry Engine:**
- Must delegate all geometric computation (intersection tests, plane equations) to the engine
- Must use the engine's tolerance/epsilon values for numerical comparisons
- Must rely on the engine's robustness for degenerate cases

## Sub-Components

The implementation must include:

1. **Intersection Detector**: Identifies which face pairs actually intersect within the specified mode scope
2. **Curve Tracer**: Computes the precise intersection curve(s) for each intersecting face pair
3. **Mesh Splitter**: Inserts new edges and splits faces along intersection curves while maintaining topology
4. **Mode Resolver**: Determines the set of candidate faces based on the intersection mode and current context

These are logical sub-components; the implementer determines how to structure them in code.

## Existing Code References

No existing implementation. This is a new component.

Reference the half-edge mesh API in `../mesh.halfedge/` for topology modification methods and the geometry engine API in `../engine.geometry/` for intersection algorithms.

## What This Is Not

- This is not a general CSG (Constructive Solid Geometry) operation like union, difference, or intersection that produces a new solid
- This does not merge coplanar faces or clean up duplicate geometry
- This does not provide interactive preview or allow the user to adjust parameters before committing
- This does not automatically remove hidden or internal geometry after intersection