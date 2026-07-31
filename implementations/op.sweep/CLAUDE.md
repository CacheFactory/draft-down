# Sweep Operation

## Component Identity

**ID**: `op.sweep` (uuid: `AratDxCv`)  
**Layer**: modeling  
**Type**: operation (destructive, with preview capability)

## Purpose

This component sweeps a profile face along a path of connected edges to generate 3D geometry. The profile is oriented perpendicular to the path tangent at each vertex, with automatic scaling and rotation to maintain smooth transitions. This operation is fundamental for creating cornices, pipes, lathe operations, and complex moldings.

This is a **performance-critical** component that must handle complex geometric calculations efficiently.

## What This Component Must Do

### Core Responsibilities

1. **Accept a profile face and a path** consisting of connected edges
2. **Orient the profile perpendicular to the path tangent** at each vertex
3. **Scale and rotate the profile** at each path vertex to maintain geometric continuity
4. **Generate swept geometry** by connecting profile instances along the path
5. **Handle open paths** (creates an extrusion along the path)
6. **Handle closed paths** (creates a full revolution, joining start and end)
7. **Handle acute angles** in the path without creating self-intersections or artifacts
8. **Resolve path-profile orientation** to prevent twisting or flipping
9. **Modify the existing geometry** destructively, replacing selected geometry with the sweep result
10. **Support live preview mode** before committing the operation

### Geometric Requirements

- **Profile face**: Must be a valid closed planar face from the Half-Edge Mesh
- **Path edges**: Must be connected in sequence (validate topology)
- **Tangent calculation**: Compute smooth tangent vectors at each path vertex, handling:
  - Sharp corners (discontinuous tangents)
  - Smooth curves (averaged tangents)
  - Start/end conditions for open paths
- **Orientation consistency**: Maintain consistent normal direction along the sweep to prevent twisting
- **Scaling transitions**: Smoothly interpolate any necessary profile scaling between path segments
- **Self-intersection detection**: Detect and handle cases where the swept profile would intersect itself

### Data Inputs

- **Profile face ID** or reference from Half-Edge Mesh (`mesh.halfedge`)
- **Path edge IDs** in sequence from Half-Edge Mesh
- **Operation parameters**:
  - Orientation hints or locking (to control profile twist)
  - Scale factors (optional, for variable-width sweeps)
  - Closed path flag (or auto-detect from topology)

### Data Outputs

- **Modified Half-Edge Mesh** with new swept geometry replacing or added to existing geometry
- **Geometry updates** committed to Core Geometry Engine (`engine.geometry`)
- **Operation metadata** for undo/redo capture:
  - Original profile face ID
  - Original path edge IDs
  - Generated face IDs
  - Generated edge IDs
  - Generated vertex IDs
  - Operation parameters used

### APIs This Component Exposes

Must provide a method or function callable by the Sweep Tool (`tool.sweep_tool`):

```
executeSweep(
  profileFaceId: string,
  pathEdgeIds: string[],
  options: {
    preview?: boolean,
    orientationLock?: Vector3,
    scaleFactors?: number[],
    closedPath?: boolean
  }
) -> SweepResult
```

**SweepResult** must include:
- Success/failure status
- Generated geometry IDs (faces, edges, vertices)
- Error messages if validation fails
- Preview geometry if `preview: true`

### APIs This Component Consumes

**From Half-Edge Mesh** (`mesh.halfedge`):
- Query face geometry (vertices, edges, normal)
- Query edge connectivity and geometry
- Query vertex positions
- Add new faces, edges, vertices
- Remove old geometry (for destructive modification)
- Validate topology (ensure path edges are connected)

**From Core Geometry Engine** (`engine.geometry`):
- Access to underlying solid geometry representation
- Boolean operations if needed for cleanup
- Geometry validation after sweep
- Spatial queries for self-intersection detection

## Interaction with Other Components

### Sweep Tool (`tool.sweep_tool`)
- **Invokes this operation** when user completes selection of profile and path
- Provides profile face ID and path edge IDs
- Requests preview mode during interactive dragging
- Commits final operation when user confirms

### Half-Edge Mesh (`mesh.halfedge`)
- **This operation applies modifications** to the mesh structure
- Reads profile and path geometry
- Writes new swept geometry
- Must maintain mesh validity invariants

### Core Geometry Engine (`engine.geometry`)
- **This operation modifies** the underlying geometry state
- Ensures swept geometry is valid solid geometry
- May use engine for complex geometric calculations (tangents, intersections)

