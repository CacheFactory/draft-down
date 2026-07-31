// @archigraph core-units
// Typed VCB measurements honor unit suffixes: a rectangle entered as
// 8'10", 21' must come out 8ft10in × 21ft in world units (meters) —
// not 8×21 of the current document unit.
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

test('rectangle typed as 8\'10", 21\' creates feet+inches dimensions', async () => {
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');

  await page.keyboard.press('r');
  await page.waitForTimeout(200);

  // Anchor the first corner, then type exact dimensions with unit suffixes
  await page.mouse.click(box.x + box.width / 2 - 100, box.y + box.height / 2 - 80);
  await page.waitForTimeout(200);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);

  const vcb = page.locator('.vcb-input');
  await vcb.click();
  await vcb.fill(`8'10", 21'`);
  await vcb.press('Enter');
  await page.waitForTimeout(400);

  const dims = await page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    const mesh = appRef.document.geometry.getMesh();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of mesh.vertices.values()) {
      minX = Math.min(minX, v.position.x); maxX = Math.max(maxX, v.position.x);
      minZ = Math.min(minZ, v.position.z); maxZ = Math.max(maxZ, v.position.z);
    }
    return { w: maxX - minX, h: maxZ - minZ, faces: mesh.faces.size };
  });
  console.log('typed-dimensions result:', JSON.stringify(dims));

  expect(dims.faces).toBe(1);
  const expected = [8 * 0.3048 + 10 * 0.0254, 21 * 0.3048].sort((a, b) => a - b);
  const actual = [dims.w, dims.h].sort((a, b) => a - b);
  expect(actual[0]).toBeCloseTo(expected[0], 3); // 2.6924 m
  expect(actual[1]).toBeCloseTo(expected[1], 3); // 6.4008 m
});
