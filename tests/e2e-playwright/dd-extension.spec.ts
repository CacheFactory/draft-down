// E2E: .dd is the native format extension — a saved .dd file reopens through
// the real open path (dialog stubbed in the main process), and legacy
// .draftdown files still load.
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

async function faceCount(): Promise<number> {
  return page.evaluate(() => (window as any).__debugApp.document.geometry.getMesh().faces.size);
}

async function stubOpenDialog(filePath: string) {
  await app.evaluate(({ dialog }, fp) => {
    (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
}

for (const ext of ['dd', 'draftdown']) {
  test(`.${ext} file round-trips through the real open path`, async () => {
    // Build a face and save the document via the write IPC
    const filePath = await page.evaluate(async (extension) => {
      const a = (window as any).__debugApp;
      a.newDocument();
      const geo = a.document.geometry;
      const v1 = geo.createVertex({ x: 0, y: 0, z: 0 });
      const v2 = geo.createVertex({ x: 2, y: 0, z: 0 });
      const v3 = geo.createVertex({ x: 2, y: 0, z: 2 });
      const v4 = geo.createVertex({ x: 0, y: 0, z: 2 });
      geo.createEdge(v1.id, v2.id); geo.createEdge(v2.id, v3.id);
      geo.createEdge(v3.id, v4.id); geo.createEdge(v4.id, v1.id);
      geo.createFace([v1.id, v2.id, v3.id, v4.id]);
      const userData = await (window as any).api.invoke('app:get-user-data-path');
      const fp = `${userData}/e2e-roundtrip.${extension}`;
      await (window as any).api.invoke('file:write', { filePath: fp, data: a.document.serialize() });
      return fp;
    }, ext);
    expect(await faceCount()).toBe(1);

    // Fresh document, then open the saved file through the REAL open flow
    await page.evaluate(() => (window as any).__debugApp.newDocument());
    expect(await faceCount()).toBe(0);

    await stubOpenDialog(filePath);
    await page.evaluate(() => (window as any).__debugApp.openDocument());
    await page.waitForTimeout(1000);
    expect(await faceCount()).toBe(1);

    await page.evaluate((fp) => (window as any).api.invoke('file:delete', { filePath: fp }), filePath);
  });
}
