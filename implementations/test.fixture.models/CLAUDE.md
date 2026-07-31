# Test Model Fixtures

**Component ID:** `test.fixture.models` (cwg1B1OO)  
**Kind:** test_fixture  
**Layer:** testing

## Purpose

This component provides shared test fixtures and helper functions for all test suites in DraftDown. It includes pre-built 3D models, mesh generators, validation helpers, and utilities for visual regression and E2E testing. All test code depends on these fixtures to ensure consistent, repeatable test scenarios across integration, performance, visual, and end-to-end tests.

## Responsibilities

- Generate programmatic mesh fixtures (cubes, spheres, cylinders, L-solids, rectangles)
- Provide pre-built complex scene fixtures (house models, overlapping geometry, grouped scenes)
- Supply edge-case meshes for topology validation (non-manifold, degenerate, meshes with holes)
- Generate performance test fixtures (large meshes, randomized meshes)
- Provide mesh validation assertion helpers (topology, manifoldness, Euler characteristic, bounding box, volume, surface area)
- Supply file-based fixtures in multiple formats (.scf, .obj, .stl, .gltf, .step, .dxf, .fbx)
- Provide helpers for visual regression testing (screenshot comparison, golden file management)
- Provide E2E test helpers (app launch, file loading, render frame synchronization)

## APIs Exposed

### TestFixtures Interface

Factory functions returning fully constructed geometries and scenes:

- `createEmptyScene()`: Returns empty `ISceneManager`
- `createUnitCube()`: Returns `{ mesh: HalfEdgeMesh, faces: Face[], vertices: Vertex[] }` for 1×1×1 cube (6 faces, 8 vertices, 12 edges)
- `createUnitRectangle()`: Returns `{ mesh: HalfEdgeMesh, face: Face }` for flat rectangle on XY plane (1 face)
- `createLSolid()`: Returns L-shaped extruded mesh with faces array
- `createCylinder(segments?: number)`: Returns cylindrical mesh with configurable segment count
- `createSphere(segments?: number)`: Returns spherical mesh with configurable segment count
- `createHouseModel()`: Returns `{ scene: ISceneManager, groups: Group[] }` with walls and peaked roof (~50 faces)
- `createOverlappingCubes()`: Returns scene with two intersecting cubes for boolean operation tests
- `createTwoCubes()`: Returns scene with two non-overlapping cubes
- `createScatteredCubes(count: number)`: Returns scene with specified number of randomly positioned cubes
- `createGroupedScene()`: Returns scene with nested groups and component definitions
- `createLayeredScene()`: Returns scene with multiple named layers
- `createTexturedModel()`: Returns scene with multiple PBR materials applied
- `createComponentScene()`: Returns scene with component definitions and instances
- `createMeshWithHoles()`: Returns mesh with faces containing inner loops
- `createNonManifoldMesh()`: Returns mesh with T-junctions or butterfly vertices
- `createDegenerateMesh()`: Returns mesh with zero-area faces or duplicate vertices
- `createGeneratedMesh(faceCount: number)`: Returns subdivided grid mesh with specified face count
- `createRandomMesh(vertexCount: number)`: Returns randomly generated mesh with specified vertex count

### MeshAssertions Interface

Validation helpers throwing descriptive errors on failure:

- `assertMeshValid(mesh)`: Validates topology, normals, planarity
- `assertTopologyConsistent(mesh)`: Validates half-edge data structure invariants
- `assertManifold(mesh)`: Validates mesh has no non-manifold edges or vertices
- `assertWatertight(mesh)`: Validates mesh has no boundary edges
- `assertFaceCount(mesh, expected)`: Validates face count matches expected
- `assertVertexCount(mesh, expected)`: Validates vertex count matches expected
- `assertEdgeCount(mesh, expected)`: Validates edge count matches expected
- `assertEulerCharacteristic(mesh, expected)`: Validates V-E+F equals expected value
- `assertBoundingBox(mesh, min, max, tolerance?)`: Validates mesh bounds within tolerance
- `assertVolume(mesh, expected, tolerance?)`: Validates mesh volume within tolerance
- `assertSurfaceArea(mesh, expected, tolerance?)`: Validates surface area within tolerance

### ScreenshotHelpers Interface

Visual regression testing utilities:

- `compareScreenshot(page, name, threshold?)`: Compares current screenshot to golden file, returns match boolean
- `updateGoldenScreenshot(page, name)`: Updates golden screenshot file for given test name

