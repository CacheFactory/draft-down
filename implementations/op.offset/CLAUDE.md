# Offset Edges Operation

## What This Is

The Offset Edges operation creates a parallel copy of a face's boundary edges, displaced inward or outward by a specified distance. This is a destructive modeling operation that modifies the original geometry while providing live preview capability. It handles complex geometric cases including convex/concave vertices, self-intersecting offsets, and faces with interior holes.

## Responsibility

Transform a selected face by offsetting its boundary edges to create new geometry. The operation must handle:

- **Simple offsets**: Moving boundary edges uniformly inward or outward
- **Vertex treatment**: Deciding between miter joints (straight corners) or arc segments at convex/concave vertices
- **Self-intersection resolution**: Detecting and clipping cases where offset edges cross themselves
- **Multi-loop faces**: Correctly offsetting faces with holes (outer boundary + inner holes)
- **New geometry creation**: Generating new edges and faces (inner face from inward offset, outer face from outward offset)

The implementation should use either straight skeleton or Minkowski offset algorithms (see https://en.wikipedia.org/wiki/Straight_skeleton).

## APIs Exposed

This operation must provide:

- **Execute method**: Accepts a face reference and offset parameters (distance, direction, vertex treatment mode), applies the offset transformation to the half-edge mesh
- **Preview method**: Computes and returns offset geometry without committing changes, for real-time visual feedback
- **Validation method**: Checks if a given face and offset parameters will produce valid geometry
- **Undo data generation**: Produces state snapshots that the Undo/Redo Manager can restore

Expected parameters:
- Face ID or reference from the half-edge mesh
- Offset distance (numeric value, sign indicates direction)
- Vertex handling mode (miter, arc, or auto)
- Optional: self-intersection handling strategy (clip, extend, fail)

Expected return:
- Success/failure status
- References to newly created edges and faces
- Geometry delta for undo/redo
- Validation errors if operation cannot proceed

## Data Read/Write

**Reads:**
- Face boundary topology from Half-Edge Mesh (edge loops, vertex positions, face normal)
- Vertex coordinates and edge vectors
- Face material/layer properties to propagate to new geometry

**Writes:**
- New vertex positions to Half-Edge Mesh
- New half-edge records (new boundary edges)
- New face records (offset face, potentially rim faces connecting original and offset boundaries)
- Modified topology relationships in Core Geometry Engine
- Geometry delta records to Undo/Redo Manager

**Data Location:**
- All mesh data resides in Half-Edge Mesh component (`mesh.halfedge`)
- Core geometric state managed by Core Geometry Engine (`engine.geometry`)
- Undo state stored via Undo/Redo Manager (`data.history`)

## Security Constraints

- **Data Classification**: Geometry data is user content — treated as private, confidential user work
- **Trust Boundary**: All computation is local; no network transmission of geometry data
- **Resource Limits**: Must handle maliciously large offset distances or degenerate geometry gracefully (fail safely rather than crash or hang)
- **Validation**: Input parameters must be validated before modifying mesh state
- **State Integrity**: Operation must either fully succeed or fully rollback — no partial mesh corruption

## Dependencies

**Depends On:**
- **Half-Edge Mesh** (`mesh.halfedge`): Provides mesh topology queries and mutation methods; must read edge loops, vertex positions, and write new mesh elements
- **Core Geometry Engine** (`engine.geometry`): Manages overall geometric state; notified of structural changes after offset completes

**Depended On By:**
- **Offset Tool** (`tool.offset`): UI tool that invokes this operation based on user input; provides face selection and offset distance from mouse interaction
- **Undo/Redo Manager** (`data.history`): Records operation execution for undo/redo; needs delta snapshots from this operation
- **Geometry Integration Tests** (`test.integration.geometry`): Validates correct behavior across various face shapes, offset distances, and edge cases

## Sub-Components to Implement

The following must be implemented within this codebase:

### 1. Offset Algorithm Core
- Straight skeleton or Minkowski offset computation
- Handle convex vertices (outward offset creates miters or arcs)
- Handle concave vertices (inward offset may create miters or arcs)
- Detect and handle self-intersections

### 2. Vertex Treatment Strategy
- **Miter mode**: Extend offset edges until they intersect (may create sharp points)
- **Arc mode**: Insert circular arc segments at vertices
- **Auto mode**: Choose strategy based on angle and offset distance

### 3. Multi-Loop Handler
- Process faces with holes correctly
- Offset outer boundary outward, inner holes inward (or vice versa)
- Maintain hole topology in resulting face

### 4. Intersection Resolver
- Detect where offset edges cross themselves
- Clip or extend geometry to resolve
- Determine which portions of offset are "inside" vs. "outside"

### 5. Geometry Builder
- Create new vertex records at offset positions
- Create new half-edges forming offset boundary
- Create new face bounded by offset edges
- Optionally create rim faces connecting original and offset boundaries

### 6. Preview Generator
- Non-destructive computation of offset result
- Return temporary geometry for rendering without mutating mesh
- Must be performant enough for interactive dragging

### 7. Validation Engine
- Check face is planar (or handle non-planar faces gracefully)
- Verify offset distance is reasonable
- Detect degenerate cases (offset larger than face, zero-area results)
- Return actionable error messages

### 8. Undo Integration
- Capture "before" state of affected mesh regions
- Generate delta representing change
- Provide rollback method that restores original state

## Existing Code References

- Implementation folder: `./` (this component)
- Related tool UI: `../tool.offset/`
- Mesh data structure: `../mesh.halfedge/`
- Geometry engine: `../engine.geometry/`
- Undo system: `../data.history/`

## Constraints

- **Performance**: Must provide interactive preview; target <100ms for typical faces (<50 edges)
- **Destructive**: Modifies original geometry in place (not additive)
- **Preview Required**: Must support real-time preview without committing changes
- **Complexity**: Marked as "complex" — expect sophisticated geometric algorithms
- **Language**: TypeScript implementation in Electron desktop environment
- **Robustness**: Must handle degenerate cases (zero-length edges, coincident vertices, near-zero offsets) without crashing
- **Precision**: Maintain geometric accuracy within floating-point tolerances; avoid accumulating error

## Quality Requirements

- Operation must be reversible via undo
- Must preserve mesh validity (no dangling edges, consistent half-edge pointers)
- Must maintain face normals and planarity where expected
- Edge cases (very small/large offsets, sharp angles, nearly-parallel edges) must either succeed or fail with clear error messages
- Self-intersection resolution must be deterministic and predictable