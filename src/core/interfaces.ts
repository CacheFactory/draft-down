// @archigraph core-interfaces
// Core interfaces for DraftDown subsystems

import {
  Vec3, Vec2, Ray, BoundingBox, Transform, Color,
  EntityType, Entity, MaterialDef, InferenceResult, InferenceType,
  RenderMode, ProjectionType, SelectionMode, LengthUnit,
  ToolCategory, ToolPhase, Plane,
} from './types';

// ─── Geometry Engine ─────────────────────────────────────────────

export interface IVertex {
  id: string;
  position: Vec3;
  selected: boolean;
  hidden: boolean;
}

export interface IEdge {
  id: string;
  startVertexId: string;
  endVertexId: string;
  soft: boolean;
  smooth: boolean;
  selected: boolean;
  hidden: boolean;
  materialIndex: number;
  curveId?: string;
}

export interface IFace {
  id: string;
  vertexIds: string[];
  normal: Vec3;
  plane: Plane;
  materialIndex: number;
  backMaterialIndex: number;
  selected: boolean;
  hidden: boolean;
  area: number;
  holeStartIndices?: number[];
  /** Per-vertex UV coordinates from OBJ import (one {u,v} per vertexId). */
  uvs?: Array<{ u: number; v: number }>;
  /** Monotonically increasing counter, bumped on any mutation. */
  generation: number;
}

export interface IHalfEdge {
  id: string;
  originVertexId: string;
  twinId: string | null;
  nextId: string;
  prevId: string;
  faceId: string | null;
  edgeId: string;
}

export interface IMesh {
  vertices: Map<string, IVertex>;
  edges: Map<string, IEdge>;
  faces: Map<string, IFace>;
  halfEdges: Map<string, IHalfEdge>;
}

export interface IGeometryEngine {
  createVertex(position: Vec3): IVertex;
  createEdge(v1Id: string, v2Id: string): IEdge;
  createEdgeWithAutoFace(v1Id: string, v2Id: string): IEdge;
  createEdgeWithIntersection(v1Id: string, v2Id: string): IEdge[];
  splitFaceWithPath(pathVertexIds: string[]): void;
  /** classic CAD coplanar merge: split every face crossed by a closed drawn
   *  ring (rectangle/circle/polygon outline) so coplanar faces never
   *  overlap. Call after the ring's edges exist. Returns the number of
   *  face splits performed (0 = ring touched no faces). */
  splitFacesWithClosedRing(ringVertexIds: string[]): number;
  /** Flip a face's winding + normal (classic CAD Reverse Faces). */
  reverseFace(faceId: string): void;
  /** classic CAD autofold: triangulate adjacent faces made non-planar by a
   *  vertex move. Returns the number of faces folded. */
  autofoldNonPlanarFaces(movedVertexIds: string[]): number;
  /** Make connected faces' windings consistent with the seed (classic CAD
   *  Orient Faces). Returns the number of faces reversed. */
  orientFaces(seedFaceId: string): number;
  createFace(vertexIds: string[]): IFace;
  deleteVertex(id: string): void;
  deleteEdge(id: string): void;
  /** rememberDeleted: user-intent deletion — suppress auto-face re-creation
   *  of this loop until the user retraces an edge or recreates the face. */
  deleteFace(id: string, opts?: { rememberDeleted?: boolean }): void;
  getVertex(id: string): IVertex | undefined;
  getEdge(id: string): IEdge | undefined;
  getFace(id: string): IFace | undefined;
  getVertexEdges(vertexId: string): IEdge[];
  getEdgeFaces(edgeId: string): IFace[];
  getFaceEdges(faceId: string): IEdge[];
  getFaceVertices(faceId: string): IVertex[];
  getConnectedFaces(faceId: string): IFace[];
  findEdgeBetween(v1Id: string, v2Id: string): IEdge | undefined;
  getCurveEdges(curveId: string): IEdge[];
  checkCoplanar(vertexIds: string[]): boolean;
  computeFaceNormal(faceId: string): Vec3;
  computeFaceArea(faceId: string): number;
  computeEdgeLength(edgeId: string): number;
  raycast(ray: Ray): Array<{ entityId: string; point: Vec3; distance: number; type: 'vertex' | 'edge' | 'face' }>;
  getBoundingBox(): BoundingBox;
  getMesh(): IMesh;
  bulkImport(vertices: Vec3[], faces: number[][], standaloneEdges?: [number, number][], faceHoleStarts?: (number[] | undefined)[]): { vertexIds: string[]; faceIds: string[] };
  clone(): IGeometryEngine;
  serialize(): ArrayBuffer;
  deserialize(data: ArrayBuffer): void;
}

