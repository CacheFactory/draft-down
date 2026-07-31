# Plugin System

## What This Component Is

The Plugin System is the extensibility foundation for DraftDown. It enables third-party developers to extend the application by loading JavaScript/TypeScript modules from a plugins directory. Plugins can register custom tools, operations, file importers/exporters, UI panels, and menu items through a sandboxed API.

This is a **tool plugin** system conforming to API version `1.0`, implemented in TypeScript as a complex, security-critical component.

## Responsibilities

- Discover and scan plugin manifests in the plugins directory
- Load and validate plugin modules at runtime
- Enforce permission-based access to DraftDown APIs
- Provide a sandboxed `PluginAPI` to each loaded plugin
- Invoke plugin lifecycle methods (`activate`, `deactivate`)
- Register plugin-provided extensions (tools, operations, file handlers, UI elements) with appropriate DraftDown subsystems
- Isolate plugin errors to prevent application crashes
- Wrap plugin-initiated scene mutations in undo/redo transactions
- Track loaded plugins and their dependencies

## APIs Exposed

### IPluginSystem Interface

```typescript
interface IPluginSystem {
  loadPlugin(pluginPath: string): Promise<void>;
  unloadPlugin(pluginId: string): void;
  getLoadedPlugins(): PluginManifest[];
  isPluginLoaded(pluginId: string): boolean;
  getPluginAPI(pluginId: string): PluginAPI;
  scanPluginDirectory(dirPath: string): Promise<PluginManifest[]>;
}
```

**Methods:**
- `loadPlugin(pluginPath)`: Loads a plugin from a directory containing `manifest.json` and entry point file
- `unloadPlugin(pluginId)`: Unloads a plugin, calls its `deactivate()`, and removes registered extensions
- `getLoadedPlugins()`: Returns manifests of all currently loaded plugins
- `isPluginLoaded(pluginId)`: Checks if a plugin with given ID is loaded
- `getPluginAPI(pluginId)`: Returns the sandboxed API instance for a specific plugin
- `scanPluginDirectory(dirPath)`: Discovers all valid plugin manifests in a directory

### PluginAPI Interface (Provided to Plugins)

Plugins receive a `PluginAPI` instance at activation. This API is sandboxed based on declared permissions:

```typescript
interface PluginAPI {
  registerTool(tool: ITool): void;
  registerOperation(operation: Operation): void;
  registerFileImporter(format: string, importer: FileImporter): void;
  registerFileExporter(format: string, exporter: FileExporter): void;
  registerPanel(panel: PanelDefinition): void;
  registerMenuItem(menu: string, item: MenuItemDefinition): void;

  readonly scene: Readonly<ISceneManager>;
  readonly selection: Readonly<ISelectionManager>;
  readonly materials: Readonly<IMaterialManager>;

  getMesh(entityId: string): Readonly<HalfEdgeMesh> | null;
  modifyMesh(entityId: string, callback: (mesh: HalfEdgeMesh) => void): void;

  showDialog(options: DialogOptions): Promise<DialogResult>;
  showNotification(message: string, type: 'info' | 'warning' | 'error'): void;
  log(message: string, level?: 'debug' | 'info' | 'warn' | 'error'): void;
}
```

**Registration methods** allow plugins to extend DraftDown with:
- Custom tools (via `ITool` interface)
- Custom operations (via `Operation` interface)
- File format importers/exporters
- UI panels (rendered into specified positions: left, right, bottom)
- Menu items (with labels, shortcuts, callbacks)

**Data access properties** (`scene`, `selection`, `materials`) are read-only unless the plugin has corresponding write permissions.

**Geometry methods**:
- `getMesh(entityId)`: Returns a read-only view of a mesh (requires `geometry:read`)
- `modifyMesh(entityId, callback)`: Wraps mutations in a transaction for undo/redo (requires `geometry:write`)

**UI methods**:
- `showDialog(options)`: Display modal dialogs
- `showNotification(message, type)`: Show toast notifications
- `log(message, level)`: Write to plugin-specific log

### Plugin Manifest (manifest.json)

