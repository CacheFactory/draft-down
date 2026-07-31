# Parallel Constraint

## What This Component Is

The Parallel Constraint is a real-time inference constraint that guides drawing operations by detecting and snapping to parallel alignments with existing edges in the model. When a user moves the cursor while drawing, this constraint analyzes recently referenced edges and displays a magenta inference line when the current drawing direction aligns parallel to any of those edges. This is a **non-parametric, ephemeral constraint** — it affects cursor behavior during active drawing operations but does not persist in the model or update when referenced geometry changes later.

## Responsibility

- Detect when the current cursor position or drawing direction is parallel (or near-parallel) to recently referenced edges
- Generate visual feedback (magenta inference lines) showing the detected parallel relationship
- Provide snap points or directional guidance that lock the cursor to the parallel orientation
- Operate in real-time with minimal latency during active drawing operations
- Maintain a working set of "recently referenced" edges relevant to the current drawing context

## APIs and Interfaces

### Consumed APIs

**Inference Engine** (`engine.inference`):
- Register this constraint as an active inference provider
- Query the current set of recently referenced edges
- Receive cursor position and direction vector updates
- Access tolerance settings for parallel detection (angle threshold)

**Polyline Curve** (`curve.polyline`):
- Query edge direction vectors from polyline segments
- Read vertex positions to compute alignment

### Exposed APIs

**To Inference Engine**:
- `checkConstraint(cursorPos: Vector3, cursorDir: Vector3, context: InferenceContext): ConstraintResult | null`
  - Returns snap point, direction vector, and visual feedback data if parallel alignment detected
  - Returns null if no parallel relationship found
- `getVisualFeedback(): InferenceLine[]`
  - Returns array of magenta inference lines to render
  - Each line includes start point, end point, and style metadata

**Data Shape - ConstraintResult**:
```
{
  type: "parallel",
  snapPoint: Vector3,          // Where to position cursor
  direction: Vector3,          // Direction vector parallel to reference edge
  referenceEdge: EdgeID,       // Which edge we're parallel to
  confidence: number,          // 0.0 to 1.0, higher when closer to exact parallel
  visual: {
    color: [1.0, 0.0, 1.0],   // Magenta RGB
    lineStart: Vector3,
    lineEnd: Vector3,
    style: "dashed" | "solid"
  }
}
```

## Dependencies

**Inference Engine** (`engine.inference`):
- Registers with and receives updates from the inference engine
- Uses the engine's reference edge tracking to determine which edges are "recently referenced"
- Relies on the engine to manage constraint priority when multiple constraints activate simultaneously

**Polyline Curve** (`curve.polyline`):
- Reads geometric data from polyline curves to extract edge directions
- May query edge length and endpoints

**Line Tool** (`tool.line`):
- The Line Tool consumes this constraint during active drawing
- Passes cursor position and direction context to the constraint
- Renders visual feedback provided by the constraint

## Data Read/Write

### Read
- Edge geometry from the active scene (vertices, directions)
- Cursor position and velocity from input system (via Inference Engine)
- User preference settings:
  - Parallel detection angle tolerance (typically 0.5 to 2 degrees)
  - Inference snap distance threshold
  - Visual feedback enable/disable state

### Write
- Transient visual feedback data to rendering system (magenta inference lines)
- Constraint activation state to Inference Engine
- Does **not** write to the persistent geometry model

### Data Classification
- All data is **local, non-sensitive user content**
- No personally identifiable information
- No data leaves the local desktop environment

## Security Constraints

- Runs entirely in the local Electron renderer process
- No network access required
- No authentication or authorization concerns
- Constraint calculations must not block the UI thread (use requestAnimationFrame or worker threads if needed)
- Trust boundary: reads from user-created geometry model, which is trusted local data

## Behavior Requirements

### Parallel Detection
- Compute angle between current cursor direction vector and each reference edge direction
- Consider edges parallel when angle is within tolerance threshold (configurable, default ~1 degree)
- Handle both positive and negative parallel (same direction and opposite direction)
- Provide smooth falloff in confidence as angle deviates from exact parallel

### Reference Edge Selection
- Use edges from the Inference Engine's "recently referenced" collection
- Recently referenced includes:
  - Edges the cursor has hovered over in the last few seconds
  - Edges in the current drawing operation
  - Edges explicitly selected by the user
- Prioritize closer edges when multiple parallel candidates exist

### Visual Feedback
- Render magenta dashed line extending from the reference edge or snap point
- Line should be visible but not visually overwhelming
- Clear the inference line immediately when parallel alignment is lost
- Inference line should extend in both directions from the snap point or reference edge

### Performance
- Constraint check must complete in < 2ms to maintain 60fps during drawing
- Limit reference edge set size (e.g., max 20 recent edges) to bound computation
- Cache edge direction vectors to avoid repeated computation

## Non-Parametric Nature

This constraint is **ephemeral and non-parametric**:
- Active only during drawing operations (e.g., while Line Tool is in use)
- Does not create persistent relationships in the model
- If a referenced edge is later modified or deleted, this constraint does not update existing geometry
- Contrast with parametric constraints (not this component) that maintain live relationships

## Sub-Components

The implementation must include:

1. **Parallel Detector**: Computes angle between vectors and determines parallel alignment
2. **Visual Feedback Generator**: Constructs magenta inference line geometry for rendering
3. **Reference Edge Tracker**: Maintains and prioritizes the working set of candidate edges
4. **Snap Point Calculator**: Computes exact position where cursor should snap given parallel alignment

## Implementation Notes

- Must integrate with the existing Inference Engine's constraint registration system
- Should respect the inference engine's constraint priority system (parallel may be overridden by on-face or endpoint snapping)
- Magenta color (#FF00FF) is the DraftDown-standard color for parallel inference
- Angle tolerance and snap distance should be configurable via user preferences

## References

- DraftDown parallel inference behavior: displays magenta dashed line when drawing parallel to existing edges
- Inference Engine manages constraint lifecycle and priority
- Line Tool is the primary consumer during polyline creation