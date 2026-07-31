# Inference Engine

**Component ID**: `engine.inference`  
**Layer**: geometry  
**Kind**: geometry_engine

## Purpose

The Inference Engine is the core of native guided drawing. It runs every frame during active tool operations to compute snap targets, geometric constraints, and visual guides that help users draw accurately in 3D space. It answers the question: "Given the current cursor position and drawing context, what point in 3D space should the user snap to, and what visual guides should be displayed?"

This is a performance-critical component that must complete all inference computations in under 2ms per frame for models containing up to 100,000 edges.

## Responsibilities

### Core Inference Types

The engine must detect and compute these inference types, each with distinct visual representation and priority:

- **endpoint** — snap to vertex (green dot, highest priority)
- **midpoint** — snap to edge midpoint (cyan dot, high priority)
- **on-edge** — snap to arbitrary point on edge (red dot, medium priority)
- **on-face** — snap to arbitrary point on face plane (blue dot, low priority)
- **intersection** — edge-edge or edge-axis intersection (black dot, high priority)
- **on-axis-x** — constrain to X axis from origin (red line)
- **on-axis-y** — constrain to Y axis from origin (green line)
- **on-axis-z** — constrain to Z axis from origin (blue line)
- **parallel** — constrain parallel to reference edge (magenta line)
- **perpendicular** — constrain perpendicular to reference edge (magenta line)
- **from-point** — constrain from previously referenced point (dotted line)
- **tangent** — tangent to arc or circle

### Real-Time Query Interface

Must provide a primary query method called every frame:

```
findInference(screenPos, ray, context, config?) → InferenceResult | null
```

**Inputs:**
- Screen position (x, y in pixels)
- 3D ray from camera through screen point
- Inference context (tool state, recent points/edges, axis locks, custom axes)
- Optional configuration overrides

**Output:**
- Single best inference result including:
  - Inference type
  - Snapped 3D point
  - Priority value
  - Reference entity (vertex, edge, or face that was snapped to)
  - Visual guide geometry for rendering
  - Tooltip text ("Endpoint", "On Edge in Blue", etc.)
  - Display color

### Inference Pipeline

For each frame, the engine must:

1. Cast ray from camera through cursor position
2. Query spatial index for all geometry within configurable snap radius (screen space)
3. Test point snaps (endpoints, midpoints, intersections) — highest priority
4. Test edge snaps (on-edge, perpendicular, parallel)
5. Test face snaps (on-face plane intersection)
6. Test axis constraints (X/Y/Z from tool start point or custom origin)
7. Test from-point constraints (lines from recently referenced points)
8. Rank all candidate results by priority and distance
9. Return best result with guide geometry

### Batch Query

Must also provide:

```
findAllInferences(screenPos, ray, context) → InferenceResult[]
```

Returns all valid inferences sorted by priority, for debugging or advanced UI features.

### Specific Snap Tests

Must expose individual snap test methods:

- `snapToPoint(ray, candidates, screenRadius)` — test vertex snaps
- `snapToEdge(ray, candidates, screenRadius)` — test edge snaps
- `snapToFace(ray, candidates)` — test face plane intersections
- `snapToAxis(point, origin, axes)` — test axis constraints
- `snapToParallel(point, direction, referenceEdge)` — test parallel constraint
- `snapToPerpendicular(point, direction, referenceEdge)` — test perpendicular constraint

Each returns an `InferenceResult` or null.

## Data Contracts

### Input Data

**Screen Position**: `{ x: number, y: number }` in viewport pixels

**Ray**: 3D ray with origin and direction vectors (from camera system)

**Inference Context**:
- `toolStartPoint: Vector3 | null` — where current tool operation began
- `recentPoints: Vector3[]` — recently clicked/referenced points (for from-point inference)
- `recentEdges: Edge[]` — recently referenced edges (for parallel/perpendicular)
- `lockedAxis: 'x' | 'y' | 'z' | null` — arrow key axis lock
- `lockedPlane: Plane | null` — face plane lock
- `customAxes: { origin, xAxis, yAxis, zAxis } | null` — custom coordinate system

