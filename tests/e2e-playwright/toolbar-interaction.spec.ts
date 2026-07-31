// E2E test: Toolbar interactions — clicking tools, keyboard shortcuts, active state
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(app);
});

test('clicking a tool button activates it (shows .active class)', async () => {
  // Click the Line tool button (has title containing "Line")
  const lineBtn = page.locator('.sidebar-tool-btn[title*="Line"]');
  await lineBtn.click();

  // The button should now have the active class
  await expect(lineBtn).toHaveClass(/active/);
});

test('clicking a different tool deactivates the previous one', async () => {
  const lineBtn = page.locator('.sidebar-tool-btn[title*="Line"]');
  const rectBtn = page.locator('.sidebar-tool-btn[title*="Rectangle"]');

  await lineBtn.click();
  await expect(lineBtn).toHaveClass(/active/);

  await rectBtn.click();
  await expect(rectBtn).toHaveClass(/active/);
  await expect(lineBtn).not.toHaveClass(/active/);
});

test('keyboard shortcut L activates Line tool', async () => {
  // Focus the viewport first
  await page.locator('.viewport-container').click();
  await page.keyboard.press('l');

  const lineBtn = page.locator('.sidebar-tool-btn[title*="Line"]');
  await expect(lineBtn).toHaveClass(/active/);
});

test('keyboard shortcut R activates Rectangle tool', async () => {
  await page.locator('.viewport-container').click();
  await page.keyboard.press('r');

  const rectBtn = page.locator('.sidebar-tool-btn[title*="Rectangle"]');
  await expect(rectBtn).toHaveClass(/active/);
});

test('keyboard shortcut P activates Push/Pull tool', async () => {
  await page.locator('.viewport-container').click();
  await page.keyboard.press('p');

  const ppBtn = page.locator('.sidebar-tool-btn[title*="Push/Pull"]');
  await expect(ppBtn).toHaveClass(/active/);
});

test('keyboard shortcut Space activates Select tool', async () => {
  await page.locator('.viewport-container').click();
  await page.keyboard.press(' ');

  const selectBtn = page.locator('.sidebar-tool-btn[title*="Select"]');
  await expect(selectBtn).toHaveClass(/active/);
});

test('drawing toolbar tools can be activated', async () => {
  // Click the Polygon tool in the drawing toolbar
  const polyBtn = page.locator('.drawing-toolbar .sidebar-tool-btn[title*="Polygon"]');
  if (await polyBtn.count() > 0) {
    await polyBtn.click();
    await expect(polyBtn).toHaveClass(/active/);
  }
});

test('views toolbar view buttons exist and are clickable', async () => {
  const frontBtn = page.locator('.views-toolbar .view-btn:has-text("Front")');
  await expect(frontBtn).toBeVisible();
  await frontBtn.click(); // Should not crash

  const isoBtn = page.locator('.views-toolbar .view-btn:has-text("Iso")');
  await expect(isoBtn).toBeVisible();
  await isoBtn.click();
});

test('render mode buttons toggle active state', async () => {
  const shadedBtn = page.locator('.views-toolbar .view-btn:has-text("Shaded")');
  const wireBtn = page.locator('.views-toolbar .view-btn:has-text("Wire")');

  await shadedBtn.click();
  await expect(shadedBtn).toHaveClass(/active/);

  await wireBtn.click();
  await expect(wireBtn).toHaveClass(/active/);
  await expect(shadedBtn).not.toHaveClass(/active/);
});

test('grid toggle button works', async () => {
  const gridBtn = page.locator('.views-toolbar button').filter({ hasText: /^Grid$/ });
  await expect(gridBtn).toBeVisible();

  // Initially active
  await expect(gridBtn).toHaveClass(/active/);

  // Click to toggle off
  await gridBtn.click();
  await expect(gridBtn).not.toHaveClass(/active/);

  // Click to toggle back on
  await gridBtn.click();
  await expect(gridBtn).toHaveClass(/active/);
});
