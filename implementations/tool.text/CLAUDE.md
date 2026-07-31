# 3D Text / Label Tool

## What This Component Is

The 3D Text / Label Tool is an interactive tool that allows users to add text annotations and 3D text geometry to the model. It supports three distinct text placement modes:

1. **Leader text**: Click a point on geometry to anchor, drag to position the leader endpoint, then type label text. Creates a line connecting the text to the anchored point.
2. **Screen text**: Click anywhere in the viewport to place floating text that remains screen-oriented.
3. **3D text**: Type text, configure font/height/extrusion parameters, then place as actual solid geometry in the 3D scene.

This tool is part of the annotation category and is activated via keyboard shortcut `Shift+D`. When active, the cursor changes to `crosshair`.

## Responsibilities

- Capture user clicks and drag gestures to define text placement positions
- Respect snap point constraints during anchor point selection for leader text
- Provide text input UI for users to enter label content
- Offer configuration options for 3D text (font selection, height, extrusion depth)
- Create appropriate text entities (annotations or solid geometry) based on selected mode
- Add created text entities to the Scene Manager
- Handle tool activation, deactivation, and mode switching
- Provide visual feedback during text placement (preview, cursor state)

## APIs and Interfaces

### Tool Lifecycle

Must implement standard tool interface expected by the toolbar:

- **Activation**: Respond to shortcut `Shift+D` or toolbar button click
- **Deactivation**: Clean up state when another tool is activated or escape is pressed
- **Mode switching**: Allow user to toggle between leader text, screen text, and 3D text modes

### User Input Handling

- **Mouse events**: Click to define anchor points, drag to position leader endpoints
- **Keyboard input**: Capture text entry for label content
- **Parameter input**: Accept font, height, and extrusion values for 3D text mode

### Snap Point Constraint Integration

- **Uses**: `constraint.snap_point` (ID: `constraint.snap_point`)
- When placing leader text anchors, query the snap constraint system to find valid snap points on geometry
- Provide visual feedback when hovering near snap-enabled points

### Scene Manager Integration

- **Modifies**: `data.scene` (ID: `data.scene`)
- Add created text entities to the scene through the Scene Manager's API
- Text entities must include:
  - Position (3D coordinates or screen coordinates depending on type)
  - Text content (string)
  - Style properties (font, size, color)
  - For leader text: anchor point and leader endpoint positions
  - For 3D text: geometry reference, extrusion parameters

## Data Requirements

### Reads

- Current viewport state (camera position/orientation) for screen text placement
- Geometry data from Scene Manager to determine valid anchor points for leader text
- Snap point locations from Snap Point Constraint system
- User preferences for default font, text size, color (if stored)

### Writes

- Text annotation entities to Scene Manager
- 3D text geometry entities to Scene Manager
- Leader line geometry connecting anchors to text labels

### Entity Structure

Text entities added to scene should include:

- **Type identifier**: Leader text, screen text, or 3D text
- **Content**: String of text to display
- **Position**: 3D world coordinates or screen-relative coordinates
- **Leader data** (if leader text): Anchor point (x, y, z), endpoint (x, y, z)
- **Style**: Font family, size/height, color, extrusion depth (for 3D text)
- **Geometry reference** (if 3D text): Reference to solid geometry created from text

## Dependencies

### Directly Uses

- **Snap Point Constraint** (`constraint.snap_point`): Provides snap point locations during anchor selection
- **Scene Manager** (`data.scene`): Stores created text entities and geometry

### Contained By

- **Drawing Toolbar** (`toolbar.drawing`): Contains this tool as an activatable option

### Tested By

- **Tool E2E Tests** (`test.e2e.tools`): Exercises text placement workflows end-to-end

## Security and Data Classification

- Text content is user-generated local data with no special classification requirements
- All data remains local (no cloud dependencies)
- Text input should handle standard sanitization to prevent issues in rendering
- No authentication or encryption required (desktop-only, local files)

## Sub-Components and Implementation Scope

This component must implement:

1. **Mode selector UI**: Toggle between leader/screen/3D text modes
2. **Text input interface**: Capture and edit text content
3. **3D text parameter panel**: Font selection, height, extrusion depth controls
4. **Placement gesture handlers**: Mouse down/drag/up for anchor and endpoint positioning
5. **Snap integration logic**: Query and respond to snap constraint results
6. **Preview rendering**: Show text/leader preview during placement
7. **Entity creation logic**: Construct appropriate data structures for each text type
8. **Scene Manager integration**: Call appropriate APIs to add entities

## Constraints

- Must follow standard tool activation/deactivation pattern used by other drawing tools
- Leader text anchors must snap to geometry when snap points are available
- 3D text must be created as valid solid geometry compatible with other modeling operations
- Screen text must remain readable and oriented toward camera regardless of viewport rotation
- Text placement must be undoable/redoable through standard history mechanism
- Tool cursor must change to `crosshair` when active
- Must display appropriate icon (`text`) in toolbar

## Integration Points

- **Input system**: Receives mouse and keyboard events from Electron/browser event system
- **Rendering pipeline**: Text annotations and 3D geometry must render via Three.js
- **Solid geometry system**: 3D text geometry must be compatible with Manifold-based operations
- **History system**: Text creation operations must be recordable for undo/redo

## Testing Requirements

Must support E2E testing through `test.e2e.tools`:

- Leader text placement with snap points
- Leader text placement without snap points
- Screen text placement in various viewport orientations
- 3D text creation with different font/extrusion parameters
- Mode switching during tool use
- Tool activation via shortcut and toolbar
- Cancellation and cleanup of partial placements