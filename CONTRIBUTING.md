# Contributing to DraftDown

## The ArchiGraph: Your Map of the Codebase

This project uses an **ArchiGraph** (`archigraph.yaml`) — a machine-readable architecture graph with 128 nodes and 547+ edges describing every component, service, and relationship.

### For AI contributors (Claude, Copilot, etc.)

1. **Read `CLAUDE.md` first** — it has the architecture summary, source file mappings, and critical implementation gotchas. It's designed as an AI instruction file.

2. **Search `archigraph.yaml` for context** — every system has a node with a `docs.description` field explaining what it does and why. Example:

   ```yaml
   - id: system.autoface
     kind: service
     docs:
       description: >-
         Three auto-face mechanisms in GeometryEngine:
         (1) autoCreateFaces via createEdgeWithAutoFace()...
   ```

3. **Follow edges to understand connections** — edges show which systems call, read, or contain others:

   ```yaml
   - kind: calls
     from: tool.line
     to: system.autoface
     docs:
       description: Line tool calls createEdgeWithAutoFace() which triggers auto-face detection.
   ```

4. **Update `CLAUDE.md` with gotchas** — if you discover a non-obvious implementation detail (like "projectionMatrixInverse must be manually recomputed before raycasting"), add it to CLAUDE.md so the next contributor doesn't hit the same issue.

### For human contributors

1. **Start with the README** — it has the system diagram, data flow, and keyboard shortcuts
2. **Browse `archigraph.yaml`** — search for the system you want to work on by name
3. **Read the Key Design Decisions** section in the README — these are the things that will bite you if you don't know about them
4. **Run the E2E tests** — `npx playwright test` runs real Electron tests. If they pass, your changes didn't break anything.

## Development Workflow

### Setup

```bash
npm install
npm run build
npx electron dist/main/main.js    # Run the app
npx playwright test                # Run tests
```

### Making Changes

1. Edit source files in `src/`
2. Rebuild: `npx webpack --config webpack.renderer.config.js` (renderer) or `npx webpack --config webpack.main.config.js` (main process)
3. Test: `npx playwright test tests/e2e-playwright/your-test.spec.ts`
4. Type check: `npx tsc --noEmit`

### Writing Tests

All tests are Playwright E2E tests that launch the real Electron app. No mocks.

```bash
# Run all tests
npx playwright test

# Run a specific test file
npx playwright test tests/e2e-playwright/drawing-tools.spec.ts

# Run tests matching a pattern
npx playwright test --grep "Rectangle"
```

The test helper launches Electron and exposes `(window as any).__debugApp` for direct access to the Application instance. This lets you programmatically create geometry, check state, and verify results.

### Code Style

- TypeScript strict mode
- `// @archigraph <node-id>` comments at the top of files that implement a specific node
- One tool per file in `src/tools/`
- All keyboard shortcuts handled in one place (`App.tsx`)
- Use `event.hitEntityId` from the raycast pipeline (don't do your own raycasting in tools)

## Architecture Quick Reference

| Layer | Components | Key Files |
|-------|-----------|-----------|
| **Electron** | Main process, IPC, file dialogs | `src/main/main.ts`, `preload.ts` |
| **React UI** | Toolbars, panels, context menu | `src/renderer/components/` |
| **Application** | Orchestrator, tool registration | `src/renderer/Application.ts` |
| **Three.js** | Renderer, camera, viewport | `src/renderer/WebGL*.ts`, `Viewport.ts` |
| **Scene Bridge** | Geometry→Three.js sync, snap | `src/renderer/SceneBridge.ts` |
| **Tools** | 23 drawing/modify/navigate tools | `src/tools/` |
| **Geometry** | B-Rep kernel, half-edge mesh | `src/engine/geometry/` |
| **Data** | Document, scene, history, selection | `src/data/` |

## Common Tasks

### Adding a new tool

1. Create `src/tools/MyTool.ts` extending `BaseTool`
2. Implement `onMouseDown/Move/Up`, `getPreview()`, `getVCBLabel()`
3. Register in `src/renderer/Application.ts` → `registerTools()`
4. Add keyboard shortcut in `src/renderer/App.tsx`
5. Add button in `src/renderer/components/DrawingToolbar.tsx`
6. Write a Playwright test

### Fixing a geometry bug

1. Write a failing test using `page.evaluate()` to create geometry directly
2. Trace through `GeometryEngine.ts` and `HalfEdgeMesh.ts`
3. Fix the logic
4. Verify the test passes
5. Run the full test suite

### Fixing a rendering bug

1. Check if the issue is data (geometry engine) or visual (Three.js)
2. Use `page.evaluate()` to inspect mesh state vs Three.js scene objects
3. Common causes: stale camera matrices, edge z-fighting, highlight material not restored
4. The overlay scene (edges) renders separately from the main scene (faces)
