// @archigraph plugin.system.draftdown.ui
// DraftDown's UI module — dialogs, menus, toolbars, notifications.
// Reference: 
//
// We back the menu/toolbar registration with the existing PluginRegistry so the
// host application can render the contributions. Dialogs use browser primitives
// for now (window.alert/prompt/confirm) since they cover the 80% case.

export type MenuItemHandler = () => void | Promise<void>;

export interface MenuItem {
  id: number;
  label: string;
  handler: MenuItemHandler;
  validation?: () => 'enabled' | 'disabled' | 'checked' | 'grayed';
}

export interface MenuLike {
  /** UI::Menu#add_item("Label") { ... } */
  addItem(label: string, handler: MenuItemHandler): MenuItem;
  /** UI::Menu#add_submenu("Label") */
  addSubmenu(label: string): MenuLike;
  /** UI::Menu#add_separator */
  addSeparator(): void;
  /** DraftDown-specific menu metadata. */
  readonly name: string;
}

export interface UIBackend {
  /** Resolve / create a top-level menu. */
  getMenu(name: string): MenuLike;
  /** Spawn a HTMLDialog-like panel. */
  htmlDialog(opts: HtmlDialogOptions): HtmlDialog;
  /** Toolbar container. */
  toolbar(name: string): Toolbar;
}

let backend: UIBackend | null = null;

/** Install a backend; called once during DraftDown global setup. */
export function setUIBackend(b: UIBackend): void { backend = b; }

// ─── Menu API ───────────────────────────────────────────────────

const menuCache = new Map<string, MenuLike>();

/** UI.menu("Plugins") — accepts top-level menu names. */
export function menu(name: string): MenuLike {
  if (!backend) throw new Error('UI backend not installed');
  const cached = menuCache.get(name);
  if (cached) return cached;
  const m = backend.getMenu(name);
  menuCache.set(name, m);
  return m;
}

// ─── Dialogs ─────────────────────────────────────────────────────

/** UI.messagebox(message, type=MB_OK) — returns the chosen button index. */
export function messagebox(message: string, type: number = MB_OK): number {
  if (typeof window === 'undefined') return IDOK;
  if (type === MB_OK) { window.alert(message); return IDOK; }
  if (type === MB_OKCANCEL) { return window.confirm(message) ? IDOK : IDCANCEL; }
  if (type === MB_YESNO || type === MB_YESNOCANCEL) {
    return window.confirm(message) ? IDYES : IDNO;
  }
  window.alert(message);
  return IDOK;
}

/** UI.inputbox(prompts, defaults, list, title) — returns array of values, or false on cancel. */
export function inputbox(prompts: string[], defaults: string[] = [], _list: string[] = [], title = 'Input'): string[] | false {
  if (typeof window === 'undefined') return false;
  const out: string[] = [];
  for (let i = 0; i < prompts.length; i++) {
    const v = window.prompt(`[${title}] ${prompts[i]}`, defaults[i] ?? '');
    if (v === null) return false;
    out.push(v);
  }
  return out;
}

/** UI.beep() */
export function beep(): void {
  // Best-effort — most browsers no longer support audio without gesture.
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.1;
    o.start(); o.stop(ctx.currentTime + 0.08);
  } catch (e) { console.warn('[UI.beep] AudioContext beep failed:', e); }
}

/** UI.notification(extension, message) — minimal toast via console. */
export function notification(_extension: unknown, message: string): { show(): void; close(): void } {
  return {
    show() { console.info('[DraftDown]', message); },
    close() { /* noop */ },
  };
}

/** UI.openpanel(title, dir, filter) — returns selected file path or null. */
export async function openpanel(title = 'Open', _dir = '', filter = '*.*'): Promise<string | null> {
  // Fall back to <input type="file"> in the renderer process.
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filter.replace(/\*\./g, '.');
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? (f.name ?? null) : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
    void title;
  });
}

/** UI.savepanel — symmetric to openpanel. */
export async function savepanel(title = 'Save', _dir = '', defaultName = 'untitled'): Promise<string | null> {
  void title;
  return defaultName;
}

// ─── HTMLDialog ─────────────────────────────────────────────────

