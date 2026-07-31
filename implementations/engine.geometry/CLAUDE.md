# Core Geometry Engine

## Component Identity

- **ID**: `engine.geometry`
- **UUID**: `9eEZxKvS`
- **Kind**: geometry_engine
- **Layer**: geometry

## Responsibility

This component is the **primary geometric kernel** for DraftDown. It implements a B-Rep (Boundary Representation) data structure using a half-edge mesh topology, similar to DraftDown's internal model. It is responsible for maintaining topologically valid 3D geometry, performing spatial queries, and exposing APIs that modeling operations use to create, modify, and analyze geometry.

This is a **performance-critical** component. All modeling operations — extrude, sweep, boolean, fillet, chamfer, subdivide, triangulate, offset, intersect, and modifiers (array, mirror, smooth) — depend on this engine for geometry manipulation.

## Precision and Representation

- **Precision**: float64 (double-precision floating point)
- **Representation**: B-Rep (Boundary Representation) via half-edge mesh
- **Kernel**: Custom (implemented in TypeScript, may delegate certain operations to Manifold WASM or OpenCascade WASM)

## Data Model

The geometry engine must represent and manage the following entities:

### Core Entities

- **Vertex**: A point in 3D space with float64 precision
  - Fields: `id` (UUID), `position` (Vector3), `edges` (outgoing HalfEdge list), `selected`, `hidden`
  
- **HalfEdge**: A directed edge from one vertex to another, part of the half-edge data structure
  - Fields: `id`, `origin` (Vertex), `twin` (HalfEdge), `next` (HalfEdge), `prev` (HalfEdge), `face` (Face or null), `edge` (parent Edge)
  
- **Edge**: The full edge, represented by two opposing half-edges
  - Fields: `id`, `halfEdge` (one of the two HalfEdges), `soft`, `smooth`, `selected`, `hidden`, `materialIndex`
  
- **Face**: A planar polygon bounded by a loop of half-edges, with optional holes
  - Fields: `id`, `outerLoop` (HalfEdge), `innerLoops` (HalfEdge array), `normal` (Vector3, cached), `plane` (Plane), `materialIndex`, `backMaterialIndex`, `selected`, `hidden`, `area` (cached, invalidated on change)
  
- **Loop**: A closed or open sequence of half-edges
  - Must provide iterators for vertices, edges, half-edges
  - Must compute length (edge count) and test if closed

### ID Stability

All entity IDs must be **stable across undo/redo** and never reused. IDs are UUIDs.

## APIs Exposed

The engine must expose a TypeScript interface `IGeometryEngine` with the following operations:

### Vertex Operations

- `createVertex(position: Vector3): Vertex`
- `moveVertex(vertex: Vertex, newPosition: Vector3): void`
- `mergeVertices(v1: Vertex, v2: Vertex, tolerance?: number): Vertex`
- `deleteVertex(vertex: Vertex): void`

### Edge Operations

- `createEdge(v1: Vertex, v2: Vertex): Edge`
- `splitEdge(edge: Edge, point: Vector3): { edge1: Edge; edge2: Edge; vertex: Vertex }`
- `collapseEdge(edge: Edge): Vertex`
- `deleteEdge(edge: Edge): void`

### Face Operations

- `createFace(vertices: Vertex[]): Face` — Creates edges and a face from an ordered vertex loop
- `createFaceFromEdges(edges: Edge[]): Face | null` — Detects a closed coplanar loop and creates a face
- `deleteFace(face: Face): void`
- `splitFace(face: Face, v1: Vertex, v2: Vertex): { face1: Face; face2: Face; edge: Edge }`
- `triangulateFace(face: Face): Face[]`

### Topology Queries

- `getAdjacentFaces(face: Face): Face[]`
- `getVertexFaces(vertex: Vertex): Face[]`
- `getEdgeFaces(edge: Edge): [Face | null, Face | null]`
- `getConnectedComponent(entity: Vertex | Edge | Face): Set<Face>`
- `isManifold(faces: Face[]): boolean`
- `isWatertight(faces: Face[]): boolean`

### Spatial Queries

- `raycast(origin: Vector3, direction: Vector3): RaycastHit[]`
- `pointInFace(point: Vector3, face: Face): boolean`
- `closestPointOnEdge(point: Vector3, edge: Edge): { point: Vector3; t: number }`
- `faceFaceIntersection(f1: Face, f2: Face): Vector3[] | null`
- `edgeFaceIntersection(edge: Edge, face: Face): Vector3 | null`

### Validation and Repair

- `validate(): ValidationResult`
- `healTJunctions(tolerance: number): number` — Returns count of healed T-junctions
- `computeFaceNormal(face: Face): Vector3`

### Return Types

