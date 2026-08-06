// Regression: point snapping on dense meshes in zoomed-out orthographic views.
// The snap pre-filter's world radius must account for ortho zoom (frustum
// size), not camera distance — with the old perspective-only heuristic,
// vertices near the view center were filtered out and the On-Edge snap
// produced near-corner (but off-corner) points: "lines drawn near the
// points but not exactly on them."
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let box: { x: number; y: number; width: number; height: number };

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
  box = (await page.locator('.viewport-container canvas').boundingBox())!;
});
test.afterAll(async () => { await closeApp(app); });

test('vertex near view center snaps exactly at site-plan zoom', async () => {
  await page.evaluate(() => {
    const a = (window as any).__debugApp;
    const geo = a.document.geometry;
    for (let i = 0; i < 1300; i++) {
      const x = (i % 50) * 5 - 125, z = Math.floor(i / 50) * 8 - 100;
      const v1 = geo.createVertex({ x, y: 0, z });
      const v2 = geo.createVertex({ x: x + 2, y: 0, z: z + 2 });
      try { geo.createEdge(v1.id, v2.id); } catch {}
    }
    a.syncScene();
  });

  await page.click('.views-toolbar >> text=Top');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const c = (window as any).__debugApp.viewport.camera;
    (c as any)._orthoSize = 150;
    (c as any)._syncCameras();
  });
  await page.waitForTimeout(300);

  await page.locator('.viewport-container').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('l');
  await page.waitForTimeout(200);

  // Vertex (10,0,4): near the view center (the old filter's kill zone),
  // outside the origin snap's enlarged radius.
  const p = await page.evaluate(() => (window as any).__debugApp.viewport.worldToScreen({ x: 10, y: 0, z: 4 }));
  await page.mouse.move(box.x + p.x + 100, box.y + p.y + 100);
  await page.waitForTimeout(150);
  await page.mouse.move(box.x + p.x - 3, box.y + p.y - 1);
  await page.waitForTimeout(300);

  const kind = await page.evaluate(() => (window as any).__debugApp.sceneBridge.getLastSnapKind?.());
  expect(kind).toBe('vertex');

  // Click and verify the committed line endpoint is EXACTLY the vertex
  await page.mouse.click(box.x + p.x - 3, box.y + p.y - 1);
  await page.waitForTimeout(200);
  const p2 = await page.evaluate(() => (window as any).__debugApp.viewport.worldToScreen({ x: 30, y: 0, z: 20 }));
  await page.mouse.click(box.x + p2.x + 2, box.y + p2.y + 9); // free-ish second point
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const near = await page.evaluate(() => {
    const m = (window as any).__debugApp.document.geometry.getMesh();
    return [...m.vertices.values()].map((v: any) => ({ ...v.position }))
      .filter((v: any) => Math.hypot(v.x - 10, v.y, v.z - 4) < 1.9);
  });
  expect(near.length).toBe(1); // only the original vertex — endpoint welded exactly
  expect(Math.hypot(near[0].x - 10, near[0].z - 4)).toBeLessThan(1e-9);
});
