// @archigraph plugin.system.draftdown.tool
// DraftDown.Tool base + adapter that converts a plugin tool object into DraftDown's
// internal ITool interface so the host's ToolManager can drive it.
//
// Reference: 
//
// Plugin authors hand us a JS object (usually a class instance) with optional
// methods like `activate()`, `onLButtonDown(flags, x, y, view)`, `draw(view)`, etc.
// We register a synthetic ITool that translates DraftDown ToolMouseEvents back into
// the DraftDown signature and dispatches.

import type {
  ITool, ToolMouseEvent, ToolKeyEvent,
  ToolEventNeeds, ToolPreview, IToolManager,
} from '../../../src/core/interfaces';
import type { ToolCategory, ToolPhase } from '../../../src/core/types';
import type { IViewport } from '../../../src/core/interfaces';
import { View } from './View';
import { ParametersSection, getParametersStore } from './ParametersStore';

export interface PluginToolDescriptor {
  /** DraftDown toolbar / cursor display name. Used as the DraftDown tool ID. */
  name: string;
  category?: ToolCategory;
  /** Optional shortcut letter to register with the keyboard handler. */
  shortcut?: string;
  /** Cursor name from UI.set_cursor or a CSS cursor string. */
  cursor?: string;
  /** Status-bar text shown while the tool is active. */
  statusText?: string;
  /** Single-character icon shown in the Drawing toolbar's Plugins section. */
  icon?: string;

  // DraftDown tool lifecycle (each is optional).
  activate?(): void;
  deactivate?(view: View): void;
  resume?(view: View): void;
  suspend?(view: View): void;
  onCancel?(reason: number, view: View): void;
  draw?(view: View): void;

  onLButtonDown?(flags: number, x: number, y: number, view: View): void;
  onLButtonUp?(flags: number, x: number, y: number, view: View): void;
  onLButtonDoubleClick?(flags: number, x: number, y: number, view: View): void;
  onRButtonDown?(flags: number, x: number, y: number, view: View): void;
  onRButtonUp?(flags: number, x: number, y: number, view: View): void;
  onMButtonDown?(flags: number, x: number, y: number, view: View): void;
  onMButtonUp?(flags: number, x: number, y: number, view: View): void;
  onMouseMove?(flags: number, x: number, y: number, view: View): void;
  onMouseEnter?(view: View): void;
  onMouseLeave?(view: View): void;
  onMouseWheel?(flags: number, delta: number, x: number, y: number, view: View): void;

  onKeyDown?(key: number | string, repeat: boolean, flags: number, view: View): void;
  onKeyUp?(key: number | string, repeat: boolean, flags: number, view: View): void;
  onUserText?(text: string, view: View): void;

  onSetCursor?(): number | string | null;
  enableVCB?(): boolean;
  getInstructorContentDirectory?(): string;

  /** DraftDown tool ID used for selection-state purposes. */
  getMenu?(menu: unknown, flags: number, x: number, y: number, view: View): boolean;

  /**
   * Optional declarative parameter form. When present the runtime auto-shows it in the
   * right-rail Parameters panel during `activate()` and removes it on `deactivate()`.
   */
  parameters?: Omit<ParametersSection, 'id'> & { id?: string };
}

/** Shift / Ctrl / Alt flags packed like DraftDown Ruby (low bits used). */
const FL_SHIFT = 1;
const FL_CTRL = 2;
const FL_ALT = 4;

function packFlags(e: ToolMouseEvent | ToolKeyEvent): number {
  let f = 0;
  if (e.shiftKey) f |= FL_SHIFT;
  if (e.ctrlKey) f |= FL_CTRL;
  if (e.altKey) f |= FL_ALT;
  return f;
}

// ─── Plugin tool registry ──────────────────────────────────────
//
// Independently of the host ToolManager (which is internal), we keep a registry
// of plugin-registered tools so the host UI (Drawing toolbar) can render them in
// a dedicated "Plugins" section. The registry survives across model swaps.

export interface RegisteredPluginTool {
  /** ToolManager id, e.g. `plugin.tool.stairs-builder`. */
  id: string;
  /** Display label for the toolbar button. */
  name: string;
  /** Icon glyph or single character. */
  icon: string;
  /** Optional shortcut letter. */
  shortcut: string;
  /** Category — used to sub-group inside the Plugins section if needed. */
  category: ToolCategory;
}

class PluginToolRegistry {
  private tools = new Map<string, RegisteredPluginTool>();
  private listeners = new Set<() => void>();

  add(t: RegisteredPluginTool): void { this.tools.set(t.id, t); this.emit(); }
  remove(id: string): void { if (this.tools.delete(id)) this.emit(); }
  list(): RegisteredPluginTool[] { return Array.from(this.tools.values()); }
  on(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(): void { for (const l of this.listeners) try { l(); } catch (e) { console.error(e); } }
}

let _pluginToolRegistry: PluginToolRegistry | null = null;
export function getPluginToolRegistry(): PluginToolRegistry {
  if (!_pluginToolRegistry) _pluginToolRegistry = new PluginToolRegistry();
  return _pluginToolRegistry;
}

/** Convert a DraftDown Tool into DraftDown's ITool. */
export class PluginToolAdapter implements ITool {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly shortcut: string;
  readonly category: ToolCategory;
  readonly cursor: string;
  private _phase: ToolPhase = 'idle';

