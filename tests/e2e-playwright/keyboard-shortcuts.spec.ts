// E2E test: Global keyboard shortcuts
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

test('tool shortcuts cycle through drawing tools', async () => {
  const canvas = page.locator('.viewport-container');
  await canvas.click(); // Focus viewport

  // L -> Line
  await page.keyboard.press('l');
  await expect(page.locator('.sidebar-tool-btn[title*="Line"]')).toHaveClass(/active/);

  // C -> Circle
  await page.keyboard.press('c');
  await expect(page.locator('.sidebar-tool-btn[title*="Circle"]')).toHaveClass(/active/);

  // A -> Arc
  await page.keyboard.press('a');
  await expect(page.locator('.sidebar-tool-btn[title*="Arc"]')).toHaveClass(/active/);
});

test('tool shortcuts for modification tools', async () => {
  const canvas = page.locator('.viewport-container');
  await canvas.click();

  // M -> Move
  await page.keyboard.press('m');
  await expect(page.locator('.sidebar-tool-btn[title*="Move"]')).toHaveClass(/active/);

  // Q -> Rotate
  await page.keyboard.press('q');
  await expect(page.locator('.sidebar-tool-btn[title*="Rotate"]')).toHaveClass(/active/);

  // S -> Scale
  await page.keyboard.press('s');
  await expect(page.locator('.sidebar-tool-btn[title*="Scale"]')).toHaveClass(/active/);

  // E -> Eraser
  await page.keyboard.press('e');
  await expect(page.locator('.sidebar-tool-btn[title*="Eraser"]')).toHaveClass(/active/);

  // B -> Paint
  await page.keyboard.press('b');
  await expect(page.locator('.sidebar-tool-btn[title*="Paint"]')).toHaveClass(/active/);
});

test('navigation tool shortcuts', async () => {
  const canvas = page.locator('.viewport-container');
  await canvas.click();

  // O -> Orbit
  await page.keyboard.press('o');
  await expect(page.locator('.sidebar-tool-btn[title*="Orbit"]')).toHaveClass(/active/);

  // H -> Pan
  await page.keyboard.press('h');
  await expect(page.locator('.sidebar-tool-btn[title*="Pan"]')).toHaveClass(/active/);

  // Z -> Zoom
  await page.keyboard.press('z');
  await expect(page.locator('.sidebar-tool-btn[title*="Zoom"]')).toHaveClass(/active/);
});

test('typing numbers focuses VCB input', async () => {
  const canvas = page.locator('.viewport-container');
  await canvas.click();

  // Activate a tool first
  await page.keyboard.press('l');

  // Type a number — should go to VCB
  await page.keyboard.press('5');
  const vcb = page.locator('.vcb-input');
  await expect(vcb).toBeFocused();
});

test('shortcuts do not fire when typing in input fields', async () => {
  // Focus on the outliner search input
  const searchInput = page.locator('.outliner-search');
  await searchInput.click();
  await searchInput.fill('');

  // Type 'l' — should NOT activate Line tool
  await searchInput.type('l');
  expect(await searchInput.inputValue()).toBe('l');

  // Clean up
  await searchInput.fill('');
});
