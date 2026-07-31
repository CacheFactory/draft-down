# Zoom Tool

## Purpose

The Zoom Tool is an interactive view manipulation tool that allows users to change the camera's magnification and field of view within the 3D scene. It provides intuitive click-drag zoom, scroll-wheel zoom toward cursor, and specialized commands for fitting geometry and selecting zoom regions.

## Responsibilities

- Interpret user input (click-drag, scroll wheel, keyboard shortcuts) as zoom commands
- Calculate appropriate camera position and field-of-view adjustments based on input gestures
- Execute zoom operations through the Scene Manager
- Provide cursor feedback during tool activation
- Support multiple zoom modes: drag zoom, scroll zoom, zoom extents, and zoom window
- Accept and validate field-of-view angle input from the Value Control Box (VCB)

## APIs Exposed

### Tool Activation
- Must be activatable via keyboard shortcut `Z`
- Must be selectable from the Main Toolbar
- Must be triggerable from the Views Toolbar
- On activation, set cursor to `pointer` type

### Zoom Operations

**Drag Zoom**
- Left-click and drag vertically to zoom
- Dragging upward: zoom in (magnify view)
- Dragging downward: zoom out (shrink view)
- Zoom magnitude proportional to drag distance

**Scroll Zoom**
- Mouse wheel forward: zoom in toward cursor position
- Mouse wheel backward: zoom out from cursor position
- Cursor position defines zoom focal point in 3D space

**Zoom Extents** (Shortcut: `Shift+Z`)
- Calculate bounding volume of all visible geometry in scene
- Adjust camera position and field of view to fit all geometry within viewport
- Maintain current view direction/orientation

**Zoom Window** (Shortcut: `Ctrl+Shift+Z`)
- Enter window selection mode
- User draws rectangular selection box on screen
- Adjust camera to fit selected screen region content within full viewport
- Cancel if user releases before defining valid rectangle

**Field of View Input**
- Accept numeric angle input from VCB during tool activation
- Valid range: typically 1° to 120° (verify against Scene Manager camera constraints)
- Apply new FOV to camera configuration
- Invalid input: ignore and maintain current FOV

## Data Interactions

### Reads From
- **Scene Manager**: Current camera position, orientation, field of view
- **Scene Manager**: Bounding volumes of scene geometry (for zoom extents)
- **Mouse/Keyboard Input**: Click positions, drag deltas, scroll events, keyboard modifiers
- **VCB**: Numeric angle input for field-of-view changes

### Writes To
- **Scene Manager**: Modified camera position
- **Scene Manager**: Modified camera field of view
- **Scene Manager**: Modified camera orientation (only if implementation requires orbit during zoom)

### Modifies
- Scene Manager camera state (via `modifies` edges `ul1FEIF3`, `4Os7R5tS`)

## Dependencies

### Direct Dependencies
- **Scene Manager** (`data.scene`): Camera query and manipulation, geometry bounds query
- **Main Toolbar** (`toolbar.main`): Tool registration and activation
- **Views Toolbar** (`toolbar.views`): Tool triggering
- **Input System**: Mouse event capture, keyboard event capture
- **VCB**: Numeric input parsing

### Depended On By
- **Tool E2E Tests** (`test.e2e.tools`): Automated testing of zoom behaviors (edges `holOrEgW`, `7baeruay`)

## Constraints

### Interaction Constraints
- Must not interfere with other active tools if tool switching occurs mid-operation
- Drag zoom must be smooth and responsive; minimum 60fps interaction target
- Scroll zoom must feel natural with common mouse/trackpad scroll rates
- Zoom extents must account for empty scenes (no geometry) gracefully

### Camera Constraints
- Must respect minimum/maximum zoom limits defined by Scene Manager camera
- Must not invert or flip camera orientation during zoom operations
- Zoom window must handle edge cases: zero-size rectangles, off-screen selections
- Field-of-view changes must not cause abrupt visual jumps

### Security & Trust
- Input events are trusted (desktop application, local input only)
- No data leaves the application during zoom operations
- No persistent state written to disk
- Scene modifications occur only through Scene Manager public API

## Implementation Metadata

- **Language**: TypeScript
- **Complexity**: Simple
- **Category**: View tool
- **Icon**: `zoom`
- **Cursor**: `pointer`

## Testing Requirements

Must be validated by Tool E2E Tests (`test.e2e.tools`):
- Drag zoom in/out produces expected camera position changes
- Scroll zoom focal point aligns with cursor position in 3D space
- Zoom extents fits all geometry correctly across various scene configurations
- Zoom window selection defines correct view frustum
- Field-of-view input validation and application
- Keyboard shortcuts activate correct zoom modes
- Tool activation/deactivation cycles cleanly

## References

Component ID: `tool.zoom` (UUID: `aybhjdyU`)

Related implementation folders:
- `../data.scene/` — Scene Manager (camera and geometry state)
- `../test.e2e.tools/` — Tool E2E Tests (validation suite)