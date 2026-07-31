# ArchiGraph Workspace — DraftDown

This workspace contains a DraftDown 3D CAD application built with Electron + React + Three.js. The architecture is defined in `archigraph.yaml` — **always consult it first** for questions about how the system works.

## Quick Reference

**"How does X work?"** → Search `archigraph.yaml` for the relevant node ID and read its `docs.description`. Follow its edges to understand connections.

**"Where is X implemented?"** → The node's `id` maps to a source file. Key mappings:
- `process.main` → `src/main/main.ts` (Electron main process)
- `process.renderer` → `src/renderer/` (React UI + Three.js)
- `app.singleton` → `src/renderer/Application.ts` (orchestrator)
- `bridge.scene` → `src/renderer/SceneBridge.ts` (geometry → Three.js sync)
- `engine.geometry` → `src/engine/geometry/GeometryEngine.ts` (B-Rep kernel)
- `data.document` → `src/data/ModelDocument.ts` (owns all state)
- `tool.*` → `implementations/tool.*/` (one folder per tool)
- `tool.base` → `implementations/tool.base/` (BaseTool + shared tool infrastructure: drawingPlanes, planeGeometry, VertexTransformSession, GripOverlay)
- `tool.manager` → `implementations/tool.manager/ToolManager.ts`
- `renderer.webgl` → `src/renderer/WebGLRenderer.ts`
- `camera.main` → `src/renderer/CameraController.ts`
- `viewport.main` → `src/renderer/Viewport.ts`
- `system.snap` → `implementations/renderer.webgl/SceneBridge.ts` (findSnapPoint method)
- `system.autoface` → `src/engine/geometry/GeometryEngine.ts` (autoCreateFaces/splitFaceWithEdge)
- `system.undo` → `src/data/HistoryManager.ts`

## Workspace Structure

```
.
├── CLAUDE.md              # This file
├── archigraph.yaml        # Architecture: 123 nodes, 547 edges — THE SOURCE OF TRUTH
├── schema.yaml            # Vocabulary: layers, node kinds, edge kinds
├── package.json           # Dependencies: electron, react, three, typescript
├── src/
│   ├── core/              # Shared types, interfaces, math utilities
│   ├── main/              # Electron main process + preload
│   ├── renderer/          # React UI, Three.js renderer, camera, viewport, scene bridge
│   ├── engine/            # Geometry engine (B-Rep), inference engine, constraints
│   ├── data/              # Document, scene, selection, history, materials managers
│   ├── tools/             # All 23 drawing/modify/navigate tools
│   ├── operations/        # Geometry operations (extrude, boolean, fillet, etc.)
│   ├── file/              # File format handlers (native, OBJ, STL, glTF, DXF)
│   ├── workers/           # Web workers for mesh processing and file I/O
│   ├── native/            # WASM bridge stubs (Manifold, OpenCascade)
│   └── plugins/           # Plugin system
├── tests/
│   └── e2e-playwright/    # Real Electron E2E tests (93+ tests, no mocks)
├── dist/                  # Built output (webpack)
│   ├── main/              # main.js + preload.js
│   └── renderer/          # renderer.js + index.html
└── implementations/       # ArchiGraph-generated requirement docs per node
```

## Key Architecture Decisions

### Application Bootstrap
`ViewportCanvas` React component creates the `Application` singleton on mount → initializes `ModelDocument`, `Viewport` (Three.js), `SceneBridge`, `InferenceEngine`, `ToolManager` (registers all 23 tools). See node `app.singleton`.

### Geometry → Rendering Pipeline
`GeometryEngine` (B-Rep half-edge mesh) → `SceneBridge.sync()` → Three.js scene objects (face groups + edge lines). See nodes `engine.geometry`, `bridge.scene`.

