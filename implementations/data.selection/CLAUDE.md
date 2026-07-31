# Selection Manager

## Overview

The Selection Manager (`data.selection`) maintains the current selection state for the DraftDown 3D modeling application. It tracks which entities (vertices, edges, faces, groups, component instances) are currently selected by the user, supports multiple selection modes, and broadcasts selection change events to dependent UI and rendering components.

## Responsibilities

- Maintain current selection state including selected entity IDs and selection mode
- Support multiple selection modes: object, face, edge, vertex
- Track pre-selection state (hover highlighting) separately from committed selection
- Provide APIs for adding, removing, toggling, and clearing selections
- Implement box selection for selecting multiple entities within a 2D screen rectangle
- Enforce selection rules based on current mode and editing context
- Emit events when selection or pre-selection changes
- Provide query methods to retrieve selected entities by type
- Clear sub-selections when exiting an editing context

## Selection Modes

- **object**: Clicking a face selects its parent group/component if present, otherwise selects the face as a loose entity
- **face**: Direct selection of face geometry elements
- **edge**: Direct selection of edge geometry elements  
- **vertex**: Direct selection of vertex geometry elements

## API Surface

The component must expose methods matching this contract:

**State Queries:**
- `state`: Read-only access to current selection state (mode, entity IDs, pre-selection ID)
- `isEmpty`: Boolean indicating if selection is empty
- `count`: Number of selected entities

**Selection Operations:**
- `select(entity)`: Replace current selection with single entity
- `add(entity)`: Add entity to current selection
- `remove(entity)`: Remove entity from current selection
- `toggle(entity)`: Toggle entity in/out of selection
- `selectAll()`: Select all entities in current editing context
- `clear()`: Remove all selections
- `selectConnected(entity)`: Select all geometry connected to given entity

**Box Selection:**
- `selectInBox(rect, mode)`: Select entities within 2D screen rectangle
  - `mode: 'window'`: Only entities fully contained in box
  - `mode: 'crossing'`: Entities touching or contained in box

**Queries:**
- `isSelected(entity)`: Check if entity is selected
- `getSelected()`: Return all selected entities
- `getSelectedByType<T>(type)`: Return selected entities of specific type
- `getSelectedFaces()`: Return selected face entities
- `getSelectedEdges()`: Return selected edge entities  
- `getSelectedVertices()`: Return selected vertex entities

**Pre-selection (Hover):**
- `setPreselection(entity)`: Set currently hovered entity for highlight
- `getPreselection()`: Get currently hovered entity

**Mode Management:**
- `setMode(mode)`: Change selection mode
- `getMode()`: Get current selection mode

**Events:**
- `on('selection-changed', handler)`: Subscribe to selection changes
  - Event payload: `{ added, removed, mode, source }`
  - Source indicates trigger: 'click', 'box', 'api', 'outliner'
- `on('preselection-changed', handler)`: Subscribe to hover changes
  - Event payload: entity or null
- `off(event, handler)`: Unsubscribe from events

## Data Types

**SelectionMode:** `'object' | 'face' | 'edge' | 'vertex'`

**SelectableEntity:** Union of Vertex, Edge, Face, or Entity (groups/components)

**SelectionState:**
- `mode`: Current selection mode
- `entities`: Set of selected entity IDs (strings)
- `preselection`: Hovered entity ID or null

**SelectionChangeEvent:**
- `added`: Array of newly selected entities
- `removed`: Array of deselected entities
- `mode`: Selection mode when change occurred
- `source`: What triggered the change ('click' | 'box' | 'api' | 'outliner')

**Rect2D:** 2D rectangle for box selection (x, y, width, height)

## Dependencies

**Consumes:**
- Half-Edge Mesh (`mesh.halfedge`): Vertex, Edge, Face geometry data structures
- Polyline Curve (`curve.polyline`): Curve geometry entities
- Scene graph entities: Groups, component instances, and other scene objects

**Consumed By:**
- Select Tool (`tool.select`): Primary interaction tool that modifies selections based on user clicks and drags
- Solid Tools (`tool.solid_tools`): Operations that act on selected geometry
- Entity Info Panel: Displays properties of selected entities
- Outliner: Tree view that reflects current selection
- Renderer: Highlights selected and pre-selected entities visually

## Selection Rules and Context

- Selection is scoped to the current editing context (e.g., when editing inside a group/component)
- When exiting an editing context, sub-selections (face/edge/vertex) must be cleared
- In object mode, clicking face geometry should select the containing group/component if one exists
- In sub-element modes (face/edge/vertex), clicking directly selects the geometry element
- Multi-selection is enabled (`x.selection.multi: true`)
- Selection changes must emit events synchronously before the operation returns

## Security and Data Classification

- Selection state contains entity IDs which are internal references
- No sensitive user data is stored
- Selection state is application-local, never transmitted externally
- No authentication or encryption required
- Trust boundary: Selection state is trusted within the renderer process

## Implementation Constraints

- Language: TypeScript
- Complexity: Moderate
- Must run in Electron renderer process (`process.renderer`)
- Performance: Selection queries must be fast enough for interactive highlighting (60fps)
- Entity ID storage must support efficient lookup (O(1) or O(log n))
- Event emission must not block UI thread

## Integration Points

- Select Tool reads selection state and calls selection methods on user interaction
- Solid Tools query selected entities to determine operation targets
- Scene & Data Integration Tests (`test.integration.scene`) verify selection behavior
- Renderer subscribes to selection events to update visual highlights
- Outliner subscribes to selection events to update tree selection state
- Entity Info panel subscribes to selection events to update property display

## Existing Code References

None specified — this is a new implementation.