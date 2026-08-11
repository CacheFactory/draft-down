import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let box: { x: number; y: number; width: number; height: number };

async function screenPos(wx: number, wy: number, wz: number) {
  const p = await page.evaluate(([x, y, z]) => (window as any).__debugApp.viewport.worldToScreen({ x, y, z }), [wx, wy, wz]);
  return { x: box.x + p.x, y: box.y + p.y };
}

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
  box = (await page.locator('.viewport-container canvas').boundingBox())!;
});
test.afterAll(async () => { await closeApp(app); });

test('erasing an axis-inferred line leaves no green guide behind', async () => {
  const baseline = await page.evaluate(() => {
    const r = (window as any).__debugApp.viewport.renderer;
    const overlay = r.overlayScene ?? r._overlayScene;
    const lines: any[] = [];
    overlay?.traverse?.((o: any) => {
      if (o.isLine || o.isLineSegments) lines.push({ name: o.name, color: o.material?.color?.getHexString?.() });
    });
    return lines;
  });
  console.log('baseline overlay lines:', JSON.stringify(baseline));
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  const a = await screenPos(0, 0, 1);
  const b = await screenPos(0, 0, 3);
  await page.mouse.move(a.x, a.y); await page.waitForTimeout(120);
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(150);
  // move along Z (green axis) slowly to trigger axis inference
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.waitForTimeout(250);
  const label = await page.evaluate(() => {
    const tm = (window as any).__debugApp.toolManager;
    const tool = tm.getActiveTool?.() ?? tm.activeTool;
    return tool?.inferenceLabel ?? null;
  });
  console.log('inference label while drawing:', label);
  await page.mouse.click(b.x, b.y);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const counts = () => page.evaluate(() => {
    const app = (window as any).__debugApp;
    const r = app.viewport.renderer;
    const overlay = r.overlayScene ?? r._overlayScene;
    let overlayLines = 0;
    overlay?.traverse?.((o: any) => { if (o.isLine || o.isLine2 || o.isLineSegments) overlayLines++; });
    const guides = r.getConstructionGuides?.() ?? [];
    const m = app.document.geometry.getMesh();
    const lineInfo: any[] = [];
    overlay?.traverse?.((o: any) => {
      if (o.isLine || o.isLineSegments) {
        const pos = o.geometry?.attributes?.position;
        lineInfo.push({ name: o.name, color: o.material?.color?.getHexString?.(),
          dashed: !!o.material?.dashSize, visible: o.visible,
          pts: pos ? Array.from(pos.array.slice(0, 6)).map((v: number) => +v.toFixed(2)) : [] });
      }
    });
    return { edges: m.edges.size, overlayLines, guides: guides.length, lineInfo };
  });
  console.log('after draw:', JSON.stringify(await counts()));

  // Erase the line
  await page.keyboard.press('e');
  await page.waitForTimeout(200);
  const mid = await screenPos(0, 0, 2);
  await page.mouse.move(mid.x + 30, mid.y); await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await counts();
  console.log('after erase:', JSON.stringify(after));
  expect(after.edges).toBe(0);
  expect(after.overlayLines).toBeLessThanOrEqual(0 + 2); // axes indicator etc.
});


test('switching to eraser mid-draw clears the green guide and rubber band', async () => {
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  const a = await screenPos(1, 0, 1);
  const b = await screenPos(1, 0, 3);
  await page.mouse.move(a.x, a.y); await page.waitForTimeout(120);
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(150);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const tm = app.toolManager;
    const tool = tm.getActiveTool?.() ?? tm.activeTool;
    const r = app.viewport.renderer;
    const guideIds = [...(r._guideLines?.keys?.() ?? [])];
    return { label: tool?.inferenceLabel, guideIds };
  });
  console.log('mid-draw:', JSON.stringify(state));

  // Switch to eraser WHILE drawing
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const r = app.viewport.renderer;
    const guideIds = [...(r._guideLines?.keys?.() ?? [])];
    let previewLines = 0;
    const overlay = r.overlayScene ?? r._overlayScene;
    overlay?.traverse?.((o: any) => {
      if ((o.isLine || o.isLineSegments) && o.material?.color?.getHexString?.() !== 'ffffff') previewLines++;
    });
    const m = app.document.geometry.getMesh();
    return { guideIds, previewLines, edges: m.edges.size,
             toolId: (app.toolManager.getActiveTool?.() ?? app.toolManager.activeTool)?.id };
  });
  console.log('after switch to eraser:', JSON.stringify(after));
  expect(after.guideIds.length).toBe(0);
  expect(after.previewLines).toBe(0);
});


