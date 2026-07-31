# Tool E2E Tests

## Overview

The Tool E2E Tests component is a comprehensive Playwright-based test suite that validates all interactive tools in the DraftDown 3D CAD application through end-to-end user workflows. This suite launches the full Electron application and exercises complete tool interactions from activation through geometry creation to undo/redo operations.

## Responsibilities

- Test all 23 interactive tools through complete user workflows
- Validate tool activation via toolbar, keyboard shortcuts, and context switches
- Verify geometry creation, modification, and deletion operations
- Test mouse interactions (click, drag, scroll, middle-button) on the 3D viewport
- Validate Value Control Box (VCB) input for precise numeric entry
- Test selection mechanisms (single click, shift-click, box selection window/crossing)
- Verify camera navigation (orbit, pan, zoom)
- Test undo/redo operations across all tool workflows
- Validate multi-step workflows combining multiple tools
- Test tool interactions with pre-built fixture models
- Verify document dirty state and save operations

## Test Coverage

The suite must cover all interactive tools:

**Drawing Tools**: Select, Line, Rectangle, Circle, Arc, Polygon

**Modeling Tools**: Push/Pull, Move, Rotate, Scale, Offset, Sweep

**Editing Tools**: Eraser, Paint Bucket, Solid Tools (union, subtract, intersect, trim)

**Navigation Tools**: Orbit, Pan, Zoom

**Measurement Tools**: Tape Measure, Protractor, Dimension

**Other Tools**: 3D Text/Label, Section Plane

## Test Scenarios

### Tool Activation
- Activate tool via toolbar click
- Activate tool via keyboard shortcut
- Verify active tool state persists correctly
- Verify tool deactivation when switching to another tool

### Geometry Operations
- Create basic geometry (lines, rectangles, circles, etc.)
- Modify existing geometry (push/pull faces, move/rotate/scale entities)
- Delete geometry (eraser tool, delete key)
- Verify vertex, edge, and face counts after operations
- Validate bounding box dimensions for created geometry

### Mouse Interactions
- Single click for point selection and tool actions
- Double-click for repeat operations
- Click-drag for creating shapes and moving entities
- Shift-click for multi-selection
- Left-to-right drag for window selection (fully inside)
- Right-to-left drag for crossing selection (intersecting)
- Middle-button drag for orbit
- Scroll wheel for zoom

### VCB Input
- Type numeric values for exact dimensions
- Validate comma-separated multi-value input (e.g., "6000,4000" for width,height)
- Verify VCB input applies to active operation
- Test VCB with different unit formats

### Selection Workflows
- Select single entity by click
- Deselect by clicking empty space
- Multi-select via shift-click
- Box select (window vs crossing modes)
- Verify selection count and selected entity IDs
- Test selection persistence across tool switches

### Undo/Redo
- Undo single operation
- Undo multiple operations sequentially
- Redo after undo
- Verify undo/redo button availability states
- Validate geometry state after undo/redo

### Complex Workflows
- Draw closed loop and verify face creation
- Extrude face to create solid (push/pull)
- Boolean operations on overlapping solids
- Multi-tool workflows (draw → extrude → move → rotate)
- Save document after modifications
- Verify dirty state before and after save

## Test Fixtures

The suite must use test model fixtures from `test.fixture.models`:

- **Empty Scene**: Blank canvas for drawing from scratch
- **Unit Rectangle**: Single flat rectangular face (1000mm × 1000mm)
- **Cube**: Single 1000mm cube
- **Two Rectangles**: Two separated rectangular faces
- **Two Cubes**: Two separated cubes
- **Overlapping Cubes**: Two cubes positioned to intersect
- **Scattered Cubes**: Multiple cubes at various positions for selection testing
- **House Model**: Pre-built house geometry for complex interaction testing
- **Multi-Component Scene**: Multiple components/groups for advanced operations

## Helper Interfaces

### ViewportHelper
Must provide methods to interact with the 3D viewport canvas:

**Mouse Actions**:
- `clickAt(x, y)` — Click at viewport coordinates
- `doubleClickAt(x, y)` — Double-click at coordinates
- `dragFrom(x1, y1, x2, y2)` — Click-drag gesture
- `scrollAt(x, y, delta)` — Scroll wheel at coordinates
- `middleDragFrom(x1, y1, x2, y2)` — Middle-button drag

