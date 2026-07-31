// @archigraph renderer.webgl
// The sky background is a view-direction dome, not screen wallpaper:
// level view → blue above / tan below; looking straight down → ground
// everywhere; looking straight up → sky everywhere.
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

test('sky gradient tracks the horizon, not the screen', async () => {
  // Enable Sky
  await page.locator('.views-toolbar button:has-text("Sky")').click();
  await page.waitForTimeout(300);

  const sample = async (pose: 'level' | 'down' | 'up') => {
    return page.evaluate(async (p: string) => {
      const a = (window as any).__debugApp;
      const cam = a.viewport.camera;
      if (p === 'level') {
        cam.position = { x: 0, y: 1.7, z: 20 };
        cam.target = { x: 0, y: 1.7, z: 0 }; // horizontal gaze
      } else if (p === 'down') {
        cam.position = { x: 0, y: 30, z: 0 };
        cam.target = { x: 0.01, y: 0, z: 0 };
      } else {
        cam.position = { x: 0, y: 1, z: 0 };
        cam.target = { x: 0.01, y: 50, z: 0 };
      }
      cam.lookAt(cam.target);

      const dataUrl: string = a.viewport.renderer.captureImage(1, 'image/png');
      const img = new Image();
      await new Promise(res => { img.onload = res; img.src = dataUrl; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = (x: number, y: number) => {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
      return {
        top: px(img.width / 2, img.height * 0.06),
        bottom: px(img.width / 2, img.height * 0.94),
      };
    }, pose);
  };

  const isSky = (c: { r: number; g: number; b: number }) => c.b > c.r + 10;
  const isGround = (c: { r: number; g: number; b: number }) => c.r >= c.b;

  // Level gaze: sky on top, ground on bottom
  const level = await sample('level');
  console.log('level:', JSON.stringify(level));
  expect(isSky(level.top)).toBe(true);
  expect(isGround(level.bottom)).toBe(true);

  // Looking straight down: ground fills the view — INCLUDING the top of the
  // screen. A screen-locked gradient would still show blue up there.
  const down = await sample('down');
  console.log('down:', JSON.stringify(down));
  expect(isGround(down.top)).toBe(true);
  expect(isGround(down.bottom)).toBe(true);

  // Looking straight up: sky everywhere, including the bottom of the screen.
  const up = await sample('up');
  console.log('up:', JSON.stringify(up));
  expect(isSky(up.top)).toBe(true);
  expect(isSky(up.bottom)).toBe(true);
});
