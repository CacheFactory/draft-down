# Dimension Tool

## What This Component Is

The Dimension Tool enables users to add measurement annotations to 3D models in DraftDown. It is an interactive tool in the Drawing Toolbar that allows users to click two points in the scene to create dimension annotations showing distances, angles, or radii. These annotations are associative — they automatically update when the underlying geometry changes.

This component is responsible for:
- Capturing user input to define dimension endpoints
- Creating dimension annotation entities in the scene
- Managing dimension visual representation (leader lines, measurement text, arrows)
- Maintaining associative relationships between dimensions and geometry
- Supporting linear, radial, and angular dimension types
- Storing dimension entities in a dedicated annotation layer

## Component Identity

- **ID**: `tool.dimension`
- **UUID**: `gHVP0JyU`
- **Category**: annotation
- **Keyboard Shortcut**: `D`
- **Cursor**: crosshair
- **Implementation Language**: TypeScript
- **Complexity**: moderate

## APIs and Interfaces

### Tool Activation Interface
Must implement standard DraftDown tool lifecycle:
- Activate when selected from Drawing Toolbar or `D` key pressed
- Set cursor to crosshair
- Deactivate when another tool is selected

### User Input Interface
Must handle mouse events:
- First click: capture start point for dimension
- Second click: capture end point and create dimension entity
- Hover: show preview of dimension line and measurement
- Must integrate with Snap Point Constraint (`constraint.snap_point`) to enable snapping to vertices, edges, midpoints, etc.

### Scene Modification Interface
Must modify Scene Manager (`data.scene`) to:
- Create dimension annotation entities
- Add entities to dedicated annotation layer
- Register associative relationships between dimensions and geometry elements
- Update dimension entities when referenced geometry changes

### Dimension Entity Data Shape
Dimension entities must include:
- Unique identifier
- Dimension type: `linear`, `radial`, or `angular`
- Reference points or geometry elements (IDs or coordinates)
- Measured value (distance, angle, or radius)
- Visual properties: leader line geometry, text position, arrow style
- Layer assignment: annotation layer
- Associativity data: references to geometry elements that drive the dimension

## Data Operations

### Reads From
- Scene Manager: geometry data for snap targets, current layer state
- Snap Point Constraint: computed snap points during input

### Writes To
- Scene Manager: dimension annotation entities with:
  - Geometry references (element IDs, coordinates)
  - Measurement values
  - Visual representation data (lines, text, arrows)
  - Layer assignment (annotation layer)
  - Associativity metadata

### Associative Updates
When geometry changes, the tool's dimension entities must:
- Detect changes to referenced geometry
- Recalculate measurement values
- Update visual representation (leader line positions, text)
- Persist updated dimension data to Scene Manager

## Dependencies

### Incoming Dependencies
- **Drawing Toolbar** (`toolbar.drawing`): contains this tool as a selectable option
- **Tool E2E Tests** (`test.e2e.tools`): validates tool behavior end-to-end

### Outgoing Dependencies
- **Scene Manager** (`data.scene`): reads geometry for snapping, writes dimension entities
- **Snap Point Constraint** (`constraint.snap_point`): provides snap point computation during dimension point selection

## Security and Data Classification

- All dimension data is user-generated and stored locally in the scene file
- No external network calls or cloud dependencies
- Dimension entities must be serializable for save/load operations
- No sensitive data handling — dimensions are geometric annotations

## Requirements and Constraints

### Functional Requirements
1. Must support linear dimensions: straight-line distance between two points
2. Must support radial dimensions: radius or diameter of circular geometry
3. Must support angular dimensions: angle between two lines or edges
4. Dimensions must be associative: automatically update when referenced geometry moves
5. Must display measurement text with appropriate units
6. Must draw leader lines connecting dimension to geometry
7. Must include arrows or tick marks at dimension endpoints
8. All dimension entities must reside in a dedicated annotation layer
9. Must integrate with Snap Point Constraint for precise point selection
10. Must show live preview during dimension creation

### UI/UX Requirements
- Cursor changes to crosshair when tool is active
- First click initiates dimension, second click completes it
- Preview shows dimension line and measurement value before second click
- Dimensions must be visually distinct from modeling geometry
- Measurement text must remain legible at various zoom levels

### Performance Requirements
- Dimension preview must update in real-time as mouse moves
- Associative updates must occur without noticeable lag when geometry changes
- Must handle scenes with hundreds of dimensions without performance degradation

### Data Integrity Requirements
- Dimension entities must maintain valid references to geometry
- If referenced geometry is deleted, dimension must either update or be marked invalid
- Measurement values must be calculated with appropriate precision
- Units must be consistent with scene/project settings

### Implementation Constraints
- Must follow DraftDown tool architecture and lifecycle patterns
- Must use Scene Manager APIs for all data persistence
- Must not directly manipulate Three.js scene graph — use Scene Manager abstraction
- TypeScript implementation with moderate complexity expected

## Sub-Components

No distinct sub-components are explicitly required, but the implementation must internally handle:
- Input state machine (awaiting first point, awaiting second point, complete)
- Dimension geometry calculation (linear, radial, angular)
- Associative relationship tracking
- Visual representation generation (lines, text, arrows)
- Preview rendering

## Testing Surface

Tool E2E Tests (`test.e2e.tools`) must validate:
- Tool activation via toolbar and keyboard shortcut
- Dimension creation workflow (two-click interaction)
- Snap point integration during point selection
- Correct measurement calculation for all dimension types
- Associative update behavior when geometry changes
- Dimension persistence across save/load cycles
- Annotation layer assignment
- Preview rendering during dimension creation