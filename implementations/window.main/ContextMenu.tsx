// @archigraph menu.context
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from './AppContext';

interface MenuItem {
  label: string;
  action: string;
  shortcut?: string;
  dividerAfter?: boolean;
  disabled?: boolean;
}

const emptySpaceItems: MenuItem[] = [
  { label: 'Paste', action: 'paste', shortcut: 'Ctrl+V' },
  { label: 'Select All', action: 'select-all', shortcut: 'Ctrl+A' },
  { label: 'Zoom Extents', action: 'zoom-extents', dividerAfter: true },
];

const faceItems: MenuItem[] = [
  { label: 'Entity Info', action: 'entity-info' },
  { label: 'Copy', action: 'copy', shortcut: 'Ctrl+C' },
  { label: 'Edit Material', action: 'edit-material', dividerAfter: true },
  { label: 'Reverse Faces', action: 'reverse-face' },
  { label: 'Orient Faces', action: 'orient-faces' },
  { label: 'Intersect Faces', action: 'intersect-faces', dividerAfter: true },
  { label: 'Make Group', action: 'make-group' },
  { label: 'Make Component', action: 'make-component', shortcut: 'Ctrl+G' },
];

const edgeItems: MenuItem[] = [
  { label: 'Entity Info', action: 'entity-info' },
  { label: 'Soften/Smooth', action: 'soften-edges' },
  { label: 'Unsoften', action: 'unsoften-edges' },
  { label: 'Hide Edge', action: 'hide-edges' },
  { label: 'Copy', action: 'copy', shortcut: 'Ctrl+C' },
  { label: 'Divide', action: 'divide', dividerAfter: true },
  { label: 'Weld Edges', action: 'weld' },
  { label: 'Hide', action: 'hide' },
  { label: 'Soften', action: 'soften', dividerAfter: true },
  { label: 'Make Component', action: 'make-component', shortcut: 'Ctrl+G' },
];

const groupItems: MenuItem[] = [
  { label: 'Entity Info', action: 'entity-info' },
  { label: 'Copy', action: 'copy', shortcut: 'Ctrl+C' },
  { label: 'Edit Group', action: 'edit-group', dividerAfter: true },
  { label: 'Explode', action: 'explode' },
  { label: 'Make Unique', action: 'make-unique' },
  { label: 'Lock', action: 'lock', dividerAfter: true },
  { label: 'Hide', action: 'hide' },
];

const componentItems: MenuItem[] = [
  { label: 'Make Unique', action: 'make-unique' },
  { label: 'Edit Component', action: 'edit-component', dividerAfter: true },
  { label: 'Explode', action: 'explode-component' },
  { label: 'Make Component', action: 'make-component', shortcut: 'Ctrl+G' },
];

