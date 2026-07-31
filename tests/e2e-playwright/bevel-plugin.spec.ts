// @archigraph plugin.system
// The shipped Bevel example plugin: loads through the real plugin loader,
// registers its menu item, and chamfers a selected box edge.
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, resetToolState } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await closeApp(app);
});

test('bevel plugin chamfers a selected edge', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../implementations/plugin.system/examples/bevel.js'), 'utf8');

  // Load through the real loader
  const loaded = await page.evaluate((src: string) => {
    const a = (window as any).__debugApp;
    const plugin = a.pluginLoader.loadFromSource(src, 'bevel.js');
    return !!plugin;
  }, source);
  expect(loaded).toBe(true);

  // Build a box: rectangle + push/pull
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 100, cy - 80);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 20, cy + 20);
  await page.waitForTimeout(300);
  await page.locator('.views-toolbar .view-btn:has-text("Iso")').click();
  await page.waitForTimeout(800);
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  const faceCenter = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    const mesh = a.document.geometry.getMesh();
    const face = [...mesh.faces.values()][0];
    let x = 0, y = 0, z = 0;
    for (const vid of face.vertexIds) {
      const p = mesh.vertices.get(vid).position;
      x += p.x / face.vertexIds.length;
      y += p.y / face.vertexIds.length;
      z += p.z / face.vertexIds.length;
    }
    const s = a.viewport.camera.worldToScreen({ x, y, z }, a.viewport.getWidth(), a.viewport.getHeight());
    return s;
  });
  await page.mouse.click(box.x + faceCenter.x, box.y + faceCenter.y);
  await page.waitForTimeout(300);
  const vcb = page.locator('.vcb-input');
  await vcb.click();
  await vcb.fill('2');
  await vcb.press('Enter');
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    return { faces: a.document.geometry.getMesh().faces.size };
  });
  expect(before.faces).toBeGreaterThanOrEqual(6);

  // Select a manifold edge (2 adjacent faces) and run the plugin's menu
  // handler with dialogs auto-answered.
  const result = await page.evaluate(async () => {
    const a = (window as any).__debugApp;
    const geo = a.document.geometry;
    const mesh = geo.getMesh();
    let target: string | null = null;
    for (const eid of mesh.edges.keys()) {
      if (geo.getEdgeFaces(eid).length === 2) { target = eid; break; }
    }
    if (!target) return { ok: false, reason: 'no manifold edge' };
    a.document.selection.clear();
    a.document.selection.add(target);

    // Auto-answer UI.inputbox (prompt) and messagebox (alert)
    const origPrompt = window.prompt;
    const origAlert = window.alert;
    (window as any).prompt = () => '0.2';
    (window as any).alert = () => undefined;
    try {
      // Find the registered Plugins menu item and invoke its handler
      const UI = (window as any).UI;
      const menu = UI.menu('Plugins');
      const items = (menu as any).node?.items ?? [];
      let handler: (() => void) | null = null;
      for (const item of items) {
        if (item.label === 'Bevel Selected Edges') { handler = item.handler; break; }
      }
      if (!handler) return { ok: false, reason: 'menu item not found', items: items.map((i: any) => i.label) };
      handler();
      // chamfer runs synchronously
      return { ok: true, faces: a.document.geometry.getMesh().faces.size };
    } finally {
      (window as any).prompt = origPrompt;
      (window as any).alert = origAlert;
    }
  });

  console.log('bevel result:', JSON.stringify(result));
  expect(result.ok).toBe(true);
  // Chamfer adds at least one new face
  expect(result.faces!).toBeGreaterThan(before.faces);
});
