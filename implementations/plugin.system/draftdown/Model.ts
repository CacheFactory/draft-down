// @archigraph plugin.system.draftdown.model
// DraftDown.Model — the root document wrapper.
// Reference: 

import type { IModelDocument } from '../../../src/core/interfaces';
import type { IModelAPI } from '../../api.model/ModelAPI';
import { getCurrentUnit, setCurrentUnit } from '../../../src/core/units';
import { Entities } from './Entities';
import { Selection } from './Selection';
import { Materials, Material } from './Materials';
import { Layers, Layer } from './Layers';
import { Pages } from './Pages';
import { DefinitionList } from './DefinitionList';
import { Styles } from './Style';
import { RenderingOptions, ShadowInfo } from './RenderingOptions';
import { OptionsManager } from './Options';
import { ImporterRegistry, ExporterRegistry } from './Importer';
import { AttributeStore } from './AttributeStore';
import { AttributeDictionaries, AttributeDictionary } from './AttributeDictionary';
import type { AttrValue } from './AttributeStore';
import { EntityContext, Entity, Vertex, Edge, Face, EntityObserver } from './Entity';
import { Group, ComponentInstance } from './Group';
import { BoundingBox, Point3d, Transformation, Vector3d } from './Geom';
import { View } from './View';
import { Camera } from './Camera';
import { ToolStack } from './Tool';
import type { IToolManager, IViewport } from '../../../src/core/interfaces';

export interface ViewLike {
  /** DraftDown.View#zoom_extents */
  zoomExtents(): void;
  /** DraftDown.View#refresh */
  refresh(): void;
  /** DraftDown.View#camera (best-effort). */
  camera: {
    eye: Point3d;
    target: Point3d;
    up: { x: number; y: number; z: number };
  };
}

/** Top-level model wrapper. */
export class Model {
  readonly entities: Entities;
  readonly selection: Selection;
  readonly materials: Materials;
  readonly layers: Layers;
  readonly pages: Pages;
  readonly definitions: DefinitionList;
  readonly styles: Styles;
  readonly renderingOptions: RenderingOptions;
  readonly shadowInfo: ShadowInfo;
  readonly options: OptionsManager;

  /** DraftDown.Model#tools — push/pop custom tools. */
  readonly tools: ToolStack;

  /** Document-level entity-id → AttributeDictionary store. */
  private _attributes: AttributeStore;
  private _entityObservers = new Map<string, Set<EntityObserver>>();

  constructor(
    public readonly doc: IModelDocument,
    private api: IModelAPI,
    attributes?: AttributeStore,
    importers?: ImporterRegistry,
    exporters?: ExporterRegistry,
    toolManager?: IToolManager,
    viewport?: IViewport,
  ) {
    this._attributes = attributes ?? new AttributeStore();
    this._importers = importers ?? new ImporterRegistry();
    this._exporters = exporters ?? new ExporterRegistry();

    const self = this;
    const ctx: EntityContext = {
      doc,
      api,
      resolveMaterial: (id) => id ? new Material(id, ctx) : null,
      attributes: this._attributes,
      entityObservers: this._entityObservers,
      resolveLayer: (id) => id ? new Layer(id, ctx) : null,
      defaultLayer: () => {
        // Layer0 / "default" — first layer, or create one.
        const first = doc.scene.layers.size > 0 ? doc.scene.layers.values().next().value : doc.scene.addLayer('Layer0');
        return new Layer((first as any).id, ctx);
      },
    };
    // Tag the model accessor on the context so Entity.model and Selection.model can resolve.
    (ctx as any).getModel = () => self;
    (ctx as any).resolveAnyEntity = (id: string): Entity | null => {
      const g = doc.geometry;
      if (g.getFace(id)) return new Face(id, ctx);
      if (g.getEdge(id)) return new Edge(id, ctx);
      if (g.getVertex(id)) return new Vertex(id, ctx);
      const e = doc.scene.getEntity(id);
      if (e?.type === 'group') return new Group(id, ctx);
      if (e?.type === 'component_instance') return new ComponentInstance(id, ctx);
      return null;
    };
    this._ctx = ctx;

    this.entities = new Entities(ctx);
    this.selection = new Selection(ctx);
    this.materials = new Materials(ctx);
    this.layers = new Layers(ctx);
    this.pages = new Pages(doc, (api as any).camera);
    this.definitions = new DefinitionList(ctx);
    const renderer = (api as any).viewport?.renderer ?? null;
    this.styles = new Styles(renderer);
    this.renderingOptions = new RenderingOptions(renderer);
    this.shadowInfo = new ShadowInfo();
    this.options = new OptionsManager(doc);

    const tm = toolManager ?? (api as any).toolManager ?? null;
    const vp = viewport ?? (api as any).viewport ?? null;
    this.tools = (tm && vp) ? new ToolStack(tm, vp) : (null as unknown as ToolStack);
  }

