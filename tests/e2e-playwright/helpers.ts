// Helper to launch the real Electron app for E2E testing
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [path.join(__dirname, '../../dist/main/main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // HEADLESS=1 (or CI) hides the Electron window during tests.
      ...(process.env.HEADLESS || process.env.CI ? { DRAFTDOWN_HEADLESS: '1' } : {}),
    },
    timeout: 15000,
  });

  const page = await app.firstWindow();
  await page.waitForSelector('.app-layout', { timeout: 10000 });

  // Dismiss the welcome modal — it intercepts pointer events over the whole
  // viewport, so any click-based test fails (or passes only by timing luck)
  // while it is up.
  await dismissWelcome(page);

  return { app, page };
}

/** Close the welcome overlay if it is showing. Safe to call when absent. */
export async function dismissWelcome(page: Page): Promise<void> {
  try {
    const newProject = page.locator('.welcome-overlay .welcome-option', { hasText: 'New Project' });
    if (await newProject.count()) {
      await newProject.first().click({ timeout: 3000 });
      // Template screen follows — pick Simple (meters) so tests keep their
      // historical meter-based coordinate expectations.
      const simple = page.locator('.welcome-overlay .welcome-option', { hasText: 'Simple' });
      await simple.first().click({ timeout: 3000 });
      await page.waitForSelector('.welcome-overlay', { state: 'detached', timeout: 3000 });
    }
  } catch {
    // Modal already gone or mid-dismissal — fine.
  }
}

/** Reset interaction state between tests: cancel any in-progress tool
 *  operation and return to the Select tool. Keeps tests order-independent. */
export async function resetToolState(page: Page): Promise<void> {
  await dismissWelcome(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const selectBtn = page.locator('.sidebar-tool-btn[title*="Select"]');
  if (await selectBtn.count()) {
    await selectBtn.first().click();
  }
  await page.waitForTimeout(100);
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  if (!app) return;
  try {
    // Force-kill the process to avoid lingering
    const pid = app.process().pid;
    await Promise.race([
      app.close(),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);
    // If still alive, kill it
    try { process.kill(pid!, 'SIGKILL'); } catch {}
  } catch {
    // Already dead
  }
}
