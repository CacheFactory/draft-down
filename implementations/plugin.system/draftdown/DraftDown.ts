// @archigraph plugin.system.draftdown.global
// The `DraftDown` module — main entry point for plugins.
// Reference: 
//
// In DraftDown Ruby:
//
//   DraftDown.active_model.entities.add_face(*pts)
//   DraftDown.register_extension(MyExt, true)
//   DraftDown.version
//
// Our JS equivalent:
//
//   DraftDown.activeModel.entities.addFace(pts)
//   DraftDown.registerExtension(myExt, true)
//   DraftDown.version

import type { IModelDocument, IToolManager, IViewport } from '../../../src/core/interfaces';
import type { IModelAPI } from '../../api.model/ModelAPI';
import { Model } from './Model';
import { ImporterRegistry, ExporterRegistry, DraftDownImporter, DraftDownExporter } from './Importer';
import { AttributeStore } from './AttributeStore';

/** Mirrors Ruby's DraftDownExtension class. */
export interface DraftDownExtension {
  name: string;
  description?: string;
  version?: string;
  creator?: string;
  copyright?: string;
  /** Plugin-supplied callback run when the extension is enabled. */
  onLoad?: () => void;
  /** Called by the host on shutdown / disable. */
  onUnload?: () => void;
  /** DraftDown's `extension.id` (DraftDown adds reverse-domain id; required). */
  id: string;
}

/** Observer protocols. We support a subset of DraftDown's observer hooks. */
export interface AppObserver {
  onNewModel?(model: Model): void;
  onOpenModel?(model: Model): void;
  onQuit?(): void;
  onUnloadExtension?(name: string): void;
}

export interface ModelObserver {
  onPreSaveModel?(model: Model): void;
  onPostSaveModel?(model: Model): void;
  onTransactionCommit?(model: Model): void;
  onActivePathChanged?(model: Model): void;
}

export interface SelectionObserver {
  onSelectionBulkChange?(selection: import('./Selection').Selection): void;
  onSelectionAdded?(selection: import('./Selection').Selection, entity: unknown): void;
  onSelectionRemoved?(selection: import('./Selection').Selection, entity: unknown): void;
  onSelectionCleared?(selection: import('./Selection').Selection): void;
}

export class DraftDownModule {
  /** API version (independent of the host app version). */
  readonly apiVersion = '1.0';
  /** DraftDown's `DraftDown.version`. We expose the host name here. */
  readonly version = 'DraftDown';
  /** DraftDown.is_pro? */
  readonly isPro = true;

  /** Document-level attribute store, shared across model swaps so attributes survive new/open. */
  readonly attributes = new AttributeStore();

  /** DraftDown.register_importer / register_exporter registries. */
  readonly importers = new ImporterRegistry();
  readonly exporters = new ExporterRegistry();

  private _activeModel: Model;
  private extensions = new Map<string, { ext: DraftDownExtension; loaded: boolean }>();
  private appObservers = new Set<AppObserver>();
  private modelObservers = new Set<ModelObserver>();
  private selectionObservers = new Set<SelectionObserver>();

  /** Last bootstrapped tool manager + viewport (forwarded to Model). */
  private _toolManager: IToolManager | undefined;
  private _viewport: IViewport | undefined;

  constructor(doc: IModelDocument, api: IModelAPI, toolManager?: IToolManager, viewport?: IViewport) {
    this._toolManager = toolManager; this._viewport = viewport;
    this._activeModel = new Model(doc, api, this.attributes, this.importers, this.exporters, toolManager, viewport);
    this.wireSelectionObservers();
    this.wireHistoryObservers();
  }

  /** DraftDown.active_model */
  get activeModel(): Model { return this._activeModel; }