### Keyboard Event Architecture
ALL keyboard events go through a SINGLE `window` listener in `App.tsx`. No `onKeyDown` on the viewport container (removed to prevent double-firing with toggle-based plane switching). Routes: Cmd+Z→undo, letters→tool activation, arrows→tool plane switching, Escape/Enter/Delete→tool action. Escape is classic-CAD-style: mid-operation it cancels the operation and KEEPS the tool; with the tool idle it clears the selection and returns to Select. Arrow keys bypass the INPUT focus check. Electron menu has NO accelerators. See node `system.keyboard`.

### Tool Event Flow
Mouse event on container div → `ViewportCanvas.getToolEvent()` (raycast + snap) → `tool.onMouseMove/Down/Up(event)` → geometry changes → `app.syncScene()` + `app.syncSelection()`. See edges from `process.renderer` to `app.singleton`.

### Selection & Highlighting
Raycast tests both main scene (faces) and overlay scene (edges). Edge hit threshold scales with camera distance (2% of dist). **Edges prioritized over faces** in results when hit — makes edge selection reliable. Highlight: face materials swapped (polygonOffset -1), edge materials swapped + glow tube cylinder for visible thickness. Pre-selection = orange, selection = blue. See node `renderer.webgl`.

### Edge Rendering
Edge lines are in the **overlay scene**, rendered in a separate pass AFTER the main scene with depth cleared. Edge materials ARE swapped for highlighting now (with glow tube). Highlight restored on mouse-off. See node `bridge.scene`.

### Undo/Redo
Snapshot-based: `geometry.serialize()` before each transaction, `geometry.deserialize()` on undo. Critical: `newDocument()` calls `history.clear()` not `new HistoryManager()` to preserve callbacks. Line tool commits on deactivate (not abort). See node `system.undo`.

### classic CAD Interaction Parity
Blue = vertical (Y) in all axis colors/labels; Z is green. Type-to-redo: after a commit, typing a new value in the VCB re-does the operation (rectangle W,H / circle radius or Ns / polygon / push-pull distance / move distance) via `BaseTool.redoLastOp` + `tryRedoLastOp`. Select: double-click face = face+edges, edge = edge+faces, triple-click = connected set. Push/Pull: double-click repeats last distance, Ctrl leaves the starting face. Rectangle infers Square/Golden Section. Paint: Alt samples, Shift replaces matching. Clipboard: Cmd+C/X/V (+Shift = in place), paste rides the Move tool. Zoom tool: Ctrl+drag = zoom window. Tool cursors are SVG data-URIs in `tool.base/cursors.ts`.

### Units & VCB Distance Parsing
Internal unit is METERS everywhere; conversion happens only at the VCB boundary (`src/core/units.ts`). ALL tool VCB input goes through `BaseTool.parseDistance`/`parseDimensions` → `parseDistanceExpr()`: unit suffixes (`'`/ft, `"`/in, mm, cm, m), feet+inches combos (`8'10"`, bare number after feet = inches), fractions (`1/2"`, `10 1/2"`, `3/8`), additive terms (`1m 20cm`); bare numbers use the current document unit. Angles use plain parseFloat — never length conversion. See node `core.units`.

### Shared Tool Infrastructure (tool.base)
All 23 tools extend `BaseTool` (`implementations/tool.base/BaseTool.ts`). When writing a NEW tool, compose the shared pieces instead of re-implementing them:
- `BaseTool` — lifecycle, VCB/status, undo transactions, drawing planes + axis locking, snap-aware point resolution (`getStandardDrawPoint`), directional inference (`applyDirectionInference`).
- `VertexTransformSession` — gather selection vertices, snapshot originals, `apply(fn)` live preview, `restore()` on cancel, `bounds()`. Used by Move/Rotate/Scale.
- `GripOverlay<T>` — clickable camera-scaled overlay grips with hover highlight + screen-space picking. Used by Rotate handles and Scale grips.
- `planeGeometry.planeBasis` / `rayPlaneIntersect`, `drawingPlanes.DRAWING_PLANES` — plane math shared by shape tools.
`ToolManager` lives in `implementations/tool.manager/`. See node `tool.base`.

