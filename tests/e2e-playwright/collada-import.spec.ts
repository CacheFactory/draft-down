// @archigraph process.renderer
// classic CAD migration path: importing a legacy-modeler-exported COLLADA (.dae)
// brings geometry in with materials preserved (colors survive the
// conversion — three's OBJExporter used to drop them).
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await closeApp(app);
});

test('classic CAD DAE import: geometry + red material arrive', async () => {
  const daePath = path.join(__dirname, '../fixtures/skp-export.dae');
  const daeData = fs.readFileSync(daePath);

  const result = await page.evaluate(async (bytes: number[]) => {
    const a = (window as any).__debugApp;
    const buf = new Uint8Array(bytes).buffer;
    await (a as any).importViaThreeJS(buf, 'dae', '/tmp/skp-export.dae');
    const mesh = a.document.geometry.getMesh();
    const mats = [...a.document.materials.materials.values()]
      .map((m: any) => ({ name: m.name, color: m.color }));
    const assignments = (a.document.materials as any).faceAssignments.size;
    return {
      faces: mesh.faces.size,
      verts: mesh.vertices.size,
      mats,
      assignments,
    };
  }, Array.from(daeData));

  console.log('dae import:', JSON.stringify({
    faces: result.faces, verts: result.verts, assignments: result.assignments,
    matCount: result.mats.length,
  }));

  // A 2×2×2 box: coplanar-merge may reduce 12 triangles to 6 quads
  expect(result.faces).toBeGreaterThanOrEqual(6);
  expect(result.verts).toBeGreaterThanOrEqual(8);

  // The red material must have survived. Three converts colors to
  // linear-sRGB working space (0.8 sRGB ≈ 0.60 linear), so test the RATIO:
  // dominantly red, hardly any green/blue.
  const red = result.mats.find((m: any) =>
    m.color && m.color.r > 0.4 && m.color.r > 5 * m.color.g && m.color.r > 5 * m.color.b);
  expect(red).toBeTruthy();
  // And be assigned to faces
  expect(result.assignments).toBeGreaterThan(0);
});
