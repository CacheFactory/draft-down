# Scene Manager

**ID**: `data.scene`  
**UUID**: `A2js2ESA`  
**Layer**: data

## Purpose

The Scene Manager maintains the hierarchical scene graph that represents the entire 3D model. It organizes all geometry, groups, component instances, layers, and scene pages in a tree structure, manages the editing context for nested group editing, and provides the canonical API for all scene data manipulation.

## Responsibilities

- Maintain the root scene graph containing all entities
- Manage hierarchical groups and nested editing contexts
- Track component definitions and their instances (shared geometry prototype pattern)
- Provide layer organization and visibility control
- Store scene pages (saved camera/view configurations)
- Emit events for scene changes to notify tools, viewport, and other systems
- Coordinate geometry lifecycle with Half-Edge Mesh, Polyline Curve, and Arc Curve components
- Handle entity parenting, reparenting, and hierarchy traversal
- Enforce locking and visibility constraints on entities

## API Surface

### Core Types

Must implement the types defined in the interface:

- **Entity**: Base interface for all scene objects (vertices, edges, faces, groups, component instances, guides, dimensions, text, section planes, images)
- **Group**: Container entity with local transform, mesh geometry, and child entities
- **ComponentDefinition**: Reusable geometry prototype with name, description, mesh, and instance list
- **ComponentInstance**: Reference to a ComponentDefinition with its own transform (shares geometry)
- **Layer**: Named organizational layer with visibility, lock state, and color-by-layer support
- **ScenePage**: Saved view configuration (camera pose, layer visibility, active section planes, render mode)
- **EditingContext**: Track of currently edited group (path stack, active entities set)

### Scene Graph Operations

```typescript
root: Group // top-level container
editingContext: EditingContext // current nested editing state

addEntity(entity: Entity, parent?: Group): void
removeEntity(entity: Entity): void
moveEntity(entity: Entity, newParent: Group): void
getEntity(id: string): Entity | undefined
getAllEntities(): Entity[]
findEntitiesByType(type: EntityType): Entity[]
```

### Group Management

```typescript
createGroup(entities: Entity[]): Group
explodeGroup(group: Group): Entity[]
enterEditingContext(group: Group): void // enter nested editing
exitEditingContext(): void // pop editing stack
```

### Component System

```typescript
createComponentDefinition(group: Group, name: string): ComponentDefinition
placeComponentInstance(definition: ComponentDefinition, transform: Matrix4): ComponentInstance
makeUnique(instance: ComponentInstance): ComponentDefinition // convert instance to unique definition
```

### Layer System

```typescript
createLayer(name: string): Layer
deleteLayer(layer: Layer): void
assignLayer(entity: Entity, layer: Layer): void
getActiveLayer(): Layer
setActiveLayer(layer: Layer): void
getLayers(): Layer[]
```

### Scene Pages

```typescript
createPage(name: string): ScenePage
deletePage(page: ScenePage): void
activatePage(page: ScenePage): void
getPages(): ScenePage[]
```

### Event System

```typescript
on(event: 'entity-added' | 'entity-removed' | 'entity-changed' | 'layer-changed' | 'context-changed', handler: (data: any) => void): void
off(event: string, handler: Function): void
```

## Data Storage

### Reads From

- **Local File System** (uuid: `ltD2VRC4`): Load scene graph from .draftdown files (deserialize entities, groups, components, layers, pages)
- **Preferences Store** (uuid: `q4TmwrBi`): Retrieve default layer settings, last active page, recent component libraries

### Writes To

- **Local File System** (uuid: `pP0K4wyA`): Persist scene graph to .draftdown files (serialize all entities, preserve component references, maintain transform hierarchies)

## Data Classification

- **Scene graph structure**: User-created 3D model data, stored locally, must survive crash/reload
- **Entity IDs**: Must be stable across save/load cycles, globally unique within document
- **Layer state**: Part of document, must persist in file
- **Scene pages**: User-created views, document data
- **Editing context**: Transient session state, not persisted

## Dependencies

### Geometry Components (Managed)

- **Half-Edge Mesh** (`mesh.halfedge`): Stores solid geometry for groups and component definitions
- **Polyline Curve** (`curve.polyline`): Stores linear curve entities in the scene
- **Arc Curve** (`curve.arc`): Stores arc/circle curve entities in the scene

The Scene Manager owns the lifecycle of these geometry objects but delegates geometric operations to them.

### System Context

- **Main Renderer Process** (`process.renderer`, uuid: `ExIh1YqI`): Contains this component, provides Electron IPC for file I/O

