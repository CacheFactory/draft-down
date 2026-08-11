// @archigraph process.main
// Electron main process entry point for DraftDown

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as zlib from 'zlib';
import {
  UserPreferences,
  DEFAULT_PREFERENCES,
  MenuAction,
} from '../../src/core/ipc-types';
import { convertSkpViaService } from '../../src/core/skp-convert-client';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PREFS_FILE = (): string =>
  path.join(app.getPath('userData'), 'preferences.json');

const AUTOSAVE_DIR = (): string =>
  path.join(app.getPath('userData'), 'autosave');

const MAX_RECENT_FILES = 10;
const SHUTDOWN_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let preferences: UserPreferences = { ...DEFAULT_PREFERENCES };
let autoSaveTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function loadPreferences(): UserPreferences {
  try {
    const raw = fs.readFileSync(PREFS_FILE(), 'utf-8');
    const stored = JSON.parse(raw) as Partial<UserPreferences>;
    return { ...DEFAULT_PREFERENCES, ...stored };
  } catch (e) {
    console.warn('[main.loadPrefs] failed to read preferences (returning defaults):', e);
    return { ...DEFAULT_PREFERENCES };
  }
}

function savePreferences(prefs: UserPreferences): void {
  atomicWriteText(PREFS_FILE(), JSON.stringify(prefs, null, 2));
}

// ---------------------------------------------------------------------------
// Atomic file writes (write to temp then rename)
// ---------------------------------------------------------------------------

function atomicWriteBuffer(filePath: string, data: Buffer): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmp); } catch (e) { console.warn(`[main.atomicWrite] failed to cleanup temp file ${tmp}:`, e); }
    throw err;
  }
}

function atomicWriteText(filePath: string, text: string): void {
  atomicWriteBuffer(filePath, Buffer.from(text, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Recent files management
// ---------------------------------------------------------------------------

function addRecentFile(filePath: string): void {
  const absolute = path.resolve(filePath);
  preferences.recentFiles = preferences.recentFiles.filter(
    (f) => f !== absolute,
  );
  preferences.recentFiles.unshift(absolute);
  if (preferences.recentFiles.length > MAX_RECENT_FILES) {
    preferences.recentFiles = preferences.recentFiles.slice(0, MAX_RECENT_FILES);
  }
  savePreferences(preferences);
  rebuildMenu();
}

function pruneRecentFiles(): void {
  const before = preferences.recentFiles.length;
  preferences.recentFiles = preferences.recentFiles.filter((f) => {
    try {
      fs.accessSync(f, fs.constants.R_OK);
      return true;
    } catch (e) {
      console.warn(`[main.pruneRecentFiles] dropping inaccessible recent file ${f}:`, e);
      return false;
    }
  });
  if (preferences.recentFiles.length !== before) {
    savePreferences(preferences);
  }
}

function getRecentFiles(): string[] {
  return [...preferences.recentFiles];
}

// ---------------------------------------------------------------------------
// Auto-save
// ---------------------------------------------------------------------------

function startAutoSaveTimer(): void {
  stopAutoSaveTimer();
  const interval = preferences.autoSaveInterval;
  if (interval <= 0) return;
  autoSaveTimer = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:auto-save-tick', {});
    }
  }, interval);
}

function stopAutoSaveTimer(): void {
  if (autoSaveTimer !== null) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }
}

