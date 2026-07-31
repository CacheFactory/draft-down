// @archigraph plugin.system.draftdown.geom
// DraftDown Ruby API `Geom::*` mirrors in JS. Names mirror Ruby; methods are camelCase
// versions of the snake_case originals so a DraftDown Ruby extension can be ported by
// mechanical translation.
//
// Authoritative reference: 

import type { Vec3 } from '../../../src/core/types';

export type Point3dLike = Point3d | Vec3 | [number, number, number];
export type Vector3dLike = Vector3d | Vec3 | [number, number, number];

function coerceXYZ(v: Point3dLike | Vector3dLike): { x: number; y: number; z: number } {
  if (v instanceof Point3d || v instanceof Vector3d) return { x: v.x, y: v.y, z: v.z };
  if (Array.isArray(v)) return { x: v[0] ?? 0, y: v[1] ?? 0, z: v[2] ?? 0 };
  return { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 };
}

export class Point3d {
  x: number;
  y: number;
  z: number;

  constructor(x: number | Point3dLike = 0, y = 0, z = 0) {
    if (typeof x === 'number') {
      this.x = x; this.y = y; this.z = z;
    } else {
      const c = coerceXYZ(x);
      this.x = c.x; this.y = c.y; this.z = c.z;
    }
  }

  /** DraftDown.Point3d#offset(vector, length=vector.length) — returns a new Point3d. */
  offset(vector: Vector3dLike, length?: number): Point3d {
    const v = vector instanceof Vector3d ? vector : new Vector3d(vector as Vector3dLike);
    const dir = length !== undefined ? v.normalize().multiply(length) : v;
    return new Point3d(this.x + dir.x, this.y + dir.y, this.z + dir.z);
  }

  /** distance(other) — Ruby returns a Length; we return a number. */
  distance(other: Point3dLike): number {
    const o = coerceXYZ(other);
    return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z);
  }

  vectorTo(other: Point3dLike): Vector3d {
    const o = coerceXYZ(other);
    return new Vector3d(o.x - this.x, o.y - this.y, o.z - this.z);
  }

  /** transform(transformation) — non-mutating. */
  transform(t: Transformation): Point3d {
    return t.apply(this);
  }

  /** transform!(transformation) — Ruby bang variant: mutates and returns self. */
  transformInPlace(t: Transformation): Point3d {
    const p = t.apply(this);
    this.x = p.x; this.y = p.y; this.z = p.z;
    return this;
  }

  toA(): [number, number, number] { return [this.x, this.y, this.z]; }
  toString(): string { return `Point3d(${this.x}, ${this.y}, ${this.z})`; }

  /** Plain object shape used by DraftDown internals. */
  toVec3(): Vec3 { return { x: this.x, y: this.y, z: this.z }; }
}

export class Vector3d {
  x: number;
  y: number;
  z: number;

  constructor(x: number | Vector3dLike = 0, y = 0, z = 0) {
    if (typeof x === 'number') {
      this.x = x; this.y = y; this.z = z;
    } else {
      const c = coerceXYZ(x);
      this.x = c.x; this.y = c.y; this.z = c.z;
    }
  }

  get length(): number { return Math.hypot(this.x, this.y, this.z); }

  isValid(): boolean { return this.length > 1e-12; }

  normalize(): Vector3d {
    const l = this.length;
    if (l < 1e-12) return new Vector3d(0, 0, 0);
    return new Vector3d(this.x / l, this.y / l, this.z / l);
  }

  reverse(): Vector3d { return new Vector3d(-this.x, -this.y, -this.z); }

  add(other: Vector3dLike): Vector3d {
    const o = coerceXYZ(other);
    return new Vector3d(this.x + o.x, this.y + o.y, this.z + o.z);
  }

  /** Alias for DraftDown's `+` operator. */
  plus(other: Vector3dLike): Vector3d { return this.add(other); }

  subtract(other: Vector3dLike): Vector3d {
    const o = coerceXYZ(other);
    return new Vector3d(this.x - o.x, this.y - o.y, this.z - o.z);
  }

