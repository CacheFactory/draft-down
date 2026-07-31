// @archigraph tool.base
// Named drawing planes shared by every tool that draws on axis-aligned planes.
// Arrow keys cycle through these; customAxes reorients them when set.

import type { Vec3 } from '../../src/core/types';
import { customAxes } from '../tool.axes/CustomAxes';

/** Named drawing planes that arrow keys cycle through. */
export type DrawingPlaneAxis = 'ground' | 'red' | 'green' | 'blue';

/** Get the plane normal for an axis, respecting custom axes orientation. */
export function getPlaneNormal(axis: DrawingPlaneAxis): Vec3 {
  return customAxes.getPlaneNormal(axis);
}

export function getPlaneLabelSuffix(): string {
  return customAxes.isCustom ? ' (custom)' : '';
}

// NOTE: the keys are historical; the LABELS follow the classic modeler's color language
// where BLUE is vertical (DraftDown is Y-up, so the XZ/normal-Y plane is the
// blue plane and the XY/normal-Z plane is green).
export const DRAWING_PLANES: Record<DrawingPlaneAxis, { label: string; color: string }> = {
  ground: { label: 'Ground (XZ)', color: '' },
  red:    { label: 'Red (YZ)',    color: 'red' },
  green:  { label: 'Blue (XZ)',   color: 'blue' },
  blue:   { label: 'Green (XY)',  color: 'green' },
};
