// @archigraph web.entry
// Web entry point — installs WebPlatformBridge as window.api, then renders the app.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { installConsoleBuffer } from '../core/console-buffer';
import { WebPlatformBridge } from './WebPlatformBridge';

// Ring buffer of recent console errors/warnings — attached to bug reports.
installConsoleBuffer();
import { App } from '../../implementations/window.main/App';
import { MobileViewer } from './MobileViewer';
import '../../implementations/window.main/global.css';

// Install the web platform bridge so existing code that calls window.api works unchanged
const bridge = new WebPlatformBridge();
(window as any).api = bridge;

// Mark platform for conditional checks
(window as any).__PLATFORM__ = 'web';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

const root = createRoot(container);
root.render(isMobile() ? <MobileViewer /> : <App />);
