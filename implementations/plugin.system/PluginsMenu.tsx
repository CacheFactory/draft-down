// @archigraph plugin.system.plugins-menu
// React component that renders the `Plugins` dropdown in MainToolbar.
// Driven by the live MenuStore so any plugin calling
// `UI.menu("Plugins").addItem(...)` shows up immediately.

import React, { useEffect, useRef, useState } from 'react';
import type { MenuStore, MenuNode } from './draftdown/HostUIBackend';
import type { MenuItem } from './draftdown/UI';

interface Props {
  store: MenuStore;
  /** Optional: extra static items appended at the top (e.g. Manage Extensions…). */
  prepend?: Array<{ label: string; action: () => void } | { separator: true }>;
}

function isMenuItem(x: unknown): x is MenuItem {
  return !!x && typeof (x as any).label === 'string' && typeof (x as any).handler === 'function';
}
function isMenuNode(x: unknown): x is MenuNode {
  return !!x && Array.isArray((x as any).items) && typeof (x as any).name === 'string';
}

export function PluginsMenu({ store, prepend = [] }: Props) {
  const [, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => store.events.on(() => setRev((r) => r + 1)), [store]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', click);
    return () => document.removeEventListener('mousedown', click);
  }, [open]);

  const node = store.list().find((m) => m.name === 'Plugins');
  const items = node?.items ?? [];

  return (
    <div ref={ref} className="menu-dropdown-wrapper">
      <button
        className={`menu-dropdown-trigger${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => {
          const bar = ref.current?.parentElement;
          if (bar && bar.querySelector('.menu-dropdown-trigger.active') && !open) setOpen(true);
        }}
      >
        Plugins
      </button>
      {open && (
        <div className="menu-dropdown-panel">
          {prepend.map((it, i) =>
            'separator' in it ? (
              <div key={`pp-${i}`} className="menu-dropdown-sep" />
            ) : (
              <button
                key={`pp-${i}`}
                className="menu-dropdown-item"
                onClick={() => { it.action(); setOpen(false); }}
              >
                <span>{it.label}</span>
              </button>
            ),
          )}
          {prepend.length > 0 && items.length > 0 && <div className="menu-dropdown-sep" />}
          {items.length === 0 && (
            <div style={{ padding: '6px 16px', fontSize: 11, color: 'var(--text-secondary)' }}>
              No plugin items registered yet.
            </div>
          )}
          {items.map((it, i) => {
            if ('separator' in it) return <div key={i} className="menu-dropdown-sep" />;
            if (isMenuItem(it)) {
              return (
                <button
                  key={i}
                  className="menu-dropdown-item"
                  onClick={() => {
                    setOpen(false);
                    Promise.resolve(it.handler()).catch((e) => console.error(e));
                  }}
                >
                  <span>{it.label}</span>
                </button>
              );
            }
            if (isMenuNode(it)) {
              return (
                <Submenu key={i} node={it} onSelect={() => setOpen(false)} />
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

function Submenu({ node, onSelect }: { node: MenuNode; onSelect: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button className="menu-dropdown-item" style={{ width: '100%' }}>
        <span>{node.name}</span>
        <span className="menu-dropdown-shortcut">▶</span>
      </button>
      {hover && (
        <div className="menu-dropdown-panel" style={{ left: '100%', top: 0, minWidth: 180 }}>
          {node.items.map((it, i) => {
            if ('separator' in it) return <div key={i} className="menu-dropdown-sep" />;
            if (isMenuItem(it)) {
              return (
                <button
                  key={i}
                  className="menu-dropdown-item"
                  onClick={() => {
                    onSelect();
                    Promise.resolve(it.handler()).catch((e) => console.error(e));
                  }}
                >
                  <span>{it.label}</span>
                </button>
              );
            }
            if (isMenuNode(it)) return <Submenu key={i} node={it} onSelect={onSelect} />;
            return null;
          })}
        </div>
      )}
    </div>
  );
}