Each plugin must provide a `manifest.json` file:

```typescript
interface PluginManifest {
  id: string; // e.g., 'com.example.my-plugin'
  name: string;
  version: string; // semver
  description: string;
  author: string;
  entry: string; // relative path to main JS/TS file
  permissions: PluginPermission[];
  dependencies?: Record<string, string>; // { 'other-plugin-id': '>=1.0.0' }
}
```

**Permissions:**
- `scene:read`, `scene:write`
- `geometry:read`, `geometry:write`
- `materials:read`, `materials:write`
- `ui:panel`, `ui:toolbar`, `ui:menu`
- `file:import`, `file:export`
- `filesystem:read`, `filesystem:write`

### Plugin Lifecycle (IPlugin)

Loaded plugin modules must export an object implementing:

```typescript
interface IPlugin {
  activate(api: PluginAPI): void;
  deactivate(): void;
}
```

- `activate(api)`: Called when plugin is loaded; receives sandboxed API instance
- `deactivate()`: Called before unloading; must clean up resources

## APIs Consumed

The Plugin System depends on:

- **Scene Manager** (`ISceneManager` from `data.scene`): For providing read/write access to the scene graph
- **Selection Manager** (`ISelectionManager` from `data.selection`): For querying and modifying selection state
- **Material Manager** (`IMaterialManager` from `data.materials`): For material CRUD operations
- **Geometry Mesh** (`HalfEdgeMesh` from `geometry.mesh`): For accessing and modifying mesh data
- **Tool System** (`ITool` interface): For registering custom tools
- **Operation System** (`Operation` interface): For registering custom operations
- **File I/O** (file import/export subsystems): For registering custom file handlers
- **UI System**: For rendering plugin panels, dialogs, notifications, and menu items
- **History/Undo System**: Must wrap `modifyMesh` callbacks in transactions

The Plugin System must integrate with DraftDown's existing tool, operation, and file format systems by forwarding registered extensions to the appropriate managers.

## Data Read/Written

### Read:
- **Plugin directory**: Scans filesystem path (typically `<user-data>/plugins/`) for subdirectories containing `manifest.json`
- **Plugin manifest files**: `manifest.json` in each plugin directory
- **Plugin entry modules**: JavaScript/TypeScript files referenced by `manifest.entry`
- **Scene, selection, materials, geometry**: Via sandboxed API based on permissions

### Written:
- **Plugin logs**: Plugin-specific log files or in-memory log buffers
- **Scene graph, materials, geometry**: When plugins have write permissions and invoke mutation APIs
- **UI state**: When plugins register panels, menu items, or trigger dialogs

### In-Memory:
- **Loaded plugin registry**: Map of `pluginId` → loaded plugin instance and metadata
- **API instances**: Map of `pluginId` → sandboxed `PluginAPI` instance
- **Permission grants**: Tracking which permissions each plugin has

## Security Constraints

### Data Classification
- **Plugin code**: UNTRUSTED — third-party JavaScript executed in renderer process
- **Manifest data**: UNTRUSTED — user-provided or third-party configuration
- **Scene/geometry data accessed by plugins**: SENSITIVE — mutations must be auditable and reversible

### Permission Model
- Plugins **must** declare all required permissions in `manifest.json`
- Users **must** approve permissions on first plugin load (or via settings)
- API methods **must** check permissions before granting access
- Attempting to access APIs without permission **must** throw errors or log warnings

### Sandboxing Requirements
- Plugins run in the **Electron renderer process** (not isolated workers) but with restricted API surface
- Plugins **must not** have direct access to Node.js APIs, Electron IPC, or filesystem outside their sandbox
- `filesystem:read` and `filesystem:write` permissions **must** be restricted to a plugin-specific directory (e.g., `<user-data>/plugins/<plugin-id>/data/`)
- The Plugin System **must** intercept and validate all file paths to prevent directory traversal

### Error Isolation
- Exceptions in plugin code **must** be caught and logged without crashing DraftDown
- Plugin errors during `activate()` **must** prevent the plugin from loading
- Plugin errors during runtime **must** disable the plugin and notify the user

