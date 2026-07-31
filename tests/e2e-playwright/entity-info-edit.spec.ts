// @archigraph window.main
// Entity Info: typing an exact length resizes the selected edge (about its
// midpoint), honoring unit expressions.
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

test('editing edge length in Entity Info resizes the edge exactly', async () => {
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Draw a loose line
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 100, cy);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 60, cy);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Select it
  await resetToolState(page);
  await page.mouse.click(cx - 20, cy);
  await page.waitForTimeout(400);

  const input = page.locator('.entity-info-panel .prop-input, .prop-input').first();
  await expect(input).toBeVisible();
  await input.fill('2.5m');
  await input.press('Enter');
  await page.waitForTimeout(400);

  const length = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    const geo = a.document.geometry;
    const ids = [...a.document.selection.state.entityIds];
    return geo.computeEdgeLength(ids[0]);
  });
  expect(length).toBeCloseTo(2.5, 6);
});
