// @archigraph core.units
// Unit conversion utilities. Internal unit is meters.

import type { LengthUnit } from './types';

/** Conversion factors: how many internal units (meters) per 1 display unit. */
const TO_METERS: Record<LengthUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  inches: 0.0254,
  feet: 0.3048,
};

/** Convert from display units to internal (meters). */
export function toInternal(value: number, unit: LengthUnit): number {
  return value * TO_METERS[unit];
}

/** Convert from internal (meters) to display units. */
export function toDisplay(value: number, unit: LengthUnit): number {
  return value / TO_METERS[unit];
}

/** How distances are DISPLAYED (input parsing accepts everything always).
 *  'architectural' shows feet-and-fractional-inches (8' 10 1/2") when the
 *  document unit is feet or inches — the professional expectation. */
export type DisplayStyle = 'decimal' | 'architectural';
let _displayStyle: DisplayStyle = 'decimal';

export function setDisplayStyle(style: DisplayStyle): void {
  _displayStyle = style;
}
export function getDisplayStyle(): DisplayStyle {
  return _displayStyle;
}

/** Format inches as a fraction string to the nearest 1/16 (reduced). */
function fractionalInches(inches: number): string {
  const whole = Math.floor(inches);
  let sixteenths = Math.round((inches - whole) * 16);
  let w = whole;
  if (sixteenths === 16) { w += 1; sixteenths = 0; }
  if (sixteenths === 0) return `${w}"`;
  let num = sixteenths, den = 16;
  while (num % 2 === 0) { num /= 2; den /= 2; }
  return w > 0 ? `${w} ${num}/${den}"` : `${num}/${den}"`;
}

/** Format an internal value for display with unit label. */
export function formatDistance(internalValue: number, unit: LengthUnit): string {
  if (_displayStyle === 'architectural' && (unit === 'feet' || unit === 'inches')) {
    const sign = internalValue < 0 ? '-' : '';
    const totalInches = Math.abs(internalValue) / 0.0254;
    if (unit === 'inches' || totalInches < 12) {
      return `${sign}${fractionalInches(totalInches)}`;
    }
    const feet = Math.floor(totalInches / 12);
    const rem = totalInches - feet * 12;
    const remStr = fractionalInches(rem);
    return remStr === '0"' ? `${sign}${feet}'` : `${sign}${feet}' ${remStr}`;
  }
  const display = toDisplay(internalValue, unit);
  // Show whole number if close enough, otherwise 1 decimal place
  const rounded = Math.round(display * 10) / 10;
  const text = rounded === Math.floor(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  return `${text}${unitLabel(unit)}`;
}

// ── Model templates (classic-CAD-style startup choices) ──────────────

export interface ModelTemplate {
  id: string;
  name: string;
  desc: string;
  unit: LengthUnit;
  displayStyle: DisplayStyle;
  sky: boolean;
}

export const MODEL_TEMPLATES: ModelTemplate[] = [
  { id: 'architectural', name: 'Architectural', desc: 'Feet and inches (8\' 10 1/2")', unit: 'feet', displayStyle: 'architectural', sky: true },
  { id: 'woodworking', name: 'Woodworking', desc: 'Millimeters', unit: 'mm', displayStyle: 'decimal', sky: false },
  { id: 'product', name: 'Product Design', desc: 'Centimeters', unit: 'cm', displayStyle: 'decimal', sky: false },
  { id: 'simple-meters', name: 'Simple', desc: 'Meters', unit: 'm', displayStyle: 'decimal', sky: false },
];

/** Apply a template's unit + display settings (caller handles sky/render). */
export function applyTemplateUnits(t: ModelTemplate): void {
  setCurrentUnit(t.unit);
  setDisplayStyle(t.displayStyle);
}

/** Unit abbreviation for display. */
export function unitLabel(unit: LengthUnit): string {
  switch (unit) {
    case 'mm': return 'mm';
    case 'cm': return 'cm';
    case 'm': return 'm';
    case 'inches': return '"';
    case 'feet': return "'";
  }
}

/** Singleton current unit state, updated from preferences. */
let _currentUnit: LengthUnit = 'm';

export function setCurrentUnit(unit: LengthUnit): void {
  _currentUnit = unit;
}

export function getCurrentUnit(): LengthUnit {
  return _currentUnit;
}

// ── Distance expression parsing (classic-CAD-style VCB input) ────────

const UNIT_SUFFIXES: Array<[string, LengthUnit]> = [
  // Longest first so 'mm' wins over 'm', 'inches' over 'in'.
  ['inches', 'inches'],
  ['inch', 'inches'],
  ['feet', 'feet'],
  ['mm', 'mm'],
  ['cm', 'cm'],
  ['ft', 'feet'],
  ['in', 'inches'],
  ['m', 'm'],
  ["'", 'feet'],
  ['"', 'inches'],
];

/**
 * Parse one distance expression into internal meters. Returns NaN on failure.
 *
 * Accepts classic-CAD-style forms:
 *   `3`        → 3 in defaultUnit         `1.5m` `30cm` `450mm`
 *   `21'`      → 21 feet                  `10"` `10in` → 10 inches
 *   `8'10"`    → 8 feet 10 inches         `8' 10` → bare term after feet = inches
 *   `1/2"`     → half inch                `10 1/2"` → mixed fraction
 * Terms accumulate (each with its own unit), so `1m 20cm` also works.
 */
export function parseDistanceExpr(text: string, defaultUnit: LengthUnit = _currentUnit): number {
  let s = text.trim().toLowerCase();
  if (!s) return NaN;

  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1).trimStart(); }
  else if (s.startsWith('+')) { s = s.slice(1).trimStart(); }

  // number: decimal, mixed fraction ("10 1/2"), or plain fraction ("1/2")
  const NUM = /^(?:(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)|(\d+)\s*\/\s*(\d+)|(\d*\.?\d+))/;

  let total = 0;
  let prevUnit: LengthUnit | null = null;
  let matchedAny = false;

  while (s.length > 0) {
    const m = NUM.exec(s);
    if (!m) return NaN; // trailing garbage
    let value: number;
    if (m[1] !== undefined) {
      value = parseFloat(m[1]) + parseInt(m[2], 10) / parseInt(m[3], 10);
    } else if (m[4] !== undefined) {
      value = parseInt(m[4], 10) / parseInt(m[5], 10);
    } else {
      value = parseFloat(m[6]);
    }
    if (!isFinite(value)) return NaN;
    s = s.slice(m[0].length).trimStart();

    let unit: LengthUnit | null = null;
    for (const [suffix, u] of UNIT_SUFFIXES) {
      if (s.startsWith(suffix)) {
        unit = u;
        s = s.slice(suffix.length).trimStart();
        break;
      }
    }
    if (unit === null) {
      // classic CAD: a bare number following a feet term means inches (8'10);
      // otherwise it's in the default unit.
      unit = prevUnit === 'feet' ? 'inches' : defaultUnit;
    }

    total += toInternal(value, unit);
    prevUnit = unit;
    matchedAny = true;
  }

  return matchedAny ? sign * total : NaN;
}