### E2EHelpers Interface

End-to-end test utilities:

- `launchApp()`: Launches Electron app and returns `AppHelper` handle
- `loadFixtureFile(name)`: Loads fixture file from `fixtures/` directory, returns `ArrayBuffer`
- `waitForMeshReady(page)`: Waits for geometry loading to complete
- `waitForRenderFrame(page)`: Waits for next render frame

## Data Consumed

### Fixture Files (Read-Only)

All files located in `fixtures/` subdirectory:

- `cube.scf`: Unit cube (6 faces, 8 vertices, 12 edges)
- `rectangle.scf`: Flat rectangle on XY plane (1 face)
- `house.scf`: Simple house with walls and peaked roof (~50 faces)
- `overlapping-cubes.scf`: Two overlapping cubes for boolean tests
- `grouped-scene.scf`: Scene with nested groups and components
- `textured-model.scf`: Model with multiple PBR materials
- `sample.obj`: Reference Wavefront OBJ file
- `sample-binary.stl`: Reference binary STL file
- `sample-ascii.stl`: Reference ASCII STL file
- `sample.gltf`: Reference glTF file with materials
- `sample.step`: Reference STEP mechanical part
- `sample.dxf`: Reference DXF floor plan
- `sample.fbx`: Reference FBX model
- `corrupt.obj`: Deliberately malformed file for error handling tests
- `large-100k.obj`: Large 100K-face model for performance benchmarks

## Data Produced

### Golden Screenshots (Write-Only)

Visual regression golden files written to test-specific directories. File names and locations determined by test framework and test name. Format: PNG images.

## Data Types Referenced

Must construct and return instances of:

- `HalfEdgeMesh`: Half-edge mesh data structure
- `Vertex`: Vertex in half-edge mesh
- `Edge`: Half-edge in mesh
- `Face`: Face in half-edge mesh
- `ISceneManager`: Scene graph manager interface
- `Group`: Scene graph node grouping geometry
- `ComponentDefinition`: Reusable component definition
- `Material`: PBR material definition
- `Vector3`: 3D vector (x, y, z)

## Dependencies

### Runtime Dependencies

- **Vitest** (`lib.vitest`): Test framework used for assertion helpers and test execution context

### Domain Dependencies

Must construct instances compatible with:

- Geometry subsystem half-edge mesh data structures
- Scene graph data structures (`ISceneManager`, `Group`, `ComponentDefinition`)
- Material system data structures
- Math library types (`Vector3`)

## Dependents

All test suites depend on this fixture library:

- **Tool E2E Tests** (`test.e2e.tools`): Uses fixtures for UI interaction tests
- **File I/O E2E Tests** (`test.e2e.file_io`): Uses fixture files for import/export validation
- **Geometry Integration Tests** (`test.integration.geometry`): Uses mesh fixtures for topology tests
- **Scene & Data Integration Tests** (`test.integration.scene`): Uses scene fixtures for graph operations
- **Visual Regression Tests** (`test.visual.rendering`): Uses screenshot helpers and visual fixtures
- **Geometry Performance Tests** (`test.perf.geometry`): Uses generated meshes for benchmarks
- **Rendering Performance Tests** (`test.perf.rendering`): Uses complex scenes for render benchmarks

## Security Constraints

**Data Classification:** Test fixtures only. No production data or user content.

**Trust Boundaries:** None. Test fixtures are part of source code and fully trusted.

**Access Control:** Read-only access to fixture files. Write access to golden screenshot directories during test runs only.

## Quality Requirements

- All programmatically generated meshes must satisfy half-edge invariants
- All generated meshes must have consistent winding order (counter-clockwise front faces)
- All generated meshes must have valid normals (unit length, pointing outward)
- Fixture files must be committed to source control and version-controlled
- Golden screenshots must be deterministic and reproducible across platforms
- Generated meshes must be parameterizable (segment counts, dimensions)
- Assertion helpers must provide clear, actionable error messages with actual vs. expected values
- Performance fixtures must be large enough to expose O(n²) algorithms but small enough to run in CI

## Constraints

- All fixtures must load synchronously or return promises for async operations
- Mesh generators must not exceed 10 seconds generation time for largest fixtures
- Fixture files must not exceed 10MB each
- Golden screenshots must use lossless PNG format
- All fixtures must be compatible with Vitest test runner lifecycle
- Mesh assertions must not mutate input meshes
- E2E helpers must handle Electron app lifecycle correctly (launch, ready, cleanup)