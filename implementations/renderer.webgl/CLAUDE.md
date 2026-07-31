# WebGL Renderer

**Component ID**: `renderer.webgl`  
**UUID**: `uJZVdiUn`  
**Kind**: renderer  
**Layer**: rendering

## What This Component Is

The WebGL Renderer is the core rendering engine for DraftDown's 3D viewport. It manages the complete render loop, scene graph synchronization, and visual presentation of all 3D geometry. Built on Three.js, it translates the application's scene graph into optimized GPU draw calls and applies post-processing effects to achieve a polished CAD visualization.

This component is **performance-critical** and must maintain 60fps for models up to 500K faces and 30fps for models up to 2M faces.

## Responsibilities

- Initialize and manage Three.js WebGL renderer lifecycle
- Run the continuous render loop and respond to on-demand frame requests
- Synchronize the Three.js scene graph with the application's scene data structures
- Convert Half-Edge Mesh geometry into GPU-ready Three.js buffer geometries
- Apply materials, lighting, shadows, and post-processing effects
- Implement multiple render modes: wireframe, shaded, textured, rendered, x-ray
- Perform GPU-accelerated picking for entity selection
- Render overlays: grid, axes, inference guides, rubber-band previews, section planes
- Execute multi-pass render pipeline including depth pre-pass, main color pass, edge detection, selection highlights, SSAO, and overlay composition
- Manage instanced rendering for component instances sharing definitions
- Track and report rendering statistics: fps, frame time, draw calls, triangles, memory usage

## API Contract

### Initialization & Lifecycle

```typescript
initialize(canvas: HTMLCanvasElement, width: number, height: number): void
```
Set up WebGL context, create Three.js renderer, initialize post-processing pipeline, configure default lighting and materials.

```typescript
dispose(): void
```
Clean up GPU resources, stop render loop, release all Three.js objects.

```typescript
resize(width: number, height: number): void
```
Update viewport dimensions, resize render targets, update camera aspect ratios.

### Render Loop

```typescript
startRenderLoop(): void
```
Begin continuous rendering at display refresh rate. Must handle synchronization with scene data updates.

```typescript
stopRenderLoop(): void
```
Pause rendering to conserve resources when viewport is not visible.

```typescript
requestFrame(): void
```
Force a single frame render outside the continuous loop, used for responsive updates.

```typescript
render(camera: Camera, overlay: RenderOverlay): void
```
Execute one complete render cycle with provided camera state and overlay data.

### Scene Synchronization

```typescript
syncScene(sceneManager: ISceneManager): void
```
Rebuild entire Three.js scene graph from application scene manager. Used for major scene changes or initial load.

```typescript
syncMesh(meshId: string, mesh: HalfEdgeMesh): void
```
Update or create Three.js geometry for a single mesh. Must check Half-Edge Mesh dirty flags and only update changed buffers.

```typescript
syncMaterial(material: Material): void
```
Update Three.js material properties from application material data. Must check material dirty flags.

```typescript
syncSelection(selectionManager: ISelectionManager): void
```
Update selection highlights based on currently selected entities.

### Render Mode

```typescript
setRenderMode(mode: RenderMode): void
getRenderMode(): RenderMode
```
Switch between visualization modes: `'wireframe' | 'shaded' | 'textured' | 'rendered' | 'xray'`.

### GPU Picking

```typescript
pick(screenX: number, screenY: number): PickResult | null
```
Perform GPU-accelerated ray intersection test at screen coordinates. Must return entity ID, type, world-space intersection point, normal, and distance.

```typescript
pickRect(x1: number, y1: number, x2: number, y2: number): PickResult[]
```
Perform rectangular selection using GPU picking. Returns all entities intersecting the screen-space rectangle.

### Statistics

```typescript
getStats(): RenderStats
```
Return current performance metrics: fps, frame time (ms), draw calls, triangle count, geometry memory (bytes), texture memory (bytes).

### Configuration

```typescript
setShadowsEnabled(enabled: boolean): void
setAntialiasing(mode: 'none' | 'FXAA' | 'MSAA' | 'SMAA'): void
setBackgroundMode(mode: 'solid' | 'gradient' | 'environment'): void
setEdgeRendering(enabled: boolean, color?: string, width?: number): void
```
Configure visual quality and presentation options.

## Data Structures

### RenderOverlay
Describes transient visual elements overlaid on the 3D scene:
- `inferenceGuides: InferenceGuide[]` — Inference geometry from `geometry.inference` component
- `selectionHighlights: string[]` — Entity IDs requiring selection highlight
- `preselectionHighlight: string | null` — Entity ID for hover preview
- `rubberBandGeometry: THREE.BufferGeometry | null` — Tool preview lines during active operations
- `gridVisible: boolean`, `axesVisible: boolean` — Viewport display options
- `sectionPlanes: SectionPlaneData[]` — Active section plane definitions

### PickResult
Return type for picking operations:
- `entityId: string` — Unique ID of picked entity
- `entityType: 'vertex' | 'edge' | 'face' | 'group' | 'component_instance'`
- `point: THREE.Vector3` — World-space intersection point
- `normal: THREE.Vector3` — Surface normal at intersection
- `distance: number` — Camera distance
- `faceId?: string`, `edgeId?: string`, `vertexId?: string` — Sub-entity identifiers

## Render Pipeline

Each frame executes this sequence:

