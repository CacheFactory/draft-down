// @archigraph process.renderer
// Entry point — kept in src/ for webpack. Imports from implementations/.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../implementations/window.main/App';
import { installConsoleBuffer } from '../core/console-buffer';
import '../../implementations/window.main/global.css';

// Ring buffer of recent console errors/warnings — attached to bug reports.
// Installed BEFORE the listeners below so their console.error calls land in it.
installConsoleBuffer();

// Global error logging — surface anything that escapes a try/catch so we never
// see "the app slowed down" or "nothing happened" without a message in the
// console. Both windows and async paths are covered.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => {
    // eslint-disable-next-line no-console
    console.error('[window error]', ev.message, '@', ev.filename + ':' + ev.lineno + ':' + ev.colno, ev.error);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    // eslint-disable-next-line no-console
    console.error('[unhandled promise]', ev.reason);
  });
}

// When running in a browser (no Electron preload), install the web platform bridge
if (typeof (window as any).api === 'undefined') {
  import('../web/WebPlatformBridge').then(({ WebPlatformBridge }) => {
    (window as any).api = new WebPlatformBridge();
    (window as any).__PLATFORM__ = 'web';
    mount();
  });
} else {
  mount();
}

function mount() {
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element not found');
  const root = createRoot(container);
  root.render(<App />);
}