function cleanOldAutosaves(): void {
  const dir = AUTOSAVE_DIR();
  if (!fs.existsSync(dir)) return;
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const now = Date.now();
  try {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(fp);
      }
    }
  } catch (e) { console.warn('[main.cleanupOldAutosaves] cleanup errored:', e); }
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  // -- File operations ------------------------------------------------------

  // @archigraph calls|process.main|svc.file_system|runtime
  ipcMain.handle('file:open', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '3D Files', extensions: ['dd', 'draftdown', 'skc', 'dwg', 'skp', 'obj', 'stl', 'gltf', 'glb', 'fbx', 'dae', 'ply', '3mf', 'dxf'] },
        { name: 'AutoCAD DWG/DXF', extensions: ['dwg', 'dxf'] },
        { name: 'SKP Files', extensions: ['skp'] },
        { name: 'DraftDown Files', extensions: ['dd', 'draftdown', 'skc'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const data = fs.readFileSync(filePath);
    addRecentFile(filePath);
    return { filePath, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });

  ipcMain.handle('file:save', async (_event, args: { filePath: string; data: ArrayBuffer }) => {
    try {
      atomicWriteBuffer(args.filePath, Buffer.from(args.data));
      addRecentFile(args.filePath);
      return true;
    } catch (e) {
      console.error(`[main.file:save] failed to save ${args.filePath}:`, e);
      return false;
    }
  });

  ipcMain.handle('file:save-as', async (_event, args: { data: ArrayBuffer; defaultName: string }) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: args.defaultName,
      filters: [
        // .dd is the primary extension; .draftdown/.skc stay openable for old files
        { name: 'DraftDown Files', extensions: ['dd'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    atomicWriteBuffer(result.filePath, Buffer.from(args.data));
    addRecentFile(result.filePath);
    return { filePath: result.filePath };
  });

  ipcMain.handle('file:export', async (_event, args: { data: ArrayBuffer; format: string; defaultName: string }) => {
    if (!mainWindow) return null;
    const filters: Electron.FileFilter[] = [];
    switch (args.format) {
      case 'obj': filters.push({ name: 'Wavefront OBJ', extensions: ['obj'] }); break;
      case 'stl': filters.push({ name: 'STL', extensions: ['stl'] }); break;
      case 'gltf': filters.push({ name: 'glTF', extensions: ['gltf', 'glb'] }); break;
      case 'dxf': filters.push({ name: 'DXF', extensions: ['dxf'] }); break;
      case 'dwg': filters.push({ name: 'AutoCAD DWG', extensions: ['dwg'] }); break;
      default: filters.push({ name: args.format.toUpperCase(), extensions: [args.format] }); break;
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: args.defaultName,
      filters,
    });
    if (result.canceled || !result.filePath) return null;
    atomicWriteBuffer(result.filePath, Buffer.from(args.data));
    return { filePath: result.filePath };
  });

  ipcMain.handle('file:import', async (_event, args: { formats: string[] }) => {
    if (!mainWindow) return null;
    const extensions = args.formats.flatMap((f) => {
      // Normalize: renderer passes formats with leading dots ('.dwg');
      // Electron filters want bare extensions
      switch (f.replace(/^\./, '')) {
        case 'obj': return ['obj'];
        case 'stl': return ['stl'];
        case 'step': return ['step', 'stp'];
        case 'dxf': return ['dxf'];
        case 'dwg': return ['dwg'];
        case 'gltf': return ['gltf', 'glb'];
        case 'skp': return ['skp'];
        default: return [f.replace(/^\./, '')];
      }
    });
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '3D Files', extensions },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const data = fs.readFileSync(filePath);
    return {
      filePath,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      format: ext,
    };
  });

  // DWG↔DXF conversion: POSTs to the LibreDWG Lambda (scripts/dwg-converter-lambda,
  // provisioned by scripts/setup-dwg-converter.sh). Returns the converted
  // bytes or null. Runs in the main process — no renderer CSP involvement.
  ipcMain.handle('file:convert-dwg', async (_event, args: { direction: 'dwg2dxf' | 'dxf2dwg'; data: ArrayBuffer }) => {
    const url = process.env.DWG_CONVERT_URL || 'https://nybay2a3oareyyzpdikktv3gsi0exbhq.lambda-url.us-east-1.on.aws/';
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: args.direction,
          file: Buffer.from(args.data).toString('base64'),
        }),
      });
      if (!resp.ok) {
        console.error('[dwg-convert] service returned', resp.status, await resp.text().catch(() => ''));
        return null;
      }
      const body = await resp.json() as { ok: boolean; file?: string; error?: string };
      if (!body.ok || !body.file) {
        console.error('[dwg-convert] conversion failed:', body.error);
        return null;
      }
      const buf = Buffer.from(body.file, 'base64');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (e) {
      console.error('[dwg-convert] request failed:', e);
      return null;
    }
  });

  // SKP→OBJ conversion: POSTs the SKP to the converter service (private repo,
  // hosted on App Runner). The service returns a ZIP containing OBJ + MTL +
  // textures; we unpack it to a temp dir so the renderer can read the MTL and
  // texture files via the existing `file:read` channel.
  ipcMain.handle('file:convert-skp', async (_event, args: { filePath: string; data?: ArrayBuffer }) => {
    const url = process.env.SKP_CONVERT_URL || 'https://hzmbrm9pw6.us-east-1.awsapprunner.com';
    if (!url) {
      console.warn('[skp-convert] SKP_CONVERT_URL not configured');
      return null;
    }

    let skpBuffer: Buffer;
    if (args.data) {
      skpBuffer = Buffer.from(args.data);
    } else if (args.filePath) {
      try { skpBuffer = fs.readFileSync(args.filePath); }
      catch (e) { console.error('[skp-convert] failed to read SKP file:', e); return null; }
    } else {
      console.warn('[skp-convert] no SKP data provided');
      return null;
    }

    console.log(`[skp-convert] Uploading ${skpBuffer.byteLength} bytes to ${url}`);
    const result = await convertSkpViaService(
      url, skpBuffer.toString('base64'), path.basename(args.filePath) || 'model.skp');
    if ('error' in result) {
      console.error('[skp-convert] conversion failed:', result.error);
      return { error: result.error };
    }
    const zipBuffer: Buffer = Buffer.from(result.zip);

    // Unpack the ZIP into a per-conversion temp directory so MTL + textures sit
    // next to the OBJ (so the OBJ importer's relative-path lookups resolve).
    const tmpDir = path.join(os.tmpdir(), `skp-convert-${Date.now()}`);
    try { fs.mkdirSync(tmpDir, { recursive: true }); }
    catch (e) { console.error('[skp-convert] mkdir failed:', e); return null; }

    let objPath: string | null = null;
    let objData: Buffer | null = null;
    let offset = 0;
    while (offset < zipBuffer.length - 4) {
      const sig = zipBuffer.readUInt32LE(offset);
      if (sig !== 0x04034b50) break;
      const compression = zipBuffer.readUInt16LE(offset + 8);
      const compressedSize = zipBuffer.readUInt32LE(offset + 18);
      const nameLen = zipBuffer.readUInt16LE(offset + 26);
      const extraLen = zipBuffer.readUInt16LE(offset + 28);
      const headerEnd = offset + 30 + nameLen + extraLen;
      const fileName = zipBuffer.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
      const compressedData = zipBuffer.slice(headerEnd, headerEnd + compressedSize);

      if (compressedSize > 0 && !fileName.endsWith('/')) {
        let fileData: Buffer;
        if (compression === 0) {
          fileData = compressedData;
        } else if (compression === 8) {
          try { fileData = zlib.inflateRawSync(compressedData); }
          catch (e) { console.warn(`[skp-convert] inflate failed for ${fileName}:`, e); offset = headerEnd + compressedSize; continue; }
        } else {
          console.warn(`[skp-convert] unsupported compression ${compression} for ${fileName}`);
          offset = headerEnd + compressedSize;
          continue;
        }
        const outPath = path.join(tmpDir, path.basename(fileName));
        fs.writeFileSync(outPath, fileData);
        if (fileName.endsWith('.obj')) {
          objPath = outPath;
          objData = fileData;
        }
      }
      offset = headerEnd + compressedSize;
    }

    if (!objData || !objPath) {
      console.error('[skp-convert] response did not contain an OBJ file');
      return null;
    }
    console.log(`[skp-convert] OBJ extracted: ${(objData.byteLength / 1024 / 1024).toFixed(1)}MB`);
    return {
      data: objData.buffer.slice(objData.byteOffset, objData.byteOffset + objData.byteLength),
      filePath: objPath,
    };
  });

  ipcMain.handle('file:read', async (_event, args: { filePath: string }) => {
    const data = fs.readFileSync(args.filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  });

  ipcMain.handle('file:write', async (_event, args: { filePath: string; data: ArrayBuffer }) => {
    try {
      atomicWriteBuffer(args.filePath, Buffer.from(args.data));
      return true;
    } catch (e) {
      console.error(`[main.file:write] failed to write ${args.filePath}:`, e);
      return false;
    }
  });

  ipcMain.handle('file:delete', async (_event, args: { filePath: string }) => {
    try {
      if (fs.existsSync(args.filePath)) fs.unlinkSync(args.filePath);
      return true;
    } catch (e) {
      console.error(`[main.file:delete] failed:`, e);
      return false;
    }
  });

  ipcMain.handle('file:exists', async (_event, args: { filePath: string }) => {
    return fs.existsSync(args.filePath);
  });

  ipcMain.handle('file:get-recent', async () => {
    return getRecentFiles();
  });

  ipcMain.handle('file:add-recent', async (_event, args: { filePath: string }) => {
    addRecentFile(args.filePath);
  });

  // -- Preferences ----------------------------------------------------------

  ipcMain.handle('prefs:get', async () => {
    return { ...preferences };
  });

  ipcMain.handle('prefs:set', async (_event, partial: Partial<UserPreferences>) => {
    const oldInterval = preferences.autoSaveInterval;
    preferences = { ...preferences, ...partial };
    savePreferences(preferences);
    if (partial.autoSaveInterval !== undefined && partial.autoSaveInterval !== oldInterval) {
      startAutoSaveTimer();
    }
    if (partial.theme !== undefined || partial.shortcuts !== undefined) {
      rebuildMenu();
    }
  });

  // -- Native modules (stubs — actual implementations delegate to native) ---

  // Manifold WASM runs in the MAIN process (Node resolves the package and
  // its .wasm natively; the renderer can't import bare specifiers).
  let manifoldWasm: any = null;
  const getManifold = async () => {
    if (manifoldWasm) return manifoldWasm;
    // Native dynamic import — ts-loader/webpack rewrite literal import()
    // into require(), which cannot load this ESM-only package.
    const nativeImport = new Function('specifier', 'return import(specifier)');
    const pkg: any = await nativeImport('manifold-3d');
    const factory = pkg.default ?? pkg;
    manifoldWasm = await factory();
    manifoldWasm.setup();
    return manifoldWasm;
  };

  type JsonMesh = { vertices: Array<{ x: number; y: number; z: number }>; faces: number[][] };

  const toManifold = (wasm: any, mesh: JsonMesh) => {
    const vertProperties = new Float32Array(mesh.vertices.length * 3);
    mesh.vertices.forEach((v, i) => {
      vertProperties[i * 3] = v.x;
      vertProperties[i * 3 + 1] = v.y;
      vertProperties[i * 3 + 2] = v.z;
    });
    const triVerts = new Uint32Array(mesh.faces.length * 3);
    mesh.faces.forEach((f, i) => {
      triVerts[i * 3] = f[0];
      triVerts[i * 3 + 1] = f[1];
      triVerts[i * 3 + 2] = f[2];
    });
    const m = new wasm.Mesh({ numProp: 3, vertProperties, triVerts });
    m.merge(); // weld duplicate vertices so hand-built face soup becomes manifold
    return new wasm.Manifold(m);
  };

  const fromManifold = (instance: any): JsonMesh => {
    const mesh = instance.getMesh();
    const vertices: Array<{ x: number; y: number; z: number }> = [];
    const n = mesh.vertProperties.length / mesh.numProp;
    for (let i = 0; i < n; i++) {
      vertices.push({
        x: mesh.vertProperties[i * mesh.numProp],
        y: mesh.vertProperties[i * mesh.numProp + 1],
        z: mesh.vertProperties[i * mesh.numProp + 2],
      });
    }
    const faces: number[][] = [];
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      faces.push([mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]]);
    }
    return { vertices, faces };
  };

  ipcMain.handle('native:boolean', async (_event, args: {
    op: 'union' | 'subtract' | 'intersect';
    meshA: JsonMesh;
    meshB: JsonMesh;
  }) => {
    try {
      const wasm = await getManifold();
      const a = toManifold(wasm, args.meshA);
      const b = toManifold(wasm, args.meshB);
      const result = args.op === 'union' ? a.add(b)
                   : args.op === 'subtract' ? a.subtract(b)
                   : a.intersect(b);
      const out = fromManifold(result);
      a.delete(); b.delete(); result.delete();
      return { ok: true, mesh: out };
    } catch (e) {
      console.error('[native:boolean] failed:', e);
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('native:solid-check', async (_event, args: { mesh: JsonMesh }) => {
    try {
      const wasm = await getManifold();
      const m = toManifold(wasm, args.mesh);
      const volume = m.volume();
      const status = m.status ? m.status() : { value: 0 };
      m.delete();
      return { ok: true, isSolid: (status.value ?? 0) === 0 && volume > 0, volume };
    } catch (e) {
      return { ok: true, isSolid: false, volume: 0 };
    }
  });

  ipcMain.handle('native:step-import', async (_event, args: { data: ArrayBuffer }) => {
    // Delegate to native STEP parser when available.
    return args.data;
  });

  // -- App commands ---------------------------------------------------------

  ipcMain.handle('app:get-version', async () => {
    return app.getVersion();
  });

  ipcMain.handle('app:get-user-data-path', async () => {
    return app.getPath('userData');
  });

  ipcMain.handle('app:quit', async () => {
    app.quit();
  });

  // -- AI Chat ---------------------------------------------------------------

  // @archigraph ai.chat
  ipcMain.handle('ai:chat', async (_event, args: {
    messages: Array<{ role: string; content: unknown }>;
    tools: unknown[];
    system: string;
  }) => {
    const apiKey = preferences.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { error: 'Anthropic API key not set. Go to Preferences > AI to enter your key.' };
    }

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: args.system,
      messages: args.messages,
      tools: args.tools,
    });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              resolve({ error: parsed.error.message || JSON.stringify(parsed.error) });
            } else {
              resolve(parsed);
            }
          } catch (e) {
            console.error('[main.ai:chat] failed to parse Anthropic API response:', e, 'raw:', data.slice(0, 200));
            resolve({ error: `Failed to parse API response: ${data.slice(0, 200)}` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ error: `API request failed: ${err.message}` });
      });

      req.write(body);
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Application Menu
// ---------------------------------------------------------------------------

