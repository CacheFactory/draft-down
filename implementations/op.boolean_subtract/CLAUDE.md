# Boolean Subtract Operation

## What This Is

The Boolean Subtract operation performs CSG (Constructive Solid Geometry) subtraction — cutting one solid from another. It takes a primary solid and subtracts a tool solid from it, producing a watertight result with the tool shape removed. This is a destructive, performance-critical operation that modifies the original geometry and supports live preview during interaction.

## Responsibilities

- Accept two solid geometries (primary and tool) and compute their boolean difference
- Delegate the actual CSG computation to the Manifold Solid Engine for robust geometric processing
- Handle coincident geometry edge cases where surfaces touch or overlap exactly
- Ensure the result is always a valid, watertight solid mesh
- Provide preview capability for real-time visual feedback during tool interaction
- Modify the Core Geometry Engine's geometry representation with the subtraction result
- Work within the Undo/Redo Manager's history tracking system
- Maintain performance for interactive modeling workflows

## APIs and Contracts

### Input Requirements

Must accept:
- **Primary solid**: The base geometry to subtract from (source of truth in Core Geometry Engine)
- **Tool solid**: The geometry to remove from the primary
- Both geometries must be valid, closed, manifold meshes

### Output Guarantees

Must produce:
- A valid manifold solid mesh representing (primary - tool)
- Watertight geometry with no holes, non-manifold edges, or self-intersections
- Updated geometry in the Core Geometry Engine reflecting the subtraction

### Error Conditions

Must handle:
- Non-manifold input geometry (reject or repair)
- Coincident surfaces between primary and tool
- Degenerate results (when tool completely contains primary, or no intersection exists)
- Numerical precision issues at geometric boundaries

## Data Flow

### Reads From
- Core Geometry Engine: Current mesh data for primary and tool solids
- Geometry IDs, vertex positions, face topology from selected objects

### Writes To
- Core Geometry Engine: Modified mesh data after subtraction
- Replaces primary solid's geometry with the difference result
- May delete or modify tool solid depending on operation mode

### Delegates To
- Manifold Solid Engine: Sends mesh data for CSG computation, receives resulting mesh

## Component Dependencies

### Direct Dependencies

**Manifold Solid Engine** (`solid.manifold`)
- Must convert geometry to Manifold's mesh format
- Must call Manifold's boolean subtraction function
- Must convert result back to DraftDown's geometry representation
- Relies on Manifold for all geometric robustness guarantees

**Core Geometry Engine** (`engine.geometry`)
- Must read current geometry state for both solids
- Must write modified geometry back after operation
- Must respect the engine's geometry data structures and update protocols

**Undo/Redo Manager** (`data.history`)
- Must integrate with history tracking for operation reversibility
- Must provide sufficient information to undo/redo the subtraction
- Must capture before/after state of modified geometry

### Consumers

**Solid Tools** (`tool.solid_tools`)
- Invokes this operation during interactive modeling workflows
- May request preview mode for real-time feedback
- Expects synchronous or near-synchronous response for UI responsiveness

**Geometry Integration Tests** (`test.integration.geometry`)
- Tests correctness of boolean subtraction across various scenarios
- Validates edge cases: coincident geometry, nested solids, touching surfaces
- Benchmarks performance for typical and worst-case geometries

## Security and Trust

### Data Classification
- All geometry data is local user content
- No sensitive data beyond user's 3D models

### Trust Boundaries
- Trusts input from Core Geometry Engine as validated geometry
- Trusts Manifold library for CSG computation correctness
- Must validate that results are manifold before writing back

### Isolation
- Runs entirely in local Electron process
- No network communication
- No data leaves the user's machine

## Performance Constraints

### Critical Performance Requirements
- Marked as performance-critical (`x.perf.critical: true`)
- Must support real-time preview for typical modeling geometries
- Target: < 100ms for simple subtractions (hundreds to low thousands of faces)
- Must remain responsive for complex geometry (tens of thousands of faces)

### Optimization Considerations
- Consider mesh simplification for preview mode
- May need spatial acceleration structures for large meshes
- Should leverage Manifold's optimized implementation fully
- Avoid unnecessary data copies between geometry representations

## Implementation Complexity

- Marked as "very-complex" (`x.impl.complexity`)
- Complexity stems from:
  - Robust handling of geometric edge cases
  - Integration with two different geometry representations (DraftDown + Manifold)
  - Performance requirements for interactive use
  - Correctness guarantees for watertight results
  - Preview mode coordination

## Sub-Components

This operation does not contain major sub-components that must be implemented within this codebase. The core CSG logic is delegated to Manifold. This component focuses on:

- Geometry conversion (DraftDown ↔ Manifold formats)
- Operation orchestration
- Error handling and edge case management
- Integration with history and preview systems

## Existing Code References

- Implementation language: TypeScript
- Lives in the modeling layer alongside other boolean operations
- Sibling components: `../solid.manifold/`, `../engine.geometry/`, `../data.history/`, `../tool.solid_tools/`