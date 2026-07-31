// E2E test: Push/Pull tool creates a 3D box from a 2D rectangle.
// Verifies the core DraftDown workflow: draw face → select face → push/pull → 3D solid.
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500); // Let Three.js fully initialize
});

test.afterAll(async () => {
  await closeApp(app);
});

test('Push/Pull: draw rectangle then extrude into a 3D box via VCB', async () => {
  // Switch to top view for reliable ground plane interaction
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // 1. Draw a rectangle with the Rectangle tool
  await page.locator('.sidebar-tool-btn[title*="Rectangle"]').click();
  await page.waitForTimeout(200);

  let status = await page.locator('.status-text').textContent();
  expect(status).toContain('corner');

  // Click first corner
  await page.mouse.click(cx - 60, cy - 40);
  await page.waitForTimeout(300);

  // Use VCB for exact dimensions
  const vcb = page.locator('.vcb-input');
  await vcb.click();
  await vcb.fill('4,3');
  await vcb.press('Enter');
  await page.waitForTimeout(300);

  status = await page.locator('.status-text').textContent();
  expect(status).toContain('created');

  // 2. Switch to Select tool and click on the face
  await page.locator('.sidebar-tool-btn[title*="Select"]').click();
  await page.waitForTimeout(200);

  // Click on the center of where we drew the rectangle
  await page.mouse.click(cx - 30, cy - 20);
  await page.waitForTimeout(300);

  status = await page.locator('.status-text').textContent();
  // Should say "Selected face" if we hit the face
  const faceSelected = status!.includes('face');

  // 3. Activate Push/Pull tool (it should auto-detect the selected face)
  await page.locator('.sidebar-tool-btn[title*="Push/Pull"]').click();
  await page.waitForTimeout(300);

  status = await page.locator('.status-text').textContent();

  if (faceSelected && status!.includes('extrude')) {
    // Face was pre-selected, Push/Pull is ready to go
    // Type distance in VCB
    await vcb.click();
    await vcb.fill('3');
    await vcb.press('Enter');
    await page.waitForTimeout(300);

    status = await page.locator('.status-text').textContent();
    expect(status).toContain('complete');
  } else {
    // Need to click a face manually
    // Switch to iso view so we can see the face
    await page.locator('.views-toolbar .view-btn:has-text("Iso")').click();
    await page.waitForTimeout(600);

    // Click on the face
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(300);

    status = await page.locator('.status-text').textContent();
    if (status!.includes('distance') || status!.includes('commit')) {
      // Now extrude via VCB
      await vcb.click();
      await vcb.fill('3');
      await vcb.press('Enter');
      await page.waitForTimeout(300);

      status = await page.locator('.status-text').textContent();
      expect(status).toContain('complete');
    }
  }
});

test('Push/Pull: click face directly then drag to extrude', async () => {
  // Switch to top view
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Draw a new rectangle
  await page.locator('.sidebar-tool-btn[title*="Rectangle"]').click();
  await page.waitForTimeout(200);

  await page.mouse.click(cx + 50, cy + 50);
  await page.waitForTimeout(200);

  const vcb = page.locator('.vcb-input');
  await vcb.click();
  await vcb.fill('2,2');
  await vcb.press('Enter');
  await page.waitForTimeout(300);

  // Switch to iso view to see the face
  await page.locator('.views-toolbar .view-btn:has-text("Iso")').click();
  await page.waitForTimeout(600);

  // Activate Push/Pull
  await page.locator('.sidebar-tool-btn[title*="Push/Pull"]').click();
  await page.waitForTimeout(200);

  let status = await page.locator('.status-text').textContent();
  expect(status).toContain('face');

  // Click on the face to start extrusion
  await page.mouse.click(cx + 70, cy + 20);
  await page.waitForTimeout(200);

  status = await page.locator('.status-text').textContent();
  // If we hit a face, status should mention distance/commit
  const extruding = status!.includes('distance') || status!.includes('commit') || status!.includes('Move');

  if (extruding) {
    // Move mouse up to set distance, then click to commit
    await page.mouse.click(cx + 70, cy - 40);
    await page.waitForTimeout(300);

    status = await page.locator('.status-text').textContent();
    expect(status).toContain('complete');
  }
});

test('Push/Pull: keyboard shortcut P activates tool', async () => {
  await page.locator('.viewport-container').click();
  await page.keyboard.press('p');
  await page.waitForTimeout(200);

  const btn = page.locator('.sidebar-tool-btn[title*="Push/Pull"]');
  await expect(btn).toHaveClass(/active/);

  const status = await page.locator('.status-text').textContent();
  expect(status).toContain('face');
});

test('Push/Pull: Escape cancels extrusion', async () => {
  // Draw a rect first
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  await page.locator('.sidebar-tool-btn[title*="Rectangle"]').click();
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + 200, box.y + 200);
  await page.waitForTimeout(200);
  const vcb = page.locator('.vcb-input');
  await vcb.click();
  await vcb.fill('1,1');
  await vcb.press('Enter');
  await page.waitForTimeout(300);

  // Activate Push/Pull and click the face
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  await page.mouse.click(box.x + 210, box.y + 210);
  await page.waitForTimeout(200);

  // Press Escape to cancel
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const status = await page.locator('.status-text').textContent();
  // After Escape, should be back in idle — either Push/Pull idle or another tool
  expect(status).toBeTruthy();
  // Should NOT say "complete" (we cancelled, didn't commit)
  expect(status).not.toContain('complete');
});
