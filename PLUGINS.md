# DraftDown Plugin API

DraftDown extensions are plain JavaScript modules evaluated with a
Ruby-style API mounted as globals. If you have written a classic CAD
Ruby extension, the shape will feel familiar — the same objects exist with
camelCase methods.

## Loading a plugin

- **Extension Manager** (Plugins toolbar → Extension Manager): paste source,
  load from URL, or load a `.js` file. Loaded sources persist in
  `localStorage` and reload on startup.
- Programmatic: `app.pluginLoader.loadFromSource(source, name)`.

## Globals available to plugins

| Global | What it is |
| --- | --- |
| `DraftDown` | Root module — `activeModel`, `registerExtension`, `Tools` |
| `UI` | Menus, dialogs, toolbars — `menu()`, `messagebox()`, `inputbox()` |
| `Geom` | `Point3d`, `Vector3d`, `Transformation`, `BoundingBox` |
| `Length` | Number ↔ formatted-length helpers |

## The model

```js
const model = DraftDown.activeModel;

model.entities        // iterate/add geometry (addLine, addFace, addCircle…)
model.selection       // .toArray(), .edges(), .faces(), .add(), .clear()
model.materials       // material library + assignment
model.layers          // tags
model.pages           // scenes
model.definitions     // component definitions

model.startOperation('My Operation');   // one undo step
// ...mutate...
model.commitOperation();                // or abortOperation()
model.activeView.refresh();                        // resync the viewport
```

### Escape hatch: the operation API

`model.api_` exposes the typed model-operation API for higher-level edits:

```js
model.api_.extrudeFace(faceId, distance)
model.api_.chamferEdge(edgeId, distance)
model.api_.filletEdge(edgeId, radius, segments)
model.api_.sweep(profileFaceId, pathEdgeIds)
```

Each returns `{ success, newFaceIds, newEdgeIds, error? }`.

## Menus and dialogs

```js
UI.menu('Plugins').addItem('Do The Thing', () => { /* handler */ });
UI.messagebox('Hello');
const values = UI.inputbox(['Width:', 'Height:'], ['1', '2'], [], 'Size');
if (values) { const [w, h] = values.map(parseFloat); }
```

## Custom tools

```js
DraftDown.Tools.pushTool({
  name: 'My Tool',
  onMouseDown(event) { /* event.worldPoint, event.hitEntityId, … */ },
  onMouseMove(event) {},
  draw(view) { /* preview lines */ },
});
```

`registerTool` registers without activating (shows in the Plugins toolbar
group); `pushTool` registers and activates.

## Registering the extension

```js
DraftDown.registerExtension({
  id: 'com.you.my-extension',   // required, unique
  name: 'My Extension',
  version: '1.0.0',
  description: 'What it does',
  creator: 'You',
}, true /* load immediately */);
```

## Worked example: the Bevel plugin

`implementations/plugin.system/examples/bevel.js` ships with the app and is
the reference pattern — menu item, selection access, input dialog, an
undoable operation using `model.api_.chamferEdge`, and viewport refresh:

```js
(function () {
  function bevelSelectedEdges() {
    const model = DraftDown.activeModel;
    const edgeIds = model.selection.edges().map(e => e.id);
    if (edgeIds.length === 0) return UI.messagebox('Select edges first.');

    const result = UI.inputbox(['Bevel distance (m):'], ['0.1'], [], 'Bevel');
    if (!result) return;
    const distance = parseFloat(result[0]);

    model.startOperation('Bevel Edges');
    edgeIds.forEach(id => model.api_.chamferEdge(id, distance));
    model.commitOperation();
    model.activeView.refresh();
  }

  UI.menu('Plugins').addItem('Bevel Selected Edges', bevelSelectedEdges);
  DraftDown.registerExtension({ id: 'examples.bevel', name: 'Bevel', version: '1.0.0' }, true);
})();
```

## Rules of the road

- **Always wrap mutations** in `startOperation`/`commitOperation` — that's
  what puts your change in the undo stack as one step.
- **Call `model.activeView.refresh()`** after mutations so the viewport resyncs.
- Plugins run in the renderer with no Node/filesystem access; persistence
  beyond `localStorage` should go through user-driven file dialogs.
- Errors thrown by your handlers are caught and logged — they won't crash
  the app, but they will silently end your handler. Check the dev console.
