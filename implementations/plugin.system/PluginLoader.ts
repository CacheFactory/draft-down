// @archigraph plugin.system.loader
// Load DraftDown plugins (DraftDown-Ruby-API style) from string source, URL, or file.
//
// Plugins are JS modules. The simplest pattern mirrors a Ruby DraftDown extension:
//
//   // sample-make-box.js
//   (function() {
//     const ext = {
//       id: 'com.example.make-box',
//       name: 'Make Box',
//       description: 'Adds a Plugins → Make Box menu item',
//       version: '1.0.0',
//       creator: 'Example Co.',
//       onLoad() {
//         UI.menu('Plugins').addItem('Make 1m Box', () => {
//           const m = DraftDown.activeModel;
//           m.startOperation('Make Box', true);
//           m.entities.addFace(
//             new Geom.Point3d(0,0,0),
//             new Geom.Point3d(1,0,0),
//             new Geom.Point3d(1,0,1),
//             new Geom.Point3d(0,0,1),
//           ).pushpull(1);
//           m.commitOperation();
//         });
//       },
//       onUnload() {},
//     };
//     DraftDown.registerExtension(ext, true);
//   })();
//
// The loader runs the JS code in a Function() with a tightly-scoped global so that
// `DraftDown`, `UI`, `Geom`, `Length` resolve to our installed façade.

export interface LoadedPlugin {
  id: string;
  source: string;
  /** Plugin-supplied manifest (subset). */
  manifest: PluginManifest;
}

export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  creator?: string;
  /** Optional path to entry JS (relative to manifest). */
  entry?: string;
}

export class PluginLoader {
  private loaded = new Map<string, LoadedPlugin>();

  /**
   * Run a plugin from a JS source string. Returns the captured manifest if the plugin
   * registered itself with DraftDown.registerExtension.
   */
  loadFromSource(source: string, sourceName = '<inline>'): LoadedPlugin | null {
    const w: any = (typeof window !== 'undefined') ? window : globalThis;
    if (!w.DraftDown) throw new Error('DraftDown global not installed');

    // Snapshot the extension list before & after to detect what got registered.
    const before = new Set(w.DraftDown.extensionList().map((e: any) => e.ext.id));

    // Wrap source so it has access to globals + a `module.exports` style escape.
    const wrapped = `
      ${source}
      //# sourceURL=${encodeURI(sourceName)}
    `;

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('DraftDown', 'UI', 'Geom', 'Length', 'console', wrapped);
      fn(w.DraftDown, w.UI, w.Geom, w.Length, console);
    } catch (e) {
      console.error(`[PluginLoader] Error in '${sourceName}':`, e);
      throw e;
    }

    const after = w.DraftDown.extensionList();
    const newOnes = after.filter((e: any) => !before.has(e.ext.id));
    if (newOnes.length === 0) return null;
    const ext = newOnes[0].ext;
    const plugin: LoadedPlugin = {
      id: ext.id,
      source,
      manifest: { id: ext.id, name: ext.name, version: ext.version, description: ext.description, creator: ext.creator },
    };
    this.loaded.set(ext.id, plugin);
    // Persist source so the Application can reload it on next launch.
    if (typeof localStorage !== 'undefined' && sourceName !== '<inline>') {
      try { localStorage.setItem(`draftdown:plugin-src:${ext.id}`, source); }
      catch (e) { console.warn(`[PluginLoader] localStorage setItem for ${ext.id} failed (probably quota):`, e); }
    }
    return plugin;
  }

  /** Fetch a plugin script from a URL and load it. */
  async loadFromUrl(url: string): Promise<LoadedPlugin | null> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch plugin: ${res.status} ${res.statusText}`);
    const src = await res.text();
    return this.loadFromSource(src, url);
  }

  /** Load a plugin from a File (drag-drop). */
  async loadFromFile(file: File): Promise<LoadedPlugin | null> {
    const src = await file.text();
    return this.loadFromSource(src, file.name);
  }

  /** Unload — calls DraftDown.unloadExtension and forgets the source. */
  unload(id: string): boolean {
    const w: any = (typeof window !== 'undefined') ? window : globalThis;
    const ok = w.DraftDown?.unloadExtension?.(id) ?? false;
    if (ok) {
      this.loaded.delete(id);
      if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(`draftdown:plugin-src:${id}`); }
        catch (e) { console.warn(`[PluginLoader.unload] localStorage removeItem ${id} failed:`, e); }
      }
    }
    return ok;
  }

  list(): LoadedPlugin[] { return Array.from(this.loaded.values()); }
}