## Dependents

### Rendering

- **Main 3D Viewport** (`viewport.main`, uuid: `VWX8DWmi`): Traverses scene graph to render all visible entities, respects editing context to highlight/dim geometry

### Tools (All Modify Scene)

Tools read and modify the scene graph via the Scene Manager API:

- **Select Tool** (`tool.select`, uuid: `KV5HcNg4`)
- **Line Tool** (`tool.line`, uuid: `3fp7t0iB`)
- **Circle Tool** (`tool.circle`, uuid: `445PqISX`, `YlNzuWb0`)
- **Arc Tool** (`tool.arc`, uuid: `1bdqwc6f`, `WxonH1k3`)
- **Polygon Tool** (`tool.polygon`, uuid: `Zp8S84Lw`, `zbA7J4Qi`)
- **Push/Pull Tool** (`tool.pushpull`, uuid: `cxi92ePw`, `qqJsrivi`)
- **Move Tool** (`tool.move`, uuid: `bHJXChdq`)
- **Rotate Tool** (`tool.rotate`, uuid: `L7dDpugY`)
- **Scale Tool** (`tool.scale`, uuid: `AaKRWZcp`)
- **Eraser Tool** (`tool.eraser`, uuid: `picB9EFi`)
- **Paint Bucket Tool** (`tool.paint`, uuid: `0bVaXfgb`)
- **Solid Tools** (`tool.solid_tools`, uuid: `QGL56miU`, `GX66rPlZ`)
- **Section Plane Tool** (`tool.section_plane`, uuid: `0iTWImTk`, `1WG5OeX4`)
- **Tape Measure Tool** (`tool.tape_measure`, uuid: `5sKisECl`, `cbtBvl4K`)
- **Protractor Tool** (`tool.protractor`, uuid: `uhsFZwjq`, `zaK6DZ9P`)
- **Dimension Tool** (`tool.dimension`, uuid: `d98yVyqa`, `dG1q8BfH`)
- **3D Text / Label Tool** (`tool.text`, uuid: `TKzz3wqC`, `xspReKk3`)
- **Sweep Tool** (`tool.sweep_tool`, uuid: `77uSsXOZ`, `Np528sgd`)
- **Orbit Tool** (`tool.orbit`, uuid: `trOZV4dc`, `Rr4wJy7u`)
- **Pan Tool** (`tool.pan`, uuid: `oWTQbY3d`, `CAs4l1GD`)
- **Zoom Tool** (`tool.zoom`, uuid: `ul1FEIF3`, `4Os7R5tS`)

### Testing

- **Scene & Data Integration Tests** (`test.integration.scene`, uuid: `VVu7qOb7`, `mISDDvMO`): Validate scene graph operations, component instancing, layer behavior, editing context stack

## Editing Context Semantics

When a user double-clicks a group or component instance:

1. Push the group onto the editing context path stack
2. Set `currentGroup` to the entered group
3. Populate `activeEntities` with IDs of entities within that group (these are editable)
4. The viewport dims/grays out everything outside the active context
5. Tools only operate on entities in `activeEntities`

Exiting pops the stack and restores the parent context. The root level has `currentGroup = null` and all top-level entities are active.

## Constraints

- Entity IDs must be unique across the entire scene graph
- An entity can have at most one parent group
- Component instances must reference a valid ComponentDefinition
- The root group cannot be deleted or moved
- Locked entities cannot be modified or moved by tools
- Invisible entities are excluded from viewport rendering but remain in the graph
- Layer deletion must reassign entities to the default layer
- Scene pages capture view state, not geometry state
- Transforms are local-to-parent; world transforms require hierarchy traversal
- Component instances share geometry (mesh) from their definition; only transforms are per-instance

## Security Considerations

- Scene graph data is trusted user-created content (no sandboxing required)
- Entity IDs may be predictable; collision avoidance is sufficient (no security implications)
- File I/O must validate structure on load to prevent crashes from malformed files
- No network exposure of scene data

## Implementation Notes

This component runs in the Electron renderer process, written in TypeScript. It must integrate with:

- **Three.js** for transform math (Matrix4, Vector3)
- **Half-Edge Mesh** data structures for geometry storage
- The file serialization format used by Local File System datastore

Complexity is marked **complex** due to:

- Hierarchical transform propagation
- Component instancing (prototype + instance pattern)
- Nested editing context stack management
- Event-driven notification to multiple dependent systems
- Coordination of multiple geometry types (mesh, polyline, arc)