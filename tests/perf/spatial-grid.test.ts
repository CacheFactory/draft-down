// @archigraph engine.geometry
// Spatial grid: large-model draw-time scans stay fast AND correct — the
// grid path must find the same crossings the brute-force path finds.

import { GeometryEngine } from '../../implementations/engine.geometry/GeometryEngine';

/** Build a big grid of loose horizontal edges fast (no faces — keeps
 *  face-machinery out of the timing). */
function buildEdgeField(e: GeometryEngine, rows: number, cols: number): void {
  const mesh = e.getInternalMesh();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = mesh.addVertex({ x: c * 2, y: 0, z: r * 2 });
      const b = mesh.addVertex({ x: c * 2 + 1.2, y: 0, z: r * 2 });
      mesh.addEdge(a.id, b.id);
    }
  }
}

test('grid path finds the same crossings as brute force', () => {
  // Small model (brute force path)
  const small = new GeometryEngine();
  buildEdgeField(small, 10, 10); // 100 edges — brute force
  const s1 = small.createVertex({ x: -1, y: 0, z: 4 });
  const s2 = small.createVertex({ x: 21, y: 0, z: 4 });
  const smallEdges = small.createEdgeWithIntersection(s1.id, s2.id);

  // Large model (grid path) — same local structure, plus padding far away
  const large = new GeometryEngine();
  buildEdgeField(large, 10, 10);
  // Pad with edges far away to push past GRID_THRESHOLD
  const mesh = large.getInternalMesh();
  for (let i = 0; i < 2100; i++) {
    const a = mesh.addVertex({ x: 1000 + i, y: 0, z: 1000 });
    const b = mesh.addVertex({ x: 1000.5 + i, y: 0, z: 1000 });
    mesh.addEdge(a.id, b.id);
  }
  expect(mesh.edges.size).toBeGreaterThan(2000);

  const l1 = large.createVertex({ x: -1, y: 0, z: 4 });
  const l2 = large.createVertex({ x: 21, y: 0, z: 4 });
  const largeEdges = large.createEdgeWithIntersection(l1.id, l2.id);

  // The drawn line crosses row z=4 (row index 2) — 10 horizontal edges —
  // so it splits into the same number of chained segments on both paths.
  expect(largeEdges.length).toBe(smallEdges.length);
  expect(largeEdges.length).toBeGreaterThan(10); // crossed all 10 edges
});

test('draw across a 20k-edge model completes fast', () => {
  const e = new GeometryEngine();
  buildEdgeField(e, 100, 200); // 20 000 edges
  const mesh = e.getInternalMesh();
  expect(mesh.edges.size).toBe(20000);

  const a = e.createVertex({ x: -1, y: 0, z: 100 });
  const b = e.createVertex({ x: 30, y: 0, z: 100 });

  // Warm the index — it rebuilds lazily at most every 500ms during
  // interaction, so steady-state draws don't pay the build cost.
  (e as any).spatialGrid.ensureFresh(e.getInternalMesh());

  const t0 = performance.now();
  e.createEdgeWithIntersection(a.id, b.id);
  const dt = performance.now() - t0;
  console.log(`createEdgeWithIntersection over 20k edges (warm index): ${dt.toFixed(1)}ms`);
  // Brute force here was O(edges × splits) plus a full vertex scan per
  // crossing — multi-second at this size. The bound guards the complexity
  // class, with headroom for parallel-jest load variance.
  expect(dt).toBeLessThan(600);
});