- **RaycastHit**: `{ entity: Vertex | Edge | Face; point: Vector3; distance: number; normal: Vector3; faceIndex?: number }`
- **ValidationResult**: `{ valid: boolean; errors: ValidationError[] }`
- **ValidationError**: `{ type: 'non-planar-face' | 'degenerate-edge' | 'duplicate-vertex' | 'broken-topology' | 'inconsistent-normal'; entities: GeometryId[]; message: string }`

## Data Storage

This component does **not** persist geometry directly to disk. Persistence is handled by external serialization layers that consume and reconstruct the B-Rep structure via the exposed APIs.

Internal data:
- Vertex positions stored in `Float64Array` for precision
- Half-edge topology stored in linked structures in memory
- Face normals and areas cached with dirty flags
- Octree for spatial indexing, rebuilt lazily on geometry change
- Edge hash map for fast topology queries

## Performance Requirements

This component is **performance-critical**. The following targets must be met:

- **Face creation**: < 1ms
- **Edge split**: < 0.5ms
- **Face-face intersection**: < 5ms per pair
- **Topology queries**: O(1) via half-edge traversal
- **Spatial queries**: Use octree (rebuilt lazily on geometry change)
- **Lazy computation**: Face normals, areas, and octree are computed lazily and cached with dirty flags
- **Incremental validation**: Avoid full revalidation on every change

### Optimizations

- **Spatial indexing**: Octree for ray intersection and spatial queries
- **Edge hash map**: For fast topology queries
- **Lazy face triangulation**: Triangulate only when needed for rendering or export
- **Incremental validation**: Track dirty regions and validate incrementally

## Dependencies

This component **uses**:

- **Manifold WASM Module** (`native.manifold`) — For robust boolean operations and mesh repair
- **OpenCascade WASM Module** (`native.opencascade`) — May delegate certain advanced solid modeling operations (optional, fallback)

This component **computes**:

- **Half-Edge Mesh** (`mesh.halfedge`) — The underlying data structure
- **Polyline Curve** (`curve.polyline`) — Polyline representation for edges
- **Arc Curve** (`curve.arc`) — Arc representation for curved edges

## Consumers

This component is **modified by** the following operations and modifiers, which call the geometry engine APIs to manipulate geometry:

### Modeling Operations

- `op.extrude` — Extrude (Push/Pull)
- `op.sweep` — Sweep
- `op.offset` — Offset Edges
- `op.intersect_faces` — Intersect Faces
- `op.fillet` — Fillet
- `op.chamfer` — Chamfer
- `op.boolean_union` — Boolean Union
- `op.boolean_subtract` — Boolean Subtract
- `op.boolean_intersect` — Boolean Intersect
- `op.subdivide` — Subdivide
- `op.triangulate` — Triangulate

### Modifiers

- `mod.array` — Array Modifier
- `mod.mirror` — Mirror Modifier
- `mod.smooth` — Smooth Modifier

## Validation and Constraints

The geometry engine must maintain **topologically valid geometry** at all times. This means:

- All half-edges must have a twin
- All half-edges in a loop must form a closed cycle via `next`/`prev`
- Face normals must be consistent (outward-facing)
- No degenerate edges (zero-length)
- No duplicate vertices within tolerance
- No non-manifold edges (edges shared by more than two faces)

The `validate()` method must detect:

- Non-planar faces
- Degenerate edges
- Duplicate vertices
- Broken topology (missing twin, broken next/prev chain)
- Inconsistent normals

The `healTJunctions()` method must detect and repair T-junctions (where an edge endpoint touches the middle of another edge) by splitting edges and inserting vertices.

## Security and Data Classification

- **Data classification**: This component processes user-created 3D geometry. No sensitive data is inherently handled, but user models may contain proprietary designs.
- **Trust boundaries**: This component runs entirely in the local Electron desktop environment. It does not communicate with external services.
- **Input validation**: All geometry operations must validate inputs (non-null vertices, non-degenerate edges, coplanar face vertices) and return errors rather than corrupting the geometry state.

## Testing

This component is **tested by**:

- `test.integration.geometry` — Geometry Integration Tests

These tests must cover:

- All CRUD operations (create, delete, modify vertices/edges/faces)
- Topology queries (adjacent faces, vertex fans, connected components)
- Spatial queries (raycast, point-in-face, intersections)
- Validation (detecting invalid topology, healing T-junctions)
- Performance benchmarks (face creation, edge split, intersection timings)

## References

- [Boundary Representation (B-Rep)](https://en.wikipedia.org/wiki/Boundary_representation)
- [Doubly Connected Edge List (DCEL / Half-Edge)](https://en.wikipedia.org/wiki/Doubly_connected_edge_list)