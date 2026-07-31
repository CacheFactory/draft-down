// @archigraph tool.base
// Shared tool infrastructure: every tool extends BaseTool; the sibling modules
// hold the reusable pieces (drawing planes, plane math, vertex sessions).

export { BaseTool } from './BaseTool';
export { DRAWING_PLANES, getPlaneNormal, getPlaneLabelSuffix } from './drawingPlanes';
export type { DrawingPlaneAxis } from './drawingPlanes';
export { planeBasis, rayPlaneIntersect } from './planeGeometry';
export { VertexTransformSession } from './VertexTransformSession';
export { GripOverlay } from './GripOverlay';
export type { GripItem } from './GripOverlay';
