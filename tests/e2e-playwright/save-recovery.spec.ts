// @archigraph file.native
// Production trust: native save round-trips through the real app, and the
// autosave machinery writes + recovers.
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

test('serialize→deserialize in the live app preserves the model', async () => {
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Rect + circle + a guide
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 150, cy - 100);
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 50, cy - 20);
  await page.waitForTimeout(300);
  await page.keyboard.press('t');
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 50, cy + 50);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 150, cy + 80);
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    const before = {
      faces: a.document.geometry.getMesh().faces.size,
      edges: a.document.geometry.getMesh().edges.size,
      guides: (a.viewport.renderer as any).getConstructionGuides().length,
    };
    const buffer = a.document.serialize();
    // Wipe and restore
    a.document.deserialize(buffer);
    a.document.selection.clear();
    a.sceneBridge.setSceneManager(a.document.scene);
    (a as any).installComponentEditHooks?.() ?? null;
    (a as any).applyExtraState?.();
    a.sceneBridge.sync(true);
    const after = {
      faces: a.document.geometry.getMesh().faces.size,
      edges: a.document.geometry.getMesh().edges.size,
      guides: (a.viewport.renderer as any).getConstructionGuides().length,
    };
    return { before, after };
  });
  console.log('roundtrip:', JSON.stringify(result));
  expect(result.after).toEqual(result.before);
  expect(result.after.guides).toBe(1);
});

test('autosave writes and recovery data is readable', async () => {
  const info = await page.evaluate(async () => {
    const a = (window as any).__debugApp;
    a.document.markDirty();
    await (a as any).writeAutosave();
    const userData = await (window as any).api.invoke('app:get-user-data-path');
    const exists = await (window as any).api.invoke('file:exists', { filePath: `${userData}/autosave.draftdown` });
    const metaExists = await (window as any).api.invoke('file:exists', { filePath: `${userData}/autosave.json` });
    let meta = null;
    if (metaExists) {
      const buf = await (window as any).api.invoke('file:read', { filePath: `${userData}/autosave.json` });
      meta = JSON.parse(new TextDecoder().decode(buf));
    }
    // Clean up so the next launch doesn't prompt
    await (a as any).clearAutosave();
    const gone = !(await (window as any).api.invoke('file:exists', { filePath: `${userData}/autosave.draftdown` }));
    return { exists, metaExists, meta, gone };
  });
  console.log('autosave:', JSON.stringify(info));
  expect(info.exists).toBe(true);
  expect(info.metaExists).toBe(true);
  expect(info.meta.savedAt).toBeGreaterThan(0);
  expect(info.gone).toBe(true);
});
