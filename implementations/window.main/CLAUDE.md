# Main Window

## Overview

The Main Window (`window.main`) is the primary application window for DraftDown, a local desktop 3D CAD application. It hosts the entire user interface including the 3D viewport, toolbars, panels, and menus within a single Electron renderer process window. This component orchestrates the UI shell — layout management, panel docking, window lifecycle, and theme application — while delegating 3D rendering to the Main 3D Viewport component.

The window uses a flexbox-based docking layout with resizable panels: the 3D viewport occupies the center, toolbars are positioned at top and left, and panels dock to the right side. All UI is built with React and TypeScript, running in an Electron renderer process with `contextIsolation: true` and `nodeIntegration: false`.

## Responsibilities

- Create and manage the Electron BrowserWindow with dimensions 1400×900 (minimum 800×600)
- Implement a docked, resizable panel layout system (viewport center, toolbars top/left, panels right)
- Render and manage all contained UI components: toolbars, menus, panels
- Apply and switch between dark/light themes across all UI elements
- Handle window lifecycle events (resize, minimize, maximize, close)
- Coordinate keyboard shortcuts across all tools and commands
- Manage focus states between panels, toolbars, and the viewport
- Integrate the Main 3D Viewport component into the center layout region
- Provide context-sensitive UI updates based on selection state from the viewport
- Enable/disable menu items and toolbar buttons based on application state

## Contained Components

This component must implement all of the following sub-components within its codebase:

### Main Toolbar (`toolbar.main`)
Horizontal toolbar at the top containing primary tool buttons: Select, Line, Rectangle, Circle, Arc, Push/Pull, Move, Rotate, Scale, Offset, Eraser, Paint Bucket, Orbit, Pan, Zoom. Each button displays an icon and tooltip showing the keyboard shortcut. Triggers tool activation in the viewport and solid operations.

### Drawing Toolbar (`toolbar.drawing`)
Vertical toolbar docked on the left side. Organized in groups:
- **Drawing**: Line, Rectangle, Circle, Arc, Polygon, Freehand
- **Modification**: Push/Pull, Sweep, Offset, Move, Rotate, Scale
- **Construction**: Tape Measure, Protractor, Axes, Dimension, 3D Text/Label

### Views Toolbar (`toolbar.views`)
Secondary toolbar for view controls:
- **Standard Views**: Front, Back, Left, Right, Top, Bottom, Iso
- **Render Modes**: Wireframe, Shaded, Textured, X-Ray
- **Zoom Controls**: Zoom Extents, Zoom Window
- **Section Planes**: Section plane activation and management

### Application Menu (`menu.main`)
Native Electron menu bar with the following menus:
- **File**: New, Open, Save, Save As, Import, Export, Recent Files
- **Edit**: Undo, Redo, Cut, Copy, Paste, Delete, Select All
- **Draw**: All drawing tools
- **Tools**: All modification tools
- **View**: Render modes, toolbars visibility, panels visibility
- **Camera**: Standard views, projection mode (orthographic/perspective)
- **Window**: Panel management
- **Plugins**: Plugin management and extension point
- **Help**: Documentation, about dialog

### Context Menu (`menu.context`)
Right-click context menu that adapts based on selection:
- **Faces**: Edit Material, Reverse Face, Intersect Faces, Make Group/Component, Entity Info
- **Edges**: Divide, Weld, Hide
- **Groups/Components**: Edit Group, Explode, Make Unique, Lock
- **Empty Space**: Paste, Select All, Zoom Extents

### Entity Info Panel (`panel.properties`)
Right-side panel showing properties of selected entities:
- Entity type, layer assignment, material assignment
- Editable dimensions (length, width, height, radius, angle)
- Calculated area/volume for faces and solids
- Component definition info (instances, description)
- Updates in real-time as selection changes

### Outliner Panel (`panel.outliner`)
Hierarchical tree view of all scene objects:
- Groups, components, and loose geometry in nested structure
- Drag-and-drop reordering within hierarchy
- Per-entity visibility and lock toggles
- Search/filter functionality
- Double-click to enter group/component editing context
- Triggers selection in viewport when tree items are clicked

### Layers Panel (`panel.layers`)
Layer (Tags) management:
- Create, rename, delete layers
- Toggle visibility and lock state per layer
- Assign selected entities to layers
- Active layer indicator (new geometry defaults to this layer)
- Color-by-layer display mode toggle

### Components Panel (`panel.components`)
Component definition browser:
- Lists all component definitions in the current model
- Thumbnail preview for each component
- Instance count and description display
- Create new components from selection
- Edit component definition in-place
- Import components from local `.skp` files

### Measurements Panel (`panel.measurements`)
Bottom status bar showing the VCB (Value Control Box):
- Displays current measurement during drawing operations (length, angle, radius)
- Accepts typed numeric input for precise value entry
- Shows axis lock indicators (red=X, green=Y, blue=Z)
- Displays inference engine status and snap indicators
- Shows cursor coordinates in model space

## APIs and Integration

### Window Lifecycle
- Must initialize as an Electron renderer process with the following BrowserWindow options:
  - Dimensions: 1400×900, minimum 800×600
  - Title: "DraftDown"
  - `webPreferences`: `nodeIntegration: false`, `contextIsolation: true`, `preload: "preload.js"`
  - DevTools enabled for development builds

### Viewport Integration
- Embeds the Main 3D Viewport (`viewport.main`) component in the center layout region
- Passes selection change events from the viewport to Entity Info Panel, Outliner Panel, and context menu
- Forwards tool activation requests from toolbars/menus to the viewport
- Receives viewport state updates (camera position, render mode, active tool) to update toolbar/menu states