// ─── Scene Manager ───────────────────────────────────────────────

export interface IGroup extends Entity {
  type: 'group';
  transform: Transform;
  children: string[];
  meshId: string;
}

export interface IComponentDefinition {
  id: string;
  name: string;
  description: string;
  meshId: string;
  instanceIds: string[];
}

export interface IComponentInstance extends Entity {
  type: 'component_instance';
  definitionId: string;
  transform: Transform;
}

export interface ILayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: Color;
}

export interface IScenePage {
  id: string;
  name: string;
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  cameraFov: number;
  projection: ProjectionType;
  renderMode: RenderMode;
  layerVisibility: Record<string, boolean>;
  /** Active section cut captured with the scene (null = no section). */
  sectionPlane?: { point: Vec3; normal: Vec3 } | null;
}

export interface IEditingContext {
  path: string[];  // stack of group IDs being edited
  activeGroupId: string | null;
}

export interface ISceneManager {
  root: IGroup;
  editingContext: IEditingContext;
  layers: Map<string, ILayer>;
  componentDefinitions: Map<string, IComponentDefinition>;
  scenePages: IScenePage[];

  addEntity(entity: Entity, parentId?: string): void;
  removeEntity(id: string): void;
  getEntity(id: string): Entity | undefined;
  getAllEntities(): Entity[];
  findEntitiesByType(type: EntityType): Entity[];
  moveEntity(id: string, newParentId: string): void;

  createGroup(name: string, childIds: string[]): IGroup;
  explodeGroup(groupId: string): void;
  enterGroup(groupId: string): void;
  exitGroup(): void;

  createComponentDefinition(name: string, meshId: string): IComponentDefinition;
  placeComponentInstance(defId: string, transform: Transform): IComponentInstance;

  addLayer(name: string): ILayer;
  removeLayer(id: string): void;
  setLayerVisibility(id: string, visible: boolean): void;
  assignToLayer(entityId: string, layerId: string): void;

  addScenePage(page: Omit<IScenePage, 'id'>): IScenePage;
  removeScenePage(id: string): void;

  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

// ─── Selection Manager ───────────────────────────────────────────

export interface ISelectionState {
  mode: SelectionMode;
  entityIds: Set<string>;
  preSelectionId: string | null;
}

export interface ISelectionManager {
  state: Readonly<ISelectionState>;
  isEmpty: boolean;
  count: number;

  select(entityId: string): void;
  add(entityId: string): void;
  remove(entityId: string): void;
  toggle(entityId: string): void;
  selectAll(): void;
  clear(): void;
  selectConnected(entityId: string): void;
  selectInBox(rect: { x: number; y: number; width: number; height: number }, mode: 'window' | 'crossing'): void;

  setMode(mode: SelectionMode): void;
  setPreSelection(entityId: string | null): void;
  addPreSelection(entityId: string): void;
  getPreSelectionIds(): string[];
  isSelected(entityId: string): boolean;
  getSelectedByType(type: EntityType): string[];

  on(event: 'changed' | 'pre-selection-changed', handler: (...args: unknown[]) => void): void;
  off(event: 'changed' | 'pre-selection-changed', handler: (...args: unknown[]) => void): void;
}

// ─── History Manager ─────────────────────────────────────────────

export interface ITransaction {
  id: string;
  name: string;
  timestamp: number;
}

export interface IHistoryManager {
  beginTransaction(name: string): void;
  commitTransaction(): ITransaction;
  abortTransaction(): void;
  undo(): ITransaction | null;
  redo(): ITransaction | null;
  canUndo: boolean;
  canRedo: boolean;
  undoName: string | null;
  redoName: string | null;
  clear(): void;
  maxSteps: number;

  recordAdd(entityType: string, entityId: string, data: unknown): void;
  recordRemove(entityType: string, entityId: string, data: unknown): void;
  recordModify(entityType: string, entityId: string, before: unknown, after: unknown): void;

  on(event: 'changed', handler: () => void): void;
  off(event: 'changed', handler: () => void): void;
}

// ─── Material Manager ────────────────────────────────────────────

export interface IMaterialManager {
  materials: Map<string, MaterialDef>;
  defaultMaterial: MaterialDef;