  multiply(scalar: number): Vector3d {
    return new Vector3d(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  dot(other: Vector3dLike): number {
    const o = coerceXYZ(other);
    return this.x * o.x + this.y * o.y + this.z * o.z;
  }

  cross(other: Vector3dLike): Vector3d {
    const o = coerceXYZ(other);
    return new Vector3d(
      this.y * o.z - this.z * o.y,
      this.z * o.x - this.x * o.z,
      this.x * o.y - this.y * o.x,
    );
  }

  parallel(other: Vector3dLike): boolean {
    return this.cross(other).length < 1e-9;
  }

  perpendicular(other: Vector3dLike): boolean {
    return Math.abs(this.dot(other)) < 1e-9;
  }

  /** angle_between in radians (matches DraftDown). */
  angleBetween(other: Vector3dLike): number {
    const a = this.normalize();
    const b = new Vector3d(other).normalize();
    const d = Math.max(-1, Math.min(1, a.dot(b)));
    return Math.acos(d);
  }

  transform(t: Transformation): Vector3d {
    // Vectors ignore translation.
    const m = t.matrix;
    return new Vector3d(
      m[0] * this.x + m[4] * this.y + m[8] * this.z,
      m[1] * this.x + m[5] * this.y + m[9] * this.z,
      m[2] * this.x + m[6] * this.y + m[10] * this.z,
    );
  }

  toA(): [number, number, number] { return [this.x, this.y, this.z]; }
  toString(): string { return `Vector3d(${this.x}, ${this.y}, ${this.z})`; }
  toVec3(): Vec3 { return { x: this.x, y: this.y, z: this.z }; }
}

/**
 * 4x4 column-major transformation matrix, mirroring DraftDown's Geom::Transformation.
 * Layout (column-major): m[col*4 + row]. Translation is in column 3 (m[12], m[13], m[14]).
 */
export class Transformation {
  matrix: number[];

  constructor(m?: number[] | Point3dLike) {
    if (Array.isArray(m) && m.length === 16) {
      this.matrix = m.slice();
      return;
    }
    // Identity, optionally translated.
    this.matrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    if (m) {
      const c = coerceXYZ(m as Point3dLike);
      this.matrix[12] = c.x;
      this.matrix[13] = c.y;
      this.matrix[14] = c.z;
    }
  }

  static identity(): Transformation { return new Transformation(); }

  static translation(p: Point3dLike | Vector3dLike): Transformation {
    return new Transformation(p as Point3dLike);
  }

  static scaling(sx: number, sy?: number, sz?: number): Transformation {
    const a = sx;
    const b = sy ?? sx;
    const c = sz ?? sx;
    return new Transformation([
      a, 0, 0, 0,
      0, b, 0, 0,
      0, 0, c, 0,
      0, 0, 0, 1,
    ]);
  }

  /** Rotation around an axis through `point` along `axis`, by `angle` radians. */
  static rotation(point: Point3dLike, axis: Vector3dLike, angle: number): Transformation {
    const p = coerceXYZ(point);
    const a = new Vector3d(axis).normalize();
    const c = Math.cos(angle); const s = Math.sin(angle); const t = 1 - c;
    const x = a.x, y = a.y, z = a.z;

    const r = [
      t * x * x + c,     t * x * y + s * z, t * x * z - s * y, 0,
      t * x * y - s * z, t * y * y + c,     t * y * z + s * x, 0,
      t * x * z + s * y, t * y * z - s * x, t * z * z + c,     0,
      0, 0, 0, 1,
    ];
    // T(p) * R * T(-p)
    const T1 = Transformation.translation(p);
    const T2 = Transformation.translation({ x: -p.x, y: -p.y, z: -p.z });
    return T1.multiply(new Transformation(r)).multiply(T2);
  }

  /** axes(origin, xAxis, yAxis, zAxis) — build a transform from a frame. */
  static axes(origin: Point3dLike, xAxis: Vector3dLike, yAxis: Vector3dLike, zAxis: Vector3dLike): Transformation {
    const o = coerceXYZ(origin);
    const xa = new Vector3d(xAxis); const ya = new Vector3d(yAxis); const za = new Vector3d(zAxis);
    return new Transformation([
      xa.x, xa.y, xa.z, 0,
      ya.x, ya.y, ya.z, 0,
      za.x, za.y, za.z, 0,
      o.x,  o.y,  o.z,  1,
    ]);
  }

  /** Multiply: this * other (column-major). */
  multiply(other: Transformation): Transformation {
    const a = this.matrix; const b = other.matrix; const r = new Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
        r[col * 4 + row] = s;
      }
    }
    return new Transformation(r);
  }