### IPC Communication
- Communicates with the main process via the preload bridge for:
  - File operations (New, Open, Save, Save As, Import, Export)
  - Menu command invocations (Undo, Redo, Cut, Copy, Paste)
  - Window management (minimize, maximize, close)
  - Recent files list updates
- All IPC calls must respect `contextIsolation: true` security model

### Tool Activation Contract
All toolbars and menus trigger tool activation through a consistent interface:
- Tool ID (e.g., `"tool.line"`, `"tool.pushpull"`)
- Tool parameters (optional configuration object)
- Keyboard shortcut association
- Enable/disable state based on current selection or application mode

### Selection Event Contract
Entity Info Panel, Outliner Panel, Layers Panel, and Context Menu must respond to selection events with the following data:
- `entityIds`: Array of selected entity UUIDs
- `entityTypes`: Array of types (face, edge, vertex, group, component)
- `properties`: Map of entity UUID to property object (dimensions, material, layer, locked state)

### Panel State Persistence
Each panel's state must be persisted locally:
- Visibility (collapsed/expanded)
- Size (width/height)
- Position in dock (if multiple panels can occupy same dock region)
- Panel-specific state (e.g., Outliner tree expansion state, Components panel selected definition)

## Data

### Read
- **Selection State**: From the Main 3D Viewport — entity IDs, types, bounding boxes, properties
- **Scene Hierarchy**: From the scene graph service — groups, components, layers, definitions
- **Viewport State**: Camera position, projection mode, render mode, active tool, grid settings
- **Application State**: Recent files list, user preferences (theme, units, shortcuts), plugin registrations

### Write
- **Tool Commands**: To the viewport and command system — tool activation, parameter changes
- **Entity Modifications**: Property edits from Entity Info Panel — dimensions, material, layer assignment
- **Scene Structure Changes**: From Outliner Panel — reorder, hide/show, lock/unlock, group/ungroup
- **Layer Changes**: From Layers Panel — create/delete layers, assign entities to layers
- **Window State**: Geometry (position, size), panel visibility and sizes, active panel tabs

### Storage Location
- **Window Geometry**: Persisted in local storage or user preferences file (JSON)
- **Panel State**: Persisted in local storage keyed by panel ID
- **Theme Selection**: Persisted in user preferences
- **Recent Files**: Managed by main process, retrieved via IPC

## Security Constraints

- **Data Classification**: UI state and user preferences are considered non-sensitive local data
- **Process Isolation**: Runs in Electron renderer process with `contextIsolation: true` and `nodeIntegration: false`
- **IPC Security**: All communication with main process must go through the preload bridge — no direct Node.js API access
- **File System Access**: File open/save dialogs and file I/O are handled by the main process via IPC — renderer never accesses file system directly
- **Plugin Security**: Plugins loaded through the plugin architecture must execute in isolated contexts — UI integration must not expose Node.js APIs to plugin code
- **Trusted Boundaries**: The renderer process trusts data from the main process (file contents, preferences) but must sanitize user input from text fields, measurements panel, and property editors before sending commands

## Dependencies

### Consumes
- **Main 3D Viewport** (`viewport.main`): Embedded as the center region component — provides selection events, receives tool commands
- **Main Renderer Process** (`process.renderer`): Parent process context — provides Electron APIs via preload bridge

### Depended On By
- **3D Designer** (actor): Primary user who interacts with this window
- **File I/O E2E Tests** (`test.e2e.file_io`): Tests file operations through this window's menus and dialogs
- **UI E2E Tests** (`test.e2e.ui`): Tests toolbar, menu, and panel interactions

### External Dependencies
- React for component rendering
- Electron BrowserWindow API (via main process IPC)
- Three.js (indirectly via Main 3D Viewport)
- Local storage API for state persistence

## Constraints

- Must support both dark and light themes with consistent styling across all contained components
- Layout must be fully responsive to window resizing down to minimum 800×600
- All panels must be resizable with drag handles, collapsible with toggle buttons
- Keyboard shortcuts must work globally across all panels and viewport (no focus conflicts)
- Menu items and toolbar buttons must accurately reflect enabled/disabled state based on selection
- The Measurements Panel must always be visible (not collapsible) as it provides critical VCB input
- DevTools access must be enabled in development but can be disabled in production builds
- Right-click context menu must appear within 100ms of right-click event
- Panel state changes (resize, collapse) must feel instantaneous (<16ms animation frame)
- Must handle tool activation requests from multiple sources (keyboard, toolbar, menu) without conflicts

## Tool and Command Organization

Each tool referenced in toolbars and menus corresponds to a tool ID in the architecture:
- Select, Line, Rectangle, Circle, Arc, Polygon, Push/Pull, Move, Rotate, Scale, Offset, Sweep, Eraser, Paint Bucket, Orbit, Pan, Zoom, Section Plane, Tape Measure, Protractor, Dimension, 3D Text/Label

Solid operations (Union, Intersect, Subtract, Trim, Split) are triggered from the Tools menu and Main Toolbar.

All tool activation flows through a consistent command pattern allowing undo/redo support.

## References

- Electron BrowserWindow documentation for window options and lifecycle
- React documentation for component patterns and hooks
- DraftDown UI conventions for toolbar organization, panel behavior, and VCB input patterns
- Three.js for understanding the viewport integration contract (though rendering is delegated)