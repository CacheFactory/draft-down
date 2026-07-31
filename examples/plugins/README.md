# DraftDown Plugins

DraftDown plugins are JavaScript modules that use the `DraftDown`, `Geom`, and `UI`
globals — a near-1:1 mirror of the DraftDown Ruby API
.

The translation from a DraftDown Ruby extension to a DraftDown JS plugin is
mechanical:

| DraftDown Ruby                              | DraftDown JS                                  |
| ------------------------------------------ | --------------------------------------------- |
| `DraftDown.active_model`                    | `DraftDown.activeModel`                        |
| `model.start_operation("X", true)`         | `model.startOperation("X", true)`             |
| `model.commit_operation`                   | `model.commitOperation()`                     |
| `model.entities.add_face(*pts)`            | `model.entities.addFace(...pts)`              |
| `face.pushpull(distance)`                  | `face.pushpull(distance)`                     |
| `Geom::Point3d.new(x, y, z)`               | `new Geom.Point3d(x, y, z)`                   |
| `Geom::Vector3d.new(x, y, z)`              | `new Geom.Vector3d(x, y, z)`                  |
| `Geom::Transformation.translation(p)`      | `Geom.Transformation.translation(p)`          |
| `UI.menu("Plugins").add_item("Foo") { … }` | `UI.menu("Plugins").addItem("Foo", () => …)`  |
| `UI.messagebox("hi")`                      | `UI.messagebox("hi")`                         |
| `UI.inputbox(prompts, defaults, [], …)`    | `UI.inputbox(prompts, defaults, [], …)`       |
| `DraftDown.register_extension(ext, true)`   | `DraftDown.registerExtension(ext, true)`       |

## Installing a plugin

1. Click the **Plugins** dropdown in the top-right of DraftDown.
2. Choose **Extension Manager…**.
3. Click **Install Extension…** and select a `.js` file.

## Authoring a plugin

A plugin is a single JavaScript file that registers a `DraftDownExtension`:

```js
(function () {
  const ext = {
    id: 'com.example.my-plugin',     // reverse-domain id, required
    name: 'My Plugin',
    version: '1.0.0',
    creator: 'Your Name',
    description: 'Does something useful.',

    onLoad() {
      UI.menu('Plugins').addItem('Run It', () => {
        const m = DraftDown.activeModel;
        m.startOperation('Run It', true);
        // … use m.entities, m.selection, m.materials …
        m.commitOperation();
      });
    },

    onUnload() {},
  };

  DraftDown.registerExtension(ext, true);
})();
```

## Examples

- `com.draftdown.sample-box/` — minimal plugin that draws a unit cube via
  `entities.addFace(...)` + `face.pushpull(...)`. Open `sample-box.js` to see
  both the JS and the Ruby it translates from.

- `com.draftdown.stairs/` — parametric stair builder. Demonstrates how to drive
  geometry from the right-rail **Parameters** panel (`UI.parameters.show(...)`).
  Adds a *Plugins → Stairs Builder…* menu item; the panel asks for total height,
  width, step count, tread depth, nose length, tread thickness, origin and climb
  direction, then generates the whole staircase as one solid wrapped in a Group
  inside a single undo step.
