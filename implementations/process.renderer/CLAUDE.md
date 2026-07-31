# Main Renderer Process

## Overview

The Main Renderer Process (`process.renderer`) is the Electron renderer process responsible for running the entire DraftDown application user interface and core application logic. This process hosts the React UI framework, manages the Three.js-based 3D viewport, orchestrates the tool system, coordinates all data managers, and serves as the integration point for all user-facing functionality.

This is a complex, multi-subsystem process that acts as the application's central nervous system — bridging user input, 3D rendering, geometry processing, document management, and inter-process communication.

## Responsibilities

### Core Application Lifecycle
- Bootstrap the application when the window loads
- Initialize and coordinate all major subsystems (document, renderer, camera, inference engine, tool manager)
- Manage the application render loop
- Handle graceful shutdown and cleanup

### UI Hosting
- Mount and manage the React component tree
- Render the main application UI including toolbars, panels, status bar, and dialogs
- Handle all user input events (mouse, keyboard, touch)
- Manage UI state and application-level React context

### 3D Viewport Integration
- Initialize and manage the Three.js renderer on the canvas element
- Coordinate the camera controller for viewport navigation
- Drive the render loop for continuous 3D scene updates
- Handle viewport resize events

### Tool System Orchestration
- Register and manage all available tools
- Activate/deactivate tools based on user selection
- Route input events to the active tool
- Coordinate tool state with UI elements

### Data Management Coordination
- Own and coordinate the Model Document (`data.document`)
- Integrate Scene Manager (`data.scene`)
- Integrate Selection Manager (`data.selection`)
- Integrate Undo/Redo Manager (`data.history`)
- Integrate Material Manager (`data.materials`)
- Ensure data consistency across all managers

### Inter-Process Communication
- Communicate with Electron Main Process (`process.main`) via IPC
- Send work to Mesh Processing Worker (`worker.mesh`)
- Send file operations to File I/O Worker (`worker.fileio`)
- Handle responses and events from workers
- Listen for menu actions and system events from main process

### Document Operations
- Create new documents
- Open existing documents via file picker
- Save documents to disk
- Import external file formats
- Export to various 3D file formats

## API Surface

### Window Global API
The preload script exposes `window.api` with typed IPC channels:

```typescript
window.api: {
  invoke<K extends keyof MainProcessAPI>(channel: K, ...args): Promise<ReturnType>;
  on<K extends keyof RendererEvents>(channel: K, handler: (data) => void): void;
  off<K extends keyof RendererEvents>(channel: K, handler: Function): void;
}
```

Must handle these event channels from main process:
- `menu:action` — User selected a menu item, trigger corresponding document/tool action

Must invoke these channels on main process:
- File operations: open dialog, save dialog, show message box
- Window operations: minimize, maximize, close
- Application operations: quit, check for updates

### Application Singleton Interface
The renderer must expose an `IApplication` singleton:

**Methods:**
- `initialize(canvas: HTMLCanvasElement): Promise<void>` — Bootstrap all subsystems
- `dispose(): void` — Clean up resources on shutdown
- `newDocument(): Promise<void>` — Create blank document
- `openDocument(): Promise<void>` — Show file picker and load document
- `saveDocument(): Promise<void>` — Save to current path or prompt if new
- `saveDocumentAs(): Promise<void>` — Show save dialog and write document
- `importFile(): Promise<void>` — Import external geometry file
- `exportFile(format: string): Promise<void>` — Export document in specified format
- `activateTool(toolId: string): void` — Switch active tool
- `getActiveTool(): ITool | null` — Get current tool instance
- `getAvailableTools(): ITool[]` — List all registered tools

**Properties:**
- `document: IModelDocument` — Document data manager
- `renderer: IRenderer` — Three.js renderer wrapper
- `camera: ICameraController` — Camera/viewport controller
- `inference: IInferenceEngine` — Geometry inference system
- `toolManager: IToolManager` — Tool registry and activation

### Tool Manager Interface
The `IToolManager` subsystem must provide:

**Methods:**
- `registerTool(tool: ITool): void` — Add tool to registry
- `unregisterTool(toolId: string): void` — Remove tool from registry
- `activateTool(toolId: string): void` — Switch to specified tool
- `deactivateTool(): void` — Deactivate current tool
- `getActiveTool(): ITool | null` — Get active tool instance
- `getTool(toolId: string): ITool | undefined` — Lookup tool by ID
- `getAllTools(): ITool[]` — Get all registered tools
- `on(event: 'tool-changed', handler: (tool: ITool | null) => void): void` — Subscribe to tool changes

## Data Flow

