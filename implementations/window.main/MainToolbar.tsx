// @archigraph toolbar.main
// Top toolbar: File/Edit dropdown menus, document title.
import React, { useState, useRef, useEffect } from 'react';
import { useApp } from './AppContext';

type MenuItem =
  | { label: string; action: () => void; disabled?: boolean; shortcut?: string }
  | { separator: true };

function DropdownMenu({
  label,
  items,
  open,
  onToggle,
  onClose,
}: {
  label: string;
  items: MenuItem[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  return (
    <div ref={ref} className="menu-dropdown-wrapper">
      <button
        className={`menu-dropdown-trigger${open ? ' active' : ''}`}
        onClick={onToggle}
        onMouseEnter={() => {
          // If another menu is already open in the bar, open this one on hover
          const bar = ref.current?.parentElement;
          if (bar && bar.querySelector('.menu-dropdown-trigger.active') && !open) {
            onToggle();
          }
        }}
      >
        {label}
      </button>
      {open && (
        <div className="menu-dropdown-panel">
          {items.map((item, i) =>
            'separator' in item ? (
              <div key={i} className="menu-dropdown-sep" />
            ) : (
              <button
                key={i}
                className="menu-dropdown-item"
                disabled={item.disabled}
                onClick={() => {
                  item.action();
                  onClose();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="menu-dropdown-shortcut">{item.shortcut}</span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function MainToolbar() {
  const { app, undo, redo, canUndo, canRedo, undoName, redoName, documentName, dirty } = useApp();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const close = () => setOpenMenu(null);
  const toggle = (name: string) => () =>
    setOpenMenu((prev) => (prev === name ? null : name));

  const fileItems: MenuItem[] = [
    { label: 'New', action: () => (app as any)?.newDocument?.(), shortcut: '\u2318N' },
    { label: 'Open\u2026', action: () => (app as any)?.openDocument?.(), shortcut: '\u2318O' },
    { separator: true },
    { label: 'Save', action: () => (app as any)?.saveDocument?.(), shortcut: '\u2318S' },
    { label: 'Save As\u2026', action: () => (app as any)?.saveDocumentAs?.(), shortcut: '\u21e7\u2318S' },
    { separator: true },
    { label: 'Import\u2026', action: () => (app as any)?.importFile?.(), shortcut: '\u2318I' },
    { label: 'Export\u2026', action: () => {
      // Emit menu action so App.tsx opens the export modal
      window.dispatchEvent(new CustomEvent('show-export-modal'));
    }, shortcut: '\u2318E' },
  ];

  const outputItems: MenuItem[] = [
    { label: 'Export Image (2x PNG)', action: () => (app as any)?.exportImage?.(2) },
    { label: 'Export PDF Sheets', action: () => (app as any)?.exportPdf?.() },
  ];

  const editItems: MenuItem[] = [
    {
      label: undoName ? `Undo ${undoName}` : 'Undo',
      action: undo,
      disabled: !canUndo,
      shortcut: '\u2318Z',
    },
    {
      label: redoName ? `Redo ${redoName}` : 'Redo',
      action: redo,
      disabled: !canRedo,
      shortcut: '\u21e7\u2318Z',
    },
    { separator: true },
    { label: 'Select All', action: () => (app as any)?.document?.selection?.selectAll?.(), shortcut: '\u2318A' },
    { label: 'Delete', action: () => {
      const a = app as any;
      if (!a) return;
      const ids = Array.from(a.document?.selection?.state?.entityIds ?? []);
      if (ids.length === 0) return;
      a.document.history.beginTransaction('Delete');
      (ids as string[]).forEach((id) => a.document.scene.removeEntity(id));
      a.document.selection.clear();
      a.document.history.commitTransaction();
      a.sceneBridge?.sync();
    }, shortcut: '\u232b' },
    { separator: true },
    { label: 'Delete Guides', action: () => (app as any)?.deleteAllGuides?.() },
  ];

  return (
    <div className="main-toolbar">
      <div className="menu-bar">
        <DropdownMenu label="File" items={fileItems} open={openMenu === 'file'} onToggle={toggle('file')} onClose={close} />
        <DropdownMenu label="Edit" items={editItems} open={openMenu === 'edit'} onToggle={toggle('edit')} onClose={close} />
      </div>

      <span className="app-title">{documentName}{dirty ? ' *' : ''}</span>

      <style>{`
        .main-toolbar {
          display: flex; align-items: center; height: var(--toolbar-height);
          padding: 0 4px; gap: 4px; background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
          -webkit-app-region: drag;
          user-select: none;
        }
        .menu-bar {
          display: flex; align-items: center; gap: 0;
          -webkit-app-region: no-drag;
        }
        .menu-dropdown-wrapper { position: relative; }
        .menu-dropdown-trigger {
          display: flex; align-items: center; padding: 2px 8px;
          font-size: 12px; font-weight: 500; border: none; background: none;
          color: var(--text-primary); cursor: pointer; border-radius: 3px;
          height: 24px;
        }
        .menu-dropdown-trigger:hover, .menu-dropdown-trigger.active {
          background: var(--bg-hover, rgba(255,255,255,0.08));
        }
        .menu-dropdown-panel {
          position: absolute; top: 100%; left: 0; z-index: 1000;
          min-width: 200px; padding: 4px 0;
          background: var(--bg-secondary, #2a2a2a);
          border: 1px solid var(--border-color, #444);
          border-radius: 4px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        .menu-dropdown-item {
          display: flex; align-items: center; justify-content: space-between;
          width: 100%; padding: 4px 16px; border: none; background: none;
          font-size: 12px; color: var(--text-primary); cursor: pointer;
          text-align: left; height: 26px;
        }
        .menu-dropdown-item:hover:not(:disabled) {
          background: var(--bg-hover, rgba(255,255,255,0.08));
        }
        .menu-dropdown-item:disabled {
          opacity: 0.4; cursor: default;
        }
        .menu-dropdown-shortcut {
          font-size: 11px; color: var(--text-secondary, #888);
          margin-left: 24px;
        }
        .menu-dropdown-sep {
          height: 1px; background: var(--border-color, #444); margin: 4px 8px;
        }
        .app-title {
          font-size: 12px; color: var(--text-secondary); padding: 0 8px;
          -webkit-app-region: drag;
        }
      `}</style>
    </div>
  );
}
