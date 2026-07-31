// @archigraph core-types
// Core type definitions for DraftDown

export type Vec3 = { x: number; y: number; z: number };
export type Vec2 = { x: number; y: number };
export type Quaternion = { x: number; y: number; z: number; w: number };
export type Matrix4 = number[]; // 16 elements, column-major
export type Color = { r: number; g: number; b: number; a?: number };

export interface Plane {
  normal: Vec3;
  distance: number;
}

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export interface Transform {
  position: Vec3;
  rotation: Quaternion;
  scale: Vec3;
}

// Entity types
export type EntityType = 'vertex' | 'edge' | 'face' | 'group' | 'component_instance' | 'guide' | 'dimension' | 'text' | 'section_plane' | 'image';

export interface Entity {
  id: string;
  type: EntityType;
  name?: string;
  visible: boolean;
  locked: boolean;
  layerId: string;
  parentId: string | null;
  selected?: boolean;
}

// Length units
export type LengthUnit = 'mm' | 'cm' | 'm' | 'inches' | 'feet';

// Selection modes
export type SelectionMode = 'object' | 'face' | 'edge' | 'vertex';

// Render modes
export type RenderMode = 'wireframe' | 'hiddenLine' | 'shaded' | 'textured' | 'xray';

// Projection types
export type ProjectionType = 'perspective' | 'orthographic';

// Tool categories
export type ToolCategory = 'draw' | 'modify' | 'navigate' | 'measure' | 'construct';

// Tool state
export type ToolPhase = 'idle' | 'active' | 'drawing' | 'dragging';

// Material
export interface MaterialDef {
  id: string;
  name: string;
  color: Color;
  opacity: number;
  roughness: number;
  metalness: number;
  albedoMap?: string;
  normalMap?: string;
  roughnessMap?: string;
  metalnessMap?: string;
}

// Inference types
export type InferenceType =
  | 'endpoint'
  | 'midpoint'
  | 'on-edge'
  | 'on-face'
  | 'intersection'
  | 'on-axis-x'
  | 'on-axis-y'
  | 'on-axis-z'
  | 'parallel'
  | 'perpendicular'
  | 'from-point'
  | 'tangent';

export interface InferenceResult {
  type: InferenceType;
  point: Vec3;
  priority: number;
  referenceEntityId?: string;
  guideLines?: Array<{ start: Vec3; end: Vec3; color: Color }>;
  tooltip?: string;
}

// Events
export type AppEvent =
  | { type: 'selection-changed'; entityIds: string[] }
  | { type: 'tool-changed'; toolId: string | null }
  | { type: 'scene-changed' }
  | { type: 'document-dirty'; dirty: boolean }
  | { type: 'render-mode-changed'; mode: RenderMode }
  | { type: 'units-changed'; units: LengthUnit };

export type EventHandler<T = AppEvent> = (event: T) => void;

export interface EventEmitter<T = AppEvent> {
  on(handler: EventHandler<T>): void;
  off(handler: EventHandler<T>): void;
  emit(event: T): void;
}
