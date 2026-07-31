# UI E2E Tests

## Identity
- **ID**: `test.e2e.ui`
- **UUID**: `bKoj9Yyd`
- **Type**: test_suite
- **Framework**: Playwright
- **Language**: TypeScript

## Purpose

This test suite validates all UI elements and interactions in the DraftDown Electron application through end-to-end testing. It must verify that windows, panels, toolbars, menus, dialogs, and all interactive UI components behave correctly in a real application environment.

## Responsibilities

- Test window lifecycle: main window, preferences window, materials browser window
- Validate window dimensions, modality, and focus behavior
- Test panel interactions: collapse, expand, resize, visibility toggling
- Verify toolbar button states, activation, and visual feedback
- Test menu navigation and context-sensitive menu items
- Validate the Measurements / VCB (Value Control Box) display and input
- Test the preferences dialog and settings persistence
- Verify outliner tree interactions and scene hierarchy display
- Test layers panel visibility controls
- Validate components panel behavior
- Test entity info panel property display

## Test Coverage

### Window Management
- Main window opens with minimum dimensions (800×600)
- Preferences window opens as modal
- Materials browser opens as floating window
- Window focus and activation behavior
- Multiple window coordination

### Panel Interactions
- Entity info panel displays selected entity properties (type, dimensions, materials)
- Outliner shows scene hierarchy with correct item count
- Outliner item click selects corresponding entity in viewport
- Layers panel toggles visibility of geometry on specific layers
- Panels collapse and expand via collapse button
- Panels resize by dragging resize handles
- Panel content visibility matches collapsed/expanded state

### Toolbar Interactions
- Toolbar button click activates corresponding tool
- Active tool button displays highlight/active class
- Tooltips display tool names and keyboard shortcuts on hover
- Tool state persists across panel interactions

### Menu Interactions
- File > New creates empty document (zero face count)
- Edit > Undo reverts last action (restores previous state)
- Context menu on selected face shows face-specific options: "Reverse Face", "Entity Info"
- Context menu on empty canvas shows general options: "Paste", "Select All"
- Menu items enable/disable based on application state

### Measurements / VCB
- VCB displays real-time measurement during line drawing
- VCB accepts typed numeric values
- Pressing Enter after typing value sets exact dimension
- VCB units match preferences setting

### Preferences Dialog
- Preferences opens via keyboard shortcut (Ctrl+,)
- Units setting changes VCB display format (inches, feet, meters, etc.)
- Custom keyboard shortcuts persist after dialog close
- Preferences save button commits changes

## Test Environment

- **CI Execution**: Yes — must run in continuous integration pipeline
- **Timeout**: 30000ms default per test
- **Fixtures Required**:
  - Default window layout
  - Custom layout presets
  - `cube` — single cube geometry for basic tests
  - `grouped-scene` — scene with 5 items in hierarchy
  - `layered-scene` — scene with multiple layers

## Testing Contracts

### Fixture Loading
Tests must use `app.loadFixture(name)` to load pre-defined scene states. Fixture names reference standard test models stored outside this test suite.

### Test Helpers
Tests must access application state through helper methods:
- `app.viewport.activateTool(toolId)` — activate a tool by ID
- `app.viewport.clickAt(x, y)` — simulate viewport click at coordinates
- `app.viewport.getFaceCount()` — return current face count
- `app.viewport.getSelectionCount()` — return selected entity count
- `app.expectToolActive(toolId)` — assert tool is active

### Data Test IDs
All UI elements must expose `data-testid` attributes for reliable selection:
- `menu-file`, `menu-edit`, `menu-window` — menu items
- `menu-new`, `menu-preferences`, `menu-undo` — submenu items
- `tool-button-line`, `tool-button-select` — toolbar buttons
- `panel-properties`, `panel-outliner` — panel containers
- `outliner-item-{id}` — outliner tree items
- `layer-toggle-{name}` — layer visibility toggles
- `vcb-value` — VCB display element
- `context-menu` — context menu container
- `panel-resize-handle` — panel resize drag handle
- `pref-units`, `pref-save` — preferences controls

### Electron API Access
Tests must access Electron BrowserWindow API via `app.electronApp.evaluate()` to:
- Query window dimensions with `BrowserWindow.getAllWindows()[0].getSize()`
- Wait for new windows with `app.electronApp.waitForEvent('window')`
- Verify window modality and parent relationships

## Dependencies

### Components Under Test
- **Main Window** (`window.main`): Primary application window containing viewport and panels
- **Preferences Window** (`window.preferences`): Modal settings dialog
- **Materials Browser** (`window.materials`): Floating materials selection window
- **WebGL Renderer** (`renderer.webgl`): Viewport rendering engine (tested indirectly via viewport interactions)

### Test Framework
- **Playwright** (`lib.playwright`): Provides Electron test harness, page interaction APIs, and assertions

## Security & Data Constraints

- Tests run against local Electron application — no network requests required
- Fixtures load from local test data directory
- No user data or preferences persistence across test runs
- Each test starts with clean application state

## Integration Points

### Application Launch
Tests must launch the Electron application with clean profile:
```typescript
const electronApp = await electron.launch({ args: ['--test-mode'] });
const page = await electronApp.firstWindow();
```

### Viewport Interaction
Tests interact with 3D viewport through canvas element mouse events:
- `page.click('canvas', { position: { x, y } })` for entity selection
- `page.mouse.move()`, `page.mouse.down()`, `page.mouse.up()` for drag operations

### Keyboard Input
Tests simulate keyboard shortcuts:
- `page.keyboard.press('Control+,')` for preferences
- `page.keyboard.type('1000')` for VCB value entry
- `page.keyboard.press('L')` for tool shortcuts

### State Verification
Tests verify application state by:
- Querying DOM elements for visibility and content
- Checking element classes for active/inactive states
- Calling helper methods to query geometry counts
- Inspecting VCB text content for measurements

## Failure Scenarios

Tests must handle:
- Timeout on window creation (window never appears)
- Element not found (data-testid missing)
- Incorrect element state (button not active when expected)
- Geometry count mismatch (fixtures not loaded correctly)
- VCB empty when value expected

## Success Criteria

- All window lifecycle tests pass
- All panel interaction tests pass
- All toolbar and menu tests pass
- All VCB and measurement tests pass
- Preferences changes persist correctly
- No test exceeds 30000ms timeout
- Tests run successfully in CI environment