export interface HtmlDialogOptions {
  dialogTitle?: string;
  preferencesKey?: string;
  scrollable?: boolean;
  resizable?: boolean;
  width?: number;
  height?: number;
  leftIndex?: number;
  topIndex?: number;
  minWidth?: number;
  minHeight?: number;
  style?: number;
}

export interface HtmlDialog {
  setHtml(html: string): void;
  setUrl(url: string): void;
  show(): void;
  close(): void;
  visible(): boolean;
  addActionCallback(name: string, fn: (dialog: HtmlDialog, ...args: unknown[]) => void): void;
  executeScript(script: string): void;
  setSize(w: number, h: number): void;
  setPosition(x: number, y: number): void;
}

/** UI::HtmlDialog.new(options) constructor. */
export function htmlDialog(options: HtmlDialogOptions = {}): HtmlDialog {
  if (!backend) throw new Error('UI backend not installed');
  return backend.htmlDialog(options);
}

// ─── Toolbar ─────────────────────────────────────────────────────

export interface Command {
  name: string;
  tooltip?: string;
  statusBarText?: string;
  smallIcon?: string;
  largeIcon?: string;
  validationProc?: () => 'enabled' | 'disabled' | 'checked' | 'grayed';
  handler: () => void;
}

export interface Toolbar {
  name: string;
  addItem(command: Command): void;
  addSeparator(): void;
  show(): void;
  hide(): void;
  visible(): boolean;
  restore(): void;
}

export function toolbar(name: string): Toolbar {
  if (!backend) throw new Error('UI backend not installed');
  return backend.toolbar(name);
}

// ─── Constants (mirror Ruby) ────────────────────────────────────

export const MB_OK = 0;
export const MB_OKCANCEL = 1;
export const MB_ABORTRETRYIGNORE = 2;
export const MB_YESNOCANCEL = 3;
export const MB_YESNO = 4;
export const MB_RETRYCANCEL = 5;
export const MB_MULTILINE = 17;

export const IDOK = 1;
export const IDCANCEL = 2;
export const IDABORT = 3;
export const IDRETRY = 4;
export const IDIGNORE = 5;
export const IDYES = 6;
export const IDNO = 7;

// ─── Cursors ────────────────────────────────────────────────────

interface CustomCursor { id: number; filename: string; hotX: number; hotY: number; cssCursor: string }
const customCursors = new Map<number, CustomCursor>();
let nextCursorId = 1000;

/** UI.create_cursor(filename, x, y) — returns a cursor id usable with set_cursor. */
export function createCursor(filename: string, hotX = 0, hotY = 0): number {
  const id = nextCursorId++;
  // Convert filename → CSS url() cursor. For data URIs the browser will load directly.
  const url = filename.startsWith('data:') ? filename : `url('${filename}')`;
  const cssCursor = `${url} ${hotX} ${hotY}, auto`;
  customCursors.set(id, { id, filename, hotX, hotY, cssCursor });
  return id;
}

/** UI.set_cursor(cursorId | cssString) — applied to the canvas. */
export function setCursor(cursor: number | string): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.querySelector('canvas');
  if (!canvas) return false;
  const value = typeof cursor === 'number'
    ? (customCursors.get(cursor)?.cssCursor ?? 'default')
    : cursor;
  (canvas as HTMLElement).style.cursor = value;
  return true;
}

// ─── Timers ─────────────────────────────────────────────────────

const timerHandles = new Map<number, number>();
let nextTimerId = 1;

/** UI.start_timer(seconds, repeat, &block) → id */
export function startTimer(seconds: number, repeat: boolean, fn: () => void): number {
  const id = nextTimerId++;
  if (typeof window === 'undefined') return id;
  const ms = Math.max(1, seconds * 1000);
  if (repeat) {
    const h = window.setInterval(() => { try { fn(); } catch (e) { console.error(e); } }, ms);
    timerHandles.set(id, h);
  } else {
    const h = window.setTimeout(() => {
      try { fn(); } finally { timerHandles.delete(id); }
    }, ms);
    timerHandles.set(id, h);
  }
  return id;
}
/** UI.stop_timer(id) */
export function stopTimer(id: number): boolean {
  const h = timerHandles.get(id); if (h === undefined) return false;
  if (typeof window !== 'undefined') {
    // Best-effort: try both clearInterval and clearTimeout.
    window.clearInterval(h); window.clearTimeout(h);
  }
  timerHandles.delete(id); return true;
}

