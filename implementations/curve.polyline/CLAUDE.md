# Polyline Curve

**Component ID**: `curve.polyline`  
**UUID**: `Hog7HfrU`  
**Layer**: geometry  
**Language**: TypeScript

## Purpose

The Polyline Curve represents a sequence of connected line segments in 3D space. This is the foundational curve type in DraftDown — all native geometry ultimately reduces to polylines. Circles, arcs, and other curves are represented as segmented polylines with sufficient subdivision to appear smooth.

This component must store an ordered array of 3D points, compute geometric properties (segment count, total length), and provide methods for parametric evaluation, splitting, subdivision, and simplification.

## Responsibilities

- Store an ordered sequence of 3D points defining the polyline vertices
- Track whether the polyline is open or closed (last point connects to first)
- Compute and provide total curve length
- Provide segment count (number of line segments between points)
- Evaluate position at a normalized parameter `t` (0.0 to 1.0) along the curve
- Split the polyline at a given parameter, producing two new polylines
- Subdivide the polyline by adding intermediate points along segments
- Simplify the polyline using the Ramer-Douglas-Peucker algorithm to reduce point count while preserving shape within a tolerance
- Support float64 precision for all coordinates

## Data Structure

### Core Data
- **Points array**: Ordered list of 3D points `[x, y, z]` with float64 precision
- **Closed flag**: Boolean indicating if the polyline forms a closed loop
- **Degree**: Always 1 (linear segments)
- **Type**: Always "polyline"

### Computed Properties
- **Segment count**: Number of line segments (points.length - 1 for open, points.length for closed)
- **Total length**: Sum of all segment lengths
- **Segment lengths**: Array of individual segment lengths (cached for performance)

## API Surface

### Construction
- Create from array of 3D points
- Specify open/closed state at creation

### Queries
- Get point count
- Get segment count
- Get total length
- Get point at index
- Get segment at index (returns start point, end point, length)
- Evaluate point at parameter `t` (0.0 to 1.0 along entire curve)
- Find closest point on polyline to a given 3D point
- Determine if polyline is closed

### Modification
- **Split at parameter**: Given `t` (0.0 to 1.0), split into two polylines at that position. Returns two new polyline instances. If closed, converts to open at split point.
- **Subdivide**: Insert additional points along segments. Can subdivide uniformly (N points per segment) or by maximum segment length.
- **Simplify**: Apply Ramer-Douglas-Peucker algorithm with a tolerance parameter. Returns a new polyline with fewer points that approximates the original within tolerance.
- **Reverse**: Reverse point order
- **Close/Open**: Toggle closed state

### Serialization
- Serialize to JSON (points array, closed flag, metadata)
- Deserialize from JSON

## Dependencies

### Consumed By
- **WebGL Renderer** (`renderer.webgl`): Renders polyline as line geometry in Three.js scene
- **Core Geometry Engine** (`engine.geometry`): Uses polylines as building blocks for edge construction, face boundaries, and solid modeling operations
- **Inference Engine** (`engine.inference`): Analyzes polyline geometry for snapping hints, parallel/perpendicular relationships, and on-axis alignment
- **Scene Manager** (`data.scene`): Stores polyline entities in the scene graph
- **Selection Manager** (`data.selection`): Enables selection of polyline entities and their sub-elements (points, segments)
- **Model Document** (`data.document`): Persists polyline data in the document model
- **Constraint system**: On-Axis (`constraint.on_axis`), Parallel (`constraint.parallel`), and Perpendicular (`constraint.perpendicular`) constraints apply to polyline segments and evaluate their geometric relationships

### Dependencies On Other Components
- **Core Geometry Engine** (`engine.geometry`): May use shared vector math utilities, distance calculations, and geometric predicates
- **Scene Manager** (`data.scene`): Integrates as a managed geometry type in the scene

## Constraints

### Data Classification
- **User geometry data**: All polyline point coordinates and properties are user-created content
- **No sensitive data**: Geometry is inherently non-sensitive but represents user intellectual property
- **Local-only**: All data remains on the user's machine; no cloud transmission

### Performance
- **Float64 precision**: All coordinates stored as double-precision floats for CAD-grade accuracy
- **Caching**: Segment lengths and total length should be cached and invalidated only when points change
- **Large polylines**: Must handle polylines with thousands of points efficiently (common in segmented circles/arcs)
- **Subdivision performance**: Subdivision operations should be efficient enough for real-time modeling interactions
- **Simplification performance**: Ramer-Douglas-Peucker must run efficiently on dense polylines (e.g., 360-point circles)

### Geometric Correctness
- **Degenerate segments**: Handle zero-length segments gracefully (e.g., duplicate consecutive points)
- **Numerical stability**: Parameter evaluation must be numerically stable across the full 0.0-1.0 range
- **Closed polyline semantics**: Closed polylines must correctly handle the implicit segment from last to first point
- **Tolerance handling**: Simplification tolerance must be interpreted consistently (perpendicular distance)

### Integration
- **Immutability preference**: Operations like split, subdivide, simplify should return new polyline instances rather than mutating in place (functional style preferred for undo/redo and predictability)
- **Serialization stability**: JSON format must be stable for document persistence and versioning
- **Validation**: Validate input on construction (minimum 2 points, valid coordinates)

## Testing Requirements

- **Geometry Integration Tests** (`test.integration.geometry`): Must include integration tests covering:
  - Polyline creation with various point configurations
  - Parameter evaluation at edge cases (t=0, t=1, t=0.5)
  - Split operations on open and closed polylines
  - Subdivision with various strategies
  - Simplification with different tolerances (including edge cases where simplification removes all interior points)
  - Closed polyline behavior (implicit closing segment)
  - Degenerate cases (collinear points, duplicate points, minimum point count)
  - Serialization round-trip (serialize then deserialize produces equivalent geometry)

## Related Components

- **NURBS Curve** (if implemented): Higher-degree curves that may reference or convert to/from polylines
- **Circle/Arc primitives**: Represented internally as polylines with specific metadata
- **Edge entities**: Polylines define the geometric path of edges in the solid modeling kernel
- **Face boundaries**: Closed polylines define face boundary loops

## Notes

- DraftDown's design philosophy treats all curves as segmented polylines for simplicity and performance. This component follows that principle.
- Circle and arc entities are higher-level abstractions that maintain metadata (center, radius, arc angles) but use polylines for actual geometry.
- Simplification is critical for import workflows (e.g., importing DXF files with over-segmented circles) and performance optimization.
- The parametric evaluation method must handle the closed polyline case where the parameter wraps around to the first segment.