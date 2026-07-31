// @archigraph plugin.system.draftdown.importer
// DraftDown.Importer + DraftDown.DraftDownExportPlugin (export).
// References:
//   
//    (renamed in 2025+ to Exporter)
//
// Plugins subclass Importer and call `DraftDown.register_importer(MyImporter.new)`.
// We expose the same registration model and dispatch import/export requests when the
// host triggers `model.import(path)` / `model.export(path)`.

export interface DraftDownImporter {
  /** UI label, e.g. "My Format Importer". */
  description(): string;
  /** Lowercase file extension (no dot). */
  fileExtension(): string;
  /** Returns this importer's id (free-form string, must be unique). */
  id(): string;
  /** Whether this importer supports presenting an options dialog before import. */
  supportsOptions(): boolean;
  /** Called by the host when the user clicks the Options button. */
  doOptions?(): void;
  /**
   * Load a file. Returns a numeric status:
   *   0 = success, 1 = cancel, 2 = file unavailable, 3 = unrecognized format,
   *   4 = error reported in `failure_reason`.
   */
  loadFile(filepath: string, statusBar?: boolean): Promise<number> | number;
}

export interface DraftDownExporter {
  description(): string;
  fileExtension(): string;
  id(): string;
  supportsOptions(): boolean;
  doOptions?(): void;
  /** Save current model to filepath. Returns the same status codes as loadFile. */
  saveFile(filepath: string, statusBar?: boolean): Promise<number> | number;
}

export class ImporterRegistry {
  private byExt = new Map<string, DraftDownImporter>();
  private byId = new Map<string, DraftDownImporter>();

  /** DraftDown.register_importer(importer) */
  register(importer: DraftDownImporter): boolean {
    this.byId.set(importer.id(), importer);
    this.byExt.set(importer.fileExtension().toLowerCase(), importer);
    return true;
  }

  unregister(idOrExt: string): boolean {
    const i = this.byId.get(idOrExt);
    if (i) { this.byId.delete(i.id()); this.byExt.delete(i.fileExtension().toLowerCase()); return true; }
    const e = this.byExt.get(idOrExt.toLowerCase());
    if (e) { this.byId.delete(e.id()); this.byExt.delete(idOrExt.toLowerCase()); return true; }
    return false;
  }

  forExtension(ext: string): DraftDownImporter | null { return this.byExt.get(ext.toLowerCase()) ?? null; }
  list(): DraftDownImporter[] { return Array.from(this.byId.values()); }

  /** Dispatch an import. Returns status code from the importer. */
  async dispatch(filepath: string, statusBar = true): Promise<number> {
    const ext = filepath.split('.').pop()?.toLowerCase() ?? '';
    const i = this.byExt.get(ext);
    if (!i) return 3;
    return Promise.resolve(i.loadFile(filepath, statusBar));
  }
}

export class ExporterRegistry {
  private byExt = new Map<string, DraftDownExporter>();
  private byId = new Map<string, DraftDownExporter>();

  register(exporter: DraftDownExporter): boolean {
    this.byId.set(exporter.id(), exporter);
    this.byExt.set(exporter.fileExtension().toLowerCase(), exporter);
    return true;
  }
  unregister(idOrExt: string): boolean {
    const i = this.byId.get(idOrExt);
    if (i) { this.byId.delete(i.id()); this.byExt.delete(i.fileExtension().toLowerCase()); return true; }
    const e = this.byExt.get(idOrExt.toLowerCase());
    if (e) { this.byId.delete(e.id()); this.byExt.delete(idOrExt.toLowerCase()); return true; }
    return false;
  }
  forExtension(ext: string): DraftDownExporter | null { return this.byExt.get(ext.toLowerCase()) ?? null; }
  list(): DraftDownExporter[] { return Array.from(this.byId.values()); }

  async dispatch(filepath: string, statusBar = true): Promise<number> {
    const ext = filepath.split('.').pop()?.toLowerCase() ?? '';
    const e = this.byExt.get(ext);
    if (!e) return 3;
    return Promise.resolve(e.saveFile(filepath, statusBar));
  }
}
