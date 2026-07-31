// @archigraph op.sweep
// Follow-me / sweep operation for DraftDown

import { Vec3 } from '../../src/core/types';
import { IGeometryEngine, IFace, IVertex } from '../../src/core/interfaces';
import { vec3, EPSILON } from '../../src/core/math';

export interface SweepParams {
  profileFaceId: string;  // the face to sweep (profile)
  pathEdgeIds: string[];  // ordered edge IDs forming the sweep path
  alignToPath?: boolean;  // rotate profile to follow path curvature (default: true)
  /** Delete the profile face after sweeping (classic CAD Follow Me). Default true. */
  consumeProfile?: boolean;
}

export interface SweepResult {
  success: boolean;
  newFaceIds: string[];
  newEdgeIds: string[];
  newVertexIds: string[];
  error?: string;
}

/**
 * Sweep Operation (Follow-Me): sweeps a profile face along a path of edges.
 *
 * Algorithm:
 * 1. Extract the ordered path vertices from the path edges.
 * 2. At each path vertex, compute a local coordinate frame (Frenet or fixed).
 * 3. Transform the profile vertices into each frame to get cross-section rings.
 * 4. Connect consecutive rings with quad faces.
 * 5. Optionally cap the start and end.
 */
export class SweepOperation {
  execute(engine: IGeometryEngine, params: SweepParams): SweepResult {
    const { profileFaceId, pathEdgeIds, alignToPath = true, consumeProfile = true } = params;

    const profileFace = engine.getFace(profileFaceId);
    if (!profileFace) {
      return { success: false, newFaceIds: [], newEdgeIds: [], newVertexIds: [], error: `Profile face ${profileFaceId} not found` };
    }

    if (pathEdgeIds.length === 0) {
      return { success: false, newFaceIds: [], newEdgeIds: [], newVertexIds: [], error: 'Path must have at least one edge' };
    }

    // Extract ordered path points
    const pathPoints = this.extractPathPoints(engine, pathEdgeIds);
    if (!pathPoints) {
      return { success: false, newFaceIds: [], newEdgeIds: [], newVertexIds: [], error: 'Path edges are not connected' };
    }

    if (pathPoints.length < 2) {
      return { success: false, newFaceIds: [], newEdgeIds: [], newVertexIds: [], error: 'Path must have at least 2 points' };
    }

    // Closed path (classic CAD Follow Me around a loop → torus-like result):
    // the walk returns to its start. Drop the duplicate end point; rings wrap.
    const closed = pathPoints.length > 3 &&
      vec3.distance(pathPoints[0], pathPoints[pathPoints.length - 1]) < 1e-9;
    if (closed) pathPoints.pop();

    // Get profile vertices relative to profile centroid
    const profileVertices = engine.getFaceVertices(profileFaceId);
    const profileNormal = engine.computeFaceNormal(profileFaceId);
    const centroid = this.computeCentroid(profileVertices);

    // Relative profile positions (in profile-local space)
    const profileLocal = profileVertices.map(v => vec3.sub(v.position, centroid));

    const newVertexIds: string[] = [];
    const newEdgeIds: string[] = [];
    const newFaceIds: string[] = [];

    // Per-point tangents (wrapping when closed)
    const n = pathPoints.length;
    const tangents: Vec3[] = [];
    for (let pi = 0; pi < n; pi++) {
      if (closed) {
        const prev = pathPoints[(pi - 1 + n) % n];
        const next = pathPoints[(pi + 1) % n];
        const t0 = vec3.normalize(vec3.sub(pathPoints[pi], prev));
        const t1 = vec3.normalize(vec3.sub(next, pathPoints[pi]));
        tangents.push(vec3.normalize(vec3.add(t0, t1)));
      } else if (pi === 0) {
        tangents.push(vec3.normalize(vec3.sub(pathPoints[1], pathPoints[0])));
      } else if (pi === n - 1) {
        tangents.push(vec3.normalize(vec3.sub(pathPoints[pi], pathPoints[pi - 1])));
      } else {
        const t0 = vec3.normalize(vec3.sub(pathPoints[pi], pathPoints[pi - 1]));
        const t1 = vec3.normalize(vec3.sub(pathPoints[pi + 1], pathPoints[pi]));
        tangents.push(vec3.normalize(vec3.add(t0, t1)));
      }
    }

    // Rotation-minimizing frames via double reflection (Wang et al.):
    // per-point reference-based frames collapse whenever the path tangent
    // becomes parallel to the profile normal (degenerate cross products) and
    // twist unpredictably around corners; parallel transport does neither.
    const rights: Vec3[] = [];
    const ups: Vec3[] = [];
    {
      const f0 = this.buildFrame(tangents[0], profileNormal);
      rights.push(f0.right);
      ups.push(f0.up);
      for (let pi = 0; pi < n - 1; pi++) {
        const v1 = vec3.sub(pathPoints[pi + 1], pathPoints[pi]);
        const c1 = vec3.dot(v1, v1);
        if (c1 < EPSILON) { rights.push(rights[pi]); ups.push(ups[pi]); continue; }
        const rL = vec3.sub(rights[pi], vec3.mul(v1, (2 / c1) * vec3.dot(v1, rights[pi])));
        const tL = vec3.sub(tangents[pi], vec3.mul(v1, (2 / c1) * vec3.dot(v1, tangents[pi])));
        const v2 = vec3.sub(tangents[pi + 1], tL);
        const c2 = vec3.dot(v2, v2);
        const right = c2 < EPSILON ? rL : vec3.sub(rL, vec3.mul(v2, (2 / c2) * vec3.dot(v2, rL)));
        rights.push(vec3.normalize(right));
        ups.push(vec3.normalize(vec3.cross(tangents[pi + 1], rights[pi + 1] ?? right)));
      }
    }

    // Generate cross-section rings at each path point
    const rings: string[][] = [];
    const profileRight = this.getRight(profileNormal);
    const profileUp = this.getUp(profileNormal);

    for (let pi = 0; pi < n; pi++) {
      const pathPoint = pathPoints[pi];
      const ring: string[] = [];

      if (alignToPath) {
        const right = rights[pi];
        const up = ups[pi];
        for (const local of profileLocal) {
          const lx = vec3.dot(local, profileRight);
          const ly = vec3.dot(local, profileUp);
          const worldPos = vec3.add(
            pathPoint,
            vec3.add(vec3.mul(right, lx), vec3.mul(up, ly)),
          );
          const v = engine.createVertex(worldPos);
          ring.push(v.id);
          newVertexIds.push(v.id);
        }
      } else {
        // Fixed orientation: just translate the profile
        for (const local of profileLocal) {
          const worldPos = vec3.add(pathPoint, local);
          const v = engine.createVertex(worldPos);
          ring.push(v.id);
          newVertexIds.push(v.id);
        }
      }

      rings.push(ring);
    }

    // Connect consecutive rings with quad faces (wrapping when closed)
    const profileCount = profileLocal.length;
    const segmentCount = closed ? rings.length : rings.length - 1;
    for (let ri = 0; ri < segmentCount; ri++) {
      const ringA = rings[ri];
      const ringB = rings[(ri + 1) % rings.length];

      for (let vi = 0; vi < profileCount; vi++) {
        const vj = (vi + 1) % profileCount;

        const face = engine.createFace([
          ringA[vi], ringB[vi], ringB[vj], ringA[vj],
        ]);
        newFaceIds.push(face.id);
      }
    }

    // Create edges along and between rings
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      // Ring edges — soft+smooth so the swept surface reads as one form
      // (classic CAD softens Follow Me interior edges).
      for (let vi = 0; vi < profileCount; vi++) {
        const vj = (vi + 1) % profileCount;
        const e = engine.createEdge(ring[vi], ring[vj]);
        if (ri > 0 && (ri < rings.length - 1 || closed)) {
          e.soft = true;
          e.smooth = true;
        }
        newEdgeIds.push(e.id);
      }
      // Longitudinal edges connecting to next ring (wrap when closed)
      if (ri < rings.length - 1 || closed) {
        const nextRing = rings[(ri + 1) % rings.length];
        for (let vi = 0; vi < profileCount; vi++) {
          const e = engine.createEdge(ring[vi], nextRing[vi]);
          newEdgeIds.push(e.id);
        }
      }
    }