  apply(p: Point3dLike): Point3d {
    const c = coerceXYZ(p);
    const m = this.matrix;
    return new Point3d(
      m[0] * c.x + m[4] * c.y + m[8]  * c.z + m[12],
      m[1] * c.x + m[5] * c.y + m[9]  * c.z + m[13],
      m[2] * c.x + m[6] * c.y + m[10] * c.z + m[14],
    );
  }

  /** DraftDown's `transformation.origin`. */
  get origin(): Point3d { return new Point3d(this.matrix[12], this.matrix[13], this.matrix[14]); }
  get xaxis(): Vector3d { return new Vector3d(this.matrix[0], this.matrix[1], this.matrix[2]); }
  get yaxis(): Vector3d { return new Vector3d(this.matrix[4], this.matrix[5], this.matrix[6]); }
  get zaxis(): Vector3d { return new Vector3d(this.matrix[8], this.matrix[9], this.matrix[10]); }

  toA(): number[] { return this.matrix.slice(); }
}

/**
 * Geom::BoundingBox — cumulative axis-aligned bounding box.
 */
export class BoundingBox {
  min: Point3d;
  max: Point3d;
  private _empty = true;

  constructor() {
    this.min = new Point3d(Infinity, Infinity, Infinity);
    this.max = new Point3d(-Infinity, -Infinity, -Infinity);
  }

  add(p: Point3dLike): BoundingBox {
    const c = coerceXYZ(p);
    if (this._empty) {
      this.min = new Point3d(c.x, c.y, c.z);
      this.max = new Point3d(c.x, c.y, c.z);
      this._empty = false;
    } else {
      if (c.x < this.min.x) this.min.x = c.x;
      if (c.y < this.min.y) this.min.y = c.y;
      if (c.z < this.min.z) this.min.z = c.z;
      if (c.x > this.max.x) this.max.x = c.x;
      if (c.y > this.max.y) this.max.y = c.y;
      if (c.z > this.max.z) this.max.z = c.z;
    }
    return this;
  }

  get center(): Point3d {
    return new Point3d(
      (this.min.x + this.max.x) / 2,
      (this.min.y + this.max.y) / 2,
      (this.min.z + this.max.z) / 2,
    );
  }
  get width(): number { return this.max.x - this.min.x; }
  get height(): number { return this.max.y - this.min.y; }
  get depth(): number { return this.max.z - this.min.z; }
  get diagonal(): number { return this.min.distance(this.max); }
  empty(): boolean { return this._empty; }
}

// ─── Module-level helpers (Geom::*) ────────────────────────────────

/** Geom.linear_combination — α·p1 + β·p2 (point or vector). */
export function linearCombination(weight1: number, p1: Point3dLike, weight2: number, p2: Point3dLike): Point3d {
  const a = coerceXYZ(p1); const b = coerceXYZ(p2);
  return new Point3d(
    weight1 * a.x + weight2 * b.x,
    weight1 * a.y + weight2 * b.y,
    weight1 * a.z + weight2 * b.z,
  );
}

/** Geom.fit_plane_to_points — returns [a, b, c, d] for plane equation. */
export function fitPlaneToPoints(points: Point3dLike[]): [number, number, number, number] {
  if (points.length < 3) return [0, 0, 1, 0];
  const a = coerceXYZ(points[0]); const b = coerceXYZ(points[1]); const c = coerceXYZ(points[2]);
  const v1 = new Vector3d(b.x - a.x, b.y - a.y, b.z - a.z);
  const v2 = new Vector3d(c.x - a.x, c.y - a.y, c.z - a.z);
  const n = v1.cross(v2).normalize();
  const d = -(n.x * a.x + n.y * a.y + n.z * a.z);
  return [n.x, n.y, n.z, d];
}

// ─── 2D types ────────────────────────────────────────────────────

export type Point2dLike = Point2d | { x: number; y: number } | [number, number];
export type Vector2dLike = Vector2d | { x: number; y: number } | [number, number];

