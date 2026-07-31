# DraftDown

### [Try DraftDown in your browser at draftdownapp.com](https://draftdownapp.com)
### [View the interactive architecture diagram →](https://archigraph.ai/viewer?archigraph=https://raw.githubusercontent.com/CacheFactory/DraftDown/main/archigraph.yaml&schema=https://raw.githubusercontent.com/CacheFactory/DraftDown/main/schema.yaml)

A free, open-source 3D modeling application inspired by DraftDown, built with Electron + React + Three.js. Draw 2D shapes, push/pull them into 3D solids, and build architectural models with an intuitive click-based workflow. Available as a desktop app (macOS, Windows, Linux) and a web app.

![Electron](https://img.shields.io/badge/Electron-28-blue) ![Three.js](https://img.shields.io/badge/Three.js-0.162-green) ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue) ![React](https://img.shields.io/badge/React-18-blue)



https://github.com/user-attachments/assets/daa8530d-d3b9-4830-90af-bb2e815e5ce2

## Download

**macOS** (signed and notarized):

- **[Apple Silicon (M1/M2/M3/M4)](https://archigraph-releases-prod.s3.us-east-1.amazonaws.com/draftdown/DraftDown-1.0.0-arm64.dmg)** — 96 MB
- **[Intel Mac](https://archigraph-releases-prod.s3.us-east-1.amazonaws.com/draftdown/DraftDown-1.0.0.dmg)** — 102 MB

**Windows**:

- **[Windows x64 Installer](https://archigraph-releases-prod.s3.us-east-1.amazonaws.com/draftdown/DraftDown%20Setup%201.0.0.exe)** — 92 MB

**Linux**:

- **[Linux x64 AppImage](https://archigraph-releases-prod.s3.us-east-1.amazonaws.com/draftdown/DraftDown-1.0.0.AppImage)** — 128 MB

## Features

- **Push/Pull modeling** — extrude 2D faces into 3D solids, or move 3D faces to resize
- **Drawing tools** — Line, Rectangle, Circle, Arc, Polygon with live previews
- **Modify tools** — Move, Rotate, Scale, Offset, Eraser with real-time feedback
- **Axis locking** — arrow keys lock line drawing to X/Y/Z axis for precision
- **Snap system** — automatic vertex/midpoint/on-edge snapping with visual indicators
- **Auto-face creation** — closed edge loops automatically become faces
- **Face splitting** — draw a line across a face to split it, including lines starting/ending on edges
- **Custom axes** — click a face to reorient drawing axes; all tools respect the custom orientation
- **AI chat** — natural language modeling assistant that drives the same native extension API exposed to plugins
- **Extensions** — JavaScript plugins with a near-1:1 mirror of the [DraftDown Ruby API]() (DraftDown, Geom, UI), live REPL, and an Extension Manager (see [Extensions](#extensions))
- **Selection** — click, shift-click, or drag-box to select faces and edges
- **Undo/Redo** — delta-based undo history (records only what changed, instant for large models)
- **Components** — group geometry into protected reusable components
- **Layers** — organize geometry with visibility and locking
- **Drawing planes** — arrow keys switch shape tool planes (ground, vertical walls)
- **OBJ file I/O** — save and open standard OBJ files
- **Middle-mouse orbit** — orbit/pan without switching tools, zoom to cursor
- **Infinite grid** — shader-based ground grid that extends to infinity

## Quick Start

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Run the application
npx electron dist/main/main.js

# Run E2E tests (Playwright, real Electron, no mocks)
npx playwright test
```

## Keyboard Shortcuts

| Key | Tool | | Key | Action |
|-----|------|-|-----|--------|
| `Space` | Select | | `Cmd+Z` | Undo |
| `L` | Line | | `Cmd+Shift+Z` | Redo |
| `R` | Rectangle | | `Cmd+S` | Save |
| `C` | Circle | | `Cmd+O` | Open |
| `A` | Arc | | `Cmd+N` | New |
| `G` | Polygon | | `Delete` | Delete selected |
| `P` | Push/Pull | | `Escape` | Cancel / Clear selection |
| `M` | Move | | `Arrow Up` | Lock to Y axis (vertical) |
| `Q` | Rotate | | `Arrow Right` | Lock to X axis (red) |
| `S` | Scale | | `Arrow Left` | Lock to Z axis (blue) |
| `F` | Offset | | `Arrow Down` | Unlock axis / reset plane |
| `E` | Eraser | | Middle Mouse | Orbit |
| `B` | Paint | | Shift+Middle Mouse | Pan |
| `O` | Orbit | | Scroll Wheel | Zoom to cursor |
| `H` | Pan | | | |
| `Z` | Zoom | | | |
| `T` | Tape Measure | | | |
| `D` | Dimension | | | |
| `Shift+A` | Axes | | | |

## Architecture

DraftDown uses an **ArchiGraph** — a machine-readable architecture graph (126 nodes, 559 edges) that maps every component, service, and relationship in the system.

### [View the interactive architecture diagram →](https://archigraph.ai/viewer?archigraph=https://raw.githubusercontent.com/CacheFactory/DraftDown/main/archigraph.yaml&schema=https://raw.githubusercontent.com/CacheFactory/DraftDown/main/schema.yaml)

The ArchiGraph is the fastest way for new contributors (human or AI) to understand the codebase. Each node has a `docs.description` explaining what it does and an `impl.status` showing its current state:

| Status | Count | Meaning |
|--------|-------|---------|
| `implemented` | 89 | Fully working |
| `basic` | 19 | Code exists, simplified or partial |
| `placeholder` | 5 | Tool exists but not functional |
| `spec-only` | 10 | Requirements doc only, no code |
| `stub` | 5 | Depends on missing WASM packages |

### Project Structure

Each archigraph node has its own folder under `implementations/` containing both the architecture spec and the source code:

```
src/
├── core/                      # Shared types, interfaces, math (used by all)
│   ├── types.ts               # Vec3, Color, EntityType, RenderMode
│   ├── interfaces.ts          # ITool, IGeometryEngine, IViewport
│   ├── math.ts                # vec3, ray, bbox utilities
│   └── events.ts              # SimpleEventEmitter
└── renderer/
    ├── index.tsx              # Webpack entry point
    └── index.html             # HTML template

implementations/
├── process.main/              # Electron main process
│   ├── CLAUDE.md              # Architecture spec
│   ├── main.ts                # Window, IPC, menus, file dialogs
│   └── preload.ts             # contextBridge API
├── process.renderer/          # Application orchestrator
│   ├── CLAUDE.md
│   └── Application.ts         # Bootstraps all subsystems
├── window.main/               # Main window UI
│   ├── CLAUDE.md
│   ├── App.tsx                # Root component + keyboard handler
│   ├── AppContext.tsx          # React context
│   ├── MainToolbar.tsx        # File ops, undo/redo
│   ├── DrawingToolbar.tsx     # Tool sidebar
│   ├── EntityInfoPanel.tsx    # Selection info + component buttons
│   ├── LayersPanel.tsx        # Layer management
│   └── ... (more UI components)
├── engine.geometry/           # B-Rep geometry kernel
│   ├── CLAUDE.md
│   └── GeometryEngine.ts     # Create/delete/query, auto-face, face splitting
├── mesh.halfedge/             # Half-edge data structure
│   ├── CLAUDE.md
│   └── HalfEdgeMesh.ts
├── renderer.webgl/            # Three.js rendering
│   ├── CLAUDE.md
│   ├── WebGLRenderer.ts       # Render loop, lighting, highlights
│   └── SceneBridge.ts         # Geometry↔Three.js sync, snap system
├── camera.main/               # Camera controller
│   ├── CLAUDE.md
│   └── CameraController.ts   # Orbit, pan, zoom, standard views
├── viewport.main/             # Viewport + raycasting
│   ├── CLAUDE.md
│   ├── Viewport.ts            # Canvas, raycast, coordinates
│   └── ViewportCanvas.tsx     # React wrapper, mouse events
├── tool.line/                 # Line tool
│   ├── CLAUDE.md
│   └── lineTool.ts            # Axis locking, auto-face, midpoint snap
├── tool.pushpull/             # Push/Pull tool
│   ├── CLAUDE.md
│   └── PushPullTool.ts        # Face extrusion with preview
├── tool.select/               # Select tool + shared tool infrastructure
│   ├── CLAUDE.md
│   ├── selectTool.ts          # Click, shift-click, drag-box, cursor
│   ├── BaseTool.ts            # Abstract base for all tools
│   └── ToolManager.ts         # Tool registry
├── data.scene/                # Scene manager
│   ├── CLAUDE.md
│   └── SceneManager.ts        # Layers, components, entities
├── data.history/              # Undo/redo
│   ├── CLAUDE.md
│   ├── HistoryManager.ts      # Delta-based undo/redo
│   ├── DeltaRecorder.ts       # Delta types and entity clone helpers
│   └── TrackedMap.ts          # Map subclass that captures mutations
├── ... (60+ more node folders)

tests/
└── e2e-playwright/            # Real Electron E2E tests (no mocks)
```

### How to use the ArchiGraph

**"How does X work?"** → Search `archigraph.yaml` for the node ID, read `docs.description`, follow edges.

**"Where is X implemented?"** → Look in `implementations/<node-id>/` — spec and code are side by side.

**"What needs work?"** → Search for `impl.status: placeholder` or `impl.status: stub` in `archigraph.yaml`.

### Key Node-to-Folder Mapping

| Node ID | Folder | What it does |
|---------|--------|-------------|
| `process.main` | `implementations/process.main/` | Electron main process |
| `process.renderer` | `implementations/process.renderer/` | Application orchestrator |
| `window.main` | `implementations/window.main/` | All UI components |
| `engine.geometry` | `implementations/engine.geometry/` | B-Rep geometry kernel |
| `mesh.halfedge` | `implementations/mesh.halfedge/` | Half-edge mesh data structure |
| `renderer.webgl` | `implementations/renderer.webgl/` | Three.js renderer + SceneBridge |
| `camera.main` | `implementations/camera.main/` | Camera controller |
| `viewport.main` | `implementations/viewport.main/` | Viewport + raycasting |
| `data.scene` | `implementations/data.scene/` | Layers, components |
| `data.history` | `implementations/data.history/` | Delta-based undo/redo |
| `tool.*` | `implementations/tool.*/` | One folder per tool |

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│  Electron Main Process (implementations/process.main/)  │
│  ├── Window management, IPC, native file dialogs        │
│  └── Preload script (contextBridge)                     │
└──────────────────────┬──────────────────────────────────┘
                       │ IPC
┌──────────────────────▼──────────────────────────────────┐
│  Renderer Process                                       │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐      │
│  │  React UI   │  │  Application │  │  Three.js  │      │
│  │  window.    │◄─┤  process.    ├─►│  renderer. │      │
│  │  main/      │  │  renderer/   │  │  webgl/    │      │
│  └─────────────┘  └──────┬───────┘  └───────────┘      │
│           ┌───────────────┼───────────────┐             │
│  ┌────────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐     │
│  │  SceneBridge  │ │ ToolManager │ │  Inference   │     │
│  │  renderer.    │ │  tool.      │ │  engine.     │     │
│  │  webgl/       │ │  select/    │ │  inference/  │     │
│  └────────┬──────┘ └──────┬──────┘ └─────────────┘     │
│           │               │                             │
│  ┌────────▼───────────────▼────────────────────────┐    │
│  │  Data Layer                                     │    │
│  │  ├── data.document/  (owns everything below)    │    │
│  │  ├── engine.geometry/ (B-Rep half-edge mesh)    │    │
│  │  ├── data.scene/     (layers, components)       │    │
│  │  ├── data.selection/                            │    │
│  │  ├── data.history/   (delta-based undo/redo)    │    │
│  │  └── data.materials/                            │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
Mouse Event → ViewportCanvas.getToolEvent()
  ├── Raycast (Viewport.raycastScene)
  │   ├── Filter hidden/locked layers
  │   ├── Resolve component IDs
  │   └── Prioritize faces over edges
  ├── Snap detection (SceneBridge.findSnapPoint)
  └── Tool.onMouseDown/Move/Up(event)
        ├── Modify geometry (GeometryEngine)
        ├── app.syncScene() → SceneBridge.sync()
        │   ├── Create/update/remove Three.js objects
        │   └── Update component bounding boxes
        └── app.syncSelection() → highlight + UI update
```

## Key Design Decisions

These are the non-obvious decisions discovered during implementation. Read these before contributing:

### Keyboard Events
ALL keyboard events go through a single `window` listener in `App.tsx`. No `onKeyDown` on the viewport container (prevents double-firing). Electron menu items have NO accelerators.

### Edge Rendering
Edge lines are in the **overlay scene**, rendered in a separate pass after depth clear. Edge materials are shared and NEVER swapped by the highlight system.

### Raycasting
Camera `projectionMatrixInverse` is explicitly recomputed before every raycast. Line threshold is 0.05. Faces returned before edges. Preview/snap objects use `raycast = () => {}`.

### Undo/Redo
Delta-based using TrackedMap instrumentation on mesh entity maps. Each transaction records only add/delete/modify deltas (~KB) instead of full mesh snapshots (~57MB). TrackedMap overrides get/set/delete and all iteration methods (forEach, entries, values, Symbol.iterator) to capture before-snapshots. Move/rotate/scale tools use `snapshotVertices()` for direct position mutations. `newDocument()` re-wires `setTrackedSources()` since `deserialize()` replaces the internal mesh. Line tool commits on deactivate.

### Face Splitting
`splitFaceWithPath()` handles arc endpoints ON face edges (not just corners) via proximity detection and vertex insertion. Both resulting faces include arc vertices on their shared boundary (no chord edge).

### Axis Locking (Line Tool)
Arrow keys lock to axis: Up=Y (vertical), Right=X, Left=Z. Uses ray-to-line projection for accurate 3D positioning from any camera angle. Lock resets after placing each point. All axis locking respects custom axes set via the Axes tool.

### On-Edge Snapping
Drawing tools snap to nearby edges (not just vertices/midpoints). Uses ray-segment closest point computation. Red snap marker distinguishes on-edge snaps from green endpoint snaps. When a vertex is placed on an edge, the edge is automatically split.

## Extensions

DraftDown is extensible via JavaScript plugins. The plugin API is a near-1:1 mirror of the
[DraftDown Ruby API]() — most existing DraftDown Ruby extensions can be
ported by mechanically translating Ruby to JavaScript (snake_case → camelCase, `do…end` → `() => {…}`,
`Geom::Point3d.new` → `new Geom.Point3d`).

### Using extensions (end-users)

A **Plugins** dropdown sits in the top-right of the window. From it you can:

- **Extension Manager…** — install / enable / disable plugins (pick a `.js` file).
- **Console** — a live REPL that evaluates JavaScript against the same API plugins use. Useful for trying
  one-liners (`DraftDown.activeModel.entities.addLine(new Geom.Point3d(0,0,0), new Geom.Point3d(1,0,0))`).
- Items registered by enabled plugins.

Installed plugins persist in `localStorage` and reload on next launch.

### Authoring a plugin

A plugin is a single JavaScript file that registers a `DraftDownExtension`. The runtime auto-runs the file
inside a scope where `DraftDown`, `Geom`, `UI`, `Length`, and `console` are in scope.

```js
(function () {
  const ext = {
    id: 'com.example.my-plugin',     // reverse-domain id, required
    name: 'My Plugin',
    version: '1.0.0',
    creator: 'Your Name',
    description: 'Does something useful.',

    onLoad() {
      UI.menu('Plugins').addItem('Run It', () => {
        const m = DraftDown.activeModel;
        m.startOperation('Run It', true);
        const face = m.entities.addFace(
          new Geom.Point3d(0, 0, 0),
          new Geom.Point3d(1, 0, 0),
          new Geom.Point3d(1, 0, 1),
          new Geom.Point3d(0, 0, 1),
        );
        face.pushpull(1);
        m.commitOperation();
      });
    },

    onUnload() { /* cleanup; menu items are removed automatically */ },
  };

  DraftDown.registerExtension(ext, true);  // true = load immediately
})();
```

A complete worked example lives in [`examples/plugins/com.draftdown.sample-box/`](examples/plugins/com.draftdown.sample-box/sample-box.js)
with the equivalent DraftDown Ruby in a comment for reference. See [`examples/plugins/README.md`](examples/plugins/README.md)
for the full Ruby ↔ JS porting table.

### Ruby ↔ JS porting cheatsheet

| DraftDown Ruby                              | DraftDown JS                                  |
| ------------------------------------------ | --------------------------------------------- |
| `DraftDown.active_model`                    | `DraftDown.activeModel`                        |
| `model.start_operation("X", true)`         | `model.startOperation("X", true)`             |
| `model.commit_operation`                   | `model.commitOperation()`                     |
| `model.entities.add_face(*pts)`            | `model.entities.addFace(...pts)`              |
| `face.pushpull(distance)`                  | `face.pushpull(distance)`                     |
| `Geom::Point3d.new(x, y, z)`               | `new Geom.Point3d(x, y, z)`                   |
| `Geom::Vector3d.new(x, y, z)`              | `new Geom.Vector3d(x, y, z)`                  |
| `Geom::Transformation.translation(p)`      | `Geom.Transformation.translation(p)`          |
| `UI.menu("Plugins").add_item("Foo") { … }` | `UI.menu("Plugins").addItem("Foo", () => …)`  |
| `UI.messagebox("hi")`                      | `UI.messagebox("hi")`                         |
| `UI.inputbox(prompts, defaults, [], …)`    | `UI.inputbox(prompts, defaults, [], …)`       |
| `DraftDown.register_extension(ext, true)`   | `DraftDown.registerExtension(ext, true)`       |

### API surface

The full façade is implemented under [`implementations/plugin.system/draftdown/`](implementations/plugin.system/draftdown/).
This is the surface available to every plugin and to the AI chat (which calls the same API via its
`execute_script` tool).

#### `DraftDown` — the top-level module ([Ruby ref]())

```js
DraftDown.activeModel                                  // → Model
DraftDown.version                                      // string
DraftDown.apiVersion                                   // "1.0"
DraftDown.registerExtension(ext, loadOnStart=false)    // returns boolean
DraftDown.loadExtension(id) / unloadExtension(id)
DraftDown.extensionList()                              // [{ ext, loaded }]
DraftDown.isExtensionEnabled(id)
DraftDown.addObserver(observer)         removeObserver(observer)
DraftDown.addModelObserver(observer)    removeModelObserver(observer)
DraftDown.addSelectionObserver(observer) removeSelectionObserver(observer)
DraftDown.sendAction("viewZoomExtents:" | "viewFront:" | "selectAll:" | "editUndo:" | …)
DraftDown.findSupportFile(name, dir?)
DraftDown.statusText = "…"
```

#### `DraftDown.Model` ([Ruby ref]())

```js
const m = DraftDown.activeModel;
m.title       m.path        m.description       m.modified()
m.bounds                                  // Geom.BoundingBox
m.entities    m.selection   m.materials   m.layers
m.activeView.zoomExtents()    m.activeView.refresh()
m.activeView.camera                       // { eye: Point3d, target: Point3d, up }
m.startOperation(name, disableUI=true, …) m.commitOperation() m.abortOperation()
m.api_                                    // escape hatch to ModelAPI (see below)
```

#### `DraftDown.Entities` ([Ruby ref]())

```js
m.entities.length / .count / .size
m.entities.each(fn) / .toArray() / .at(i) / .byId(id)
m.entities.addLine(p1, p2)                            // → Edge
m.entities.addLine([p1, p2, p3, …])                   // → [Edge]
m.entities.addEdges(...points)                        // → [Edge]
m.entities.addFace(p1, p2, p3, ...)                   // → Face   (3+ points; auto-creates edges)
m.entities.addCircle(center, normal, radius, numsegs=24)
m.entities.addNgon(center, normal, radius, numsides)
m.entities.addArc(center, xaxis, normal, radius, startAng, endAng, numsegs=12)
m.entities.addCurve(...points)
m.entities.addGroup(...entities)                      // → Group
m.entities.addInstance(definition, transformation)    // → ComponentInstance
m.entities.eraseEntities([entities])
m.entities.transformEntities(transformation, [entities])
```

#### `DraftDown.Face` ([Ruby ref]())

```js
face.id / face.area / face.normal                  // Vector3d
face.vertices / face.edges                         // [Vertex] / [Edge]
face.material = mat | id     face.backMaterial = mat | id
face.pushpull(distance, copy=false)                // extrude
face.reverseInPlace()
face.plane                                         // [a, b, c, d]
face.classifyPoint(point)                          // 1=inside, 4=on edge, 8=outside, 16=offplane
face.outerLoop().vertices()
face.eraseInPlace() / face.erase() / face.valid()  // base Entity
```

#### `DraftDown.Edge` ([Ruby ref]())

```js
edge.id / edge.length
edge.start / edge.end / edge.vertices              // [Vertex, Vertex]
edge.line                                          // [Point3d, Vector3d]
edge.faces / edge.commonFace(other)
edge.otherVertex(vertex)
edge.smooth / edge.soft / edge.hidden              // boolean, settable
edge.usedBy(entity)
```

#### `DraftDown.Vertex` ([Ruby ref]())

```js
vertex.id
vertex.position                                    // Point3d (returns a copy)
vertex.position = new Geom.Point3d(...)            // moves vertex
vertex.edges / vertex.faces
vertex.commonEdge(other) / vertex.usedBy(entity)
```

#### `DraftDown.Group` / `ComponentInstance` / `ComponentDefinition`

```js
// Group ([Ruby ref]())
group.name                                         // settable
group.entities                                     // nested Entities collection
group.transformation / group.transformInPlace(t)
group.explode()                                    // dissolve into loose entities
group.definition                                   // ComponentDefinition | null

// ComponentInstance ([Ruby ref]())
instance.name / instance.definition
instance.transformation                            // settable
instance.explode()

// ComponentDefinition ([Ruby ref]())
definition.name / definition.description           // settable
definition.count
definition.instances()                             // [ComponentInstance]
```

#### `DraftDown.Selection` ([Ruby ref]())

```js
m.selection.length / .count / .size / .empty
m.selection.add(...entities) / .remove(...) / .toggle(...) / .clear()
m.selection.contains(entity)
m.selection.toArray() / .each(fn) / .first()
m.selection.invert()
m.selection.singleObject()
m.selection.faces() / .edges() / .vertices()       // type-filtered helpers
```

#### `DraftDown.Materials` / `DraftDown.Material`

```js
m.materials.length / .each(fn) / .at(nameOrIndex)
m.materials.add(name, color)                       // → Material
m.materials.current                                // most-recently-added
material.name                                      // settable
material.color = new Color3("#cc8844")             // also accepts Color3 / { r,g,b }
material.alpha                                     // 0..1, settable
material.texture                                   // path | null
new Color3("#RRGGBB") / new Color3(r, g, b, a=255)
```

#### `DraftDown.Layers` / `DraftDown.Layer` (also called Tags)

```js
m.layers.length / .each(fn) / .at(nameOrIndex)
m.layers.add(name)                                 // → Layer
m.layers.remove(layer | id)
layer.name / layer.visible / layer.color           // all settable
layer.isVisible()
```

#### `Geom` ([Ruby ref]())

```js
// Point3d
new Geom.Point3d(x, y, z)
p.distance(other) / p.vectorTo(other) / p.offset(vector, length?)
p.transform(t) / p.transformInPlace(t) / p.toA() / p.toString()

// Vector3d
new Geom.Vector3d(x, y, z)
v.length / v.isValid() / v.normalize() / v.reverse()
v.add(o) / v.plus(o) / v.subtract(o) / v.multiply(s)
v.dot(o) / v.cross(o) / v.parallel(o) / v.perpendicular(o)
v.angleBetween(o)        // radians
v.transform(t)

// Transformation
Geom.Transformation.identity()
Geom.Transformation.translation(point)
Geom.Transformation.scaling(sx, sy?, sz?)
Geom.Transformation.rotation(point, axis, angleRadians)
Geom.Transformation.axes(origin, xAxis, yAxis, zAxis)
t.multiply(other) / t.apply(point)
t.origin / t.xaxis / t.yaxis / t.zaxis / t.toA()

// BoundingBox
const bb = new Geom.BoundingBox();
bb.add(point)
bb.center / bb.width / bb.height / bb.depth / bb.diagonal / bb.empty()

// Module helpers
Geom.linearCombination(w1, p1, w2, p2)             // → Point3d
Geom.fitPlaneToPoints([p1, p2, p3, …])             // → [a, b, c, d]
```

#### `UI` ([Ruby ref]())

```js
// Menus & toolbars
UI.menu("Plugins").addItem("Label", () => { … })
UI.menu("Plugins").addSubmenu("More")
UI.menu("Plugins").addSeparator()
UI.toolbar("My Toolbar").addItem({ name, tooltip, smallIcon, handler })

// Dialogs
UI.messagebox(msg, type=UI.MB_OK)                  // returns IDOK / IDCANCEL / IDYES / IDNO
UI.inputbox(prompts, defaults, listOptions, title) // → string[] | false
UI.beep()
UI.notification(extension, message).show()
await UI.openpanel(title, dir, "*.obj")            // → string | null
await UI.savepanel(title, dir, "default.obj")

// HtmlDialog
const dlg = UI.htmlDialog({ dialogTitle, width, height, scrollable, resizable });
dlg.setHtml(htmlString) / dlg.setUrl(url)
dlg.addActionCallback("name", (dlg, ...args) => { … })
dlg.show() / dlg.close() / dlg.executeScript(js) / dlg.setSize(w, h)

// Constants
UI.MB_OK / UI.MB_OKCANCEL / UI.MB_YESNO / UI.MB_YESNOCANCEL
UI.IDOK / UI.IDCANCEL / UI.IDYES / UI.IDNO / UI.IDABORT / UI.IDRETRY / UI.IDIGNORE
```

#### Escape hatch — `m.api_` (DraftDown's high-level ModelAPI)

For bulk / compound operations beyond what raw entity methods cover:

```js
m.api_.createBox(origin, w, d, h)
m.api_.createCylinder(center, r, h, segs?)
m.api_.createSphere(center, r, rings?, segs?)
m.api_.createWall(start, end, h, thickness)
m.api_.cutOpening(faceId, w, h, ox?, oy?)
m.api_.arrayLinear(ids, dir, count, spacing)
m.api_.arrayRadial(ids, center, axis, count)
m.api_.mirrorEntities(ids, planePoint, planeNormal)
m.api_.createRoof(faceId, pitchDeg, overhang?)
m.api_.createStairs(start, dir, rise, tread, width, steps)
m.api_.chamferEdge(edgeId, dist)
m.api_.filletEdge(edgeId, r, segs?)
m.api_.offsetFace(faceId, dist) / .insetFace(faceId, dist)
m.api_.subdivideFaces([faceIds], "midpoint" | "catmull-clark", iterations?)
m.api_.triangulateFaces([faceIds])
m.api_.sweep(profileFaceId, [pathEdgeIds], alignToPath?)
await m.api_.booleanUnion([idsA], [idsB])
await m.api_.booleanSubtract([idsA], [idsB])
await m.api_.booleanIntersect([idsA], [idsB])
m.api_.setSectionPlane(point, normal) / .clearSectionPlane()
```

### Parameters panel (right rail, under Entity Info)

DraftDown adds a parameters panel to the right rail (under Entity Info). Tools and plugins
can ask the user for input there using `UI.parameters.*` — useful for tool-specific
settings without opening a modal dialog.

```js
UI.parameters.show({
  id: 'com.example.my-tool',
  title: 'My Tool',
  fields: [
    { kind: 'header',  text: 'Geometry' },
    { kind: 'number',  key: 'width',  label: 'Width',  default: 1, min: 0, unit: 'm' },
    { kind: 'integer', key: 'sides',  label: 'Sides',  default: 6, min: 3 },
    { kind: 'slider',  key: 'angle',  label: 'Angle',  min: 0, max: 360, default: 30, unit: '°' },
    { kind: 'separator' },
    { kind: 'header',  text: 'Style' },
    { kind: 'select',  key: 'mode',   label: 'Mode',
      options: [{ label: 'Solid', value: 'solid' }, { label: 'Wire', value: 'wire' }] },
    { kind: 'color',   key: 'color',  label: 'Colour', default: '#cc8844' },
    { kind: 'vec3',    key: 'origin', label: 'Origin', default: { x: 0, y: 0, z: 0 } },
    { kind: 'boolean', key: 'lock',   label: 'Lock to axis', default: false },
    { kind: 'text',    key: 'name',   label: 'Name',   default: 'Object' },
    { kind: 'button',  label: 'Run',  primary: true, onClick: runMyTool },
  ],
  onChange(values, changedKey) {
    // Called on every field change. Use for live previews.
    console.log('changed', changedKey, '=', values[changedKey]);
  },
  onClose() { /* called when the user clicks ✕ */ },
});

// Read latest values
const v = UI.parameters.values('com.example.my-tool');

// Push values from code back into the panel (e.g. after picking a point)
UI.parameters.update('com.example.my-tool', { origin: pickedPoint });

// Remove the section
UI.parameters.hide('com.example.my-tool');
```

If you implement a custom `DraftDown.Tool`, you can declare `parameters` directly on the
descriptor — the runtime auto-shows it on `activate()` and removes it on `deactivate()`:

```js
const myTool = {
  name: 'My Tool', category: 'modify',
  parameters: {
    title: 'My Tool',
    fields: [{ kind: 'number', key: 'radius', label: 'Radius', default: 1 }],
    onChange(values) { /* react to changes */ },
  },
  activate() { /* ... */ },
  // ... onMouseMove, onLButtonDown, draw, etc.
};
DraftDown.activeModel.tools.pushTool(myTool);
```

### Field kinds

| Kind | Schema |
| --- | --- |
| `header` | `{ kind: 'header', text }` — section sub-heading |
| `separator` | `{ kind: 'separator' }` — horizontal rule |
| `number` | `{ kind: 'number', key, label, default?, min?, max?, step?, unit?, help? }` |
| `integer` | `{ kind: 'integer', key, label, default?, min?, max?, help? }` |
| `slider` | `{ kind: 'slider', key, label, min, max, step?, default?, unit? }` |
| `text` | `{ kind: 'text', key, label, default?, placeholder?, help? }` |
| `boolean` | `{ kind: 'boolean', key, label, default?, help? }` — checkbox |
| `select` | `{ kind: 'select', key, label, options: [{ label, value }], default?, help? }` |
| `color` | `{ kind: 'color', key, label, default? }` — `#RRGGBB` |
| `vec3` / `point3d` | `{ kind: 'vec3', key, label, default?, unit? }` — three-input row |
| `button` | `{ kind: 'button', label, onClick, primary?, key? }` |

### AI chat uses the same API

The built-in AI chat operates the model by writing JavaScript that targets the surface above
(via an `execute_script` tool that auto-wraps work in a single undo step). Anything the AI generates
can be pasted into the **Console** or installed as a plugin verbatim.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines, including how to use the ArchiGraph for AI-assisted development.

### Areas for Contribution

Look for nodes with `impl.status: placeholder` or `impl.status: stub` in `archigraph.yaml`:

- **Push/Pull live preview** — show 3D extrusion during drag
- **Performance** — spatial indexing for snap detection, frustum culling
- **File formats** — improve OBJ, add glTF/STL export

## License

MIT