**Inference Config**:
- `snapRadius: number` — screen pixels (default 15)
- `axisSnapAngle: number` — degrees deviation to snap to axis (default 5)
- `pointPriority: number` — endpoint/midpoint priority (default 100)
- `edgePriority: number` — on-edge priority (default 50)
- `facePriority: number` — on-face priority (default 10)
- `axisPriority: number` — axis constraint priority (default 75)
- `enabled: boolean`

### Output Data

**InferenceResult**:
- `type: InferenceType` — one of the 12 inference types
- `point: Vector3` — the computed 3D snap point
- `priority: number` — snap strength (higher wins)
- `referenceEntity: Vertex | Edge | Face | null` — what geometry was snapped to
- `guideGeometry: InferenceGuide[]` — visual guides for rendering
- `tooltip: string` — display text
- `color: string` — hex color code

**InferenceGuide**:
- `type: 'point' | 'line' | 'dashed-line' | 'arc'`
- `points: Vector3[]` — [center] for point, [start, end] for line
- `color: string` — hex color
- `size: number` — pixels

### Geometry Data Sources

Reads geometry from:
- **Half-Edge Mesh** (`mesh.halfedge`) — vertices, edges, faces
- **Polyline Curve** (`curve.polyline`) — linear curve segments
- **Arc Curve** (`curve.arc`) — circular/elliptical arcs

Uses float64 precision and B-Rep (boundary representation) geometry model.

## Dependencies

### Direct Geometry Dependencies

**Computes on**:
- Half-Edge Mesh vertices, edges, faces
- Polyline Curve segments
- Arc Curve geometry

Must query these components for geometry data during inference tests.

### Constraint Integration

**Modified by** (constraint components that inject specialized inference logic):
- On-Axis Constraint (`constraint.on_axis`) — X/Y/Z axis locking
- Parallel Constraint (`constraint.parallel`) — parallel line inference
- Perpendicular Constraint (`constraint.perpendicular`) — perpendicular line inference
- Snap Point Constraint (`constraint.snap_point`) — point-to-point snapping
- Distance Constraint (`constraint.distance`) — fixed-distance inference

These constraints must be able to register custom inference handlers or modify inference priority/behavior.

### External Dependencies

- Math library for vector/ray operations (Vector3, Ray, Plane types)
- Spatial indexing structure (octree or similar) for fast geometry queries
- Camera system for ray casting and screen-space projection

## Performance Requirements

**Critical benchmarks**:
- Complete all inference computation in **< 2ms per frame**
- Support models with up to **100,000 edges**
- Maintain 60 FPS during active tool usage

**Required optimizations**:
- Spatial indexing (octree) for geometry candidate collection
- Screen-space culling — only test geometry near cursor
- Cached screen-space projections of nearby geometry
- Frame-rate throttled updates (skip inference on dropped frames if needed)
- Early exit on high-priority snap hits

## Configuration

Must provide:
- `setConfig(config)` — update inference parameters
- `getConfig()` — retrieve current configuration

Configuration must be adjustable at runtime to support:
- User preference changes (snap sensitivity)
- Tool-specific overrides (some tools disable certain inference types)
- Debugging/testing modes

## Visual Guide Geometry

For each inference result, must generate guide geometry for rendering:

**Point guides**: Small dots at snap positions (size configurable)
**Line guides**: Solid or dashed lines showing constraints
**Color coding**:
- Red: X axis, on-edge
- Green: Y axis, endpoint
- Blue: Z axis, on-face
- Cyan: midpoint
- Black: intersection
- Magenta: parallel/perpendicular

Guide geometry must include sufficient data for a renderer to draw using any graphics API (positions, colors, line styles, sizes).

## Security Constraints

**Data classification**: Internal geometry data — no user data, no PII.

**Trust boundaries**: Operates entirely within the Electron main process on geometry data owned by the application. No network access, no file system access beyond reading geometry from in-memory mesh structures.

**Input validation**: Must validate that ray direction is normalized, screen positions are finite numbers, and geometry references are valid before performing computations.

## Implementation Language

TypeScript (as specified in extension fields).

## References

