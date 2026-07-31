# Arc Curve Component

## What This Component Is

The Arc Curve component represents circular arc geometry in the DraftDown 3D CAD system. It stores parametric definitions of circular arcs and circles, and generates polyline approximations for rendering and geometric operations. This component maintains the mathematical representation of arcs so they can be recognized, manipulated, and re-segmented as true circular geometry rather than just polylines.

## Responsibilities

- Store parametric arc definitions: center point, normal vector, radius, start angle, end angle
- Generate polyline approximations with configurable segment counts (default 12 segments for arcs, 24 for full circles)
- Compute tangent vectors at any point along the arc for use by Sweep tool and inference engine
- Distinguish between open arcs and closed circles
- Support re-segmentation: allow the polyline approximation to be regenerated with different segment counts
- Maintain float64 precision for geometric calculations
- Expose arc geometry data for rendering, inference, and geometric operations

## Data Storage and Representation

### Core Arc Properties
- **Center**: 3D point (x, y, z) in float64 precision
- **Normal**: 3D unit vector defining the arc's plane orientation
- **Radius**: float64 scalar value
- **Start Angle**: float64 value in radians (relative to arc's local coordinate system)
- **End Angle**: float64 value in radians (relative to arc's local coordinate system)
- **Segment Count**: integer, configurable (default 12 for arcs, 24 for circles)
- **Closed Flag**: boolean indicating whether this is a complete circle (true) or arc (false)

### Derived Data
- **Polyline Approximation**: ordered array of 3D points generated from the parametric definition
- **Local Coordinate System**: derived x and y axes in the arc's plane for angle calculation

## APIs and Contracts

### Construction
Must support creation from:
- Center, normal, radius, start angle, end angle
- Center, normal, radius, start point, end point (derive angles)
- Three points (derive center, normal, radius, angles)

### Query Operations
- Get center point
- Get normal vector
- Get radius
- Get start angle, end angle
- Check if closed (full circle)
- Get segment count
- Get current polyline approximation
- Evaluate point at parameter t ∈ [0, 1]
- Evaluate tangent at parameter t ∈ [0, 1]
- Evaluate tangent at specific angle
- Get bounding box

### Modification Operations
- Set segment count and regenerate polyline
- Transform arc by 4x4 matrix (translate, rotate, scale)
- Update parametric definition (center, radius, angles, normal)

### Data Exchange
- Serialize to JSON format compatible with Model Document and Scene Manager
- Deserialize from JSON
- Export polyline approximation for rendering and geometric operations
- Provide parametric curve interface for Inference Engine

## Dependencies

### Consumes From
- **Core Geometry Engine** (`engine.geometry`): May use shared vector math utilities, transformation matrices, and geometric primitives
- **Scene Manager** (`data.scene`): Receives transformation updates, parent-child hierarchy information
- **Model Document** (`data.document`): Serialization format requirements, entity lifecycle management

### Consumed By
- **WebGL Renderer** (`renderer.webgl`): Provides polyline approximation for display
- **Inference Engine** (`engine.inference`): Provides parametric curve definition, tangent computation, and center point for snapping and inference
- **Core Geometry Engine** (`engine.geometry`): Provides arc geometry for Boolean operations, offsetting, and other solid modeling operations (likely converts to polyline for manifold operations)
- **Sweep Tool**: Uses tangent vectors to orient profile geometry along arc path
- **Geometry Integration Tests** (`test.integration.geometry`): Subject to automated testing

## Constraints and Requirements

### Precision
- All calculations must use float64 precision
- Avoid cumulative floating-point error in polyline generation
- Handle edge cases: zero radius, coincident start/end angles, degenerate normals

### Geometric Validity
- Radius must be positive (> 0)
- Normal vector must be non-zero (will be normalized internally)
- Start and end angles define a valid arc range
- For closed circles: start and end angles differ by 2π (or equivalent)

### Segment Count Rules
- Default to 12 segments for open arcs
- Default to 24 segments for closed circles
- Allow manual override of segment count
- Segment count must be ≥ 2 for arcs, ≥ 3 for circles
- Higher segment counts improve visual quality but increase memory and rendering cost

### Coordinate Systems
- Center point is in world coordinates (or parent entity coordinates)
- Normal defines plane orientation in world space
- Start/end angles are measured in a local 2D coordinate system within the arc's plane
- Local x-axis is typically derived from the vector from center to start point
- Local y-axis completes right-handed coordinate system with normal

### Tangent Computation
- Tangent at parameter t must be unit vector
- Tangent direction follows arc orientation (start angle → end angle)
- Tangent at start point should align with perpendicular to radius at start
- Tangent computation must be accurate enough for Sweep tool profile orientation

### Performance
- Polyline generation should be efficient enough for interactive re-segmentation
- Consider caching polyline approximation and only regenerating when parameters or segment count change
- Tangent computation should be fast enough for real-time inference operations

## Security and Data Classification

- All data is local geometry — no sensitive information
- No external network access required
- No user credentials or authentication involved
- Geometry data is considered user content and should be protected by standard file system permissions

## Integration Points

### Rendering Pipeline
- Must provide polyline approximation in format consumable by WebGL Renderer
- Polyline vertices may need to include additional attributes (normals, UVs) depending on rendering needs

### Inference System
- Must expose parametric curve definition for snap detection
- Center point is a primary inference target
- Arc endpoints are inference targets
- Midpoint (at angle halfway between start and end) may be inference target
- Tangent at cursor position supports tangent inference

### Serialization
- Must serialize to JSON format defined by Model Document
- Must include all parametric properties (not just polyline)
- Must be deserializable without loss of precision
- May include both parametric definition and cached polyline (with version/cache invalidation strategy)

### Geometric Operations
- May need to convert to polyline for Boolean operations via Manifold library
- Must support transformation by 4x4 matrices
- Scaling operations may require special handling (non-uniform scale converts arc to ellipse — out of scope, either forbid or approximate)

## Testing Requirements

- **Geometry Integration Tests** must verify:
  - Polyline approximation accuracy (measure deviation from true arc)
  - Tangent correctness at sample points
  - Transformation correctness (rotation, translation, uniform scaling)
  - Serialization round-trip fidelity
  - Edge cases: very small arcs, very large arcs, near-zero angles, near-2π angles
  - Segment count variation produces expected polyline vertex counts
  - Closed vs. open arc behavior

## Out of Scope

- Elliptical arcs (only circular arcs supported)
- Non-uniform scaling (converts circle to ellipse)
- Trimmed or extended arcs beyond start/end angles (separate operation)
- Self-intersecting or multi-revolution arcs (angles differ by >2π)
- Arc editing UI (handled by separate tool components)
- Rendering implementation (handled by WebGL Renderer)