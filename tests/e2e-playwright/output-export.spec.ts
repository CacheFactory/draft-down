// @archigraph process.renderer
// Output: high-res PNG capture and PDF sheet generation produce valid bytes.
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

test('captureImage returns a supersampled PNG; PDF builder emits valid PDF', async () => {
  // Draw something so the frame isn't empty
  const canvas = page.locator('.viewport-container canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  await page.mouse.click(cx - 100, cy - 60);
  await page.waitForTimeout(200);
  await page.mouse.click(cx + 20, cy + 40);
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    const a = (window as any).__debugApp;
    const renderer = a.viewport.renderer;

    // PNG capture at 2×
    const png: string = renderer.captureImage(2, 'image/png');
    const pngOk = png.startsWith('data:image/png;base64,') && png.length > 20000;

    // Canvas back at live size afterwards
    const canvasEl = document.querySelector('.viewport-container canvas') as HTMLCanvasElement;
    const sizeRestored = Math.abs(canvasEl.getBoundingClientRect().width - canvasEl.clientWidth) < 2;

    // PDF from two "scenes"
    const jpeg: string = renderer.captureImage(1, 'image/jpeg', 0.9);
    const mod = await (window as any).__pdfTest ?? null;
    return { pngOk, sizeRestored, jpegLen: jpeg.length, pngLen: png.length };
  });
  console.log('capture:', JSON.stringify(result));
  expect(result.pngOk).toBe(true);
  expect(result.sizeRestored).toBe(true);

  // Build a PDF via the real builder (renderer bundle) using an in-page scene
  const pdfCheck = await page.evaluate(async () => {
    const a = (window as any).__debugApp;
    // Add one scene page so exportPdf uses the scene path
    const cam = a.viewport.camera;
    a.document.scene.addScenePage({
      name: 'Sheet A',
      cameraPosition: { ...cam.position },
      cameraTarget: { ...cam.target },
      cameraFov: 45,
      projection: 'perspective',
      renderMode: 'shaded',
      layerVisibility: {},
    });
    // Capture via the test sink (window.api is contextBridge-frozen, so
    // intercepting the IPC isn't possible — the sink bypasses the dialog).
    let captured: ArrayBuffer | null = null;
    await a.exportPdf((data: ArrayBuffer) => { captured = data; });
    if (!captured) return { ok: false };
    const bytes = new Uint8Array(captured);
    const header = String.fromCharCode(...bytes.slice(0, 8));
    const tail = String.fromCharCode(...bytes.slice(-32));
    return {
      ok: true,
      size: bytes.length,
      headerOk: header.startsWith('%PDF-1.4'),
      eofOk: tail.includes('%%EOF'),
    };
  });
  console.log('pdf:', JSON.stringify(pdfCheck));
  expect(pdfCheck.ok).toBe(true);
  expect(pdfCheck.headerOk).toBe(true);
  expect(pdfCheck.eofOk).toBe(true);
  expect(pdfCheck.size).toBeGreaterThan(10000);
});
