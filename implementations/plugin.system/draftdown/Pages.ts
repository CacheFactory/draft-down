// @archigraph plugin.system.draftdown.pages
// DraftDown.Pages and DraftDown.Page (scene tabs).
//
// References:
//   
//   

import type { IScenePage, IModelDocument } from '../../../src/core/interfaces';
import type { ICameraController } from '../../../src/core/interfaces';
import { Point3d } from './Geom';

export class Page {
  constructor(public readonly raw: IScenePage, private doc: IModelDocument, private camera: ICameraController) {}

  get id(): string { return this.raw.id; }
  get name(): string { return this.raw.name; }
  set name(n: string) { this.raw.name = n; }

  /** Page#use_axes? / use_camera? — DraftDown stores these implicitly; default true. */
  useAxes(): boolean { return true; }
  useCamera(): boolean { return true; }
  useHidden(): boolean { return true; }
  useStyle(): boolean { return false; }
  useShadowInfo(): boolean { return false; }
  useRenderingOptions(): boolean { return true; }
  useSectionPlanes(): boolean { return true; }

  /** Page#camera */
  pageCamera(): { eye: Point3d; target: Point3d; fov: number; projection: string } {
    return {
      eye: new Point3d(this.raw.cameraPosition.x, this.raw.cameraPosition.y, this.raw.cameraPosition.z),
      target: new Point3d(this.raw.cameraTarget.x, this.raw.cameraTarget.y, this.raw.cameraTarget.z),
      fov: this.raw.cameraFov,
      projection: this.raw.projection,
    };
  }

  /** Page#update — capture the current camera state. */
  update(): Page {
    this.raw.cameraPosition = { ...this.camera.position };
    this.raw.cameraTarget = { ...this.camera.target };
    this.raw.cameraFov = this.camera.fov;
    this.raw.projection = this.camera.projection;
    return this;
  }

  /** Page#delay_time — transition seconds. We persist on the raw page object. */
  get delayTime(): number { return (this.raw as any).delayTime ?? 0; }
  set delayTime(v: number) { (this.raw as any).delayTime = v; }

  /** Page#transition_time — transition seconds. */
  get transitionTime(): number { return (this.raw as any).transitionTime ?? 1; }
  set transitionTime(v: number) { (this.raw as any).transitionTime = v; }

  /** Page#description */
  get description(): string { return (this.raw as any).description ?? ''; }
  set description(v: string) { (this.raw as any).description = v; }

  /** Activate this page — apply its camera + render mode. */
  select(): Page {
    this.camera.position.x = this.raw.cameraPosition.x;
    this.camera.position.y = this.raw.cameraPosition.y;
    this.camera.position.z = this.raw.cameraPosition.z;
    this.camera.target.x = this.raw.cameraTarget.x;
    this.camera.target.y = this.raw.cameraTarget.y;
    this.camera.target.z = this.raw.cameraTarget.z;
    this.camera.fov = this.raw.cameraFov;
    this.camera.setProjection(this.raw.projection);
    return this;
  }

  /** Page#layers — the layer-visibility map captured by this scene. */
  layerVisibility(): Record<string, boolean> { return { ...this.raw.layerVisibility }; }
}

export interface PagesObserver {
  onContentsModified?(pages: Pages): void;
  onElementAdded?(pages: Pages, page: Page): void;
  onElementRemoved?(pages: Pages, page: Page): void;
  onPageActivated?(pages: Pages, page: Page): void;
}

export class Pages {
  private observers = new Set<PagesObserver>();

  constructor(private doc: IModelDocument, private camera: ICameraController) {}

  /** Pages#count / .size / .length */
  get length(): number { return this.doc.scene.scenePages.length; }
  get count(): number { return this.length; }
  get size(): number { return this.length; }

  /** Pages#each */
  each(fn: (page: Page) => void): void {
    for (const raw of this.doc.scene.scenePages) fn(new Page(raw, this.doc, this.camera));
  }

  toArray(): Page[] {
    return this.doc.scene.scenePages.map(p => new Page(p, this.doc, this.camera));
  }

  /** Pages#[] — by index or name. */
  at(key: number | string): Page | null {
    if (typeof key === 'number') {
      const raw = this.doc.scene.scenePages[key];
      return raw ? new Page(raw, this.doc, this.camera) : null;
    }
    const raw = this.doc.scene.scenePages.find(p => p.name === key);
    return raw ? new Page(raw, this.doc, this.camera) : null;
  }

  /** Pages#add(name) — capture the current view as a new page. */
  add(name = 'Scene'): Page {
    const raw = this.doc.scene.addScenePage({
      name,
      cameraPosition: { ...this.camera.position },
      cameraTarget: { ...this.camera.target },
      cameraFov: this.camera.fov,
      projection: this.camera.projection,
      renderMode: 'shaded',
      layerVisibility: {},
    });
    const page = new Page(raw, this.doc, this.camera);
    this.emit('add', page);
    return page;
  }

  /** Pages#erase(page) */
  erase(page: Page | string | number): boolean {
    let id: string | null = null;
    if (typeof page === 'number') id = this.doc.scene.scenePages[page]?.id ?? null;
    else if (typeof page === 'string') id = this.doc.scene.scenePages.find(p => p.name === page)?.id ?? null;
    else id = page.id;
    if (!id) return false;
    const raw = this.doc.scene.scenePages.find(p => p.id === id);
    if (!raw) return false;
    this.doc.scene.removeScenePage(id);
    this.emit('remove', new Page(raw, this.doc, this.camera));
    return true;
  }

  /** Pages#selected_page — DraftDown doesn't currently track an "active" page; return last activated or null. */
  private _selected: Page | null = null;
  selectedPage(): Page | null { return this._selected; }
  /** Pages#selected_page= */
  selectPage(p: Page | null): void {
    this._selected = p;
    if (p) p.select();
    if (p) this.emit('activate', p);
  }

  /** Pages#parent — model wrapper (best-effort). */
  parent(): unknown { return null; }

  addObserver(o: PagesObserver): void { this.observers.add(o); }
  removeObserver(o: PagesObserver): void { this.observers.delete(o); }

  private emit(kind: 'add' | 'remove' | 'activate', page?: Page): void {
    for (const o of this.observers) {
      try {
        if (kind === 'add') o.onElementAdded?.(this, page!);
        else if (kind === 'remove') o.onElementRemoved?.(this, page!);
        else if (kind === 'activate') o.onPageActivated?.(this, page!);
        o.onContentsModified?.(this);
      } catch (e) { console.error(e); }
    }
  }
}
