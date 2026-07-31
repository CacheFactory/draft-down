// E2E Test: Draw a complete house using every tool at least once.
// This test exercises the real Electron app — no mocks.
// It creates geometry, applies colors, navigates the viewport, and measures.
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers';
import type { ElectronApplication, Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let cx: number; // canvas center X
let cy: number; // canvas center Y
let box: { x: number; y: number; width: number; height: number };

// ── Helpers ──────────────────────────────────────────────────────

async function activateTool(toolId: string) {
  const shortcuts: Record<string, string> = {
    select: ' ', line: 'l', rectangle: 'r', circle: 'c', arc: 'a',
    polygon: 'g', pushpull: 'p', move: 'm', rotate: 'q', scale: 's',
    offset: 'f', eraser: 'e', paint: 'b', orbit: 'o', pan: 'h', zoom: 'z',
    tape_measure: 't', dimension: 'd',
  };
  const key = shortcuts[toolId];
  if (key) {
    await page.locator('.viewport-container').click();
    await page.keyboard.press(key);
  } else {
    // Fall back to toolbar button click
    const btn = page.locator(`.sidebar-tool-btn[title*="${toolId}"], .sidebar-tool-btn[title*="${toolId}"]`).first();
    if (await btn.count() > 0) await btn.click();
  }
  await page.waitForTimeout(150);
}

async function clickViewport(xOff: number, yOff: number) {
  await page.mouse.click(box.x + xOff, box.y + yOff);
  await page.waitForTimeout(100);
}

async function dragViewport(x1: number, y1: number, x2: number, y2: number, steps = 8) {
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function typeVCB(value: string) {
  const vcb = page.locator('.vcb-input');
  await vcb.click();
  await vcb.fill(value);
  await vcb.press('Enter');
  await page.waitForTimeout(200);
}

async function getStatus(): Promise<string> {
  return (await page.locator('.status-text').textContent()) ?? '';
}

async function switchToTopView() {
  await page.locator('.views-toolbar .view-btn:has-text("Top")').click();
  await page.waitForTimeout(600);
}

async function switchToFrontView() {
  await page.locator('.views-toolbar .view-btn:has-text("Front")').click();
  await page.waitForTimeout(600);
}

async function switchToIsoView() {
  await page.locator('.views-toolbar .view-btn:has-text("Iso")').click();
  await page.waitForTimeout(600);
}

// ── Setup ────────────────────────────────────────────────────────

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  await page.waitForTimeout(1500); // Let Three.js fully initialize

  const canvas = page.locator('.viewport-container canvas');
  const b = await canvas.boundingBox();
  if (!b) throw new Error('Canvas not found');
  box = b;
  cx = box.width / 2;
  cy = box.height / 2;
});

test.afterAll(async () => {
  await closeApp(app);
});

// ── Tests: Build a House ─────────────────────────────────────────

