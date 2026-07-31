// @archigraph window.materials
import React, { useState, useCallback } from 'react';
import { useApp } from '../window.main/AppContext';
import { MaterialDef, Color } from '../../src/core/types';

interface MaterialsBrowserProps {
  visible: boolean;
  onClose: () => void;
}

export function MaterialsBrowser({ visible, onClose }: MaterialsBrowserProps) {
  const { app, activateTool } = useApp();
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<MaterialDef | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const materials = app?.document.materials.getAllMaterials() ?? [];
  const filtered = searchFilter
    ? materials.filter(m => m.name.toLowerCase().includes(searchFilter.toLowerCase()))
    : materials;

  const handleSelectMaterial = useCallback((id: string) => {
    setSelectedMaterialId(id);
    const mat = app?.document.materials.getMaterial(id);
    if (mat) setEditingMaterial({ ...mat });
    // classic CAD behavior: choosing a material in the browser arms the Paint
    // Bucket with it and switches to the tool. Without this, the browser
    // selection never reached the paint tool and painting silently did nothing.
    const paint = app?.toolManager?.getTool?.('tool.paint') as any;
    if (paint) {
      paint.activeMaterialId = id;
      activateTool('tool.paint');
    }
  }, [app, activateTool]);

  const handleUpdateMaterial = useCallback((field: string, value: unknown) => {
    if (!editingMaterial) return;
    setEditingMaterial(prev => prev ? { ...prev, [field]: value } : null);
  }, [editingMaterial]);

  const handleSaveMaterial = useCallback(() => {
    if (editingMaterial && app) {
      app.document.materials.updateMaterial(editingMaterial.id, editingMaterial);
      setEditingMaterial(null);
    }
  }, [editingMaterial, app]);

  const handleNewMaterial = useCallback(() => {
    if (app) {
      const mat = app.document.materials.addMaterial({
        name: `Material ${materials.length + 1}`,
        color: { r: 0.7, g: 0.7, b: 0.7 },
        opacity: 1,
        roughness: 0.5,
        metalness: 0,
      });
      setSelectedMaterialId(mat.id);
      setEditingMaterial({ ...mat });
    }
  }, [app, materials.length]);

  const colorToHex = (c: Color): string => {
    const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
  };

  const hexToColor = (hex: string): Color => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
  };

  if (!visible) return null;

  return (
    <div className="materials-window">
      <div className="mat-header">
        <h3>Materials</h3>
        <button className="mat-close" onClick={onClose}>×</button>
      </div>

      <div className="mat-toolbar">
        <input
          className="mat-search"
          placeholder="Search materials..."
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
        />
        <button className="mat-new-btn" onClick={handleNewMaterial} title="New Material">+</button>
      </div>

      <div className="mat-grid">
        {filtered.map(mat => (
          <div
            key={mat.id}
            className={`mat-swatch ${selectedMaterialId === mat.id ? 'selected' : ''}`}
            onClick={() => handleSelectMaterial(mat.id)}
            title={mat.name}
          >
            <div className="mat-preview" style={{ background: colorToHex(mat.color), opacity: mat.opacity }} />
            <span className="mat-name">{mat.name}</span>
          </div>
        ))}
      </div>

      {editingMaterial && (
        <div className="mat-editor">
          <h4>Edit: {editingMaterial.name}</h4>
          <label className="mat-field">
            <span>Name</span>
            <input value={editingMaterial.name} onChange={e => handleUpdateMaterial('name', e.target.value)} />
          </label>
          <label className="mat-field">
            <span>Color</span>
            <input type="color" value={colorToHex(editingMaterial.color)}
              onChange={e => handleUpdateMaterial('color', hexToColor(e.target.value))} />
          </label>
          <label className="mat-field">
            <span>Opacity</span>
            <input type="range" min={0} max={1} step={0.05} value={editingMaterial.opacity}
              onChange={e => handleUpdateMaterial('opacity', parseFloat(e.target.value))} />
          </label>
          <label className="mat-field">
            <span>Roughness</span>
            <input type="range" min={0} max={1} step={0.05} value={editingMaterial.roughness}
              onChange={e => handleUpdateMaterial('roughness', parseFloat(e.target.value))} />
          </label>
          <label className="mat-field">
            <span>Metalness</span>
            <input type="range" min={0} max={1} step={0.05} value={editingMaterial.metalness}
              onChange={e => handleUpdateMaterial('metalness', parseFloat(e.target.value))} />
          </label>
          <div className="mat-editor-actions">
            <button onClick={() => setEditingMaterial(null)}>Cancel</button>
            <button className="mat-save" onClick={handleSaveMaterial}>Apply</button>
          </div>
        </div>
      )}

      <style>{`
        .materials-window {
          position: fixed; right: 20px; top: 100px;
          width: 400px; height: 600px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          display: flex; flex-direction: column;
          z-index: 1500;
          resize: both; overflow: hidden;
        }
        .mat-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px; border-bottom: 1px solid var(--border-color);
        }
        .mat-header h3 { font-size: 13px; }
        .mat-close { font-size: 18px; width: 24px; height: 24px; padding: 0; }
        .mat-toolbar {
          display: flex; gap: 4px; padding: 8px;
          border-bottom: 1px solid var(--border-color);
        }
        .mat-search { flex: 1; height: 26px; }
        .mat-new-btn {
          width: 26px; height: 26px; font-size: 16px; font-weight: bold; padding: 0;
        }
        .mat-grid {
          flex: 1; overflow-y: auto; padding: 8px;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
          gap: 8px;
        }
        .mat-swatch {
          display: flex; flex-direction: column; align-items: center;
          cursor: pointer; padding: 4px; border-radius: 4px;
          border: 2px solid transparent;
        }
        .mat-swatch:hover { border-color: var(--border-light); }
        .mat-swatch.selected { border-color: var(--accent); }
        .mat-preview {
          width: 56px; height: 56px; border-radius: 4px;
          border: 1px solid var(--border-color);
        }
        .mat-name {
          font-size: 10px; color: var(--text-secondary);
          margin-top: 2px; text-align: center;
          max-width: 66px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mat-editor {
          border-top: 1px solid var(--border-color);
          padding: 12px; display: flex; flex-direction: column; gap: 8px;
        }
        .mat-editor h4 { font-size: 12px; margin-bottom: 4px; }
        .mat-field {
          display: flex; align-items: center; justify-content: space-between;
          font-size: var(--font-size-small);
        }
        .mat-field input[type="text"], .mat-field input[type="color"] { width: 140px; }
        .mat-field input[type="range"] { width: 140px; }
        .mat-editor-actions {
          display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;
        }
        .mat-save {
          background: var(--accent); color: white; padding: 4px 12px; border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
