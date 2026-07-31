# Main 3D Viewport

**Component ID**: `viewport.main`  
**UUID**: `f8kRBGQr`  
**Layer**: rendering  
**Framework**: Three.js (TypeScript)

## Purpose

The Main 3D Viewport is the primary interactive 3D view occupying the center region of the DraftDown application window. It displays the 3D model scene with real-time WebGL rendering, allowing users to visualize and interact with their geometry. This component orchestrates the rendering pipeline, handles view state, manages visual overlays (grid, axes, guides, annotations), and translates user input into 3D spatial operations.

## Responsibilities

- Display the 3D scene geometry rendered via Three.js WebGL
- Maintain viewport-specific rendering state: render mode, projection type, background style, grid/axes visibility
- Manage viewport DOM element lifecycle and canvas integration with the WebGL renderer
- Coordinate raycasting for mouse picking to detect geometry under cursor for tool interaction
- Render visual overlays: ground plane grid, RGB axis indicators, inference guides, selection highlights, dimension annotations
- Handle viewport resize events and notify camera/renderer of dimension changes
- Switch between render modes: Wireframe, Hidden Line, Shaded, Textured, X-Ray
- Toggle between perspective and orthographic projection
- Provide viewport-to-world and screen-to-world coordinate transformation utilities
- Expose viewport state to UI controls and respond to user preference changes

## APIs Exposed

### Viewport Lifecycle

- Initialize viewport with DOM container element
- Dispose viewport and clean up Three.js resources
- Resize viewport to match container dimensions

### Render Control

- Set render mode: `wireframe | hiddenLine | shaded | textured | xray`
- Set projection type: `perspective | orthographic`
- Toggle grid visibility
- Toggle axes indicator visibility
- Set background style: `solid | gradient | sky`
- Request frame render (integrate with animation loop)

### Spatial Queries

- Raycast from screen coordinates (x, y in pixels) to 3D world space
- Get list of intersected geometry objects at screen position (sorted by distance)
- Convert screen position to world position (for ground plane intersection or picked face)
- Convert world position to screen position (for overlay rendering)

### Overlay Management

- Add/remove temporary guide lines (inference lines for drawing tools)
- Add/remove dimension annotations with world positions
- Highlight selected geometry (edges, faces, groups)
- Show/hide specific overlay layers

### State Access

- Get current camera view matrix and projection
- Get viewport dimensions (width, height in pixels)
- Get current render settings (mode, projection, overlay flags)

## APIs Consumed

### WebGL Renderer (`renderer.webgl`)

- Initialize renderer with viewport canvas
- Set renderer size on resize
- Configure render settings (antialiasing, shadows, tone mapping)
- Invoke render calls with scene and camera
- Access raycaster instance for picking

### Main Camera (`camera.main`)

- Get camera instance for rendering
- Update camera aspect ratio on resize
- Query camera position and orientation
- Apply camera transformations for projection switching

### Scene Manager (`data.scene`)

- Get Three.js scene object containing all renderable geometry
- Access scene graph for raycasting (objects to test against)
- Subscribe to scene change events to trigger re-render

### Model Document (`data.document`)

- Query current selection state (selected entities)
- Read geometry data for overlay rendering (edge positions, face normals)
- Access entity metadata for annotation rendering

## Data Flow

### Inputs

- **User Preferences**: Render mode, projection, grid/axes visibility, background style (read from UI state or settings)
- **Scene Geometry**: Three.js scene graph from Scene Manager containing meshes, lines, points
- **Selection State**: Currently selected entities from Model Document
- **Tool State**: Active tool may provide inference guides, temporary geometry, cursor hints
- **Container Element**: DOM element from Main Window where canvas is mounted

### Outputs

- **Rendered Frame**: WebGL canvas pixels displaying the 3D scene
- **Raycast Results**: Picked geometry entities at cursor position (sent to tools)
- **Viewport Events**: Resize, render complete (for performance monitoring)

### State Managed

- Current render mode (default: `shaded`)
- Current projection (default: `perspective`)
- Grid visible flag (default: `true`)
- Axes visible flag (default: `true`)
- Background style (default: `gradient`)
- Active overlay objects (guide lines, annotations, highlights)
- Last render timestamp (for frame rate monitoring)

## Visual Elements

### Ground Plane Grid

- Infinite grid in XZ plane at Y=0
- Primary grid lines every 1 meter, secondary every 0.1 meter
- Fades with distance from camera
- Color: neutral gray, adapts to background brightness

### RGB Axes Indicator

- Three perpendicular line segments at world origin
- X axis: red, Y axis: green, Z axis: blue
- Each axis 1 meter long with arrowhead
- Always visible regardless of camera position

### Inference Guides

