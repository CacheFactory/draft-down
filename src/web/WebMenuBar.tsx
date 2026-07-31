// @archigraph web.menubar
// Browser menu bar replacing Electron native menus.
// Dispatches menu:action events through the WebPlatformBridge.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { MenuAction } from '../core/ipc-types';
import type { WebPlatformBridge } from './WebPlatformBridge';

interface MenuItem {
  label?: string;
  action?: MenuAction | string;
  separator?: boolean;
  shortcut?: string;
  disabled?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const mod = isMac ? '⌘' : 'Ctrl+';
const shift = isMac ? '⇧' : 'Shift+';

const menus: Menu[] = [
  {
    label: 'File',
    items: [
      { label: 'New', action: 'new', shortcut: `${mod}N` },
      { label: 'Open...', action: 'open', shortcut: `${mod}O` },
      { separator: true },
      { label: 'Save', action: 'save', shortcut: `${mod}S` },
      { label: 'Save As...', action: 'save-as', shortcut: `${shift}${mod}S` },
      { separator: true },
      { label: 'Import...', action: 'import', shortcut: `${mod}I` },
      { label: 'Export...', action: 'export', shortcut: `${mod}E` },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', action: 'undo', shortcut: `${mod}Z` },
      { label: 'Redo', action: 'redo', shortcut: `${shift}${mod}Z` },
      { separator: true },
      { label: 'Cut', action: 'cut', shortcut: `${mod}X` },
      { label: 'Copy', action: 'copy', shortcut: `${mod}C` },
      { label: 'Paste', action: 'paste', shortcut: `${mod}V` },
      { separator: true },
      { label: 'Select All', action: 'select-all', shortcut: `${mod}A` },
      { label: 'Delete', action: 'delete', shortcut: '⌫' },
      { separator: true },
      { label: 'Preferences...', action: 'preferences', shortcut: isMac ? '⌘,' : '' },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Zoom Extents', action: 'zoom-extents' },
      { label: 'Zoom Window', action: 'zoom-window' },
      { separator: true },
      { label: 'Toggle Full Screen', action: 'fullscreen', shortcut: isMac ? '⌃⌘F' : 'F11' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { label: 'Select', action: 'tool-select', shortcut: 'Space' },
      { label: 'Line', action: 'tool-line', shortcut: 'L' },
      { label: 'Rectangle', action: 'tool-rectangle', shortcut: 'R' },
      { label: 'Circle', action: 'tool-circle', shortcut: 'C' },
      { label: 'Arc', action: 'tool-arc', shortcut: 'A' },
      { separator: true },
      { label: 'Push/Pull', action: 'tool-push_pull', shortcut: 'P' },
      { label: 'Move', action: 'tool-move', shortcut: 'M' },
      { label: 'Rotate', action: 'tool-rotate', shortcut: 'Q' },
      { label: 'Scale', action: 'tool-scale', shortcut: 'S' },
      { label: 'Offset', action: 'tool-offset', shortcut: 'F' },
      { separator: true },
      { label: 'Eraser', action: 'tool-eraser', shortcut: 'E' },
      { label: 'Paint Bucket', action: 'tool-paint', shortcut: 'B' },
      { separator: true },
      { label: 'Orbit', action: 'tool-orbit', shortcut: 'O' },
      { label: 'Pan', action: 'tool-pan', shortcut: 'H' },
      { label: 'Zoom', action: 'tool-zoom', shortcut: 'Z' },
      { separator: true },
      { label: 'Tape Measure', action: 'tool-tape_measure', shortcut: 'T' },
      { label: 'Protractor', action: 'tool-protractor', shortcut: `${shift}P` },
      { label: 'Dimension', action: 'tool-dimension', shortcut: 'D' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'About DraftDown', action: 'about' },
      { label: 'Report a Bug…', action: 'report-bug' },
    ],
  },
];

export function WebMenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const dispatch = useCallback((action: string) => {
    const bridge = (window as any).api as WebPlatformBridge;
    if (bridge?.emit) {
      bridge.emit('menu:action', { action: action as MenuAction });
    }
    setOpenMenu(null);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (openMenu === null) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  return (
    <div className="web-menu-bar" ref={barRef}>
      {menus.map((menu, idx) => (
        <div
          key={menu.label}
          className={`web-menu-item ${openMenu === idx ? 'open' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); setOpenMenu(openMenu === idx ? null : idx); }}
          onMouseEnter={() => { if (openMenu !== null) setOpenMenu(idx); }}
        >
          <span className="web-menu-label">{menu.label}</span>
          {openMenu === idx && (
            <div className="web-menu-dropdown">
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={i} className="web-menu-separator" />
                ) : (
                  <div
                    key={i}
                    className={`web-menu-dropdown-item ${item.disabled ? 'disabled' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!item.disabled && item.action) dispatch(item.action);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="web-menu-shortcut">{item.shortcut}</span>}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}

      <style>{`
        .web-menu-bar {
          display: flex;
          align-items: center;
          height: 28px;
          background: var(--bg-secondary, #1e1e1e);
          border-bottom: 1px solid var(--border-color, #333);
          font-size: 12px;
          color: var(--text-primary, #ccc);
          user-select: none;
          -webkit-app-region: no-drag;
          flex-shrink: 0;
        }
        .web-menu-item {
          position: relative;
          padding: 0 10px;
          height: 100%;
          display: flex;
          align-items: center;
          cursor: default;
        }
        .web-menu-item:hover, .web-menu-item.open {
          background: var(--bg-tertiary, #333);
        }
        .web-menu-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          min-width: 200px;
          background: var(--bg-secondary, #1e1e1e);
          border: 1px solid var(--border-color, #444);
          border-radius: 4px;
          padding: 4px 0;
          z-index: 10000;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        }
        .web-menu-dropdown-item {
          padding: 4px 24px 4px 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 24px;
          cursor: default;
        }
        .web-menu-dropdown-item:hover:not(.disabled) {
          background: var(--accent, #4488ff);
          color: white;
        }
        .web-menu-dropdown-item.disabled {
          opacity: 0.4;
        }
        .web-menu-shortcut {
          font-size: 11px;
          opacity: 0.6;
        }
        .web-menu-separator {
          height: 1px;
          background: var(--border-color, #333);
          margin: 4px 0;
        }
      `}</style>
    </div>
  );
}