test('erasing a hovered edge does not leak the glow tube', async () => {
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  const a = await screenPos(3, 0, 1);
  const b = await screenPos(3, 0, 3);
  await page.mouse.move(a.x, a.y); await page.waitForTimeout(120);
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(120);
  await page.mouse.move(b.x, b.y, { steps: 4 }); await page.waitForTimeout(150);
  await page.mouse.click(b.x, b.y);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.keyboard.press('e');
  await page.waitForTimeout(200);
  const mid = await screenPos(3, 0, 2);
  // Hover the edge FIRST so it becomes pre-selected (glow tube appears)
  await page.mouse.move(mid.x, mid.y, { steps: 3 });
  await page.waitForTimeout(250);
  const hover = await page.evaluate(() => {
    const r = (window as any).__debugApp.viewport.renderer;
    const glows: string[] = [];
    r._scene?.traverse?.((o: any) => { if (o.name?.startsWith('edge-glow')) glows.push(o.name); });
    r._overlayScene?.traverse?.((o: any) => { if (o.name?.startsWith('edge-glow')) glows.push(o.name + ' (overlay)'); });
    return glows;
  });
  console.log('glow tubes while hovering:', JSON.stringify(hover));

  // Click to erase while hovered, then move away
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(200);
  await page.mouse.move(mid.x + 200, mid.y + 100, { steps: 3 });
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const r = app.viewport.renderer;
    const glows: { name: string; visible: boolean; scale: number[] }[] = [];
    const scan = (root: any) => root?.traverse?.((o: any) => {
      if (o.name?.startsWith('edge-glow')) glows.push({ name: o.name, visible: o.visible, scale: [o.scale.x, o.scale.z] });
    });
    scan(r._scene); scan(r._overlayScene);
    return { edges: app.document.geometry.getMesh().edges.size, glows };
  });
  console.log('after erase + move away:', JSON.stringify(after));
  expect(after.edges).toBe(0);
  expect(after.glows.filter((g: any) => g.visible).length).toBe(0);
});


test('activating eraser with a selected edge erases it (and undoes as one step)', async () => {
  await page.evaluate(() => {
    const a = (window as any).__debugApp;
    a.document.selection.clear();
  });
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  const a = await screenPos(6, 0, 1);
  const b = await screenPos(6, 0, 3);
  await page.mouse.move(a.x, a.y); await page.waitForTimeout(120);
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(120);
  await page.mouse.move(b.x, b.y, { steps: 4 }); await page.waitForTimeout(150);
  await page.mouse.click(b.x, b.y);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Select the edge with the Select tool
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  const mid = await screenPos(6, 0, 2);
  await page.mouse.move(mid.x, mid.y, { steps: 3 }); await page.waitForTimeout(150);
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(200);
  const selCount = await page.evaluate(() => (window as any).__debugApp.document.selection.state.entityIds.size);
  console.log('selected entities:', selCount);
  expect(selCount).toBeGreaterThan(0);

  // Click the Eraser TOOLBAR button (the user's exact flow)
  await page.locator('button:has-text("Eraser")').first().click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    return {
      edges: app.document.geometry.getMesh().edges.size,
      selected: app.document.selection.state.entityIds.size,
    };
  });
  console.log('after eraser button:', JSON.stringify(after));
  expect(after.edges).toBe(0);
  expect(after.selected).toBe(0);

  // One undo restores it
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await page.waitForTimeout(300);
  const undone = await page.evaluate(() => (window as any).__debugApp.document.geometry.getMesh().edges.size);
  console.log('edges after undo:', undone);
  expect(undone).toBe(1);
});
