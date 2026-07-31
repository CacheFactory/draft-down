# Perpendicular Constraint

## What This Is

A geometric inference constraint that detects when the user's cursor position forms a perpendicular (90°) relationship with recently referenced edges during drawing operations. When perpendicularity is detected within tolerance, this constraint:

- Snaps the cursor/construction point to the exact perpendicular position
- Displays a magenta visual inference line from the perpendicular point to the reference edge
- Communicates the snap state to the active tool (primarily Line Tool)

This is a **non-parametric** constraint — it applies at the moment of construction but does not maintain ongoing relationships after geometry is created.

## Responsibilities

- Evaluate candidate cursor positions against recently referenced edges to detect perpendicular alignment
- Calculate exact perpendicular snap points when alignment is within angular tolerance
- Generate visual feedback (magenta inference line) when perpendicular condition is met
- Register with and respond to queries from the Inference Engine
- Provide snap suggestions that tools can accept or ignore

## APIs and Interfaces

### Integration with Inference Engine

Must register as a constraint provider with `engine.inference` and implement:

- **Constraint evaluation method**: Accepts current cursor position (3D point), viewport/camera context, and set of recently referenced edges; returns snap suggestion or null
- **Priority/precedence value**: Used by Inference Engine to resolve conflicts when multiple constraints trigger simultaneously
- **Visual representation data**: Geometry data for magenta inference line when constraint is active

### Data Consumed

- **Cursor position**: Current 3D point in model space where user is positioning next construction point
- **Reference edges**: Recently hovered, clicked, or otherwise referenced linear segments (from Polyline Curve or other edge sources)
- **Tolerance threshold**: Angular tolerance (typically ~1-2°) within which perpendicularity triggers
- **Viewport state**: Camera orientation and projection data needed for screen-space distance calculations

### Data Produced

- **Snap suggestion**: Contains exact 3D point, constraint type identifier, reference edge ID, and confidence/priority score
- **Inference visual**: Magenta line segment geometry from snap point to foot of perpendicular on reference edge
- **Constraint state**: Active/inactive status for UI feedback

### Used By

- **Line Tool** (`tool.line`): Queries constraint during interactive line drawing to snap endpoints
- Other drawing tools that may implement similar snapping behavior

### Modifies

- **Inference Engine** (`engine.inference`): Registers constraint handlers, updates active constraint state, contributes visual feedback geometry

### Applies To

- **Polyline Curve** (`curve.polyline`): Evaluates perpendicularity against polyline segments as reference edges

## Dependencies

- **Inference Engine**: Provides constraint registration framework, manages constraint priority resolution, handles visual feedback rendering
- **Polyline Curve**: Source of edge geometry used as perpendicular references
- **Line Tool**: Primary consumer of perpendicular snap suggestions

## Sub-Components

All implementation must be contained within this component's codebase:

1. **Perpendicular detection algorithm**: Computes angle between candidate direction vector and reference edge direction, determines if within tolerance
2. **Snap point calculation**: Projects cursor position onto reference edge, calculates exact perpendicular intersection
3. **Visual feedback generator**: Constructs magenta line geometry for display when constraint is active
4. **Reference edge tracker**: Maintains list of recently referenced edges (may delegate to Inference Engine's reference tracking)

## Security and Data Constraints

- **Data classification**: Geometry data is user-created local content — no special classification
- **Trust boundaries**: All computation is local, no external communication
- **Performance**: Must evaluate in real-time during cursor movement — target <16ms for 60fps interaction
- **Memory**: Reference edge set must be bounded to prevent unbounded growth during long sessions

## Behavioral Requirements

- Perpendicular detection must be **symmetric**: if edge A is perpendicular to cursor direction, the reverse must also be true
- When multiple edges satisfy perpendicular condition, prefer the most recently referenced edge
- Constraint must **not interfere** with explicit numeric input (if user types dimension, constraint is bypassed)
- Magenta inference line must be **clearly distinguishable** from other inference colors (red=on-axis, blue=parallel, green=on-face)
- Angular tolerance should be **configurable** but default to a value that feels "sticky" without being overly aggressive (~1-2°)

## Non-Parametric Nature

This constraint applies **only during construction**. Once a line segment is committed:

- No ongoing perpendicular relationship is maintained
- If reference edge is later modified, previously drawn perpendicular segments do not update
- Re-editing endpoints may re-trigger constraint, but this is a new construction act, not parametric update

## Implementation Language

TypeScript — must integrate with existing DraftDown Electron/Three.js architecture.

## Complexity Classification

**Simple** — Core algorithm is straightforward vector math (dot product for perpendicularity test, vector projection for snap point). Primary complexity is integration with Inference Engine's constraint resolution framework.