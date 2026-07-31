// @archigraph viewport.main
// classic CAD mouse parity: middle-drag orbits (pivot under cursor) and
// Shift+middle pans — from ANY active tool, without leaving it.
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

test('middle-drag orbits and Shift+middle pans while the Line tool stays active', async () => {
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.keyboard.press('l');
  await page.waitForTimeout(200);

  const before = await page.evaluate(() => {
    const c = (window as any).__debugApp.viewport.camera;
    return { position: { ...c.position }, target: { ...c.target } };
  });

  // Middle-drag = orbit
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 100, cy + 40, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(200);

  const afterOrbit = await page.evaluate(() => {
    const c = (window as any).__debugApp.viewport.camera;
    return { position: { ...c.position } };
  });
  const orbitMoved = Math.abs(afterOrbit.position.x - before.position.x) +
                     Math.abs(afterOrbit.position.z - before.position.z);
  expect(orbitMoved).toBeGreaterThan(0.5);

  // Shift+middle = pan (target moves with the camera)
  await page.keyboard.down('Shift');
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx - 80, cy - 40, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);

  const afterPan = await page.evaluate(() => {
    const c = (window as any).__debugApp.viewport.camera;
    return { target: { ...c.target } };
  });
  const panMoved = Math.abs(afterPan.target.x - before.target.x) +
                   Math.abs(afterPan.target.y - before.target.y) +
                   Math.abs(afterPan.target.z - before.target.z);
  expect(panMoved).toBeGreaterThan(0.1);

  // The Line tool never deactivated
  const tool = await page.evaluate(() =>
    (window as any).__debugApp.toolManager.getActiveTool()?.id);
  expect(tool).toBe('tool.line');
});
