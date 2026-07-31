// @archigraph system.components
// classic CAD component instancing: copying a component makes an INSTANCE of
// the same family; editing one instance propagates to all siblings on exit.
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

test('editing one instance updates its copy', async () => {
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);

  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Draw a rectangle and make it a component (programmatically — the UI
  // button lives in Entity Info; the scene API is the same code path).
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 200, cy - 60);
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 120, cy);
  await page.waitForTimeout(300);

  const compId = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    const geo = a.document.geometry;
    const mesh = geo.getMesh();
    const ids: string[] = [];
    for (const fid of mesh.faces.keys()) ids.push(fid);
    for (const eid of mesh.edges.keys()) ids.push(eid);
    return a.document.scene.createComponent('Door', ids);
  });
  expect(compId).toBeTruthy();

  // Copy the component via the Move tool programmatically-selected component
  await resetToolState(page);
  await page.evaluate((id) => {
    (window as any).__debugApp.document.selection.select(id);
  }, compId);
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  // Cmd+click base point, then click destination — copy mode
  await page.keyboard.down('Meta');
  await page.mouse.click(cx - 160, cy - 30);
  await page.keyboard.up('Meta');
  await page.waitForTimeout(300);
  await page.mouse.click(cx + 40, cy - 30);
  await page.waitForTimeout(400);

  const state1 = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    const sm = a.document.scene;
    return {
      components: sm.components.size,
      families: sm.componentFamilies.size,
      faces: a.document.geometry.getMesh().faces.size,
    };
  });
  console.log('after copy:', JSON.stringify(state1));
  expect(state1.components).toBe(2);
  expect(state1.families).toBe(1); // both instances share ONE family
  expect(state1.faces).toBe(2);

  // Edit the ORIGINAL instance: enter edit mode, draw a line splitting its
  // face (2 faces), exit — the copy must also become 2 faces (4 total + splits).
  await page.evaluate((id) => {
    (window as any).__debugApp.document.scene.enterComponent(id);
  }, compId);
  await page.waitForTimeout(200);

  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  // Line across the original rect (from top edge midpoint to bottom edge midpoint)
  await page.mouse.move(cx - 160, cy - 60);
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 160, cy - 60);
  await page.waitForTimeout(200);
  await page.mouse.move(cx - 160, cy);
  await page.waitForTimeout(250);
  await page.mouse.click(cx - 160, cy);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const midState = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    return { faces: a.document.geometry.getMesh().faces.size };
  });
  console.log('after edit (before exit):', JSON.stringify(midState));

  // Exit component edit → propagation
  await page.evaluate(() => {
    (window as any).__debugApp.document.scene.exitComponent();
  });
  await page.waitForTimeout(500);

  const state2 = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    const geo = a.document.geometry;
    const mesh = geo.getMesh();
    const areas = [...mesh.faces.keys()].map((f: string) => +geo.computeFaceArea(f).toFixed(4)).sort();
    return { faces: mesh.faces.size, areas };
  });
  console.log('after exit:', JSON.stringify(state2));

  // The original was split into 2 faces; the sibling instance must now have
  // 2 matching faces too.
  expect(state2.faces).toBe(midState.faces + 1);
});

test('rotated instance receives edits in its rotated pose', async () => {
  // Fresh doc; build + component + copy + rotate the copy 90° — all scripted
  await page.evaluate(() => (window as any).__debugApp.newDocument());
  await page.waitForTimeout(400);

  const setup = await page.evaluate(() => {
    const a = (window as any).__debugApp;
    const geo = a.document.geometry;
    const sm = a.document.scene;

    // 2×1 rectangle at origin
    const v1 = geo.createVertex({ x: 0, y: 0, z: 0 });
    const v2 = geo.createVertex({ x: 2, y: 0, z: 0 });
    const v3 = geo.createVertex({ x: 2, y: 0, z: 1 });
    const v4 = geo.createVertex({ x: 0, y: 0, z: 1 });
    for (const [p, q] of [[v1, v2], [v2, v3], [v3, v4], [v4, v1]]) geo.createEdge(p.id, q.id);
    const face = geo.createFace([v1.id, v2.id, v3.id, v4.id]);
    const edgeIds = geo.getFaceEdges(face.id).map((e: any) => e.id);
    const compA = sm.createComponent('Panel', [face.id, ...edgeIds]);

    // Copy at +5x, rotated 90° about Y at its centroid — register instance
    const q90 = { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) };
    const rot = (p: any) => ({ x: p.z + 5, y: p.y, z: -(p.x - 1) + 0.5 }); // 90° about Y at (1,0,0.5), then +5x
    const w1 = geo.createVertex(rot({ x: 0, y: 0, z: 0 }));
    const w2 = geo.createVertex(rot({ x: 2, y: 0, z: 0 }));
    const w3 = geo.createVertex(rot({ x: 2, y: 0, z: 1 }));
    const w4 = geo.createVertex(rot({ x: 0, y: 0, z: 1 }));
    for (const [p, q] of [[w1, w2], [w2, w3], [w3, w4], [w4, w1]]) geo.createEdge(p.id, q.id);
    const faceB = geo.createFace([w1.id, w2.id, w3.id, w4.id]);
    const edgeIdsB = geo.getFaceEdges(faceB.id).map((e: any) => e.id);
    const compB = sm.createComponent('Panel', [faceB.id, ...edgeIdsB]);
    sm.linkInstanceToFamily(compA, compB);
    sm.accumulateComponentRotation(compB, q90);
    a.sceneBridge.sync(true);
    return { compA, compB };
  });

  // Edit instance A: split it with a line along its LONG axis midline
  await page.evaluate((compA: string) => {
    const a = (window as any).__debugApp;
    a.document.scene.enterComponent(compA);
    const geo = a.document.geometry;
    const m1 = geo.createVertex({ x: 1, y: 0, z: 0 });
    const m2 = geo.createVertex({ x: 1, y: 0, z: 1 });
    geo.createEdgeWithIntersection(m1.id, m2.id);
    // register new pieces into the component
    const comp = a.document.scene.components.get(compA);
    const mesh = geo.getMesh();
    for (const fid of mesh.faces.keys()) {
      // faces near x∈[0,2],z∈[0,1] belong to A
      const f = mesh.faces.get(fid);
      const p = mesh.vertices.get(f.vertexIds[0]).position;
      if (p.x <= 2.5 && Math.abs(p.y) < 0.01) comp.entityIds.add(fid);
    }
    a.document.scene.exitComponent();
  }, setup.compA);
  await page.waitForTimeout(500);

  const check = await page.evaluate((compB: string) => {
    const a = (window as any).__debugApp;
    const geo = a.document.geometry;
    const comp = a.document.scene.components.get(compB);
    // The rebuilt rotated sibling: gather its face count + verify its
    // geometry still lies in the rotated orientation (long axis along Z).
    let faces = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const id of comp.entityIds) {
      const f = geo.getFace(id);
      if (!f) continue;
      faces++;
      for (const vid of f.vertexIds) {
        const p = geo.getVertex(vid).position;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
    }
    return { faces, spanX: maxX - minX, spanZ: maxZ - minZ };
  }, setup.compB);

  console.log('rotated sibling:', JSON.stringify(check));
  // The edit split A into 2 faces → B rebuilt with 2 faces too
  expect(check.faces).toBe(2);
  // B is rotated 90°: its LONG axis (2 units) must run along Z, short (1) along X
  expect(check.spanZ).toBeGreaterThan(1.9);
  expect(check.spanX).toBeLessThan(1.1);
});
