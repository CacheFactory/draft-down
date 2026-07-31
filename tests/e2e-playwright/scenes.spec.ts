// @archigraph window.main
// Scene tabs: add captures the camera; clicking a tab animates back to it.
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

test('scene tab restores its captured camera', async () => {
  // Go to Top view, capture as Scene 1
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(800);
  const camTop = await page.evaluate(() => {
    const cam = (window as any).__debugApp.viewport.camera;
    return { position: { ...cam.position }, target: { ...cam.target } };
  });
  await page.locator('.scene-tab.add').click();
  await page.waitForTimeout(200);
  await expect(page.locator('.scene-tab:has-text("Scene 1")')).toBeVisible();

  // Switch to Iso view (different camera)
  await page.locator('.views-toolbar .view-btn:has-text("Iso")').click();
  await page.waitForTimeout(800);
  const camIso = await page.evaluate(() => {
    const cam = (window as any).__debugApp.viewport.camera;
    return { position: { ...cam.position } };
  });
  expect(Math.abs(camIso.position.x - camTop.position.x) +
         Math.abs(camIso.position.y - camTop.position.y)).toBeGreaterThan(1);

  // Click Scene 1 — camera animates back to the captured pose
  await page.locator('.scene-tab:has-text("Scene 1")').click();
  await page.waitForTimeout(1200); // wait out the animation

  const camRestored = await page.evaluate(() => {
    const cam = (window as any).__debugApp.viewport.camera;
    return { position: { ...cam.position }, target: { ...cam.target } };
  });
  expect(camRestored.position.x).toBeCloseTo(camTop.position.x, 3);
  expect(camRestored.position.y).toBeCloseTo(camTop.position.y, 3);
  expect(camRestored.position.z).toBeCloseTo(camTop.position.z, 3);
});