function coerce2(p: Point2dLike | Vector2dLike): { x: number; y: number } {
  if (p instanceof Point2d || p instanceof Vector2d) return { x: p.x, y: p.y };
  if (Array.isArray(p)) return { x: p[0] ?? 0, y: p[1] ?? 0 };
  return { x: p.x ?? 0, y: p.y ?? 0 };
}

/** Geom::Point2d */
export class Point2d {
  x: number; y: number;
  constructor(x: number | Point2dLike = 0, y = 0) {
    if (typeof x === 'number') { this.x = x; this.y = y; }
    else { const c = coerce2(x); this.x = c.x; this.y = c.y; }
  }
  distance(o: Point2dLike): number { const c = coerce2(o); return Math.hypot(this.x - c.x, this.y - c.y); }
  vectorTo(o: Point2dLike): Vector2d { const c = coerce2(o); return new Vector2d(c.x - this.x, c.y - this.y); }
  offset(v: Vector2dLike, length?: number): Point2d {
    const vec = v instanceof Vector2d ? v : new Vector2d(v as Vector2dLike);
    const dir = length !== undefined ? vec.normalize().multiply(length) : vec;
    return new Point2d(this.x + dir.x, this.y + dir.y);
  }
  toA(): [number, number] { return [this.x, this.y]; }
}

/** Geom::Vector2d */
export class Vector2d {
  x: number; y: number;
  constructor(x: number | Vector2dLike = 0, y = 0) {
    if (typeof x === 'number') { this.x = x; this.y = y; }
    else { const c = coerce2(x); this.x = c.x; this.y = c.y; }
  }
  get length(): number { return Math.hypot(this.x, this.y); }
  isValid(): boolean { return this.length > 1e-12; }
  normalize(): Vector2d { const l = this.length; return l < 1e-12 ? new Vector2d() : new Vector2d(this.x / l, this.y / l); }
  reverse(): Vector2d { return new Vector2d(-this.x, -this.y); }
  add(o: Vector2dLike): Vector2d { const c = coerce2(o); return new Vector2d(this.x + c.x, this.y + c.y); }
  subtract(o: Vector2dLike): Vector2d { const c = coerce2(o); return new Vector2d(this.x - c.x, this.y - c.y); }
  multiply(s: number): Vector2d { return new Vector2d(this.x * s, this.y * s); }
  dot(o: Vector2dLike): number { const c = coerce2(o); return this.x * c.x + this.y * c.y; }
  cross(o: Vector2dLike): number { const c = coerce2(o); return this.x * c.y - this.y * c.x; }
  parallel(o: Vector2dLike): boolean { return Math.abs(this.cross(o)) < 1e-9; }
  perpendicular(o: Vector2dLike): boolean { return Math.abs(this.dot(o)) < 1e-9; }
  angleBetween(o: Vector2dLike): number {
    const a = this.normalize(); const b = new Vector2d(o).normalize();
    return Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
  }
  toA(): [number, number] { return [this.x, this.y]; }
}

// ─── PolygonMesh ─────────────────────────────────────────────────

/**
 * Geom::PolygonMesh — used by `entities.add_faces_from_mesh(mesh, …)` for batch
 * geometry import (terrain, sand-printers, etc.).
 *
 * Reference: 
 */
export class PolygonMesh {
  private points: Vec3[] = [];
  /**
   * Polygons store *signed* 1-based indices like DraftDown.
   *   positive → soft/visible edge from this point to the next.
   *   negative → hidden edge (soft).
   */
  private polygons: number[][] = [];

  constructor(numPointsHint = 0, _numPolygonsHint = 0) {
    if (numPointsHint > 0) this.points.length = 0; // hint only
  }

  /** PolygonMesh#count_points / #count_polygons */
  countPoints(): number { return this.points.length; }
  countPolygons(): number { return this.polygons.length; }

  /** PolygonMesh#points returns Point3d copies. */
  get pointArray(): Point3d[] { return this.points.map(p => new Point3d(p.x, p.y, p.z)); }

  /** PolygonMesh#polygons returns the index lists (1-based, signed) verbatim. */
  get polygonArray(): number[][] { return this.polygons.map(a => a.slice()); }

  /** PolygonMesh#add_point — returns 1-based index. */
  addPoint(p: Point3dLike): number {
    const c = coerceXYZ(p);
    this.points.push({ x: c.x, y: c.y, z: c.z });
    return this.points.length;
  }

