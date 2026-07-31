// @archigraph api.model
// High-level programmatic API for 3D model operations.
// Serves as the interface for AI chat and plugin system.

import type {
  IModelDocument, IGeometryEngine, IVertex, IFace, IEdge,
  IMaterialManager, ISelectionManager, IHistoryManager, ISceneManager,
  ICameraController,
} from '../../src/core/interfaces';
import type { Vec3, Color, BoundingBox, MaterialDef } from '../../src/core/types';
import type { IViewport } from '../../src/core/interfaces';
import { vec3, bbox, degToRad } from '../../src/core/math';
import { ChamferOperation } from '../op.chamfer/ChamferOperation';
import { FilletOperation } from '../op.fillet/FilletOperation';
import { SweepOperation } from '../op.sweep/SweepOperation';
import { OffsetOperation } from '../op.offset/OffsetOperation';
import { SubdivideOperation } from '../op.subdivide/SubdivideOperation';
import { TriangulateOperation } from '../op.triangulate/TriangulateOperation';
import { BooleanUnion, MeshRegion } from '../op.boolean_union/BooleanUnion';
import { BooleanSubtract } from '../op.boolean_subtract/BooleanSubtract';
import { BooleanIntersect } from '../op.boolean_intersect/BooleanIntersect';

// ─── Result Types ────────────────────────────────────────────────

export interface ShapeResult {
  faceIds: string[];
  edgeIds: string[];
  vertexIds: string[];
}

export interface FaceInfo {
  id: string;
  area: number;
  normal: Vec3;
  vertexCount: number;
  vertices: Vec3[];
}

export interface EntityInfo {
  faces: string[];
  edges: string[];
  vertices: string[];
}

export interface EdgeInfo {
  id: string;
  length: number;
  startVertex: Vec3;
  endVertex: Vec3;
  midpoint: Vec3;
  adjacentFaceIds: string[];
}

export interface MeasureResult {
  distance: number;
  dx: number;
  dy: number;
  dz: number;
}

// ─── API Interface ───────────────────────────────────────────────

export interface IModelAPI {
  // Shape primitives
  createBox(origin: Vec3, width: number, depth: number, height: number): ShapeResult;
  createPlane(origin: Vec3, width: number, depth: number, normal?: Vec3): ShapeResult;
  createCylinder(center: Vec3, radius: number, height: number, segments?: number): ShapeResult;
  createSphere(center: Vec3, radius: number, rings?: number, segments?: number): ShapeResult;
  createPolygon(center: Vec3, radius: number, sides: number, normal?: Vec3): ShapeResult;

  // Extrude
  extrudeFace(faceId: string, distance: number): ShapeResult;
  insetFace(faceId: string, distance: number): ShapeResult;

  // Compound / Architectural
  createWall(start: Vec3, end: Vec3, height: number, thickness: number): ShapeResult;
  cutOpening(faceId: string, width: number, height: number, offsetX?: number, offsetY?: number): ShapeResult;
  arrayLinear(entityIds: string[], direction: Vec3, count: number, spacing: number): ShapeResult;
  arrayRadial(entityIds: string[], center: Vec3, axis: Vec3, count: number): ShapeResult;
  mirrorEntities(entityIds: string[], planePoint: Vec3, planeNormal: Vec3): ShapeResult;
  createRoof(faceId: string, pitch: number, overhang?: number): ShapeResult;
  createStairs(start: Vec3, direction: Vec3, riseHeight: number, treadDepth: number, width: number, numSteps: number): ShapeResult;
  createArch(center: Vec3, radius: number, height: number, thickness: number, segments?: number): ShapeResult;

  // Transforms
  moveEntities(entityIds: string[], offset: Vec3): void;
  rotateEntities(entityIds: string[], axis: Vec3, angleDeg: number, pivot?: Vec3): void;
  scaleEntities(entityIds: string[], factor: Vec3, pivot?: Vec3): void;
  copyEntities(entityIds: string[], offset: Vec3): ShapeResult;

  // Deletion
  deleteEntities(entityIds: string[]): void;

  // Materials
  setFaceColor(faceIds: string | string[], r: number, g: number, b: number): string;
  setFaceMaterial(faceIds: string | string[], materialId: string): void;
  createMaterial(name: string, color: Color, options?: { opacity?: number; roughness?: number; metalness?: number }): string;
  listMaterials(): Array<{ id: string; name: string; color: Color }>;

  // Queries
  measureDistance(a: Vec3, b: Vec3): MeasureResult;
  getFaceInfo(faceId: string): FaceInfo | null;
  getSelectedEntities(): EntityInfo;
  getBoundingBox(entityIds?: string[]): BoundingBox;
  getAllFaces(): string[];
  getAllEdges(): string[];
  getVertexPosition(vertexId: string): Vec3 | null;

  // Selection
  select(entityIds: string[]): void;
  clearSelection(): void;
  selectAll(): void;

  // View
  setView(name: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'): void;
  zoomExtents(): void;

  // Edge operations
  chamferEdge(edgeId: string, distance: number): ShapeResult;
  filletEdge(edgeId: string, radius: number, segments?: number): ShapeResult;

  // Face operations
  offsetFace(faceId: string, distance: number): ShapeResult;
  subdivideFaces(faceIds: string[], method?: 'midpoint' | 'catmull-clark', iterations?: number): ShapeResult;
  triangulateFaces(faceIds: string[]): ShapeResult;

  // Sweep
  sweep(profileFaceId: string, pathEdgeIds: string[], alignToPath?: boolean): ShapeResult;

  // Boolean CSG
  booleanUnion(regionAIds: string[], regionBIds: string[]): Promise<ShapeResult>;
  booleanSubtract(regionAIds: string[], regionBIds: string[]): Promise<ShapeResult>;
  booleanIntersect(regionAIds: string[], regionBIds: string[]): Promise<ShapeResult>;

  // Queries
  getEdgeInfo(edgeId: string): EdgeInfo | null;
  getConnectedFaces(faceId: string): string[];
  getEdgeFaces(edgeId: string): string[];

  // Section plane
  setSectionPlane(point: Vec3, normal: Vec3): void;
  clearSectionPlane(): void;

  // Groups
  createGroup(name: string, entityIds: string[]): string;

  // Import
  importGeometry(vertices: Vec3[], faces: number[][]): { vertexIds: string[]; faceIds: string[] };

  // Batch — run multiple operations with a single undo step and scene sync
  batch(name: string, fn: (api: IModelAPI) => void): void;
}

// ─── Implementation ──────────────────────────────────────────────

export class ModelAPI implements IModelAPI {
  private doc: IModelDocument;
  private syncScene: () => void;
  private camera: ICameraController;
  private viewport: IViewport | null;
  private inBatch = false;

  constructor(
    doc: IModelDocument,
    syncScene: () => void,
    camera: ICameraController,
    viewport?: IViewport,
  ) {
    this.doc = doc;
    this.syncScene = syncScene;
    this.camera = camera;
    this.viewport = viewport || null;
  }

  private get geo(): IGeometryEngine { return this.doc.geometry; }
  private get mat(): IMaterialManager { return this.doc.materials; }
  private get sel(): ISelectionManager { return this.doc.selection; }
  private get hist(): IHistoryManager { return this.doc.history; }

