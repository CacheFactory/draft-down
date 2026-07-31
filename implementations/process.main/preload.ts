// @archigraph process.main
// Preload script — bridges Electron IPC to a typed window.api surface

import { contextBridge, ipcRenderer } from 'electron';
import type {
  MainProcessAPI,
  RendererEvents,
  WindowAPI,
} from '../../src/core/ipc-types';

// Allowed IPC invoke channels (main process handlers)
const INVOKE_CHANNELS: ReadonlySet<string> = new Set<keyof MainProcessAPI>([
  'file:open',
  'file:save',
  'file:save-as',
  'file:export',
  'file:import',
  'file:read',
  'file:convert-skp',
  'file:convert-dwg',
  'file:write',
  'file:delete',
  'file:exists',
  'file:get-recent',
  'file:add-recent',
  'prefs:get',
  'prefs:set',
  'native:boolean',
  'native:solid-check',
  'native:step-import',
  'app:get-version',
  'app:get-user-data-path',
  'app:quit',
  'ai:chat',
]);

// Allowed IPC event channels (main -> renderer)
const EVENT_CHANNELS: ReadonlySet<string> = new Set<keyof RendererEvents>([
  'menu:action',
  'file:auto-save-tick',
  'app:before-quit',
]);

// Weak map to track wrapped listener functions so off() can remove the right one
const listenerMap = new WeakMap<Function, Function>();

const api: WindowAPI = {
  invoke<K extends keyof MainProcessAPI>(
    channel: K,
    ...args: Parameters<MainProcessAPI[K]>
  ): ReturnType<MainProcessAPI[K]> {
    if (!INVOKE_CHANNELS.has(channel)) {
      throw new Error(`IPC invoke blocked: unknown channel "${channel}"`);
    }
    return ipcRenderer.invoke(channel, ...args) as ReturnType<MainProcessAPI[K]>;
  },

  on<K extends keyof RendererEvents>(
    channel: K,
    handler: (data: RendererEvents[K]) => void,
  ): () => void {
    if (!EVENT_CHANNELS.has(channel)) {
      throw new Error(`IPC on blocked: unknown channel "${channel}"`);
    }
    const wrapped = (_event: Electron.IpcRendererEvent, data: RendererEvents[K]) => {
      handler(data);
    };
    listenerMap.set(handler, wrapped);
    ipcRenderer.on(channel, wrapped as (...args: unknown[]) => void);

    // Return an unsubscribe function for convenience
    return () => {
      api.off(channel, handler);
    };
  },

  off<K extends keyof RendererEvents>(
    channel: K,
    handler: (data: RendererEvents[K]) => void,
  ): void {
    if (!EVENT_CHANNELS.has(channel)) {
      throw new Error(`IPC off blocked: unknown channel "${channel}"`);
    }
    const wrapped = listenerMap.get(handler);
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped as (...args: unknown[]) => void);
      listenerMap.delete(handler);
    }
  },
};

contextBridge.exposeInMainWorld('api', api);