  /** PolygonMesh#point_at — 1-based access, returns Point3d. */
  pointAt(index: number): Point3d | null {
    if (index < 1 || index > this.points.length) return null;
    const p = this.points[index - 1];
    return new Point3d(p.x, p.y, p.z);
  }

  /** Set the point at 1-based index. Used after adding to nudge positions. */
  setPointAt(index: number, p: Point3dLike): void {
    if (index < 1 || index > this.points.length) return;
    const c = coerceXYZ(p);
    this.points[index - 1] = { x: c.x, y: c.y, z: c.z };
  }

  /** PolygonMesh#add_polygon — accepts indices (1-based) OR Point3dLike values. */
  addPolygon(...args: Array<number | Point3dLike>): number {
    const indices: number[] = [];
    for (const a of args) {
      if (typeof a === 'number') indices.push(a);
      else indices.push(this.addPoint(a));
    }
    if (indices.length < 3) return 0;
    this.polygons.push(indices);
    return this.polygons.length;
  }

  /** PolygonMesh#polygon_at — 1-based. */
  polygonAt(index: number): number[] | null {
    if (index < 1 || index > this.polygons.length) return null;
    return this.polygons[index - 1].slice();
  }

  /** PolygonMesh#polygon_points_at — returns the Point3ds for a 1-based polygon. */
  polygonPointsAt(index: number): Point3d[] | null {
    const poly = this.polygonAt(index);
    if (!poly) return null;
    return poly.map(i => this.pointAt(Math.abs(i))!).filter(Boolean);
  }

  /** PolygonMesh#transform! */
  transformInPlace(t: Transformation): PolygonMesh {
    for (let i = 0; i < this.points.length; i++) {
      const p = t.apply(new Point3d(this.points[i].x, this.points[i].y, this.points[i].z));
      this.points[i] = { x: p.x, y: p.y, z: p.z };
    }
    return this;
  }

  /** PolygonMesh#normal_at — best-effort vertex normal averaged over adjacent polygons. */
  normalAt(index: number): Vector3d {
    const acc = new Vector3d(0, 0, 0);
    let count = 0;
    for (const poly of this.polygons) {
      const has = poly.find(i => Math.abs(i) === index);
      if (!has) continue;
      const pts = poly.map(i => this.points[Math.abs(i) - 1]).filter(Boolean);
      if (pts.length < 3) continue;
      const a = pts[0]; const b = pts[1]; const c = pts[2];
      const v1 = new Vector3d(b.x - a.x, b.y - a.y, b.z - a.z);
      const v2 = new Vector3d(c.x - a.x, c.y - a.y, c.z - a.z);
      const n = v1.cross(v2).normalize();
      acc.x += n.x; acc.y += n.y; acc.z += n.z; count++;
    }
    return count > 0 ? acc.multiply(1 / count).normalize() : new Vector3d(0, 1, 0);
  }
}

// ─── OrientedBoundingBox ─────────────────────────────────────────

/**
 * Geom::OrientedBoundingBox — same fields as BoundingBox plus a transformation.
 * Reference: 
 */
export class OrientedBoundingBox {
  min: Point3d;
  max: Point3d;
  transformation: Transformation;
  private _empty = true;

  constructor() {
    this.min = new Point3d(Infinity, Infinity, Infinity);
    this.max = new Point3d(-Infinity, -Infinity, -Infinity);
    this.transformation = Transformation.identity();
  }

  add(p: Point3dLike): OrientedBoundingBox {
    const c = coerceXYZ(p);
    if (this._empty) {
      this.min = new Point3d(c.x, c.y, c.z); this.max = new Point3d(c.x, c.y, c.z); this._empty = false;
    } else {
      this.min.x = Math.min(this.min.x, c.x); this.min.y = Math.min(this.min.y, c.y); this.min.z = Math.min(this.min.z, c.z);
      this.max.x = Math.max(this.max.x, c.x); this.max.y = Math.max(this.max.y, c.y); this.max.z = Math.max(this.max.z, c.z);
    }
    return this;
  }
  empty(): boolean { return this._empty; }

