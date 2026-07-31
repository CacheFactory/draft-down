// @archigraph system.autoface
// classic CAD coplanar merge through the real UI: two overlapping rectangles
// drawn on the ground plane must produce THREE disjoint faces (A-only,
// overlap, B-only) — never stacked/overlapping faces.
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

test('Two overlapping rectangles merge into 3 disjoint faces', async () => {
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
  await page.mouse.click(cx - 120, cy - 100);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 20, cy + 20);
  await page.waitForTimeout(300);

  // Rectangle B overlapping A's lower-right corner
  await page.mouse.click(cx - 50, cy - 40);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 120, cy + 100);
  await page.waitForTimeout(300);

  const stats = await page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    const geo = appRef.document.geometry;
    const mesh = geo.getMesh();
    const areas: number[] = [];
    for (const faceId of mesh.faces.keys()) {
      areas.push(geo.computeFaceArea(faceId));
    }
    return { faceCount: mesh.faces.size, areas: areas.sort((a: number, b: number) => a - b) };
  });
  console.log('Overlap draw result:', JSON.stringify(stats));

  // A-only, A∩B, B-only — the buggy behavior produced 6 stacked faces.
  expect(stats.faceCount).toBe(3);
});
