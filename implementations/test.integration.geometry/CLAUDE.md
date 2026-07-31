# Geometry Integration Tests

## Overview

This test suite validates the geometry engine and all modeling operations for DraftDown. It runs headless (without Electron) using Vitest and exercises the entire geometry stack from low-level half-edge mesh operations through high-level boolean operations. Tests must verify topological consistency, manifold properties, and volumetric correctness of all operations.

## Test Framework

- **Framework**: Vitest
- **Timeout**: 10000ms per test
- **CI**: Must run in CI/CD pipeline
- **Execution**: Headless (no Electron, no GUI dependencies)

## Test Coverage Requirements

### Half-Edge Mesh CRUD Operations

Must validate:

- Creating faces from vertex lists and closed edge loops
- Adding vertices at specified 3D positions
- Edge splitting at arbitrary points along the edge
- Vertex merging for coincident positions
- Edge and face removal with cascading updates
- Faces with inner loops (holes)
- Non-manifold topology support (T-junctions, multiple faces per edge)
- Topology consistency after every operation

### Modeling Operations

Must test each operation from `../op.*/`:

- **Extrude (Push/Pull)**: Create 3D solids from 2D faces, handle non-rectangular faces, faces with holes, negative distances (inset), Ctrl-mode (preserve original face), auto-boolean-cut mode
- **Sweep**: Sweep profiles along paths
- **Offset**: Inset/outset faces, handle concave geometry
- **Boolean Operations**: Union, subtract, intersect via Manifold integration, handle coincident faces, overlapping geometry
- **Intersect Faces**: Compute face-face intersections
- **Subdivide**: Mesh subdivision
- **Triangulate**: Convert n-gons to triangles
- **Fillet**: Round edges
- **Chamfer**: Bevel edges

### Topology Validation

Must verify:

- **Euler Characteristic**: V - E + F = 2 for closed solids
- **Manifold Properties**: Detect non-manifold vertices, edges, topology violations
- **Watertightness**: No holes, gaps, or open boundaries in closed solids
- **Consistency**: Half-edge twin pointers, face-edge loops, vertex-edge connectivity
- **Volume Accuracy**: Computed volumes match expected values within tolerance

### B-Rep Consistency

Must validate boundary representation integrity:

- Face normals computed correctly
- Edge-face adjacency correct
- Vertex positions match edge endpoints
- No duplicate vertices, edges, or faces
- Closed loops form valid faces

## Test Fixtures

Must use fixtures from `../test.fixture.models/`:

- **Unit cube mesh**: 8 vertices, 12 edges, 6 faces
- **Unit rectangle**: Single 2D face for extrusion tests
- **L-shaped solid**: Non-convex geometry
- **Cylinder mesh**: Curved surface approximation
- **Mesh with holes**: Faces with inner loops
- **Non-manifold mesh**: T-junctions and edge-sharing violations
- **Overlapping cubes**: For boolean operation tests

## Assertion Utilities

Test fixtures must provide:

- `MeshAssertions.assertTopologyConsistent(mesh)`: Validate all half-edge pointers, loops, connectivity
- `MeshAssertions.assertManifold(mesh)`: Verify manifold constraints
- `MeshAssertions.assertWatertight(mesh)`: Check for holes or gaps
- `MeshAssertions.assertVolume(mesh, expected, tolerance)`: Validate computed volume
- `MeshAssertions.assertEulerCharacteristic(mesh, chi)`: V - E + F = chi

## Dependencies on Other Components

### Core Geometry Components

- **Half-Edge Mesh** (`../mesh.halfedge/`): Primary data structure under test, provides `HalfEdgeMesh` class with CRUD methods
- **Manifold Solid Engine** (`../solid.manifold/`): Boolean operations backend
- **Polyline Curve** (`../curve.polyline/`): Curve primitives for sweep/offset operations
- **Arc Curve** (`../curve.arc/`): Arc primitives for fillets and curved edges
- **Core Geometry Engine** (`../engine.geometry/`): Orchestrates operations, validation, conversion

### Modeling Operations

All operation modules expose `execute()` methods that accept a mesh and operation-specific parameters, returning modified mesh and operation results:

- `../op.extrude/`: Extrude parameters include `face`, `distance`, `createNewStartFace`, `autoBooleanCut`
- `../op.sweep/`: Sweep parameters include profile curve and path
- `../op.offset/`: Offset parameters include faces and inset/outset distance
- `../op.boolean_union/`: Union accepts two meshes
- `../op.boolean_subtract/`: Subtract accepts two meshes (A - B)
- `../op.boolean_intersect/`: Intersect accepts two meshes
- `../op.intersect_faces/`: Face-face intersection calculation
- `../op.subdivide/`: Subdivision parameters
- `../op.triangulate/`: Triangulation algorithm selection
- `../op.fillet/`: Fillet radius and edge selection
- `../op.chamfer/`: Chamfer distance and edge selection

### Test Infrastructure

- **Test Model Fixtures** (`../test.fixture.models/`): Provides `TestFixtures` with factory methods for standard test geometry
- **Vitest**: Test runner and assertion library

## Test Data

Tests must work with:

- 3D vertex positions as `[x, y, z]` arrays
- Face vertex lists in counter-clockwise winding order
- Edge half-edge twin relationships
- Volume tolerances typically 0.001 units
- Distance parameters in model units (typically meters or millimeters)

## Success Criteria

A test passes when:

- All assertions succeed
- No exceptions thrown (unless testing error conditions)
- Topology remains consistent after operations
- Computed volumes match expected within tolerance
- Manifold properties preserved (or correctly reported as violated)
- Performance stays within timeout limits

## Error Conditions to Test

Must validate error handling for:

- Non-coplanar vertices in face creation
- Open edge loops when creating faces
- Invalid vertex indices
- Degenerate geometry (zero-length edges, zero-area faces)
- Self-intersecting geometry in operations
- Boolean operations on non-manifold inputs where unsupported

## Data Classification

- Test data: Unclassified, disposable
- No user data, no persistent storage
- All test state isolated per test case

## Performance Constraints

- Individual tests must complete within 10s timeout
- Full suite should complete in reasonable CI time (< 5 minutes target)
- Memory usage should not exceed typical Electron renderer limits
- No GPU required (headless execution)