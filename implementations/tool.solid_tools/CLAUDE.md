# Solid Tools

**Component ID:** `tool.solid_tools`  
**Layer:** interaction  
**Kind:** tool

## Purpose

The Solid Tools component provides boolean modeling operations for watertight solid geometry. It enables users to combine, subtract, and intersect solid groups/components through Union, Subtract, Intersect, Trim, and Split operations. The tool validates manifold (watertight) geometry before operating and shows previews before committing changes.

## Responsibilities

- Activate when triggered via keyboard shortcut `Shift+S` or from the Main Toolbar
- Enable users to select two solid groups/components as operands
- Validate that both selected entities are manifold (watertight) before proceeding
- Present a UI for choosing the boolean operation type (Union, Subtract, Intersect, Trim, Split)
- Generate and display a preview of the result geometry
- Allow user to confirm or cancel the operation
- On confirmation, commit the result to the scene and update selection
- Handle edge cases: non-manifold geometry, self-intersecting meshes, degenerate results
- Display appropriate error messages when validation fails
- Set cursor to `pointer` when active
- Display using icon identifier `solid-tools`

## Tool Lifecycle

When activated:
1. Enter solid tool mode
2. Prompt user to select first solid entity (group or component)
3. Prompt user to select second solid entity
4. Validate both entities are manifold
5. Present operation picker UI (Union, Subtract, Intersect, Trim, Split)
6. Generate preview of selected operation
7. Wait for user confirmation or cancellation
8. On confirmation: commit result to scene, clear selection of operands, select result
9. On cancellation: restore original state, clear preview
10. Exit tool mode

## Dependencies

### Scene Manager (`data.scene`)
- Read current scene graph to locate selected groups/components
- Write result geometry back to scene after operation completes
- Remove operand entities if required by operation semantics (e.g., Union consumes both inputs)

### Selection Manager (`data.selection`)
- Read current selection to identify operand entities
- Clear selection of operand entities after operation
- Set selection to the newly created result entity

### Boolean Operations
- **Boolean Union** (`op.boolean_union`): Combine two solids into one
- **Boolean Subtract** (`op.boolean_subtract`): Remove second solid from first
- **Boolean Intersect** (`op.boolean_intersect`): Keep only overlapping volume

Each operation component:
- Accepts two manifold mesh inputs
- Returns manifold mesh output or error
- Performs computation via Manifold engine in mesh worker
- Does not modify scene directly (tool's responsibility)

## Data Contracts

### Input Selection
Both selected entities must be:
- Groups or components (not raw geometry)
- Contain mesh data that forms a closed, manifold volume
- Have no holes, self-intersections, or non-manifold edges
- Have consistent face winding (normals pointing outward)

### Validation Requirements
Before invoking any boolean operation:
- Verify entity type (group or component)
- Extract mesh data from entity
- Check manifold properties:
  - Every edge connects exactly two faces
  - No isolated vertices
  - No duplicate faces
  - Consistent winding order
- If validation fails, display clear error message and prevent operation

### Operation Result
After successful boolean operation:
- Result is a new group containing manifold mesh
- Result geometry is positioned in world space
- Operand entities are removed from scene (or kept based on operation semantics)
- Result entity is selected
- Undo/redo stack records operation with operands and result

### Preview Geometry
During preview phase:
- Display semi-transparent result mesh overlay
- Highlight operand entities
- Allow camera manipulation
- Do not commit changes to scene
- Render preview using temporary Three.js objects

## UI Requirements

### Operation Picker
Present UI (modal, toolbar overlay, or context menu) with:
- Union button/option
- Subtract button/option (with A-B and B-A variants)
- Intersect button/option
- Trim button/option (if distinct from Subtract)
- Split button/option (if applicable)
- Cancel button

### Status Feedback
- Display prompts: "Select first solid", "Select second solid", "Choose operation"
- Show validation errors: "Entity is not manifold", "Entity is not a solid group"
- Indicate preview mode: "Previewing Union — Confirm or Cancel"
- Display progress during computation if operation takes >500ms

### Visual Feedback
- Highlight selected operands during selection phase
- Render preview result with distinct visual treatment (e.g., wireframe overlay, transparency)
- Use cursor `pointer` throughout tool session
- Restore default cursor on tool exit

## Error Handling

### Non-Manifold Geometry
- Detect before invoking operation
- Display message: "Selected geometry is not watertight"
- Allow user to inspect problematic entity
- Prevent operation from proceeding

### Operation Failures
- Catch errors from boolean operation components
- Display message with failure reason (e.g., "Operation resulted in invalid geometry")
- Restore original scene state
- Keep selection on operand entities for retry

### Degenerate Results
- If operation produces zero-volume or invalid result, treat as error
- Do not commit to scene
- Inform user and allow cancellation

## Performance Constraints

- Validation checks must complete in <100ms for typical meshes (<10k faces)
- Preview generation should provide feedback within 200ms or show progress indicator
- Final operation computation delegated to mesh worker (non-blocking)
- Support undo/redo without re-computation (cache operation inputs and outputs)

## Security and Data Integrity

- **Data Classification**: User 3D models (local, private)
- All computation occurs locally in Electron renderer or mesh worker
- No network requests
- Validate mesh data integrity before passing to Manifold engine
- Prevent buffer overflows or infinite loops from malformed mesh inputs
- Sanitize entity references to prevent access to non-group/component entities

## Testing Surface

Tested by Tool E2E Tests (`test.e2e.tools`):
- Activation via shortcut and toolbar
- Selection of two valid solid groups
- Validation rejection of non-manifold geometry
- Each boolean operation type (Union, Subtract, Intersect)
- Preview display and cancellation
- Confirmation and scene modification
- Undo/redo of operations
- Error handling for invalid inputs
- Performance under load (large meshes)

## Integration Points

### Triggered By
- **Main Toolbar** (`toolbar.main`): Button click activates tool
- Keyboard shortcut `Shift+S` activates tool globally when no modal dialogs are open

### Invokes
- **Boolean Union** (`op.boolean_union`)
- **Boolean Subtract** (`op.boolean_subtract`)
- **Boolean Intersect** (`op.boolean_intersect`)

### Modifies
- **Scene Manager** (`data.scene`): Adds result entity, removes operands
- **Selection Manager** (`data.selection`): Updates selection to result entity

## Out of Scope

- Creation of solids from scratch (handled by other modeling tools)
- Repair of non-manifold geometry (future feature)
- Operations on more than two entities (future feature)
- Boolean operations on non-solid geometry (edges, faces)
- Trim and Split implementation details (if deferred to future iterations)