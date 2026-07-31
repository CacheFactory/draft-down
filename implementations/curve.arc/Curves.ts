// @archigraph engine.geometry
// Arc and polyline curve representations

import { Vec3 } from '../../src/core/types';
import { vec3, EPSILON } from '../../src/core/math';

/**
 * Base interface for parametric curves.
 * Parameter t ranges from 0 to 1.
 */
export interface ICurve {
  /** Get a point at parameter t in [0, 1]. */
  getPointAt(t: number): Vec3;
  /** Compute the total arc length of the curve. */
  computeLength(): number;
  /** Sample the curve at a given number of segments, returning n+1 points. */
  samplePoints(segments: number): Vec3[];
}

/**
 * Arc curve defined by center, radius, start/end angles, and a plane normal.
 * Angles are in radians. The arc is drawn in the plane perpendicular to `planeNormal`,
 * starting from a computed local X-axis.
 */
export class ArcCurve implements ICurve {
  readonly center: Vec3;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly planeNormal: Vec3;

  // Local coordinate frame in the arc plane
  private readonly localX: Vec3;
  private readonly localY: Vec3;

  constructor(center: Vec3, radius: number, startAngle: number, endAngle: number, planeNormal: Vec3) {
    this.center = vec3.clone(center);
    this.radius = radius;
    this.startAngle = startAngle;
    this.endAngle = endAngle;
    this.planeNormal = vec3.normalize(planeNormal);

    // Build orthonormal basis in the plane
    // Choose an arbitrary vector not parallel to planeNormal to cross with
    let arbitrary: Vec3;
    if (Math.abs(this.planeNormal.y) < 0.9) {
      arbitrary = { x: 0, y: 1, z: 0 };
    } else {
      arbitrary = { x: 1, y: 0, z: 0 };
    }
    this.localX = vec3.normalize(vec3.cross(arbitrary, this.planeNormal));
    this.localY = vec3.normalize(vec3.cross(this.planeNormal, this.localX));
  }

  getPointAt(t: number): Vec3 {
    const angle = this.startAngle + (this.endAngle - this.startAngle) * t;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return vec3.add(
      this.center,
      vec3.add(
        vec3.mul(this.localX, this.radius * cosA),
        vec3.mul(this.localY, this.radius * sinA),
      ),
    );
  }

  computeLength(): number {
    const deltaAngle = Math.abs(this.endAngle - this.startAngle);
    return this.radius * deltaAngle;
  }

  samplePoints(segments: number): Vec3[] {
    if (segments < 1) segments = 1;
    const points: Vec3[] = [];
    for (let i = 0; i <= segments; i++) {
      points.push(this.getPointAt(i / segments));
    }
    return points;
  }

  /**
   * Get the tangent direction at parameter t.
   */
  getTangentAt(t: number): Vec3 {
    const angle = this.startAngle + (this.endAngle - this.startAngle) * t;
    const sign = this.endAngle >= this.startAngle ? 1 : -1;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return vec3.normalize(
      vec3.add(
        vec3.mul(this.localX, -sinA * sign),
        vec3.mul(this.localY, cosA * sign),
      ),
    );
  }
}

/**
 * Polyline curve defined by an ordered list of points.
 * Linear interpolation between consecutive points.
 */
export class PolylineCurve implements ICurve {
  readonly points: Vec3[];
  private segmentLengths: Float64Array;
  private totalLength: number;

  constructor(points: Vec3[]) {
    if (points.length < 2) {
      throw new Error('PolylineCurve requires at least 2 points');
    }
    this.points = points.map(p => vec3.clone(p));

    // Pre-compute segment lengths
    const n = this.points.length - 1;
    this.segmentLengths = new Float64Array(n);
    this.totalLength = 0;
    for (let i = 0; i < n; i++) {
      const len = vec3.distance(this.points[i], this.points[i + 1]);
      this.segmentLengths[i] = len;
      this.totalLength += len;
    }
  }

  getPointAt(t: number): Vec3 {
    if (t <= 0) return vec3.clone(this.points[0]);
    if (t >= 1) return vec3.clone(this.points[this.points.length - 1]);

    const targetDist = t * this.totalLength;
    let accumulated = 0;

    for (let i = 0; i < this.segmentLengths.length; i++) {
      const segLen = this.segmentLengths[i];
      if (accumulated + segLen >= targetDist - EPSILON) {
        const localT = segLen > EPSILON ? (targetDist - accumulated) / segLen : 0;
        return vec3.lerp(this.points[i], this.points[i + 1], localT);
      }
      accumulated += segLen;
    }

    return vec3.clone(this.points[this.points.length - 1]);
  }

  computeLength(): number {
    return this.totalLength;
  }

  samplePoints(segments: number): Vec3[] {
    if (segments < 1) segments = 1;
    const points: Vec3[] = [];
    for (let i = 0; i <= segments; i++) {
      points.push(this.getPointAt(i / segments));
    }
    return points;
  }

  /**
   * Get all the original control points.
   */
  getControlPoints(): Vec3[] {
    return this.points.map(p => vec3.clone(p));
  }

  /**
   * Get the tangent direction at parameter t.
   */
  getTangentAt(t: number): Vec3 {
    if (this.points.length < 2) return vec3.zero();

    const targetDist = Math.max(0, Math.min(1, t)) * this.totalLength;
    let accumulated = 0;

    for (let i = 0; i < this.segmentLengths.length; i++) {
      const segLen = this.segmentLengths[i];
      if (accumulated + segLen >= targetDist - EPSILON || i === this.segmentLengths.length - 1) {
        return vec3.normalize(vec3.sub(this.points[i + 1], this.points[i]));
      }
      accumulated += segLen;
    }

    const last = this.points.length - 1;
    return vec3.normalize(vec3.sub(this.points[last], this.points[last - 1]));
  }
}
