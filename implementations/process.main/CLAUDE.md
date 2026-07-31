# Electron Main Process

**Component ID:** `process.main` (uuid: `ZOA1mLbr`)  
**Kind:** main_process  
**Layer:** system

## Purpose

The Electron main process is the Node.js backend of DraftDown. It serves as the trusted compute and file system boundary for the application. All privileged operations — file I/O, native module invocation, OS integration, and preference persistence — must go through this process. The renderer process (`process.renderer`) communicates with it exclusively via IPC channels exposed through a preload script.

This component is responsible for:
- Application lifecycle (startup, window management, shutdown)
- File system access (open, save, import, export, recent files tracking)
- User preferences persistence and retrieval
- Native module orchestration (Manifold WASM, OpenCascade WASM)
- Worker thread management (Mesh Processing Worker, File I/O Worker)
- Native OS integration (menus, dialogs, system notifications)
- IPC channel registration and routing

## API Surface

### IPC Channels: Renderer → Main

The main process must implement handlers for the following IPC channels. All handlers are invoked via `ipcMain.handle()` and return promises.

#### File Operations

- **`file:open`**
  - Opens a native file picker for `.sketch` files
  - Returns `{ filePath: string; data: ArrayBuffer } | null`
  - Must add selected file to recent files list
  - Returns `null` if user cancels

- **`file:save`**
  - Args: `{ filePath: string; data: ArrayBuffer }`
  - Writes data to the specified path
  - Returns `boolean` (success/failure)
  - Must update file system atomically (temp file + rename)

- **`file:save-as`**
  - Args: `{ data: ArrayBuffer; defaultName: string }`
  - Opens native save dialog with suggested filename
  - Returns `{ filePath: string } | null`
  - Must add saved file to recent files list

- **`file:export`**
  - Args: `{ data: ArrayBuffer; format: string; defaultName: string }`
  - Opens save dialog filtered by format (e.g., `.stl`, `.obj`, `.step`)
  - Returns `{ filePath: string } | null`

- **`file:import`**
  - Args: `{ formats: string[] }`
  - Opens file picker filtered by allowed formats
  - Returns `{ filePath: string; data: ArrayBuffer; format: string } | null`

- **`file:read`**
  - Args: `{ filePath: string }`
  - Returns `ArrayBuffer` of file contents
  - Must handle permission errors gracefully

- **`file:write`**
  - Args: `{ filePath: string; data: ArrayBuffer }`
  - Returns `boolean`
  - Atomic write semantics required

- **`file:get-recent`**
  - Returns `string[]` of recently opened file paths (max 10)
  - Must prune non-existent files on retrieval

- **`file:add-recent`**
  - Args: `{ filePath: string }`
  - Adds path to recent files list (most recent first)

#### Preferences

- **`prefs:get`**
  - Returns full `UserPreferences` object from persistent storage
  - Default values must be provided if no saved preferences exist

- **`prefs:set`**
  - Args: `Partial<UserPreferences>`
  - Merges provided fields into saved preferences
  - Must persist atomically to disk

```typescript
interface UserPreferences {
  units: 'mm' | 'cm' | 'm' | 'inches' | 'feet';
  gridSpacing: number;
  snapEnabled: boolean;
  autoSaveInterval: number; // milliseconds
  theme: 'light' | 'dark';
  shortcuts: Record<string, string>;
  recentFiles: string[];
  defaultTemplate: string;
  renderQuality: 'low' | 'medium' | 'high';
}
```

#### Native Modules

- **`native:boolean`**
  - Args: `{ op: 'union' | 'subtract' | 'intersect'; meshA: ArrayBuffer; meshB: ArrayBuffer }`
  - Invokes Manifold WASM (`native.manifold`) for solid geometry operations
  - Returns `ArrayBuffer` (resulting mesh)
  - Must handle WASM initialization and memory management

- **`native:step-import`**
  - Args: `{ data: ArrayBuffer }`
  - Invokes OpenCascade WASM (`native.opencascade`) to parse STEP files
  - Returns `ArrayBuffer` (converted mesh data)
  - Must handle format errors gracefully

#### Application

- **`app:get-version`**
  - Returns application version string from `package.json`

- **`app:get-user-data-path`**
  - Returns OS-specific user data directory path
  - Platform-specific: `~/Library/Application Support/DraftDown` (macOS), `%APPDATA%/DraftDown` (Windows), `~/.config/DraftDown` (Linux)

- **`app:quit`**
  - Gracefully shuts down application
  - Must emit `app:before-quit` event to renderer first

### IPC Channels: Main → Renderer

The main process must send events to the renderer via `webContents.send()`:

- **`menu:action`**
  - Payload: `{ action: MenuAction }`
  - Sent when user triggers a menu command
  - MenuAction values: `'new' | 'open' | 'save' | 'save-as' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'select-all' | 'zoom-extents' | 'zoom-window' | 'preferences' | 'about'`

- **`file:auto-save-tick`**
  - Payload: `{}`
  - Sent at intervals determined by `UserPreferences.autoSaveInterval`
  - Renderer must respond by saving current state

- **`app:before-quit`**
  - Payload: `{}`
  - Sent before application quits
  - Renderer must respond with save confirmation if unsaved changes exist

## Data Storage

### User Preferences
- **Location**: `{userData}/preferences.json`
- **Format**: JSON serialization of `UserPreferences` object
- **Access**: Read on startup, write on `prefs:set` calls
- **Classification**: User-specific, non-sensitive