### Document Data
- Create and own `IModelDocument` instance
- Read/write document state through document manager API
- Coordinate geometry changes with Scene Manager (`data.scene`)
- Track selection state through Selection Manager (`data.selection`)
- Record operations through Undo/Redo Manager (`data.history`)

### 3D Scene Data
- Read scene geometry from Scene Manager (`data.scene`)
- Pass scene data to WebGL Renderer (`renderer.webgl`) for visualization
- Update scene in response to tool operations

### Material Data
- Read/write material definitions through Material Manager (`data.materials`)
- Apply materials to geometry in Scene Manager

### File Data
- Send file read requests to File I/O Worker (`worker.fileio`)
- Receive parsed file data from worker
- Send file write requests with document data to worker
- Receive write confirmation or errors from worker

### Mesh Processing Data
- Send geometry operations to Mesh Processing Worker (`worker.mesh`)
- Receive processed mesh results from worker
- Update Scene Manager with processed geometry

### Input Events
- Receive DOM mouse/keyboard events from browser runtime
- Route events to active tool via tool manager
- Tools may modify document state, triggering scene updates

## Dependencies

### Required Components
- **Main Window** (`window.main`) — The BrowserWindow that hosts this renderer
- **Main 3D Viewport** (`viewport.main`) — Canvas and viewport UI element
- **WebGL Renderer** (`renderer.webgl`) — Three.js rendering implementation
- **Scene Manager** (`data.scene`) — Geometry and scene graph data
- **Selection Manager** (`data.selection`) — Selected entity tracking
- **Undo/Redo Manager** (`data.history`) — Command history
- **Model Document** (`data.document`) — Document state and metadata
- **Material Manager** (`data.materials`) — Material definitions

### Required Libraries
- **Electron** (`lib.electron`) — Renderer process APIs, IPC, remote module
- **React** (`lib.react`) — UI framework for component tree
- **Three.js** (`lib.threejs`) — 3D rendering and scene graph

### Worker Communication
- **Mesh Processing Worker** (`worker.mesh`) — Send geometry operations, receive results
- **File I/O Worker** (`worker.fileio`) — Send file I/O requests, receive data or errors

### Main Process Communication
- **Electron Main Process** (`process.main`) — Bidirectional IPC for system operations

## Bootstrap Sequence

The renderer must initialize in this order:

1. **Preload API Available** — `window.api` injected by preload script
2. **React Mount** — Create React root and mount `<App />` component
3. **Document Init** — Create or load `IModelDocument`
4. **Renderer Init** — Initialize `IRenderer` (Three.js) on canvas element
5. **Camera Init** — Initialize `ICameraController` for viewport navigation
6. **Inference Init** — Initialize `IInferenceEngine` for smart geometry
7. **Tool Registration** — Register all available tools with `IToolManager`
8. **Render Loop Start** — Begin continuous render loop for 3D viewport
9. **Event Listeners** — Attach handlers for `menu:action` and other main process events

## Security Constraints

### Data Classification
- **User Documents**: User-created 3D models — treat as user private data, store locally only
- **Application State**: UI preferences and tool settings — store in local app data directory
- **No Cloud Communication**: All data remains on local filesystem

### Trust Boundaries
- **Main Process IPC**: Trust main process as same-origin, but validate all incoming event payloads
- **Worker Messages**: Validate all worker responses before applying to document state
- **File Data**: Treat all file data as untrusted — validate format and structure after parsing

### Sandboxing
- Renderer process runs in Electron sandbox (if enabled)
- No direct filesystem access — must use IPC to main process or file I/O worker
- No direct Node.js APIs — only those exposed via preload script

## Implementation Requirements

### TypeScript
All code must be written in TypeScript with strict type checking enabled.

### React Framework
The UI must be built using React components with functional components and hooks preferred.

### Three.js Integration
The 3D viewport must use Three.js for rendering, with the renderer instance owned by this process.

### Error Handling
- Gracefully handle worker failures (mesh processing, file I/O)
- Display user-friendly error messages for file operations
- Log errors to console for debugging
- Prevent crashes from propagating to UI

### Performance
- Render loop must maintain 60fps for smooth viewport interaction
- Heavy geometry operations must be offloaded to mesh worker
- Large file I/O must be offloaded to file worker
- UI must remain responsive during background operations

### State Management
- Application state must be managed through React context or state management library
- Document state must be managed through `IModelDocument`
- Tool state must be managed through `IToolManager`

## Complexity Notes

This is a **complex** component due to:
- Multiple interconnected subsystems (document, rendering, tools, data managers)
- Bidirectional IPC with main process and workers
- Real-time 3D rendering loop
- Event coordination across UI, tools, and data layers
- Large API surface with many integration points