// @archigraph system.snap
// classic CAD inference pack: Center snap on circles/arcs, and
// perpendicular-to-edge inference while drawing from a point on an edge.
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, resetToolState } from './helpers';
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

test('hovering a circle center shows the Center snap', async () => {
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Draw a circle centered at (cx-60, cy)
  await page.keyboard.press('c');
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 60, cy);
  await page.waitForTimeout(200);
  await page.mouse.move(cx + 40, cy);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 40, cy);
  await page.waitForTimeout(400);

  // Start a line and hover near the circle's center — snap kind must be 'center'
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  await page.mouse.move(cx - 60 + 4, cy + 4); // a few px off the exact center
  await page.waitForTimeout(300);

  const snapKind = await page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    return (appRef.sceneBridge as any).getLastSnapKind?.() ?? null;
  });
  expect(snapKind).toBe('center');
});

test('drawing from an edge midpoint perpendicular snaps exactly', async () => {
  await resetToolState(page);
  await page.evaluate(() => (window as any).__debugApp.newDocument());
  await page.waitForTimeout(500);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // A DIAGONAL loose edge (≈34° off the axes) so its perpendicular does not
  // coincide with any world axis — axis inference must not claim it.
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  // Keep clear of the world origin at screen center — its 21px snap would
  // hijack the cursor mid-test.
  await page.mouse.click(cx + 80, cy - 50);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 200, cy - 130);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // New line from the edge's midpoint, heading ~3° OFF perpendicular —
  // perpendicular inference must square it exactly.
  const midX = cx + 140, midY = cy - 90;
  await page.mouse.move(midX, midY);
  await page.waitForTimeout(250);
  await page.mouse.click(midX, midY);
  await page.waitForTimeout(200);
  // Edge dir ≈ (120,-80) in screen px → perpendicular ≈ (80,120); offset a
  // few px sideways for the ~3° error.
  await page.mouse.move(midX + 72 + 6, midY + 108 - 4);
  await page.waitForTimeout(300);

  const label = await page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    const tool = appRef.toolManager?.getActiveTool?.();
    return tool?.getInferenceLabel?.() ?? null;
  });
  console.log('inference label:', label);
  expect(label).toBe('Perpendicular to Edge');

  // Commit at the SAME position the inference was shown for
  await page.mouse.click(midX + 72 + 6, midY + 108 - 4);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const dot = await page.evaluate(() => {
    const appRef = (window as any).__debugApp;
    const mesh = appRef.document.geometry.getMesh();
    // Find the newest edge (the drawn line) and the rectangle's bottom edge:
    // bottom edge = the one whose two vertices have max z (screen-down in top view)
    // Simpler: find the drawn edge as the one NOT part of any face.
    const geo = appRef.document.geometry;
    let drawn: any = null;
    for (const [eid, e] of mesh.edges) {
      if (geo.getEdgeFaces(eid).length === 0) drawn = e;
    }
    if (!drawn) return null;
    const dv = (a: any, b: any) => ({ x: b.position.x - a.position.x, y: b.position.y - a.position.y, z: b.position.z - a.position.z });
    const v1 = mesh.vertices.get(drawn.startVertexId);
    const v2 = mesh.vertices.get(drawn.endVertexId);
    const d1 = dv(v1, v2);
    const len1 = Math.hypot(d1.x, d1.y, d1.z);
    // The edge it starts on: any face edge containing v1
    for (const [eid, e] of mesh.edges) {
      if (e === drawn) continue;
      const a = mesh.vertices.get(e.startVertexId);
      const b = mesh.vertices.get(e.endVertexId);
      if (!a || !b) continue;
      // does the drawn line start on this edge (midpoint split may have split it)?
      const d = dv(a, b);
      const lenSq = d.x * d.x + d.y * d.y + d.z * d.z;
      if (lenSq < 1e-12) continue;
      const t = ((v1.position.x - a.position.x) * d.x + (v1.position.y - a.position.y) * d.y + (v1.position.z - a.position.z) * d.z) / lenSq;
      if (t < -0.01 || t > 1.01) continue;
      const px = a.position.x + t * d.x - v1.position.x;
      const py = a.position.y + t * d.y - v1.position.y;
      const pz = a.position.z + t * d.z - v1.position.z;
      if (px * px + py * py + pz * pz > 1e-6) continue;
      const len2 = Math.sqrt(lenSq);
      return Math.abs((d1.x * d.x + d1.y * d.y + d1.z * d.z) / (len1 * len2));
    }
    return null;
  });
  console.log('|cos angle| between drawn line and host edge:', dot);
  expect(dot).not.toBeNull();
  expect(dot!).toBeLessThan(1e-6); // exactly perpendicular
});
