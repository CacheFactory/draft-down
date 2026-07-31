// E2E test: Context menu on viewport
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

test('right-click on viewport shows context menu', async () => {
  const canvas = page.locator('.viewport-container canvas');

  // Right-click on the canvas
  await canvas.click({ button: 'right' });

  // Context menu should appear
  const contextMenu = page.locator('.context-menu');
  await expect(contextMenu).toBeVisible();
});

test('context menu shows empty-space items when nothing selected', async () => {
  const canvas = page.locator('.viewport-container canvas');
  await canvas.click({ button: 'right' });

  const contextMenu = page.locator('.context-menu');
  await expect(contextMenu).toBeVisible();

  // Should show Paste, Select All, Zoom Extents for empty space
  await expect(contextMenu.locator('.context-menu-item:has-text("Paste")')).toBeVisible();
  await expect(contextMenu.locator('.context-menu-item:has-text("Select All")')).toBeVisible();
  await expect(contextMenu.locator('.context-menu-item:has-text("Zoom Extents")')).toBeVisible();
});

test('context menu closes on click elsewhere', async () => {
  const canvas = page.locator('.viewport-container canvas');
  await canvas.click({ button: 'right' });

  const contextMenu = page.locator('.context-menu');
  await expect(contextMenu).toBeVisible();

  // Click elsewhere
  await page.locator('.app-top-bar').click();

  // Context menu should disappear
  await expect(contextMenu).not.toBeVisible();
});

test('context menu closes on Escape key', async () => {
  const canvas = page.locator('.viewport-container canvas');
  await canvas.click({ button: 'right' });

  const contextMenu = page.locator('.context-menu');
  await expect(contextMenu).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(contextMenu).not.toBeVisible();
});

test('context menu items show keyboard shortcuts', async () => {
  const canvas = page.locator('.viewport-container canvas');
  await canvas.click({ button: 'right' });

  const contextMenu = page.locator('.context-menu');
  // The Paste item should have a shortcut
  const pasteItem = contextMenu.locator('.context-menu-item:has-text("Paste")');
  const shortcut = pasteItem.locator('.cm-shortcut');
  await expect(shortcut).toBeVisible();
});
