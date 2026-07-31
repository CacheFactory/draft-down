// @archigraph plugin.system.plugins-bar
// Top-of-window strip that renders the Plugins menu, Extension Manager button,
// Console toggle, and HtmlDialog mount point.

import React, { useEffect, useState } from 'react';
import type { HostUI } from './draftdown/HostUIBackend';
import type { PluginLoader } from './PluginLoader';
import { PluginsMenu } from './PluginsMenu';
import { RubyConsolePanel } from './RubyConsolePanel';
import { ExtensionManagerPanel } from './ExtensionManagerPanel';
import { HtmlDialogHost } from './HtmlDialogHost';

export function PluginsBar() {
  const [host, setHost] = useState<HostUI | null>(null);
  const [loader, setLoader] = useState<PluginLoader | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [extOpen, setExtOpen] = useState(false);

  // Wait for Application to install the host UI / loader on window.
  useEffect(() => {
    const tick = () => {
      const h = (window as any).draftdownHostUI as HostUI | undefined;
      const l = (window as any).pluginLoader as PluginLoader | undefined;
      if (h && l) { setHost(h); setLoader(l); return true; }
      return false;
    };
    if (tick()) return;
    const id = window.setInterval(() => { if (tick()) window.clearInterval(id); }, 100);
    return () => window.clearInterval(id);
  }, []);

  if (!host || !loader) return null;

  return (
    <>
      <div className="plugins-bar">
        <PluginsMenu
          store={host.menus}
          prepend={[
            { label: 'Extension Manager…', action: () => setExtOpen(true) },
            { label: 'Console', action: () => setConsoleOpen(true) },
            { separator: true },
          ]}
        />
        <style>{`
          .plugins-bar {
            display: inline-flex; align-items: center;
            position: absolute; top: 0; right: 8px; height: var(--toolbar-height, 28px);
            z-index: 100;
          }
          .plugins-bar .menu-dropdown-trigger {
            display: flex; align-items: center; padding: 2px 10px;
            font-size: 12px; font-weight: 500; border: none; background: none;
            color: var(--text-primary); cursor: pointer; border-radius: 3px;
            height: 24px;
          }
          .plugins-bar .menu-dropdown-trigger:hover,
          .plugins-bar .menu-dropdown-trigger.active {
            background: var(--bg-hover, rgba(255,255,255,0.08));
          }
          .plugins-bar .menu-dropdown-panel {
            position: absolute; top: 100%; right: 0; z-index: 1000;
            min-width: 220px; padding: 4px 0;
            background: var(--bg-secondary, #2a2a2a);
            border: 1px solid var(--border-color, #444);
            border-radius: 4px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          }
          .plugins-bar .menu-dropdown-item {
            display: flex; align-items: center; justify-content: space-between;
            width: 100%; padding: 4px 16px; border: none; background: none;
            font-size: 12px; color: var(--text-primary); cursor: pointer;
            text-align: left; height: 26px;
          }
          .plugins-bar .menu-dropdown-item:hover:not(:disabled) {
            background: var(--bg-hover, rgba(255,255,255,0.08));
          }
          .plugins-bar .menu-dropdown-shortcut {
            font-size: 11px; color: var(--text-secondary, #888);
          }
          .plugins-bar .menu-dropdown-sep {
            height: 1px; background: var(--border-color, #444); margin: 4px 8px;
          }
        `}</style>
      </div>
      <RubyConsolePanel visible={consoleOpen} onClose={() => setConsoleOpen(false)} />
      <ExtensionManagerPanel visible={extOpen} onClose={() => setExtOpen(false)} loader={loader} />
      <HtmlDialogHost store={host.dialogs} />
    </>
  );
}
