// @archigraph window.main
// Component library: starter items + user-saved components. Clicking an
// item attaches it to the cursor via the Move tool's placement flow.
import React, { useState, useCallback } from 'react';
import { useApp } from './AppContext';
import { STARTER_LIBRARY, type LibraryItemDef } from './libraryItems';

const USER_LIB_KEY = 'draftdown:user-library';

function loadUserLibrary(): LibraryItemDef[] {
  try {
    return JSON.parse(localStorage.getItem(USER_LIB_KEY) ?? '[]');
  } catch { return []; }
}

export function LibraryPanel() {
  const { app, activateTool } = useApp();
  const [collapsed, setCollapsed] = useState(true);
  const [userItems, setUserItems] = useState<LibraryItemDef[]>(loadUserLibrary);

  const place = useCallback((item: LibraryItemDef) => {
    const a = app as any;
    const placed = a?.placeLibraryItem?.(item);
    if (placed) {
      activateTool('tool.move');
      const move = a.toolManager.getActiveTool();
      (move as any)?.beginPlacement?.(placed.vertexIds, placed.anchor, { onCommit: placed.onCommit });
    }
  }, [app, activateTool]);

  const saveSelection = useCallback(() => {
    const a = app as any;
    if (!a) return;
    const geo = a.document.geometry;
    const ids: string[] = Array.from(a.document.selection.state.entityIds);
    // Resolve a selected component to its entities
    const sm = a.document.scene;
    const entityIds: string[] = [];
    for (const id of ids) {
      const comp = sm.components?.get?.(id);
      if (comp) entityIds.push(...comp.entityIds);
      else entityIds.push(id);
    }
    if (entityIds.length === 0) {
      window.alert('Select geometry (or a component) first.');
      return;
    }

    // Capture vertices relative to the min corner so placement is predictable
    const vertexIndex = new Map<string, number>();
    const vertices: Array<{ x: number; y: number; z: number }> = [];
    const faces: number[][] = [];
    const edges: Array<[number, number]> = [];
    const takeVertex = (vid: string): number => {
      let idx = vertexIndex.get(vid);
      if (idx === undefined) {
        const v = geo.getVertex(vid);
        idx = vertices.length;
        vertexIndex.set(vid, idx);
        vertices.push({ ...v.position });
      }
      return idx;
    };
    const edgeSeen = new Set<string>();
    for (const id of entityIds) {
      const face = geo.getFace(id);
      if (face) {
        faces.push(face.vertexIds.map((vid: string) => takeVertex(vid)));
        continue;
      }
      const edge = geo.getEdge(id);
      if (edge && !edgeSeen.has(edge.id)) {
        edgeSeen.add(edge.id);
        edges.push([takeVertex(edge.startVertexId), takeVertex(edge.endVertexId)]);
      }
    }
    if (vertices.length === 0) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    for (const v of vertices) {
      minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); minZ = Math.min(minZ, v.z);
    }
    for (const v of vertices) { v.x -= minX; v.y -= minY; v.z -= minZ; }

    const name = window.prompt('Component name:', 'My Component');
    if (!name) return;
    const item: LibraryItemDef = {
      id: `user-${Date.now()}`, name, icon: '📦', vertices, faces, edges,
    };
    const next = [...userItems, item];
    setUserItems(next);
    try { localStorage.setItem(USER_LIB_KEY, JSON.stringify(next)); } catch { /* full */ }
  }, [app, userItems]);

  const removeUserItem = useCallback((id: string) => {
    const next = userItems.filter(i => i.id !== id);
    setUserItems(next);
    try { localStorage.setItem(USER_LIB_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [userItems]);

  return (
    <div className="library-panel panel">
      <div className="panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span>Components</span>
        <span>{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div className="library-body">
          <div className="library-grid">
            {STARTER_LIBRARY.map(item => (
              <button key={item.id} className="library-item" title={`Place ${item.name}`}
                      onClick={() => place(item)}>
                <span className="library-icon">{item.icon}</span>
                <span className="library-name">{item.name}</span>
              </button>
            ))}
            {userItems.map(item => (
              <button key={item.id} className="library-item user" title={`Place ${item.name} (right-click removes)`}
                      onClick={() => place(item)}
                      onContextMenu={(e) => { e.preventDefault(); removeUserItem(item.id); }}>
                <span className="library-icon">{item.icon}</span>
                <span className="library-name">{item.name}</span>
              </button>
            ))}
          </div>
          <button className="library-save" onClick={saveSelection}>+ Save Selection to Library</button>
        </div>
      )}
      <style>{`
        .library-panel { border-top: 1px solid var(--border-color); font-size: 12px; }
        .library-panel .panel-header {
          display: flex; justify-content: space-between; padding: 6px 10px;
          font-weight: 600; cursor: pointer; user-select: none;
        }
        .library-body { padding: 6px 8px 10px; }
        .library-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
        .library-item {
          display: flex; align-items: center; gap: 6px; padding: 6px 8px;
          background: var(--bg-primary); border: 1px solid var(--border-color);
          border-radius: 4px; cursor: pointer; color: var(--text-primary);
        }
        .library-item:hover { border-color: var(--accent, #4488ff); }
        .library-icon { font-size: 16px; }
        .library-name { font-size: 11px; }
        .library-save {
          margin-top: 6px; width: 100%; padding: 5px; font-size: 11px;
          background: var(--bg-primary); border: 1px dashed var(--border-color);
          border-radius: 4px; cursor: pointer; color: var(--text-muted);
        }
        .library-save:hover { color: var(--text-primary); border-color: var(--accent, #4488ff); }
      `}</style>
    </div>
  );
}
