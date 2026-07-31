# Half-Edge Mesh (mesh.halfedge)

The Half-Edge Mesh is the primary mesh data structure for DraftDown's geometry layer. It uses a half-edge (doubly-connected edge list / DCEL) representation to enable efficient topology queries and modifications required by modeling operations, inference systems, and rendering pipelines.

## Purpose

This component stores and manages 3D mesh topology and geometry using a half-edge data structure where each edge is represented as two directed half-edges. It must support:

- Non-manifold topology (edges with more than two adjacent faces, isolated vertices/edges)
- Real-time modification by modeling operations (extrude, sweep, subdivide, boolean operations)
- Fast topology traversal (vertex→edges, edge→faces, face→boundary, adjacency queries)
- Incremental updates with dirty flagging to avoid full recomputation
- Efficient GPU buffer generation for rendering (triangulated, indexed)
- Undo/redo through snapshot/delta serialization

## Data Responsibilities

### Storage
- **Vertices**: Position (float64 x/y/z), per-vertex attributes (normal, uv, color, selected, hidden)
- **Edges**: Pairs of half-edges, soft/smooth flags, material index, selection state
- **Half-Edges**: Directed edge references (vertex, twin, next, prev, face)
- **Faces**: Outer loop + optional inner loops (holes), material index, selection state
- **Spatial Index**: Octree for fast spatial queries (raycasting, nearest neighbor)
- **GPU Buffers**: Cached triangulated geometry (positions, normals, UVs, colors, indices)

### Precision and Topology
- Geometry precision: `float64` for vertex positions (CAD-grade accuracy)
- Supports non-manifold topology: edges may have 0, 1, 2, or more adjacent faces
- Represents both solid and surface meshes

## API Contract

### Vertex Operations
```typescript
addVertex(position: Vector3): Vertex
removeVertex(vertex: Vertex): void
getVertex(id: string): Vertex | undefined
getAllVertices(): IterableIterator<Vertex>
```

### Edge Operations
```typescript
addEdge(v1: Vertex, v2: Vertex): Edge
removeEdge(edge: Edge): void
getEdge(id: string): Edge | undefined
getAllEdges(): IterableIterator<Edge>
```

### Face Operations
```typescript
addFace(vertexLoop: Vertex[], innerLoops?: Vertex[][]): Face
removeFace(face: Face): void
getFace(id: string): Face | undefined
getAllFaces(): IterableIterator<Face>
```

### Topology Traversal
```typescript
vertexEdges(vertex: Vertex): Edge[]
vertexFaces(vertex: Vertex): Face[]
edgeFaces(edge: Edge): [Face | null, Face | null]
faceBoundary(face: Face): Edge[]
faceVertices(face: Face): Vertex[]
adjacentFaces(face: Face): Face[]
```

### Mesh Queries
```typescript
getStats(): HalfEdgeMeshStats
// Returns: vertexCount, edgeCount, faceCount, halfEdgeCount, triangleCount,
// boundaryEdgeCount, isManifold, isWatertight, eulerCharacteristic (V - E + F)

getBoundingBox(): BoundingBox
```

### GPU Buffer Generation
```typescript
getGPUBuffers(): GPUBufferData
invalidateGPUBuffers(): void
```

**GPUBufferData shape**:
- `positions: Float32Array` — vec3 per vertex
- `normals: Float32Array` — vec3 per vertex
- `uvs: Float32Array` — vec2 per vertex
- `colors: Float32Array` — vec4 per vertex (material color)
- `indices: Uint32Array` — triangle indices
- `edgePositions: Float32Array` — line segment positions for edge rendering
- `edgeColors: Float32Array` — per-edge colors (axis colors, selection highlights)
- `selectedFaceIndices: Uint32Array` — triangle indices of selected faces
- `selectedEdgePositions: Float32Array` — line positions of selected edges

GPU buffers must be lazily generated and cached. Triangulation is performed only on dirty faces using ear-clipping for simple convex faces and constrained Delaunay for complex/concave/holed faces. Output separate indexed triangle buffers and line buffers for edge rendering.

### Serialization for Undo/Redo
```typescript
snapshot(): MeshSnapshot
restoreFromSnapshot(snapshot: MeshSnapshot): void
computeDelta(before: MeshSnapshot, after: MeshSnapshot): MeshDelta
applyDelta(delta: MeshDelta): void
reverseDelta(delta: MeshDelta): MeshDelta
```

**MeshSnapshot shape**:
- `vertices: Map<string, { position: Float64Array }>`
- `edges: Map<string, { v1: string; v2: string; soft: boolean; smooth: boolean }>`
- `faces: Map<string, { outerLoop: string[]; innerLoops: string[][]; materialIndex: number }>`

**MeshDelta shape**:
- `addedVertices: Map<string, { position: Float64Array }>`
- `removedVertices: Set<string>`
- `movedVertices: Map<string, { from: Float64Array; to: Float64Array }>`
- `addedEdges: Map<string, { v1: string; v2: string }>`
- `removedEdges: Set<string>`
- `addedFaces: Map<string, { outerLoop: string[]; materialIndex: number }>`
- `removedFaces: Map<string, { outerLoop: string[]; materialIndex: number }>`

