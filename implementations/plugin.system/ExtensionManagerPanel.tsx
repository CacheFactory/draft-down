// @archigraph plugin.system.extension-manager
// DraftDown's "Extension Manager" — list, enable, disable, install plugins.


import React, { useEffect, useRef, useState } from 'react';
import type { PluginLoader } from './PluginLoader';

interface Props {
  visible: boolean;
  onClose(): void;
  loader: PluginLoader;
}

interface Row {
  id: string;
  name: string;
  version?: string;
  description?: string;
  creator?: string;
  loaded: boolean;
  fromSource: boolean;
}

export function ExtensionManagerPanel({ visible, onClose, loader }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [, setRev] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    const w = window as any;
    const list: Row[] = (w.DraftDown?.extensionList?.() ?? []).map((e: any) => ({
      id: e.ext.id,
      name: e.ext.name,
      version: e.ext.version,
      description: e.ext.description,
      creator: e.ext.creator,
      loaded: e.loaded,
      fromSource: loader.list().some((p) => p.id === e.ext.id),
    }));
    setRows(list);
  };

  useEffect(() => { if (visible) refresh(); }, [visible]);
  // Re-poll on registry mutations.
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => { refresh(); setRev((r) => r + 1); }, 500);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const toggle = (row: Row) => {
    const w = window as any;
    if (row.loaded) w.DraftDown.unloadExtension(row.id);
    else w.DraftDown.loadExtension(row.id);
    refresh();
  };

  const uninstall = (row: Row) => {
    if (!window.confirm(`Uninstall "${row.name}"? This removes its cached source so it won't reload on next launch.`)) return;
    const w = window as any;
    try { loader.unload(row.id); } catch (e) { console.warn('[ExtensionManager] loader.unload failed:', e); }
    try { w.DraftDown?.uninstallExtension?.(row.id); } catch (e) { console.warn('[ExtensionManager] uninstallExtension failed:', e); }
    refresh();
  };

  const onPickFile = () => fileRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await loader.loadFromFile(f);
    } catch (err: any) {
      window.alert(`Failed to install: ${err?.message ?? err}`);
    }
    e.target.value = '';
    refresh();
  };

  return (
    <div className="ext-manager-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ext-manager">
        <div className="ext-bar">
          <span className="ext-title">Extension Manager</span>
          <button className="ext-install" onClick={onPickFile}>Install Extension…</button>
          <button className="ext-close" onClick={onClose}>✕</button>
          <input ref={fileRef} type="file" accept=".js,.draftdownext,.txt" hidden onChange={onFile} />
        </div>
        <div className="ext-list">
          {rows.length === 0 && (
            <div className="ext-empty">
              No extensions installed. Click <em>Install Extension…</em> and pick a JS file.
            </div>
          )}
          {rows.map((r) => (
            <div key={r.id} className="ext-row">
              <div className="ext-meta">
                <div className="ext-name">{r.name} <span className="ext-version">{r.version ?? ''}</span></div>
                <div className="ext-id">{r.id}</div>
                {r.description && <div className="ext-desc">{r.description}</div>}
                {r.creator && <div className="ext-creator">by {r.creator}</div>}
              </div>
              <div className="ext-actions">
                <span className={`ext-state ${r.loaded ? 'on' : 'off'}`}>{r.loaded ? 'Enabled' : 'Disabled'}</span>
                <button onClick={() => toggle(r)}>{r.loaded ? 'Disable' : 'Enable'}</button>
                <button className="ext-uninstall" onClick={() => uninstall(r)}>Uninstall</button>
              </div>
            </div>
          ))}
        </div>
        <style>{`
          .ext-manager-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.4);
            display: flex; align-items: center; justify-content: center; z-index: 2000;
          }
          .ext-manager {
            width: 640px; max-height: 80vh; display: flex; flex-direction: column;
            background: var(--bg-secondary, #1f1f1f); border: 1px solid var(--border-color, #444);
            border-radius: 6px; box-shadow: 0 12px 48px rgba(0,0,0,0.5);
            color: var(--text-primary, #e0e0e0); font-size: 13px;
          }
          .ext-bar {
            display: flex; align-items: center; gap: 8px; padding: 8px 12px;
            border-bottom: 1px solid var(--border-color, #444);
          }
          .ext-title { flex: 1; font-weight: 600; }
          .ext-install {
            background: #2a6cf8; color: white; border: none; padding: 4px 10px;
            border-radius: 3px; cursor: pointer; font-size: 12px;
          }
          .ext-close {
            background: transparent; border: none; color: var(--text-secondary, #999);
            cursor: pointer; font-size: 16px; padding: 0 6px;
          }
          .ext-list { flex: 1; overflow: auto; padding: 8px 0; }
          .ext-row {
            display: flex; align-items: center; gap: 12px; padding: 10px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.04);
          }
          .ext-meta { flex: 1; }
          .ext-name { font-weight: 600; }
          .ext-version { color: var(--text-secondary, #888); font-weight: 400; margin-left: 6px; }
          .ext-id { color: var(--text-secondary, #888); font-size: 11px; font-family: ui-monospace, monospace; }
          .ext-desc { margin-top: 4px; color: var(--text-primary, #e0e0e0); }
          .ext-creator { color: var(--text-secondary, #888); font-size: 11px; margin-top: 2px; }
          .ext-state.on { color: #4ade80; margin-right: 8px; font-size: 11px; }
          .ext-state.off { color: var(--text-secondary, #888); margin-right: 8px; font-size: 11px; }
          .ext-actions { display: flex; align-items: center; gap: 6px; }
          .ext-actions button {
            background: transparent; color: var(--text-primary, #e0e0e0);
            border: 1px solid var(--border-color, #444); padding: 3px 10px;
            border-radius: 3px; cursor: pointer; font-size: 11px;
          }
          .ext-actions button.ext-uninstall {
            color: #f88; border-color: #844;
          }
          .ext-actions button.ext-uninstall:hover {
            background: rgba(255, 60, 60, 0.1); border-color: #f66; color: #fbb;
          }
          .ext-empty { padding: 32px; text-align: center; color: var(--text-secondary, #888); }
        `}</style>
      </div>
    </div>
  );
}