- Temporary dotted lines showing axis locks, parallel constraints, extensions
- Rendered as dashed lines in contrasting color (cyan/magenta)
- Cleared each frame unless tool updates them

### Selection Highlights

- Selected edges rendered in bright blue/orange with increased line width
- Selected faces rendered with transparent blue overlay
- Bounding box wireframe for selected groups

### Dimension Annotations

- Text labels with distance values
- Leader lines connecting label to measured geometry
- Rendered as HTML overlay or canvas 2D context (on top of WebGL)

## Render Modes

### Wireframe

- Show all edges as thin lines
- No face fills
- Back-face edges visible

### Hidden Line

- Show edges with hidden lines dashed or lighter
- No face fills
- Back-face culling applied to edge rendering

### Shaded

- Fill faces with solid colors based on material diffuse color
- Apply directional lighting (sun light)
- Smooth or flat shading per face normal
- Show edges as thin dark lines overlaid on faces

### Textured

- Apply image textures to faces where assigned
- Full PBR material rendering (roughness, metalness)
- Show edges optionally

### X-Ray

- Render all faces semi-transparent
- Show internal geometry through outer surfaces
- Useful for verifying topology

## Projection Modes

### Perspective

- Realistic depth perspective with vanishing points
- FOV configurable via camera
- Objects shrink with distance

### Orthographic

- Parallel projection, no perspective distortion
- Consistent scale regardless of depth
- Common for technical drawings

## Interaction with Other Components

### Main Window (`window.main`)

- Viewport is mounted inside the main window's center content area
- Window provides DOM container element
- Window layout system controls viewport dimensions

### Main Renderer Process (`process.renderer`)

- Viewport runs in renderer process context
- Uses Electron IPC if needed for window-level commands
- Animation loop coordinated with process event loop

### Camera Controller (implied)

- User input handlers (mouse drag, scroll) manipulate camera via separate component
- Viewport reacts to camera changes by re-rendering

### Tool System (implied)

- Active tools query viewport for raycasts
- Tools may add temporary overlay geometry to viewport
- Viewport provides spatial context for tool operations

## Performance Requirements

- Maintain 60 FPS for scenes up to 100k triangles on target hardware (mid-range laptop GPU)
- Raycast picking must complete within 16ms to avoid blocking interaction
- Overlay rendering should not degrade scene render performance
- Support viewport dimensions up to 4K resolution (3840x2160)

## Security and Trust

- **Data Classification**: Low — viewport displays user-created geometry, no sensitive data
- **Trust Boundary**: Runs in renderer process, isolated from main process and file system
- **Threat Model**: Malicious geometry data could cause GPU crashes or memory exhaustion — rely on Scene Manager to validate geometry before adding to scene

## Testing Surface

### Visual Regression Tests (`test.visual.rendering`)

- Capture screenshots of viewport with known geometry at specific camera angles
- Compare against golden reference images
- Verify each render mode produces correct output
- Verify grid, axes, and overlay rendering

### Rendering Performance Tests (`test.perf.rendering`)

- Measure frame render time for scenes of varying complexity
- Measure raycast query time with different geometry densities
- Profile memory usage during viewport lifecycle
- Benchmark viewport resize and projection switching

## Constraints

- Must use Three.js for WebGL rendering (framework constraint)
- Must run entirely in renderer process (no main process OpenGL)
- Must support standard mouse raycast picking (no GPU-based picking required)
- Must integrate with existing Scene Manager's Three.js scene graph structure
- Must handle graceful degradation if WebGL context is lost
- Must support high-DPI displays with correct pixel ratio scaling

## Dependencies

- **Three.js library**: Core rendering engine, scene graph, raycaster, math utilities
- **WebGL Renderer**: Configured renderer instance with shadow mapping and antialiasing
- **Main Camera**: Camera instance with perspective or orthographic projection
- **Scene Manager**: Provides Three.js Scene object populated with geometry
- **Model Document**: Provides selection state and entity metadata

## Sub-Components

This component may internally manage:

- **GridHelper**: Three.js object or custom shader for ground plane grid
- **AxisHelper**: Three.js object representing RGB axes
- **OverlayLayer**: Separate Three.js scene or layer for guides and annotations
- **RenderModeController**: Logic to switch materials/shaders per render mode
- **RaycastManager**: Encapsulates raycasting logic with caching and filtering

These are internal implementation details and need not be separate archigraph nodes.

## Open Questions for Implementer

- Should overlay annotations be rendered as Three.js sprites, HTML elements, or canvas 2D?
- How to handle anti-aliasing quality trade-offs for performance?
- Should hidden line mode use custom shaders or post-processing edge detection?
- What caching strategy for raycasting when scene is static between frames?