  /** Wrap a mutation in a transaction + scene sync. Nested calls (batch) skip wrapping. */
  private transact<T>(name: string, fn: () => T): T {
    if (this.inBatch) return fn();
    this.hist.beginTransaction(name);
    try {
      const result = fn();
      this.hist.commitTransaction();
      this.syncScene();
      return result;
    } catch (e) {
      this.hist.abortTransaction();
      throw e;
    }
  }

  // ── Shape Primitives ──────────────────────────────────────────

  createBox(origin: Vec3, width: number, depth: number, height: number): ShapeResult {
    return this.transact('Create Box', () => {
      const g = this.geo;
      const o = origin;

      // 8 corners: bottom face (Y = origin.y), top face (Y = origin.y + height)
      const v = [
        g.createVertex({ x: o.x, y: o.y, z: o.z }),                       // 0: bottom-front-left
        g.createVertex({ x: o.x + width, y: o.y, z: o.z }),               // 1: bottom-front-right
        g.createVertex({ x: o.x + width, y: o.y, z: o.z + depth }),       // 2: bottom-back-right
        g.createVertex({ x: o.x, y: o.y, z: o.z + depth }),               // 3: bottom-back-left
        g.createVertex({ x: o.x, y: o.y + height, z: o.z }),              // 4: top-front-left
        g.createVertex({ x: o.x + width, y: o.y + height, z: o.z }),      // 5: top-front-right
        g.createVertex({ x: o.x + width, y: o.y + height, z: o.z + depth }), // 6: top-back-right
        g.createVertex({ x: o.x, y: o.y + height, z: o.z + depth }),      // 7: top-back-left
      ];
      const vid = v.map(v => v.id);

      // 12 edges
      const edgeIds: string[] = [];
      const edge = (a: number, b: number) => {
        const e = g.createEdge(vid[a], vid[b]);
        edgeIds.push(e.id);
      };
      // Bottom
      edge(0, 1); edge(1, 2); edge(2, 3); edge(3, 0);
      // Top
      edge(4, 5); edge(5, 6); edge(6, 7); edge(7, 4);
      // Verticals
      edge(0, 4); edge(1, 5); edge(2, 6); edge(3, 7);

      // 6 faces
      const faceIds: string[] = [];
      const face = (indices: number[]) => {
        const f = g.createFace(indices.map(i => vid[i]));
        faceIds.push(f.id);
      };
      face([3, 2, 1, 0]); // bottom (normal down)
      face([4, 5, 6, 7]); // top (normal up)
      face([0, 1, 5, 4]); // front
      face([2, 3, 7, 6]); // back
      face([3, 0, 4, 7]); // left
      face([1, 2, 6, 5]); // right

      return { faceIds, edgeIds, vertexIds: vid };
    });
  }

  createPlane(origin: Vec3, width: number, depth: number, normal?: Vec3): ShapeResult {
    return this.transact('Create Plane', () => {
      const g = this.geo;
      const n = normal ? vec3.normalize(normal) : vec3.up();

      // Compute local U and V axes on the plane
      let u: Vec3;
      if (Math.abs(n.y) > 0.9) {
        u = vec3.normalize(vec3.cross(n, vec3.forward()));
      } else {
        u = vec3.normalize(vec3.cross(n, vec3.up()));
      }
      const v = vec3.normalize(vec3.cross(n, u));

      const halfW = width / 2;
      const halfD = depth / 2;

      const corners = [
        vec3.add(origin, vec3.add(vec3.mul(u, -halfW), vec3.mul(v, -halfD))),
        vec3.add(origin, vec3.add(vec3.mul(u, halfW), vec3.mul(v, -halfD))),
        vec3.add(origin, vec3.add(vec3.mul(u, halfW), vec3.mul(v, halfD))),
        vec3.add(origin, vec3.add(vec3.mul(u, -halfW), vec3.mul(v, halfD))),
      ];

      const verts = corners.map(c => g.createVertex(c));
      const vid = verts.map(v => v.id);

      const edgeIds = [
        g.createEdge(vid[0], vid[1]).id,
        g.createEdge(vid[1], vid[2]).id,
        g.createEdge(vid[2], vid[3]).id,
        g.createEdge(vid[3], vid[0]).id,
      ];

      const f = g.createFace(vid);
      return { faceIds: [f.id], edgeIds, vertexIds: vid };
    });
  }

  createCylinder(center: Vec3, radius: number, height: number, segments = 24): ShapeResult {
    return this.transact('Create Cylinder', () => {
      const g = this.geo;
      const faceIds: string[] = [];
      const edgeIds: string[] = [];

      // Bottom and top circle vertices
      const bottomVerts: string[] = [];
      const topVerts: string[] = [];

      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = center.x + radius * Math.cos(angle);
        const z = center.z + radius * Math.sin(angle);
        bottomVerts.push(g.createVertex({ x, y: center.y, z }).id);
        topVerts.push(g.createVertex({ x, y: center.y + height, z }).id);
      }

      const allVerts = [...bottomVerts, ...topVerts];

      // Bottom and top edges
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        edgeIds.push(g.createEdge(bottomVerts[i], bottomVerts[next]).id);
        edgeIds.push(g.createEdge(topVerts[i], topVerts[next]).id);
      }

      // Vertical edges
      for (let i = 0; i < segments; i++) {
        edgeIds.push(g.createEdge(bottomVerts[i], topVerts[i]).id);
      }

      // Bottom face (reversed winding for downward normal)
      faceIds.push(g.createFace([...bottomVerts].reverse()).id);
      // Top face
      faceIds.push(g.createFace(topVerts).id);

      // Side quads
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        faceIds.push(g.createFace([
          bottomVerts[i], bottomVerts[next], topVerts[next], topVerts[i],
        ]).id);
      }