function sendMenuAction(action: MenuAction): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:action', { action });
  }
}

function buildRecentFilesSubmenu(): MenuItemConstructorOptions[] {
  if (preferences.recentFiles.length === 0) {
    return [{ label: 'No Recent Files', enabled: false }];
  }
  const items: MenuItemConstructorOptions[] = preferences.recentFiles.map(
    (filePath, index) => ({
      label: `${index + 1}. ${path.basename(filePath)}`,
      toolTip: filePath,
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            const data = fs.readFileSync(filePath);
            mainWindow.webContents.send('menu:action', { action: 'open' });
            void data;
          } catch (e) { console.warn(`[main.recentFiles] read of ${filePath} failed (likely deleted):`, e); }
        }
      },
    }),
  );
  items.push({ type: 'separator' });
  items.push({
    label: 'Clear Recent Files',
    click: () => {
      preferences.recentFiles = [];
      savePreferences(preferences);
      rebuildMenu();
    },
  });
  return items;
}

function rebuildMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Preferences…',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendMenuAction('preferences'),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),

    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('new'),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open'),
        },
        {
          label: 'Open Recent',
          submenu: buildRecentFilesSubmenu(),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('save-as'),
        },
        { type: 'separator' },
        {
          label: 'Import…',
          accelerator: 'CmdOrCtrl+I',
          click: () => sendMenuAction('import'),
        },
        {
          label: 'Export…',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendMenuAction('export'),
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' as const }]),
      ],
    },

    // Edit
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          click: () => sendMenuAction('undo'),
        },
        {
          label: 'Redo',
          click: () => sendMenuAction('redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        {
          label: 'Delete',
          click: () => sendMenuAction('delete'),
        },
        {
          label: 'Unhide All',
          click: () => sendMenuAction('unhide-all'),
        },
        { type: 'separator' },
        {
          label: 'Select All',
          click: () => sendMenuAction('select-all'),
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'Preferences…',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendMenuAction('preferences'),
              },
            ]
          : []),
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom Extents',
          click: () => sendMenuAction('zoom-extents'),
        },
        {
          label: 'Zoom Window',
          click: () => sendMenuAction('zoom-window'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Tools — no accelerators here; keyboard shortcuts are handled
    // in the renderer process to avoid Electron menu intercepting them.
    // Tool shortcuts: Space, L, R, C, A, P, M, Q, S, F, E, B, O, H, Z, T, D
    {
      label: 'Tools',
      submenu: [
        { label: 'Select (Space)', click: () => sendMenuAction('tool-select' as MenuAction) },
        { label: 'Line (L)', click: () => sendMenuAction('tool-line' as MenuAction) },
        { label: 'Rectangle (R)', click: () => sendMenuAction('tool-rectangle' as MenuAction) },
        { label: 'Circle (C)', click: () => sendMenuAction('tool-circle' as MenuAction) },
        { label: 'Arc (A)', click: () => sendMenuAction('tool-arc' as MenuAction) },
        { type: 'separator' },
        { label: 'Push/Pull (P)', click: () => sendMenuAction('tool-pushpull' as MenuAction) },
        { label: 'Move (M)', click: () => sendMenuAction('tool-move' as MenuAction) },
        { label: 'Rotate (Q)', click: () => sendMenuAction('tool-rotate' as MenuAction) },
        { label: 'Scale (S)', click: () => sendMenuAction('tool-scale' as MenuAction) },
        { label: 'Offset (F)', click: () => sendMenuAction('tool-offset' as MenuAction) },
        { type: 'separator' },
        { label: 'Eraser (E)', click: () => sendMenuAction('tool-eraser' as MenuAction) },
        { label: 'Paint Bucket (B)', click: () => sendMenuAction('tool-paint' as MenuAction) },
        { type: 'separator' },
        { label: 'Orbit (O)', click: () => sendMenuAction('tool-orbit' as MenuAction) },
        { label: 'Pan (H)', click: () => sendMenuAction('tool-pan' as MenuAction) },
        { label: 'Zoom (Z)', click: () => sendMenuAction('tool-zoom' as MenuAction) },
        { type: 'separator' },
        { label: 'Tape Measure (T)', click: () => sendMenuAction('tool-tape_measure' as MenuAction) },
        { label: 'Protractor (Shift+P)', click: () => sendMenuAction('tool-protractor' as MenuAction) },
        { label: 'Dimension (D)', click: () => sendMenuAction('tool-dimension' as MenuAction) },
      ],
    },

    // Help
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          label: 'About DraftDown',
          click: () => sendMenuAction('about'),
        },
        {
          label: 'Report a Bug…',
          click: () => sendMenuAction('report-bug'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'DraftDown',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false, // needed for native module access via preload
      backgroundThrottling: !process.env.DRAFTDOWN_HEADLESS ? true : false,
    },
    show: false,
  });

  // Graceful show when ready. DRAFTDOWN_HEADLESS keeps the window hidden —
  // e2e runs drive it via Playwright without windows appearing on screen.
  win.once('ready-to-show', () => {
    if (!process.env.DRAFTDOWN_HEADLESS) win.show();
  });

  // Load the renderer entry point
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  return win;
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let isQuitting = false;

