// @archigraph tool.tape_measure
// Construction guides: tape measure creates infinite snappable guide lines
// and guide points; Edit > Delete Guides removes them all (undoably).
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

async function guideCount(): Promise<number> {
  return page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    return (appRef.viewport.renderer as any).getConstructionGuides().length;
  });
}

test('tape measure guide line is created, snappable, and deletable', async () => {
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Tape measure (T) in Guide Line mode (default): two clicks
  await page.keyboard.press('t');
  await page.waitForTimeout(300);
  await page.mouse.click(cx + 60, cy - 120);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 180, cy - 60);
  await page.waitForTimeout(400);

  expect(await guideCount()).toBe(1);

  // The guide participates in snapping: hover ON its extension far from the
  // clicked segment — snap kind must be 'edge' (On Line).
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  // The guide runs through (cx+60,cy-120)→(cx+180,cy-60); extend beyond:
  await page.mouse.move(cx + 300, cy);
  await page.waitForTimeout(300);
  const kind = await page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    return (appRef.sceneBridge as any).getLastSnapKind?.() ?? null;
  });
  console.log('snap on guide extension:', kind);
  expect(kind).toBe('edge');
  await page.keyboard.press('Escape');

  // Guide point via tape measure guide-point mode
  await page.keyboard.press('t');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const tool: any = (window as any).__debugApp.toolManager.getActiveTool();
    tool.mode = 'guide-point';
  });
  await page.waitForTimeout(100);
  await page.mouse.click(cx - 150, cy + 100);
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 60, cy + 100);
  await page.waitForTimeout(400);
  expect(await guideCount()).toBe(4); // 1 line + 3 cross segments

  // Edit > Delete Guides clears everything
  await page.evaluate(() => (window as any).__debugApp.deleteAllGuides());
  await page.waitForTimeout(300);
  expect(await guideCount()).toBe(0);

  // And it's undoable
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);
  expect(await guideCount()).toBe(4);
});
