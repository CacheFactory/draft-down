# Orbit Tool

## Overview

The Orbit Tool enables intuitive 3D camera navigation in DraftDown. It allows users to rotate the camera around the model (orbit), pan the view, and zoom in/out using mouse and keyboard controls. This is a fundamental view manipulation tool for inspecting 3D geometry from different angles.

**Component ID**: `tool.orbit` (uuid: `J8odz0eM`)  
**Layer**: interaction  
**Language**: TypeScript  
**Complexity**: Moderate

## Responsibilities

- Handle mouse click and drag events to orbit the camera around the scene
- Support middle-mouse-button activation from any active tool (global override)
- Implement shift+middle-mouse-button for panning (translating the camera parallel to the view plane)
- Handle scroll wheel input for zooming (adjusting camera distance)
- Provide Ctrl+Shift modifier to constrain rotation to vertical orbit only
- Center orbit rotation around the point clicked on geometry (not a fixed world origin)
- Set the cursor to "grab" style when the tool is active
- Respond to keyboard shortcut "O" for tool activation
- Display appropriate icon identifier "orbit" in the UI

## API Contract

### Tool Lifecycle

The tool must implement the standard tool interface pattern:

- **Activation**: Respond when selected from Main Toolbar or triggered via "O" shortcut or Views Toolbar
- **Deactivation**: Handle cleanup when another tool is selected
- **Event Handling**: Process mouse and keyboard events while active

### Input Events

Must handle:

- **Click + Drag**: Primary orbit interaction
- **Middle Mouse Button**: Global activation (works even when another tool is active)
- **Shift + Middle Mouse Button**: Pan mode
- **Scroll Wheel**: Zoom in/out
- **Ctrl + Shift + Drag**: Constrained vertical orbit
- **Click on Geometry**: Establish orbit center point

### Camera Manipulation

Must modify the camera state in the Scene Manager to achieve:

- **Orbit**: Rotate camera position around a pivot point while maintaining view target
- **Pan**: Translate camera and target together in the view plane
- **Zoom**: Adjust camera distance from target along view direction
- **Pivot Selection**: When clicking geometry, raycast to find surface intersection and use that as the new orbit center

## Data Access

### Reads

- Current camera position, target, and up vector from Scene Manager (`data.scene`)
- Mouse pointer position and button states
- Keyboard modifier states (Shift, Ctrl)
- Scene geometry for raycasting to determine orbit pivot points
- Current viewport dimensions for calculating movement deltas

### Writes

- Modified camera position to Scene Manager (`data.scene`)
- Modified camera target/look-at point to Scene Manager
- Updated orbit pivot point (internal state or Scene Manager property)

## Dependencies

### Consumed Services

- **Scene Manager** (`data.scene`): Provides access to camera state and scene geometry for raycasting. Must write updated camera transforms back to Scene Manager.

### Integration Points

- **Main Toolbar** (`toolbar.main`): Contains this tool as a selectable option
- **Views Toolbar** (`toolbar.views`): Can trigger this tool activation
- **Tool E2E Tests** (`test.e2e.tools`): Test suite validates tool behavior

## Constraints

### Security & Data Classification

- All operations are local; no network access required
- Reads scene geometry data (same classification as user's project files)
- No sensitive data handling beyond user's own 3D models

### Performance

- Mouse drag events fire at high frequency; transformations must be smooth and responsive
- Raycasting for pivot point selection must complete quickly to avoid lag on click
- Should not block the main render loop

### User Experience

- Orbit should feel natural and intuitive, matching common 3D viewport conventions
- Smooth transitions between orbit, pan, and zoom
- Clear visual feedback via cursor changes
- Global middle-mouse activation must not interfere with other tool operations

### Input Handling

- Middle mouse button must work as a global override regardless of active tool
- Modifier keys (Shift, Ctrl) must be checked accurately to switch modes
- Must handle simultaneous input (e.g., drag while holding modifiers)

## Implementation Location

Implementation code should be created in a folder adjacent to:
- `../data.scene/` — Scene Manager
- `../test.e2e.tools/` — Tool E2E Tests

## Testing Requirements

The Tool E2E Tests suite (`test.e2e.tools`) must validate:

- Activation via keyboard shortcut "O"
- Activation via toolbar selection
- Middle-mouse-button activation from other tools
- Orbit behavior on click+drag
- Pan behavior on shift+middle-mouse+drag
- Zoom behavior on scroll wheel
- Constrained vertical orbit with Ctrl+Shift
- Pivot point selection by clicking geometry
- Cursor style changes appropriately
- Proper cleanup on tool deactivation