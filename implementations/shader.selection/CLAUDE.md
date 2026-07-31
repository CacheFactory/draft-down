# Selection Highlight Shader

## What This Component Is

A GLSL fragment shader responsible for rendering selection state overlays on 3D geometry. This shader must visually distinguish between different selection modes, hovered elements, and pre-selection inference hints. It renders directly on geometry from the Half-Edge Mesh without causing z-fighting artifacts.

## Visual Requirements

The shader must render:

- **Selected faces**: Blue semi-transparent overlay on face surfaces
- **Selected edges**: Thicker blue lines rendered along edge geometry
- **Selected vertices**: Blue dots rendered at vertex positions
- **Hover preview**: Subtle highlight overlay when cursor hovers over selectable elements
- **Pre-selection inference**: Axis-colored highlights (red/green/blue) indicating axis-aligned inferred constraints during modeling operations

All selection rendering must use the stencil buffer to prevent z-fighting with the underlying geometry.

## Data Inputs

The shader receives:

- **Selection state uniforms**: Current selection mode (face/edge/vertex), selected element IDs
- **Hover state**: Currently hovered element ID and type
- **Inference state**: Active inference mode, axis orientation, constraint type
- **Color uniforms**: Selection color (blue), inference axis colors (RGB), hover tint
- **Alpha values**: Transparency levels for different selection states
- **Geometry attributes**: Vertex positions, normals, UV coordinates from Half-Edge Mesh
- **Camera uniforms**: View, projection matrices from WebGL Renderer

## Integration Points

### Consumed By

- **WebGL Renderer** (`renderer.webgl`): Activates this shader program during the selection rendering pass, binds uniforms, and executes draw calls

### Operates On

- **Half-Edge Mesh** (`mesh.halfedge`): Reads geometry data (positions, normals, topology) to determine where to render selection highlights

## Shader Type and Language

- **Type**: Fragment shader (GLSL)
- **Language**: OpenGL Shading Language (GLSL)
- **Target**: WebGL 2.0 compatible

Must be paired with appropriate vertex shader that transforms geometry and passes interpolated attributes.

## Rendering Constraints

### Stencil Buffer Usage

Must use the stencil buffer to:
- Mark pixels belonging to selected geometry
- Prevent selection highlights from rendering behind occluding geometry
- Avoid z-fighting when selection overlay coincides with base geometry surface

The stencil write/test configuration is controlled by the WebGL Renderer but the shader must cooperate by not writing depth when rendering transparent overlays.

### Blending

- Selected face overlays: Alpha blending with premultiplied alpha
- Edge highlights: Additive or over blending depending on background
- Hover previews: Subtle additive glow

### Performance

Must execute efficiently for real-time interaction:
- No complex branching in hot paths
- Minimal texture lookups
- Compatible with rendering thousands of selected faces at 60fps

## Selection State Semantics

### Selection Modes

The shader must distinguish:

1. **Face selection**: Entire face surface highlighted
2. **Edge selection**: Edge rendered as thicker colored line
3. **Vertex selection**: Point rendered as colored dot with fixed screen-space size

### State Priorities

When multiple states overlap:
1. Active selection (highest priority)
2. Hover preview
3. Pre-selection inference (lowest priority)

The shader must render the highest-priority state when elements have multiple active states.

## Inference Visualization

Pre-selection inference shows directional constraints:

- **Red highlight**: X-axis aligned constraint
- **Green highlight**: Y-axis aligned constraint  
- **Blue highlight**: Z-axis aligned constraint

These appear before actual selection occurs, guiding the user toward axis-aligned modeling operations.

## Output

The shader outputs:

- **Color**: RGBA fragment color with appropriate alpha for blending
- **Depth**: Optional depth write depending on rendering pass requirements
- **Stencil**: Marks selected pixels in stencil buffer (coordinated with renderer)

## Security and Trust

This shader executes in the WebGL sandbox:

- No data exfiltration risk
- No file system access
- Operates only on geometry data provided by trusted local components
- No network communication

Shader compilation errors must be caught and reported by the WebGL Renderer.

## Non-Requirements

This shader does not:

- Handle base geometry rendering (separate material shader)
- Perform selection hit testing (done in CPU-side picking pass)
- Manage selection state (maintained by scene graph/interaction system)
- Render modeling tools or gizmos (separate overlay renderers)