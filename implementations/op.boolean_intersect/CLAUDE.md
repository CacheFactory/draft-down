# Boolean Intersect Operation

## What This Component Is

The Boolean Intersect operation performs CSG (Constructive Solid Geometry) boolean intersection on two solid geometries, keeping only the volume that is shared by both solids. This is a **destructive** operation that modifies the original geometry and supports **live preview** during execution. It is a **performance-critical** component and must handle complex solid geometry efficiently.

This operation enables users to create complex shapes by combining simple primitives — for example, intersecting a sphere with a cube to create a rounded corner volume, or intersecting two cylinders to create a lens shape.

## Responsibilities

- Accept two solid geometries as input (operands A and B)
- Validate that both operands are valid, manifold solids suitable for boolean operations
- Perform CSG intersection using the Manifold library to compute the shared volume
- Handle edge cases: non-intersecting solids (empty result), coincident faces, numerical precision issues
- Support live preview mode where the operation can be computed incrementally and cancelled
- Integrate with the undo/redo system by generating reversible operations
- Provide error feedback when operations fail (invalid geometry, degenerate cases, numerical instability)
- Maintain performance targets for interactive editing (must complete within acceptable time for typical CAD models)

## APIs and Contracts

### Input

- **Operand A**: Reference to a solid geometry object in the Core Geometry Engine
- **Operand B**: Reference to a second solid geometry object
- **Options**: Operation parameters (preview mode, tolerance settings, etc.)

### Output

- **Result Geometry**: A new solid representing the intersection, or null if the solids do not intersect
- **Operation Record**: Data structure for undo/redo containing original geometry references and result
- **Status**: Success/failure with error details if applicable

### Expected Data Shapes

The operation must consume geometry data in the format expected by Manifold Solid Engine and produce output compatible with Core Geometry Engine's internal representation. Coordinate systems, units, and mesh topology must be preserved correctly.

## Data Read/Write

### Reads

- **From Core Geometry Engine**: Solid geometry definitions for both operands (mesh data, topology, material properties)
- **From Manifold Solid Engine**: Intermediate computation results during boolean operation

### Writes

- **To Core Geometry Engine**: Resulting intersection solid (replaces or adds to scene geometry)
- **To Undo/Redo Manager**: Operation record containing:
  - Original operand references
  - Resulting geometry
  - Parameters used
  - Timestamp and user context

### Modifies

- Modifies the Core Geometry Engine's scene graph by removing original operands (if destructive) and adding the intersection result
- Triggers geometry engine updates to refresh rendering and selection state

## Dependencies

### Required Components

- **Manifold Solid Engine** (`solid.manifold`): Provides the underlying CSG intersection algorithm. This component must call Manifold's intersection APIs with properly formatted mesh data.

- **Core Geometry Engine** (`engine.geometry`): Provides geometry data structures, scene graph management, and coordinate system handling. The operation reads solid definitions from here and writes results back.

- **Undo/Redo Manager** (`data.history`): Receives operation records to enable reversible editing. Must provide sufficient information to reconstruct both forward and backward transformations.

### Dependent Components

- **Solid Tools** (`tool.solid_tools`): User interaction layer that invokes this operation based on user input (selecting two solids and triggering intersection). The operation must provide feedback suitable for UI presentation.

- **Geometry Integration Tests** (`test.integration.geometry`): Test suite that validates correctness of intersection operations across various solid combinations and edge cases.

## Security and Trust

### Data Classification

- **Geometry Data**: User-created 3D models are considered user content (not application data). Must be handled with appropriate care for potential export/sharing.
- **No sensitive data**: Operations work on geometric primitives without personal or confidential information.

### Trust Boundaries

- **Local-only computation**: All boolean operations execute locally using the Manifold library. No external services or cloud dependencies.
- **Input validation**: Must validate geometry inputs to prevent crashes from malformed mesh data, but assumes geometry from Core Geometry Engine is trusted.
- **Resource limits**: Must guard against excessive computation time or memory usage for pathological geometry inputs.

### No Authentication Required

This is a local computational component with no network access or user authentication concerns.

## Contained Sub-Components

This implementation must include:

1. **Geometry Validator**: Check that input solids are manifold, closed, and suitable for boolean operations
2. **Manifold Interface Adapter**: Convert geometry from Core Geometry Engine format to Manifold library format
3. **Intersection Executor**: Execute the boolean intersection using Manifold APIs
4. **Result Processor**: Convert Manifold output back to Core Geometry Engine format, validate result quality
5. **Preview Handler**: Support incremental computation for live preview with cancellation
6. **Error Reporter**: Generate meaningful error messages for failed operations
7. **Undo Record Generator**: Create complete undo/redo records with geometry snapshots

## Existing Code References

Implementation must be created in TypeScript as specified. No existing code references are provided — this is a new implementation.

## Complexity and Performance Constraints

- **Complexity**: Very complex — involves advanced geometric algorithms, numerical precision handling, and edge case management
- **Performance-critical**: Must complete typical intersections in under 1 second for models with 10,000-50,000 triangles
- **Preview mode**: Must provide responsive feedback during interactive preview (ideally 10+ fps for simple models)
- **Memory efficiency**: Must handle large models without excessive memory allocation or leaks

## Operational Characteristics

- **Destructive**: Original operands are consumed by default (though undo/redo enables recovery)
- **Live preview**: Must support real-time visualization of intersection result as user adjusts parameters or geometry
- **Manifold requirement**: Both inputs must be manifold solids; operation fails gracefully on invalid inputs
- **Precision handling**: Must handle floating-point precision issues inherent in CSG operations (coincident faces, thin features, near-zero volumes)