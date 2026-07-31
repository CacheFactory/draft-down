# PBR Material Shader

## What This Component Is

A custom GLSL fragment shader that implements physically-based rendering (PBR) for DraftDown 3D geometry. This shader extends Three.js `MeshStandardMaterial` using the `onBeforeCompile` hook to inject DraftDown-specific rendering features while retaining PBR fundamentals.

**Archigraph ID**: `shader.pbr` (uuid: `C65BEFgu`)

## Responsibilities

- Render geometry faces with metalness/roughness PBR workflow
- Apply normal mapping for surface detail
- Compute environment reflections for metallic and glossy surfaces
- Support texture tiling and UV transformations
- Handle opacity and transparency (alpha blending)
- Implement native face coloring:
  - Front faces: use assigned material color/texture
  - Back faces: apply blue tint to distinguish reversed geometry
- Render edges as dark lines at face boundaries
- Support "colored" materials: tint textures with a base color (DraftDown behavior)
- Support projected textures: textures applied via planar/cylindrical/spherical projection rather than UV mapping
- Integrate with Three.js lighting pipeline (directional, point, spot, ambient, hemisphere lights)

## Shader Contract

### Inputs (Uniforms & Varyings)

Must accept standard Three.js uniforms for:
- Material properties: `metalness`, `roughness`, `color`, `map` (diffuse texture), `normalMap`, `envMap`, `opacity`
- Lighting: directional/point/spot light arrays, ambient/hemisphere light parameters
- Camera: `cameraPosition`, view/projection matrices

Must accept custom uniforms:
- `faceSide`: integer or float indicating front (1.0) vs back (-1.0) face rendering
- `edgeThreshold`: distance or angle threshold for edge detection
- `coloredMaterialTint`: RGB color for tinting textures in "colored" mode
- `projectionMode`: enum or int (0=UV, 1=planar, 2=cylindrical, 3=spherical)
- `projectionMatrix`: mat4 for texture projection transforms
- `tilingScale`: vec2 for texture repeat scaling

Must receive varyings from vertex shader:
- `vNormal`: interpolated surface normal (world space)
- `vViewPosition`: fragment position in view space
- `vUv`: UV coordinates (if using UV mapping)
- `vWorldPosition`: fragment position in world space (for projected textures)

### Outputs

- `gl_FragColor`: Final RGBA pixel color

### Shader Injection Method

Uses Three.js `onBeforeCompile` to modify shader source:
- Inject custom uniform declarations
- Replace or augment lighting calculations
- Insert face-side logic before color output
- Add edge detection logic at fragment boundaries

## Data Flows

### Reads From

- Geometry data via Three.js material uniforms (provided by `renderer.webgl`)
- Half-edge mesh data indirectly via rendered geometry buffers (`mesh.halfedge` provides topology, converted to Three.js BufferGeometry)
- Texture assets loaded into Three.js textures
- Environment maps for reflection sampling

### Writes To

- WebGL framebuffer via `gl_FragColor` output

## Rendering Features Detail

### PBR Lighting Model

- Metalness/roughness workflow (not specular/glossiness)
- Fresnel reflections (Schlick approximation)
- Cook-Torrance microfacet BRDF or Three.js standard model
- Normal mapping applied in tangent space
- Environment map sampling for indirect specular reflections

### Face Front/Back Coloring

- Detect face orientation via `gl_FrontFacing` or injected `faceSide` uniform
- Front faces: render with material color/texture as-is
- Back faces: multiply color by blue tint (e.g., `vec3(0.5, 0.5, 1.0)`) to visually indicate reversed normals

### Edge Rendering

- Detect edges by comparing normal discontinuities or depth gradients between adjacent fragments
- Darken fragments near edge boundaries (e.g., multiply color by 0.3–0.5)
- Edge detection threshold configurable via uniform

### Colored Materials

- When enabled, multiply sampled texture color by `coloredMaterialTint` before lighting calculations
- Allows tinting white/gray textures with material color (DraftDown "colorize texture" behavior)

### Projected Textures

