# Eraser Tool

## What This Component Is

The Eraser Tool is an interactive modification tool that enables users to delete or modify edges in the 3D scene. It supports three modes of operation:

1. **Normal mode**: Deletes edges (click or drag across edges)
2. **Hide mode**: Hides edges instead of deleting them (Shift+click)
3. **Smooth mode**: Softens or smooths edges (Ctrl+click)

The tool must maintain topological consistency — deleting an edge that bounds a face also deletes the face, and deleting all edges of a face deletes the face.

**Component ID**: `tool.eraser` (UUID: `96zZ0Ia9`)

**Keyboard Shortcut**: `E`

## Responsibilities

- Detect user interaction (click, drag) on edges in the 3D viewport
- Identify which edges intersect with the cursor or drag path
- Delete, hide, or smooth edges based on modifier keys
- Enforce topological rules when edges are deleted:
  - If an edge bounds a face, delete the face
  - If all edges of a face are deleted, delete the face
- Update the scene geometry to reflect the modifications
- Provide appropriate cursor feedback (pointer cursor)
- Integrate with the Main Toolbar as an activatable tool

## APIs and Interfaces

### Tool Activation

The tool must be activatable from the Main Toolbar (`toolbar.main`). When active, it receives mouse events from the viewport.

### Scene Modification

The tool **modifies** the Scene Manager (`data.scene`). It must:

- Query the scene for edges intersecting with user input (click point or drag path)
- Issue commands to delete edges from the scene
- Issue commands to hide edges from the scene
- Issue commands to smooth/soften edges
- Trigger face deletion when edge deletion invalidates faces

Expected scene interaction pattern:
- Query: Get edges at world-space coordinates or along a path
- Command: Delete edge(s) by ID
- Command: Hide edge(s) by ID
- Command: Smooth edge(s) by ID
- Query: Get faces bounded by specific edges (for topological validation)
- Command: Delete face(s) by ID when edges are removed

### Snap Point Constraint

The tool **uses** the Snap Point Constraint (`constraint.snap_point`) to assist with precise edge targeting. This likely provides snapping behavior when hovering near edges, helping users accurately select the edges they intend to modify.

## Data

### Input Data

- Mouse events: position (viewport coordinates), button state, drag path
- Modifier key states: Shift (hide mode), Ctrl (smooth mode)
- Scene geometry: edge positions, edge IDs, face topology

### Output Data

- Modified scene state with edges deleted, hidden, or smoothed
- Modified scene state with faces removed when topology requires it

### Data Classification

- Scene geometry modifications are user-created content (no special classification)
- All data is local to the user's machine

## Security and Trust

- All operations are local — no network requests
- Tool operates within the user's session with full trust
- No user authentication required (desktop application)
- No data encryption needed (local operation)

## Dependencies

### Direct Dependencies

- **Scene Manager** (`data.scene`): Provides edge and face data, accepts modification commands
- **Snap Point Constraint** (`constraint.snap_point`): Provides edge snapping/targeting assistance

### Dependents

- **Main Toolbar** (`toolbar.main`): Contains and activates this tool
- **Tool E2E Tests** (`test.e2e.tools`): Tests this tool's behavior

## Sub-components

This tool must implement:

1. **Input Handler**: Translates mouse events and modifier keys into tool actions
2. **Edge Hit Detection**: Identifies which edges intersect with click or drag path
3. **Topology Validator**: Determines which faces must be deleted when edges are removed
4. **Mode Controller**: Switches behavior between delete, hide, and smooth based on modifier keys
5. **Scene Command Issuer**: Executes modification operations on the scene

## Constraints

- Deleting an edge that bounds a face **must** also delete the face
- Deleting all edges of a face **must** delete the face
- Hide mode (Shift) must not delete edges — only hide them from view
- Smooth mode (Ctrl) must modify edge rendering properties without changing topology
- The tool must provide visual feedback (pointer cursor) when active
- The tool must handle drag gestures to erase multiple edges in a single operation

## Existing Code References

None specified. This is a new implementation.

## Implementation Notes

- **Language**: TypeScript
- **Complexity**: Simple
- **Icon**: `eraser`
- **Category**: modify

The tool should prioritize user intent clarity — provide visual feedback showing which edges will be affected before committing the operation, especially during drag operations.