function handleBeforeQuit(): void {
  if (isQuitting) return;
  isQuitting = true;

  stopAutoSaveTimer();

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  // Notify renderer so it can persist unsaved work
  mainWindow.webContents.send('app:before-quit', {});

  // Give the renderer up to SHUTDOWN_TIMEOUT_MS to wrap up, then force close
  const forceClose = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
  }, SHUTDOWN_TIMEOUT_MS);

  mainWindow.once('closed', () => {
    clearTimeout(forceClose);
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.on('before-quit', (event) => {
  if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    handleBeforeQuit();
    // Allow the window to close after the renderer has had time
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    }, SHUTDOWN_TIMEOUT_MS);
  }
});

// Increase renderer V8 heap limit for large models
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');

app.whenReady().then(() => {
  // 1. Load preferences
  preferences = loadPreferences();
  pruneRecentFiles();

  // 2. Register IPC handlers
  registerIpcHandlers();

  // 3. Create the main window
  mainWindow = createMainWindow();

  // Monitor for renderer crashes
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[CRASH] Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[CRASH] Renderer process became unresponsive');
  });

  // 4. Build application menu
  rebuildMenu();

  // 5. Start auto-save timer
  startAutoSaveTimer();

  // 6. Clean old autosave files
  cleanOldAutosaves();

  // macOS: re-create window when dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopAutoSaveTimer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
