// @archigraph curve.polyline
// Polyline curve implementation for DraftDown
// Stores an ordered sequence of Vec3 points, supporting open and closed polylines.

import { Vec3, BoundingBox } from '../../src/core/types';
import { vec3, EPSILON, bbox } from '../../src/core/math';
import { IGeometryEngine } from '../../src/core/interfaces';

// ─── Types ──────────────────────────────────────────────────────

export interface ClosestPointResult {
  point: Vec3;
  t: number;
  distance: number;
}

export interface PolylineSerialized {
  type: 'polyline';
  degree: 1;
  closed: boolean;
  points: Array<[number, number, number]>;
}

// ─── Polyline Class ─────────────────────────────────────────────

export class Polyline {
  private _points: Vec3[];
  private _closed: boolean;
  private _segmentLengthsCache: number[] | null = null;
  private _totalLengthCache: number | null = null;

  constructor(points: Vec3[], closed = false) {
    if (points.length < 2) {
      throw new Error('Polyline requires at least 2 points.');
    }
    for (const p of points) {
      if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) {
        throw new Error('All polyline coordinates must be finite numbers.');
      }
    }
    this._points = points.map(p => vec3.clone(p));
    this._closed = closed;
  }

  // ─── Accessors ──────────────────────────────────────────────

  get points(): ReadonlyArray<Readonly<Vec3>> {
    return this._points;
  }

  get pointCount(): number {
    return this._points.length;
  }

  get segmentCount(): number {
    return this._closed ? this._points.length : this._points.length - 1;
  }

  get isClosed(): boolean {
    return this._closed;
  }

  get degree(): 1 {
    return 1;
  }

  getPoint(index: number): Vec3 {
    if (index < 0 || index >= this._points.length) {
      throw new RangeError(`Point index ${index} out of range [0, ${this._points.length - 1}].`);
    }
    return vec3.clone(this._points[index]);
  }

  // ─── Length Computations ────────────────────────────────────

  private _invalidateCache(): void {
    this._segmentLengthsCache = null;
    this._totalLengthCache = null;
  }

  private _computeSegmentLengths(): number[] {
    if (this._segmentLengthsCache !== null) {
      return this._segmentLengthsCache;
    }
    const n = this.segmentCount;
    const lengths: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = this._points[i];
      const b = this._points[(i + 1) % this._points.length];
      lengths[i] = vec3.distance(a, b);
    }
    this._segmentLengthsCache = lengths;
    return lengths;
  }

  /** Total arc length of the polyline. */
  length(): number {
    if (this._totalLengthCache !== null) {
      return this._totalLengthCache;
    }
    const lengths = this._computeSegmentLengths();
    let total = 0;
    for (let i = 0; i < lengths.length; i++) {
      total += lengths[i];
    }
    this._totalLengthCache = total;
    return total;
  }

  /** Length of segment at the given index. */
  segmentLength(index: number): number {
    if (index < 0 || index >= this.segmentCount) {
      throw new RangeError(`Segment index ${index} out of range [0, ${this.segmentCount - 1}].`);
    }
    return this._computeSegmentLengths()[index];
  }

  // ─── Parametric Evaluation ─────────────────────────────────

  /**
   * Convert global parameter t ∈ [0,1] to a segment index and local parameter.
   * Returns { segIndex, localT }.
   */
  private _paramToSegment(t: number): { segIndex: number; localT: number } {
    const tc = Math.max(0, Math.min(1, t));
    const totalLen = this.length();

    if (totalLen < EPSILON) {
      return { segIndex: 0, localT: 0 };
    }

    const targetLen = tc * totalLen;
    const segLengths = this._computeSegmentLengths();
    let accumulated = 0;

    for (let i = 0; i < segLengths.length; i++) {
      const segLen = segLengths[i];
      if (accumulated + segLen >= targetLen - EPSILON) {
        const localT = segLen < EPSILON ? 0 : (targetLen - accumulated) / segLen;
        return { segIndex: i, localT: Math.max(0, Math.min(1, localT)) };
      }
      accumulated += segLen;
    }

    // Numerical fallback: clamp to last segment end
    return { segIndex: segLengths.length - 1, localT: 1 };
  }

  /** Evaluate the polyline at global parameter t ∈ [0,1]. */
  pointAt(t: number): Vec3 {
    const { segIndex, localT } = this._paramToSegment(t);
    const a = this._points[segIndex];
    const b = this._points[(segIndex + 1) % this._points.length];
    return vec3.lerp(a, b, localT);
  }

  /** Tangent vector (unit length) at global parameter t. */
  tangentAt(t: number): Vec3 {
    const { segIndex } = this._paramToSegment(t);
    const a = this._points[segIndex];
    const b = this._points[(segIndex + 1) % this._points.length];
    const dir = vec3.sub(b, a);
    const len = vec3.length(dir);
    if (len < EPSILON) {
      // Degenerate segment — try adjacent segments
      return this._fallbackTangent(segIndex);
    }
    return vec3.normalize(dir);
  }

  /** Find a non-degenerate tangent near the given segment index. */
  private _fallbackTangent(segIndex: number): Vec3 {
    const n = this.segmentCount;
    // Search forward
    for (let offset = 1; offset < n; offset++) {
      const idx = (segIndex + offset) % n;
      const a = this._points[idx];
      const b = this._points[(idx + 1) % this._points.length];
      const dir = vec3.sub(b, a);
      if (vec3.length(dir) > EPSILON) {
        return vec3.normalize(dir);
      }
    }
    // All segments degenerate
    return vec3.right();
  }

  // ─── Splitting ─────────────────────────────────────────────

  /** Split the polyline at parameter t, returning two new polylines. */
  split(t: number): [Polyline, Polyline] {
    const tc = Math.max(0, Math.min(1, t));
    const splitPoint = this.pointAt(tc);
    const { segIndex, localT } = this._paramToSegment(tc);

    if (this._closed) {
      // Closed polyline splits into a single open polyline starting and ending at the split point
      const pts: Vec3[] = [vec3.clone(splitPoint)];

      // Add remaining points after the split segment
      const startIdx = segIndex + 1;
      for (let i = 0; i < this._points.length; i++) {
        pts.push(vec3.clone(this._points[(startIdx + i) % this._points.length]));
      }

      // If localT > EPSILON, add the split point as the end too
      if (localT > EPSILON && localT < 1 - EPSILON) {
        pts.push(vec3.clone(splitPoint));
      } else if (localT <= EPSILON) {
        // Split right at a vertex — the loop already ends there
        pts.push(vec3.clone(splitPoint));
      } else {
        pts.push(vec3.clone(splitPoint));
      }

      // Return two halves of roughly equal parameter ranges
      const midCount = Math.ceil(pts.length / 2);
      const first = pts.slice(0, midCount + 1);
      const second = pts.slice(midCount);

      if (first.length < 2) first.push(vec3.clone(splitPoint));
      if (second.length < 2) second.unshift(vec3.clone(splitPoint));

      return [new Polyline(first, false), new Polyline(second, false)];
    }

    // Open polyline
    const firstPts: Vec3[] = [];
    for (let i = 0; i <= segIndex; i++) {
      firstPts.push(vec3.clone(this._points[i]));
    }
    if (localT > EPSILON) {
      firstPts.push(vec3.clone(splitPoint));
    }

    const secondPts: Vec3[] = [vec3.clone(splitPoint)];
    if (localT < 1 - EPSILON) {
      // The split point is interior to the segment, add the segment endpoint
      secondPts.push(vec3.clone(this._points[segIndex + 1]));
      for (let i = segIndex + 2; i < this._points.length; i++) {
        secondPts.push(vec3.clone(this._points[i]));
      }
    } else {
      // Split at a vertex
      for (let i = segIndex + 1; i < this._points.length; i++) {
        secondPts.push(vec3.clone(this._points[i]));
      }
    }

    // Ensure minimum 2 points
    if (firstPts.length < 2) {
      firstPts.push(vec3.clone(splitPoint));
    }
    if (secondPts.length < 2) {
      secondPts.push(vec3.clone(this._points[this._points.length - 1]));
    }

    return [new Polyline(firstPts, false), new Polyline(secondPts, false)];
  }

  // ─── Subdivision ───────────────────────────────────────────

  /** Subdivide so no segment exceeds maxSegmentLength. Returns a new Polyline. */
  subdivide(maxSegmentLength: number): Polyline {
    if (maxSegmentLength <= 0) {
      throw new Error('maxSegmentLength must be positive.');
    }
    const newPts: Vec3[] = [];
    const n = this.segmentCount;

    for (let i = 0; i < n; i++) {
      const a = this._points[i];
      const b = this._points[(i + 1) % this._points.length];
      const segLen = vec3.distance(a, b);
      const divisions = Math.max(1, Math.ceil(segLen / maxSegmentLength));

      newPts.push(vec3.clone(a));
      for (let d = 1; d < divisions; d++) {
        newPts.push(vec3.lerp(a, b, d / divisions));
      }
    }

    if (!this._closed) {
      newPts.push(vec3.clone(this._points[this._points.length - 1]));
    }

    return new Polyline(newPts, this._closed);
  }

  // ─── Simplification (Ramer-Douglas-Peucker) ────────────────

  /** Simplify using the Ramer-Douglas-Peucker algorithm. Returns a new Polyline. */
  simplify(tolerance: number): Polyline {
    if (tolerance < 0) {
      throw new Error('Tolerance must be non-negative.');
    }
    if (this._points.length <= 2) {
      return new Polyline(this._points.map(p => vec3.clone(p)), this._closed);
    }

    if (this._closed) {
      return this._simplifyClosed(tolerance);
    }

    const kept = this._rdp(0, this._points.length - 1, tolerance);
    kept.sort((a, b) => a - b);
    const simplified = kept.map(i => vec3.clone(this._points[i]));

    if (simplified.length < 2) {
      return new Polyline(
        [vec3.clone(this._points[0]), vec3.clone(this._points[this._points.length - 1])],
        false,
      );
    }

    return new Polyline(simplified, false);
  }

  private _simplifyClosed(tolerance: number): Polyline {
    // For closed polylines, find the point farthest from the centroid as a stable anchor,
    // then run RDP on the "unrolled" open version.
    const pts = this._points;
    const n = pts.length;

    // Find two points that are farthest apart to use as anchors
    let maxDist = -1;
    let anchor1 = 0;
    let anchor2 = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = vec3.distanceSq(pts[i], pts[j]);
        if (d > maxDist) {
          maxDist = d;
          anchor1 = i;
          anchor2 = j;
        }
      }
    }

    // Reorder so anchor1 comes first
    const reordered: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      reordered.push(pts[(anchor1 + i) % n]);
    }
    reordered.push(vec3.clone(pts[anchor1])); // close the loop as open

    const newAnchor2 = (anchor2 - anchor1 + n) % n;

    // RDP on first half
    const firstHalf = this._rdpArray(reordered, 0, newAnchor2, tolerance);
    // RDP on second half
    const secondHalf = this._rdpArray(reordered, newAnchor2, n, tolerance);

    const allIndices = new Set<number>();
    for (const idx of firstHalf) allIndices.add(idx);
    for (const idx of secondHalf) allIndices.add(idx);

    const sorted = Array.from(allIndices).sort((a, b) => a - b);
    const simplified = sorted.map(i => vec3.clone(reordered[i]));

    if (simplified.length < 3) {
      // A closed polyline needs at least 3 points
      return new Polyline(
        [vec3.clone(reordered[0]), vec3.clone(reordered[newAnchor2]), vec3.clone(reordered[Math.floor(n * 0.75)])],
        true,
      );
    }

    return new Polyline(simplified, true);
  }

  /** RDP on this._points, returns indices of kept points. */
  private _rdp(start: number, end: number, tolerance: number): number[] {
    return this._rdpArray(this._points, start, end, tolerance);
  }

  /** RDP on an arbitrary array, returns indices of kept points. */
  private _rdpArray(pts: Vec3[], start: number, end: number, tolerance: number): number[] {
    if (end - start <= 1) {
      return [start, end];
    }

    const lineStart = pts[start];
    const lineEnd = pts[end];
    let maxDist = 0;
    let maxIndex = start;

    for (let i = start + 1; i < end; i++) {
      const d = this._perpendicularDistance(pts[i], lineStart, lineEnd);
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }

    if (maxDist > tolerance) {
      const left = this._rdpArray(pts, start, maxIndex, tolerance);
      const right = this._rdpArray(pts, maxIndex, end, tolerance);
      // Merge, avoiding duplicate at maxIndex
      return [...left, ...right.slice(1)];
    }

    return [start, end];
  }

  /** Perpendicular distance from a point to a line segment. */
  private _perpendicularDistance(point: Vec3, lineStart: Vec3, lineEnd: Vec3): number {
    const lineDir = vec3.sub(lineEnd, lineStart);
    const lineLen = vec3.length(lineDir);
    if (lineLen < EPSILON) {
      return vec3.distance(point, lineStart);
    }
    const t = vec3.dot(vec3.sub(point, lineStart), lineDir) / (lineLen * lineLen);
    const projection = vec3.add(lineStart, vec3.mul(lineDir, t));
    return vec3.distance(point, projection);
  }

  // ─── Mutation ──────────────────────────────────────────────

  /** Return a new Polyline with reversed point order. */
  reverse(): Polyline {
    return new Polyline([...this._points].reverse(), this._closed);
  }

  /** Return a new closed Polyline. */
  close(): Polyline {
    return new Polyline(this._points.map(p => vec3.clone(p)), true);
  }

  /** Return a new open Polyline. */
  open(): Polyline {
    return new Polyline(this._points.map(p => vec3.clone(p)), false);
  }

  // ─── Bounding Box ─────────────────────────────────────────

  /** Compute the axis-aligned bounding box. */
  boundingBox(): BoundingBox {
    let box = bbox.empty();
    for (const p of this._points) {
      box = bbox.expandByPoint(box, p);
    }
    return box;
  }

  // ─── Closest Point ────────────────────────────────────────

  /** Find the closest point on the polyline to a given point. */
  closestPoint(point: Vec3): ClosestPointResult {
    const segLengths = this._computeSegmentLengths();
    const totalLen = this.length();

    let bestDist = Infinity;
    let bestPoint = this._points[0];
    let bestGlobalT = 0;
    let accumulatedLen = 0;

    const n = this.segmentCount;
    for (let i = 0; i < n; i++) {
      const a = this._points[i];
      const b = this._points[(i + 1) % this._points.length];
      const segDir = vec3.sub(b, a);
      const segLen = segLengths[i];

      let localT: number;
      let closest: Vec3;

      if (segLen < EPSILON) {
        localT = 0;
        closest = vec3.clone(a);
      } else {
        localT = vec3.dot(vec3.sub(point, a), segDir) / (segLen * segLen);
        localT = Math.max(0, Math.min(1, localT));
        closest = vec3.lerp(a, b, localT);
      }

      const dist = vec3.distance(point, closest);
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = closest;
        bestGlobalT = totalLen < EPSILON ? 0 : (accumulatedLen + localT * segLen) / totalLen;
      }

      accumulatedLen += segLen;
    }

    return {
      point: bestPoint,
      t: Math.max(0, Math.min(1, bestGlobalT)),
      distance: bestDist,
    };
  }

  // ─── Geometry Engine Integration ──────────────────────────

  /** Create vertices in the geometry engine and return their IDs. */
  toVertexIds(engine: IGeometryEngine): string[] {
    // @archigraph uses|curve.polyline|engine.geometry|geometry
    const ids: string[] = [];
    for (const p of this._points) {
      const vertex = engine.createVertex(p);
      ids.push(vertex.id);
    }
    return ids;
  }

  // ─── Serialization ────────────────────────────────────────

  serialize(): PolylineSerialized {
    return {
      type: 'polyline',
      degree: 1,
      closed: this._closed,
      points: this._points.map(p => [p.x, p.y, p.z] as [number, number, number]),
    };
  }

  static deserialize(data: PolylineSerialized): Polyline {
    if (data.type !== 'polyline') {
      throw new Error(`Expected type "polyline", got "${data.type}".`);
    }
    const points = data.points.map(([x, y, z]) => vec3.create(x, y, z));
    return new Polyline(points, data.closed);
  }
}
