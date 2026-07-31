# Model Document

The **Model Document** (`data.document`) is the in-memory representation of an open project file — the single source of truth for all model state in DraftDown. It owns and coordinates all scene, selection, history, and material data for a design session.

---

## Responsibilities

- **Own all model state**: The document is the root container for scene graph, selection, undo/redo history, and material library
- **Lifecycle management**: Handle document creation, file I/O (open/save), and resource cleanup
- **Dirty tracking**: Track unsaved changes and notify UI when save state changes
- **Auto-save**: Periodically serialize document state to a temporary file for crash recovery
- **Metadata management**: Store and update document properties (name, author, creation date, units, geo-location)
- **Unit system**: Maintain and enforce the document's length unit (`mm`, `cm`, `m`, `inches`, `feet`) across all geometry
- **Import/Export delegation**: Route file format conversions to appropriate format handlers
- **Event broadcasting**: Notify listeners of state changes (dirty flag, metadata, units, save events)

---

## APIs Exposed

### TypeScript Interface

```typescript
export type LengthUnit = 'mm' | 'cm' | 'm' | 'inches' | 'feet';

export interface DocumentMetadata {
  name: string;
  description: string;
  author: string;
  createdAt: number;          // Unix timestamp
  modifiedAt: number;         // Unix timestamp
  units: LengthUnit;
  geoLocation?: { 
    latitude: number; 
    longitude: number; 
    northAngle: number;       // degrees from north
  };
}

export interface DocumentState {
  dirty: boolean;             // has unsaved changes
  filePath: string | null;    // null = never saved
  autoSaveEnabled: boolean;
  autoSaveIntervalMs: number;
  lastAutoSave: number | null; // Unix timestamp
}

export interface IModelDocument {
  // Sub-managers (owned)
  readonly scene: ISceneManager;
  readonly selection: ISelectionManager;
  readonly history: IHistoryManager;
  readonly materials: IMaterialManager;

  // Document state
  readonly metadata: DocumentMetadata;
  readonly state: DocumentState;

  // Lifecycle
  static createNew(template?: string): IModelDocument;
  static openFromFile(filePath: string, data: ArrayBuffer): Promise<IModelDocument>;
  save(): Promise<ArrayBuffer>;
  saveAs(filePath: string): Promise<void>;
  close(): void;

  // Metadata
  setUnits(units: LengthUnit): void;
  getUnits(): LengthUnit;
  setMetadata(partial: Partial<DocumentMetadata>): void;

  // Dirty tracking
  isDirty(): boolean;
  markClean(): void;

  // Auto-save
  getAutoSaveData(): ArrayBuffer;
  hasAutoSaveRecovery(filePath: string): boolean;
  recoverAutoSave(filePath: string): Promise<IModelDocument>;

  // Import/Export
  importFile(format: string, data: ArrayBuffer, options?: any): Promise<void>;
  exportFile(format: string, options?: any): Promise<ArrayBuffer>;

  // Events
  on(event: 'dirty-changed' | 'saved' | 'units-changed' | 'metadata-changed', handler: (data: any) => void): void;
  off(event: string, handler: Function): void;
}
```

### Sub-Manager Interfaces

The document must instantiate and own these managers:

- **`ISceneManager`** (`data.scene`): Manages scene graph hierarchy (pages, layers, groups, geometry nodes)
- **`ISelectionManager`** (`data.selection`): Tracks selected entities and broadcasts selection change events
- **`IHistoryManager`** (`data.history`): Undo/redo stack with command pattern support
- **`IMaterialManager`** (`data.materials`): Material library and material assignment to faces/objects

Each sub-manager must provide its own interface contract (see respective component specifications).

---

## Data Operations

### Reads From

**Local File System** (`datastore.filesystem`):
- Native `.draftdown` project files
- Imported file formats (`.skp`, `.obj`, `.dae`, `.ifc`, etc.)
- Auto-save temporary files in system temp directory

**Preferences Store** (`datastore.preferences`):
- Default auto-save interval
- Default length units for new documents
- Author name and default metadata

### Writes To

**Local File System** (`datastore.filesystem`):
- Native `.draftdown` project files on save/saveAs
- Auto-save temporary files (format: `.draftdown-autosave-{timestamp}`)
- Exported files in various formats

---

## Ownership Hierarchy

The document is the root owner of all model state:

```
IModelDocument
├─ scene: ISceneManager
│  └─ Scene graph nodes (groups, layers, pages)
│     └─ HalfEdgeMesh instances (owned by geometry nodes)
├─ selection: ISelectionManager
├─ history: IHistoryManager
│  └─ Command objects
└─ materials: IMaterialManager
   └─ Material instances
```

### Geometry Ownership

- **HalfEdgeMesh** (`mesh.halfedge`): Owned by individual scene graph nodes, not directly by the document
- **Manifold solids** (`solid.manifold`): Created transiently during boolean operations, converted to/from HalfEdgeMesh
- **Curve geometry** (`curve.polyline`, `curve.arc`): Owned by scene nodes representing edges or construction geometry

---

## File Format

### Native Format (`.draftdown`)

The document must serialize to a binary format containing:

- Document metadata (name, author, units, timestamps, geo-location)
- Scene graph structure (pages, layers, groups, hierarchy)
- Geometry data (vertices, faces, edges, topology)
- Material library and assignments
- History stack (optional, for undo/redo preservation)
- Selection state (optional, for session recovery)