      return { faceIds, edgeIds, vertexIds: allVerts };
    });
  }

  createSphere(center: Vec3, radius: number, rings = 12, segments = 24): ShapeResult {
    return this.transact('Create Sphere', () => {
      const g = this.geo;
      const faceIds: string[] = [];
      const edgeIds: string[] = [];
      const allVerts: string[] = [];

      // Create vertices ring by ring (excluding poles)
      const ringVerts: string[][] = [];
      for (let r = 1; r < rings; r++) {
        const phi = (r / rings) * Math.PI;
        const y = center.y + radius * Math.cos(phi);
        const ringRadius = radius * Math.sin(phi);
        const ring: string[] = [];
        for (let s = 0; s < segments; s++) {
          const theta = (s / segments) * Math.PI * 2;
          const x = center.x + ringRadius * Math.cos(theta);
          const z = center.z + ringRadius * Math.sin(theta);
          const vid = g.createVertex({ x, y, z }).id;
          ring.push(vid);
          allVerts.push(vid);
        }
        ringVerts.push(ring);
      }

      // Poles
      const topPole = g.createVertex({ x: center.x, y: center.y + radius, z: center.z }).id;
      const bottomPole = g.createVertex({ x: center.x, y: center.y - radius, z: center.z }).id;
      allVerts.push(topPole, bottomPole);

      // Top cap triangles (top pole -> first ring)
      for (let s = 0; s < segments; s++) {
        const next = (s + 1) % segments;
        edgeIds.push(g.createEdge(topPole, ringVerts[0][s]).id);
        faceIds.push(g.createFace([topPole, ringVerts[0][s], ringVerts[0][next]]).id);
      }

      // Body quads
      for (let r = 0; r < ringVerts.length - 1; r++) {
        for (let s = 0; s < segments; s++) {
          const next = (s + 1) % segments;
          faceIds.push(g.createFace([
            ringVerts[r][s], ringVerts[r + 1][s],
            ringVerts[r + 1][next], ringVerts[r][next],
          ]).id);
        }
      }

      // Bottom cap triangles (last ring -> bottom pole)
      const lastRing = ringVerts[ringVerts.length - 1];
      for (let s = 0; s < segments; s++) {
        const next = (s + 1) % segments;
        edgeIds.push(g.createEdge(bottomPole, lastRing[s]).id);
        faceIds.push(g.createFace([lastRing[s], bottomPole, lastRing[next]]).id);
      }

      return { faceIds, edgeIds, vertexIds: allVerts };
    });
  }

  createPolygon(center: Vec3, radius: number, sides: number, normal?: Vec3): ShapeResult {
    return this.transact('Create Polygon', () => {
      const g = this.geo;
      const n = normal ? vec3.normalize(normal) : vec3.up();

      // Compute local axes
      let u: Vec3;
      if (Math.abs(n.y) > 0.9) {
        u = vec3.normalize(vec3.cross(n, vec3.forward()));
      } else {
        u = vec3.normalize(vec3.cross(n, vec3.up()));
      }
      const v = vec3.normalize(vec3.cross(n, u));

      const verts: string[] = [];
      const edgeIds: string[] = [];

      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const pos = vec3.add(center, vec3.add(
          vec3.mul(u, radius * Math.cos(angle)),
          vec3.mul(v, radius * Math.sin(angle)),
        ));
        verts.push(g.createVertex(pos).id);
      }

      for (let i = 0; i < sides; i++) {
        edgeIds.push(g.createEdge(verts[i], verts[(i + 1) % sides]).id);
      }

      const f = g.createFace(verts);
      return { faceIds: [f.id], edgeIds, vertexIds: verts };
    });
  }

  // ── Extrude ───────────────────────────────────────────────────

  extrudeFace(faceId: string, distance: number): ShapeResult {
    return this.transact('Extrude Face', () => {
      const g = this.geo;
      const faceVertices = g.getFaceVertices(faceId);
      if (faceVertices.length < 3) throw new Error(`Face ${faceId} has fewer than 3 vertices`);
      if (Math.abs(distance) < 1e-10) throw new Error('Extrude distance is zero');

      const normal = g.computeFaceNormal(faceId);
      const offset = vec3.mul(normal, distance);

      // Create offset vertices
      const newVertexIds: string[] = [];
      for (const v of faceVertices) {
        const nv = g.createVertex(vec3.add(v.position, offset));
        newVertexIds.push(nv.id);
      }

      const faceIds: string[] = [];
      const edgeIds: string[] = [];
      const n = faceVertices.length;

      // Side faces
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const bottomA = faceVertices[i].id;
        const bottomB = faceVertices[next].id;
        const topA = newVertexIds[i];
        const topB = newVertexIds[next];

        edgeIds.push(g.createEdge(bottomA, topA).id);
        edgeIds.push(g.createEdge(topA, topB).id);
        if (i === n - 1) {
          edgeIds.push(g.createEdge(bottomB, topB).id);
        }
        faceIds.push(g.createFace([bottomA, bottomB, topB, topA]).id);
      }

      // Top cap
      const topFace = g.createFace(newVertexIds);
      faceIds.push(topFace.id);

      return {
        faceIds,
        edgeIds,
        vertexIds: newVertexIds,
      };
    });
  }

  insetFace(faceId: string, distance: number): ShapeResult {
    return this.transact('Inset Face', () => {
      const g = this.geo;
      const verts = g.getFaceVertices(faceId);
      if (verts.length < 3) throw new Error(`Face ${faceId} has fewer than 3 vertices`);

      // Compute face center
      let cx = 0, cy = 0, cz = 0;
      for (const v of verts) { cx += v.position.x; cy += v.position.y; cz += v.position.z; }
      const center: Vec3 = { x: cx / verts.length, y: cy / verts.length, z: cz / verts.length };

      // Create inset vertices (moved toward center)
      const innerVids: string[] = [];
      for (const v of verts) {
        const toCenter = vec3.normalize(vec3.sub(center, v.position));
        const pos = vec3.add(v.position, vec3.mul(toCenter, distance));
        innerVids.push(g.createVertex(pos).id);
      }

      const faceIds: string[] = [];
      const edgeIds: string[] = [];
      const n = verts.length;

      // Inner edges
      for (let i = 0; i < n; i++) {
        edgeIds.push(g.createEdge(innerVids[i], innerVids[(i + 1) % n]).id);
      }
      // Connecting edges
      for (let i = 0; i < n; i++) {
        edgeIds.push(g.createEdge(verts[i].id, innerVids[i]).id);
      }

      // Ring faces between outer and inner
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        faceIds.push(g.createFace([verts[i].id, verts[next].id, innerVids[next], innerVids[i]]).id);
      }

      // Inner face
      faceIds.push(g.createFace(innerVids).id);

      // Delete original face
      g.deleteFace(faceId);

      return { faceIds, edgeIds, vertexIds: innerVids };
    });
  }

  // ── Compound / Architectural ──────────────────────────────────

  createWall(start: Vec3, end: Vec3, height: number, thickness: number): ShapeResult {
    return this.transact('Create Wall', () => {
      const g = this.geo;
      const dir = vec3.sub(end, start);
      const len = vec3.length(dir);
      if (len < 1e-10) throw new Error('Wall start and end are the same point');
      const fwd = vec3.normalize(dir);
      // Perpendicular in XZ plane (wall thickness direction)
      const perp = vec3.normalize(vec3.cross(vec3.up(), fwd));
      const halfT = thickness / 2;

      // 8 corners: 4 bottom, 4 top
      const corners = [
        vec3.add(start, vec3.mul(perp, -halfT)),  // 0: bottom-left-start
        vec3.add(start, vec3.mul(perp, halfT)),   // 1: bottom-right-start
        vec3.add(end, vec3.mul(perp, halfT)),     // 2: bottom-right-end
        vec3.add(end, vec3.mul(perp, -halfT)),    // 3: bottom-left-end
      ];
      const topCorners = corners.map(c => vec3.add(c, { x: 0, y: height, z: 0 }));

      const vid = corners.map(c => g.createVertex(c).id);
      const tvid = topCorners.map(c => g.createVertex(c).id);

      const edgeIds: string[] = [];
      const faceIds: string[] = [];

      // Bottom edges, top edges, verticals
      for (let i = 0; i < 4; i++) {
        edgeIds.push(g.createEdge(vid[i], vid[(i + 1) % 4]).id);
        edgeIds.push(g.createEdge(tvid[i], tvid[(i + 1) % 4]).id);
        edgeIds.push(g.createEdge(vid[i], tvid[i]).id);
      }

      // Bottom, top
      faceIds.push(g.createFace([vid[3], vid[2], vid[1], vid[0]]).id);
      faceIds.push(g.createFace([tvid[0], tvid[1], tvid[2], tvid[3]]).id);
      // 4 side faces
      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        faceIds.push(g.createFace([vid[i], vid[next], tvid[next], tvid[i]]).id);
      }

      return { faceIds, edgeIds, vertexIds: [...vid, ...tvid] };
    });
  }

  cutOpening(faceId: string, width: number, height: number, offsetX = 0, offsetY = 0): ShapeResult {
    return this.transact('Cut Opening', () => {
      const g = this.geo;
      const verts = g.getFaceVertices(faceId);
      if (verts.length < 3) throw new Error('Invalid face');
      const face = g.getFace(faceId)!;
      const normal = face.normal;

      // Compute face-local coordinate system
      const p0 = verts[0].position;
      const p1 = verts[1].position;
      let uAxis = vec3.normalize(vec3.sub(p1, p0));
      let vAxis = vec3.normalize(vec3.cross(normal, uAxis));

      // Face center
      let cx = 0, cy = 0, cz = 0;
      for (const v of verts) { cx += v.position.x; cy += v.position.y; cz += v.position.z; }
      const center: Vec3 = { x: cx / verts.length, y: cy / verts.length, z: cz / verts.length };

      // Opening corners in world space (centered on face + offset)
      const hw = width / 2;
      const hh = height / 2;
      const origin = vec3.add(center, vec3.add(vec3.mul(uAxis, offsetX), vec3.mul(vAxis, offsetY)));

      const openingCorners = [
        vec3.add(origin, vec3.add(vec3.mul(uAxis, -hw), vec3.mul(vAxis, -hh))),
        vec3.add(origin, vec3.add(vec3.mul(uAxis, hw), vec3.mul(vAxis, -hh))),
        vec3.add(origin, vec3.add(vec3.mul(uAxis, hw), vec3.mul(vAxis, hh))),
        vec3.add(origin, vec3.add(vec3.mul(uAxis, -hw), vec3.mul(vAxis, hh))),
      ];

      const openVids = openingCorners.map(c => g.createVertex(c).id);

      const edgeIds: string[] = [];
      const faceIds: string[] = [];

      // Opening edges
      for (let i = 0; i < 4; i++) {
        edgeIds.push(g.createEdge(openVids[i], openVids[(i + 1) % 4]).id);
      }

      // Create fill faces from outer edge verts to opening verts
      // Simple approach: connect each outer vertex to nearest opening corner, then triangulate
      // For a quad wall face, create 4 trapezoid faces around the opening
      const n = verts.length;
      if (n === 4) {
        // Direct quad-to-quad connection: 4 fill quads
        // Connect edges from outer verts to opening verts
        for (let i = 0; i < 4; i++) {
          edgeIds.push(g.createEdge(verts[i].id, openVids[i]).id);
        }
        for (let i = 0; i < 4; i++) {
          const next = (i + 1) % 4;
          faceIds.push(g.createFace([verts[i].id, verts[next].id, openVids[next], openVids[i]]).id);
        }
      } else {
        // For non-quad faces, just create the opening face and connecting edges
        for (let i = 0; i < n && i < 4; i++) {
          edgeIds.push(g.createEdge(verts[i].id, openVids[i % 4]).id);
        }
        // Simplified: ring of triangles
        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          const oi = i % 4;
          const oni = next % 4;
          faceIds.push(g.createFace([verts[i].id, verts[next].id, openVids[oni], openVids[oi]]).id);
        }
      }

      // Delete original face (replaced by ring faces around opening)
      g.deleteFace(faceId);

      return { faceIds, edgeIds, vertexIds: openVids };
    });
  }

  arrayLinear(entityIds: string[], direction: Vec3, count: number, spacing: number): ShapeResult {
    return this.transact('Linear Array', () => {
      const allFaces: string[] = [];
      const allEdges: string[] = [];
      const allVerts: string[] = [];
      const dir = vec3.normalize(direction);

      for (let i = 1; i <= count; i++) {
        const offset = vec3.mul(dir, spacing * i);
        const result = this._copyEntitiesInternal(entityIds, offset);
        allFaces.push(...result.faceIds);
        allEdges.push(...result.edgeIds);
        allVerts.push(...result.vertexIds);
      }

      return { faceIds: allFaces, edgeIds: allEdges, vertexIds: allVerts };
    });
  }

  arrayRadial(entityIds: string[], center: Vec3, axis: Vec3, count: number): ShapeResult {
    return this.transact('Radial Array', () => {
      const allFaces: string[] = [];
      const allEdges: string[] = [];
      const allVerts: string[] = [];
      const angleStep = 360 / count;

      for (let i = 1; i < count; i++) {
        // Copy then rotate
        const result = this._copyEntitiesInternal(entityIds, vec3.zero());
        // Rotate the copied entities
        const vids = this.gatherVertices(result.faceIds.concat(result.edgeIds));
        const a = vec3.normalize(axis);
        const rad = degToRad(angleStep * i);
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);

        for (const vid of vids) {
          const v = this.geo.getVertex(vid);
          if (!v) continue;
          const rel = vec3.sub(v.position, center);
          const cross = vec3.cross(a, rel);
          const dot = vec3.dot(a, rel);
          const rotated = vec3.add(
            vec3.add(vec3.mul(rel, cosA), vec3.mul(cross, sinA)),
            vec3.mul(a, dot * (1 - cosA)),
          );
          const final = vec3.add(rotated, center);
          v.position.x = final.x;
          v.position.y = final.y;
          v.position.z = final.z;
        }

        allFaces.push(...result.faceIds);
        allEdges.push(...result.edgeIds);
        allVerts.push(...result.vertexIds);
      }

      return { faceIds: allFaces, edgeIds: allEdges, vertexIds: allVerts };
    });
  }

  mirrorEntities(entityIds: string[], planePoint: Vec3, planeNormal: Vec3): ShapeResult {
    return this.transact('Mirror', () => {
      const result = this._copyEntitiesInternal(entityIds, vec3.zero());
      const n = vec3.normalize(planeNormal);
      const vids = this.gatherVertices(result.faceIds.concat(result.edgeIds));

      for (const vid of vids) {
        const v = this.geo.getVertex(vid);
        if (!v) continue;
        // Reflect: p' = p - 2 * dot(p - planePoint, n) * n
        const d = vec3.dot(vec3.sub(v.position, planePoint), n);
        v.position.x -= 2 * d * n.x;
        v.position.y -= 2 * d * n.y;
        v.position.z -= 2 * d * n.z;
      }

      return result;
    });
  }

  createRoof(faceId: string, pitch: number, overhang = 0): ShapeResult {
    return this.transact('Create Roof', () => {
      const g = this.geo;
      const verts = g.getFaceVertices(faceId);
      if (verts.length < 3) throw new Error('Invalid face for roof');

      // Find the bounding box of the face in XZ
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      let baseY = verts[0].position.y;
      for (const v of verts) {
        minX = Math.min(minX, v.position.x); maxX = Math.max(maxX, v.position.x);
        minZ = Math.min(minZ, v.position.z); maxZ = Math.max(maxZ, v.position.z);
        baseY = Math.max(baseY, v.position.y);
      }

      const widthX = maxX - minX;
      const depthZ = maxZ - minZ;

      // Gable roof along the longer axis
      const ridgeHeight = (Math.min(widthX, depthZ) / 2) * Math.tan(degToRad(pitch));
      const isXLonger = widthX >= depthZ;

      const faceIds: string[] = [];
      const edgeIds: string[] = [];

      if (isXLonger) {
        // Ridge runs along X, gable on Z sides
        const midZ = (minZ + maxZ) / 2;
        const v0 = g.createVertex({ x: minX - overhang, y: baseY, z: minZ - overhang }).id;
        const v1 = g.createVertex({ x: maxX + overhang, y: baseY, z: minZ - overhang }).id;
        const v2 = g.createVertex({ x: maxX + overhang, y: baseY, z: maxZ + overhang }).id;
        const v3 = g.createVertex({ x: minX - overhang, y: baseY, z: maxZ + overhang }).id;
        const r0 = g.createVertex({ x: minX - overhang, y: baseY + ridgeHeight, z: midZ }).id;
        const r1 = g.createVertex({ x: maxX + overhang, y: baseY + ridgeHeight, z: midZ }).id;

        // Ridge edge
        edgeIds.push(g.createEdge(r0, r1).id);
        // Eave edges
        edgeIds.push(g.createEdge(v0, v1).id);
        edgeIds.push(g.createEdge(v2, v3).id);

        // Two slope faces
        faceIds.push(g.createFace([v0, v1, r1, r0]).id); // front slope
        faceIds.push(g.createFace([v2, v3, r0, r1]).id); // back slope
        // Two gable triangles
        faceIds.push(g.createFace([v0, r0, v3]).id); // left gable
        faceIds.push(g.createFace([v1, v2, r1]).id); // right gable

        return { faceIds, edgeIds, vertexIds: [v0, v1, v2, v3, r0, r1] };
      } else {
        // Ridge runs along Z
        const midX = (minX + maxX) / 2;
        const v0 = g.createVertex({ x: minX - overhang, y: baseY, z: minZ - overhang }).id;
        const v1 = g.createVertex({ x: maxX + overhang, y: baseY, z: minZ - overhang }).id;
        const v2 = g.createVertex({ x: maxX + overhang, y: baseY, z: maxZ + overhang }).id;
        const v3 = g.createVertex({ x: minX - overhang, y: baseY, z: maxZ + overhang }).id;
        const r0 = g.createVertex({ x: midX, y: baseY + ridgeHeight, z: minZ - overhang }).id;
        const r1 = g.createVertex({ x: midX, y: baseY + ridgeHeight, z: maxZ + overhang }).id;

        edgeIds.push(g.createEdge(r0, r1).id);
        faceIds.push(g.createFace([v0, v1, r0]).id);
        faceIds.push(g.createFace([v1, v2, r1, r0]).id);
        faceIds.push(g.createFace([v2, v3, r1]).id);
        faceIds.push(g.createFace([v3, v0, r0, r1]).id);

        return { faceIds, edgeIds, vertexIds: [v0, v1, v2, v3, r0, r1] };
      }
    });
  }

  createStairs(start: Vec3, direction: Vec3, riseHeight: number, treadDepth: number, width: number, numSteps: number): ShapeResult {
    return this.transact('Create Stairs', () => {
      const g = this.geo;
      const fwd = vec3.normalize(direction);
      const right = vec3.normalize(vec3.cross(vec3.up(), fwd));
      const halfW = width / 2;
      const allFaces: string[] = [];
      const allEdges: string[] = [];
      const allVerts: string[] = [];

      for (let i = 0; i < numSteps; i++) {
        const baseY = start.y + i * riseHeight;
        const basePos = vec3.add(start, vec3.mul(fwd, i * treadDepth));

        // Each step is a box: treadDepth x riseHeight x width
        const o: Vec3 = {
          x: basePos.x - right.x * halfW,
          y: baseY,
          z: basePos.z - right.z * halfW,
        };

        // 8 corners
        const vids = [
          g.createVertex(vec3.add(o, vec3.add(vec3.mul(right, 0), vec3.mul(fwd, 0)))).id,
          g.createVertex(vec3.add(o, vec3.add(vec3.mul(right, width), vec3.mul(fwd, 0)))).id,
          g.createVertex(vec3.add(o, vec3.add(vec3.mul(right, width), vec3.mul(fwd, treadDepth)))).id,
          g.createVertex(vec3.add(o, vec3.add(vec3.mul(right, 0), vec3.mul(fwd, treadDepth)))).id,
          g.createVertex(vec3.add(o, vec3.add(vec3.add(vec3.mul(right, 0), vec3.mul(fwd, 0)), { x: 0, y: riseHeight, z: 0 }))).id,
          g.createVertex(vec3.add(o, vec3.add(vec3.add(vec3.mul(right, width), vec3.mul(fwd, 0)), { x: 0, y: riseHeight, z: 0 }))).id,
          g.createVertex(vec3.add(o, vec3.add(vec3.add(vec3.mul(right, width), vec3.mul(fwd, treadDepth)), { x: 0, y: riseHeight, z: 0 }))).id,
          g.createVertex(vec3.add(o, vec3.add(vec3.add(vec3.mul(right, 0), vec3.mul(fwd, treadDepth)), { x: 0, y: riseHeight, z: 0 }))).id,
        ];
        allVerts.push(...vids);

        // Edges
        for (let j = 0; j < 4; j++) {
          allEdges.push(g.createEdge(vids[j], vids[(j + 1) % 4]).id);
          allEdges.push(g.createEdge(vids[j + 4], vids[((j + 1) % 4) + 4]).id);
          allEdges.push(g.createEdge(vids[j], vids[j + 4]).id);
        }

        // 6 faces per step
        allFaces.push(g.createFace([vids[3], vids[2], vids[1], vids[0]]).id); // bottom
        allFaces.push(g.createFace([vids[4], vids[5], vids[6], vids[7]]).id); // top (tread)
        for (let j = 0; j < 4; j++) {
          const next = (j + 1) % 4;
          allFaces.push(g.createFace([vids[j], vids[next], vids[next + 4], vids[j + 4]]).id);
        }
      }

      return { faceIds: allFaces, edgeIds: allEdges, vertexIds: allVerts };
    });
  }

  createArch(center: Vec3, radius: number, height: number, thickness: number, segments = 12): ShapeResult {
    return this.transact('Create Arch', () => {
      const g = this.geo;
      const halfT = thickness / 2;
      const faceIds: string[] = [];
      const edgeIds: string[] = [];
      const allVerts: string[] = [];

      // Arch in XY plane, thickness along Z
      const frontVerts: string[] = [];
      const backVerts: string[] = [];

      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI; // 0 to PI (semicircle)
        const x = center.x + radius * Math.cos(angle);
        const y = center.y + radius * Math.sin(angle);

        frontVerts.push(g.createVertex({ x, y, z: center.z - halfT }).id);
        backVerts.push(g.createVertex({ x, y, z: center.z + halfT }).id);
      }
      allVerts.push(...frontVerts, ...backVerts);

      // Front and back arch faces (triangle fans from center)
      // Side quads connecting front to back
      for (let i = 0; i < segments; i++) {
        // Front face quad (approximation — flat strips)
        faceIds.push(g.createFace([frontVerts[i], frontVerts[i + 1], backVerts[i + 1], backVerts[i]]).id);
      }

      // Top surface (extruded arch curve)
      // Inner arch (if height > radius, extend downward)
      const innerFront: string[] = [];
      const innerBack: string[] = [];
      const innerRadius = radius - height;

      if (innerRadius > 0) {
        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI;
          const x = center.x + innerRadius * Math.cos(angle);
          const y = center.y + innerRadius * Math.sin(angle);
          innerFront.push(g.createVertex({ x, y, z: center.z - halfT }).id);
          innerBack.push(g.createVertex({ x, y, z: center.z + halfT }).id);
        }
        allVerts.push(...innerFront, ...innerBack);

        // Inner surface quads
        for (let i = 0; i < segments; i++) {
          faceIds.push(g.createFace([innerFront[i], innerBack[i], innerBack[i + 1], innerFront[i + 1]]).id);
        }

        // Connect outer to inner (front and back faces)
        for (let i = 0; i < segments; i++) {
          faceIds.push(g.createFace([frontVerts[i], innerFront[i], innerFront[i + 1], frontVerts[i + 1]]).id);
          faceIds.push(g.createFace([backVerts[i], backVerts[i + 1], innerBack[i + 1], innerBack[i]]).id);
        }
      }

      return { faceIds, edgeIds, vertexIds: allVerts };
    });
  }

  /** Internal copy without transaction (for use inside other transacted methods) */
  private _copyEntitiesInternal(entityIds: string[], offset: Vec3): ShapeResult {
    const g = this.geo;
    const faceIds: string[] = [];
    const edgeIds: string[] = [];
    const vertexIds: string[] = [];
    const vertexMap = new Map<string, string>();

    const getOrCreateVertex = (oldVid: string): string => {
      if (vertexMap.has(oldVid)) return vertexMap.get(oldVid)!;
      const oldV = g.getVertex(oldVid);
      if (!oldV) throw new Error(`Vertex ${oldVid} not found`);
      const nv = g.createVertex(vec3.add(oldV.position, offset));
      vertexMap.set(oldVid, nv.id);
      vertexIds.push(nv.id);
      return nv.id;
    };

    for (const eid of entityIds) {
      const face = g.getFace(eid);
      if (face) {
        const newVids = face.vertexIds.map(vid => getOrCreateVertex(vid));
        for (let i = 0; i < newVids.length; i++) {
          const next = (i + 1) % newVids.length;
          const existing = g.findEdgeBetween(newVids[i], newVids[next]);
          if (!existing) edgeIds.push(g.createEdge(newVids[i], newVids[next]).id);
        }
        faceIds.push(g.createFace(newVids).id);
        continue;
      }
      const edge = g.getEdge(eid);
      if (edge) {
        const nv1 = getOrCreateVertex(edge.startVertexId);
        const nv2 = getOrCreateVertex(edge.endVertexId);
        edgeIds.push(g.createEdge(nv1, nv2).id);
      }
    }

    return { faceIds, edgeIds, vertexIds };
  }

  // ── Transforms ────────────────────────────────────────────────

  moveEntities(entityIds: string[], offset: Vec3): void {
    this.transact('Move', () => {
      const vids = this.gatherVertices(entityIds);
      for (const vid of vids) {
        const v = this.geo.getVertex(vid);
        if (v) {
          v.position.x += offset.x;
          v.position.y += offset.y;
          v.position.z += offset.z;
        }
      }
    });
  }

  rotateEntities(entityIds: string[], axis: Vec3, angleDeg: number, pivot?: Vec3): void {
    this.transact('Rotate', () => {
      const vids = this.gatherVertices(entityIds);
      const p = pivot || this.computeCentroid(vids);
      const a = vec3.normalize(axis);
      const rad = degToRad(angleDeg);
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      for (const vid of vids) {
        const v = this.geo.getVertex(vid);
        if (!v) continue;
        // Translate to pivot
        const rel = vec3.sub(v.position, p);
        // Rodrigues' rotation formula: v' = v*cos(a) + (k x v)*sin(a) + k*(k.v)*(1-cos(a))
        const cross = vec3.cross(a, rel);
        const dot = vec3.dot(a, rel);
        const rotated = vec3.add(
          vec3.add(vec3.mul(rel, cosA), vec3.mul(cross, sinA)),
          vec3.mul(a, dot * (1 - cosA)),
        );
        const final = vec3.add(rotated, p);
        v.position.x = final.x;
        v.position.y = final.y;
        v.position.z = final.z;
      }
    });
  }

  scaleEntities(entityIds: string[], factor: Vec3, pivot?: Vec3): void {
    this.transact('Scale', () => {
      const vids = this.gatherVertices(entityIds);
      const p = pivot || this.computeCentroid(vids);

      for (const vid of vids) {
        const v = this.geo.getVertex(vid);
        if (!v) continue;
        v.position.x = p.x + (v.position.x - p.x) * factor.x;
        v.position.y = p.y + (v.position.y - p.y) * factor.y;
        v.position.z = p.z + (v.position.z - p.z) * factor.z;
      }
    });
  }

  copyEntities(entityIds: string[], offset: Vec3): ShapeResult {
    return this.transact('Copy', () => {
      const g = this.geo;
      const faceIds: string[] = [];
      const edgeIds: string[] = [];
      const vertexIds: string[] = [];
      const vertexMap = new Map<string, string>(); // old -> new

      const getOrCreateVertex = (oldVid: string): string => {
        if (vertexMap.has(oldVid)) return vertexMap.get(oldVid)!;
        const oldV = g.getVertex(oldVid);
        if (!oldV) throw new Error(`Vertex ${oldVid} not found`);
        const nv = g.createVertex(vec3.add(oldV.position, offset));
        vertexMap.set(oldVid, nv.id);
        vertexIds.push(nv.id);
        return nv.id;
      };

      for (const eid of entityIds) {
        const face = g.getFace(eid);
        if (face) {
          const newVids = face.vertexIds.map(vid => getOrCreateVertex(vid));
          // Create edges for the new face
          for (let i = 0; i < newVids.length; i++) {
            const next = (i + 1) % newVids.length;
            const existing = g.findEdgeBetween(newVids[i], newVids[next]);
            if (!existing) {
              edgeIds.push(g.createEdge(newVids[i], newVids[next]).id);
            }
          }
          faceIds.push(g.createFace(newVids).id);
          continue;
        }
        const edge = g.getEdge(eid);
        if (edge) {
          const nv1 = getOrCreateVertex(edge.startVertexId);
          const nv2 = getOrCreateVertex(edge.endVertexId);
          edgeIds.push(g.createEdge(nv1, nv2).id);
        }
      }

      return { faceIds, edgeIds, vertexIds };
    });
  }

  // ── Deletion ──────────────────────────────────────────────────

  deleteEntities(entityIds: string[]): void {
    this.transact('Delete', () => {
      const g = this.geo;
      for (const id of entityIds) {
        if (g.getFace(id)) g.deleteFace(id, { rememberDeleted: true });
        else if (g.getEdge(id)) g.deleteEdge(id);
        else if (g.getVertex(id)) g.deleteVertex(id);
      }
    });
  }

  // ── Materials ─────────────────────────────────────────────────

  setFaceColor(faceIds: string | string[], r: number, g: number, b: number): string {
    const ids = Array.isArray(faceIds) ? faceIds : [faceIds];
    return this.transact('Set Face Color', () => {
      const mat = this.mat.addMaterial({
        name: `color-${r.toFixed(2)}-${g.toFixed(2)}-${b.toFixed(2)}`,
        color: { r, g, b },
        opacity: 1,
        roughness: 0.5,
        metalness: 0,
      });
      for (const fid of ids) {
        this.mat.applyToFace(fid, mat.id);
      }
      return mat.id;
    });
  }

  setFaceMaterial(faceIds: string | string[], materialId: string): void {
    const ids = Array.isArray(faceIds) ? faceIds : [faceIds];
    this.transact('Apply Material', () => {
      for (const fid of ids) {
        this.mat.applyToFace(fid, materialId);
      }
    });
  }

  createMaterial(name: string, color: Color, options?: { opacity?: number; roughness?: number; metalness?: number }): string {
    return this.transact('Create Material', () => {
      const mat = this.mat.addMaterial({
        name,
        color,
        opacity: options?.opacity ?? 1,
        roughness: options?.roughness ?? 0.5,
        metalness: options?.metalness ?? 0,
      });
      return mat.id;
    });
  }

  listMaterials(): Array<{ id: string; name: string; color: Color }> {
    return this.mat.getAllMaterials().map(m => ({ id: m.id, name: m.name, color: m.color }));
  }

  // ── Queries ───────────────────────────────────────────────────

  measureDistance(a: Vec3, b: Vec3): MeasureResult {
    const d = vec3.sub(b, a);
    return {
      distance: vec3.length(d),
      dx: Math.abs(d.x),
      dy: Math.abs(d.y),
      dz: Math.abs(d.z),
    };
  }

  getFaceInfo(faceId: string): FaceInfo | null {
    const face = this.geo.getFace(faceId);
    if (!face) return null;
    const verts = this.geo.getFaceVertices(faceId);
    return {
      id: faceId,
      area: this.geo.computeFaceArea(faceId),
      normal: this.geo.computeFaceNormal(faceId),
      vertexCount: verts.length,
      vertices: verts.map(v => ({ ...v.position })),
    };
  }

  getSelectedEntities(): EntityInfo {
    const ids = Array.from(this.sel.state.entityIds);
    const faces: string[] = [];
    const edges: string[] = [];
    const vertices: string[] = [];

    for (const id of ids) {
      if (this.geo.getFace(id)) faces.push(id);
      else if (this.geo.getEdge(id)) edges.push(id);
      else if (this.geo.getVertex(id)) vertices.push(id);
    }
    return { faces, edges, vertices };
  }

  getBoundingBox(entityIds?: string[]): BoundingBox {
    if (!entityIds || entityIds.length === 0) return this.geo.getBoundingBox();

    let box = bbox.empty();
    const vids = this.gatherVertices(entityIds);
    for (const vid of vids) {
      const v = this.geo.getVertex(vid);
      if (v) box = bbox.expandByPoint(box, v.position);
    }
    return box;
  }

  getAllFaces(): string[] {
    return Array.from(this.geo.getMesh().faces.keys());
  }

  getAllEdges(): string[] {
    return Array.from(this.geo.getMesh().edges.keys());
  }

  getVertexPosition(vertexId: string): Vec3 | null {
    const v = this.geo.getVertex(vertexId);
    return v ? { ...v.position } : null;
  }

  // ── Selection ─────────────────────────────────────────────────

  select(entityIds: string[]): void {
    this.sel.clear();
    for (const id of entityIds) this.sel.add(id);
  }

  clearSelection(): void {
    this.sel.clear();
  }

  selectAll(): void {
    this.sel.selectAll();
  }

  // ── View ──────────────────────────────────────────────────────

  setView(name: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'): void {
    this.camera.setView(name);
  }

  zoomExtents(): void {
    this.camera.fitToBox(this.geo.getBoundingBox());
  }

  // ── Edge Operations ─────────────────────────────────────────

  chamferEdge(edgeId: string, distance: number): ShapeResult {
    return this.transact('Chamfer Edge', () => {
      const op = new ChamferOperation();
      const result = op.execute(this.geo, { edgeId, distance });
      if (!result.success) throw new Error(result.error || 'Chamfer failed');
      return {
        faceIds: result.chamferFaceId ? [result.chamferFaceId] : [],
        edgeIds: result.newEdgeIds,
        vertexIds: result.newVertexIds,
      };
    });
  }

  filletEdge(edgeId: string, radius: number, segments = 8): ShapeResult {
    return this.transact('Fillet Edge', () => {
      const op = new FilletOperation();
      const result = op.execute(this.geo, { edgeId, radius, segments });
      if (!result.success) throw new Error(result.error || 'Fillet failed');
      return {
        faceIds: result.filletFaceIds,
        edgeIds: result.newEdgeIds,
        vertexIds: result.newVertexIds,
      };
    });
  }

  // ── Face Operations ────────────────────────────────────────

  offsetFace(faceId: string, distance: number): ShapeResult {
    return this.transact('Offset Face', () => {
      const op = new OffsetOperation();
      const result = op.execute(this.geo, { faceId, distance });
      if (!result.success) throw new Error(result.error || 'Offset failed');
      return {
        faceIds: [...result.connectingFaceIds, ...(result.innerFaceId ? [result.innerFaceId] : [])],
        edgeIds: result.newEdgeIds,
        vertexIds: result.newVertexIds,
      };
    });
  }

  subdivideFaces(faceIds: string[], method: 'midpoint' | 'catmull-clark' = 'midpoint', iterations = 1): ShapeResult {
    return this.transact('Subdivide', () => {
      const op = new SubdivideOperation();
      const result = op.execute(this.geo, { faceIds, method, iterations });
      if (!result.success) throw new Error(result.error || 'Subdivide failed');
      return {
        faceIds: result.newFaceIds,
        edgeIds: result.newEdgeIds,
        vertexIds: result.newVertexIds,
      };
    });
  }

  triangulateFaces(faceIds: string[]): ShapeResult {
    return this.transact('Triangulate', () => {
      const op = new TriangulateOperation();
      const result = op.execute(this.geo, { faceIds });
      if (!result.success) throw new Error(result.error || 'Triangulate failed');
      return {
        faceIds: result.newFaceIds,
        edgeIds: result.newEdgeIds,
        vertexIds: [],
      };
    });
  }

  // ── Sweep ──────────────────────────────────────────────────

  sweep(profileFaceId: string, pathEdgeIds: string[], alignToPath = true): ShapeResult {
    return this.transact('Sweep', () => {
      const op = new SweepOperation();
      const result = op.execute(this.geo, { profileFaceId, pathEdgeIds, alignToPath });
      if (!result.success) throw new Error(result.error || 'Sweep failed');
      return {
        faceIds: result.newFaceIds,
        edgeIds: result.newEdgeIds,
        vertexIds: result.newVertexIds,
      };
    });
  }

  // ── Boolean CSG ────────────────────────────────────────────

  private buildRegion(entityIds: string[]): MeshRegion {
    const faceIds: string[] = [];
    const edgeIds: string[] = [];
    const vertexIds: string[] = [];
    const vids = new Set<string>();
    for (const id of entityIds) {
      const face = this.geo.getFace(id);
      if (face) {
        faceIds.push(id);
        for (const vid of face.vertexIds) vids.add(vid);
        const faceEdges = this.geo.getFaceEdges(id);
        for (const e of faceEdges) edgeIds.push(e.id);
        continue;
      }
      const edge = this.geo.getEdge(id);
      if (edge) {
        edgeIds.push(id);
        vids.add(edge.startVertexId);
        vids.add(edge.endVertexId);
      }
    }
    vertexIds.push(...vids);
    return { faceIds, edgeIds, vertexIds };
  }

  // @archigraph calls|api.model|native.manifold|runtime
  async booleanUnion(regionAIds: string[], regionBIds: string[]): Promise<ShapeResult> {
    this.hist.beginTransaction('Boolean Union');
    try {
      const op = new BooleanUnion();
      const result = await op.execute(this.geo, {
        regionA: this.buildRegion(regionAIds),
        regionB: this.buildRegion(regionBIds),
      });
      if (!result.success) throw new Error(result.error || 'Boolean union failed');
      this.hist.commitTransaction();
      this.syncScene();
      return { faceIds: result.newFaceIds, edgeIds: result.newEdgeIds, vertexIds: result.newVertexIds };
    } catch (e) {
      this.hist.abortTransaction();
      throw e;
    }
  }

  async booleanSubtract(regionAIds: string[], regionBIds: string[]): Promise<ShapeResult> {
    this.hist.beginTransaction('Boolean Subtract');
    try {
      const op = new BooleanSubtract();
      const result = await op.execute(this.geo, {
        regionA: this.buildRegion(regionAIds),
        regionB: this.buildRegion(regionBIds),
      });
      if (!result.success) throw new Error(result.error || 'Boolean subtract failed');
      this.hist.commitTransaction();
      this.syncScene();
      return { faceIds: result.newFaceIds, edgeIds: result.newEdgeIds, vertexIds: result.newVertexIds };
    } catch (e) {
      this.hist.abortTransaction();
      throw e;
    }
  }

  async booleanIntersect(regionAIds: string[], regionBIds: string[]): Promise<ShapeResult> {
    this.hist.beginTransaction('Boolean Intersect');
    try {
      const op = new BooleanIntersect();
      const result = await op.execute(this.geo, {
        regionA: this.buildRegion(regionAIds),
        regionB: this.buildRegion(regionBIds),
      });
      if (!result.success) throw new Error(result.error || 'Boolean intersect failed');
      this.hist.commitTransaction();
      this.syncScene();
      return { faceIds: result.newFaceIds, edgeIds: result.newEdgeIds, vertexIds: result.newVertexIds };
    } catch (e) {
      this.hist.abortTransaction();
      throw e;
    }
  }

  // ── Advanced Queries ───────────────────────────────────────

  getEdgeInfo(edgeId: string): EdgeInfo | null {
    const edge = this.geo.getEdge(edgeId);
    if (!edge) return null;
    const v1 = this.geo.getVertex(edge.startVertexId);
    const v2 = this.geo.getVertex(edge.endVertexId);
    if (!v1 || !v2) return null;
    const adjacentFaces = this.geo.getEdgeFaces(edgeId);
    return {
      id: edgeId,
      length: this.geo.computeEdgeLength(edgeId),
      startVertex: { ...v1.position },
      endVertex: { ...v2.position },
      midpoint: {
        x: (v1.position.x + v2.position.x) / 2,
        y: (v1.position.y + v2.position.y) / 2,
        z: (v1.position.z + v2.position.z) / 2,
      },
      adjacentFaceIds: adjacentFaces.map(f => f.id),
    };
  }

  getConnectedFaces(faceId: string): string[] {
    return this.geo.getConnectedFaces(faceId).map(f => f.id);
  }

  getEdgeFaces(edgeId: string): string[] {
    return this.geo.getEdgeFaces(edgeId).map(f => f.id);
  }

  // ── Section Plane ──────────────────────────────────────────

  setSectionPlane(point: Vec3, normal: Vec3): void {
    if (this.viewport) {
      this.viewport.renderer.setSectionPlane({ point, normal: vec3.normalize(normal) });
    }
  }

  clearSectionPlane(): void {
    if (this.viewport) {
      this.viewport.renderer.setSectionPlane(null);
    }
  }

  // ── Groups ────────────────────────────────────────────────────

  createGroup(name: string, entityIds: string[]): string {
    return this.transact('Create Group', () => {
      const group = this.doc.scene.createGroup(name, entityIds);
      return group.id;
    });
  }

  // ── Import ────────────────────────────────────────────────────

  importGeometry(vertices: Vec3[], faces: number[][]): { vertexIds: string[]; faceIds: string[] } {
    return this.transact('Import Geometry', () => {
      return this.geo.bulkImport(vertices, faces);
    });
  }

  // ── Batch ─────────────────────────────────────────────────────

  batch(name: string, fn: (api: IModelAPI) => void): void {
    this.hist.beginTransaction(name);
    this.inBatch = true;
    try {
      fn(this);
      this.inBatch = false;
      this.hist.commitTransaction();
      this.syncScene();
    } catch (e) {
      this.inBatch = false;
      this.hist.abortTransaction();
      throw e;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Collect unique vertex IDs from a set of face/edge/vertex entity IDs. */
  private gatherVertices(entityIds: string[]): Set<string> {
    const vids = new Set<string>();
    const g = this.geo;
    for (const id of entityIds) {
      const face = g.getFace(id);
      if (face) {
        for (const vid of face.vertexIds) vids.add(vid);
        continue;
      }
      const edge = g.getEdge(id);
      if (edge) {
        vids.add(edge.startVertexId);
        vids.add(edge.endVertexId);
        continue;
      }
      if (g.getVertex(id)) vids.add(id);
    }
    return vids;
  }

  /** Compute centroid of a set of vertex IDs. */
  private computeCentroid(vids: Set<string>): Vec3 {
    let sum = vec3.zero();
    let count = 0;
    for (const vid of vids) {
      const v = this.geo.getVertex(vid);
      if (v) {
        sum = vec3.add(sum, v.position);
        count++;
      }
    }
    return count > 0 ? vec3.div(sum, count) : vec3.zero();
  }
}