// ─── External / misc ────────────────────────────────────────────

/** UI.openURL(url) — open URL in the default browser. */
export function openURL(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const api = (window as any).api;
    if (api?.invoke) { api.invoke('shell:openExternal', { url }); return true; }
    window.open(url, '_blank', 'noopener');
    return true;
  } catch { return false; }
}

/** UI.select_directory(options) → path or nil */
export async function selectDirectory(options: { title?: string; default?: string } = {}): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const api = (window as any).api;
  if (api?.invoke) {
    try {
      const res = await api.invoke('dialog:open-directory', { title: options.title, defaultPath: options.default });
      return res ?? null;
    } catch { return null; }
  }
  return null;
}

/** UI.refresh_inspectors / UI.refresh_toolbars — emit events host UIs can listen to. */
export function refreshInspectors(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('draftdown:refresh-inspectors'));
}
export function refreshToolbars(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('draftdown:refresh-toolbars'));
}

/** UI.show_inspector(name) — make a panel visible; returns true if known. */
export function showInspector(name: string): boolean {
  if (typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent('draftdown:show-inspector', { detail: { name } }));
  return true;
}
/** UI.show_extension_manager. */
export function showExtensionManager(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('draftdown:show-extension-manager'));
}
/** UI.show_model_info(panelName?). */
export function showModelInfo(panel = ''): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('draftdown:show-model-info', { detail: { panel } }));
}
/** UI.show_preferences(panelName?). */
export function showPreferences(panel = ''): boolean {
  if (typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent('draftdown:show-preferences', { detail: { panel } }));
  return true;
}

/** UI.play_sound(filename) — best-effort. */
export function playSound(filename: string): boolean {
  if (typeof Audio === 'undefined') return false;
  try { new Audio(filename).play(); return true; } catch { return false; }
}

// ─── Context menu integration ────────────────────────────────────

export type ContextMenuHandler = (menu: MenuLike) => void;
const contextMenuHandlers = new Set<ContextMenuHandler>();

/** UI.add_context_menu_handler { |menu| ... } — returns an id. */
export function addContextMenuHandler(handler: ContextMenuHandler): number {
  contextMenuHandlers.add(handler);
  return contextMenuHandlers.size;
}
/** Internal — invoke all registered handlers on the supplied menu. */
export function invokeContextMenuHandlers(menu: MenuLike): void {
  for (const fn of contextMenuHandlers) try { fn(menu); } catch (e) { console.error(e); }
}

// ─── Preferences pages ──────────────────────────────────────────

const preferencesPages = new Set<string>();
export function addPreferencesPage(name: string): boolean { preferencesPages.add(name); return true; }
export function listPreferencesPages(): string[] { return Array.from(preferencesPages); }

// ─── WebDialog (legacy alias) ───────────────────────────────────

/** DraftDown pre-2017 used UI::WebDialog — alias to HtmlDialog so old plugins work. */
export const WebDialog = htmlDialog;

// ─── Parameters panel API ───────────────────────────────────────

import { getParametersStore, ParametersSection, ParameterField } from './ParametersStore';

/**
 * UI.parameters — DraftDown-specific parameters panel that mounts in the right rail
 * under "Entity Info". Tools and plugins use this to ask the user for input without
 * opening a modal dialog. Each section is keyed by `id` so the same plugin can update
 * its values reactively.
 */
export const parameters = {
  /** Show or replace a section. */
  show(section: ParametersSection): void { getParametersStore().show(section); },
  /** Hide a section. */
  hide(id: string): boolean { return getParametersStore().hide(id); },
  /** Programmatically update a section's values. */
  update(id: string, partial: Record<string, unknown>): boolean { return getParametersStore().update(id, partial); },
  /** Read the current values for a section. */
  values(id: string): Record<string, unknown> | null { return getParametersStore().values(id); },
};

export type { ParameterField, ParametersSection };
