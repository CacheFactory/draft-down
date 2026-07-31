# Select Tool

## Component Identity
- **ID**: `tool.select`
- **UUID**: `ceUtTwvQ`
- **Layer**: interaction
- **Language**: TypeScript
- **Complexity**: complex

## Purpose

The Select Tool is the primary interaction tool for choosing entities in the 3D scene. It enables users to select faces, edges, vertices, groups, and components through clicking, box selection, and multi-click gestures. It supports modifier-based selection modes (add, toggle), provides pre-selection visual feedback, and handles navigation into group/component editing contexts.

## Responsibilities

### Selection Operations
- Single-click selection: Replace current selection with clicked entity or clear if no hit
- Shift+click: Toggle entity in/out of selection set
- Ctrl+click: Add entity to current selection without deselecting others
- Box selection with directional semantics:
  - Left-to-right drag: Window select (only fully enclosed entities)
  - Right-to-left drag: Crossing select (entities intersecting or inside box)
- Double-click on group/component: Enter editing context for that entity
- Triple-click: Select all connected geometry from the clicked entity
- Clear selection when clicking empty space (without modifiers)

### Visual Feedback
- Pre-selection highlighting: Show subtle overlay on entity under cursor during mouse movement (before click)
- Box selection visualization: Draw selection rectangle with color indicating mode (window vs crossing)
- Maintain distinct visual states: pre-selection vs full selection

### State Management
- Track tool state: `idle`, `clicking`, `box-selecting`, `dragging`
- Detect multi-click patterns: double-click within 300ms, triple-click within 500ms
- Distinguish click from drag: threshold of 5 pixels movement before treating as drag
- Track box selection direction based on start/end coordinates
- Maintain hover state for pre-selection

## APIs Exposed

### Tool Interface
```typescript
interface ITool {
  readonly id: 'tool.select';
  readonly category: 'select';
  readonly shortcut: 'Space';
  readonly cursor: 'pointer';
  
  activate(ctx: ToolContext): void;
  deactivate(): void;
  onMouseDown(event: MouseEvent3D): void;
  onMouseMove(event: MouseEvent3D): void;
  onMouseUp(event: MouseEvent3D): void;
  onKeyDown(event: KeyEvent): void;
  onKeyUp(event: KeyEvent): void;
}
```

### Configuration
```typescript
interface SelectToolConfig {
  doubleClickTimeout: number; // default 300ms
  tripleClickTimeout: number; // default 500ms
  dragThreshold: number; // default 5 pixels
  boxSelectColor: { 
    window: string; 
    crossing: string; 
  };
}
```

### Internal State
```typescript
interface SelectToolState {
  mode: 'idle' | 'clicking' | 'box-selecting' | 'dragging';
  boxStart: Vector2 | null;
  boxEnd: Vector2 | null;
  boxDirection: 'window' | 'crossing';
  lastClickTime: number;
  clickCount: number;
  hoverEntity: Entity | null;
}
```

## APIs Consumed

### Selection Manager (`data.selection`)
- `selectionManager.replace(entity)` — Replace entire selection with single entity
- `selectionManager.clear()` — Clear all selections
- `selectionManager.toggle(entity)` — Add if not selected, remove if selected
- `selectionManager.add(entity)` — Add to selection without affecting others
- `selectionManager.selectConnected(entity)` — Select all geometry connected to entity
- Must respect selection modes and entity filtering rules defined by Selection Manager

### Scene Manager (`data.scene`)
- `sceneManager.enterEditingContext(entity)` — Enter group/component for editing
- Query entity hierarchy and containment
- Access entity types: faces, edges, vertices, groups, components
- Obtain entity geometry bounds for box selection tests

### Raycasting System
- `performRaycast(event: MouseEvent3D): RaycastResult | null` — Convert screen coordinates to 3D hits
- `RaycastResult` contains: `entity`, `point`, `normal`, `distance`

### Inference System
- Consume inference results for connected geometry queries (triple-click)
- `InferenceResult` provides geometry relationships and connectivity data

### Math Utilities
- `Rect2D` for box selection bounds
- `Vector2` for screen-space coordinates
- `Vector3` for 3D positions

## Data Contracts

