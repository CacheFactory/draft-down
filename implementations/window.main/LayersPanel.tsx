// @archigraph panel.layers
import React, { useState, useCallback } from 'react';
import { useApp } from './AppContext';

export function LayersPanel() {
  const { app, selectedEntityIds } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [newLayerName, setNewLayerName] = useState('');

  const sm = app?.document?.scene as any;
  const layers = sm?.layers ? Array.from(sm.layers.values()) as Array<{ id: string; name: string; visible: boolean; locked: boolean; color: { r: number; g: number; b: number } }> : [];
  const activeLayerId = sm?.activeLayerId ?? 'layer0';

  const handleAddLayer = useCallback(() => {
    if (!newLayerName.trim() || !sm) return;
    sm.addLayer(newLayerName.trim());
    setNewLayerName('');
    (app as any)?.syncScene?.();
  }, [newLayerName, sm, app]);

  const handleToggleVisibility = useCallback((layerId: string) => {
    sm?.setLayerVisibility(layerId, !sm.layers.get(layerId)?.visible);
    (app as any)?.syncScene?.();
  }, [sm, app]);

  const handleToggleLock = useCallback((layerId: string) => {
    if (sm?.setLayerLocked) {
      const layer = sm.layers.get(layerId);
      sm.setLayerLocked(layerId, !layer?.locked);
    }
  }, [sm]);

  const handleSetActive = useCallback((layerId: string) => {
    if (sm?.setActiveLayer) sm.setActiveLayer(layerId);
  }, [sm]);

  const handleAssignSelected = useCallback((layerId: string) => {
    if (!sm || selectedEntityIds.length === 0) return;
    for (const eid of selectedEntityIds) {
      sm.assignToLayer(eid, layerId);
    }
    (app as any)?.syncScene?.();
  }, [sm, selectedEntityIds, app]);

  const handleDeleteLayer = useCallback((layerId: string) => {
    sm?.removeLayer(layerId);
    (app as any)?.syncScene?.();
  }, [sm, app]);

  return (
    <div className="panel layers-panel">
      <div className="panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="panel-collapse">{collapsed ? '▸' : '▾'}</span>
        <span className="panel-title">Layers</span>
        <span className="panel-badge">{layers.length}</span>
      </div>
      {!collapsed && (
        <div className="panel-body">
          <div className="layer-add-row">
            <input
              type="text" placeholder="New layer..."
              value={newLayerName}
              onChange={e => setNewLayerName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddLayer()}
              className="layer-name-input"
            />
            <button onClick={handleAddLayer} className="layer-add-btn" title="Add Layer">+</button>
          </div>

          {selectedEntityIds.length > 0 && (
            <div className="layer-assign-hint">
              Click a layer name to assign {selectedEntityIds.length} selected entity(s) to it
            </div>
          )}

          <div className="layers-list">
            {layers.map(layer => (
              <div
                key={layer.id}
                className={`layer-row ${layer.id === activeLayerId ? 'active-layer' : ''}`}
              >
                <button
                  className={`layer-vis-btn ${!layer.visible ? 'layer-hidden' : ''}`}
                  onClick={() => handleToggleVisibility(layer.id)}
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                >{layer.visible ? '👁' : '·'}</button>

                <button
                  className={`layer-lock-btn ${layer.locked ? 'layer-locked' : ''}`}
                  onClick={() => handleToggleLock(layer.id)}
                  title={layer.locked ? 'Unlock' : 'Lock'}
                >{layer.locked ? '🔒' : '🔓'}</button>

                <span
                  className="layer-name"
                  onClick={() => {
                    if (selectedEntityIds.length > 0) {
                      handleAssignSelected(layer.id);
                    } else {
                      handleSetActive(layer.id);
                    }
                  }}
                  title={selectedEntityIds.length > 0 ? 'Assign selection to this layer' : 'Set as active layer'}
                >{layer.name}</span>

                {layer.id === activeLayerId && <span className="layer-active-badge">Active</span>}

                {layer.id !== 'layer0' && (
                  <button className="layer-delete-btn" onClick={() => handleDeleteLayer(layer.id)} title="Delete">×</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .layer-add-row { display: flex; gap: 4px; margin-bottom: 8px; }
        .layer-name-input { flex: 1; height: 24px; font-size: var(--font-size-small); }
        .layer-add-btn { width: 24px; height: 24px; font-size: 16px; font-weight: bold; padding: 0; display: flex; align-items: center; justify-content: center; }
        .layer-assign-hint { font-size: 10px; color: var(--accent); font-style: italic; margin-bottom: 6px; padding: 2px 4px; }
        .layers-list { display: flex; flex-direction: column; gap: 1px; }
        .layer-row {
          display: flex; align-items: center; gap: 4px;
          padding: 3px 4px; border-radius: 3px; font-size: var(--font-size-small);
        }
        .layer-row:hover { background: var(--bg-hover); }
        .layer-row.active-layer { background: var(--bg-tertiary); border-left: 2px solid var(--accent); }
        .layer-vis-btn, .layer-lock-btn {
          width: 20px; height: 20px; padding: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; opacity: 0.6;
        }
        .layer-vis-btn:hover, .layer-lock-btn:hover { opacity: 1; }
        .layer-hidden { opacity: 0.3; }
        .layer-locked { opacity: 1; color: var(--warning); }
        .layer-name { flex: 1; cursor: pointer; padding: 2px 0; }
        .layer-name:hover { color: var(--accent); }
        .layer-active-badge {
          font-size: 9px; color: var(--accent); background: var(--bg-active);
          padding: 1px 4px; border-radius: 3px;
        }
        .layer-delete-btn {
          width: 18px; height: 18px; padding: 0;
          font-size: 14px; opacity: 0.4;
          display: flex; align-items: center; justify-content: center;
        }
        .layer-delete-btn:hover { opacity: 1; color: var(--danger); }
      `}</style>
    </div>
  );
}
