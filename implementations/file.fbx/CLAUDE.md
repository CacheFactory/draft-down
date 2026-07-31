# FBX Format

**Component ID:** `file.fbx`  
**Layer:** data  
**Type:** file_format

## What This Component Is

This component provides FBX (Autodesk Filmbox) file format import and export capabilities for DraftDown. FBX is a widely-used 3D interchange format compatible with major 3D applications including 3ds Max, Maya, Blender, and game engines. This component enables bidirectional data exchange between DraftDown and these external tools.

## Responsibilities

### Import Operations
- Read binary FBX files from the local file system
- Parse mesh geometry data (vertices, faces, normals, UVs)
- Extract material definitions and properties
- Reconstruct scene hierarchy (nodes, transforms, parent-child relationships)
- Import basic animation data (keyframes, curves)
- Convert FBX data structures into DraftDown's internal representation

### Export Operations
- Write binary FBX files to the local file system
- Export mesh geometry with full vertex data
- Include material definitions and assignments
- Preserve scene hierarchy and transform data
- Embed textures when configured to do so

## APIs and Interfaces

### Import API
Must expose methods to:
- Accept a file path from the local file system
- Parse the FBX file contents
- Return structured data representing geometry, materials, hierarchy, and animations
- Handle parsing errors and invalid file formats gracefully

### Export API
Must expose methods to:
- Accept DraftDown scene data (geometry, materials, hierarchy)
- Convert internal representations to FBX format
- Write FBX binary data to a specified file path
- Support options for binary encoding and texture embedding

### Configuration Options
Format-specific options as JSON:
- `binary`: true — must output binary FBX format
- `embedTextures`: true — must embed texture data in the FBX file

## Data Operations

### Reads From Local File System
- FBX files at user-specified paths
- Must handle file access errors (missing files, permission issues)
- Must validate file format before attempting full parse

### Writes To Local File System
- FBX files at user-specified export paths
- Must handle write errors (disk full, permission denied)
- Must generate valid binary FBX data that can be read by external tools

## Dependencies

### External Libraries
- **fbx-parser library**: Must be used for binary FBX decoding
- This library handles low-level FBX binary format parsing
- Component must wrap this library and translate between FBX structures and DraftDown's data model

### Internal Dependencies
- Must integrate with DraftDown's geometry representation system
- Must integrate with material system for property mapping
- Must integrate with scene graph for hierarchy reconstruction

## Data Structures and Formats

### FBX Data Elements
Must handle:
- **Geometry nodes**: Mesh data with vertex positions, normals, UV coordinates, face indices
- **Material nodes**: Shader properties, color values, texture references
- **Hierarchy nodes**: Scene graph structure with transforms (translation, rotation, scale)
- **Animation nodes**: Keyframe data, animation curves (basic support)

### Internal Data Mapping
- Map FBX coordinate system to DraftDown coordinate system
- Convert FBX material properties to DraftDown material model
- Translate FBX transform matrices to DraftDown transform representation
- Handle unit conversions if necessary

## Constraints and Requirements

### Technical Complexity
- Marked as **complex** implementation
- FBX format has intricate binary structure with nested nodes
- Requires careful handling of data type conversions
- Must maintain data fidelity during round-trip import/export

### Format Compliance
- Must produce FBX files readable by Autodesk tools, Blender, and major game engines
- Must correctly parse FBX files from these same sources
- Binary FBX format must conform to Autodesk FBX specification

### Error Handling
- Must detect and report corrupted or invalid FBX files
- Must handle partial data gracefully (missing materials, incomplete hierarchies)
- Must not crash on unexpected FBX node types or malformed data

### Performance
- Must handle reasonably large FBX files (typical architectural or game assets)
- Parsing should not block the UI thread indefinitely
- Memory usage should be proportional to file size

## Security Considerations

### Data Classification
- FBX files are user-generated content
- May contain sensitive design data
- No cloud transmission — all processing is local

### Trust Boundaries
- FBX files are untrusted input from external sources
- Must validate all parsed data before use
- Must guard against malicious FBX files (buffer overflows, infinite loops, excessive memory allocation)

### File System Access
- Only read files from paths explicitly chosen by the user
- Only write files to paths explicitly chosen by the user
- No automatic file system traversal or discovery

## Testing Requirements

### Test Coverage
Must be tested by:
- **File I/O E2E Tests** (`test.e2e.file_io`): End-to-end validation of import/export workflows

Test scenarios must include:
- Import of valid FBX files with various geometry types
- Export to FBX and reimport to verify data fidelity
- Handling of malformed or corrupted FBX files
- Verification of material and hierarchy preservation
- Texture embedding behavior
- Compatibility with FBX files from external tools (3ds Max, Maya, Blender)

## Implementation Language

- **TypeScript**: All code must be written in TypeScript
- Must follow Electron desktop application patterns
- Must integrate with Node.js file system APIs for local file operations