// @archigraph panel.tool_settings
// Right-side panel showing tool-specific settings. Content changes based on active tool.
import React, { useState, useCallback, useEffect } from 'react';
import { useApp } from './AppContext';
import type { MaterialDef, Color } from '../../src/core/types';

function colorToHex(c: Color): string {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function hexToColor(hex: string): Color {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b, a: 1 };
}

// ─── Paint Tool Settings ────────────────────────────────────────

function PaintToolSettings() {
  const { app } = useApp();
  const [materials, setMaterials] = useState<MaterialDef[]>([]);
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);
  const [newColor, setNewColor] = useState('#4488ff');
  const [revision, setRevision] = useState(0);

  const refreshMaterials = useCallback(() => {
    try {
      if (!app?.document?.materials) return;
      const mats = app.document.materials.getAllMaterials();
      setMaterials([...mats]);
      const tool = app.toolManager?.getTool?.('tool.paint') as any;
      if (tool?.activeMaterialId !== undefined) {
        setActiveMaterialId(tool.activeMaterialId);
      }
    } catch (e) {
      console.error('PaintToolSettings refresh error:', e);
    }
  }, [app]);

  useEffect(() => {
    refreshMaterials();
    if (!app?.document?.materials) return;
    const handler = () => { setRevision(r => r + 1); };
    app.document.materials.on('changed', handler);
    return () => { app.document.materials.off('changed', handler); };
  }, [app, refreshMaterials]);

  useEffect(() => { refreshMaterials(); }, [revision, refreshMaterials]);

  const selectMaterial = (id: string) => {
    try {
      const tool = app?.toolManager?.getTool?.('tool.paint') as any;
      if (tool) tool.activeMaterialId = id;
      setActiveMaterialId(id);
    } catch (e) {
      console.error('selectMaterial error:', e);
    }
  };

  const addMaterial = () => {
    try {
      if (!app?.document?.materials) return;
      const color = hexToColor(newColor);
      const count = materials.length;
      const mat = app.document.materials.addMaterial({
        name: `Color ${count}`,
        color,
        opacity: 1,
        roughness: 0.5,
        metalness: 0,
      });
      selectMaterial(mat.id);
    } catch (e) {
      console.error('addMaterial error:', e);
    }
  };

  const deleteMaterial = (id: string) => {
    try {
      if (!app?.document?.materials || id === '__default__') return;
      app.document.materials.removeMaterial(id);
      if (activeMaterialId === id) {
        setActiveMaterialId(null);
        const tool = app.toolManager?.getTool?.('tool.paint') as any;
        if (tool) tool.activeMaterialId = null;
      }
    } catch (e) {
      console.error('deleteMaterial error:', e);
    }
  };

  const activeMat = materials.find(m => m.id === activeMaterialId);

  return (
    <div className="paint-settings">
      <div className="paint-add-row">
        <input
          type="color"
          value={newColor}
          onChange={e => setNewColor(e.target.value)}
          className="paint-color-input"
          title="Pick a color"
        />
        <button className="paint-add-btn" onClick={addMaterial}>+ Add Color</button>
      </div>

      <div className="paint-section-label">Materials ({materials.length})</div>

      <div className="paint-swatch-grid">
        {materials.map(mat => (
          <div key={mat.id} className="paint-swatch-wrapper">
            <button
              className={`paint-swatch${activeMaterialId === mat.id ? ' active' : ''}`}
              style={mat.albedoMap
                ? { backgroundImage: `url(${mat.albedoMap})`, backgroundSize: 'cover' }
                : { background: colorToHex(mat.color) }
              }
              onClick={() => selectMaterial(mat.id)}
              title={mat.name}
            />
            {mat.id !== '__default__' && (
              <button
                className="paint-swatch-delete"
                onClick={(e) => { e.stopPropagation(); deleteMaterial(mat.id); }}
                title="Delete"
              >x</button>
            )}
          </div>
        ))}
      </div>

      {activeMat && (
        <div className="paint-active-info">
          <div
            className="paint-active-preview"
            style={activeMat.albedoMap
              ? { backgroundImage: `url(${activeMat.albedoMap})`, backgroundSize: 'cover' }
              : { background: colorToHex(activeMat.color) }
            }
          />
          <span className="paint-active-name">{activeMat.name}</span>
        </div>
      )}

      <div className="paint-help">
        Click face to paint. Shift+click to sample. Alt+click to fill matching.
      </div>

      <style>{`
        .paint-settings { display: flex; flex-direction: column; gap: 6px; }
        .paint-add-row { display: flex; gap: 6px; align-items: center; }
        .paint-color-input {
          width: 32px; height: 26px; padding: 0; border: 1px solid var(--border-color);
          border-radius: 4px; cursor: pointer; background: none;
        }
        .paint-color-input::-webkit-color-swatch-wrapper { padding: 2px; }
        .paint-color-input::-webkit-color-swatch { border-radius: 2px; border: none; }
        .paint-add-btn {
          flex: 1; padding: 4px 8px; border-radius: 4px;
          background: var(--accent); color: white;
          font-size: 11px; font-weight: 500;
        }
        .paint-add-btn:hover { background: var(--accent-hover); }
        .paint-section-label {
          font-size: 10px; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.5px;
          padding-top: 4px;
        }
        .paint-swatch-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
          gap: 4px;
        }
        .paint-swatch-wrapper { position: relative; }
        .paint-swatch {
          width: 100%; aspect-ratio: 1; border-radius: 4px;
          border: 2px solid transparent; cursor: pointer;
          transition: border-color 0.1s;
        }
        .paint-swatch:hover { border-color: var(--text-secondary); }
        .paint-swatch.active {
          border-color: white;
          box-shadow: 0 0 0 1px var(--accent);
        }
        .paint-swatch-delete {
          position: absolute; top: -4px; right: -4px;
          width: 14px; height: 14px; border-radius: 50%;
          background: #e44; color: white; font-size: 9px;
          line-height: 14px; text-align: center;
          cursor: pointer; display: none; padding: 0; border: none;
        }
        .paint-swatch-wrapper:hover .paint-swatch-delete { display: block; }
        .paint-active-info {
          display: flex; gap: 8px; align-items: center;
          font-size: 11px; padding: 6px;
          background: var(--bg-tertiary); border-radius: 4px;
        }
        .paint-active-preview {
          width: 24px; height: 24px; border-radius: 3px;
          border: 1px solid var(--border-color); flex-shrink: 0;
        }
        .paint-active-name { font-weight: 500; }
        .paint-help {
          font-size: 10px; color: var(--text-muted);
          line-height: 1.4; padding-top: 4px;
          border-top: 1px solid var(--border-color);
        }
      `}</style>
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────

const toolPanels: Record<string, { title: string; Component: React.FC }> = {
  'tool.paint': { title: 'Paint', Component: PaintToolSettings },
};

export function ToolSettingsPanel() {
  const { activeToolId } = useApp();
  const [collapsed, setCollapsed] = useState(false);

  const panel = activeToolId ? toolPanels[activeToolId] : null;
  if (!panel) return null;

  const { title, Component } = panel;

  return (
    <div className="panel tool-settings-panel">
      <div className="panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="panel-collapse">{collapsed ? '▸' : '▾'}</span>
        <span className="panel-title">{title}</span>
      </div>

      {!collapsed && (
        <div className="panel-body">
          <Component />
        </div>
      )}

      <style>{`
        .tool-settings-panel { border-bottom: 1px solid var(--border-color); }
        .tool-settings-panel .panel-header {
          display: flex; align-items: center; padding: 6px 8px;
          cursor: pointer; background: var(--bg-tertiary); gap: 4px; font-weight: 500;
          font-size: 12px;
        }
        .tool-settings-panel .panel-header:hover { background: var(--bg-hover); }
        .tool-settings-panel .panel-collapse { font-size: 10px; color: var(--text-muted); }
        .tool-settings-panel .panel-title { flex: 1; }
        .tool-settings-panel .panel-body { padding: 8px; }
      `}</style>
    </div>
  );
}
