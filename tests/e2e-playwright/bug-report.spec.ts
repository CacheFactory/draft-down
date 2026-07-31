// E2E: Help ▸ Report a Bug files a real report through the live endpoint.
// Exercises the renderer CSP (connect-src) — the sharp edge of this feature.
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

test('red bug button is always visible and opens the modal', async () => {
  const fab = page.locator('.bugreport-fab');
  await expect(fab).toBeVisible();
  await fab.click();
  await expect(page.locator('.bugreport-modal')).toBeVisible();
  await page.locator('.bugreport-close').click();
  await expect(page.locator('.bugreport-modal')).toBeHidden();
});

test('bug report modal opens via menu action and sends successfully', async () => {
  // Trigger the Help menu item through the real main-process IPC path
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:action', { action: 'report-bug' });
  });

  const modal = page.locator('.bugreport-modal');
  await expect(modal).toBeVisible();

  await page.locator('.bugreport-textarea').fill('[e2e] automated smoke report — safe to ignore');
  const send = page.locator('.bugreport-submit');
  await expect(send).toBeEnabled();
  await send.click();

  // Success message appears, then the modal auto-closes
  await expect(page.locator('.bugreport-success')).toBeVisible({ timeout: 20000 });
  await expect(modal).toBeHidden({ timeout: 5000 });
});