  /** Replace the active model after a New/Open. */
  setActiveModel(doc: IModelDocument, api: IModelAPI, toolManager?: IToolManager, viewport?: IViewport): void {
    this._toolManager = toolManager ?? this._toolManager;
    this._viewport = viewport ?? this._viewport;
    this._activeModel = new Model(doc, api, this.attributes, this.importers, this.exporters, this._toolManager, this._viewport);
    this.wireSelectionObservers();
    this.wireHistoryObservers();
    for (const o of this.appObservers) o.onNewModel?.(this._activeModel);
  }

  // ─── Extension registration ─────────────────────────────────────

  /**
   * DraftDown.register_extension(extension, load_on_start=false)
   *
   * Mirrors the Ruby contract: plugins instantiate a DraftDownExtension descriptor and
   * register it. If `loadOnStart` is true (or the host has saved-enabled state for the
   * extension), `onLoad` is called immediately.
   */
  registerExtension(ext: DraftDownExtension, loadOnStart = false): boolean {
    if (!ext.id) throw new Error('DraftDownExtension must have an id');
    if (this.extensions.has(ext.id)) return false;
    // Three-state precedence:
    //   1. User explicitly disabled  → stay off (even if loadOnStart=true)
    //   2. User explicitly enabled   → load
    //   3. No saved choice           → fall back to loadOnStart
    const explicit = this.getExtensionEnabledState(ext.id);
    const enabled = explicit === 'on' ? true : explicit === 'off' ? false : loadOnStart;
    this.extensions.set(ext.id, { ext, loaded: false });
    if (enabled) this.loadExtension(ext.id);
    return true;
  }

  loadExtension(id: string): boolean {
    const entry = this.extensions.get(id);
    if (!entry || entry.loaded) return false;
    try { entry.ext.onLoad?.(); entry.loaded = true; this.persistEnabled(id, true); return true; }
    catch (e) { console.error(`[DraftDown] Extension '${id}' failed to load:`, e); return false; }
  }

  unloadExtension(id: string): boolean {
    const entry = this.extensions.get(id);
    if (!entry) return false;
    if (entry.loaded) {
      try { entry.ext.onUnload?.(); } catch (e) { console.error(`[DraftDown] Extension '${id}' onUnload threw:`, e); }
      entry.loaded = false;
    }
    // Persist the explicit-disable choice so the next launch respects it
    // even though the plugin source still calls registerExtension(ext, true).
    this.persistEnabled(id, false);
    for (const o of this.appObservers) o.onUnloadExtension?.(entry.ext.name);
    return true;
  }