  get center(): Point3d {
    return this.transformation.apply(new Point3d(
      (this.min.x + this.max.x) / 2,
      (this.min.y + this.max.y) / 2,
      (this.min.z + this.max.z) / 2,
    ));
  }
  get width(): number { return this.max.x - this.min.x; }
  get height(): number { return this.max.y - this.min.y; }
  get depth(): number { return this.max.z - this.min.z; }
  get diagonal(): number { return this.min.distance(this.max); }

  /** Eight world-space corners after applying `transformation`. */
  corners(): Point3d[] {
    const c: Point3d[] = [];
    const xs = [this.min.x, this.max.x]; const ys = [this.min.y, this.max.y]; const zs = [this.min.z, this.max.z];
    for (const x of xs) for (const y of ys) for (const z of zs) c.push(this.transformation.apply(new Point3d(x, y, z)));
    return c;
  }
}

// ─── Latlong / UTM ───────────────────────────────────────────────

/**
 * Geom::Latlong — geographic coordinate.
 * Reference: 
 */
export class Latlong {
  /** Latitude in decimal degrees. */
  latitude: number;
  /** Longitude in decimal degrees. */
  longitude: number;

  constructor(lat: number | [number, number] | Latlong = 0, lng = 0) {
    if (typeof lat === 'number') { this.latitude = lat; this.longitude = lng; }
    else if (Array.isArray(lat)) { this.latitude = lat[0]; this.longitude = lat[1]; }
    else { this.latitude = lat.latitude; this.longitude = lat.longitude; }
  }
  toA(): [number, number] { return [this.latitude, this.longitude]; }
  toUTM(): UTM { return UTM.fromLatlong(this); }
  toString(): string { return `Latlong(${this.latitude}, ${this.longitude})`; }
}

/**
 * Geom::UTM — Universal Transverse Mercator coordinate.
 * Reference: 
 *
 * Math: WGS-84 ellipsoid, Karney's formula via standard series expansion.
 */
export class UTM {
  zoneNumber: number;
  zoneLetter: string;
  /** Easting in meters. */
  x: number;
  /** Northing in meters. */
  y: number;

  constructor(zoneNumber: number, zoneLetter: string, x: number, y: number) {
    this.zoneNumber = zoneNumber; this.zoneLetter = zoneLetter; this.x = x; this.y = y;
  }

  toA(): [number, string, number, number] { return [this.zoneNumber, this.zoneLetter, this.x, this.y]; }

  toLatlong(): Latlong {
    // Inverse Mercator. Reference: USGS Bulletin 1532.
    const a = 6378137; // WGS-84 semi-major
    const f = 1 / 298.257223563;
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);
    const k0 = 0.9996;
    const x = this.x - 500000;
    const y = this.zoneLetter < 'N' ? this.y - 10000000 : this.y;
    const M = y / k0;
    const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const phi1 = mu
      + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
      + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + 151 * e1 ** 3 / 96 * Math.sin(6 * mu);
    const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
    const T1 = Math.tan(phi1) ** 2;
    const C1 = ep2 * Math.cos(phi1) ** 2;
    const R1 = a * (1 - e2) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
    const D = x / (N1 * k0);
    const lat = phi1 - (N1 * Math.tan(phi1) / R1) *
      (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
       + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lonOrigin = (this.zoneNumber - 1) * 6 - 180 + 3;
    const lon = lonOrigin * Math.PI / 180 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(phi1);
    return new Latlong(lat * 180 / Math.PI, lon * 180 / Math.PI);
  }

  static fromLatlong(ll: Latlong): UTM {
    const a = 6378137;
    const f = 1 / 298.257223563;
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);
    const k0 = 0.9996;
    const lat = ll.latitude * Math.PI / 180;
    const lon = ll.longitude * Math.PI / 180;
    const zoneNumber = Math.floor((ll.longitude + 180) / 6) + 1;
    const lonOrigin = ((zoneNumber - 1) * 6 - 180 + 3) * Math.PI / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const T = Math.tan(lat) ** 2;
    const C = ep2 * Math.cos(lat) ** 2;
    const A = Math.cos(lat) * (lon - lonOrigin);
    const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * lat
      - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * lat)
      + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * lat)
      - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * lat));
    const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
    let y = k0 * (M + N * Math.tan(lat) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    if (lat < 0) y += 10000000;
    const letter = utmLetter(ll.latitude);
    return new UTM(zoneNumber, letter, x, y);
  }
}