export function ContextMenu() {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const { app, selectedEntityIds, selectedCount, activateTool, syncPreviews, syncToolState } = useApp();

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Only handle right-click on viewport canvas
      if ((e.target as HTMLElement).closest('.viewport-container')) {
        e.preventDefault();
        setPosition({ x: e.clientX, y: e.clientY });
        setVisible(true);
      }
    };

    const handleClick = () => setVisible(false);
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setVisible(false); };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const getMenuItems = (): MenuItem[] => {
    if (selectedCount === 0) return emptySpaceItems;

    if (app) {
      const sm = app.document.scene as any;
      // Check if the selected item is a component
      if (sm?.components?.has(selectedEntityIds[0])) {
        return componentItems;
      }

      const entity = app.document.scene.getEntity(selectedEntityIds[0]);
      if (!entity) {
        // Could be a geometry entity (face/edge) not in scene manager
        const geo = app.document.geometry;
        if (geo.getFace(selectedEntityIds[0])) return faceItems;
        if (geo.getEdge(selectedEntityIds[0])) return edgeItems;
        return emptySpaceItems;
      }

      switch (entity.type) {
        case 'face': return faceItems;
        case 'edge': return edgeItems;
        case 'group':
        case 'component_instance':
          return groupItems;
        default: return emptySpaceItems;
      }
    }
    return emptySpaceItems;
  };

  const handleAction = useCallback((action: string) => {
    setVisible(false);
    const sm = app?.document.scene as any;
    switch (action) {
      case 'select-all': app?.document.selection.selectAll(); break;
      case 'make-unique': {
        const sm = app?.document.scene as any;
        if (sm?.makeUnique && selectedEntityIds.length > 0) {
          sm.makeUnique(selectedEntityIds[0]);
        }
        break;
      }
      case 'soften-edges':
      case 'unsoften-edges':
      case 'hide-edges': {
        if (!app) break;
        const geo = app.document.geometry;
        const edges = selectedEntityIds
          .map(id => geo.getEdge(id))
          .filter(Boolean) as Array<NonNullable<ReturnType<typeof geo.getEdge>>>;
        if (edges.length === 0) break;
        const name = action === 'soften-edges' ? 'Soften Edges'
                   : action === 'unsoften-edges' ? 'Unsoften Edges' : 'Hide Edges';
        app.document.history.beginTransaction(name);
        for (const edge of edges) {
          if (action === 'soften-edges') { edge.soft = true; edge.smooth = true; }
          else if (action === 'unsoften-edges') { edge.soft = false; edge.smooth = false; edge.hidden = false; }
          else { edge.hidden = true; }
        }
        app.document.history.commitTransaction();
        app.document.selection.clear();
        (app as any).syncScene?.() ?? (app as any).sceneBridge?.sync();
        break;
      }
      case 'reverse-face': {
        if (!app) break;
        const geo = app.document.geometry;
        const ids = selectedEntityIds.filter(id => geo.getFace(id));
        if (ids.length === 0) break;
        app.document.history.beginTransaction('Reverse Faces');
        for (const id of ids) geo.reverseFace(id);
        app.document.history.commitTransaction();
        (app as any).syncScene?.() ?? (app as any).sceneBridge?.sync();
        break;
      }
      case 'orient-faces': {
        if (!app) break;
        const geo = app.document.geometry;
        const seed = selectedEntityIds.find(id => geo.getFace(id));
        if (!seed) break;
        app.document.history.beginTransaction('Orient Faces');
        const n = geo.orientFaces(seed);
        app.document.history.commitTransaction();
        (app as any).syncScene?.() ?? (app as any).sceneBridge?.sync();
        console.log(`[OrientFaces] reversed ${n} faces`);
        break;
      }
      case 'copy':
        (app as any)?.copySelection?.();
        break;
      case 'paste': {
        // Same flow as Cmd+V: clone attaches to the cursor via the Move tool.
        const placed = (app as any)?.pasteClipboard?.();
        if (placed) {
          activateTool('tool.move');
          const mt = (app as any)?.toolManager?.getTool?.('tool.move') as any;
          mt?.beginPlacement?.(placed.vertexIds, placed.anchor);
          (app as any)?.syncScene?.();
          (app as any)?.syncSelection?.();
          syncPreviews?.();
          syncToolState?.();
        }
        break;
      }
      case 'make-group': {
        const geo = app?.document.geometry;
        if (sm?.createComponent && geo) {
          const ids = Array.from(app!.document.selection.state.entityIds) as string[];
          if (ids.length > 0) {
            const allIds = new Set(ids);
            for (const id of ids) {
              if (geo.getFace(id)) {
                for (const edge of geo.getFaceEdges(id)) allIds.add(edge.id);
              }
            }
            const groupId = sm.createComponent('Group', Array.from(allIds), { isGroup: true });
            app!.document.selection.clear();
            app!.document.selection.add(groupId);
            (app as any).syncScene?.() ?? (app as any).sceneBridge?.sync();
          }
        }
        break;
      }
      case 'make-component': {
        const geo = app?.document.geometry;
        if (sm?.createComponent && geo) {
          const ids = Array.from(app!.document.selection.state.entityIds) as string[];
          if (ids.length > 0) {
            // Auto-include edges of selected faces
            const allIds = new Set(ids);
            for (const id of ids) {
              if (geo.getFace(id)) {
                const edges = geo.getFaceEdges(id);
                for (const edge of edges) allIds.add(edge.id);
              }
            }
            const compId = sm.createComponent('Component', Array.from(allIds));
            app!.document.selection.clear();
            app!.document.selection.add(compId);
            (app as any)?.syncScene?.();
            (app as any)?.syncSelection?.();
          }
        }
        break;
      }
      case 'edit-component': {
        if (sm?.enterComponent && selectedEntityIds.length > 0) {
          sm.enterComponent(selectedEntityIds[0]);
          app!.document.selection.clear();
          (app as any)?.syncScene?.();
          window.dispatchEvent(new CustomEvent('geometry-changed'));
        }
        break;
      }
      case 'explode-component': {
        if (sm?.explodeComponent && selectedEntityIds.length > 0) {
          sm.explodeComponent(selectedEntityIds[0]);
          app!.document.selection.clear();
          (app as any)?.syncScene?.();
          (app as any)?.syncSelection?.();
        }
        break;
      }
      case 'explode': /* app.explodeSelection() */ break;
      case 'hide': {
        // Scene entities (groups/components) hide via their visible flag;
        // raw geometry (faces/edges) via the scene manager's hidden set.
        // Edit > Unhide All brings everything back.
        const sm2 = app?.document.scene as any;
        selectedEntityIds.forEach(id => {
          const entity = app?.document.scene.getEntity(id);
          if (entity) entity.visible = false;
          else sm2?.setEntityHidden?.(id, true);
        });
        app?.document.selection.clear();
        (app as any)?.syncScene?.();
        (app as any)?.syncSelection?.();
        break;
      }
      case 'delete':
        // Same path as Edit > Delete / the Delete key: geometry first, scene
        // entities as fallback, one undo step. (scene.removeEntity alone
        // no-ops for faces/edges — they aren't scene entities.)
        (app as any)?.deleteSelection?.();
        (app as any)?.syncSelection?.();
        break;
    }
  }, [app, selectedEntityIds, activateTool, syncPreviews, syncToolState]);

  if (!visible) return null;

  const items = getMenuItems();

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, i) => (
        <React.Fragment key={item.action}>
          <button
            className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
            onClick={() => !item.disabled && handleAction(item.action)}
            disabled={item.disabled}
          >
            <span className="cm-label">{item.label}</span>
            {item.shortcut && <span className="cm-shortcut">{item.shortcut}</span>}
          </button>
          {item.dividerAfter && <div className="cm-divider" />}
        </React.Fragment>
      ))}

      <style>{`
        .context-menu {
          position: fixed;
          z-index: 1000;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          padding: 4px 0;
          min-width: 180px;
        }
        .context-menu-item {
          display: flex;
          align-items: center;
          width: 100%;
          padding: 4px 12px;
          text-align: left;
          border-radius: 0;
          font-size: var(--font-size);
        }
        .context-menu-item:hover:not(:disabled) {
          background: var(--accent);
          color: white;
        }
        .cm-label { flex: 1; }
        .cm-shortcut {
          color: var(--text-muted);
          font-size: var(--font-size-small);
          margin-left: 16px;
        }
        .context-menu-item:hover .cm-shortcut { color: rgba(255,255,255,0.7); }
        .cm-divider {
          height: 1px;
          background: var(--border-color);
          margin: 4px 0;
        }
      `}</style>
    </div>
  );
}