### Snapping & Inference (classic-CAD-style)
`SceneBridge.findSnapPoint()` detects: origin, vertex endpoints, edge midpoints, edge-edge intersections (0.05 tolerance), on-edge, and face snaps — 15px screen radius, for EVERY tool that declares `needs.snap` (draw/measure/construct + active modify + axes). The snap kind reaches tools via `ToolMouseEvent.snapKind`. ViewportCanvas shows a convention-named cursor label (Origin/Endpoint/Midpoint/Intersection/On Edge/On Face) for all snapping tools. `BaseTool.applyDirectionInference()` adds automatic axis inference (~7° tolerance → "On Red/Green/Blue Axis", colored guide line + rubber band, Shift pins the inference, arrow keys still hard-lock) and parallel-to-edge inference (magenta) — shared by Line, Move, and Tape Measure. Hard point snaps always beat directional inference. **Grid snapping** (`src/core/snap-settings.ts` module singleton, persisted in prefs `gridSnapEnabled`/`gridSnapSpacing`/`snapEnabled`): free cursor points (`snapKind === 'cursor'`) round to the increment in `findSnapPoint`'s no-snap fallback + BaseTool's plane-raycast paths (`snapPlanePointToGrid` — axis-aligned planes only, keeps the normal-axis coord; face planes exempt). Off by default; ViewsToolbar "Grid Snap" toggle + Preferences ▸ Units ▸ Snapping (unit-expression inputs — NOT formatDistance, which 1-decimal-rounds). `snapEnabled=false` gates ALL object snapping at the top of findSnapPoint. Visible-grid spacing pref drives the grid shader via `setGridSpacing` (wired at ViewportCanvas boot). "From Point" references: hovering a hard snap while drawing remembers the point; dotted axis guides extend from it (BaseTool.fromPointRef). Snaps are sticky (1.5× radius hysteresis in findSnapPoint). **Indicator == geometry invariant**: tools sizing a shape on a locked plane (rectangle 2nd corner, circle/polygon radius, arc points) resolve points via `BaseTool.getPlanePointHonoringSnap()` — a hard snap wins (projected onto the plane), else cursor raycast onto the plane. Never use a raw `raycastOntoPlane` for a point the snap indicator is live for. Rectangle applies the same proportion inference at commit as in preview; hard snaps suppress it. See node `system.snap`.

### Auto-Face Creation
Four mechanisms in GeometryEngine: (1) `autoCreateFaces` via `createEdgeWithAutoFace()` — BFS finds closed coplanar loops. (2) `splitFaceWithEdge` — splits a face when edge connects two non-adjacent boundary vertices. (3) `splitFaceWithPath()` — splits a face along a multi-vertex path (arc), handles endpoints ON face edges (not just corners) by proximity detection and vertex insertion. It only splits a face the path GENUINELY bisects: every interior path vertex must lie on the face's plane strictly inside its boundary (bare chords: midpoint inside). Sharing two boundary vertices is not enough — a push/pull cap ring touches prism walls at two corners, and splitting those walls wired out-of-plane vertices into bent interior faces. Push/pull's 2D extrusion welds landing vertices onto existing coincident vertices (1e-6) so flush extrusions stitch instead of duplicating membranes. Both split faces include arc vertices on their shared boundary (no chord edge). (4) `splitFacesWithClosedRing()` — classic CAD coplanar merge for shape outlines: expands the drawn ring with on-segment intersection vertices and splits every crossed face along boundary→interior→boundary runs, so coplanar faces never overlap; returns split count (0 → circle/polygon may createFace the full ring). `createEdgeWithIntersection` splits crossings with ANY edge (loose lines included, not just face boundaries) so regions around free-standing edges close into faces. `autoCreateFaces` rejects loops that partially overlap an existing coplanar face (`loopPartiallyOverlapsExistingFace`); fully-enclosed loops still punch holes. An interior vertex only blocks a loop when it's enclosed structure (crossing path, cycle, or face-bearing edges) — dangling edges don't prevent face creation. `createEdgeWithIntersection` heals T-junctions at draw time (`splitEdgesThroughVertex`): an endpoint landing mid-edge splits that edge, so lines drawn across a deleted face's loop close sub-loops and re-form faces. Arc tool uses plain `createEdge` + `splitFaceWithPath`. Line tool uses `createEdgeWithIntersection` (per segment). Rectangle/Circle/Polygon use `createEdgeWithIntersection` + `splitFacesWithClosedRing`. See node `system.autoface`.

