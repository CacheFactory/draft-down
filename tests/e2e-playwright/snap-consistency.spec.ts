// @archigraph system.snap
// The snap indicator and the placed geometry must agree: clicking while a
// hard snap is shown must put the vertex EXACTLY at the snapped point.
// Regression: shape tools resolved the sizing point with a raw plane raycast,
// so a corner clicked a few pixels off an endpoint landed beside it instead
// of on it (near-duplicate vertices, unmerged geometry).
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

test('rectangle second corner snapped to an endpoint lands exactly on it', async () => {
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.keyboard.press('r');
  await page.waitForTimeout(200);

  // Rectangle A
  await page.mouse.click(cx - 150, cy - 120);
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 30, cy - 20);
  await page.waitForTimeout(300);

  const cornerCountNear = () => page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    const mesh = appRef.document.geometry.getMesh();
    // A's second corner is the vertex with max (x+z)… instead just return all
    // vertex positions; assertion logic lives in the test.
    const verts: Array<{ x: number; y: number; z: number }> = [];
    for (const v of mesh.vertices.values()) verts.push({ ...v.position });
    return verts;
  });

  const vertsA = await cornerCountNear();
  expect(vertsA.length).toBe(4);

  // Rectangle B: first corner in open space, second corner clicked 6px OFF
  // A's corner at (cx-30, cy-20) — inside the 15px snap radius, so the
  // indicator shows Endpoint. The committed corner must BE that endpoint.
  await page.mouse.click(cx + 90, cy + 90);
  await page.waitForTimeout(200);
  await page.mouse.move(cx - 30 + 6, cy - 20 + 6);
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 30 + 6, cy - 20 + 6);
  await page.waitForTimeout(300);

  const vertsB = await cornerCountNear();
  console.log('vertices after snap-click:', vertsB.length);

  // The snapped corner reuses A's corner vertex: 4 (A) + 3 new (B) = 7.
  // A miss produces 8 vertices, two of them a few px apart.
  expect(vertsB.length).toBe(7);

  // And no near-duplicate pair anywhere (the classic symptom of the bug).
  let minPairDist = Infinity;
  for (let i = 0; i < vertsB.length; i++) {
    for (let j = i + 1; j < vertsB.length; j++) {
      const dx = vertsB[i].x - vertsB[j].x;
      const dy = vertsB[i].y - vertsB[j].y;
      const dz = vertsB[i].z - vertsB[j].z;
      minPairDist = Math.min(minPairDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  console.log('min vertex pair distance:', minPairDist);
  expect(minPairDist).toBeGreaterThan(0.2);
});