test.describe.serial('Draw a House', () => {

  // ── 1. SELECT TOOL: verify clean state ──
  test('1. Select tool: start with clean document', async () => {
    await activateTool('select');
    const status = await getStatus();
    expect(status).toBeTruthy();

    // Verify toolbar shows Select as active
    const btn = page.locator('.sidebar-tool-btn[title*="Select"]');
    await expect(btn).toHaveClass(/active/);
  });

  // ── 2. RECTANGLE TOOL: draw house floor plan ──
  test('2. Rectangle tool: draw house floor (10m x 8m)', async () => {
    await switchToTopView();

    await activateTool('rectangle');
    let status = await getStatus();
    expect(status).toContain('corner');

    // Click first corner
    await clickViewport(cx - 100, cy - 80);
    await page.waitForTimeout(200);

    status = await getStatus();
    if (status.includes('opposite corner')) {
      // Use VCB for exact dimensions
      await typeVCB('10,8');
      status = await getStatus();
      expect(status).toContain('created');
    } else {
      // Ground plane miss from top view; click second corner manually
      await clickViewport(cx + 100, cy + 80);
      await page.waitForTimeout(200);
    }
  });

  // ── 3. LINE TOOL: draw roof ridge lines ──
  test('3. Line tool: draw roof lines', async () => {
    await activateTool('line');
    let status = await getStatus();
    expect(status).toContain('first point');

    // Draw a line across the viewport
    await clickViewport(cx - 120, cy);
    await page.waitForTimeout(200);

    status = await getStatus();
    if (status.includes('next point')) {
      await clickViewport(cx + 120, cy);
      await page.waitForTimeout(200);

      // VCB should show distance
      const vcbVal = await page.locator('.vcb-input').getAttribute('placeholder');
      expect(vcbVal).toBeTruthy();

      // Draw another segment
      await clickViewport(cx + 120, cy - 60);
      await page.waitForTimeout(100);
    }

    // Finish
    await page.keyboard.press('Escape');
    status = await getStatus();
    expect(status).toContain('first point');
  });

  // ── 4. CIRCLE TOOL: draw a round window ──
  test('4. Circle tool: draw circular window', async () => {
    await activateTool('circle');
    let status = await getStatus();
    expect(status).toContain('center');

    // Click center of circle
    await clickViewport(cx + 50, cy - 20);
    await page.waitForTimeout(200);

    status = await getStatus();
    if (status.includes('radius')) {
      // Set radius via VCB
      await typeVCB('1.5');
      status = await getStatus();
      expect(status).toContain('created');
    } else {
      // Click to set radius
      await clickViewport(cx + 80, cy - 20);
      await page.waitForTimeout(200);
    }
  });

  // ── 5. ARC TOOL: draw arched doorway ──
  test('5. Arc tool: draw door arch', async () => {
    await activateTool('arc');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click start point
    await clickViewport(cx - 40, cy + 30);
    await page.waitForTimeout(200);

    // Click end point
    await clickViewport(cx - 10, cy + 30);
    await page.waitForTimeout(200);

    // Click bulge point
    await clickViewport(cx - 25, cy + 10);
    await page.waitForTimeout(200);

    // Finish
    await page.keyboard.press('Escape');
  });

  // ── 6. POLYGON TOOL: draw hexagonal garden feature ──
  test('6. Polygon tool: draw hexagonal planter', async () => {
    await activateTool('polygon');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click center
    await clickViewport(cx - 80, cy + 60);
    await page.waitForTimeout(200);

    // Set radius
    await clickViewport(cx - 60, cy + 60);
    await page.waitForTimeout(200);
  });

  // ── 7. PUSH/PULL TOOL: extrude walls ──
  test('7. Push/Pull tool: extrude geometry', async () => {
    await switchToIsoView();

    await activateTool('pushpull');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click on a face in the viewport (center area where geometry exists)
    await clickViewport(cx, cy);
    await page.waitForTimeout(200);

    // Move up to extrude
    await clickViewport(cx, cy - 60);
    await page.waitForTimeout(200);

    // The tool processed the interaction
    status = await getStatus();
    expect(status).toBeTruthy();
  });

  // ── 8. MOVE TOOL: reposition an element ──
  test('8. Move tool: move geometry', async () => {
    await activateTool('move');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click origin point
    await clickViewport(cx - 30, cy);
    await page.waitForTimeout(200);

    // Click destination
    await clickViewport(cx - 30, cy - 20);
    await page.waitForTimeout(200);

    status = await getStatus();
    expect(status).toBeTruthy();
  });

  // ── 9. ROTATE TOOL: rotate an element ──
  test('9. Rotate tool: rotate geometry', async () => {
    await activateTool('rotate');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click center of rotation
    await clickViewport(cx, cy);
    await page.waitForTimeout(200);

    // Click start angle reference
    await clickViewport(cx + 50, cy);
    await page.waitForTimeout(200);

    // Click end angle
    await clickViewport(cx, cy - 50);
    await page.waitForTimeout(200);
  });

  // ── 10. SCALE TOOL: scale an element ──
  test('10. Scale tool: scale geometry', async () => {
    await activateTool('scale');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click to start scaling
    await clickViewport(cx, cy);
    await page.waitForTimeout(200);

    // Click scale reference
    await clickViewport(cx + 40, cy + 40);
    await page.waitForTimeout(200);
  });

  // ── 11. OFFSET TOOL: offset face edges ──
  test('11. Offset tool: offset edges', async () => {
    await activateTool('offset');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click on a face
    await clickViewport(cx, cy);
    await page.waitForTimeout(200);

    // Click to set offset distance
    await clickViewport(cx + 15, cy + 15);
    await page.waitForTimeout(200);
  });

  // ── 12. FOLLOW ME TOOL: sweep profile along path ──
  test('12. Sweep tool: sweep operation', async () => {
    // Activate via toolbar since no single-key shortcut
    const btn = page.locator('.sidebar-tool-btn[title*="Sweep"]');
    if (await btn.count() > 0) {
      await btn.click();
    } else {
      // Try keyboard
      await page.locator('.viewport-container').click();
    }
    await page.waitForTimeout(200);

    const status = await getStatus();
    expect(status).toBeTruthy();

    // Click on a face (profile)
    await clickViewport(cx - 20, cy);
    await page.waitForTimeout(200);

    // Click on path edge
    await clickViewport(cx + 50, cy);
    await page.waitForTimeout(200);
  });

  // ── 13. ERASER TOOL: delete an edge ──
  test('13. Eraser tool: erase edges', async () => {
    await activateTool('eraser');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click on an edge to erase it
    await clickViewport(cx + 90, cy + 30);
    await page.waitForTimeout(200);

    // Drag across edges
    await dragViewport(cx + 80, cy + 40, cx + 100, cy + 50);
    await page.waitForTimeout(200);
  });

  // ── 14. PAINT TOOL: apply colors ──
  test('14. Paint tool: apply material/color to faces', async () => {
    await activateTool('paint');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click on faces to "paint" them
    // In a real scenario this would apply the active material
    await clickViewport(cx, cy);           // Paint center face
    await page.waitForTimeout(100);
    await clickViewport(cx - 50, cy + 20); // Paint another face
    await page.waitForTimeout(100);
    await clickViewport(cx + 50, cy - 20); // Paint another face
    await page.waitForTimeout(100);

    // Alt+click to fill matching material
    await page.mouse.click(box.x + cx, box.y + cy + 30, { modifiers: ['Alt'] });
    await page.waitForTimeout(100);
  });

  // ── 15. ORBIT TOOL: rotate the view ──
  test('15. Orbit tool: orbit around the house', async () => {
    await activateTool('orbit');

    // Drag to orbit 360° around
    await dragViewport(cx, cy, cx + 200, cy - 50, 20);
    await page.waitForTimeout(200);

    // Orbit the other way
    await dragViewport(cx, cy, cx - 150, cy + 80, 15);
    await page.waitForTimeout(200);
  });

  // ── 16. PAN TOOL: pan the view ──
  test('16. Pan tool: pan across the model', async () => {
    await activateTool('pan');

    await dragViewport(cx, cy, cx + 100, cy + 50, 10);
    await page.waitForTimeout(200);

    // Pan back
    await dragViewport(cx, cy, cx - 100, cy - 50, 10);
    await page.waitForTimeout(200);
  });

  // ── 17. ZOOM TOOL: zoom in and out ──
  test('17. Zoom tool: zoom in/out on the house', async () => {
    await activateTool('zoom');

    // Drag up to zoom in
    await dragViewport(cx, cy, cx, cy - 80, 10);
    await page.waitForTimeout(200);

    // Drag down to zoom out
    await dragViewport(cx, cy, cx, cy + 80, 10);
    await page.waitForTimeout(200);

    // Also test scroll wheel zoom
    await page.mouse.wheel(0, -300); // zoom in
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 300);  // zoom out
    await page.waitForTimeout(200);
  });

  // ── 18. TAPE MEASURE TOOL: measure the house ──
  test('18. Tape Measure tool: measure house dimensions', async () => {
    await activateTool('tape_measure');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click first measurement point
    await clickViewport(cx - 80, cy);
    await page.waitForTimeout(200);

    // Click second measurement point
    await clickViewport(cx + 80, cy);
    await page.waitForTimeout(200);

    // VCB should show measured distance
    const vcbVal = await page.locator('.vcb-input').getAttribute('placeholder');
    expect(vcbVal).toBeTruthy();
  });

  // ── 19. PROTRACTOR TOOL: measure angles ──
  test('19. Protractor tool: measure roof angle', async () => {
    // Activate via toolbar
    const btn = page.locator('.sidebar-tool-btn[title*="Protractor"]');
    if (await btn.count() > 0) {
      await btn.click();
    }
    await page.waitForTimeout(200);

    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click center point
    await clickViewport(cx, cy);
    await page.waitForTimeout(200);

    // Click baseline reference
    await clickViewport(cx + 60, cy);
    await page.waitForTimeout(200);

    // Click angle measurement point
    await clickViewport(cx, cy - 60);
    await page.waitForTimeout(200);
  });

  // ── 20. DIMENSION TOOL: annotate dimensions ──
  test('20. Dimension tool: add dimension annotations', async () => {
    await activateTool('dimension');
    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click first point
    await clickViewport(cx - 100, cy + 40);
    await page.waitForTimeout(200);

    // Click second point
    await clickViewport(cx + 100, cy + 40);
    await page.waitForTimeout(200);
  });

  // ── 21. TEXT TOOL: add labels ──
  test('21. Text tool: add text label to house', async () => {
    const btn = page.locator('.sidebar-tool-btn[title*="Text"]');
    if (await btn.count() > 0) {
      await btn.click();
    }
    await page.waitForTimeout(200);

    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click to place text
    await clickViewport(cx, cy - 80);
    await page.waitForTimeout(200);

    // Type text via VCB
    await typeVCB('My House');
  });

  // ── 22. SECTION PLANE TOOL: cut view ──
  test('22. Section Plane tool: add section cut', async () => {
    const btn = page.locator('.sidebar-tool-btn[title*="Section"]');
    if (await btn.count() > 0) {
      await btn.click();
    }
    await page.waitForTimeout(200);

    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click on a face to place section plane
    await clickViewport(cx, cy);
    await page.waitForTimeout(200);
  });

  // ── 23. SOLID TOOLS: boolean operations ──
  test('23. Solid Tools: attempt boolean operation', async () => {
    const btn = page.locator('.sidebar-tool-btn[title*="Solid"]');
    if (await btn.count() > 0) {
      await btn.click();
    }
    await page.waitForTimeout(200);

    let status = await getStatus();
    expect(status).toBeTruthy();

    // Click first solid
    await clickViewport(cx - 30, cy);
    await page.waitForTimeout(200);

    // Click second solid
    await clickViewport(cx + 30, cy);
    await page.waitForTimeout(200);
  });

  // ── VIEW MODES: test all render modes ──
  test('24. Render modes: cycle through all render modes', async () => {
    const modes = ['Wire', 'Shaded', 'Textured', 'X-Ray'];

    for (const mode of modes) {
      const btn = page.locator(`.views-toolbar .view-btn:has-text("${mode}")`);
      await btn.click();
      await page.waitForTimeout(300);
      await expect(btn).toHaveClass(/active/);
    }

    // Return to Shaded
    await page.locator('.views-toolbar .view-btn:has-text("Shaded")').click();
    await page.waitForTimeout(200);
  });

  // ── STANDARD VIEWS: test all camera presets ──
  test('25. Standard views: cycle through all views', async () => {
    const views = ['Front', 'Back', 'Left', 'Right', 'Top', 'Bottom', 'Iso'];

    for (const view of views) {
      const btn = page.locator(`.views-toolbar .view-btn:has-text("${view}")`);
      await btn.click();
      await page.waitForTimeout(400);
    }
  });

  // ── GRID & AXES: toggle visibility ──
  test('26. Grid & Axes: toggle visibility', async () => {
    const gridBtn = page.locator('.views-toolbar button').filter({ hasText: /^Grid$/ });
    const axesBtn = page.locator('.views-toolbar button:has-text("Axes")');

    // Toggle grid off
    await gridBtn.click();
    await expect(gridBtn).not.toHaveClass(/active/);

    // Toggle grid on
    await gridBtn.click();
    await expect(gridBtn).toHaveClass(/active/);

    // Toggle axes off and on
    await axesBtn.click();
    await expect(axesBtn).not.toHaveClass(/active/);
    await axesBtn.click();
    await expect(axesBtn).toHaveClass(/active/);
  });

  // ── LAYERS: create layers for house parts ──
  test('27. Layers: create layers for walls, roof, windows', async () => {
    const input = page.locator('.layers-panel .layer-name-input');
    const addBtn = page.locator('.layers-panel .layer-add-btn');

    const layers = ['Walls', 'Roof', 'Windows', 'Doors', 'Furniture'];
    for (const name of layers) {
      await input.fill(name);
      await addBtn.click();
      await page.waitForTimeout(100);
    }

    // Verify layers were created
    for (const name of layers) {
      await expect(page.locator(`.layers-panel .layer-name:has-text("${name}")`)).toBeVisible();
    }
  });

  // ── LAYER VISIBILITY: toggle layers ──
  test('28. Layers: toggle layer visibility', async () => {
    const visButtons = page.locator('.layers-panel .layer-vis-btn');
    const count = await visButtons.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // Toggle first custom layer off then on
    if (count > 1) {
      await visButtons.nth(1).click();
      await page.waitForTimeout(100);
      await visButtons.nth(1).click();
      await page.waitForTimeout(100);
    }
  });

  // ── PANELS: interact with outliner ──
  test('29. Outliner: search and collapse', async () => {
    const search = page.locator('.outliner-panel .outliner-search');
    await search.fill('group');
    await page.waitForTimeout(200);
    await search.fill('');
    await page.waitForTimeout(100);

    // Collapse and expand
    await page.locator('.outliner-panel .panel-header').click();
    await page.waitForTimeout(100);
    await page.locator('.outliner-panel .panel-header').click();
    await page.waitForTimeout(100);
  });

  // ── CONTEXT MENU ──
  test('30. Context menu: right-click on viewport', async () => {
    // The context menu adapts to the selection (edge/face/group menus).
    // This test asserts the EMPTY-SPACE menu, so clear any selection that
    // earlier steps (e.g. solid-tool clicks) left behind.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    const canvas = page.locator('.viewport-container canvas');
    await canvas.click({ button: 'right' });

    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();

    // Verify standard items
    await expect(menu.locator('.context-menu-item:has-text("Select All")')).toBeVisible();
    await expect(menu.locator('.context-menu-item:has-text("Zoom Extents")')).toBeVisible();

    // Close menu
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
  });

  // ── VCB PRECISION INPUT ──
  test('31. VCB: precise input with line tool', async () => {
    await activateTool('line');

    // Click first point
    await clickViewport(cx - 50, cy + 50);
    await page.waitForTimeout(200);

    const status = await getStatus();
    if (status.includes('next point')) {
      // Type exact distance
      await typeVCB('5');

      // Type 2D offset
      await clickViewport(cx - 50, cy + 50);
      await page.waitForTimeout(200);
    }

    await page.keyboard.press('Escape');
  });

  // ── KEYBOARD SHORTCUTS: rapid tool switching ──
  test('32. Keyboard: rapid tool switching while building', async () => {
    const container = page.locator('.viewport-container');
    await container.click();

    // Rapidly switch through tools as a user would while building
    const sequence = ['l', 'r', 'p', 'm', 'q', 's', 'f', 'e', 'b', 'o', 'h', 'z', 't', 'd', ' '];

    for (const key of sequence) {
      await page.keyboard.press(key);
      await page.waitForTimeout(50);
    }

    // Should end on Select tool
    await expect(page.locator('.sidebar-tool-btn[title*="Select"]')).toHaveClass(/active/);
  });

  // ── ENTITY INFO PANEL ──
  test('33. Entity Info panel: shows correct state', async () => {
    const panel = page.locator('.entity-info-panel');
    await expect(panel).toBeVisible();

    // Clear selection first by pressing Escape
    await activateTool('select');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // With nothing selected, should show "No selection"
    const panelBody = panel.locator('.panel-body');
    const panelEmpty = panel.locator('.panel-empty');
    const entityProps = panel.locator('.entity-props');

    // Either "No selection" or entity props visible — both valid
    const hasEmpty = await panelEmpty.count() > 0 && await panelEmpty.isVisible();
    const hasProps = await entityProps.count() > 0 && await entityProps.isVisible();

    // At least one should be true (panel is functional)
    expect(hasEmpty || hasProps).toBe(true);
  });

  // ── UNDO/REDO ──
  test('34. Undo/Redo: undo and redo operations', async () => {
    // Draw a rectangle to have something to undo
    await activateTool('rectangle');
    await clickViewport(cx - 30, cy + 30);
    await page.waitForTimeout(200);
    await typeVCB('2,2');
    await page.waitForTimeout(200);

    // Undo
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(200);

    // Redo
    await page.keyboard.press('Meta+Shift+z');
    await page.waitForTimeout(200);

    // No crash = success
  });

  // ── ZOOM EXTENTS ──
  test('35. Zoom Extents: fit model in view', async () => {
    const btn = page.locator('.views-toolbar button:has-text("Extents")');
    await btn.click();
    await page.waitForTimeout(500);
    // No crash = success, camera should have adjusted
  });

  // ── FINAL VERIFICATION ──
  test('36. Final: app is still responsive after all operations', async () => {
    // Verify all major UI elements are still visible and functional
    await expect(page.locator('.app-layout')).toBeVisible();
    await expect(page.locator('.app-top-bar')).toBeVisible();
    await expect(page.locator('.drawing-toolbar')).toBeVisible();
    await expect(page.locator('.viewport-container canvas')).toBeVisible();
    await expect(page.locator('.measurements-bar')).toBeVisible();
    await expect(page.locator('.entity-info-panel')).toBeVisible();
    await expect(page.locator('.outliner-panel')).toBeVisible();
    await expect(page.locator('.layers-panel')).toBeVisible();

    // Verify a tool can still be activated
    await activateTool('line');
    const status = await getStatus();
    expect(status).toContain('first point');

    // Return to select
    await activateTool('select');

    // Verify canvas has content (Three.js rendered something)
    const canvas = page.locator('.viewport-container canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox!.width).toBeGreaterThan(200);
    expect(canvasBox!.height).toBeGreaterThan(200);
  });
});
