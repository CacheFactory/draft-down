// @archigraph system.snap
// Runtime snapping settings — module singleton, mirroring units.ts'
// getCurrentUnit/setCurrentUnit pattern so SceneBridge, BaseTool, and the
// React UI all read the same values without plumbing. Persisted via the
// UserPreferences keys snapEnabled / gridSnapEnabled / gridSnapSpacing;
// UI code calls setSnapSettings after prefs load/save.

import type { Vec3 } from './types';

export interface SnapSettings {
  /** Object snapping (vertex/edge/midpoint/…) — pref `snapEnabled` */
  objectSnapEnabled: boolean;
  /** Round free cursor points to the grid increment — pref `gridSnapEnabled` */
  gridSnapEnabled: boolean;
  /** Grid snap increment in meters — pref `gridSnapSpacing` */
  gridSnapSpacing: number;
}

const DEFAULT_GRID_SNAP_SPACING = 0.25;

let settings: SnapSettings = {
  objectSnapEnabled: true,
  gridSnapEnabled: false,
  gridSnapSpacing: DEFAULT_GRID_SNAP_SPACING,
};

export function getSnapSettings(): SnapSettings {
  return settings;
}

export function setSnapSettings(partial: Partial<SnapSettings>): void {
  settings = { ...settings, ...partial };
  if (!(settings.gridSnapSpacing > 1e-9)) {
    settings.gridSnapSpacing = DEFAULT_GRID_SNAP_SPACING;
  }
}

export function roundToIncrement(v: number, spacing: number): number {
  return Math.round(v / spacing) * spacing;
}

/** Round a free 3D point to the grid increment. No-op when grid snap is off. */
export function snapPointToGrid(p: Vec3): Vec3 {
  if (!settings.gridSnapEnabled) return p;
  const sp = settings.gridSnapSpacing;
  return {
    x: roundToIncrement(p.x, sp),
    y: roundToIncrement(p.y, sp),
    z: roundToIncrement(p.z, sp),
  };
}

/**
 * Round a point that must STAY on a plane. Only when the plane normal is
 * axis-aligned (the drawing planes: XY/XZ/YZ) — round the two in-plane world
 * axes and keep the normal-axis coordinate exact, so the point never leaves
 * the plane. Arbitrary planes (face planes, rotated custom axes) return the
 * point unchanged: grid snap silently disables there rather than producing
 * off-plane or diagonal-grid points.
 */
export function snapPlanePointToGrid(p: Vec3, normal: Vec3): Vec3 {
  if (!settings.gridSnapEnabled) return p;
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  const EPS = 1e-6;
  const sp = settings.gridSnapSpacing;
  if (ax > 1 - EPS && ay < EPS && az < EPS) {
    return { x: p.x, y: roundToIncrement(p.y, sp), z: roundToIncrement(p.z, sp) };
  }
  if (ay > 1 - EPS && ax < EPS && az < EPS) {
    return { x: roundToIncrement(p.x, sp), y: p.y, z: roundToIncrement(p.z, sp) };
  }
  if (az > 1 - EPS && ax < EPS && ay < EPS) {
    return { x: roundToIncrement(p.x, sp), y: roundToIncrement(p.y, sp), z: p.z };
  }
  return p;
}
