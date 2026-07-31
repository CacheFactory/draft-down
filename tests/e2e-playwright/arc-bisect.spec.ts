import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'warn') console.log(`[${msg.type()}]`, msg.text());
  });
});

test.afterAll(async () => {
  await closeApp(app);
});

test('Arc bisects a rectangle into two selectable faces', async () => {
  // Create rectangle + arc programmatically and verify faces
  const result = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const geo = app.document.geometry;

    // Rectangle
    const v1 = geo.createVertex({ x: 0, y: 0, z: 0 });
    const v2 = geo.createVertex({ x: 6, y: 0, z: 0 });
    const v3 = geo.createVertex({ x: 6, y: 0, z: 4 });
    const v4 = geo.createVertex({ x: 0, y: 0, z: 4 });
    geo.createEdge(v1.id, v2.id);
    geo.createEdge(v2.id, v3.id);
    geo.createEdge(v3.id, v4.id);
    geo.createEdge(v4.id, v1.id);
    geo.createFace([v1.id, v2.id, v3.id, v4.id]);

    let mesh = geo.getMesh();
    const beforeFaces = mesh.faces.size;

    // Arc from v2 to v4 through intermediate point v5
    const v5 = geo.createVertex({ x: 3, y: 0, z: 2 }); // inside the rectangle

    // Create arc edges with auto-face
    geo.createEdgeWithAutoFace(v2.id, v5.id);
    geo.createEdgeWithAutoFace(v5.id, v4.id);

    // Split the face with the arc path
    geo.splitFaceWithPath([v2.id, v5.id, v4.id]);

    mesh = geo.getMesh();
    const afterFaces = mesh.faces.size;

    // Collect face info
    const faces: Array<{ id: string; verts: number }> = [];
    mesh.faces.forEach((f: any, id: string) => {
      faces.push({ id: id.slice(0, 8), verts: f.vertexIds.length });
    });

    app.syncScene();

    return { beforeFaces, afterFaces, faces };
  });

  console.log('Before:', result.beforeFaces, 'After:', result.afterFaces, 'Faces:', result.faces);

  // Should have more than 1 face after bisection
  expect(result.afterFaces).toBeGreaterThan(1);

  // Both faces should be selectable via raycast
  const selectResult = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const mesh = app.document.geometry.getMesh();
    const faceIds: string[] = [];
    mesh.faces.forEach((_: any, id: string) => faceIds.push(id));

    // Try selecting each face
    const selectable: string[] = [];
    for (const fid of faceIds) {
      app.document.selection.select(fid);
      if (app.document.selection.count === 1) {
        selectable.push(fid.slice(0, 8));
      }
    }

    return { totalFaces: faceIds.length, selectable: selectable.length };
  });

  console.log('Selectable:', selectResult);
  expect(selectResult.selectable).toBe(selectResult.totalFaces);
});

test('Line tool multi-segment bisects rectangle on deactivate', async () => {
  const result = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const geo = app.document.geometry;

    // Fresh geometry
    const v1 = geo.createVertex({ x: 10, y: 0, z: 0 });
    const v2 = geo.createVertex({ x: 16, y: 0, z: 0 });
    const v3 = geo.createVertex({ x: 16, y: 0, z: 4 });
    const v4 = geo.createVertex({ x: 10, y: 0, z: 4 });
    geo.createEdge(v1.id, v2.id);
    geo.createEdge(v2.id, v3.id);
    geo.createEdge(v3.id, v4.id);
    geo.createEdge(v4.id, v1.id);
    geo.createFace([v1.id, v2.id, v3.id, v4.id]);

    const beforeFaces = geo.getMesh().faces.size;

    // Simulate what the line tool does: draw a multi-segment line from v1 through v5 to v3
    const v5 = geo.createVertex({ x: 13, y: 0, z: 2 });

    // Begin transaction like LineTool does
    app.document.history.beginTransaction('Draw Line');
    geo.createEdgeWithAutoFace(v1.id, v5.id);
    geo.createEdgeWithAutoFace(v5.id, v3.id);

    // splitFaceWithPath like LineTool.deactivate does
    geo.splitFaceWithPath([v1.id, v5.id, v3.id]);
    app.document.history.commitTransaction();

    app.syncScene();

    const mesh = geo.getMesh();
    const faces: Array<{ verts: number }> = [];
    mesh.faces.forEach((f: any) => faces.push({ verts: f.vertexIds.length }));

    return { beforeFaces, afterFaces: mesh.faces.size, faces };
  });

  console.log('Line bisect — Before:', result.beforeFaces, 'After:', result.afterFaces, 'Faces:', result.faces);
  expect(result.afterFaces).toBeGreaterThan(1);
});

test('Simple diagonal line bisects rectangle (single edge)', async () => {
  const result = await page.evaluate(() => {
    const app = (window as any).__debugApp;
    const geo = app.document.geometry;

    const v1 = geo.createVertex({ x: 20, y: 0, z: 0 });
    const v2 = geo.createVertex({ x: 24, y: 0, z: 0 });
    const v3 = geo.createVertex({ x: 24, y: 0, z: 3 });
    const v4 = geo.createVertex({ x: 20, y: 0, z: 3 });
    geo.createEdge(v1.id, v2.id);
    geo.createEdge(v2.id, v3.id);
    geo.createEdge(v3.id, v4.id);
    geo.createEdge(v4.id, v1.id);
    geo.createFace([v1.id, v2.id, v3.id, v4.id]);

    const before = geo.getMesh().faces.size;

    // Single diagonal edge from v1 to v3
    geo.createEdgeWithAutoFace(v1.id, v3.id);

    const after = geo.getMesh().faces.size;
    app.syncScene();

    return { before, after };
  });

  console.log('Diagonal — Before:', result.before, 'After:', result.after);
  // The diagonal should add 1 face (split = delete 1 + create 2 = net +1)
  expect(result.after).toBe(result.before + 1);
});