  private _ctx: EntityContext;
  private _importers: ImporterRegistry;
  private _exporters: ExporterRegistry;

  // ─── Document metadata ──────────────────────────────────────────

  /** DraftDown.Model#title — display name (no extension). */
  get title(): string { return this.doc.metadata.name; }
  set title(t: string) { this.doc.metadata.name = t; }

  /** DraftDown.Model#path — file path or empty string. */
  get path(): string { return this.doc.filePath ?? ''; }

  /** DraftDown.Model#description */
  get description(): string { return this.doc.metadata.description; }
  set description(s: string) { this.doc.metadata.description = s; }

  /**
   * The active display unit ('mm' | 'cm' | 'm' | 'inches' | 'feet').
   * Prefers the user-preference singleton (which the Preferences window keeps
   * in sync with the user's current Length Units choice). Falls back to the
   * document metadata for ancient docs that pre-date the preference singleton.
   * All geometry inside DraftDown is stored in meters; plugins use
   * `m.toInternal(v)` / `m.toDisplay(v)` to convert.
   */
  get units(): string {
    try {
      const live = getCurrentUnit();
      if (live) return live;
    } catch (e) { console.warn('[Model.units] getCurrentUnit failed:', e); }
    return this.doc.metadata.units;
  }
  set units(u: string) {
    (this.doc.metadata as any).units = u;
    try { setCurrentUnit(u as any); } catch (e) { console.warn('[Model.units=] setCurrentUnit failed:', e); }
  }

