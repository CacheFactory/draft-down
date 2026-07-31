// @archigraph window.main
// Starter component library: parametric geometry snippets built at the
// origin (Y-up, meters). Placed items become component instances so
// repeated placements share a family.

import type { Vec3 } from '../../src/core/types';

export interface LibraryItemDef {
  id: string;
  name: string;
  icon: string;
  vertices: Vec3[];
  /** Faces as vertex-index rings. */
  faces: number[][];
  /** Extra loose edges as vertex-index pairs (faces imply their own). */
  edges: Array<[number, number]>;
}

function box(w: number, h: number, d: number, x0 = 0, y0 = 0, z0 = 0): { vertices: Vec3[]; faces: number[][] } {
  const v: Vec3[] = [
    { x: x0, y: y0, z: z0 }, { x: x0 + w, y: y0, z: z0 },
    { x: x0 + w, y: y0, z: z0 + d }, { x: x0, y: y0, z: z0 + d },
    { x: x0, y: y0 + h, z: z0 }, { x: x0 + w, y: y0 + h, z: z0 },
    { x: x0 + w, y: y0 + h, z: z0 + d }, { x: x0, y: y0 + h, z: z0 + d },
  ];
  const f = [
    [0, 3, 2, 1], [4, 5, 6, 7], // bottom, top
    [0, 1, 5, 4], [2, 3, 7, 6], // front, back
    [1, 2, 6, 5], [3, 0, 4, 7], // right, left
  ];
  return { vertices: v, faces: f };
}

function merge(parts: Array<{ vertices: Vec3[]; faces: number[][] }>): { vertices: Vec3[]; faces: number[][] } {
  const vertices: Vec3[] = [];
  const faces: number[][] = [];
  for (const p of parts) {
    const off = vertices.length;
    vertices.push(...p.vertices);
    for (const f of p.faces) faces.push(f.map(i => i + off));
  }
  return { vertices, faces };
}

function makeDoor(): LibraryItemDef {
  // 0.9 × 2.1 door leaf, 40mm thick, with a small handle block
  const leaf = box(0.9, 2.1, 0.04);
  const handle = box(0.04, 0.12, 0.06, 0.78, 0.95, 0.04);
  const merged = merge([leaf, handle]);
  return { id: 'lib-door', name: 'Door', icon: '🚪', ...merged, edges: [] };
}

function makeWindow(): LibraryItemDef {
  // 1.2 × 1.2 window: outer frame slab with a mullion cross of edges
  const frame = box(1.2, 1.2, 0.06);
  const def: LibraryItemDef = { id: 'lib-window', name: 'Window', icon: '🪟', ...frame, edges: [] };
  // Mullion cross on the front face
  const n = def.vertices.length;
  def.vertices.push(
    { x: 0.6, y: 0, z: 0 }, { x: 0.6, y: 1.2, z: 0 },
    { x: 0, y: 0.6, z: 0 }, { x: 1.2, y: 0.6, z: 0 },
  );
  def.edges.push([n, n + 1], [n + 2, n + 3]);
  return def;
}

function makePerson(): LibraryItemDef {
  // Flat 1.75m scale figure (classic CAD tradition): simple silhouette polygon
  const pts: Array<[number, number]> = [
    [0.22, 0], [0.34, 0], [0.36, 0.85], [0.42, 0.9], [0.44, 1.35],
    [0.36, 1.42], [0.38, 1.52], [0.33, 1.62], [0.23, 1.62], [0.18, 1.52],
    [0.20, 1.42], [0.12, 1.35], [0.14, 0.9], [0.20, 0.85],
  ];
  const vertices: Vec3[] = pts.map(([x, y]) => ({ x, y, z: 0 }));
  return {
    id: 'lib-person', name: 'Person (scale)', icon: '🧍',
    vertices,
    faces: [vertices.map((_, i) => i)],
    edges: [],
  };
}

function makeTable(): LibraryItemDef {
  const top = box(1.4, 0.04, 0.8, 0, 0.71, 0);
  const leg = 0.05;
  const legs = [
    box(leg, 0.71, leg, 0.02, 0, 0.02),
    box(leg, 0.71, leg, 1.33, 0, 0.02),
    box(leg, 0.71, leg, 1.33, 0, 0.73),
    box(leg, 0.71, leg, 0.02, 0, 0.73),
  ];
  const merged = merge([top, ...legs]);
  return { id: 'lib-table', name: 'Table', icon: '🪑', ...merged, edges: [] };
}

function makeStep(): LibraryItemDef {
  // Three-riser stair block
  const steps = [
    box(1.0, 0.17, 0.28, 0, 0, 0),
    box(1.0, 0.17, 0.28, 0, 0.17, 0.28),
    box(1.0, 0.17, 0.28, 0, 0.34, 0.56),
  ];
  const merged = merge(steps);
  return { id: 'lib-stairs', name: 'Steps', icon: '🪜', ...merged, edges: [] };
}

export const STARTER_LIBRARY: LibraryItemDef[] = [
  makeDoor(),
  makeWindow(),
  makePerson(),
  makeTable(),
  makeStep(),
];
