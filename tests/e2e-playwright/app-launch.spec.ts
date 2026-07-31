// E2E test: Verify the Electron app launches and renders its UI
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

test('app window opens with correct title', async () => {
  const title = await page.title();
  expect(title).toBe('DraftDown');
});

test('app window has correct minimum dimensions', async () => {
  // For Electron, use evaluate to get window inner dimensions
  const { width, height } = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(width).toBeGreaterThanOrEqual(800);
  expect(height).toBeGreaterThanOrEqual(600);
});

test('main layout renders with all sections', async () => {
  // Main layout container
  await expect(page.locator('.app-layout')).toBeVisible();

  // Top toolbar area
  await expect(page.locator('.app-top-bar')).toBeVisible();

  // Main toolbar
  await expect(page.locator('.app-top-bar')).toBeVisible();

  // Drawing toolbar with tool buttons (left sidebar)
  const toolButtons = page.locator('.drawing-toolbar .sidebar-tool-btn');
  const count = await toolButtons.count();
  expect(count).toBeGreaterThanOrEqual(10); // At least 10 tools in sidebar

  // Views toolbar
  await expect(page.locator('.views-toolbar')).toBeVisible();

  // Drawing sidebar
  await expect(page.locator('.drawing-toolbar')).toBeVisible();

  // Viewport canvas
  await expect(page.locator('.viewport-container canvas')).toBeVisible();

  // Right panels
  await expect(page.locator('.app-right-panels')).toBeVisible();

  // Measurements bar at bottom
  await expect(page.locator('.measurements-bar')).toBeVisible();
});

test('entity info panel shows "No selection" initially', async () => {
  const panel = page.locator('.entity-info-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.panel-empty')).toContainText('No selection');
});

test('outliner panel is visible', async () => {
  const panel = page.locator('.outliner-panel');
  await expect(panel).toBeVisible();
});

test('layers panel is visible', async () => {
  const panel = page.locator('.layers-panel');
  await expect(panel).toBeVisible();
});

test('measurements bar shows VCB input and status', async () => {
  const bar = page.locator('.measurements-bar');
  await expect(bar.locator('.vcb-input')).toBeVisible();
  await expect(bar.locator('.status-text')).toBeVisible();
  await expect(bar.locator('.axis-indicator')).toBeVisible();
});

test('viewport canvas is rendered and has size', async () => {
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);
});
