// @archigraph plugin.system.draftdown.index
// Entry point for the DraftDown Ruby API JS façade.
//
// Calling `installDraftDownAPI(doc, api, hostBackend)` mounts:
//   - window.DraftDown : DraftDownModule (DraftDown.*)
//   - window.Geom     : Geom namespace (Point3d / Vector3d / Transformation / BoundingBox)
//   - window.UI       : UI module (menus, dialogs, toolbars, messagebox)
//   - window.Length   : helper number↔string conversion (matches Ruby's Length class minimally)

import type { IModelDocument } from '../../../src/core/interfaces';
import type { IModelAPI } from '../../api.model/ModelAPI';

import * as GeomNs from './Geom';
import * as UINs from './UI';
import { DraftDownModule } from './DraftDown';

export interface InstallOptions {
  uiBackend?: UINs.UIBackend;
  toolManager?: import('../../../src/core/interfaces').IToolManager;
  viewport?: import('../../../src/core/interfaces').IViewport;
}

// Re-exports so plugins can `import { Point3d } from 'draftdown'` if bundled.
// `./Observers` is the canonical home for the observer interfaces — per-class
// modules export their own copies for intra-module use, but we forward the
// canonical names from `./Observers` to avoid TS export ambiguity.
export * from './Geom';
export * from './AttributeStore';
export * from './AttributeDictionary';
export {
  Entity, Drawingelement, Vertex, Edge, Face, EntityContext,
} from './Entity';
export {
  Entities, AnyEntity,
} from './Entities';
export * from './Group';
export {
  Selection,
} from './Selection';
export {
  Materials, Material, Color3, getCurrentMaterialId,
} from './Materials';
export {
  Layers, Layer, LayerFolder,
} from './Layers';
export * from './Curve';
export * from './Camera';
export {
  View, viewObservers,
} from './View';
export * from './PickHelper';
export * from './InputPoint';
export * from './Tool';
export {
  Pages, Page,
} from './Pages';
export {
  DefinitionList, ComponentDefinitionEx, DefinitionBehavior,
} from './DefinitionList';
export * from './Annotations';
export * from './SectionPlane';
export * from './Style';
export {
  RenderingOptions, ShadowInfo,
} from './RenderingOptions';
export * from './Options';
export * from './Importer';
export * from './ParametersStore';
export {
  DraftDownModule, DraftDownExtension,
} from './DraftDown';
export * from './Observers';
export * from './Model';
export { UINs as UI };

/** A trivial Length helper — wraps a number with a `.to_s` style serializer. */
export class Length {
  constructor(public value: number) {}
  toFloat(): number { return this.value; }
  toMm(): number { return this.value; }
  toString(): string { return `${this.value}mm`; }
}

let installedModule: DraftDownModule | null = null;

/** Install the DraftDown global. Idempotent — replaces the active model when called again. */
export function installDraftDownAPI(doc: IModelDocument, api: IModelAPI, opts: InstallOptions = {}): DraftDownModule {
  if (opts.uiBackend) UINs.setUIBackend(opts.uiBackend);

  if (installedModule) {
    installedModule.setActiveModel(doc, api, opts.toolManager, opts.viewport);
  } else {
    installedModule = new DraftDownModule(doc, api, opts.toolManager, opts.viewport);
  }

  // Install on `window` for the renderer, and on `globalThis` so Node tests can
  // exercise `DraftDown.*` without jsdom.
  const target: any = (typeof window !== 'undefined') ? window : globalThis;
  target.DraftDown = installedModule;
  target.Geom = GeomNs;
  target.UI = UINs;
  target.Length = Length;
  return installedModule;
}

export function getDraftDown(): DraftDownModule | null { return installedModule; }
