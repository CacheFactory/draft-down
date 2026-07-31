// E2E repro: cube + edge bisecting a face → delete a face → NO edge-less
// inner faces may appear. Drives the real UI: rectangle, push/pull, line,
// select, Delete key — all via mouse/keyboard with snapping active.
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let box: { x: number; y: number; width: number; height: number };

async function screenPos(wx: number, wy: number, wz: number): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(([x, y, z]) => {
    const a = (window as any).__debugApp;
    return a.viewport.worldToScreen({ x, y, z });
  }, [wx, wy, wz]);
  return { x: box.x + p.x, y: box.y + p.y };
}

async function clickWorld(wx: number, wy: number, wz: number) {
  const p = await screenPos(wx, wy, wz);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(150);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
}

async function pressKey(k: string) {
  await page.locator('.viewport-container').click({ position: { x: 5, y: 5 }, trial: true }).catch(() => {});
  await page.keyboard.press(k);
  await page.waitForTimeout(150);
}

async function typeVCB(value: string) {
  const vcb = page.locator('.vcb-input');
  await vcb.click();
  await vcb.fill(value);
  await vcb.press('Enter');
  await page.waitForTimeout(250);
}

/** In-app invariant check: every consecutive ring pair of every face has a real edge. */
async function meshReport() {
  return page.evaluate(() => {
    const a = (window as any).__debugApp;
    const mesh = a.document.geometry.mesh ?? (a.document.geometry as any).mesh;
    const missing: string[] = [];
    const faces: string[] = [];
    for (const [fid, f] of mesh.faces) {
      const fv = f.vertexIds;
      const ringStarts = [0, ...(f.holeStartIndices ?? [])];
      const coords = (vid: string) => {
        const v = mesh.vertices.get(vid);
        return v ? `(${v.position.x.toFixed(2)},${v.position.y.toFixed(2)},${v.position.z.toFixed(2)})` : vid;
      };
      faces.push(`${fid.slice(0, 8)} n=${fv.length} :: ${fv.map(coords).join(' ')}`);
      for (let r = 0; r < ringStarts.length; r++) {
        const start = ringStarts[r];
        const end = r + 1 < ringStarts.length ? ringStarts[r + 1] : fv.length;
        for (let i = start; i < end; i++) {
          const j = i + 1 < end ? i + 1 : start;
          if (!mesh.findEdgeBetween(fv[i], fv[j])) {
            missing.push(`face ${fid.slice(0, 8)} pair ${coords(fv[i])}→${coords(fv[j])}`);
          }
        }
      }
    }
    return { faceCount: mesh.faces.size, edgeCount: mesh.edges.size, missing, faces };
  });
}

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500);
  const canvas = page.locator('.viewport-container canvas');
  const b = await canvas.boundingBox();
  if (!b) throw new Error('Canvas not found');
  box = b;
});

test.afterAll(async () => {
  await closeApp(app);
});

test.describe.serial('cube + bisect + delete via real UI', () => {
  test('build cube with rectangle + pushpull', async () => {
    // Iso view: default. Rectangle on ground
    await page.locator('.viewport-container').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('r');
    await page.waitForTimeout(200);
    await clickWorld(0, 0, 0);
    await clickWorld(2, 0, 2);

    // Push/pull the face up 2m
    await page.keyboard.press('p');
    await page.waitForTimeout(200);
    await clickWorld(1, 0, 1);
    const up = await screenPos(1, 1, 1);
    await page.mouse.move(up.x, up.y, { steps: 5 });
    await page.waitForTimeout(150);
    await typeVCB('2');

    const rep = await meshReport();
    console.log('after cube:', rep.faceCount, 'faces,', rep.edgeCount, 'edges');
    expect(rep.faceCount).toBe(6);
    expect(rep.missing).toEqual([]);
  });

  test('bisect top face with line tool', async () => {
    await page.keyboard.press('l');
    await page.waitForTimeout(200);
    // Cube spans y in [-2, 0]; visible top face is the y=0 rectangle.
    // Midpoints of two opposite top edges — midpoint snap grabs exact points
    await clickWorld(1, 0, 0);
    await clickWorld(1, 0, 2);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const rep = await meshReport();
    console.log('after bisect:', rep.faceCount, 'faces,', rep.edgeCount, 'edges');
    console.log(rep.faces.join('\n'));
    expect(rep.missing).toEqual([]);
    expect(rep.faceCount).toBe(7); // top split in two
  });

  test('delete one top half with Delete key', async () => {
    await page.keyboard.press(' '); // Select tool
    await page.waitForTimeout(200);
    await clickWorld(0.5, 0, 1); // center of one top half
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    const rep = await meshReport();
    console.log('after delete half:', rep.faceCount, 'faces');
    console.log(rep.faces.join('\n'));
    expect(rep.missing).toEqual([]);
    expect(rep.faceCount).toBe(6);
  });

  test('delete a side face too', async () => {
    await clickWorld(2, -1, 1); // x=2 side wall center (camera-facing in iso)
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    const rep = await meshReport();
    console.log('after delete side:', rep.faceCount, 'faces');
    console.log(rep.faces.join('\n'));
    await page.screenshot({ path: 'test-results/bisect-delete-final.png' });
    expect(rep.missing).toEqual([]);
    expect(rep.faceCount).toBe(5);
  });
});
