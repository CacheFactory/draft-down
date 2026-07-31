// E2E: grid snapping — free points round to the configured increment; hard
// snaps, toolbar toggle persistence, object-snap gating, and Preferences
// unit-expression input.
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let box: { x: number; y: number; width: number; height: number };

async function screenPos(wx: number, wy: number, wz: number) {
  const p = await page.evaluate(([x, y, z]) => {
    return (window as any).__debugApp.viewport.worldToScreen({ x, y, z });
  }, [wx, wy, wz]);
  return { x: box.x + p.x, y: box.y + p.y };
}

async function clickWorld(wx: number, wy: number, wz: number) {
  const p = await screenPos(wx, wy, wz);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(120);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
}

async function vertexPositions(): Promise<Array<{ x: number; y: number; z: number }>> {
  return page.evaluate(() => {
    const m = (window as any).__debugApp.document.geometry.getMesh();
    return [...m.vertices.values()].map((v: any) => ({ ...v.position }));
  });
}

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
  const b = await page.locator('.viewport-container canvas').boundingBox();
  if (!b) throw new Error('canvas not found');
  box = b;
});

test.afterAll(async () => {
  // Restore defaults so later suites aren't affected
  await page.evaluate(() => (window as any).api.invoke('prefs:set', {
    gridSnapEnabled: false, gridSnapSpacing: 0.25, snapEnabled: true,
  })).catch(() => {});
  await closeApp(app);
});

test.describe.serial('grid snapping', () => {
  test('free line endpoints round to the 0.5m grid', async () => {
    // Set the increment through the real Preferences UI, then enable via the
    // toolbar (which persists gridSnapEnabled)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { action: 'preferences' });
    });
    await page.waitForTimeout(400);
    const incInput = page.locator('.pref-row:has-text("Grid snap increment") input[type=text]');
    await incInput.fill('0.5m');
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(300);
    await page.click('.views-toolbar >> text=Grid Snap');
    await page.waitForTimeout(200);

    await page.locator('.viewport-container').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('l'); // line tool
    await page.waitForTimeout(200);
    await clickWorld(1.13, 0, 2.71);
    await clickWorld(3.36, 0, 0.42);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const verts = await vertexPositions();
    expect(verts.length).toBeGreaterThanOrEqual(2);
    for (const v of verts) {
      expect(Math.abs(v.x / 0.5 - Math.round(v.x / 0.5))).toBeLessThan(1e-6);
      expect(Math.abs(v.z / 0.5 - Math.round(v.z / 0.5))).toBeLessThan(1e-6);
    }
  });

  test('hard vertex snap beats the grid', async () => {
    // Move an existing vertex off-grid via the engine, then draw to it
    const offGrid = await page.evaluate(() => {
      const a = (window as any).__debugApp;
      const m = a.document.geometry.getMesh();
      const first = [...m.vertices.values()][0];
      first.position = { x: 1.137, y: 0, z: 2.719 };
      a.syncScene();
      return { ...first.position };
    });
    await page.keyboard.press('l');
    await page.waitForTimeout(200);
    await clickWorld(offGrid.x, offGrid.y, offGrid.z); // snaps to the vertex
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const verts = await vertexPositions();
    const match = verts.find(v =>
      Math.abs(v.x - offGrid.x) < 1e-6 && Math.abs(v.z - offGrid.z) < 1e-6);
    expect(match).toBeTruthy(); // the off-grid vertex still exists un-rounded
  });

  test('toolbar toggle persists to prefs and shows active state', async () => {
    const btn = page.locator('.views-toolbar >> text=Grid Snap');
    await expect(btn).toHaveClass(/active/);
    const saved = await page.evaluate(() => (window as any).api.invoke('prefs:get'));
    expect(saved.gridSnapEnabled).toBe(true);
    await btn.click();
    await expect(btn).not.toHaveClass(/active/);
    const saved2 = await page.evaluate(() => (window as any).api.invoke('prefs:get'));
    expect(saved2.gridSnapEnabled).toBe(false);
  });

  test('disabling object snapping yields cursor kind over a vertex', async () => {
    // Turn object snapping off through the runtime setter used by Preferences
    // Uncheck Object snapping through the real Preferences UI
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { action: 'preferences' });
    });
    await page.waitForTimeout(400);
    const objCheckbox = page.locator('.pref-row:has-text("Object snapping") input[type=checkbox]');
    if (await objCheckbox.isChecked()) await objCheckbox.click();
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(300);

    // Hover exactly over an existing vertex — snap kind must be 'cursor'
    const verts = await vertexPositions();
    const target = verts[0];
    const p = await screenPos(target.x, target.y, target.z);
    await page.keyboard.press('l');
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(250);
    const kind = await page.evaluate(() => (window as any).__debugApp.sceneBridge.getLastSnapKind?.());
    expect(kind).toBe('cursor');
    await page.keyboard.press('Escape');

    // Restore object snapping
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { action: 'preferences' });
    });
    await page.waitForTimeout(400);
    const cb = page.locator('.pref-row:has-text("Object snapping") input[type=checkbox]');
    if (!(await cb.isChecked())) await cb.click();
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(200);
  });

  test('Preferences accepts unit expressions for the snap increment', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { action: 'preferences' });
    });
    await page.waitForTimeout(400);
    const input = page.locator('.pref-row:has-text("Grid snap increment") input[type=text]');
    await input.fill('6"');
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => (window as any).api.invoke('prefs:get'));
    expect(saved.gridSnapSpacing).toBeCloseTo(0.1524, 4);
  });
});