**Format requirements**:
- Must support incremental versioning for backward compatibility
- Must be deserializable into the same in-memory structure
- Must be compact enough for responsive save/load (target: <1 second for 10MB models)

### Auto-Save Format

Auto-save files must:
- Use the same serialization as native format
- Be written to `app.getPath('temp')` with naming convention `.draftdown-autosave-{filePath}-{timestamp}`
- Be created every `autoSaveIntervalMs` (default 300,000 ms = 5 minutes)
- Include full document state to enable complete recovery
- Be cleaned up after successful manual save or document close

### Recovery Logic

On application startup:
- Check temp directory for auto-save files
- Match auto-save files to recent documents via file path
- If auto-save is newer than last saved file, prompt user for recovery
- `hasAutoSaveRecovery(filePath)` returns `true` if a valid auto-save exists
- `recoverAutoSave(filePath)` deserializes the auto-save file and returns a new document instance

---

## Import/Export Delegation

The document does **not** implement file format parsers. It delegates to format-specific handlers:

- **Import**: `importFile(format, data, options)` routes to appropriate parser, which returns scene graph nodes to merge into `scene`
- **Export**: `exportFile(format, options)` routes to appropriate exporter, which serializes current scene state

**Supported formats** (delegated to `file_format` nodes):
- `.skp` (DraftDown)
- `.obj` (Wavefront OBJ)
- `.dae` (COLLADA)
- `.ifc` (Industry Foundation Classes)
- `.stl` (STL mesh)
- `.3ds` (Autodesk 3DS)

---

## Dirty Tracking

The document must track unsaved changes:

- **Dirty flag**: Set to `true` whenever scene, selection, materials, or metadata change
- **Mark clean**: Call `markClean()` after successful save
- **Event**: Emit `'dirty-changed'` event whenever dirty flag toggles
- **Integration**: History manager commands must trigger dirty flag when executed/undone

---

## Unit System

The document enforces a single length unit across all geometry:

- **Default units**: Read from preferences on document creation (default: `'m'`)
- **Unit conversion**: When `setUnits(newUnit)` is called, all geometry coordinates must be scaled
- **Metadata sync**: `metadata.units` must always reflect current unit system
- **Event**: Emit `'units-changed'` when units change

**Conversion factors** (relative to meters):
- `mm`: 0.001
- `cm`: 0.01
- `m`: 1.0
- `inches`: 0.0254
- `feet`: 0.3048

---

## Events

The document must emit the following events:

| Event              | Payload                                      | When                                  |
|--------------------|----------------------------------------------|---------------------------------------|
| `dirty-changed`    | `{ dirty: boolean }`                         | Dirty flag toggles                    |
| `saved`            | `{ filePath: string, timestamp: number }`    | Successful save/saveAs                |
| `units-changed`    | `{ oldUnits: LengthUnit, newUnits: LengthUnit }` | Unit system changes                   |
| `metadata-changed` | `{ metadata: DocumentMetadata }`             | Metadata fields updated               |

---

## Dependencies

### Consumes From

- **Scene Manager** (`data.scene`): Delegates all scene graph operations
- **Selection Manager** (`data.selection`): Delegates selection tracking
- **History Manager** (`data.history`): Delegates undo/redo
- **Material Manager** (`data.materials`): Delegates material library
- **Half-Edge Mesh** (`mesh.halfedge`): Geometry nodes own mesh instances
- **Manifold Solid Engine** (`solid.manifold`): Used indirectly via scene operations (booleans, extrusions)
- **Curve components** (`curve.polyline`, `curve.arc`): Used for edge and construction geometry

### Depended On By

- **Main 3D Viewport** (`viewport.main`): Reads scene state for rendering
- **Main Renderer Process** (`process.renderer`): Contains the document instance in the application lifecycle
- **File I/O handlers**: Import/export format parsers
- **UI components**: Query document state for display and editing

---

## Security & Data Constraints

- **Data classification**: User-generated content — treat as private, do not transmit externally
- **File path validation**: Sanitize file paths to prevent directory traversal attacks
- **Deserialization safety**: Validate all input during file open to prevent malformed data from crashing the application
- **Auto-save isolation**: Write auto-save files with restrictive permissions (user-only read/write)
- **No cloud dependencies**: All data operations must be local-only

---

## Sub-Components

The document **must** instantiate and manage these sub-components:

1. **Scene Manager** (`data.scene`)
   - Manages pages, layers, groups, and geometry nodes
   - Provides tree hierarchy and spatial queries

2. **Selection Manager** (`data.selection`)
   - Tracks currently selected entities (nodes, faces, edges, vertices)
   - Emits selection change events

3. **History Manager** (`data.history`)
   - Maintains undo/redo stack
   - Executes commands with rollback support

4. **Material Manager** (`data.materials`)
   - Stores material definitions (color, texture, PBR properties)
   - Assigns materials to geometry faces

---

## Testing Requirements

The document must support:

- **Unit tests**: Lifecycle (create, save, load), dirty tracking, unit conversion, metadata updates
- **Integration tests** (`test.integration.scene`): End-to-end file I/O, auto-save recovery, multi-page documents
- **Performance tests**: Save/load benchmarks for large models (target: 10MB model in <1 second)

---

## Implementation Notes

- **Language**: TypeScript
- **Complexity**: Complex (root coordinator for all model state)
- **Event system**: Use Node.js `EventEmitter` or similar pattern for event broadcasting
- **Serialization**: Must be deterministic and versioned for long-term file compatibility
- **Memory management**: `close()` must release all resources (geometry, textures, listeners) to prevent leaks