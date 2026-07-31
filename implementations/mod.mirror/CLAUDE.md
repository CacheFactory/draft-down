# Mirror Modifier

## What This Component Is

The Mirror Modifier is a non-destructive geometry transformation that reflects mesh geometry across a plane defined by an axis (X, Y, or Z) through a point. When applied to geometry, it creates a mirrored copy that automatically updates whenever the source geometry changes. The modifier optionally merges vertices at the mirror plane to create seamless, manifold models.

This is a stackable modifier — it can be combined with other modifiers in a processing pipeline.

## Responsibilities

- Accept a mirror plane definition (axis selection and origin point)
- Generate mirrored geometry from source mesh data
- Maintain live connection between source and mirrored result
- Optionally merge vertices at the mirror plane within a tolerance
- Preserve topology and manifoldness when merging
- Support undo/redo through history integration
- Maintain modifier state (axis, origin, merge settings)

## API Contract

### Modifier State

The modifier must maintain:
- **Axis**: One of 'X', 'Y', or 'Z'
- **Origin Point**: 3D coordinates defining where the mirror plane intersects the chosen axis
- **Merge at Plane**: Boolean flag controlling vertex welding
- **Merge Tolerance**: Distance threshold for welding vertices (when merge is enabled)

### Operations

**Apply Modifier**
- Input: Source geometry reference (from `mesh.halfedge`)
- Output: Transformed geometry with mirrored faces/vertices
- Must preserve original geometry — modifier is non-destructive

**Update on Source Change**
- Detect when source geometry has been modified
- Recompute mirrored result automatically
- Propagate changes downstream

**Vertex Merging**
- When enabled, identify vertices near the mirror plane (within tolerance)
- Weld coincident vertices to create single shared vertices
- Maintain valid half-edge connectivity after welding

**Serialization**
- Export modifier parameters for persistence
- Import/restore modifier state from saved data

## Data Flow

### Reads From
- **Half-Edge Mesh** (`mesh.halfedge`): Source geometry data including vertices, edges, faces, and connectivity
- Saved modifier state (axis, origin, merge settings) from persistence layer

### Writes To
- **Half-Edge Mesh** (`mesh.halfedge`): Mirrored geometry output with updated topology
- **Core Geometry Engine** (`engine.geometry`): Requests geometry operations for mirroring transformations and vertex welding

### Dependencies
- **Core Geometry Engine** (`engine.geometry`): Provides geometric transformation operations (reflection across plane) and vertex welding utilities
- **Undo/Redo Manager** (`data.history`): Manages modifier application, parameter changes, and removal as undoable operations

## Security and Data Constraints

- **Classification**: Internal geometry data — no external transmission
- **Trust Boundaries**: None — all operations local to the application
- **Data Validation**: 
  - Axis must be one of 'X', 'Y', 'Z'
  - Origin point must be valid 3D coordinates
  - Merge tolerance must be positive number
  - Source geometry must exist and be valid half-edge mesh

## Component Relationships

### Depends On
- **Half-Edge Mesh** (`mesh.halfedge`): Source of geometry data and target for output
- **Core Geometry Engine** (`engine.geometry`): Executes reflection transformations and vertex operations

### Depended On By
- Modeling operations that leverage mirrored geometry
- Modifier stack pipeline (when combined with other modifiers)

### Managed By
- **Undo/Redo Manager** (`data.history`): All modifier state changes must be registered as undoable operations

## Implementation Constraints

- Language: TypeScript
- Complexity: Simple
- Must operate non-destructively — original geometry remains unchanged
- Must support live updates when source geometry changes
- Must integrate with undo/redo system
- Mirrored geometry must maintain manifold properties when merge is enabled
- Must work within Electron desktop environment
- All computation must run locally

## Existing Code References

None — this is a new component.

Implementation folder: `./` (current component directory)

Related component folders:
- `../mesh.halfedge/` — Half-Edge Mesh implementation
- `../data.history/` — Undo/Redo Manager implementation  
- `../engine.geometry/` — Core Geometry Engine implementation