### Input Events
- `MouseEvent3D`: Contains screen coordinates, 3D ray, modifier keys (shift, ctrl, alt)
- `KeyEvent`: Key code, modifier states
- Must handle coordinate transformations between screen space and 3D world

### Selection Modes
- **Window**: Entity bounding box must be fully inside selection rectangle
- **Crossing**: Entity bounding box intersects or is inside selection rectangle
- Direction determined by comparing `boxStart` and `boxEnd` X-coordinates

### Entity Types
Support selection of:
- Individual faces
- Individual edges
- Individual vertices
- Groups (collections of geometry)
- Components (reusable geometry instances)

## Dependencies

### Required Components
- **Selection Manager** (`data.selection`): Storage and state management for selected entities
- **Scene Manager** (`data.scene`): Scene graph access, entity queries, editing context management
- **Raycasting System**: 3D picking and hit testing
- **Inference System**: Geometry connectivity analysis for triple-click
- **Math Library**: Vector2, Vector3, Rect2D types

### Integration Points
- **Main Toolbar** (`toolbar.main`): Tool activation trigger
- **Application Menu** (`menu.main`): Keyboard shortcut registration
- **Click Gesture** (`gesture.click`): Unified click detection
- **Outliner Panel** (`panel.outliner`): May trigger selection programmatically
- **Layers Panel** (`panel.layers`): May trigger selection programmatically
- **Components Panel** (`panel.components`): May trigger selection programmatically
- **Plugin System** (`plugin.system`): Extensibility for custom selection behaviors

## Behavioral Requirements

### Click Detection
- Track `mouseDown` position and `mouseUp` position
- If distance < `dragThreshold` pixels: treat as click
- If distance >= `dragThreshold`: treat as drag/box-select
- Track timestamp of each click to detect double/triple clicks

### Multi-Click Timing
- Single click: Execute immediately on mouse up
- Double click: Detect if second click within `doubleClickTimeout` (300ms)
- Triple click: Detect if third click within `tripleClickTimeout` (500ms) of first click
- Reset click counter after timeout expires

### Box Selection Direction
- Store `boxStart` on mouse down
- Update `boxEnd` on mouse move
- If `boxEnd.x >= boxStart.x`: window mode (left-to-right)
- If `boxEnd.x < boxStart.x`: crossing mode (right-to-left)
- Query entities using appropriate inclusion test

### Pre-selection Feedback
- On every `onMouseMove`: perform raycast
- If hit: update `hoverEntity` and trigger visual highlight
- If no hit: clear `hoverEntity` and remove highlight
- Pre-selection visual must be distinct from full selection

### Context Entry
- Double-click on group/component: call `sceneManager.enterEditingContext(entity)`
- Must validate entity is editable before entering context
- Update UI breadcrumb/navigation state

## Security & Constraints

### Data Classification
- **Public**: Tool configuration, state machine transitions
- **Internal**: Selection state, entity references

### Performance Constraints
- Raycasting must complete within 16ms for 60fps responsiveness
- Box selection queries must handle scenes with 10,000+ entities efficiently
- Pre-selection updates must not degrade mouse tracking responsiveness

### Trust Boundaries
- Validate raycast results before applying to selection
- Ensure entities returned from scene queries are valid and accessible
- Handle null/undefined entities gracefully in all selection operations

### Plugin Extensibility
- Plugin System may extend selection behavior via hooks
- Must provide extension points for custom entity types
- Plugin-added selection logic must not break core selection semantics

## Testing Requirements

- **Tool E2E Tests** (`test.e2e.tools`): Must verify all click patterns, box selection modes, modifier key combinations
- Test single/double/triple click detection with timing variations
- Test box selection with window vs crossing modes
- Test pre-selection feedback rendering
- Test context entry and exit
- Test modifier key combinations: shift, ctrl, shift+ctrl
- Test edge cases: rapid clicks, zero-size selection boxes, clicking outside scene bounds

## Notes

This tool is the primary user interaction mechanism. Its responsiveness and visual feedback quality directly impact perceived application performance and usability. All selection operations must feel instantaneous (<100ms from input to visual update).

The distinction between window and crossing selection modes is critical for professional CAD workflows — users rely on directional drag semantics.

Pre-selection highlighting is essential for spatial awareness and click confidence — users must know what they're about to select before committing the click.