    // Cap start and end with faces — open paths only (closed sweeps are
    // watertight rings with no ends).
    if (!closed && rings.length > 0) {
      const startCap = engine.createFace([...rings[0]].reverse());
      const endCap = engine.createFace(rings[rings.length - 1]);
      newFaceIds.push(startCap.id, endCap.id);
    }

    // classic CAD Follow Me consumes the profile face.
    if (consumeProfile) {
      engine.deleteFace(profileFaceId);
    }

    return {
      success: true,
      newFaceIds,
      newEdgeIds,
      newVertexIds,
    };
  }

  /** Extract ordered path points from connected edge IDs */
  private extractPathPoints(engine: IGeometryEngine, edgeIds: string[]): Vec3[] | null {
    if (edgeIds.length === 0) return null;

    const points: Vec3[] = [];

    // Start with the first edge
    const firstEdge = engine.getEdge(edgeIds[0]);
    if (!firstEdge) return null;

    let currentEndId: string;

    if (edgeIds.length === 1) {
      const sv = engine.getVertex(firstEdge.startVertexId)!;
      const ev = engine.getVertex(firstEdge.endVertexId)!;
      return [sv.position, ev.position];
    }

    // Determine orientation of first edge by checking which vertex connects to second edge
    const secondEdge = engine.getEdge(edgeIds[1]);
    if (!secondEdge) return null;

    if (firstEdge.endVertexId === secondEdge.startVertexId || firstEdge.endVertexId === secondEdge.endVertexId) {
      points.push(engine.getVertex(firstEdge.startVertexId)!.position);
      points.push(engine.getVertex(firstEdge.endVertexId)!.position);
      currentEndId = firstEdge.endVertexId;
    } else if (firstEdge.startVertexId === secondEdge.startVertexId || firstEdge.startVertexId === secondEdge.endVertexId) {
      points.push(engine.getVertex(firstEdge.endVertexId)!.position);
      points.push(engine.getVertex(firstEdge.startVertexId)!.position);
      currentEndId = firstEdge.startVertexId;
    } else {
      return null; // Edges not connected
    }

    // Follow remaining edges
    for (let i = 1; i < edgeIds.length; i++) {
      const edge = engine.getEdge(edgeIds[i]);
      if (!edge) return null;

      if (edge.startVertexId === currentEndId) {
        currentEndId = edge.endVertexId;
      } else if (edge.endVertexId === currentEndId) {
        currentEndId = edge.startVertexId;
      } else {
        return null; // Discontinuous path
      }

      points.push(engine.getVertex(currentEndId)!.position);
    }

    return points;
  }

  private computeCentroid(vertices: IVertex[]): Vec3 {
    let sum = vec3.zero();
    for (const v of vertices) {
      sum = vec3.add(sum, v.position);
    }
    return vec3.div(sum, vertices.length);
  }

  /** Build a local coordinate frame from a tangent direction */
  private buildFrame(tangent: Vec3, referenceNormal: Vec3): { right: Vec3; up: Vec3 } {
    let up = vec3.cross(tangent, referenceNormal);
    if (vec3.length(up) < EPSILON) {
      // Tangent is parallel to reference normal, pick arbitrary perpendicular
      up = vec3.cross(tangent, vec3.right());
      if (vec3.length(up) < EPSILON) {
        up = vec3.cross(tangent, vec3.up());
      }
    }
    up = vec3.normalize(up);
    const right = vec3.normalize(vec3.cross(up, tangent));
    return { right, up };
  }

  private getRight(normal: Vec3): Vec3 {
    let right = vec3.cross(normal, vec3.up());
    if (vec3.length(right) < EPSILON) {
      right = vec3.cross(normal, vec3.forward());
    }
    return vec3.normalize(right);
  }

  private getUp(normal: Vec3): Vec3 {
    const right = this.getRight(normal);
    return vec3.normalize(vec3.cross(right, normal));
  }
}