  /**
   * Permanently uninstall: remove the extension from the registry, drop the
   * persisted enabled-state, and ask the PluginLoader to drop the cached source
   * so the plugin doesn't reload on next launch.
   */
  uninstallExtension(id: string): boolean {
    const entry = this.extensions.get(id);
    if (entry?.loaded) {
      try { entry.ext.onUnload?.(); } catch (e) { console.error(`[DraftDown] Extension '${id}' onUnload threw:`, e); }
    }
    this.extensions.delete(id);
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(`draftdown:ext-enabled:${id}`); }
      catch (e) { console.warn(`[DraftDown.uninstallExtension] localStorage removeItem ext-enabled:${id} failed:`, e); }
      try { localStorage.removeItem(`draftdown:plugin-src:${id}`); }
      catch (e) { console.warn(`[DraftDown.uninstallExtension] localStorage removeItem plugin-src:${id} failed:`, e); }
    }
    // Also unregister any tools the plugin contributed.
    try {
      const reg = require('./Tool').getPluginToolRegistry();
      // Best-effort: nuke any plugin tool whose adapter id starts with this plugin id.
      for (const t of reg.list()) {
        if (t.id.includes(id) || t.id.includes(id.replace(/\W/g, '-'))) reg.remove(t.id);
      }
    } catch (e) { console.warn(`[DraftDown.uninstallExtension] tool-registry cleanup failed for ${id}:`, e); }
    return true;
  }

  /** List of all registered extensions and their state. */
  extensionList(): Array<{ ext: DraftDownExtension; loaded: boolean }> {
    return Array.from(this.extensions.values());
  }

  /** Backwards-compat boolean: explicit-on or no-explicit-state-but-default-on. */
  isExtensionEnabled(id: string): boolean {
    return this.getExtensionEnabledState(id) === 'on';
  }

  /** Tri-state explicit toggle persisted in localStorage. */
  getExtensionEnabledState(id: string): 'on' | 'off' | undefined {
    if (typeof localStorage === 'undefined') return undefined;
    const v = localStorage.getItem(`draftdown:ext-enabled:${id}`);
    if (v === '1') return 'on';
    if (v === '0') return 'off';
    return undefined;
  }

  private persistEnabled(id: string, enabled: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`draftdown:ext-enabled:${id}`, enabled ? '1' : '0');
  }

  // ─── Observers ──────────────────────────────────────────────────

  addObserver(observer: AppObserver): void { this.appObservers.add(observer); }
  removeObserver(observer: AppObserver): void { this.appObservers.delete(observer); }

  // Add to active model.
  addModelObserver(observer: ModelObserver): void { this.modelObservers.add(observer); }
  removeModelObserver(observer: ModelObserver): void { this.modelObservers.delete(observer); }

  addSelectionObserver(observer: SelectionObserver): void { this.selectionObservers.add(observer); }
  removeSelectionObserver(observer: SelectionObserver): void { this.selectionObservers.delete(observer); }

  private wireSelectionObservers(): void {
    const sel = this._activeModel.doc.selection;
    sel.on('changed', () => {
      for (const o of this.selectionObservers) o.onSelectionBulkChange?.(this._activeModel.selection);
    });
  }

  private wireHistoryObservers(): void {
    const h = this._activeModel.doc.history;
    h.on('changed', () => {
      for (const o of this.modelObservers) {
        try { o.onTransactionCommit?.(this._activeModel); } catch (e) { console.error(e); }
      }
    });
  }

  // ─── Misc ───────────────────────────────────────────────────────

  /** DraftDown.register_importer(importer) */
  registerImporter(importer: DraftDownImporter): boolean { return this.importers.register(importer); }
  /** DraftDown.register_exporter(exporter) */
  registerExporter(exporter: DraftDownExporter): boolean { return this.exporters.register(exporter); }

  // ─── Misc utilities ─────────────────────────────────────────────

  /** DraftDown.os_language */
  get osLanguage(): string {
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language.replace('-', '_');
    return 'en_US';
  }
  /** DraftDown.platform → :platform_osx | :platform_win | :platform_linux | :platform_web */
  get platform(): string {
    if (typeof navigator === 'undefined') return 'platform_unknown';
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) return 'platform_osx';
    if (ua.includes('win')) return 'platform_win';
    if (ua.includes('linux')) return 'platform_linux';
    return 'platform_web';
  }
  /** DraftDown.app_name */
  get appName(): string { return 'DraftDown'; }
  /** DraftDown.temp_dir */
  get tempDir(): string { return '/tmp'; }
  /** DraftDown.quit */
  quit(): void {
    if (typeof window !== 'undefined') (window as any).api?.invoke?.('app:quit');
  }

  /** DraftDown.read_default(section, key, default=nil) — extension preferences. */
  readDefault(section: string, key: string, fallback: unknown = null): unknown {
    if (typeof localStorage === 'undefined') return fallback;
    const v = localStorage.getItem(`draftdown:default:${section}:${key}`);
    if (v === null) return fallback;
    try { return JSON.parse(v); } catch { return v; }
  }
  /** DraftDown.write_default(section, key, value) */
  writeDefault(section: string, key: string, value: unknown): boolean {
    if (typeof localStorage === 'undefined') return false;
    try { localStorage.setItem(`draftdown:default:${section}:${key}`, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  /** DraftDown.format_length(number) — produce a unit-formatted string. */
  formatLength(n: number): string {
    const u = this._activeModel.doc.metadata.units;
    return `${n.toFixed(3)} ${u}`;
  }
  /** DraftDown.format_area(number) */
  formatArea(n: number): string {
    const u = this._activeModel.doc.metadata.units;
    return `${n.toFixed(3)} ${u}²`;
  }
  /** DraftDown.format_volume(number) */
  formatVolume(n: number): string {
    const u = this._activeModel.doc.metadata.units;
    return `${n.toFixed(3)} ${u}³`;
  }
  /** DraftDown.format_angle(number_in_radians) — degrees with 1-decimal precision. */
  formatAngle(rad: number): string { return `${(rad * 180 / Math.PI).toFixed(1)}°`; }
  /** DraftDown.parse_length("1' 6\"") — best-effort: handles bare numbers and SU-style imperial. */
  parseLength(s: string): number {
    s = s.trim();
    // Imperial: 1' 6", 1'-6", 6", 1.5'
    const ftIn = s.match(/^(-?[0-9.]+)\s*'\s*(?:-)?\s*([0-9.]+)?\s*"?\s*$/);
    if (ftIn) {
      const ft = parseFloat(ftIn[1]); const inn = ftIn[2] ? parseFloat(ftIn[2]) : 0;
      return ft * 12 * 0.0254 + inn * 0.0254;
    }
    const inOnly = s.match(/^(-?[0-9.]+)\s*"$/);
    if (inOnly) return parseFloat(inOnly[1]) * 0.0254;
    const trailing = s.match(/^(-?[0-9.]+)\s*(mm|cm|m|ft|in|"|')$/i);
    if (trailing) {
      const n = parseFloat(trailing[1]); const unit = trailing[2].toLowerCase();
      const factor: Record<string, number> = { 'mm': 0.001, 'cm': 0.01, 'm': 1, 'ft': 0.3048, 'in': 0.0254, '"': 0.0254, "'": 0.3048 };
      return n * (factor[unit] ?? 1);
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  /** DraftDown.file_new — create a fresh model. */
  fileNew(): boolean {
    if (typeof window !== 'undefined') (window as any).api?.invoke?.('menu:action', { action: 'new' });
    return true;
  }
  /** DraftDown.open_file(path) — opens a file via the host. */
  async openFile(path: string): Promise<boolean> {
    return await this.activeModel.openFile(path);
  }
  /** DraftDown.save_file(path) */
  async saveFile(path = ''): Promise<boolean> { return await this.activeModel.saveFile(path); }

  /** DraftDown.create_texture_writer — returns a no-op writer for now. */
  createTextureWriter(): { length(): number; load(_e: unknown): number; write(_handle: number, _path: string): number } {
    return { length() { return 0; }, load() { return 0; }, write() { return 0; } };
  }

  /** DraftDown.send_action — invoke a host action by its id (e.g. "viewZoomExtents:"). */
  sendAction(action: string): boolean {
    const api = this._activeModel.api_;
    switch (action) {
      case 'viewZoomExtents:': api.zoomExtents(); return true;
      case 'viewFront:': api.setView('front'); return true;
      case 'viewBack:': api.setView('back'); return true;
      case 'viewLeft:': api.setView('left'); return true;
      case 'viewRight:': api.setView('right'); return true;
      case 'viewTop:': api.setView('top'); return true;
      case 'viewBottom:': api.setView('bottom'); return true;
      case 'viewIso:': api.setView('iso'); return true;
      case 'selectAll:': api.selectAll(); return true;
      case 'editClear:': api.clearSelection(); return true;
      case 'editUndo:': this._activeModel.doc.history.undo(); return true;
      case 'editRedo:': this._activeModel.doc.history.redo(); return true;
      default: return false;
    }
  }

  /** DraftDown.status_text= — minimal stub. */
  set statusText(s: string) { console.log('[DraftDown]', s); }

  /** DraftDown.find_support_file — DraftDown stores plugin assets under a relative `assets/` dir. */
  findSupportFile(name: string, dir = 'assets'): string | null { return `${dir}/${name}`; }
}