### Recent Files List
- **Location**: Stored within `UserPreferences.recentFiles`
- **Max length**: 10 entries
- **Ordering**: Most recent first
- **Validation**: Must prune non-existent paths on read

### Auto-save State
- **Location**: `{userData}/autosave/`
- **Naming**: `autosave-{timestamp}.sketch`
- **Cleanup**: Delete auto-saves older than 7 days on startup

## Security Requirements

### Context Isolation
- Preload script must use `contextBridge.exposeInMainWorld()` to expose typed API
- Renderer must not have direct access to Node.js APIs
- `nodeIntegration: false` enforced
- `contextIsolation: true` enforced

### File System Trust Boundary
- All file system operations require explicit user action (dialogs)
- No automatic file writes outside user data directory without user consent
- Path traversal attacks must be prevented (validate resolved paths)

### Native Module Safety
- WASM modules (`native.manifold`, `native.opencascade`) loaded only in main process
- Memory management for WASM must prevent leaks
- Malformed binary inputs must not crash the process

### Data Classification
- **User preferences**: Non-sensitive, local only
- **Project files**: Sensitive (user work product), local only
- **Recent files paths**: Non-sensitive metadata
- **Auto-save data**: Sensitive, temporary, encrypted storage not required

## Component Dependencies

### Required Libraries
- **Electron** (`lib.electron`): Application framework, IPC, window management
- Must target Electron 28+ for security features

### Native Modules
- **Manifold WASM** (`native.manifold`): Boolean operations
  - Must be initialized on startup
  - Provides `union`, `subtract`, `intersect` operations on mesh buffers

- **OpenCascade WASM** (`native.opencascade`): STEP import
  - Must be initialized on-demand (lazy load)
  - Parses `.step`/`.stp` files into mesh data

### Worker Threads
- **Mesh Processing Worker** (`worker.mesh`): Offload heavy mesh operations
  - Must spawn on demand, manage lifecycle
  - Communication via structured clone messages

- **File I/O Worker** (`worker.fileio`): Async file parsing/serialization
  - Must spawn on demand, manage lifecycle
  - Prevents main process blocking during large file operations

## Connected Components

### Main Renderer Process (`process.renderer`)
- **Relationship**: Bidirectional IPC communication
- **Sends to main**: All `MainProcessAPI` channels (file ops, prefs, native calls, app queries)
- **Receives from main**: All `RendererEvents` (menu actions, auto-save ticks, quit notifications)
- **Contract**: Renderer cannot access Node.js; all privileged ops must flow through IPC

## Window Management

### Main Window
- Must create `BrowserWindow` on startup
- Must load renderer process entry point (`index.html`)
- Must configure preload script with context isolation
- Must handle window close events (check for unsaved changes)

### Secondary Windows
- May create additional windows for preferences, about dialog, etc.
- Must share security configuration with main window

## Application Menu

### Required Menu Structure
- **File**: New, Open, Save, Save As, Import, Export, Recent Files, Quit
- **Edit**: Undo, Redo, Cut, Copy, Paste, Delete, Select All
- **View**: Zoom Extents, Zoom Window, Toggle Grid, Toggle Snap
- **Tools**: Preferences
- **Help**: About

### Menu Actions
- Menu item selection must send `menu:action` event to renderer
- Accelerators (keyboard shortcuts) must be defined from `UserPreferences.shortcuts`
- Recent files submenu must be dynamically updated

## Lifecycle Requirements

### Startup
1. Initialize Electron app
2. Load user preferences (create defaults if none exist)
3. Initialize Manifold WASM module
4. Create main window with preload script
5. Register IPC handlers
6. Build application menu
7. Check for and clean up old auto-save files

### Shutdown
1. Send `app:before-quit` event to renderer
2. Wait for renderer acknowledgment or timeout (5s)
3. Close all windows
4. Dispose worker threads
5. Clean up WASM module instances
6. Exit process

### Auto-save Timer
- Must start timer on app ready based on `UserPreferences.autoSaveInterval`
- Must send `file:auto-save-tick` events at configured intervals
- Must update timer if preferences change

## Error Handling

### IPC Handler Errors
- Must catch and log all exceptions in IPC handlers
- Must return rejection promises with structured error messages
- Must not crash main process on renderer-initiated errors

### File System Errors
- Permission denied: Return user-friendly error via IPC
- File not found: Return null or error as appropriate
- Disk full: Return error with actionable message

### WASM Module Errors
- Initialization failure: Log error, disable features gracefully
- Runtime errors: Return error via IPC, do not crash
- Memory exhaustion: Free resources, return error

## Implementation Notes

- **Language**: TypeScript
- **Framework**: Electron 28+
- **Complexity**: Complex (multi-process coordination, native modules, IPC)
- **No cloud dependencies**: All computation and storage is local

## Preload Script Contract

The preload script must expose a typed API at `window.api`:

```typescript
interface WindowAPI {
  invoke<K extends keyof MainProcessAPI>(
    channel: K,
    ...args: Parameters<MainProcessAPI[K]>
  ): ReturnType<MainProcessAPI[K]>;

  on<K extends keyof RendererEvents>(
    channel: K,
    handler: (data: RendererEvents[K]) => void
  ): void;
}
```

This ensures type-safe IPC from the renderer side.