### Undo/Redo Manager (`data.history`)
- **Manages this operation** as part of history stack
- This operation must provide:
  - Complete state capture for undo (original geometry IDs)
  - Deterministic redo (same inputs produce same outputs)
  - Operation metadata for history display

### Geometry Integration Tests (`test.integration.geometry`)
- **Tests this operation** with various profile and path configurations
- Must validate:
  - Open vs closed paths
  - Straight vs curved paths
  - Simple vs complex profiles
  - Edge cases (acute angles, self-intersection risks)
  - Performance benchmarks

## Constraints and Requirements

### Performance
- Must handle typical user-scale sweeps (profiles with <1000 vertices, paths with <100 segments) in real-time for preview
- Must complete final sweep operation in <2 seconds for typical cases
- Should provide progress feedback for complex sweeps (>5 seconds)

### Geometric Validity
- Output geometry must be manifold (no dangling edges, consistent face orientation)
- Must not create degenerate faces (zero area, colinear vertices)
- Must maintain consistent vertex ordering for face normals
- Self-intersecting geometry must be either prevented or clearly flagged as invalid

### Error Handling
- Validate profile is a single closed face
- Validate path edges are connected in sequence
- Detect and report self-intersections
- Handle cases where profile is perpendicular to path (undefined orientation)
- Reject invalid inputs with clear error messages

### Data Integrity
- Destructive operation must cleanly remove original geometry
- All generated geometry must be registered in Half-Edge Mesh
- Operation must be atomic (all-or-nothing; no partial state on failure)

### Preview Mode
- Preview geometry must be visually distinguishable from committed geometry
- Preview must be fast enough for interactive feedback (<100ms updates preferred)
- Preview must not modify the actual mesh state

## Security and Trust

**Data Classification**: Internal geometric data (not user-sensitive)

**Trust Boundaries**:
- Input from Sweep Tool is trusted (user-initiated action)
- Half-Edge Mesh data is trusted
- No external data sources

**Validation**:
- Must validate all geometry references exist before operating
- Must validate topological consistency (connected edges, valid faces)
- Must prevent operations that would corrupt mesh structure

## Dependencies

**Required Components**:
- Half-Edge Mesh (`mesh.halfedge`) — for all geometry access and modification
- Core Geometry Engine (`engine.geometry`) — for solid geometry validation and operations

**Optional Components**:
- Undo/Redo Manager (`data.history`) — for history integration (operation should work standalone for testing)

## Sub-Components to Implement

This component must internally implement or contain:

1. **Path Tangent Calculator**: Compute smooth tangent vectors at each path vertex
   - Handle corner conditions (average adjacent edges vs. preserve sharp corners)
   - Handle start/end conditions for open paths

2. **Profile Orientation Solver**: Compute profile rotation at each path vertex
   - Maintain perpendicularity to path tangent
   - Minimize twist (rotation along path direction)
   - Handle orientation locking if user-specified

3. **Profile Instance Generator**: Create transformed copies of the profile at each path position
   - Apply translation to path vertex
   - Apply rotation to align with tangent
   - Apply scaling if specified

4. **Geometry Stitcher**: Connect profile instances into solid geometry
   - Generate quad faces between adjacent profile instances
   - Handle start/end caps for open paths
   - Handle closure for closed paths (connect last instance to first)
   - Maintain consistent face winding

5. **Self-Intersection Detector**: Check for geometric collisions
   - Detect profile-to-profile intersections along path
   - Detect profile-to-existing-geometry intersections
   - Flag or prevent invalid configurations

6. **Preview Generator**: Create temporary geometry for preview mode
   - Lightweight representation (may reduce tessellation)
   - Non-destructive (does not modify mesh)
   - Rapidly updatable

## Existing Code References

**Implementation Language**: TypeScript  
**Complexity**: Very complex (multi-stage geometric algorithm with numerous edge cases)

No existing code references provided. This is a new implementation.

## Notes

- The "Sweep" name is DraftDown terminology; this is a standard sweep operation in CAD
- Algorithm complexity increases significantly with:
  - Curved paths (require tangent smoothing)
  - Non-planar profiles (may require projection)
  - Large vertex counts (O(n*m) where n=path vertices, m=profile vertices)
- Consider optimizing common cases (straight paths, simple profiles) separately from general case
- Lathe operations are a special case: circular path around an axis with radial profile