  addMaterial(mat: Omit<MaterialDef, 'id'>): MaterialDef;
  removeMaterial(id: string): void;
  updateMaterial(id: string, updates: Partial<MaterialDef>): void;
  getMaterial(id: string): MaterialDef | undefined;
  getAllMaterials(): MaterialDef[];
  applyToFace(faceId: string, materialId: string, backFace?: boolean): void;
  getFaceMaterial(faceId: string): MaterialDef;

  on(event: 'changed', handler: () => void): void;
  off(event: 'changed', handler: () => void): void;
}

// ─── Document ────────────────────────────────────────────────────

export interface DocumentMetadata {
  name: string;
  description: string;
  author: string;
  createdAt: number;
  modifiedAt: number;
  units: LengthUnit;
}

export interface IModelDocument {
  metadata: DocumentMetadata;
  dirty: boolean;
  filePath: string | null;

  scene: ISceneManager;
  selection: ISelectionManager;
  history: IHistoryManager;
  materials: IMaterialManager;
  geometry: IGeometryEngine;

  newDocument(): void;
  serialize(): ArrayBuffer;
  deserialize(data: ArrayBuffer): void;
  markDirty(): void;
  markClean(): void;

  on(event: 'dirty-changed' | 'metadata-changed', handler: (...args: unknown[]) => void): void;
  off(event: 'dirty-changed' | 'metadata-changed', handler: (...args: unknown[]) => void): void;
}

// ─── Camera Controller ───────────────────────────────────────────

export interface ICameraController {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  projection: ProjectionType;
  near: number;
  far: number;

  orbit(deltaX: number, deltaY: number): void;
  pan(deltaX: number, deltaY: number): void;
  zoom(delta: number): void;
  setView(name: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'): void;
  setProjection(type: ProjectionType): void;
  lookAt(target: Vec3): void;
  fitToBox(box: BoundingBox): void;
  screenToRay(screenX: number, screenY: number, width: number, height: number): Ray;
  worldToScreen(point: Vec3, width: number, height: number): Vec2;

  getViewMatrix(): number[];
  getProjectionMatrix(aspect: number): number[];
}

// ─── Inference Engine ────────────────────────────────────────────

export interface InferenceContext {
  recentPoints: Vec3[];
  recentEdges: Array<{ start: Vec3; end: Vec3 }>;
  axisLock: 'x' | 'y' | 'z' | null;
  customAxes?: { origin: Vec3; xAxis: Vec3; yAxis: Vec3; zAxis: Vec3 };
  activeToolId: string;
}

export interface IInferenceEngine {
  findInference(
    screenPos: Vec2,
    ray: Ray,
    context: InferenceContext,
  ): InferenceResult | null;

  setEnabled(enabled: boolean): void;
  setSnapRadius(pixels: number): void;
  clearCache(): void;
}

// ─── Tool Interface ──────────────────────────────────────────────

/** Declares what event data a tool needs for a given interaction phase. */
export interface ToolEventNeeds {
  /** Whether this tool needs snap detection (vertex/edge snapping). */
  snap: boolean;
  /** Whether this tool needs full scene raycast (not just GPU pick). */
  raycast: boolean;
  /** Whether this tool needs edge-only raycast fallback when GPU pick misses. */
  edgeRaycast: boolean;
  /** Whether scene sync should run on every mousemove during active phase. */
  liveSyncOnMove: boolean;
  /** Whether mouseDown/mouseUp trigger a full scene sync (geometry/material mutation). */
  mutatesOnClick: boolean;
}

export interface ITool {
  id: string;
  name: string;
  icon: string;
  shortcut: string;
  category: ToolCategory;
  cursor: string;

  activate(): void;
  deactivate(): void;

  onMouseDown(event: ToolMouseEvent): void;
  onMouseMove(event: ToolMouseEvent): void;
  onMouseUp(event: ToolMouseEvent): void;
  onKeyDown(event: ToolKeyEvent): void;
  onKeyUp(event: ToolKeyEvent): void;
  onVCBInput(value: string): void;

  getStatusText(): string;
  getVCBLabel(): string;
  getVCBValue(): string;

  /** Return preview geometry for live rendering during tool operation. */
  getPreview(): ToolPreview | null;

  /** Active directional-inference label ("On Red Axis", "Parallel to Edge", …).
   *  Overrides the snap-kind hint near the cursor when non-null. */
  getInferenceLabel?(): string | null;