### Drawing Plane Switching & Axis Locking
**Shape tools** (Rectangle, Circle, Arc, Polygon): arrow keys switch drawing plane (Right→YZ, Left→XY, Up→XZ, Down→reset). Use `screenToDrawingPlane()`. **Line tool**: arrow keys lock to axis (Up→Y vertical, Right→X, Left→Z, Down→unlock). Uses ray-to-axis projection. VCB input respects both modes.

### Geometry Guards
`createEdge` rejects self-edges and zero-length edges. `createFace` strips duplicate consecutive vertices, rejects < 3 unique vertices. `autoCreateFaces` coplanarity tolerance is 0.05 (practical for hand-drawn geometry). BFS finds ALL loops, not just shortest. `checkCoplanar` uses Newell's method over ALL vertices (never a first-3-points plane: collinear leading vertices — e.g. a bisection midpoint between two corners — made the check pass unconditionally, letting SelectTool's post-delete `tryAutoFaceForEdge` heal create non-planar ring faces threading the solid); zero-area rings are rejected, not accepted.

### BaseTool Shared Methods
`findOrCreateVertex()`, `getStandardDrawPoint()`, `screenToDrawingPlane()`, `handleArrowKeyPlane()`, `resolveSelectedEntityIds()`, `isEditable()` — shared by all tools. Prevents code duplication.

### Component System
Groups of faces/edges that act as a single selectable/movable unit. Protected from main-scene editing. Created via "Make Component" button in Entity Info panel. "Edit Component" enters isolated editing mode (purple banner). "Explode" dissolves back to loose geometry. Purple wireframe bounding box rendered in overlay scene. **Instancing (classic CAD definitions)**: every component belongs to a FAMILY (`SceneManager.componentFamilies`); Move-tool copies of a single selected component register the clone in the source's family (`linkInstanceToFamily`). `enterComponent` captures the pre-edit centroid via `componentEditHooks` (installed by `Application.installComponentEditHooks`); `exitComponent` propagates: every sibling instance is torn down and rebuilt as a clone of the edited geometry translated by its centroid offset. Rotated instances not yet supported (translation-only offsets). "Make Unique" (context menu) detaches an instance into a fresh family. See node `system.components`.

