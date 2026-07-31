// @archigraph native.manifold
// Solid tools: the native:boolean IPC runs real Manifold WASM in the main
// process. Volumes prove the CSG is correct, not a passthrough.
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await closeApp(app);
});

function cubeSpec(size: number, off: [number, number, number]): string {
  return JSON.stringify({ size, off });
}

test('union/subtract/intersect via Manifold produce correct volumes', async () => {
  const volumes = await page.evaluate(async () => {
    const cube = (s: number, o: { x: number; y: number; z: number }) => {
      const v = [
        { x: o.x, y: o.y, z: o.z }, { x: o.x + s, y: o.y, z: o.z },
        { x: o.x + s, y: o.y + s, z: o.z }, { x: o.x, y: o.y + s, z: o.z },
        { x: o.x, y: o.y, z: o.z + s }, { x: o.x + s, y: o.y, z: o.z + s },
        { x: o.x + s, y: o.y + s, z: o.z + s }, { x: o.x, y: o.y + s, z: o.z + s },
      ];
      const faces = [
        [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
        [1, 2, 6], [1, 6, 5], [3, 0, 4], [3, 4, 7],
      ];
      return { vertices: v, faces };
    };
    const volume = (mesh: any) => {
      let vol = 0;
      for (const [a, b, c] of mesh.faces) {
        const p = mesh.vertices[a], q = mesh.vertices[b], r = mesh.vertices[c];
        vol += (p.x * (q.y * r.z - q.z * r.y) -
                p.y * (q.x * r.z - q.z * r.x) +
                p.z * (q.x * r.y - q.y * r.x)) / 6;
      }
      return Math.abs(vol);
    };

    const A = cube(2, { x: 0, y: 0, z: 0 });
    const B = cube(2, { x: 1, y: 1, z: 1 });
    const api = (window as any).api;
    const u = await api.invoke('native:boolean', { op: 'union', meshA: A, meshB: B });
    const s = await api.invoke('native:boolean', { op: 'subtract', meshA: A, meshB: B });
    const i = await api.invoke('native:boolean', { op: 'intersect', meshA: A, meshB: B });
    const check = await api.invoke('native:solid-check', { mesh: A });
    return {
      ok: u.ok && s.ok && i.ok,
      union: volume(u.mesh),
      subtract: volume(s.mesh),
      intersect: volume(i.mesh),
      isSolid: check.isSolid,
      cubeVolume: check.volume,
    };
  });

  console.log('booleans:', JSON.stringify(volumes));
  expect(volumes.ok).toBe(true);
  expect(volumes.union).toBeCloseTo(15, 4);     // 8 + 8 − 1
  expect(volumes.subtract).toBeCloseTo(7, 4);   // 8 − 1
  expect(volumes.intersect).toBeCloseTo(1, 4);
  expect(volumes.isSolid).toBe(true);
  expect(volumes.cubeVolume).toBeCloseTo(8, 4);
});
