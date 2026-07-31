// E2E: DWG import/export through the live LibreDWG converter service.
// Import: a real AutoCAD 2000 DWG (LibreDWG test corpus) opened through the
// real open path (dialog stubbed). Export: document → DWG bytes → re-import
// round trip.
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

let app: ElectronApplication;
let page: Page;

const SAMPLE_DWG = path.join(__dirname, 'fixtures', 'example_2000.dwg');

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await closeApp(app);
});

async function meshCounts(): Promise<{ faces: number; edges: number }> {
  return page.evaluate(() => {
    const m = (window as any).__debugApp.document.geometry.getMesh();
    return { faces: m.faces.size, edges: m.edges.size };
  });
}

test('importing a real DWG produces geometry', async () => {
  test.skip(!fs.existsSync(SAMPLE_DWG), 'sample DWG fixture missing');

  await app.evaluate(({ dialog }, fp) => {
    (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, SAMPLE_DWG);

  await page.evaluate(() => (window as any).__debugApp.openDocument());
  // Conversion + import can take a while (service round trip)
  await page.waitForFunction(
    () => (window as any).__debugApp.document.geometry.getMesh().edges.size > 0,
    undefined, { timeout: 60000 },
  );
  const counts = await meshCounts();
  console.log('imported DWG mesh:', JSON.stringify(counts));
  expect(counts.edges).toBeGreaterThan(10);
});

test('exported DWG bytes are a valid DWG and re-import', async () => {
  // Fresh doc with one face
  await page.evaluate(() => {
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
  });

  // Stub the export save dialog to a temp path, then export
  const outPath = await app.evaluate(async ({ dialog, app: eApp }) => {
    const fp = `${eApp.getPath('userData')}/e2e-export.dwg`;
    (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: fp });
    return fp;
  });
  await page.evaluate(() => (window as any).__debugApp.exportFile('dwg'));
  await page.waitForTimeout(8000); // service round trip

  const header = fs.existsSync(outPath)
    ? fs.readFileSync(outPath).slice(0, 6).toString('ascii')
    : null;
  console.log('exported DWG header:', header);
  expect(header).toBe('AC1015'); // r2000 DWG magic

  // Re-import the exported DWG through the open path
  await page.evaluate(() => (window as any).__debugApp.newDocument());
  await app.evaluate(({ dialog }, fp) => {
    (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, outPath);
  await page.evaluate(() => (window as any).__debugApp.openDocument());
  await page.waitForFunction(
    () => (window as any).__debugApp.document.geometry.getMesh().edges.size > 0,
    undefined, { timeout: 60000 },
  );
  const counts = await meshCounts();
  console.log('re-imported mesh:', JSON.stringify(counts));
  expect(counts.edges).toBeGreaterThanOrEqual(4);
});
