# X-Ray Shader

**Component ID:** `shader.xray`  
**UUID:** `KcicMePc`  
**Layer:** rendering  
**Kind:** shader

## What This Component Is

A GLSL fragment shader that implements X-ray rendering mode for 3D models. This shader makes all geometry semi-transparent so that internal structure and back-facing geometry are visible through front faces. The effect creates a "ghost mode" visualization useful for inspecting complex models, verifying internal geometry, and understanding spatial relationships that would otherwise be hidden.

The shader applies depth-based transparency where front faces are more opaque than back faces, while keeping edges fully opaque to maintain visual clarity of the model's structure. An optional wireframe overlay can be enabled to further emphasize the geometry's edge structure.

## Responsibilities

- Render all geometry faces with controlled semi-transparency
- Apply depth-based transparency modulation so front faces are more opaque than back faces
- Maintain full opacity for edges and wireframe elements
- Support ghost mode visualization for seeing through the model
- Enable back-face visibility regardless of normal culling state
- Provide wireframe overlay capability

## API Surface

### Shader Inputs (Uniforms)

Must accept standard uniforms from the WebGL Renderer:
- Model-view-projection matrices
- Camera position
- View direction

Must accept X-ray-specific control uniforms:
- Base transparency level (0.0 to 1.0)
- Depth falloff factor controlling how transparency changes with depth
- Front face opacity multiplier
- Back face opacity multiplier
- Wireframe overlay toggle
- Edge color and opacity

### Shader Inputs (Vertex Attributes)

Must receive from Half-Edge Mesh:
- Vertex positions
- Vertex normals
- Edge flags (to identify geometry edges)
- Face orientation data

### Shader Outputs

Must output:
- Fragment color with alpha channel
- Proper depth values for correct depth testing and blending

## Data Requirements

### Read Access

Reads geometry data from Half-Edge Mesh (`mesh.halfedge`):
- Vertex positions and normals for lighting calculations
- Edge topology to render edges with full opacity
- Face orientation to distinguish front faces from back faces

Reads rendering state from WebGL Renderer (`renderer.webgl`):
- Current camera parameters
- View and projection matrices
- Viewport dimensions

### Write Access

Outputs rendered pixels to the WebGL framebuffer via the renderer pipeline.

## Dependencies

### Direct Dependencies

- **WebGL Renderer** (`renderer.webgl`): Provides the WebGL rendering context, compiles and links this shader, sets uniform values, and manages the rendering pipeline
- **Half-Edge Mesh** (`mesh.halfedge`): Provides geometry data including vertex attributes and edge information

### Consumers

The WebGL Renderer uses this shader when X-ray rendering mode is active. The shader is one of multiple rendering modes available in the application.

## Constraints

### Language and Platform

- Must be written in GLSL (OpenGL ES Shading Language)
- Must be compatible with WebGL 1.0 or WebGL 2.0 contexts
- Fragment shader only — vertex shader handling is managed by the renderer

### Security

- **Data Classification**: Public (contains no sensitive data)
- **Trust Boundary**: Runs in the renderer's WebGL context within the Electron renderer process
- **Input Validation**: All uniform and attribute data comes from trusted internal components (renderer and mesh)

### Performance

- Must execute efficiently in real-time rendering (60+ FPS target)
- Keep fragment processing overhead minimal for complex scenes
- Transparency rendering requires proper depth sorting and blending by the renderer

### Rendering Requirements

- Must work with standard WebGL blending modes (likely `GL_SRC_ALPHA`, `GL_ONE_MINUS_SRC_ALPHA`)
- Must respect depth testing while allowing back faces to be visible
- Must not interfere with edge rendering which should remain fully opaque
- Should handle both orthographic and perspective projections correctly

### Visual Requirements

- Front faces must be visibly more opaque than back faces
- Transparency must create a ghost-like effect without completely obscuring geometry
- Edge rendering must maintain crisp, fully opaque lines
- Depth-based transparency must provide clear visual depth cues

## Component Relationships

This shader is part of the rendering pipeline chain:
1. Half-Edge Mesh provides geometry data
2. WebGL Renderer selects and activates this shader based on rendering mode
3. Shader processes fragments and outputs to framebuffer
4. Final image displayed to user

The shader has no sub-components — it is a single GLSL fragment shader source file.

## Implementation Scope

Must provide:
- GLSL fragment shader source code implementing the X-ray effect
- Transparency calculations based on depth and face orientation
- Edge detection and opacity handling
- Optional wireframe overlay logic

The shader source will be loaded and compiled by the WebGL Renderer. No additional build steps or preprocessing are required beyond standard shader compilation.