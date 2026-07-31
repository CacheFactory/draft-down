import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'warn') {
      console.log(`[${msg.type()}]`, msg.text());
    }
  });
});

test.afterAll(async () => {
  await closeApp(app);
});

test('Line tool: arrow key after first click locks the axis for the next point', async () => {
  // Switch to top view first
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  // Activate line tool
  await page.keyboard.press('l');
  await page.waitForTimeout(200);

  // Click first point
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);

  // Verify we're in drawing phase
  let toolState = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const tool = app?.toolManager?.getActiveTool();
    return { phase: (tool as any)?.phase, plane: (tool as any)?.drawingPlaneAxis, points: (tool as any)?.points?.length };
  });
  console.log('After first click:', toolState);
  expect(toolState.phase).toBe('drawing');
  expect(toolState.points).toBe(1);

  // Press Right Arrow — line tool locks the NEXT segment to the Red (X) axis
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  toolState = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const tool = app?.toolManager?.getActiveTool();
    return { axisLock: (tool as any)?.axisLock, status: tool?.getStatusText() };
  });
  console.log('After ArrowRight (mid-draw):', toolState);
  expect(toolState.axisLock).toBe('x');
  expect(toolState.status).toContain('Red');

  // Escape to finish
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
});

test('Line tool: arrow keys toggle axis lock (idle)', async () => {
  // Activate line tool
  await page.locator('.viewport-container').click();
  await page.keyboard.press('l');
  await page.waitForTimeout(300);

  // Check initial status
  let status = await page.locator('.status-text').textContent();
  console.log('Initial status:', status);

  // Check initial plane
  const initialPlane = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const tool = app?.toolManager?.getActiveTool();
    return {
      toolId: tool?.id,
      plane: (tool as any)?.drawingPlaneAxis,
      status: tool?.getStatusText(),
    };
  });
  console.log('Initial tool state:', initialPlane);
  expect(initialPlane.toolId).toBe('tool.line');

  // Press Right Arrow — locks Red (X) axis
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  const afterRight = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const tool = app?.toolManager?.getActiveTool();
    return {
      axisLock: (tool as any)?.axisLock,
      status: tool?.getStatusText(),
    };
  });
  console.log('After ArrowRight:', afterRight);
  expect(afterRight.axisLock).toBe('x');

  // Check status bar updated
  status = await page.locator('.status-text').textContent();
  console.log('Status bar:', status);
  expect(status).toContain('Red');

  // Press Left Arrow — locks Blue (Z) axis
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);

  const afterLeft = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const tool = app?.toolManager?.getActiveTool();
    return {
      axisLock: (tool as any)?.axisLock,
      status: tool?.getStatusText(),
    };
  });
  console.log('After ArrowLeft:', afterLeft);
  expect(afterLeft.axisLock).toBe('z');

  // Press Down Arrow — unlocks
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);

  const afterDown = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const tool = app?.toolManager?.getActiveTool();
    return {
      axisLock: (tool as any)?.axisLock,
      status: tool?.getStatusText(),
    };
  });
  console.log('After ArrowDown:', afterDown);
  expect(afterDown.axisLock).toBeNull();
});

test('Rectangle tool: arrow key changes drawing plane', async () => {
  await page.locator('.viewport-container').click();
  await page.keyboard.press('r');
  await page.waitForTimeout(300);

  // Click first corner
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);

  // Check initial plane
  const initial = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const tool = app?.toolManager?.getActiveTool();
    return (tool as any)?.drawingPlaneAxis;
  });
  console.log('Rect initial plane:', initial);
  expect(initial).toBe('ground');

  // Press Right Arrow
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  const afterRight = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const tool = app?.toolManager?.getActiveTool();
    return (tool as any)?.drawingPlaneAxis;
  });
  console.log('Rect after ArrowRight:', afterRight);
  expect(afterRight).toBe('red');

  // Escape to cancel
  await page.keyboard.press('Escape');
});
