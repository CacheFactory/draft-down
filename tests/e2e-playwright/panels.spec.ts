// E2E test: Panel interactions — collapsing, layers, outliner
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

test('entity info panel can be collapsed and expanded', async () => {
  const header = page.locator('.entity-info-panel .panel-header');
  const body = page.locator('.entity-info-panel .panel-body');

  // Initially expanded
  await expect(body).toBeVisible();

  // Click header to collapse
  await header.click();
  await expect(body).not.toBeVisible();

  // Click again to expand
  await header.click();
  await expect(body).toBeVisible();
});

test('outliner panel can be collapsed and expanded', async () => {
  const header = page.locator('.outliner-panel .panel-header');
  const body = page.locator('.outliner-panel .panel-body');

  await expect(body).toBeVisible();

  await header.click();
  await expect(body).not.toBeVisible();

  await header.click();
  await expect(body).toBeVisible();
});

test('outliner has a search/filter input', async () => {
  const searchInput = page.locator('.outliner-panel .outliner-search');
  await expect(searchInput).toBeVisible();
  await searchInput.fill('test');
  expect(await searchInput.inputValue()).toBe('test');
  await searchInput.fill(''); // Reset
});

test('layers panel can be collapsed and expanded', async () => {
  const header = page.locator('.layers-panel .panel-header');
  const body = page.locator('.layers-panel .panel-body');

  await expect(body).toBeVisible();

  await header.click();
  await expect(body).not.toBeVisible();

  await header.click();
  await expect(body).toBeVisible();
});

test('layers panel: can add a new layer', async () => {
  const input = page.locator('.layers-panel .layer-name-input');
  const addBtn = page.locator('.layers-panel .layer-add-btn');

  await input.fill('Test Layer');
  await addBtn.click();

  // The new layer should appear in the list
  const layerName = page.locator('.layers-panel .layer-name:has-text("Test Layer")');
  await expect(layerName).toBeVisible();
});

test('layers panel: can add layer via Enter key', async () => {
  const input = page.locator('.layers-panel .layer-name-input');

  await input.fill('Enter Layer');
  await input.press('Enter');

  const layerName = page.locator('.layers-panel .layer-name:has-text("Enter Layer")');
  await expect(layerName).toBeVisible();
});

test('drawing toolbar groups can be collapsed', async () => {
  const headers = page.locator('.drawing-toolbar .tool-group-header');
  const count = await headers.count();
  expect(count).toBeGreaterThanOrEqual(2); // At least Drawing and Modification groups

  // Click first group header to collapse
  const firstHeader = headers.first();
  await firstHeader.click();

  // Click again to expand
  await firstHeader.click();
});

test('VCB input can receive typed values', async () => {
  const vcbInput = page.locator('.measurements-bar .vcb-input');
  await vcbInput.click();
  await vcbInput.fill('500');
  expect(await vcbInput.inputValue()).toBe('500');
});

test('status text is displayed in measurements bar', async () => {
  const statusText = page.locator('.measurements-bar .status-text');
  await expect(statusText).toBeVisible();
  const text = await statusText.textContent();
  expect(text).toBeTruthy();
});

test('axis indicators (X Y Z) are visible', async () => {
  const axis = page.locator('.measurements-bar .axis-indicator');
  await expect(axis).toBeVisible();
  const text = await axis.textContent();
  expect(text).toContain('X');
  expect(text).toContain('Y');
  expect(text).toContain('Z');
});
