// @archigraph plugin.system.draftdown.host-ui
// Browser-side UI backend that satisfies UI.UIBackend by mounting menus, toolbars,
// and HtmlDialog instances into the running React app.
//
// We avoid importing React here so the file can be loaded outside the renderer too.
// React components observe the same global stores via their event emitters.

import {
  UIBackend, MenuLike, MenuItem, MenuItemHandler,
  HtmlDialogOptions, HtmlDialog, Toolbar, Command, setUIBackend,
} from './UI';

// ─── Stores ─────────────────────────────────────────────────────

type Listener = () => void;

class Emitter {
  private listeners = new Set<Listener>();
  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(): void { for (const l of this.listeners) try { l(); } catch (e) { console.error(e); } }
}

export interface MenuNode {
  name: string;
  items: Array<MenuItem | MenuNode | { separator: true }>;
}

export class MenuStore {
  readonly events = new Emitter();
  private root = new Map<string, MenuNode>();
  private nextId = 1;

  /** Get or create a top-level menu. */
  ensure(name: string): MenuNode {
    let m = this.root.get(name);
    if (!m) { m = { name, items: [] }; this.root.set(name, m); this.events.emit(); }
    return m;
  }

  list(): MenuNode[] { return Array.from(this.root.values()); }

  newItem(label: string, handler: MenuItemHandler): MenuItem {
    return { id: this.nextId++, label, handler };
  }
}

export class ToolbarStore {
  readonly events = new Emitter();
  private bars = new Map<string, ToolbarImpl>();

  ensure(name: string): ToolbarImpl {
    let t = this.bars.get(name);
    if (!t) { t = new ToolbarImpl(name, this.events); this.bars.set(name, t); this.events.emit(); }
    return t;
  }

  list(): ToolbarImpl[] { return Array.from(this.bars.values()); }
}

export class DialogStore {
  readonly events = new Emitter();
  private dialogs: HtmlDialogImpl[] = [];

  add(d: HtmlDialogImpl): void { this.dialogs.push(d); this.events.emit(); }
  remove(d: HtmlDialogImpl): void {
    const i = this.dialogs.indexOf(d);
    if (i >= 0) { this.dialogs.splice(i, 1); this.events.emit(); }
  }
  list(): HtmlDialogImpl[] { return this.dialogs.slice(); }
}

// ─── Implementations ────────────────────────────────────────────

class MenuImpl implements MenuLike {
  constructor(public node: MenuNode, private store: MenuStore) {}
  get name(): string { return this.node.name; }

  addItem(label: string, handler: MenuItemHandler): MenuItem {
    const item = this.store.newItem(label, handler);
    this.node.items.push(item);
    this.store.events.emit();
    return item;
  }

  addSubmenu(label: string): MenuLike {
    const sub: MenuNode = { name: label, items: [] };
    this.node.items.push(sub);
    this.store.events.emit();
    return new MenuImpl(sub, this.store);
  }

  addSeparator(): void {
    this.node.items.push({ separator: true });
    this.store.events.emit();
  }
}

class ToolbarImpl implements Toolbar {
  commands: Array<Command | { separator: true }> = [];
  private _visible = true;
  constructor(public name: string, private events: Emitter) {}

  addItem(command: Command): void { this.commands.push(command); this.events.emit(); }
  addSeparator(): void { this.commands.push({ separator: true }); this.events.emit(); }
  show(): void { this._visible = true; this.events.emit(); }
  hide(): void { this._visible = false; this.events.emit(); }
  visible(): boolean { return this._visible; }
  restore(): void { this.show(); }
}

class HtmlDialogImpl implements HtmlDialog {
  private _visible = false;
  private _html = '';
  private _url = '';
  private _size = { w: 0, h: 0 };
  private _pos = { x: 0, y: 0 };
  private _callbacks = new Map<string, (dialog: HtmlDialog, ...args: unknown[]) => void>();
  /** Mounted iframe element (created by the React panel). */
  iframe: HTMLIFrameElement | null = null;

  constructor(public options: HtmlDialogOptions, private store: DialogStore) {
    this._size = { w: options.width ?? 480, h: options.height ?? 320 };
    this._pos = { x: options.leftIndex ?? 60, y: options.topIndex ?? 60 };
  }

  setHtml(html: string): void {
    this._html = html;
    this._url = '';
    if (this.iframe) this.iframe.srcdoc = this.wrapHtml(html);
  }
  setUrl(url: string): void {
    this._url = url;
    this._html = '';
    if (this.iframe) this.iframe.src = url;
  }
  show(): void { this._visible = true; this.store.add(this); }
  close(): void { this._visible = false; this.store.remove(this); }
  visible(): boolean { return this._visible; }
  setSize(w: number, h: number): void { this._size = { w, h }; this.store.events.emit(); }
  setPosition(x: number, y: number): void { this._pos = { x, y }; this.store.events.emit(); }

  addActionCallback(name: string, fn: (dialog: HtmlDialog, ...args: unknown[]) => void): void {
    this._callbacks.set(name, fn);
  }

  executeScript(script: string): void {
    if (this.iframe?.contentWindow) {
      try { (this.iframe.contentWindow as any).eval(script); } catch (e) { console.error(e); }
    }
  }

  /** Bridge an `draftdown.callAction(name, ...args)` from inside the iframe to host callbacks. */
  invoke(name: string, ...args: unknown[]): void {
    const cb = this._callbacks.get(name);
    if (cb) try { cb(this, ...args); } catch (e) { console.error(e); }
  }

  /** Used by the renderer to read latest props. */
  snapshot() { return { html: this._html, url: this._url, size: this._size, pos: this._pos, options: this.options }; }

  private wrapHtml(html: string): string {
    // Bridge: window.draftdown.callAction(name, ...args)
    const bridge = `
      <script>
        window.draftdown = {
          callAction: function(name) {
            var args = Array.prototype.slice.call(arguments, 1);
            window.parent.postMessage({ __draftdownDialog: true, name: name, args: args }, '*');
          }
        };
      </script>`;
    return `${bridge}${html}`;
  }
}

// ─── Backend factory ────────────────────────────────────────────

export interface HostUI {
  menus: MenuStore;
  toolbars: ToolbarStore;
  dialogs: DialogStore;
}

export function createHostUI(): HostUI {
  const menus = new MenuStore();
  const toolbars = new ToolbarStore();
  const dialogs = new DialogStore();

  const backend: UIBackend = {
    getMenu(name) { return new MenuImpl(menus.ensure(name), menus); },
    htmlDialog(opts) { return new HtmlDialogImpl(opts, dialogs); },
    toolbar(name) { return toolbars.ensure(name); },
  };

  setUIBackend(backend);

  // Listen for postMessage from inside HtmlDialog iframes and forward to the right dialog.
  if (typeof window !== 'undefined') {
    window.addEventListener('message', (ev) => {
      const data = ev.data as any;
      if (!data || !data.__draftdownDialog) return;
      for (const d of dialogs.list()) {
        if (d.iframe?.contentWindow === ev.source) {
          d.invoke(data.name, ...(data.args ?? []));
          return;
        }
      }
    });
  }

  return { menus, toolbars, dialogs };
}

// Export the implementation classes so the React panel can render them.
export { MenuImpl, ToolbarImpl, HtmlDialogImpl };
