# Protractor Tool

## What This Component Is

The Protractor Tool is an interactive measurement and construction tool for angular geometry. It enables users to measure angles in the 3D scene and create angular construction lines. The tool follows a three-step interaction pattern: click to set the vertex point, click to set the base direction, then click or type to define the angle magnitude. Upon completion, it generates a construction line at the measured angle.

This tool is part of the Drawing Toolbar's measurement category and is activated via the `Shift+T` keyboard shortcut. It displays a crosshair cursor during use.

## Responsibilities

- Capture three user inputs to define an angle: vertex point, base direction point, and angle magnitude
- Measure angles between user-selected points in 3D space
- Accept angle input via mouse click (inferring from position) or keyboard entry (direct numeric input)
- Create construction line geometry at the measured angle
- Provide visual feedback during the multi-step interaction (showing vertex, base direction, and preview of angle)
- Respect snap points when positioning the vertex and base direction
- Integrate with the scene manager to add the resulting construction line geometry

## APIs and Interactions

### Tool Activation
- Activated from the Drawing Toolbar via the "protractor" icon or `Shift+T` shortcut
- Must register with the toolbar using category "measure"
- Cursor type: "crosshair"

### Input Capture
- Accept mouse click events to capture:
  - First click: vertex position (3D point)
  - Second click: base direction (3D point defining the reference ray from vertex)
  - Third click: angle magnitude (3D point from which angle is inferred) OR keyboard numeric entry for angle value
- Support keyboard input for direct angle entry (degrees expected)
- Constrain click positions using Snap Point Constraint (id: `constraint.snap_point`)

### Scene Modification
- Add construction line geometry to the Scene Manager (id: `data.scene`)
- Construction lines must be marked as helper/construction geometry (not solid model geometry)
- Modify scene state to reflect the new angular construction line

### Data Written
- New construction line entity with:
  - Vertex point (3D coordinates)
  - Direction vector (computed from vertex, base direction, and angle)
  - Metadata marking it as construction geometry
  - Visual properties (color, line weight, construction style)

## Dependencies

### Uses
- **Snap Point Constraint** (`constraint.snap_point`) — Used during vertex selection and base direction selection to snap to existing geometry points, edges, or grid positions
  - Edges: `SdcaqW1h`, `KV1P2Hmi`

### Modifies
- **Scene Manager** (`data.scene`) — Target for adding construction line geometry
  - Edges: `uhsFZwjq`, `zaK6DZ9P`

### Container
- **Drawing Toolbar** (`toolbar.drawing`) — Contains this tool as a selectable option
  - Edge: `0j3Zo7ta`

### Testing
- **Tool E2E Tests** (`test.e2e.tools`) — End-to-end test suite covering this tool's functionality
  - Edges: `YdDvPG1D`, `Vm0buchF`

## Requirements and Constraints

### Functional Requirements
- Support a three-step workflow: vertex → base direction → angle
- Allow angle specification by clicking a point (calculate angle from position) or typing a numeric value
- Create construction lines that remain visible and selectable but are distinct from solid model edges
- Display real-time preview of the angle during the interaction (after base direction is set)
- Show angle measurement value during interaction
- Handle both 2D planar angles and angles in 3D space (specify the measurement plane)

### Interaction Requirements
- First two clicks must snap to geometry using Snap Point Constraint
- Third click may optionally snap, or user may type angle directly
- Provide clear visual feedback at each step (highlight vertex, show base ray, show angle arc preview)
- Allow cancellation via Escape key
- Reset to step 1 after completing an angle measurement (tool remains active)

### Security Constraints
- All data remains local — no cloud transmission
- Construction lines are part of the local scene data
- No authentication or encryption required (local desktop application)

### Data Classification
- User interaction data: ephemeral, not persisted beyond the session unless scene is saved
- Construction line geometry: part of the scene model, persisted when user saves the file
- Measurement values: displayed in UI but not necessarily stored as separate entities

### Performance Constraints
- Real-time preview rendering must not degrade viewport framerate
- Angle calculations must complete within a single frame (<16ms for 60fps)

### Platform Constraints
- Implementation language: TypeScript
- Runs within Electron desktop environment
- Integrates with Three.js rendering pipeline for visual feedback

## Trust Boundaries

- User input (mouse clicks, keyboard entry) is trusted — no validation against malicious input required
- Snap constraint results are trusted — provided by internal constraint system
- Scene manager modifications are trusted — no external data sources

## Sub-Components

This component is expected to contain:

1. **Angle Measurement Logic** — Calculate angle between three points (vertex, base direction endpoint, angle endpoint) or apply a typed numeric angle
2. **Interaction State Machine** — Track progression through vertex → base → angle steps, handle input routing
3. **Visual Feedback Renderer** — Draw temporary graphics showing vertex point, base ray, angle arc, and numeric label
4. **Construction Line Generator** — Create the final construction line geometry based on measured angle
5. **Snap Integration** — Interface with Snap Point Constraint to resolve click positions

No external sub-components are defined. All logic is implemented within this tool's codebase.

## Existing Code References

None specified. This is a new implementation.

## Related Documentation

- Tool complexity: moderate
- Icon identifier: "protractor"
- Category: "measure" within Drawing Toolbar