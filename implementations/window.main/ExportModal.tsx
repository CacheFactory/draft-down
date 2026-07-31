// @archigraph window.main
import React from 'react';

export interface ExportFormat {
  id: string;
  name: string;
  ext: string;
  description: string;
}

export const EXPORT_FORMATS: ExportFormat[] = [
  { id: 'obj', name: 'OBJ', ext: '.obj', description: 'Wavefront OBJ with materials and textures' },
  { id: 'gltf', name: 'glTF', ext: '.gltf', description: 'GL Transmission Format (JSON + binary)' },
  { id: 'glb', name: 'GLB', ext: '.glb', description: 'glTF Binary (single file)' },
  { id: 'stl', name: 'STL', ext: '.stl', description: 'Stereolithography (3D printing)' },
  { id: 'ply', name: 'PLY', ext: '.ply', description: 'Polygon File Format (vertex colors)' },
  { id: 'dxf', name: 'DXF', ext: '.dxf', description: 'AutoCAD Drawing Exchange Format (3D faces)' },
  { id: 'dwg', name: 'DWG', ext: '.dwg', description: 'AutoCAD Drawing (edges + faces via DXF conversion)' },
  { id: 'usdz', name: 'USDZ', ext: '.usdz', description: 'Apple AR Quick Look (iPhone, iPad, Vision Pro)' },
  { id: 'dae', name: 'COLLADA', ext: '.dae', description: 'Digital Asset Exchange (Blender, game engines)' },
];

interface ExportModalProps {
  visible: boolean;
  onClose: () => void;
  onExport: (formatId: string) => void;
}

export function ExportModal({ visible, onClose, onExport }: ExportModalProps) {
  if (!visible) return null;

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-modal" onClick={e => e.stopPropagation()}>
        <div className="export-header">
          <h2>Export Model</h2>
          <button className="export-close" onClick={onClose}>&times;</button>
        </div>
        <div className="export-options">
          {EXPORT_FORMATS.map(fmt => (
            <button
              key={fmt.id}
              className="export-option"
              onClick={() => { onExport(fmt.id); onClose(); }}
            >
              <div className="export-option-ext">{fmt.ext}</div>
              <div className="export-option-text">
                <div className="export-option-name">{fmt.name}</div>
                <div className="export-option-desc">{fmt.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <style>{`
        .export-overlay {
          position: fixed; inset: 0; z-index: 9000;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(4px);
        }
        .export-modal {
          background: var(--bg-secondary, #2a2a2a);
          border-radius: 12px;
          min-width: 380px; max-width: 440px;
          box-shadow: 0 12px 48px rgba(0,0,0,0.5);
          overflow: hidden;
        }
        .export-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px 12px;
          border-bottom: 1px solid var(--border-color, #444);
        }
        .export-header h2 {
          font-size: 16px; font-weight: 600;
          color: var(--text-primary, #eee); margin: 0;
        }
        .export-close {
          background: none; border: none; color: var(--text-muted, #888);
          font-size: 20px; cursor: pointer; padding: 0 4px;
          line-height: 1;
        }
        .export-close:hover { color: var(--text-primary, #eee); }
        .export-options {
          display: flex; flex-direction: column;
          padding: 8px;
          gap: 4px;
        }
        .export-option {
          display: flex; align-items: center; gap: 14px;
          padding: 12px 14px; border-radius: 8px;
          border: 1px solid transparent;
          background: var(--bg-tertiary, #333);
          cursor: pointer; text-align: left;
          color: inherit; font-family: inherit;
          transition: background 0.15s, border-color 0.15s;
        }
        .export-option:hover {
          background: var(--bg-hover, #3a3a3a);
          border-color: var(--accent, #4488ff);
        }
        .export-option-ext {
          width: 44px; height: 44px;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700;
          background: var(--bg-primary, #1e1e1e);
          border-radius: 8px;
          color: var(--accent, #4488ff);
          flex-shrink: 0;
          font-family: monospace;
        }
        .export-option-name {
          font-size: 14px; font-weight: 500;
          color: var(--text-primary, #eee);
        }
        .export-option-desc {
          font-size: 11px; color: var(--text-muted, #888);
          margin-top: 2px;
        }
      `}</style>
    </div>
  );
}