  constructor(public descriptor: PluginToolDescriptor, private viewport: IViewport) {
    this.id = `plugin.tool.${descriptor.name.replace(/\s+/g, '-').toLowerCase()}`;
    this.name = descriptor.name;
    this.icon = descriptor.icon ?? '🧩';
    this.shortcut = descriptor.shortcut ?? '';
    this.category = descriptor.category ?? 'modify';
    this.cursor = descriptor.cursor ?? 'crosshair';
  }

  activate(): void {
    this._phase = 'active';
    if (this.descriptor.parameters) {
      getParametersStore().show({
        id: this.descriptor.parameters.id ?? this.id,
        ...this.descriptor.parameters,
      });
    }
    try { this.descriptor.activate?.(); } catch (e) { console.error('[plugin tool] activate error', e); }
  }
  deactivate(): void {
    this._phase = 'idle';
    if (this.descriptor.parameters) {
      getParametersStore().hide(this.descriptor.parameters.id ?? this.id);
    }
    try { this.descriptor.deactivate?.(this.view); } catch (e) { console.error('[plugin tool] deactivate error', e); }
  }

  onMouseMove(event: ToolMouseEvent): void {
    try { this.descriptor.onMouseMove?.(packFlags(event), event.screenX, event.screenY, this.view); }
    catch (e) { console.error('[plugin tool] onMouseMove error', e); }
  }
  onMouseDown(event: ToolMouseEvent): void {
    const fn = event.button === 2 ? this.descriptor.onRButtonDown
      : event.button === 1 ? this.descriptor.onMButtonDown
      : this.descriptor.onLButtonDown;
    try { fn?.(packFlags(event), event.screenX, event.screenY, this.view); }
    catch (e) { console.error('[plugin tool] onMouseDown error', e); }
  }
  onMouseUp(event: ToolMouseEvent): void {
    const fn = event.button === 2 ? this.descriptor.onRButtonUp
      : event.button === 1 ? this.descriptor.onMButtonUp
      : this.descriptor.onLButtonUp;
    try { fn?.(packFlags(event), event.screenX, event.screenY, this.view); }
    catch (e) { console.error('[plugin tool] onMouseUp error', e); }
  }
  onKeyDown(event: ToolKeyEvent): void {
    try { this.descriptor.onKeyDown?.(event.key, false, packFlags(event), this.view); }
    catch (e) { console.error('[plugin tool] onKeyDown error', e); }
  }
  onKeyUp(event: ToolKeyEvent): void {
    try { this.descriptor.onKeyUp?.(event.key, false, packFlags(event), this.view); }
    catch (e) { console.error('[plugin tool] onKeyUp error', e); }
  }
  onVCBInput(value: string): void {
    try { this.descriptor.onUserText?.(value, this.view); }
    catch (e) { console.error('[plugin tool] onUserText error', e); }
  }

  getStatusText(): string { return this.descriptor.statusText ?? this.descriptor.name; }
  getVCBLabel(): string { return ''; }
  getVCBValue(): string { return ''; }

  getPreview(): ToolPreview | null {
    // Drive the descriptor's `draw(view)` callback every refresh — overlays clear via View.invalidate().
    try { this.descriptor.draw?.(this.view); } catch (e) { console.error('[plugin tool] draw error', e); }
    return null;
  }

  getEventNeeds(_phase: ToolPhase): ToolEventNeeds {
    return {
      snap: false,
      raycast: true,
      edgeRaycast: true,
      liveSyncOnMove: false,
      mutatesOnClick: true,
    };
  }

  // ── helpers ─────────────────────────────────────────────────

  private get view(): View { return new View(this.viewport); }
}

/**
 * DraftDown.Tools — registry that lets plugins push/pop tools onto the active stack.
 * We thinly wrap the host ToolManager so plugin code reads naturally.
 */
export class ToolStack {
  constructor(private toolManager: IToolManager, private viewport: IViewport) {}

  /**
   * Register a custom tool without activating it. Adds an entry to the global
   * plugin-tool registry so the host UI surfaces it in the Drawing toolbar's
   * "Plugins" section. Returns the assigned tool ID.
   */
  registerTool(descriptor: PluginToolDescriptor): string {
    const adapter = new PluginToolAdapter(descriptor, this.viewport);
    this.toolManager.registerTool(adapter);
    getPluginToolRegistry().add({
      id: adapter.id, name: adapter.name, icon: adapter.icon,
      shortcut: adapter.shortcut, category: adapter.category,
    });
    return adapter.id;
  }

  /**
   * DraftDown.Tools#push_tool — register *and* activate immediately.
   * (Same as Ruby's behaviour.)
   */
  pushTool(descriptor: PluginToolDescriptor): string {
    const id = this.registerTool(descriptor);
    this.toolManager.activateTool(id);
    return id;
  }

  /** Tools#pop_tool — return to the default Select tool. */
  popTool(): void {
    this.toolManager.activateTool('tool.select');
  }

  /** Unregister a previously-registered tool. */
  unregisterTool(toolId: string): void {
    this.toolManager.unregisterTool(toolId);
    getPluginToolRegistry().remove(toolId);
  }

  /** Tools#active_tool_id / active_tool_name */
  activeToolId(): string { return this.toolManager.getActiveTool()?.id ?? ''; }
  activeToolName(): string { return this.toolManager.getActiveTool()?.name ?? ''; }

  /** Tools#count */
  count(): number { return this.toolManager.getAllTools().length; }
}