**Tool Control**:
- `activateTool(toolId)` — Activate tool by ID (e.g., "tool.line")
- `pressShortcut(key)` — Send keyboard shortcut
- `typeVCB(value)` — Type value into Value Control Box

**Geometry Queries** (via IPC to renderer process):
- `getVertexCount()` — Count vertices in scene
- `getFaceCount()` — Count faces in scene
- `getEdgeCount()` — Count edges in scene
- `getEntityCount(type)` — Count entities of specific type
- `getSelectionCount()` — Count selected entities
- `getSelectedIds()` — Get array of selected entity IDs
- `getMeshBoundingBox()` — Get min/max bounds of geometry

### AppHelper
Must provide application-level control:

**Lifecycle**:
- `launch()` — Launch Electron app
- `close()` — Close Electron app
- `newDocument()` — Create new empty document
- `loadFixture(name)` — Load fixture model by name

**State Assertions**:
- `expectToolActive(toolId)` — Verify active tool matches ID
- `expectUndoAvailable(available)` — Verify undo button enabled state
- `expectRedoAvailable(available)` — Verify redo button enabled state
- `expectDirty(dirty)` — Verify document dirty flag

**Exposed Properties**:
- `electronApp` — Playwright ElectronApplication instance
- `page` — Playwright Page instance for main window
- `viewport` — ViewportHelper instance

## IPC Communication Requirements

The test suite must communicate with the Electron renderer process to:

- Query geometry data (vertex/face/edge counts, bounding boxes)
- Query selection state (count, IDs)
- Query tool state (active tool ID)
- Query application state (undo/redo availability, dirty flag)

This requires IPC channels or `contextBridge` exposure from the Electron app to provide test-only query APIs.

## Test Execution Constraints

- **Framework**: Playwright Test for TypeScript
- **Target**: Electron application (not browser)
- **Timeout**: 30,000ms default per test
- **CI Compatibility**: Must run in headless CI environments
- **Parallelization**: Tests should be independent and parallelizable where possible
- **Cleanup**: Each test must clean up (close app, restore state) to avoid interference

## Test Data Classification

- **All test data**: Public (no sensitive information)
- **Fixture models**: Committed to repository
- **Test artifacts**: Screenshots/traces for debugging only, not stored long-term

## Dependencies

### Required External Components
- **Playwright** (`lib.playwright`): Test execution framework for Electron

### Tested Components (all tools)
- `tool.select` — Select Tool
- `tool.line` — Line Tool
- `tool.rectangle` — Rectangle Tool
- `tool.circle` — Circle Tool
- `tool.arc` — Arc Tool
- `tool.polygon` — Polygon Tool
- `tool.pushpull` — Push/Pull Tool
- `tool.move` — Move Tool
- `tool.rotate` — Rotate Tool
- `tool.scale` — Scale Tool
- `tool.offset` — Offset Tool
- `tool.eraser` — Eraser Tool
- `tool.paint` — Paint Bucket Tool
- `tool.orbit` — Orbit Tool
- `tool.pan` — Pan Tool
- `tool.zoom` — Zoom Tool
- `tool.tape_measure` — Tape Measure Tool
- `tool.protractor` — Protractor Tool
- `tool.dimension` — Dimension Tool
- `tool.text` — 3D Text/Label Tool
- `tool.sweep_tool` — Sweep Tool
- `tool.solid_tools` — Solid Tools
- `tool.section_plane` — Section Plane Tool

### Test Fixtures
- `test.fixture.models` — Provides pre-built 3D models for testing

## Security Constraints

- Tests run entirely locally on developer machines or CI runners
- No network access required
- No authentication/authorization concerns
- Test fixtures may be included in repository (public data only)
- Screenshots and traces may contain application state but no sensitive user data

## Failure Reporting Requirements

Tests must produce clear failure messages indicating:
- Which tool workflow failed
- At which step (e.g., "after extrude", "during selection")
- Expected vs actual geometry counts or states
- Screenshots of viewport state at failure (when possible)
- Console logs and IPC traffic (when relevant)

## Performance Expectations

- Individual tool tests should complete in <5 seconds
- Complex multi-tool workflows may take up to 30 seconds
- Full suite execution time budget: <10 minutes on CI
- Tests should not depend on precise timing (use state polling, not fixed delays)

## Compatibility

- Must work on Windows, macOS, and Linux (all Electron target platforms)
- Must handle different screen resolutions and DPI settings
- Viewport coordinates should be relative to canvas dimensions, not absolute pixels where possible