  /** Convert a value from the project's display unit to meters (engine units). */
  toInternal(value: number, unit?: string): number {
    const u = (unit ?? this.units) as 'mm' | 'cm' | 'm' | 'inches' | 'feet';
    const factors: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, inches: 0.0254, feet: 0.3048 };
    return value * (factors[u] ?? 1);
  }

  /** Convert a value from meters (engine units) to the project's display unit. */
  toDisplay(value: number, unit?: string): number {
    const u = (unit ?? this.units) as 'mm' | 'cm' | 'm' | 'inches' | 'feet';
    const factors: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, inches: 0.0254, feet: 0.3048 };
    return value / (factors[u] ?? 1);
  }

  /** DraftDown.Model#modified? */
  modified(): boolean { return this.doc.dirty; }

  /** DraftDown.Model#bounds → BoundingBox. */
  get bounds(): BoundingBox {
    const b = this.doc.geometry.getBoundingBox();
    const out = new BoundingBox();
    out.add(new Point3d(b.min.x, b.min.y, b.min.z));
    out.add(new Point3d(b.max.x, b.max.y, b.max.z));
    return out;
  }

  /** DraftDown.Model#active_view — the camera/viewport. Returns a full DraftDown.View. */
  get activeView(): View {
    const vp = (this.api as any).viewport;
    if (vp) return new View(vp);
    // Fallback when there's no viewport yet (e.g., headless): return a minimal stub.
    const api = this.api;
    return {
      zoomExtents() { api.zoomExtents(); },
      refresh() {},
      get camera() { return new Camera({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } } as any); },
    } as unknown as View;
  }

  /** DraftDown.Model#active_entities — top-level entities. */
  get activeEntities(): Entities { return this.entities; }

  /** DraftDown.Model#tags — alias of `layers` since SU 2020. */
  get tags(): Layers { return this.layers; }

  /** DraftDown.Model#guid — DraftDown re-uses the file path or a stable id. */
  get guid(): string {
    const stored = (this.doc as any).guid;
    if (stored) return stored;
    const fresh = `dd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    (this.doc as any).guid = fresh;
    return fresh;
  }

  /** DraftDown.Model#active_layer / active_layer= */
  get activeLayer(): Layer { return this._ctx.defaultLayer(); }
  set activeLayer(l: Layer) {
    if (this.doc.scene.layers.has(l.id)) (this.doc.scene as any)._activeLayerId = l.id;
  }

  /** DraftDown.Model#active_path — group hierarchy currently being edited. */
  get activePath(): Entity[] {
    const path = this.doc.scene.editingContext?.path ?? [];
    return path.map(id => (this._ctx as any).resolveAnyEntity?.(id)).filter(Boolean) as Entity[];
  }

  /** DraftDown.Model#number_faces */
  get numberFaces(): number { return this.doc.geometry.getMesh().faces.size; }

  /** DraftDown.Model#find_entity_by_id(id) — accepts a single id or array. */
  findEntityById(id: string | string[]): Entity | (Entity | null)[] | null {
    const lookup = (i: string) => (this._ctx as any).resolveAnyEntity?.(i) ?? null;
    if (Array.isArray(id)) return id.map(lookup);
    return lookup(id);
  }
  /** DraftDown.Model#find_entity_by_persistent_id(pid) */
  findEntityByPersistentId(pid: string | string[]): Entity | (Entity | null)[] | null {
    return this.findEntityById(pid);
  }

  /** DraftDown.Model#raytest(ray, wysiwyg=true) — first scene hit along the ray. */
  raytest(ray: [Point3d, Vector3d] | { origin: Point3d; direction: Vector3d }, _wysiwyg = true): { point: Point3d; entity: Entity | null } | null {
    const o = Array.isArray(ray) ? ray[0] : ray.origin;
    const d = Array.isArray(ray) ? ray[1] : ray.direction;
    const hits = this.doc.geometry.raycast({ origin: { x: o.x, y: o.y, z: o.z }, direction: { x: d.x, y: d.y, z: d.z } });
    if (hits.length === 0) return null;
    const first = hits[0];
    const wrap: Entity | null = (this._ctx as any).resolveAnyEntity?.(first.entityId) ?? null;
    return { point: new Point3d(first.point.x, first.point.y, first.point.z), entity: wrap };
  }

  /** DraftDown.Model#place_component(definition, repeats=false) — instantiates at origin. */
  placeComponent(definition: { id: string }, repeats = false): ComponentInstance | null {
    const sm: any = this.doc.scene;
    const inst = sm.placeComponentInstance?.(definition.id, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
    void repeats;
    return inst ? new ComponentInstance(inst.id, this._ctx) : null;
  }

  /** DraftDown.Model#close — clears geometry. */
  close(): boolean {
    this.doc.newDocument();
    return true;
  }

  /** DraftDown.Model#save / save_copy */
  async save(path = ''): Promise<boolean> { return this.saveFile(path); }
  async saveCopy(path: string): Promise<boolean> { return this.saveFile(path); }
  async saveFile(path = ''): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const api: any = (window as any).api;
    if (!api?.invoke) return false;
    try {
      const data = this.doc.serialize();
      if (path) await api.invoke('file:write', { filePath: path, data });
      else await api.invoke('menu:action', { action: 'save' });
      this.doc.markClean();
      return true;
    } catch { return false; }
  }
  /** DraftDown.Model#open_file(path) */
  async openFile(path: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const api: any = (window as any).api;
    if (!api?.invoke) return false;
    try {
      const res = await api.invoke('file:read', { filePath: path });
      if (!res) return false;
      this.doc.deserialize(res);
      return true;
    } catch { return false; }
  }
  /** DraftDown.Model#export(path, options) */
  async export(path: string, _options: Record<string, unknown> = {}): Promise<boolean> {
    const status = await this._exporters.dispatch(path);
    return status === 0;
  }
  /** DraftDown.Model#import(path, options) */
  async import(path: string, _options: Record<string, unknown> = {}): Promise<boolean> {
    const status = await this._importers.dispatch(path);
    return status === 0;
  }

  // ─── Attributes ─────────────────────────────────────────────────

  /** DraftDown.Model#attribute_dictionaries */
  get attributeDictionaries(): AttributeDictionaries {
    return new AttributeDictionaries(this.modelAttributeKey, this._attributes);
  }
  attributeDictionary(name: string, create = false): AttributeDictionary | null {
    const dicts = this.attributeDictionaries;
    const existing = dicts.at(name);
    if (existing) return existing;
    if (!create) return null;
    this._attributes.set(this.modelAttributeKey, name, '__dd_created__', true);
    return new AttributeDictionary(this.modelAttributeKey, name, this._attributes);
  }
  setAttribute(dict: string, key: string, value: AttrValue): void { this._attributes.set(this.modelAttributeKey, dict, key, value); }
  getAttribute(dict: string, key: string, fallback?: AttrValue): AttrValue | undefined { return this._attributes.get(this.modelAttributeKey, dict, key, fallback); }
  deleteAttribute(dict: string, key?: string): boolean {
    return key === undefined ? this._attributes.deleteDict(this.modelAttributeKey, dict)
                              : this._attributes.delete(this.modelAttributeKey, dict, key);
  }

  /** Internal: stable attribute key for the model itself. */
  private get modelAttributeKey(): string { return `__model__:${this.guid}`; }

  // ─── Observers ──────────────────────────────────────────────────

  private modelObservers = new Set<import('./Observers').ModelObserver>();
  addObserver(observer: import('./Observers').ModelObserver): void { this.modelObservers.add(observer); }
  removeObserver(observer: import('./Observers').ModelObserver): void { this.modelObservers.delete(observer); }

  /** Internal — broadcast a transaction event to model observers. */
  emitTransaction(kind: 'start' | 'commit' | 'abort' | 'undo' | 'redo'): void {
    for (const o of this.modelObservers) {
      try {
        if (kind === 'start') o.onTransactionStart?.(this);
        else if (kind === 'commit') o.onTransactionCommit?.(this);
        else if (kind === 'abort') o.onTransactionAbort?.(this);
        else if (kind === 'undo') o.onTransactionUndo?.(this);
        else if (kind === 'redo') o.onTransactionRedo?.(this);
      } catch (e) { console.error(e); }
    }
  }

  // ─── Operations (transactions) ──────────────────────────────────

  /**
   * DraftDown.Model#start_operation(name, disable_ui=true, next_transparent=false, transparent=false)
   * Begins an undoable transaction. Plugins should pair with `commitOperation` or `abortOperation`.
   */
  startOperation(name: string, _disableUI = true, _nextTransparent = false, _transparent = false): boolean {
    this.doc.history.beginTransaction(name);
    return true;
  }

  /** DraftDown.Model#commit_operation */
  commitOperation(): boolean {
    this.doc.history.commitTransaction();
    return true;
  }

  /** DraftDown.Model#abort_operation */
  abortOperation(): boolean {
    this.doc.history.abortTransaction();
    return true;
  }

  // ─── Convenience (not in real DraftDown but useful). ─────────────

  /** Direct access to the high-level ModelAPI for power users. */
  get api_(): IModelAPI { return this.api; }

  /** Internal context used to spawn child wrappers. */
  get _context(): EntityContext { return this._ctx; }
}