function utmLetter(lat: number): string {
  // Standard UTM latitude bands.
  const bands = 'CDEFGHJKLMNPQRSTUVWXX';
  if (lat < -80 || lat > 84) return 'Z';
  return bands[Math.floor((lat + 80) / 8)] || 'Z';
}

// ─── Intersection helpers ────────────────────────────────────────

/** Geom.intersect_line_line — two infinite lines specified as [Point3d, Vector3d]. Returns the
 *  midpoint of the closest approach, or null if parallel. */
export function intersectLineLine(line1: [Point3dLike, Vector3dLike], line2: [Point3dLike, Vector3dLike]): Point3d | null {
  const cp = closestPoints(line1, line2);
  if (!cp) return null;
  return new Point3d((cp[0].x + cp[1].x) / 2, (cp[0].y + cp[1].y) / 2, (cp[0].z + cp[1].z) / 2);
}

/** Geom.closest_points — closest points on two infinite lines. */
export function closestPoints(line1: [Point3dLike, Vector3dLike], line2: [Point3dLike, Vector3dLike]): [Point3d, Point3d] | null {
  const p1 = new Point3d(coerceXYZ(line1[0]));
  const d1 = new Vector3d(line1[1]);
  const p2 = new Point3d(coerceXYZ(line2[0]));
  const d2 = new Vector3d(line2[1]);
  const r = new Vector3d(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
  const a = d1.dot(d1); const e = d2.dot(d2); const f = d2.dot(r);
  if (a < 1e-18 && e < 1e-18) return [p1, p2];
  let s: number, t: number;
  if (a < 1e-18) { s = 0; t = f / e; }
  else {
    const c = d1.dot(r);
    if (e < 1e-18) { t = 0; s = -c / a; }
    else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      if (Math.abs(denom) < 1e-18) return null; // parallel
      s = (b * f - c * e) / denom;
      t = (a * f - b * c) / denom;
    }
  }
  return [
    new Point3d(p1.x + d1.x * s, p1.y + d1.y * s, p1.z + d1.z * s),
    new Point3d(p2.x + d2.x * t, p2.y + d2.y * t, p2.z + d2.z * t),
  ];
}

/**
 * Geom.intersect_line_plane — line as [Point3d, Vector3d], plane as either:
 *   - [a, b, c, d] coefficients
 *   - [Point3d, Vector3d] (point + normal)
 * Returns the intersection Point3d or null if parallel.
 */
export function intersectLinePlane(
  line: [Point3dLike, Vector3dLike],
  plane: [number, number, number, number] | [Point3dLike, Vector3dLike],
): Point3d | null {
  const lo = coerceXYZ(line[0]); const ld = new Vector3d(line[1]);
  let n: Vector3d; let d: number;
  if (typeof plane[0] === 'number') {
    [n, d] = [new Vector3d(plane[0] as number, (plane[1] as number) ?? 0, (plane[2] as number) ?? 0), (plane[3] as number) ?? 0];
  } else {
    const pp = coerceXYZ(plane[0] as Point3dLike); n = new Vector3d(plane[1] as Vector3dLike);
    d = -(n.x * pp.x + n.y * pp.y + n.z * pp.z);
  }
  const denom = n.dot(ld);
  if (Math.abs(denom) < 1e-12) return null;
  const t = -(n.x * lo.x + n.y * lo.y + n.z * lo.z + d) / denom;
  return new Point3d(lo.x + ld.x * t, lo.y + ld.y * t, lo.z + ld.z * t);
}

/**
 * Geom.intersect_plane_plane — returns the line of intersection as [Point3d, Vector3d],
 * or null if parallel.
 */
