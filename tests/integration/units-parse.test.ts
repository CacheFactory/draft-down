// @archigraph core-units
// classic-CAD-style VCB distance parsing: unit suffixes (8'10", 21', 10in,
// 30cm, 1.5m), fractions (1/2", 10 1/2", 3/8), and bare numbers in the
// current document unit. Internal unit is meters.

import { parseDistanceExpr } from '../../src/core/units';

const FT = 0.3048;
const IN = 0.0254;

describe('parseDistanceExpr', () => {
  test('bare numbers use the default unit', () => {
    expect(parseDistanceExpr('3', 'm')).toBeCloseTo(3, 10);
    expect(parseDistanceExpr('2.5', 'cm')).toBeCloseTo(0.025, 10);
    expect(parseDistanceExpr('450', 'mm')).toBeCloseTo(0.45, 10);
    expect(parseDistanceExpr('6', 'feet')).toBeCloseTo(6 * FT, 10);
  });

  test('feet and inches suffixes', () => {
    expect(parseDistanceExpr("21'", 'm')).toBeCloseTo(21 * FT, 10);
    expect(parseDistanceExpr('10"', 'm')).toBeCloseTo(10 * IN, 10);
    expect(parseDistanceExpr('10in', 'm')).toBeCloseTo(10 * IN, 10);
    expect(parseDistanceExpr('3ft', 'm')).toBeCloseTo(3 * FT, 10);
    expect(parseDistanceExpr('2feet', 'm')).toBeCloseTo(2 * FT, 10);
    expect(parseDistanceExpr('5inches', 'm')).toBeCloseTo(5 * IN, 10);
  });

  test("feet + inches combos: 8'10\" and bare inches after feet", () => {
    expect(parseDistanceExpr(`8'10"`, 'm')).toBeCloseTo(8 * FT + 10 * IN, 10);
    expect(parseDistanceExpr(`8' 10"`, 'm')).toBeCloseTo(8 * FT + 10 * IN, 10);
    expect(parseDistanceExpr(`8'10`, 'm')).toBeCloseTo(8 * FT + 10 * IN, 10);
  });

  test('metric suffixes', () => {
    expect(parseDistanceExpr('1.5m', 'feet')).toBeCloseTo(1.5, 10);
    expect(parseDistanceExpr('30cm', 'feet')).toBeCloseTo(0.3, 10);
    expect(parseDistanceExpr('450mm', 'feet')).toBeCloseTo(0.45, 10);
    expect(parseDistanceExpr('1m 20cm', 'feet')).toBeCloseTo(1.2, 10);
  });

  test('fractions: plain, with unit, and mixed numbers', () => {
    expect(parseDistanceExpr('1/2"', 'm')).toBeCloseTo(0.5 * IN, 10);
    expect(parseDistanceExpr('3/8"', 'm')).toBeCloseTo(0.375 * IN, 10);
    expect(parseDistanceExpr('10 1/2"', 'm')).toBeCloseTo(10.5 * IN, 10);
    expect(parseDistanceExpr('1/2', 'm')).toBeCloseTo(0.5, 10);       // default unit
    expect(parseDistanceExpr('3/8', 'inches')).toBeCloseTo(0.375 * IN, 10);
    expect(parseDistanceExpr(`5' 6 1/2"`, 'm')).toBeCloseTo(5 * FT + 6.5 * IN, 10);
  });

  test('signs and whitespace', () => {
    expect(parseDistanceExpr('-3', 'm')).toBeCloseTo(-3, 10);
    expect(parseDistanceExpr(`-8'10"`, 'm')).toBeCloseTo(-(8 * FT + 10 * IN), 10);
    expect(parseDistanceExpr('  2.5m  ', 'mm')).toBeCloseTo(2.5, 10);
    expect(parseDistanceExpr('+4"', 'm')).toBeCloseTo(4 * IN, 10);
  });

  test('case-insensitive unit names', () => {
    expect(parseDistanceExpr('3M', 'mm')).toBeCloseTo(3, 10);
    expect(parseDistanceExpr('10IN', 'm')).toBeCloseTo(10 * IN, 10);
    expect(parseDistanceExpr('2FT', 'm')).toBeCloseTo(2 * FT, 10);
  });

  test('invalid input returns NaN', () => {
    expect(parseDistanceExpr('', 'm')).toBeNaN();
    expect(parseDistanceExpr('abc', 'm')).toBeNaN();
    expect(parseDistanceExpr('24s', 'm')).toBeNaN();     // segment-count syntax, not a distance
    expect(parseDistanceExpr('3x', 'm')).toBeNaN();
    expect(parseDistanceExpr('1/0"', 'm')).toBeNaN();    // division by zero
    expect(parseDistanceExpr('--3', 'm')).toBeNaN();
  });
});

import { formatDistance, setDisplayStyle } from '../../src/core/units';

describe('architectural display format', () => {
  afterEach(() => setDisplayStyle('decimal'));

  test('feet-and-inches with fractions', () => {
    setDisplayStyle('architectural');
    expect(formatDistance(8 * FT + 10.5 * IN, 'feet')).toBe(`8' 10 1/2"`);
    expect(formatDistance(21 * FT, 'feet')).toBe(`21'`);
    expect(formatDistance(0.5 * IN, 'feet')).toBe(`1/2"`);
    expect(formatDistance(3 * IN, 'inches')).toBe(`3"`);
    expect(formatDistance(10.0625 * IN, 'inches')).toBe(`10 1/16"`);
    expect(formatDistance(-(2 * FT + 6 * IN), 'feet')).toBe(`-2' 6"`);
  });

  test('decimal style unchanged', () => {
    expect(formatDistance(2.5, 'm')).toBe('2.5m');
  });
});
