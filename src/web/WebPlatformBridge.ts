// @archigraph web.platform
// Browser-compatible implementation of WindowAPI.
// Replaces Electron IPC with Web APIs (File API, localStorage, fetch).

import type { WindowAPI, MainProcessAPI, RendererEvents, UserPreferences } from '../core/ipc-types';
import { DEFAULT_PREFERENCES } from '../core/ipc-types';
import { bytesToBase64, convertSkpViaService } from '../core/skp-convert-client';

type EventHandler<K extends keyof RendererEvents> = (data: RendererEvents[K]) => void;

declare const __SKP_CONVERT_URL__: string;
declare const __DWG_CONVERT_URL__: string;

const PREFS_KEY = 'draftdown-prefs';
const RECENT_KEY = 'draftdown-recent';

/** In-memory cache of files extracted from SKP conversion ZIP (MTL, textures). */
const skpFileCache = new Map<string, ArrayBuffer>();

export class WebPlatformBridge implements WindowAPI {
  private listeners = new Map<string, Set<Function>>();

  invoke<K extends keyof MainProcessAPI>(
    channel: K,
    ...args: Parameters<MainProcessAPI[K]>
  ): ReturnType<MainProcessAPI[K]> {
    const handler = this.handlers[channel];
    if (!handler) {
      console.warn(`[WebPlatformBridge] Unhandled channel: ${channel}`);
      return Promise.resolve(null) as any;
    }
    return handler(...args) as ReturnType<MainProcessAPI[K]>;
  }