export function intersectPlanePlane(
  planeA: [number, number, number, number],
  planeB: [number, number, number, number],
): [Point3d, Vector3d] | null {
  const n1 = new Vector3d(planeA[0], planeA[1], planeA[2]);
  const n2 = new Vector3d(planeB[0], planeB[1], planeB[2]);
  const dir = n1.cross(n2);
  if (dir.length < 1e-12) return null;
  // Find a point on the line by solving the under-determined system, fixing one coordinate.
  const absX = Math.abs(dir.x); const absY = Math.abs(dir.y); const absZ = Math.abs(dir.z);
  let p: Point3d;
  if (absZ >= absX && absZ >= absY) {
    const denom = n1.x * n2.y - n2.x * n1.y;
    p = new Point3d((n1.y * planeB[3] - n2.y * planeA[3]) / -denom,
                    (n2.x * planeA[3] - n1.x * planeB[3]) / -denom, 0);
  } else if (absY >= absX) {
    const denom = n1.x * n2.z - n2.x * n1.z;
    p = new Point3d((n1.z * planeB[3] - n2.z * planeA[3]) / -denom, 0,
                    (n2.x * planeA[3] - n1.x * planeB[3]) / -denom);
  } else {
    const denom = n1.y * n2.z - n2.y * n1.z;
    p = new Point3d(0, (n1.z * planeB[3] - n2.z * planeA[3]) / -denom,
                    (n2.y * planeA[3] - n1.y * planeB[3]) / -denom);
  }
  return [p, dir];
}

/** Geom.point_in_polygon_2D — winding-number test in the XY plane. */
export function pointInPolygon2D(point: Point3dLike, polygon: Point3dLike[], checkBorder = false): boolean {
  const p = coerceXYZ(point);
  let wn = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = coerceXYZ(polygon[i]);
    const b = coerceXYZ(polygon[(i + 1) % polygon.length]);
    if (checkBorder && pointOnSegment2D(p, a, b)) return true;
    if (a.y <= p.y) { if (b.y > p.y && isLeft(a, b, p) > 0) wn++; }
    else if (b.y <= p.y && isLeft(a, b, p) < 0) wn--;
  }
  return wn !== 0;
}

function isLeft(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): number {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
}
function pointOnSegment2D(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  if (Math.abs(isLeft(a, b, p)) > 1e-9) return false;
  return p.x >= Math.min(a.x, b.x) - 1e-9 && p.x <= Math.max(a.x, b.x) + 1e-9 &&
         p.y >= Math.min(a.y, b.y) - 1e-9 && p.y <= Math.max(a.y, b.y) + 1e-9;
}

/**
 * Geom.tesselate(polygon, holes?) — fan triangulation good enough for convex outer
 * with optional polygonal holes (handled by ear-cut style). Returns a flat Point3d[]
 * with 3 entries per triangle.
 */
export function tesselate(polygon: Point3dLike[], holes: Point3dLike[][] = []): Point3d[] {
  const verts: Point3d[] = polygon.map(p => new Point3d(coerceXYZ(p)));
  // Ear clipping in 2D — project to the polygon's plane. For convex without holes this
  // degenerates to a fan from vertex 0.
  if (holes.length === 0 && isConvex(verts)) {
    const out: Point3d[] = [];
    for (let i = 1; i < verts.length - 1; i++) out.push(verts[0], verts[i], verts[i + 1]);
    return out;
  }
  // For non-convex / holes, run a 2D ear-clip after projecting onto the best-fit plane.
  return earClip2D(verts, holes.map(h => h.map(p => new Point3d(coerceXYZ(p)))));
}

function isConvex(pts: Point3d[]): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length]; const c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross !== 0) {
      if (sign === 0) sign = cross > 0 ? 1 : -1;
      else if ((cross > 0 && sign < 0) || (cross < 0 && sign > 0)) return false;
    }
  }
  return true;
}

function earClip2D(outer: Point3d[], _holes: Point3d[][]): Point3d[] {
  const verts = outer.slice();
  const out: Point3d[] = [];
  let guard = 0;
  while (verts.length > 3 && guard++ < 10000) {
    let earFound = false;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[(i - 1 + verts.length) % verts.length];
      const b = verts[i];
      const c = verts[(i + 1) % verts.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross <= 0) continue; // assumes CCW; flip if needed
      // Check no other vertex inside
      let inside = false;
      for (let j = 0; j < verts.length; j++) {
        if (j === i || j === (i - 1 + verts.length) % verts.length || j === (i + 1) % verts.length) continue;
        const p = verts[j];
        if (pointInTri2D(p, a, b, c)) { inside = true; break; }
      }
      if (inside) continue;
      out.push(a, b, c);
      verts.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break;
  }
  if (verts.length === 3) out.push(verts[0], verts[1], verts[2]);
  return out;
}
function pointInTri2D(p: Point3d, a: Point3d, b: Point3d, c: Point3d): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