1. **Sync Phase**: Check dirty flags on Half-Edge Meshes and Materials, update only changed GPU buffers
2. **Depth Pre-pass**: Render depth-only for SSAO computation
3. **Main Color Pass**: Render all geometry with PBR materials (shader `shader.pbr`)
4. **Edge/Outline Pass**: Apply Sobel edge detection (shader `shader.outline`)
5. **Selection Highlight Pass**: Stencil-based selection glow (shader `shader.selection`)
6. **SSAO Pass**: Screen-space ambient occlusion
7. **Overlay Pass**: Grid, axes, inference guides, rubber-band lines, dimensions
8. **Present**: Composite to canvas

## Performance Optimizations

### Instanced Rendering
Component instances sharing the same definition must use `THREE.InstancedMesh`. All instances render in one draw call with per-instance transform matrices.

### Required Optimizations
- **Frustum culling**: Skip objects outside camera view
- **LOD (Level of Detail)**: Reduce geometry complexity for distant objects
- **Batched geometry**: Merge static geometry to reduce draw calls
- **GPU picking**: Use render-to-texture with color-coded IDs instead of CPU ray casting
- **Dirty flag checking**: Only update GPU buffers when Half-Edge Mesh or Material flags indicate changes

## Dependencies

### Data Consumed
- **Camera** (`../rendering/camera`): View matrix, projection matrix, position, direction
- **ISceneManager** (`../data/scene`): Scene graph with Groups and ComponentInstances
- **HalfEdgeMesh** (`mesh.halfedge`): Topology and vertex data with dirty flags
- **Material** (`../data/materials`): Material properties with dirty flags
- **ISelectionManager** (`../data/selection`): Currently selected entity IDs
- **InferenceGuide** (`../geometry/inference`): Temporary inference geometry

### Rendering Target
- **Main 3D Viewport** (`viewport.main`): Renders to this viewport's canvas element

### Shaders Used
- **PBR Material Shader** (`shader.pbr`): Main material rendering
- **Edge Outline Shader** (`shader.outline`): Edge detection and outline rendering
- **Selection Highlight Shader** (`shader.selection`): Selection glow effect
- **X-Ray Shader** (`shader.xray`): Transparent x-ray visualization mode

### External Library
- **Three.js** (`lib.threejs`): Core rendering library and scene graph

## Geometry Rendering

### Half-Edge Mesh
Must convert `HalfEdgeMesh` topology into `THREE.BufferGeometry`:
- Extract vertex positions, normals, UVs from Half-Edge structure
- Generate index buffer for face triangulation
- Handle n-gons by triangulating faces
- Update only changed attributes when dirty flags indicate modifications
- Maintain mapping between Half-Edge entity IDs and Three.js geometry for picking

### Curves
Must render `curve.polyline` and `curve.arc` as line geometry:
- Sample arcs into line segments for rendering
- Apply line width and style
- Support different line rendering modes (solid, dashed, hidden)

## Visual Quality

### Antialiasing
Default to MSAA. Must support fallback to FXAA or SMAA if MSAA unavailable.

### Shadows
Configurable shadow mapping for directional lights. Must balance quality and performance.

### Post-Processing Effects
- **SSAO (Screen-Space Ambient Occlusion)**: Subtle geometric detail enhancement
- **Edge Detection**: Sobel-based edge highlighting with configurable color and width
- **Selection Highlight**: Volumetric glow around selected entities

## Memory Management

Must track and report:
- Geometry memory: Sum of all vertex buffers, index buffers
- Texture memory: Sum of all loaded textures including shadow maps and render targets

Must dispose of Three.js objects when entities are deleted from scene to prevent memory leaks.

## Multi-Pass Rendering

Some render modes require multiple passes:
- **X-ray mode**: Render transparent geometry with depth testing modifications
- **Wireframe mode**: Render edges only, optionally with hidden line removal
- **Section planes**: Clip geometry against planes, optionally render section fill

## Contained Components

This component must implement:
- **Render loop manager**: Handles requestAnimationFrame and frame timing
- **Scene graph synchronizer**: Translates ISceneManager to Three.js scene
- **Material compiler**: Converts Material data to Three.js materials
- **GPU picker**: Implements render-to-texture picking with ID encoding
- **Post-processing compositor**: Manages EffectComposer and render pass stack
- **Overlay renderer**: Draws grid, axes, guides using line geometry
- **Statistics collector**: Tracks and aggregates performance metrics

## Security & Trust

No external network access required. All rendering executes locally in Electron renderer process.

GPU resources are untrusted — must handle WebGL context loss gracefully and re-initialize.

## Testing Requirements

### UI E2E Tests (`test.e2e.ui`)
Must test:
- Render loop starts and stops correctly
- Scene changes trigger appropriate re-renders
- Picking returns correct entity IDs and coordinates

### Visual Regression Tests (`test.visual.rendering`)
Must verify:
- Render output matches reference images for each render mode
- Selection highlights render correctly
- Edge rendering produces consistent results
- Post-processing effects apply correctly

### Rendering Performance Tests (`test.perf.rendering`)
Must measure:
- Frame rate under various scene complexities
- Memory usage growth over time
- Draw call count optimization effectiveness
- Picking performance for large scenes

## Integration Points

- **Main 3D Viewport** (`viewport.main`): Provides canvas element, viewport dimensions, camera state, and overlay data
- **Main Renderer Process** (`process.renderer`): Hosts this component in Electron renderer process
- Responds to scene manager data changes
- Responds to material manager updates
- Responds to selection manager changes

## Language & Framework

- **Language**: TypeScript
- **Framework**: Three.js
- **Complexity**: Very complex due to multi-pass rendering, instancing, GPU picking, and performance optimization requirements