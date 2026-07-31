# Extrude (Push/Pull) Operation

**Component ID**: `op.extrude` (uuid: `Pkot4oID`)  
**Layer**: modeling  
**Type**: operation

## Purpose

The core push/pull extrusion operation — the heart of native modeling. Takes a planar face and a distance, creates new side faces connecting the original boundary to a translated copy. This is a performance-critical, destructive operation that must support live preview, boolean operations, and full undo/redo integration.

## Responsibilities

- Execute extrusion of planar faces along a direction vector
- Create geometry: side faces connecting boundary to translated cap, new vertices, new edges
- Handle two extrusion modes:
  - **Default mode**: Original face becomes part of the solid
  - **Ctrl mode** (`createNewStartFace: true`): Leave original face behind as a new starting surface
- Detect when extrusion would intersect existing geometry and automatically perform boolean subtraction
- Generate deltas for undo/redo system with minimal diff data
- Merge coplanar faces after extrusion to maintain clean topology
- Provide non-destructive preview capability for interactive tool feedback
- Maintain half-edge mesh validity throughout operation

## API Contract

### Input Interface

```typescript
interface ExtrudeParams {
  face: Face;                    // The face to extrude (from Half-Edge Mesh)
  distance: number;              // Positive = along normal, negative = against
  direction?: Vector3;           // Optional: override face normal direction
  createNewStartFace: boolean;   // Ctrl mode: leave original face behind
  autoBooleanCut: boolean;       // Detect and perform boolean subtraction
}
```

### Output Interface

```typescript
interface ExtrudeResult {
  newFaces: Face[];              // All newly created faces (sides + cap)
  capFace: Face;                 // The translated copy of the original face
  sideFaces: Face[];             // Faces connecting original boundary to cap
  newEdges: Edge[];              // All newly created edges
  newVertices: Vertex[];         // All newly created vertices
  removedFaces: Face[];          // Faces consumed by boolean cut
  wasBooleanCut: boolean;        // Whether boolean subtraction occurred
}
```

### Undo/Redo Delta

```typescript
interface ExtrudeDelta {
  addedVertices: { id: string; position: Vector3 }[];
  addedEdges: { id: string; v1: string; v2: string }[];
  addedFaces: { id: string; loop: string[] }[];
  removedFaces: { id: string; loop: string[]; material: string }[];
  movedVertices: { id: string; from: Vector3; to: Vector3 }[];
}
```

### Core Methods

- `execute(mesh: HalfEdgeMesh, params: ExtrudeParams): ExtrudeResult` — Destructively modify mesh
- `preview(mesh: HalfEdgeMesh, params: ExtrudeParams): ExtrudeResult` — Non-destructive preview (returns result without modifying mesh)
- `undo(mesh: HalfEdgeMesh, delta: ExtrudeDelta): void` — Reverse operation using delta
- `redo(mesh: HalfEdgeMesh, delta: ExtrudeDelta): void` — Reapply operation using delta

## Data Dependencies

### Reads From
- **Half-Edge Mesh** (`mesh.halfedge`): Face topology, boundary edges, vertex positions, half-edge connectivity
- **Face data**: Outer loop, normal vector, material properties
- **Vertex data**: Position coordinates
- **Edge data**: Half-edge pairs, adjacent faces

### Writes To
- **Half-Edge Mesh** (`mesh.halfedge`): New vertices, edges, faces; modified connectivity
- **Undo/Redo Manager** (`data.history`): ExtrudeDelta records for each operation

### Geometric Types
All geometric types (Face, Edge, Vertex, HalfEdge, Vector3) are defined by the Half-Edge Mesh component.

## Algorithm Requirements

1. **Boundary Extraction**: Get ordered boundary edges from face's outer loop
2. **Vertex Translation**: For each boundary vertex, create new vertex at `position + direction * distance`
3. **Side Face Creation**: For each boundary edge (v1→v2), create quad side face (v1, v2, v2_new, v1_new)
4. **Cap Face Creation**: Create cap face from all new vertices in same winding order as original
5. **Half-Edge Updates**: Link side face half-edges to cap and (optionally) original face
6. **Mode Handling**:
   - If `createNewStartFace: false`: Original face integrated into solid
   - If `createNewStartFace: true`: Keep original face as separate surface
7. **Coplanar Merging**: Run merge operation on adjacent coplanar faces
8. **Boolean Detection**: If `autoBooleanCut: true`, detect intersection with existing geometry
9. **Boolean Execution**: If intersection detected, delegate to Manifold Solid Engine for boolean subtraction
10. **Delta Generation**: Create minimal ExtrudeDelta for undo system

## Boolean Operation Requirements

When `autoBooleanCut: true`:
- Detect if extruded volume would intersect existing solid geometry
- If intersection detected, invoke Manifold Solid Engine (`solid.manifold`) to perform boolean subtraction
- Include removed faces in `removedFaces` result field
- Set `wasBooleanCut: true` in result
- Ensure delta includes data to reverse boolean cut on undo

## Dependencies

### Required Components

- **Half-Edge Mesh** (`mesh.halfedge`): Provides mesh data structure, Face/Edge/Vertex types, connectivity operations
- **Core Geometry Engine** (`engine.geometry`): Provides geometric utilities, vector math, plane operations
- **Manifold Solid Engine** (`solid.manifold`): Performs boolean operations when auto-cut is enabled
- **Undo/Redo Manager** (`data.history`): Consumes ExtrudeDelta for operation history

### Consumed By

- **Push/Pull Tool** (`tool.pushpull`): Invokes this operation during interactive modeling
- **Plugin System** (`plugin.system`): Plugins may extend or wrap extrude behavior
- **Geometry Integration Tests** (`test.integration.geometry`): Validates correctness across scenarios
- **Geometry Performance Tests** (`test.perf.geometry`): Benchmarks execution time and memory usage

## Performance Constraints

This is a **performance-critical** component marked with `x.perf.critical: true`. Requirements:

- Must handle complex faces with 100+ boundary edges interactively
- Preview mode must run at 60fps for real-time tool feedback
- Memory allocation must be minimal (reuse buffers where possible)
- Large extrusions (1000+ new faces) must complete in <100ms
- Undo delta must be compact (no full mesh copies)

## Security & Data Classification

- **Data Classification**: User geometry data (sensitive if models are proprietary)
- **Trust Boundary**: All operations are local; no network access
- **Validation**: Must validate face planarity, non-degenerate distance values, mesh consistency
- **Error Handling**: Must gracefully handle invalid input (non-planar faces, zero-distance, disconnected boundaries)

## Extensibility

The Plugin System may:
- Wrap `execute` to modify parameters or results
- Add custom extrusion strategies (e.g., tapered extrusion, path extrusion)
- Hook into boolean detection logic

Plugins must not:
- Break half-edge mesh validity
- Skip undo delta generation

## Sub-Components

Internal private methods required within this implementation:

- `createSideFaces(boundary: Edge[], normal: Vector3, distance: number): Face[]` — Generate quad side faces
- `cloneAndTranslateFace(face: Face, offset: Vector3): Face` — Create cap face geometry
- `mergeCoplanarFaces(mesh: HalfEdgeMesh, newFaces: Face[]): void` — Clean up coplanar adjacencies
- `detectBooleanCutNeeded(face: Face, direction: Vector3, distance: number, mesh: HalfEdgeMesh): boolean` — Check for intersections
- `performBooleanCut(face: Face, distance: number, solid: SolidEngine): ExtrudeResult` — Delegate to Manifold

## Implementation Language

**TypeScript** with strict typing enabled.

## References

