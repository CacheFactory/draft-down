// @archigraph tool.axes
// Shared custom axes state. When set, all drawing tools use these axes
// instead of the default world axes.

import type { Vec3 } from '../../src/core/types';
import { vec3 } from '../../src/core/math';

export interface AxesOrientation {
  origin: Vec3;
  xAxis: Vec3;  // red — unit vector
  yAxis: Vec3;  // green (up) — unit vector
  zAxis: Vec3;  // blue — unit vector
}

class CustomAxesImpl {
  private _custom: AxesOrientation | null = null;
  private _listeners: Array<() => void> = [];

  /** Current custom axes, or null for default world axes. */
  get current(): AxesOrientation | null {
    return this._custom;
  }

  get isCustom(): boolean {
    return this._custom !== null;
  }

  /** Set custom axes from a face click. yAxis = face normal, origin = click point. */
  setFromFace(origin: Vec3, faceNormal: Vec3, faceEdgeDir?: Vec3): void {
    const yAxis = vec3.normalize(faceNormal);

    // Compute xAxis: use faceEdgeDir if provided, otherwise derive from normal
    let xAxis: Vec3;
    if (faceEdgeDir && vec3.length(faceEdgeDir) > 0.001) {
      // Project edge direction onto the face plane to ensure orthogonality
      const dot = vec3.dot(faceEdgeDir, yAxis);
      xAxis = vec3.normalize(vec3.sub(faceEdgeDir, vec3.mul(yAxis, dot)));
    } else {
      // Pick a direction perpendicular to normal
      if (Math.abs(yAxis.y) > 0.9) {
        xAxis = vec3.normalize(vec3.cross(yAxis, { x: 0, y: 0, z: 1 }));
      } else {
        xAxis = vec3.normalize(vec3.cross(yAxis, { x: 0, y: 1, z: 0 }));
      }
    }

    // zAxis = cross(xAxis, yAxis) to complete right-handed system
    const zAxis = vec3.normalize(vec3.cross(xAxis, yAxis));

    // Re-derive xAxis to ensure perfect orthonormality
    const finalX = vec3.normalize(vec3.cross(yAxis, zAxis));

    this._custom = {
      origin: vec3.clone(origin),
      xAxis: finalX,
      yAxis,
      zAxis,
    };

    this._notify();
  }

  /** Reset to default world axes. */
  reset(): void {
    this._custom = null;
    this._notify();
  }

  /** Get the plane normal for a given axis name, respecting custom orientation. */
  getPlaneNormal(axis: 'ground' | 'red' | 'green' | 'blue'): Vec3 {
    if (!this._custom) {
      // Default world planes
      switch (axis) {
        case 'ground': case 'green': return { x: 0, y: 1, z: 0 };
        case 'red': return { x: 1, y: 0, z: 0 };
        case 'blue': return { x: 0, y: 0, z: 1 };
      }
    }

    // Custom axes: planes are perpendicular to the custom axis directions
    switch (axis) {
      case 'ground': case 'green': return vec3.clone(this._custom.yAxis); // "up" plane
      case 'red': return vec3.clone(this._custom.xAxis);   // "right" plane
      case 'blue': return vec3.clone(this._custom.zAxis);  // "forward" plane
    }
  }

  /** Get the axis direction for axis locking (line tool). */
  getAxisDirection(axis: 'x' | 'y' | 'z'): Vec3 {
    if (!this._custom) {
      switch (axis) {
        case 'x': return { x: 1, y: 0, z: 0 };
        case 'y': return { x: 0, y: 1, z: 0 };
        case 'z': return { x: 0, y: 0, z: 1 };
      }
    }
    switch (axis) {
      case 'x': return vec3.clone(this._custom.xAxis);
      case 'y': return vec3.clone(this._custom.yAxis);
      case 'z': return vec3.clone(this._custom.zAxis);
    }
  }

  onChange(listener: () => void): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }

  private _notify(): void {
    for (const l of this._listeners) l();
  }
}

export const customAxes = new CustomAxesImpl();