  on<K extends keyof RendererEvents>(
    channel: K,
    handler: EventHandler<K>,
  ): () => void {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set());
    this.listeners.get(channel)!.add(handler);
    return () => this.listeners.get(channel)?.delete(handler);
  }

  off<K extends keyof RendererEvents>(
    channel: K,
    handler: EventHandler<K>,
  ): void {
    this.listeners.get(channel)?.delete(handler);
  }

  /** Emit an event to all registered listeners (used by WebMenuBar). */
  emit<K extends keyof RendererEvents>(channel: K, data: RendererEvents[K]): void {
    const handlers = this.listeners.get(channel);
    if (handlers) {
      for (const fn of handlers) (fn as EventHandler<K>)(data);
    }
  }

  // ── Handler implementations ──────────────────────────────────

  private handlers: Record<string, (...args: any[]) => Promise<any>> = {
    'file:open': async () => {
      const [handle] = await this.pickFile([
        { description: 'DraftDown Files', accept: { 'application/octet-stream': ['.dd', '.draftdown', '.skc', '.dwg', '.obj', '.stl', '.gltf', '.glb', '.dxf', '.fbx', '.skp'] } },
        { description: 'All Files', accept: { '*/*': [] } },
      ]);
      if (!handle) return null;
      const file = await handle.getFile();
      const data = await file.arrayBuffer();
      return { filePath: file.name, data };
    },

    'file:save': async (args: { filePath: string; data: ArrayBuffer }) => {
      this.downloadBlob(args.data, args.filePath);
      return true;
    },

    'file:save-as': async (args: { data: ArrayBuffer; defaultName: string }) => {
      const name = await this.saveFile(args.data, args.defaultName);
      return name ? { filePath: name } : null;
    },

    'file:export': async (args: { data: ArrayBuffer; format: string; defaultName: string }) => {
      const name = await this.saveFile(args.data, args.defaultName);
      return name ? { filePath: name } : null;
    },

    'file:import': async (args: { formats: string[] }) => {
      const extensions = args.formats.map(f => `.${f}`);
      const [handle] = await this.pickFile([
        { description: '3D Files', accept: { 'application/octet-stream': extensions } },
      ]);
      if (!handle) return null;
      const file = await handle.getFile();
      const data = await file.arrayBuffer();
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      return { filePath: file.name, data, format: ext };
    },

    'file:read': async (args: { filePath: string }) => {
      // Check SKP conversion cache first (for MTL/texture files)
      const filename = args.filePath.split('/').pop()?.split('\\').pop() || '';
      const cached = skpFileCache.get(filename);
      console.log(`[file:read] path="${args.filePath}" → basename="${filename}" → ${cached ? `found (${cached.byteLength} bytes)` : `NOT found. Cache keys: [${Array.from(skpFileCache.keys()).join(', ')}]`}`);
      if (cached) return cached;
      // Not applicable on web otherwise
      return new ArrayBuffer(0);
    },

    'file:write': async () => {
      // Not applicable on web
      return false;
    },

    'file:get-recent': async () => {
      try {
        return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      } catch { return []; }
    },

    'file:add-recent': async (args: { filePath: string }) => {
      try {
        const recent: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        const filtered = recent.filter(r => r !== args.filePath);
        filtered.unshift(args.filePath);
        localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, 10)));
      } catch (e) { console.warn('[WebPlatformBridge.file:add-recent] localStorage write failed:', e); }
    },

    'prefs:get': async () => {
      try {
        const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        return { ...DEFAULT_PREFERENCES, ...stored };
      } catch (e) {
        console.warn('[WebPlatformBridge.prefs:get] localStorage read failed, returning defaults:', e);
        return { ...DEFAULT_PREFERENCES };
      }
    },

    'prefs:set': async (prefs: Partial<UserPreferences>) => {
      try {
        const current = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs }));
      } catch (e) { console.warn('[WebPlatformBridge.prefs:set] localStorage write failed:', e); }
    },

    // Stubs for native-only features
    'native:boolean': async () => new ArrayBuffer(0),
    'native:step-import': async () => new ArrayBuffer(0),
    'file:convert-dwg': async (args: { direction: 'dwg2dxf' | 'dxf2dwg'; data: ArrayBuffer }) => {
      const url = typeof __DWG_CONVERT_URL__ !== 'undefined' ? __DWG_CONVERT_URL__ : '';
      if (!url) return null;
      try {
        const bytes = new Uint8Array(args.data);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
        }
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ direction: args.direction, file: btoa(binary) }),
        });
        if (!resp.ok) return null;
        const body = await resp.json();
        if (!body.ok || !body.file) return null;
        const out = atob(body.file);
        const buf = new Uint8Array(out.length);
        for (let i = 0; i < out.length; i++) buf[i] = out.charCodeAt(i);
        return buf.buffer;
      } catch (e) {
        console.error('[web dwg-convert] failed:', e);
        return null;
      }
    },

    'file:convert-skp': async (args: { filePath?: string; data?: ArrayBuffer }) => {
      // @archigraph calls|web.platform|svc.skp_convert|runtime
      const url = typeof __SKP_CONVERT_URL__ !== 'undefined' ? __SKP_CONVERT_URL__ : '';
      if (!url) {
        console.warn('[WebPlatformBridge] SKP conversion not configured (no SKP_CONVERT_URL)');
        return null;
      }

      // Get the SKP data — on web, it comes from the file picker via data
      let skpData: ArrayBuffer | undefined = args.data;
      if (!skpData) {
        console.warn('[WebPlatformBridge] No SKP data provided');
        return null;
      }

      try {
        const base64 = bytesToBase64(new Uint8Array(skpData));
        const result = await convertSkpViaService(url, base64, args.filePath || 'model.skp');
        if ('error' in result) {
          console.error('[WebPlatformBridge] SKP conversion failed:', result.error);
          return { error: result.error };
        }
        const zipData = result.zip;

        // Unpack ZIP using browser-native DecompressionStream or manual ZIP parsing
        const files = await this.unpackZip(zipData);

        // Find OBJ file
        let objData: ArrayBuffer | null = null;
        let objName = 'output.obj';
        skpFileCache.clear();

        console.log(`[SKP] ZIP contained ${files.size} files:`, Array.from(files.keys()));
        for (const [name, data] of files) {
          console.log(`[SKP] ZIP file: "${name}" (${data.byteLength} bytes)`);
          if (name.endsWith('.obj')) {
            objData = data;
            objName = name;
          } else {
            // Cache MTL and texture files for file:read
            skpFileCache.set(name, data);
          }
        }

        if (!objData) {
          console.error('[WebPlatformBridge] No OBJ file in conversion result');
          return null;
        }

        return { data: objData, filePath: objName };
      } catch (err: any) {
        console.error('[WebPlatformBridge] SKP conversion error:', err);
        return { error: err?.message ?? String(err) };
      }
    },
    'app:get-version': async () => '1.0.0-web',
    'app:get-user-data-path': async () => '/web',
    'app:quit': async () => {},

    'ai:chat': async (args: { messages: Array<{ role: string; content: unknown }>; tools: unknown[]; system: string }) => {
      // AI chat requires a proxy to avoid CORS issues with Anthropic API.
      // For now, return an informative error.
      let prefs: UserPreferences;
      try {
        prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      } catch { prefs = {} as any; }

      if (!prefs.anthropicApiKey) {
        return {
          content: [{ type: 'text', text: 'AI chat requires an API key. Set it in Preferences.' }],
        };
      }

      // Try direct fetch — will work if user has a CORS proxy or if Anthropic enables browser access
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': prefs.anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: args.system,
            messages: args.messages,
            tools: args.tools?.length ? args.tools : undefined,
          }),
        });
        return await resp.json();
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `AI chat error: ${err.message}` }],
        };
      }
    },
  };

  // ── File helpers ──────────────────────────────────────────────

  private async pickFile(types: Array<{ description: string; accept: Record<string, string[]> }>): Promise<any[]> {
    // Use File System Access API if available (Chrome/Edge)
    if ('showOpenFilePicker' in window) {
      try {
        return await (window as any).showOpenFilePicker({ types, multiple: false });
      } catch { return []; } // User cancelled
    }

    // Fallback: hidden <input type="file">
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      const exts = types.flatMap(t => Object.values(t.accept || {}).flat());
      if (exts.length) input.accept = exts.join(',');
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve([]); return; }
        // Wrap in a pseudo FileSystemFileHandle
        resolve([{ getFile: () => Promise.resolve(file) } as any]);
      };
      input.click();
    });
  }

  private async saveFile(data: ArrayBuffer, defaultName: string): Promise<string | null> {
    // Use File System Access API if available
    if ('showSaveFilePicker' in window) {
      try {
        const ext = defaultName.split('.').pop() || 'obj';
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: defaultName,
          types: [{ description: `${ext.toUpperCase()} File`, accept: { 'application/octet-stream': [`.${ext}`] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return handle.name;
      } catch { return null; } // User cancelled
    }

    // Fallback: trigger download
    this.downloadBlob(data, defaultName);
    return defaultName;
  }

  private downloadBlob(data: ArrayBuffer, filename: string): void {
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Unpack a ZIP file into a Map of filename → ArrayBuffer.
   * Uses a minimal ZIP parser (no external dependencies).
   */
  private async unpackZip(zipData: ArrayBuffer): Promise<Map<string, ArrayBuffer>> {
    const files = new Map<string, ArrayBuffer>();
    const view = new DataView(zipData);
    const bytes = new Uint8Array(zipData);
    let offset = 0;

    while (offset < bytes.length - 4) {
      // Look for local file header signature (PK\x03\x04)
      if (view.getUint32(offset, true) !== 0x04034b50) break;

      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const uncompressedSize = view.getUint32(offset + 22, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const headerEnd = offset + 30 + nameLen + extraLen;

      const nameBytes = bytes.slice(offset + 30, offset + 30 + nameLen);
      const fileName = new TextDecoder().decode(nameBytes);

      if (compressedSize > 0 && !fileName.endsWith('/')) {
        const fileData = bytes.slice(headerEnd, headerEnd + compressedSize);

        if (compressionMethod === 0) {
          // Stored (no compression)
          files.set(fileName, fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength));
        } else if (compressionMethod === 8) {
          // Deflate — use DecompressionStream API
          try {
            const ds = new DecompressionStream('deflate-raw');
            const writer = ds.writable.getWriter();
            const reader = ds.readable.getReader();
            writer.write(fileData);
            writer.close();

            const chunks: Uint8Array[] = [];
            let totalLen = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              totalLen += value.byteLength;
            }
            const result = new Uint8Array(totalLen);
            let pos = 0;
            for (const chunk of chunks) {
              result.set(chunk, pos);
              pos += chunk.byteLength;
            }
            files.set(fileName, result.buffer);
          } catch (e) {
            console.warn(`[unpackZip] Failed to decompress ${fileName}:`, e);
          }
        }
      }

      offset = headerEnd + compressedSize;
    }

    return files;
  }
}