### classic CAD Feature Pack (2026-07)
- **Rotate copy + radial arrays**: Ctrl at the center/start-angle click rotates a copy; typing `Nx` after commit = N total copies at k·angle, `/N` subdivides. Move already had `Nx`//`N` linear arrays. Shared cloning in `tool.base/cloneGeometry.ts`.
- **Inference pack**: `center` SnapKind (circle/arc circumcenter from curveId edges, teal marker), perpendicular-to-edge + tangent-at-arc-vertex inference from the ANCHOR's geometry (`getAnchorInferenceDirections`, cached per anchor), edge-extension inference (hover an edge → later snap onto its infinite extension, `Extend Edge`). On-edge snap is HARD in `applyDirectionInference` (indicator == geometry).
- **Guides**: `BaseTool.emitConstructionGuideLine/Point` — persistent, undoable (recordGuideLine), infinite for lines; ids `guide-*`/`guide-pt-*` make them snappable (On Line / point) via `findSnapPoint` reading `renderer.getConstructionGuides()`. Tape Measure modes create them; Protractor places angled guides; Edit > Delete Guides (`Application.deleteAllGuides`) clears undoably.
- **Face orientation**: default faces white front / blue-gray back via `gl_FrontFacing` shader injection (`SceneBridge.installFrontBackShader`; painted faces disable the tint). `GeometryEngine.reverseFace` (ring-aware winding flip) + `orientFaces` (BFS consistency), context menu on faces.
- **Soften/smooth**: eraser Ctrl=soften+smooth, Shift=hide; soft/hidden edges omitted from render (tube released), shown dashed when `SceneBridge.showHiddenGeometry` (views toolbar "Hidden"). Context menu Soften/Unsoften/Hide on edges.
- **Follow Me** (`op.sweep`, tool "Follow Me" Shift+F): rotation-minimizing frames (double reflection) — no degenerate frames when the path turns parallel to the profile normal; closed paths detected (ring stitch wraps, no caps); interior ring edges soft+smooth; profile face consumed.
- **Scenes**: `SceneTabs` above the viewport — add/update/rename/delete scene pages capturing camera/layers/render-mode/section; click animates (`CameraController.animateTo`). Scene pages carry `sectionPlane`.
- **Styles**: profile edges (boundary edges — <2 adjacent faces — render 2.2× tube thickness, toggle "Profiles"), sky/ground background (`renderer.setBackgroundMode('sky')`, toggle "Sky") — a camera-following dome shaded by VIEW DIRECTION (gl_Position xyww far-plane pin), so the horizon stays put under orbit/pan/tilt; never a screen-space gradient.
- **Shadows**: `renderer.setShadowsEnabled` (ground ShadowMaterial catcher + sun casting) and `setSunPosition(dayOfYear, hour, lat)` (solar geometry); views-toolbar toggle + date/time sliders; faces receiveShadow.
- **Section fills**: stencil capping (three.js clipping_stencil technique) in `setSectionPlane` — cut interiors filled dark gray; `refreshSectionCaps()` after geometry changes; per-scene section state.
- **Walk tools** (`tool.walk`): Position Camera (eye height 1.68m default, VCB), Look Around, Walk.
- **Instructor**: `InstructorPanel` card (bottom-right) with per-tool steps + modifiers, keyed by tool id.
- **Autofold**: `GeometryEngine.autofoldNonPlanarFaces(movedVertexIds)` — Move commits fold adjacent non-planar faces into triangles fanned around the moved vertex; fold edges soft+smooth. Wired into all three Move commit paths (click, VCB, type-to-redo); copies skip it (rigid).

