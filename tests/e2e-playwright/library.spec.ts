// @archigraph window.main
// Component library: clicking a starter item attaches it to the cursor;
// clicking places it as a component instance.
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

test('placing a Door from the library creates a component', async () => {
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Open the Components panel and click Door
  await page.locator('.library-panel .panel-header').click();
  await page.waitForTimeout(200);
  await page.locator('.library-item', { hasText: 'Door' }).click();
  await page.waitForTimeout(300);

  // The Move tool is in placement mode; click to place
  const toolId = await page.evaluate(() =>
    (window as any).__debugApp.toolManager.getActiveTool()?.id);
  expect(toolId).toBe('tool.move');
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(200);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    return {
      components: a.document.scene.components.size,
      faces: a.document.geometry.getMesh().faces.size,
    };
  });
  console.log('after placement:', JSON.stringify(state));
  expect(state.components).toBe(1);
  // Door = leaf box (6 faces) + handle box (6 faces)
  expect(state.faces).toBeGreaterThanOrEqual(12);

  // Escape during a SECOND placement aborts cleanly
  await page.locator('.library-item', { hasText: 'Table' }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    return { components: a.document.scene.components.size };
  });
  expect(after.components).toBe(1); // table aborted, door remains
});