### Undo/Redo Integration
- All calls to `modifyMesh()` **must** be wrapped in history transactions
- Scene mutations via `scene:write` **must** be reversible
- Plugin-initiated operations **must** appear in the undo stack with clear attribution

### Trust Boundaries
- **Plugin code ↔ DraftDown Core**: Plugins are untrusted; all inputs must be validated
- **Plugin manifest ↔ Plugin System**: Manifests are untrusted; malformed JSON or invalid fields must be rejected
- **Plugin directory ↔ Host filesystem**: Plugins must not read/write outside their sandbox

## Dependencies

### Required Components
- **Tool System** (`tool.*`): To register custom tools like `tool.select`
- **Operation System** (`op.*`): To register custom operations like `op.extrude`
- **File Format System** (`file.*`): To register importers/exporters like `file.native`
- **Scene Manager** (`data.scene`): For scene graph access
- **Selection Manager** (`data.selection`): For selection queries
- **Material Manager** (`data.materials`): For material access
- **Geometry Mesh** (`geometry.mesh`): For mesh data access
- **History/Undo System**: For wrapping mutations
- **UI Framework**: For rendering panels, dialogs, notifications

### Dependent Components
- **Select Tool** (`tool.select`): Example of a tool that could be implemented as a plugin (or extended by plugins)
- **Extrude (Push/Pull)** (`op.extrude`): Example of an operation that could be extended or replaced by plugins
- **DraftDown Native Format** (`file.native`): Example of a file handler that could be supplemented by plugin importers/exporters

The Plugin System **extends** these components by allowing third-party code to register additional tools, operations, and file handlers.

### Actor
- **Plugin Developer** (`actor.plugin_dev`): Creates and distributes plugins; interacts with this system via the documented `PluginAPI` and manifest format

## Sub-Components

The following must be implemented within this codebase:

### 1. Plugin Loader
- Discovers `manifest.json` files in plugin directories
- Validates manifests against schema
- Resolves and checks plugin dependencies
- Dynamically imports plugin entry modules
- Tracks loading order and circular dependency detection

### 2. Permission Manager
- Stores user-approved permissions per plugin
- Validates permission requests at runtime
- Provides UI or CLI for users to review/modify permissions

### 3. API Sandbox Factory
- Constructs `PluginAPI` instances with permission-based access control
- Wraps scene/selection/materials managers with read-only proxies when needed
- Intercepts method calls to enforce permissions

### 4. Geometry Transaction Wrapper
- Wraps `modifyMesh()` callbacks in undo/redo transactions
- Captures before/after state for history system
- Ensures atomicity of mesh modifications

### 5. Filesystem Sandbox
- Restricts file I/O to plugin-specific directories
- Validates paths to prevent directory traversal
- Provides safe async file read/write primitives

### 6. Plugin Error Handler
- Catches exceptions in plugin lifecycle methods
- Logs errors with plugin attribution
- Disables misbehaving plugins automatically

### 7. Extension Registry
- Central registry for all plugin-registered extensions (tools, operations, panels, menu items)
- Routes registration calls to appropriate subsystems
- Tracks which plugin registered each extension for cleanup on unload

### 8. Plugin UI Integration
- Mounts plugin panels into specified UI positions
- Handles dialog creation and modal state
- Displays notifications and logs in UI

## Existing Code References

None — this is a new component. However, it must integrate with:
- Existing `ITool` interface used by `tool.select`
- Existing `Operation` interface used by `op.extrude`
- Existing file I/O patterns used by `file.native`

The Plugin System should be designed such that **core tools and operations could theoretically be refactored as first-party plugins** to validate the API's completeness.

## Constraints

- Plugins must be discovered at application startup or via explicit "reload plugins" action
- Plugin loading is **asynchronous** (filesystem I/O, dynamic imports)
- Plugin unloading must cleanly remove all registered extensions and UI elements
- The Plugin System must work in an **offline-first** environment (no remote plugin repositories)
- TypeScript type definitions for `PluginAPI` must be published for plugin developers
- Plugin manifests must support semantic versioning for dependency resolution