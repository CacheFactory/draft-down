# Pan Tool

## What This Component Is

The Pan Tool (`tool.pan`) is a viewport manipulation tool that allows users to move the camera view across the 3D scene without changing zoom level or orbit center. It is part of the view category of tools in DraftDown's interaction layer.

The tool provides two activation modes:
1. Primary mode: Activated via toolbar button or keyboard shortcut "H"
2. Transient mode: Shift+middle-mouse activates pan temporarily from any other active tool

## What It Must Do

### Core Functionality

- **Click-and-drag panning**: Translate the camera view in screen space (left/right, up/down) based on mouse movement
- **Maintain zoom level**: Camera distance from the scene must remain constant during pan operations
- **Preserve orbit center**: The center point for orbit operations must move relative to the panned position so that subsequent orbit operations feel natural
- **Cursor feedback**: Display a "grab" cursor when the tool is active
- **Transient activation**: Respond to Shift+middle-mouse from any tool state, perform pan, then return to previous tool when released

### Interaction Requirements

- Activate when selected from Main Toolbar or Views Toolbar
- Activate via keyboard shortcut "H"
- Activate transiently via Shift+middle-mouse-drag regardless of current tool
- Provide visual feedback during active pan operations
- Deactivate cleanly when another tool is selected or transient gesture ends

### Camera Constraints

- Pan operations must work correctly at all zoom levels
- Pan speed should feel proportional to the current camera distance (panning feels faster when zoomed in close, slower when zoomed out)
- Must not introduce camera roll or rotation
- Must not modify the camera's up vector
- Pan calculations must account for current camera orientation

## APIs and Interfaces

### Tool Interface

Must implement standard tool lifecycle:
- Activation (via toolbar selection, keyboard shortcut, or transient gesture)
- Mouse event handling (mousedown, mousemove, mouseup)
- Deactivation and cleanup
- State queries (is active, is transient)

### Expected Events

**Input:**
- Mouse button press (left button for primary mode, middle button with Shift for transient)
- Mouse movement during active drag
- Mouse button release
- Keyboard shortcut "H"
- Tool selection events from toolbars
- Shift+middle-mouse gesture from any tool state

**Output:**
- Camera transform updates to Scene Manager
- Tool state changes (active/inactive)
- Cursor change requests
- Tool activation/deactivation events

## Data Read/Write

### Reads

- Current camera position from Scene Manager (`data.scene`)
- Current camera target/orbit center from Scene Manager
- Current camera orientation (view matrix) from Scene Manager
- Viewport dimensions for screen-space calculations
- Current tool state (for transient activation)

### Writes

- Updated camera position to Scene Manager
- Updated orbit center position to Scene Manager
- Tool activation state
- Cursor state

### Data Classification

All data is **user workspace data** (non-sensitive). No personal information, credentials, or restricted data is handled.

## Dependencies

### Required Components

- **Scene Manager** (`data.scene`): Source of camera state, target of camera updates
- **Main Toolbar** (`toolbar.main`): Provides tool activation via UI
- **Views Toolbar** (`toolbar.views`): Provides additional activation points

### Tool System Integration

Must integrate with the application's tool management system to:
- Register as a selectable tool
- Handle tool activation/deactivation lifecycle
- Support transient tool override mechanism
- Respond to keyboard shortcuts

## Security and Trust Boundaries

- **Trust boundary**: Runs in Electron renderer process with full access to scene data
- **Data classification**: User workspace data only
- **No external communication**: All operations are local
- **No authentication required**: Part of the main application context
- **Input validation**: Must validate mouse coordinates are within viewport bounds

## Testing Requirements

Must be covered by Tool E2E Tests (`test.e2e.tools`):
- Tool activation via toolbar selection
- Tool activation via keyboard shortcut "H"
- Pan via click-and-drag produces correct camera translation
- Pan maintains zoom level throughout operation
- Orbit center updates correctly relative to pan
- Transient activation via Shift+middle-mouse works from other tools
- Return to previous tool after transient pan completes
- Pan speed feels appropriate at different zoom levels
- Cursor changes correctly during tool states

## Sub-Components

This component is a single tool implementation with no sub-components. All functionality must be contained within this codebase.

## Constraints

- **Performance**: Pan operations must update at display refresh rate (typically 60fps) without visible lag
- **Precision**: Camera position calculations must maintain numeric stability across large pan distances
- **Responsiveness**: Tool activation must feel immediate (< 16ms to first visual feedback)
- **Cross-platform**: Must work identically on Windows, macOS, and Linux
- **No external dependencies**: Cannot rely on cloud services or network calls

## Implementation Notes

- Language: TypeScript
- Complexity: Simple
- Icon identifier: "pan"
- Shortcut key: "H"
- Cursor: "grab"
- Category: "view"

The implementation approach, class structure, state management patterns, and specific Three.js APIs used are left to the implementer's discretion.