- Compute texture coordinates from world position using `projectionMatrix` and `projectionMode`
- Planar: project along one axis (e.g., XY plane)
- Cylindrical: wrap around Y-axis
- Spherical: wrap around center point
- Override or blend with UV coordinates

### Texture Tiling

- Scale UV or projected coordinates by `tilingScale` before texture sampling
- Support non-uniform scaling (independent X/Y tiling)

## Dependencies

### Consumed By

- **WebGL Renderer** (`renderer.webgl`): Instantiates and configures this shader as part of Three.js material pipeline

### Consumes

- **Half-Edge Mesh** (`mesh.halfedge`): Indirectly; mesh topology converted to Three.js geometry buffers, which this shader renders

### External Libraries

- Three.js: Host rendering engine; shader code injected into `MeshStandardMaterial.onBeforeCompile`
- WebGL 1.0 or 2.0: Target shader API (GLSL 1.0 ES or 3.0 ES)

## Security & Constraints

### Data Classification

- Unclassified: All shader code and parameters are local, client-side only
- No sensitive data; shader operates on publicly visible 3D geometry and materials

### Trust Boundaries

- No external network calls
- Shader source injected at runtime; ensure injection logic prevents unintended code execution (validate uniform names, shader chunks)

### Resource Constraints

- Shader must compile and run efficiently on mid-range consumer GPUs
- Target 60 FPS for scenes with 10k–100k polygons
- Avoid excessive texture lookups or branching in fragment shader
- Edge detection should not require expensive multi-pass rendering

### Compatibility

- Must work with Three.js versions r140+
- GLSL syntax compatible with WebGL 1.0 (GLSL ES 1.0) at minimum; may use WebGL 2.0 features if available
- Handle missing features gracefully (e.g., if normal map not provided, skip normal mapping)

## Implementation Notes

### Shader Injection Pattern

The shader is not a standalone file but JavaScript code that modifies Three.js material shaders. The implementation should:
- Create a `THREE.MeshStandardMaterial` instance
- Define custom uniforms as part of `material.uniforms`
- Implement `material.onBeforeCompile = (shader) => { ... }` callback
- Modify `shader.fragmentShader` string (inject includes, replace chunks)
- Optionally modify `shader.vertexShader` for varyings

### Face Side Detection

- DraftDown distinguishes front (default) and back faces; Three.js renders both sides with `side: THREE.DoubleSide`
- Use `gl_FrontFacing` GLSL built-in to detect face orientation
- Alternatively, pass face side as a vertex attribute or instance attribute if per-face coloring is required

### Edge Rendering Approach

- Option 1: Detect edges via screen-space normal derivatives (`dFdx(vNormal)`, `dFdy(vNormal)`)
- Option 2: Pass edge flags as vertex attributes from half-edge mesh data
- Edge detection must distinguish true geometry edges from smooth shading gradients

### Colored Material Logic

- Three.js `MeshStandardMaterial.color` typically multiplies with texture; ensure custom tinting logic preserves PBR correctness
- Apply tint before lighting calculations, not after, to avoid washing out shading

### Projected Texture Logic

- Compute projection coordinates in fragment shader or pass from vertex shader
- Projection matrix should be configurable per material instance
- Support multiple projection modes via branching or separate shader variants

### Performance Considerations

- Minimize dynamic branching (`if` statements based on uniforms); prefer static branching via `#define` or shader variants
- Cache uniform lookups in local variables
- Use texture atlases or texture arrays if many materials share similar textures

## Testing Requirements

- Verify correct PBR appearance under various lighting conditions (directional, point, spot lights)
- Confirm front faces render with material color, back faces render with blue tint
- Check edge detection produces visible dark lines at mesh boundaries
- Validate colored materials correctly tint textures
- Test projected textures align correctly with projection modes
- Ensure transparency and opacity blend correctly with scene
- Profile frame rate with complex scenes; target 60 FPS on mid-range hardware

## Related Components

- **WebGL Renderer** (`renderer.webgl`): Instantiates materials using this shader, manages render loop
- **Half-Edge Mesh** (`mesh.halfedge`): Source of geometry topology rendered by this shader