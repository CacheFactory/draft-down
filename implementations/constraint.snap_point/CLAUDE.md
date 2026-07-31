# Snap Point Constraint

**Component ID:** `constraint.snap_point`  
**UUID:** `a2iANJ3J`  
**Layer:** modeling  
**Type:** coincident constraint (non-parametric)

## Purpose

The Snap Point Constraint implements intelligent cursor snapping for all drawing and transformation tools. It analyzes the scene geometry and cursor position to infer and offer snap targets, enabling precise point placement during modeling operations.

## Responsibilities

- Query the half-edge mesh (`mesh.halfedge`) to identify potential snap targets near the cursor
- Compute snap point candidates for:
  - **Endpoints** (vertices) — green indicator
  - **Midpoints** of edges — cyan indicator
  - **On-edge** points (closest point on an edge) — red indicator
  - **On-face** points (projected onto face planes) — blue indicator
  - **Edge intersections** (where edges would intersect if extended)
  - **Axis intersections** (along primary X/Y/Z axes)
  - **Construction guide intersections** (guides created by inference engine)
- Apply priority resolution when multiple snap candidates are within snap threshold distance
- Communicate active snap point to the inference engine (`engine.inference`) for visual feedback
- Return the snapped 3D coordinate to requesting tools

## API Contract

### Input

**Snap Request:**
- `cursorPosition`: 3D world-space coordinate (from raycasting or tool input)
- `snapThreshold`: Distance tolerance in world units (typically configurable, e.g., 10-20 pixels in screen space converted to world units)
- `enabledSnapTypes`: Array of snap types to consider (e.g., `['endpoint', 'midpoint', 'on-edge']`)
- `excludeGeometry`: Optional set of geometry IDs to ignore (e.g., currently selected entities)

### Output

**Snap Result:**
- `snappedPoint`: 3D coordinate (or `null` if no snap found)
- `snapType`: One of: `'endpoint'`, `'midpoint'`, `'on-edge'`, `'on-face'`, `'edge-intersection'`, `'axis-intersection'`, `'guide-intersection'`
- `targetEntity`: Reference to the geometry entity (vertex, edge, face, or guide) that provided the snap
- `indicatorColor`: Color code for visual feedback (`'green'`, `'cyan'`, `'red'`, `'blue'`, etc.)

## Data Dependencies

### Reads From

- **Half-Edge Mesh** (`mesh.halfedge`):
  - Vertex positions
  - Edge start/end points and tangent vectors
  - Face planes and boundaries
  - Spatial indexing structures (if available) for efficient nearest-neighbor queries

- **Inference Engine** (`engine.inference`):
  - Active construction guides (infinite lines, axes, arcs)
  - Current drawing plane or context
  - Previously inferred alignments or locked axes

### Writes To

- **Inference Engine** (`engine.inference`):
  - Active snap point location and type (for rendering snap indicators)
  - Snap target metadata (to enable inference chain continuation)

## Consumed By

All interactive tools that require point input:
- `tool.line` — Line Tool
- `tool.rectangle` — Rectangle Tool
- `tool.move` — Move Tool
- `tool.pushpull` — Push/Pull Tool
- `tool.circle` — Circle Tool
- `tool.arc` — Arc Tool
- `tool.polygon` — Polygon Tool
- `tool.tape_measure` — Tape Measure Tool
- `tool.protractor` — Protractor Tool
- `tool.dimension` — Dimension Tool
- `tool.text` — 3D Text / Label Tool
- `tool.sweep_tool` — Sweep Tool
- `tool.paint` — Paint Bucket Tool
- `tool.eraser` — Eraser Tool
- `tool.scale` — Scale Tool
- `tool.offset` — Offset Tool
- `tool.rotate` — Rotate Tool
- `tool.section_plane` — Section Plane Tool

## Priority System Requirements

When multiple snap candidates exist within the threshold:

1. **Distance-based prioritization**: Closer snaps preferred within same type
2. **Type hierarchy** (configurable, typical order):
   - Endpoints (highest)
   - Edge intersections
   - Midpoints
   - Axis intersections
   - Guide intersections
   - On-edge
   - On-face (lowest)
3. **Hysteresis**: Once a snap is active, require cursor movement beyond 1.5× threshold to switch to different snap type
4. **Axis-locking integration**: When inference engine has locked an axis, only consider snaps along that axis

## Performance Constraints

- Snap computation must complete within **5ms** per frame to maintain 60 FPS during tool usage
- For large meshes (>10,000 entities), must use spatial acceleration structures (octree, BVH, or grid) rather than brute-force iteration
- Cache snap candidates when cursor moves less than 2 pixels in screen space

## Configuration

Must support user preferences for:
- Snap threshold distance (screen-space pixels)
- Enabled/disabled snap types
- Snap indicator visibility and size
- Snap priority order

## Security & Trust

- **Data Classification**: Public (geometry data, user preferences)
- **Trust Boundary**: Runs in Electron main/renderer process with full file system access
- **Input Validation**: Cursor positions must be validated as finite numbers; snap threshold must be positive

## Non-Requirements

- This constraint is **non-parametric**: it does not create persistent relationships that update when geometry changes
- Does not handle snap audio feedback (delegated to UI layer)
- Does not enforce mandatory snapping (tools may allow override with modifier keys)
- Does not persist snap history or undo/redo integration (handled by tools)

## Integration Notes

- Must coordinate with inference engine to avoid duplicate snap indicator rendering
- Should respect tool-specific snap filters (e.g., rotate tool may disable on-face snaps)
- Works in both orthographic and perspective camera modes