  /** Declare what event data this tool needs for the given phase. */
  getEventNeeds(phase: ToolPhase): ToolEventNeeds;
}

export interface ToolPreview {
  /** Line segments to draw as rubber-band previews. Optional color overrides
   *  the default preview blue (e.g., axis-inference red/green/blue). */
  lines?: Array<{ from: Vec3; to: Vec3; color?: Color }>;
  /** Closed polygon outline (e.g., rectangle preview). */
  polygon?: Vec3[];
}

/** What kind of snap produced the event's worldPoint (classic-CAD-style inference kinds). */
export type SnapKind =
  | 'origin'        // model origin (0,0,0)
  | 'vertex'        // endpoint
  | 'midpoint'      // edge midpoint
  | 'intersection'  // edge-edge intersection
  | 'center'        // center of a circle/arc (curve)
  | 'edge'          // on edge
  | 'face'          // on face
  | 'cursor';       // no snap — free cursor projection

export interface ToolMouseEvent {
  screenX: number;
  screenY: number;
  worldPoint: Vec3 | null;
  /** Snap kind that produced worldPoint (null when snap detection didn't run). */
  snapKind?: SnapKind | null;
  inference: InferenceResult | null;
  /** Entity ID hit by raycast at cursor position (if any). May be a component
   *  ID when the underlying face is inside a protected component. */
  hitEntityId: string | null;
  /** Underlying face ID (always the raw face, never a component wrapper). Used
   *  by face-snap drawing so plane resolution works inside components. */
  hitFaceId: string | null;
  /** World point of the raycast hit (if any). */
  hitPoint: Vec3 | null;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface ToolKeyEvent {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface IToolManager {
  registerTool(tool: ITool): void;
  unregisterTool(toolId: string): void;
  activateTool(toolId: string): void;
  deactivateTool(): void;
  getActiveTool(): ITool | null;
  getTool(toolId: string): ITool | undefined;
  getAllTools(): ITool[];
  on(event: 'tool-changed', handler: (tool: ITool | null) => void): void;
  off(event: 'tool-changed', handler: (tool: ITool | null) => void): void;
}

// ─── Renderer ────────────────────────────────────────────────────

export interface IRenderStats {
  fps: number;
  frameTime: number;
  drawCalls: number;
  triangles: number;
}

export interface IRenderer {
  initialize(canvas: HTMLCanvasElement, width: number, height: number): void;
  dispose(): void;
  resize(width: number, height: number): void;
  render(): void;
  startRenderLoop(): void;
  stopRenderLoop(): void;
  setRenderMode(mode: RenderMode): void;
  getRenderMode(): RenderMode;
  pick(screenX: number, screenY: number): { entityId: string; point: Vec3 } | null;
  getStats(): IRenderStats;

  setSelectionHighlight(entityIds: string[]): void;
  setPreSelectionHighlight(entityId: string | null): void;
  setPreSelectionHighlightMulti(entityIds: string[]): void;
  addGuideLine(id: string, start: Vec3, end: Vec3, color: Color, dashed?: boolean, opts?: { depthTest?: boolean; renderOrder?: number; opacity?: number; linewidth?: number; selectable?: boolean }): void;
  removeGuideLine(id: string): void;
  clearGuideLines(): void;
  setGridVisible(visible: boolean): void;
  setAxesVisible(visible: boolean): void;

  /** Set or clear a section clipping plane. Pass null to clear. */
  setSectionPlane(plane: { point: Vec3; normal: Vec3 } | null): void;
}

// ─── Viewport ────────────────────────────────────────────────────

export interface IViewport {
  initialize(container: HTMLElement): void;
  dispose(): void;

  renderer: IRenderer;
  camera: ICameraController;

  setRenderMode(mode: RenderMode): void;
  setProjection(type: ProjectionType): void;
  toggleGrid(): void;
  toggleAxes(): void;

  screenToWorld(screenX: number, screenY: number): Vec3 | null;
  worldToScreen(point: Vec3): Vec2;
  raycastScene(screenX: number, screenY: number): Array<{ entityId: string; point: Vec3; distance: number }>;

  getWidth(): number;
  getHeight(): number;
}

// ─── Application ─────────────────────────────────────────────────

export interface IApplication {
  document: IModelDocument;
  viewport: IViewport;
  toolManager: IToolManager;
  inference: IInferenceEngine;

  initialize(canvas: HTMLCanvasElement): Promise<void>;
  dispose(): void;

  newDocument(): Promise<void>;
  openDocument(): Promise<void>;
  saveDocument(): Promise<void>;
  saveDocumentAs(): Promise<void>;
  importFile(): Promise<void>;
  exportFile(format: string): Promise<void>;

  activateTool(toolId: string): void;
  getActiveTool(): ITool | null;
  getAvailableTools(): ITool[];
}
