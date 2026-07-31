# Edge Outline Shader

## What This Component Is

A post-processing fragment shader that renders architectural edges in the DraftDown "sketchy" aesthetic. This shader analyzes the rendered scene to detect and draw three types of edges as dark lines:

- **Profile edges** (silhouettes) — edges where the mesh boundary meets empty space
- **Crease edges** (hard edges) — edges between faces with sharp normal discontinuities
- **Border edges** — outer perimeter edges of the model

The shader operates as a screen-space post-process effect, analyzing depth and normal buffers to identify edge locations using Sobel edge detection. Line weight varies by edge type to communicate structural hierarchy.

**Archigraph ID**: `shader.outline` (uuid: `Ec5FM5kb`)

## Responsibilities

- Detect edges from rendered scene buffers (depth, normals) using Sobel filter convolution
- Distinguish between profile edges (depth discontinuities), crease edges (normal discontinuities), and border edges
- Render detected edges as dark lines with appropriate line weights per edge type
- Integrate with Three.js post-processing pipeline (EffectComposer)
- Maintain real-time performance for interactive modeling workflows

## Data Requirements

### Input Buffers

The shader consumes screen-space buffers from the rendering pipeline:

- **Depth buffer** — normalized depth values for edge detection via depth discontinuities
- **Normal buffer** — world-space or view-space normals for crease detection via normal discontinuities
- **Scene color buffer** — the base rendered scene to composite edges onto

### Mesh Data Dependencies

While the shader operates on screen-space buffers, it indirectly depends on Half-Edge Mesh (`mesh.halfedge`) geometry that has been rendered into those buffers. The mesh structure defines which faces, edges, and vertices exist, which manifests as patterns in the depth and normal buffers.

### Shader Parameters

The shader must accept configurable parameters:

- Edge detection sensitivity thresholds (depth threshold, normal threshold)
- Line weight per edge type (profile, crease, border)
- Edge color (typically dark gray or black)
- Sobel kernel size or sampling pattern

### Output

- **Composited frame** — the input scene color with edge lines overlaid

## APIs and Integration

### Three.js EffectComposer Integration

This shader must be implemented as a Three.js post-processing pass compatible with `EffectComposer`. The pass should:

- Accept input textures (depth, normal, color) from the rendering pipeline
- Execute the Sobel edge detection fragment shader
- Output the composited result to the next pass or final framebuffer

The WebGL Renderer (`renderer.webgl`) orchestrates the post-processing pipeline and provides the input buffers.

### Shader Interface

As a GLSL fragment shader, the component must implement:

- Uniform inputs for textures (depth, normal, color) and parameters
- Varying inputs for texture coordinates
- Fragment output for the composited color
- Sobel convolution logic sampling neighboring pixels

## Technical Constraints

### Performance

- Must operate at real-time frame rates (60fps target) for interactive modeling
- Shader complexity must not introduce perceptible latency on typical desktop GPUs
- Sobel kernel sampling should be optimized (e.g., 3x3 or 5x5 maximum)

### Visual Quality

- Edge detection must accurately identify profile, crease, and border edges without excessive false positives
- Lines must appear clean and anti-aliased, not jagged
- Line weight variation must be perceptually distinct across edge types
- Edges should remain stable across frames (no flickering)

### Shader Language

- Implementation language: **GLSL**
- Target: Fragment shader (screen-space post-process)
- Must be compatible with WebGL 2.0 standards

## Dependencies

### Consumed By

- **WebGL Renderer** (`renderer.webgl`) — manages the post-processing pipeline, provides input buffers, and executes this shader as a pass

### Data Source

- **Half-Edge Mesh** (`mesh.halfedge`) — the geometry that produces the patterns in depth/normal buffers that this shader analyzes

## Security and Data Classification

- All processing occurs locally on the desktop; no remote data transmission
- Shader operates on transient GPU buffers (depth, normals) that exist only during frame rendering
- No persistent data storage or sensitive data handling

## Implementation Guidance

This is a **fragment shader** implemented in **GLSL**, running as part of the Three.js EffectComposer post-processing stack. The WebGL Renderer component handles integration into the rendering pipeline.

The Sobel edge detection technique is well-documented. Reference implementation: https://threejs.org/examples/#webgl_postprocessing_sobel

Edge types are distinguished by analyzing:
- Depth discontinuities → profile edges (silhouettes)
- Normal discontinuities → crease edges (hard surface transitions)
- Scene boundaries + depth/normal patterns → border edges

Line weight hierarchy should emphasize profile edges (thickest), then borders, then creases.