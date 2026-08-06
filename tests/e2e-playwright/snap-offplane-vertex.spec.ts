// Regression: a HARD point snap must beat the line tool's locked face plane.
// Drawing a line whose first click lands on a face, then snapping a later
// point to a vertex OFF that plane, must commit the vertex's exact 3D
// position — not its projection onto the locked plane (which coincides in
// screen space but floats in space from any other camera angle).
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let box: { x: number; y: number; width: number; height: number };

async function screenPos(wx: number, wy: number, wz: number) {
  const p = await page.evaluate(([x, y, z]) => (window as any).__debugApp.viewport.worldToScreen({ x, y, z }), [wx, wy, wz]);
  return { x: box.x + p.x, y: box.y + p.y };
}

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
  box = (await page.locator('.viewport-container canvas').boundingBox())!;
});
test.afterAll(async () => { await closeApp(app); });

test('line from a face snaps exactly to an off-plane vertex', async () => {
  await page.evaluate(() => {
    const a = (window as any).__debugApp;
    const geo = a.document.geometry;
    // Ground face 4x4 at y=0
    const g1 = geo.createVertex({ x: 0, y: 0, z: 0 });
    const g2 = geo.createVertex({ x: 4, y: 0, z: 0 });
    const g3 = geo.createVertex({ x: 4, y: 0, z: 4 });
    const g4 = geo.createVertex({ x: 0, y: 0, z: 4 });
    geo.createEdge(g1.id, g2.id); geo.createEdge(g2.id, g3.id);
    geo.createEdge(g3.id, g4.id); geo.createEdge(g4.id, g1.id);
    geo.createFace([g1.id, g2.id, g3.id, g4.id]);
    // Raised edge with a vertex clearly OFF the ground plane
    const r1 = geo.createVertex({ x: 6, y: 2, z: 1 });
    const r2 = geo.createVertex({ x: 6, y: 2, z: 3 });
    geo.createEdge(r1.id, r2.id);
    a.syncScene();
  });

  await page.locator('.viewport-container').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('l');
  await page.waitForTimeout(200);

  // First click ON the ground face (locks the face plane)
  const start = await screenPos(2, 0, 2);
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(150);
  await page.mouse.click(start.x, start.y);
  await page.waitForTimeout(200);

  // Second point: snap to the RAISED vertex (6,2,1) — off the locked plane
  const end = await screenPos(6, 2, 1);
  await page.mouse.move(end.x + 2, end.y + 1, { steps: 3 });
  await page.waitForTimeout(400);
  const kind = await page.evaluate(() => (window as any).__debugApp.sceneBridge.getLastSnapKind?.());
  console.log('hover kind at raised vertex:', kind);
  await page.mouse.click(end.x + 2, end.y + 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => {
    const m = (window as any).__debugApp.document.geometry.getMesh();
    const verts = [...m.vertices.values()];
    const raised = verts.find((v: any) => Math.hypot(v.position.x - 6, v.position.y - 2, v.position.z - 1) < 1e-6);
    const edges = [...m.edges.values()].map((e: any) => [
      m.vertices.get(e.startVertexId)?.position,
      m.vertices.get(e.endVertexId)?.position,
    ]);
    // The committed line edge starts near (2,0,2); report its OTHER endpoint.
    const isStart = (p: any) => p && Math.hypot(p.x - 2, p.y, p.z - 2) < 0.5;
    const lineEnds = edges.filter(([a, b]) => isStart(a) || isStart(b)).map(([a, b]) => (isStart(a) ? b : a));
    return { vertexCount: verts.length, raisedExists: !!raised, lineEnds };
  });
  console.log('committed line endpoints:', JSON.stringify(result));
  expect(result.raisedExists).toBe(true);
  // 6 setup verts + 1 start vert = 7. Pre-fix an 8th appears at the plane
  // projection (same screen ray, wrong depth) and the line ends there.
  expect(result.vertexCount).toBe(7);
  expect(result.lineEnds.length).toBe(1);
  expect(result.lineEnds[0].x).toBeCloseTo(6, 9);
  expect(result.lineEnds[0].y).toBeCloseTo(2, 9);
  expect(result.lineEnds[0].z).toBeCloseTo(1, 9);
});