### Production Round (2026-07)
- **Native format** (`.draftdown`/`.skc`, SKCF container): `ModelDocument.serialize/deserialize` round-trips geometry (soft/smooth/hidden/curveId/holes/uvs), components + families + quats, scene pages (+section), layers + active layer, materials + faceAssignments, and app extra state (guides + section via `extraStateProvider`/`lastExtraState`, bridged in `Application.installExtraStateProvider`/`applyExtraState`). After ANY deserialize or `newDocument()`, re-wire: `sceneBridge.setSceneManager`, `installComponentEditHooks`, `installExtraStateProvider` — the SceneManager instance is replaced.
- **Autosave**: 5-min timer writes `<userData>/autosave.draftdown` + `.json` meta when dirty; recovery prompt on launch; cleared on manual save. IPC: `file:write/delete/exists`.
- **Imports**: `.dae`/glTF/FBX etc. convert via `Application.objFromThreeObject` (preserves materials as inline MTL — three's OBJExporter dropped usemtl) → `importOBJ({ inlineMtlText })`.
- **SpatialGrid** (`engine.geometry/SpatialGrid.ts`): lazy uniform hash grid (0.5m cells, 500ms staleness) over vertices+edges. Used above `GRID_THRESHOLD` (2000) by `findSnapPoint` (ray-corridor candidates), `createEdgeWithIntersection` (segment AABB + per-crossing vertex dedup), `splitEdgesThroughVertex`. 20k-edge draws stay interactive.
- **Keymap**: Space=Select, G=Make Component (Polygon → Shift+G), Shift+Z=Zoom Extents. Middle-drag orbit (pivot under cursor) + Shift+middle pan work from any tool.
- **Templates**: welcome modal template chooser (`MODEL_TEMPLATES` in core/units); architectural DISPLAY style formats feet/inches as `8' 10 1/2"` (`setDisplayStyle`), input parsing unchanged.
- **Component library**: `LibraryPanel` starter items (`libraryItems.ts`) + user library (localStorage); placement rides Move's `beginPlacement(…, { onCommit })` — component registration is DEFERRED to commit (abort rolls back geometry, but SceneManager components aren't delta-tracked).
- **Instancing v2**: per-component `quat` (RotateTool accumulates on whole-component rotations; copies inherit); propagation applies the RELATIVE quat about the source's pre-edit centroid. `isGroup` components never share families (Make Group in context menu; copied groups stay unique).
- **Solid tools**: real Manifold WASM in the MAIN process (`native:boolean`, `native:solid-check` IPC; renderer can't import bare WASM specifiers — and both ts-loader and jest rewrite literal `import()` to `require`, so use `new Function('s','return import(s)')`). Entity Info shows watertight/volume for selected components.
- **Output**: `renderer.captureImage(scale, mime)` (supersampled offscreen frame, canvas restored); `Application.exportImage/exportPdf` (dependency-free PDF writer `file.native/PdfSheets.ts`, one page per scene, JPEG DCTDecode embedding). `exportPdf(sink?)` accepts a test sink — window.api is contextBridge-frozen.
- **Entity Info**: edge Length editable (scales about midpoint; curve edges = radius edit scaling the whole curve about its center), unit expressions accepted.
- **Plugins**: PLUGINS.md documents the Ruby-style JS API; shipped example `plugin.system/examples/bevel.js` (menu + inputbox + `model.api_.chamferEdge` in one operation). ChamferOperation now REBUILDS the two adjacent faces (deleting the chamfered edge cascades them away; step 7 was unimplemented — boxes lost faces).

### Layer System
Active layer determines where new geometry goes. Visibility hides/shows geometry. Locking prevents selection. Layers panel supports create, delete, toggle visibility/lock, set active, assign selection. See node `system.layers`.

### File I/O
OBJ text format for save/open. Toolbar buttons (📄📂💾) and shortcuts (Cmd+N/O/S/Shift+S). See node `system.fileio`.

### Drag Box Selection
Select tool supports drag-to-select with visual box overlay. Left→right = window mode (blue solid). Right→left = crossing mode (green dashed). Cursor changes to pointer over selectable entities. See node `system.dragselect`.

## Build & Run

```bash
npm run build          # Build both main and renderer
npx electron dist/main/main.js   # Run the app
npx playwright test    # Run all 93+ E2E tests
```

## ArchiGraph Format (v0.3)

The `archigraph.yaml` file describes the system architecture as a graph of nodes and edges.

### Nodes
- `id`: Unique identifier (dot-separated)
- `kind`: Element type (defined in schema.yaml)
- `layer`: Architectural layer
- `name`: Display name
- `x`: Extension fields (impl details, docs, etc.)

### Edges
- `kind`: Relationship type (`calls`, `reads`, `contains`, `creates`, etc.)
- `from`/`to`: Node IDs
- `layer`: Which layer the relationship operates at

## Architecture Feedback Loop

The archigraph is the source of truth. When implementing code, if you discover missing architecture — a new service, interface, edge, or system — **update `archigraph.yaml` first**, then continue. Never let code silently diverge from the architecture.

## Code-to-ArchiGraph Traceability

Leave `// @archigraph <node-id>` comments at the top of files and on key functions to create a bidirectional map between architecture and code.

## Conventions

- Node IDs use dot-separated namespaces: `kind.name` or `kind.group.name`
- Extension fields live under `x.*`
- Edges should outnumber nodes — rich relationships
- Every node should have at least one edge
- Keyboard shortcuts handled by React keydown handler (NOT Electron menu accelerators)
- Face materials: DoubleSide for raycasting, polygonOffset for z-order
- Edge lines: renderOrder:1, never highlighted (material never swapped)
- Preview/overlay objects: raycast=()=>{} to exclude from picking
