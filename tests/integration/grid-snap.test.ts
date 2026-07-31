// @archigraph system.snap
import {
  getSnapSettings, setSnapSettings, roundToIncrement,
  snapPointToGrid, snapPlanePointToGrid,
} from '../../src/core/snap-settings';
import { DEFAULT_PREFERENCES } from '../../src/core/ipc-types';
import { parseDistanceExpr, setCurrentUnit } from '../../src/core/units';

afterEach(() => {
  setSnapSettings({ objectSnapEnabled: true, gridSnapEnabled: false, gridSnapSpacing: 0.25 });
});

describe('snap settings', () => {
  test('defaults: object snap on, grid snap off, 0.25m spacing', () => {
    const s = getSnapSettings();
    expect(s.objectSnapEnabled).toBe(true);
    expect(s.gridSnapEnabled).toBe(false);
    expect(s.gridSnapSpacing).toBe(0.25);
  });

  test('prefs schema carries the new keys', () => {
    expect(DEFAULT_PREFERENCES.gridSnapEnabled).toBe(false);
    expect(DEFAULT_PREFERENCES.gridSnapSpacing).toBe(0.25);
  });

  test('invalid spacing falls back to default', () => {
    setSnapSettings({ gridSnapSpacing: 0 });
    expect(getSnapSettings().gridSnapSpacing).toBe(0.25);
    setSnapSettings({ gridSnapSpacing: -1 });
    expect(getSnapSettings().gridSnapSpacing).toBe(0.25);
  });
});

describe('grid rounding', () => {
  test('roundToIncrement', () => {
    expect(roundToIncrement(0.37, 0.25)).toBeCloseTo(0.25, 10);
    expect(roundToIncrement(0.38, 0.25)).toBeCloseTo(0.5, 10);
    expect(roundToIncrement(-0.37, 0.25)).toBeCloseTo(-0.25, 10);
    expect(roundToIncrement(1.0, 0.25)).toBeCloseTo(1.0, 10);
  });

  test('snapPointToGrid is a no-op when disabled', () => {
    const p = { x: 0.37, y: 0.11, z: -2.61 };
    expect(snapPointToGrid(p)).toEqual(p);
  });

  test('snapPointToGrid rounds all axes when enabled', () => {
    setSnapSettings({ gridSnapEnabled: true, gridSnapSpacing: 0.5 });
    const p = snapPointToGrid({ x: 1.13, y: 0, z: 2.71 });
    expect(p.x).toBeCloseTo(1.0, 10);
    expect(p.y).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(2.5, 10);
  });
});

describe('plane-constrained grid rounding', () => {
  beforeEach(() => setSnapSettings({ gridSnapEnabled: true, gridSnapSpacing: 0.25 }));

  test('ground plane (normal Y): keeps y, rounds x/z', () => {
    const p = snapPlanePointToGrid({ x: 0.37, y: 0.123, z: 0.88 }, { x: 0, y: 1, z: 0 });
    expect(p.x).toBeCloseTo(0.25, 10);
    expect(p.y).toBeCloseTo(0.123, 10); // stays on the (possibly lifted) plane
    expect(p.z).toBeCloseTo(1.0, 10); // 0.88 → 1.0 (nearest 0.25 multiple)
  });

  test('YZ plane (normal X): keeps x, rounds y/z', () => {
    const p = snapPlanePointToGrid({ x: 3.333, y: 0.37, z: 0.88 }, { x: -1, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(3.333, 10);
    expect(p.y).toBeCloseTo(0.25, 10);
    expect(p.z).toBeCloseTo(1.0, 10);
  });

  test('arbitrary face plane: unchanged (fail-safe)', () => {
    const n = { x: 0.577, y: 0.577, z: 0.577 };
    const p = { x: 0.37, y: 0.11, z: 0.88 };
    expect(snapPlanePointToGrid(p, n)).toEqual(p);
  });

  test('no-op when grid snap disabled', () => {
    setSnapSettings({ gridSnapEnabled: false });
    const p = { x: 0.37, y: 0, z: 0.88 };
    expect(snapPlanePointToGrid(p, { x: 0, y: 1, z: 0 })).toEqual(p);
  });
});

describe('settings UI parsing expectations', () => {
  test('unit expressions parse to meters for the spacing inputs', () => {
    setCurrentUnit('m');
    expect(parseDistanceExpr('6"')).toBeCloseTo(0.1524, 6);
    expect(parseDistanceExpr('0.25m')).toBeCloseTo(0.25, 10);
    expect(parseDistanceExpr("1'")).toBeCloseTo(0.3048, 6);
  });
});
