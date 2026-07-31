# File I/O E2E Tests

## What This Component Is

This is an end-to-end test suite that validates all file import/export operations in DraftDown. It ensures that users can reliably save, load, import, and export 3D models across multiple file formats, and that data fidelity is preserved during these operations. This test suite runs in CI/CD pipelines and uses Playwright to drive the actual desktop application through user-facing workflows.

## Test Coverage Requirements

This suite must verify the following file operations:

### Native .scf Format (file.native)
- Save and reopen preserves geometry (vertex/face counts)
- Save preserves material assignments
- Save preserves groups and component hierarchy
- Auto-save creates recovery files at configured intervals

### OBJ Format (file.obj)
- Import OBJ files successfully
- Export and reimport preserves geometry (roundtrip fidelity)
- Import OBJ with .mtl materials applies materials correctly

### STL Format (file.stl)
- Import binary STL files
- Import ASCII STL files
- Export triangulates all faces (all output faces must be triangles)
- Export reports manifold/non-manifold status

### glTF Format (file.gltf)
- Import glTF with PBR materials (metalness/roughness maps)
- Export GLB binary format
- Roundtrip preserves scene node hierarchy

### DXF Format (file.dxf)
- Import 2D DXF floor plans (produces edges)
- Import 3D DXF with 3DFACE entities (produces faces)

### STEP Format (file.step)
- Import STEP mechanical parts (triggers OpenCascade WASM loading)
- Import STEP assemblies with hierarchy (creates groups per part)
- Display progress bar during import

### FBX Format (file.fbx)
- Import FBX with materials

### Error Handling
- Corrupt file shows error dialog
- Empty file shows error dialog
- Unsupported format shows error
- Large file (50MB+) shows progress bar

## Dependencies

### Test Fixtures (test.fixture.models)
This suite requires sample files in the following formats:
- `.obj` files (with and without `.mtl` materials)
- `.stl` files (both binary and ASCII)
- `.gltf` and `.glb` files (with PBR materials)
- `.step` files (mechanical parts and assemblies)
- `.fbx` files (with materials)
- `.dxf` files (2D floor plans and 3D with 3DFACE)
- Corrupted/empty/invalid test files
- Large files (50MB+) for performance testing

### Components Under Test

- **DraftDown Native Format (.scf)** (`file.native`): Native save/load roundtrip
- **OBJ Format** (`file.obj`): Import/export operations
- **STL Format** (`file.stl`): Import/export operations
- **glTF Format** (`file.gltf`): Import/export operations
- **DXF Format** (`file.dxf`): Import operations
- **STEP Format** (`file.step`): Import operations
- **FBX Format** (`file.fbx`): Import/export operations
- **Main Window** (`window.main`): User-facing file dialogs and keyboard shortcuts
- **File I/O Worker** (`worker.fileio`): Background file processing

### Test Framework

- **Playwright** (`lib.playwright`): Drives the Electron application, interacts with native file dialogs, and provides test assertions

## Test Execution Requirements

- **Timeout**: 60,000ms (60 seconds) per test to accommodate large file operations
- **CI**: Must run in continuous integration pipelines
- **Parallelization**: Tests must be safe to run in parallel where possible
- **Cleanup**: Each test must clean up temporary files created during save/export operations

## What This Suite Must Verify

### Data Fidelity
- Geometry counts (vertices, edges, faces) preserved across operations
- Material assignments preserved
- Group/component hierarchy preserved
- Scene node structure preserved (for formats that support it)
- Texture embedding works correctly

### User Experience
- File dialogs open and respond correctly
- Progress bars appear for long operations (>1 second)
- Error dialogs display for invalid operations
- Keyboard shortcuts work (Ctrl+S for save, Ctrl+O for open)

### Format-Specific Constraints
- STL export triangulates n-gons
- STL export detects and warns about non-manifold geometry
- STEP import triggers WASM loading correctly
- glTF preserves PBR material properties
- DXF 2D import produces edges, 3D import produces faces

## Assertions and Validation

Tests must be able to query the application state to verify:
- Face/vertex/edge counts via viewport API
- Material presence and assignments
- Group/component hierarchy
- File existence and size
- Dialog visibility
- Progress bar visibility
- Error message content

## No Implementation Prescribed

This specification does not mandate:
- How Playwright fixtures are structured
- Whether to use page object models or direct selectors
- How to interact with native OS file dialogs
- How to clean up temporary test files
- How to parallelize test execution
- How to structure test data or factories