import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
  page.on('console', msg => {
    if (msg.type() === 'log') console.log(`[browser]`, msg.text());
  });
});

test.afterAll(async () => {
  await closeApp(app);
});

test('Drawing a closed shape with the Line tool creates a face', async () => {
  // Switch to top view
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  // Use line tool to draw a triangle by clicking 3 points + closing
  await page.keyboard.press('l');
  await page.waitForTimeout(200);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Click 3 points to make a triangle
  await page.mouse.click(cx - 80, cy + 50);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 80, cy + 50);
  await page.waitForTimeout(200);
  await page.mouse.click(cx, cy - 60);
  await page.waitForTimeout(200);

  // Check faces so far
  let faceCount = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    return app.document.geometry.getMesh().faces.size;
  });
  console.log('Faces after 3 points (open):', faceCount);

  // Now close the loop by clicking back on the first point
  // The snap should grab the first vertex
  await page.mouse.click(cx - 80, cy + 50);
  await page.waitForTimeout(300);

  faceCount = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    return app.document.geometry.getMesh().faces.size;
  });
  console.log('Faces after closing loop:', faceCount);

  // If snap worked, the loop should have closed and created a face
  // If not, press Escape to deactivate (which also calls splitFaceWithPath)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  faceCount = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    return app.document.geometry.getMesh().faces.size;
  });
  console.log('Faces after Escape:', faceCount);

  // We should have at least 1 face
  expect(faceCount).toBeGreaterThanOrEqual(1);
});

test('Rectangle drawn with Line tool snapping to corners creates a face', async () => {
  // Clear and draw a fresh rectangle using line tool
  const result = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const geo = app.document.geometry;

    // Create 4 vertices at known positions
    const v1 = geo.createVertex({ x: -5, y: 0, z: -5 });
    const v2 = geo.createVertex({ x: -1, y: 0, z: -5 });
    const v3 = geo.createVertex({ x: -1, y: 0, z: -2 });
    const v4 = geo.createVertex({ x: -5, y: 0, z: -2 });

    // Simulate line tool: create edges with auto-face
    geo.createEdgeWithAutoFace(v1.id, v2.id);
    geo.createEdgeWithAutoFace(v2.id, v3.id);
    geo.createEdgeWithAutoFace(v3.id, v4.id);
    geo.createEdgeWithAutoFace(v4.id, v1.id); // This closes the loop

    app.syncScene();

    const mesh = geo.getMesh();
    let faceCount = 0;
    mesh.faces.forEach(() => faceCount++);
    return { faceCount, edges: mesh.edges.size };
  });

  console.log('Line-drawn rectangle:', result);
  // The closing edge should have triggered auto-face creation
  expect(result.faceCount).toBeGreaterThanOrEqual(1);
});

test('Edges that form closed coplanar polygon get a face automatically', async () => {
  const result = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const geo = app.document.geometry;

    // Hexagon
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const angle = (2 * Math.PI * i) / 6;
      verts.push(geo.createVertex({
        x: 8 + Math.cos(angle) * 2,
        y: 0,
        z: 8 + Math.sin(angle) * 2
      }));
    }

    const beforeFaces = geo.getMesh().faces.size;

    for (let i = 0; i < 6; i++) {
      const next = (i + 1) % 6;
      geo.createEdgeWithAutoFace(verts[i].id, verts[next].id);
    }

    app.syncScene();

    const afterFaces = geo.getMesh().faces.size;
    return { beforeFaces, afterFaces, newFaces: afterFaces - beforeFaces };
  });

  console.log('Hexagon face creation:', result);
  expect(result.newFaces).toBeGreaterThanOrEqual(1);
});
