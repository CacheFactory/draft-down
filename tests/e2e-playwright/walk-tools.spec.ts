// @archigraph tool.walk
// Camera walk tools: Position Camera stands at eye height; Look Around
// rotates in place; Walk advances at constant eye height.
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

async function camera() {
  return page.evaluate(() => {
    const cam = (window as any).__debugApp.viewport.camera;
    return { position: { ...cam.position }, target: { ...cam.target } };
  });
}

test('Position Camera stands at eye height; Walk keeps it; Look rotates in place', async () => {
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Position Camera: click the ground near center
  await page.locator('.sidebar-tool-btn[title*="Place"], button:has-text("Place")').first().click();
  await page.waitForTimeout(300);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  const posed = await camera();
  expect(posed.position.y).toBeCloseTo(1.68, 2); // default eye height
  expect(posed.target.y).toBeCloseTo(1.68, 2);   // looking horizontally

  // Look Around: drag — eye must NOT move, target must
  await page.locator('button:has-text("Look")').first().click();
  await page.waitForTimeout(300);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const looked = await camera();
  expect(looked.position.x).toBeCloseTo(posed.position.x, 6);
  expect(looked.position.y).toBeCloseTo(posed.position.y, 6);
  expect(looked.position.z).toBeCloseTo(posed.position.z, 6);
  const targetMoved = Math.abs(looked.target.x - posed.target.x) +
                      Math.abs(looked.target.z - posed.target.z);
  expect(targetMoved).toBeGreaterThan(0.5);

  // Walk: drag up = forward; eye height constant, position changes
  await page.locator('button:has-text("Walk")').first().click();
  await page.waitForTimeout(300);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 120, { steps: 4 });
  await page.waitForTimeout(600); // walking animates on rAF while held
  await page.mouse.up();
  await page.waitForTimeout(300);

  const walked = await camera();
  expect(walked.position.y).toBeCloseTo(looked.position.y, 4); // height held
  const moved = Math.abs(walked.position.x - looked.position.x) +
                Math.abs(walked.position.z - looked.position.z);
  expect(moved).toBeGreaterThan(0.3);
});
