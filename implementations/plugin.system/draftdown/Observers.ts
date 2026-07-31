// @archigraph plugin.system.draftdown.observers
// All observer protocols. Real DraftDown ships ~17 observer protocols; we declare the
// full set as TS interfaces. Subscription happens through DraftDown.* / collection-level
// add_observer methods (each collection class hosts its own Set<observer>).
//
// Each interface mirrors the Ruby method names (camelCased so plugin authors can drop in
// objects without `respond_to?` magic).

import type { Model } from './Model';
import type { Selection } from './Selection';
import type { Materials } from './Materials';
import type { Material } from './Materials';
import type { Layers } from './Layers';
import type { Layer } from './Layers';
import type { Pages, Page } from './Pages';
import type { Entity } from './Entity';
import type { ToolStack } from './Tool';
import type { View } from './View';
import type { OptionsProvider } from './Options';
import type { RenderingOptions, ShadowInfo } from './RenderingOptions';
import type { DefinitionList, ComponentDefinitionEx } from './DefinitionList';

export interface AppObserver {
  onNewModel?(model: Model): void;
  onOpenModel?(model: Model): void;
  onActivateModel?(model: Model): void;
  onQuit?(): void;
  onUnloadExtension?(name: string): void;
}

export interface ModelObserver {
  onPreSaveModel?(model: Model): void;
  onPostSaveModel?(model: Model): void;
  onSaveModel?(model: Model): void;
  onTransactionStart?(model: Model): void;
  onTransactionCommit?(model: Model): void;
  onTransactionAbort?(model: Model): void;
  onTransactionUndo?(model: Model): void;
  onTransactionRedo?(model: Model): void;
  onActivePathChanged?(model: Model): void;
  onPlaceComponent?(instance: Entity): void;
}

export interface SelectionObserver {
  onSelectionBulkChange?(selection: Selection): void;
  onSelectionAdded?(selection: Selection, entity: Entity): void;
  onSelectionRemoved?(selection: Selection, entity: Entity): void;
  onSelectionCleared?(selection: Selection): void;
}

export interface EntityObserver {
  onChangeEntity?(entity: Entity): void;
  onEraseEntity?(entity: Entity): void;
}

export interface EntitiesObserver {
  onElementAdded?(entities: unknown, entity: Entity): void;
  onElementModified?(entities: unknown, entity: Entity): void;
  onElementRemoved?(entities: unknown, entity_id: string): void;
  onContentsModified?(entities: unknown): void;
  onActiveSectionPlaneChanged?(entities: unknown): void;
}

export interface ToolsObserver {
  onActiveToolChanged?(tools: ToolStack, toolName: string, toolId: number): void;
  onToolStateChanged?(tools: ToolStack, toolName: string, toolId: number, state: number): void;
}

export interface ViewObserver {
  onViewChanged?(view: View): void;
}

export interface MaterialsObserver {
  onMaterialAdd?(materials: Materials, mat: Material): void;
  onMaterialChange?(materials: Materials, mat: Material): void;
  onMaterialRemove?(materials: Materials, mat: Material): void;
  onMaterialRefChange?(materials: Materials, mat: Material): void;
  onMaterialSetCurrent?(materials: Materials, mat: Material): void;
  onMaterialUndoRedo?(materials: Materials, mat: Material): void;
}

export interface LayersObserver {
  onCurrentLayerChanged?(layers: Layers, layer: Layer): void;
  onLayerAdded?(layers: Layers, layer: Layer): void;
  onLayerChanged?(layers: Layers, layer: Layer): void;
  onLayerRemoved?(layers: Layers, layer: Layer): void;
  onRemoveAllLayers?(layers: Layers): void;
  onLayerFolderAdded?(layers: Layers, folder: unknown): void;
  onLayerFolderRemoved?(layers: Layers, folder: unknown): void;
}

export interface PagesObserver {
  onContentsModified?(pages: Pages): void;
  onElementAdded?(pages: Pages, page: Page): void;
  onElementRemoved?(pages: Pages, page: Page): void;
  onPageActivated?(pages: Pages, page: Page): void;
}

export interface DefinitionsObserver {
  onComponentAdded?(definitions: DefinitionList, def: ComponentDefinitionEx): void;
  onComponentRemoved?(definitions: DefinitionList, def: ComponentDefinitionEx): void;
  onComponentPropertiesChanged?(definitions: DefinitionList, def: ComponentDefinitionEx): void;
  onComponentTypeChanged?(definitions: DefinitionList, def: ComponentDefinitionEx): void;
}

export interface InstanceObserver {
  onOpen?(instance: Entity): void;
  onClose?(instance: Entity): void;
}

export interface FrameChangeObserver {
  onFrameChange?(fromPage: Page | null, toPage: Page, percentDone: number): void;
}

export interface OptionsManagerObserver {
  onOptionsProviderChanged?(provider: OptionsProvider, name: string): void;
}

export interface RenderingOptionsObserver {
  onRenderingOptionsChanged?(opts: RenderingOptions, key: string): void;
}

export interface ShadowInfoObserver {
  onShadowInfoChanged?(info: ShadowInfo, key: string): void;
}
