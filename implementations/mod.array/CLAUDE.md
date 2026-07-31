# Array Modifier

## What This Component Is

The Array Modifier is a non-destructive modeling operation that creates multiple instances of selected geometry in linear or radial patterns. It generates arrayed copies that remain linked to the source geometry and update automatically when the source changes. Users can either keep the array parametric or "apply" it to bake the instances into real geometry.

## Responsibilities

- Create linear arrays with configurable count and spacing/distance
- Create radial arrays with configurable count, center point, axis, and angular range
- Maintain live linkage between source geometry and array instances
- Update all instances when source geometry changes
- Support "apply" operation to convert parametric array into static geometry
- Stack with other modifiers when applied to the same geometry
- Preserve array parameters for later editing until applied

## APIs Exposed

### Array Creation

**createLinearArray(params: LinearArrayParams): ArrayModifierInstance**

Parameters:
- `sourceGeometry`: Reference to geometry being arrayed
- `count`: Number of instances (including original)
- `direction`: Vector3 defining array direction
- `spacing?`: Distance between instances
- `totalDistance?`: Total span of array (mutually exclusive with spacing)

Returns an ArrayModifierInstance that can be edited, applied, or removed.

**createRadialArray(params: RadialArrayParams): ArrayModifierInstance**

Parameters:
- `sourceGeometry`: Reference to geometry being arrayed
- `count`: Number of instances (including original)
- `center`: Point3 defining rotation center
- `axis`: Vector3 defining rotation axis
- `totalAngle`: Total angular range in degrees (360 for full circle)

Returns an ArrayModifierInstance that can be edited, applied, or removed.

### Modifier Management

**updateArray(instanceId: string, params: Partial<LinearArrayParams | RadialArrayParams>): void**

Updates existing array parameters and regenerates instances.

**applyArray(instanceId: string): void**

Converts parametric array into real geometry, destroying the modifier instance and creating actual mesh copies.

**removeArray(instanceId: string): void**

Removes the array modifier, keeping only the original source geometry.

## Data Read/Write

### Reads From

- **Half-Edge Mesh** (`mesh.halfedge`): Source geometry structure to be arrayed
- **Core Geometry Engine** (`engine.geometry`): Transformation matrices, coordinate systems, vector operations

### Writes To

- **Half-Edge Mesh** (`mesh.halfedge`): When applied, writes new mesh geometry for each instance
- **Core Geometry Engine** (`engine.geometry`): Transformation data for instance positioning

### Internal State

Must maintain:
- Array type (linear/radial)
- Source geometry reference
- Array parameters (count, spacing, center, axis, angle, direction, distance)
- Instance transformation matrices
- Applied state (parametric vs baked)
- Unique instance identifier

State must be serializable for save/load and undo/redo.

## Security Constraints

**Data Classification**: Internal application data

**Trust Boundaries**: 
- All computation occurs locally within the Electron process
- No external network calls required
- User-provided parameters must be validated:
  - Count must be positive integer, reasonable maximum (e.g., 1000)
  - Distances and angles must be finite numbers
  - Direction and axis vectors must be non-zero
  - Geometry references must be valid

**Memory Safety**:
- Array operations with large counts may consume significant memory
- Should provide warnings or limits for arrays exceeding reasonable instance counts
- Must properly clean up instance data when array is removed or applied

## Dependencies

### Depends On

**Half-Edge Mesh** (`mesh.halfedge`):
- Must read source geometry topology and vertex data
- Must write new mesh data when array is applied
- Relationship: `applies` [uuid: 8X2iKJTV]

**Core Geometry Engine** (`engine.geometry`):
- Must use transformation utilities for positioning instances
- Must use vector/matrix operations for calculating instance positions
- Relationships: 
  - `modifies` [uuid: ke2L3MuJ]
  - `modifies` [uuid: OiQiDEPV]

### Depended On By

**Undo/Redo Manager** (`data.history`):
- Must provide serializable state for history snapshots
- Must support undo of array creation, parameter changes, and apply operations
- Must support redo of all operations
- Relationship: `manages` [uuid: jBFNJm3F]

## Modifier Stacking

The `x.modifier.stack: true` property indicates this modifier can combine with others:

- Multiple array modifiers can be applied sequentially (array of arrays)
- Other modifiers can be applied before or after array operations
- When stacked, modifier order affects final result
- Apply operation should respect the modifier stack order

## Implementation Notes

**Non-Destructive Requirements**:
- Instances must update when source geometry changes
- Must track source geometry version/change notifications
- Parametric state must persist until explicitly applied

**Linear Array Math**:
- If spacing provided: position[i] = origin + (direction * spacing * i)
- If totalDistance provided: spacing = totalDistance / (count - 1)
- First instance is always at origin (source position)

**Radial Array Math**:
- Rotation per instance: angle = totalAngle / (count - 1) for spread, or totalAngle / count for full circle
- Each instance rotates around axis by incremental angle
- First instance is always at original position
- Must use proper rotation matrix construction around arbitrary axis

**Apply Operation**:
- Must create real geometry for each instance using current transformations
- Must merge into existing scene structure
- Must remove modifier state after successful application
- Must be undoable (requires capturing full state before apply)

## Sub-Components

None — this is a leaf component within the modeling layer.

## Existing Code References

None specified — new implementation.