## Dependencies and Consumers

### Consumed By
- **WebGL Renderer** (`renderer.webgl`): Reads GPU buffers for rendering
- **PBR Material Shader** (`shader.pbr`): Draws faces with material properties
- **Edge Outline Shader** (`shader.outline`): Draws edge wireframes
- **Selection Highlight Shader** (`shader.selection`): Draws selected geometry
- **X-Ray Shader** (`shader.xray`): Draws occluded geometry

### Modified By (Modeling Operations)
- **Extrude (Push/Pull)** (`op.extrude`): Adds faces, edges, vertices
- **Sweep** (`op.sweep`): Creates geometry along path
- **Offset Edges** (`op.offset`): Modifies edge positions
- **Intersect Faces** (`op.intersect_faces`): Splits faces at intersections
- **Subdivide** (`op.subdivide`): Adds vertices/edges to faces
- **Triangulate** (`op.triangulate`): Converts n-gons to triangles
- **Fillet** (`op.fillet`): Rounds edges
- **Chamfer** (`op.chamfer`): Bevels edges

### Modified By (Modifiers)
- **Array Modifier** (`mod.array`): Duplicates geometry
- **Mirror Modifier** (`mod.mirror`): Reflects geometry
- **Smooth Modifier** (`mod.smooth`): Adjusts vertex positions

### Queried By
- **Core Geometry Engine** (`engine.geometry`): Performs geometric computations
- **Inference Engine** (`engine.inference`): Queries topology for snap points, guide lines
- **Snap Point Constraint** (`constraint.snap_point`): Queries vertices/edges for snapping
- **Mesh Processing Worker** (`worker.mesh`): Performs background mesh operations

### Managed By
- **Scene Manager** (`data.scene`): Manages mesh lifecycle in scene graph
- **Selection Manager** (`data.selection`): Reads/writes selection state
- **Material Manager** (`data.materials`): Reads/writes material indices
- **Model Document** (`data.document`): Serializes/deserializes mesh for file I/O

### Tested By
- **Geometry Integration Tests** (`test.integration.geometry`)
- **Geometry Performance Tests** (`test.perf.geometry`)

## Performance Requirements

This component is **performance-critical** and must handle meshes with:
- Tens of thousands of vertices in real-time
- Sub-millisecond topology queries (vertex→edges, edge→faces)
- Incremental updates without full mesh rebuild

### Optimizations Required
- **Indexed vertex buffer** for GPU upload (minimize data transfer)
- **Lazy normal recomputation**: Only recompute normals for modified faces
- **Dirty flag system**: Track modified regions for incremental updates
- **Pooled object allocation**: Reuse Vertex/Edge/Face objects to reduce GC pressure
- **Spatial indexing**: Octree for O(log n) spatial queries

## Attributes

Each vertex must support the following attributes:
- `position` (Vector3, float64)
- `normal` (Vector3, computed or explicit)
- `uv` (Vector2, texture coordinates)
- `color` (Vector4, RGBA)
- `materialIndex` (integer)
- `selected` (boolean)
- `hidden` (boolean)

Each edge must support:
- `soft` (boolean): Softened edge (smooth shading across edge)
- `smooth` (boolean): Smooth edge (affects normal interpolation)
- `selected` (boolean)
- `hidden` (boolean)

Each face must support:
- `materialIndex` (integer)
- `selected` (boolean)
- `hidden` (boolean)

## Constraints

### Data Classification
- **Internal**: All mesh data (vertices, edges, faces, topology)
- **No PII**: Mesh geometry is purely geometric data

### Trust Boundaries
- Mesh data originates from:
  - User modeling operations (trusted)
  - File import (must validate topology)
  - Plugin operations (must validate topology)

### Validation Requirements
- Ensure half-edge twin consistency (every half-edge must have a valid twin)
- Ensure loop closure (next/prev pointers form closed loops)
- Detect and handle non-manifold geometry gracefully
- Validate vertex indices in face loops

### Thread Safety
- Mesh mutations must be single-threaded (main thread only)
- Read-only queries may be parallelized
- Mesh Processing Worker must operate on deep copies or serialized snapshots

## Sub-Components

This implementation must include:

1. **Vertex class**: Position storage, attribute storage, half-edge reference
2. **Edge class**: Twin half-edge references, soft/smooth flags
3. **HalfEdge class**: Vertex, twin, next, prev, face references
4. **Face class**: Outer loop, inner loops (holes), material index
5. **Octree spatial index**: For raycasting and nearest-neighbor queries
6. **GPU buffer generator**: Triangulation (ear-clipping, constrained Delaunay), indexed buffer generation
7. **Snapshot/delta serializer**: For undo/redo COW operations

## References

- Half-edge data structure (DCEL): https://en.wikipedia.org/wiki/Doubly_connected_edge_list
- Implementation language: TypeScript
- Complexity: Very complex