// @archigraph tool.rotate
// classic CAD copy arrays: Ctrl/Cmd+Rotate rotates a COPY; typing xN right
// after builds a radial array around the same center/axis.
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, resetToolState } from './helpers';
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

async function faceCount(): Promise<number> {
  return page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    return appRef.document.geometry.getMesh().faces.size;
  });
}

test('Cmd+Rotate copies, then 4x builds a radial array', async () => {
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Small rectangle left of center
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 180, cy - 30);
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 120, cy + 30);
  await page.waitForTimeout(300);
  expect(await faceCount()).toBe(1);

  // Select the face
  await resetToolState(page);
  await page.mouse.click(cx - 150, cy);
  await page.waitForTimeout(300);

  // Rotate tool; Cmd+click sets the center AND switches to copy mode
  await page.keyboard.press('q');
  await page.waitForTimeout(300);
  await page.keyboard.down('Meta');
  await page.mouse.click(cx, cy); // rotation center right of the rect
  await page.keyboard.up('Meta');
  await page.waitForTimeout(300);

  // Start-angle reference, then commit at ~90°
  await page.mouse.click(cx - 150, cy);
  await page.waitForTimeout(200);
  await page.mouse.move(cx, cy - 150);
  await page.waitForTimeout(200);
  await page.mouse.click(cx, cy - 150);
  await page.waitForTimeout(400);

  // Original + rotated copy
  expect(await faceCount()).toBe(2);

  // Radial array: 4 total copies around the center
  const vcb = page.locator('.vcb-input');
  await vcb.click();
  await vcb.fill('4x');
  await vcb.press('Enter');
  await page.waitForTimeout(500);

  // Original + 4 copies
  expect(await faceCount()).toBe(5);

  // All five faces have (nearly) the same area — pure rotations
  const areas = await page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    const geo = appRef.document.geometry;
    return [...appRef.document.geometry.getMesh().faces.keys()]
      .map((fid: string) => geo.computeFaceArea(fid));
  });
  const first = areas[0];
  for (const a of areas) expect(Math.abs(a - first)).toBeLessThan(0.01);
});
