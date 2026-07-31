// @archigraph window.main
import React, { useState } from 'react';
import { MODEL_TEMPLATES, type ModelTemplate } from '../../src/core/units';

interface WelcomeModalProps {
  visible: boolean;
  onNewProject: (template?: ModelTemplate) => void;
  onOpenFile: () => void;
  onLoadExample: () => void;
}

export function WelcomeModal({ visible, onNewProject, onOpenFile, onLoadExample }: WelcomeModalProps) {
  const [showTemplates, setShowTemplates] = useState(false);
  if (!visible) return null;

  if (showTemplates) {
    return (
      <div className="welcome-overlay">
        <div className="welcome-modal">
          <div className="welcome-header">
            <h1>Choose a Template</h1>
            <p>Sets units and display format — change anytime in Preferences</p>
          </div>
          <div className="welcome-options">
            {MODEL_TEMPLATES.map(t => (
              <button key={t.id} className="welcome-option" onClick={() => onNewProject(t)}>
                <div className="welcome-option-icon">{t.id === 'architectural' ? '⌂' : t.id === 'woodworking' ? '🪚' : t.id === 'product' ? '📐' : '□'}</div>
                <div className="welcome-option-text">
                  <div className="welcome-option-title">{t.name}</div>
                  <div className="welcome-option-desc">{t.desc}</div>
                </div>
              </button>
            ))}
            <button className="welcome-option" onClick={() => setShowTemplates(false)}>
              <div className="welcome-option-icon">←</div>
              <div className="welcome-option-text">
                <div className="welcome-option-title">Back</div>
              </div>
            </button>
          </div>
        </div>
        <style>{WELCOME_STYLES}</style>
      </div>
    );
  }

  return (
    <div className="welcome-overlay">
      <div className="welcome-modal">
        <div className="welcome-header">
          <h1>DraftDown</h1>
          <p>3D modeling for everyone</p>
        </div>
        <div className="welcome-options">
          <button className="welcome-option" onClick={() => setShowTemplates(true)}>
            <div className="welcome-option-icon">+</div>
            <div className="welcome-option-text">
              <div className="welcome-option-title">New Project</div>
              <div className="welcome-option-desc">Choose a template (units &amp; format)</div>
            </div>
          </button>
          <button className="welcome-option" onClick={onOpenFile}>
            <div className="welcome-option-icon">&uarr;</div>
            <div className="welcome-option-text">
              <div className="welcome-option-title">Open File</div>
              <div className="welcome-option-desc">DD, DWG, SKP, OBJ, STL, glTF, FBX, COLLADA, PLY, 3MF, DXF</div>
            </div>
          </button>
          <button className="welcome-option" onClick={onLoadExample}>
            <div className="welcome-option-icon">&#9962;</div>
            <div className="welcome-option-text">
              <div className="welcome-option-title">Example: Church</div>
              <div className="welcome-option-desc">Load a sample DraftDown model</div>
            </div>
          </button>
        </div>
      </div>
      <style>{WELCOME_STYLES}</style>
    </div>
  );
}

const WELCOME_STYLES = `
        .welcome-overlay {
          position: fixed; inset: 0; z-index: 9000;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(4px);
        }
        .welcome-modal {
          background: var(--bg-secondary, #2a2a2a);
          border-radius: 12px;
          padding: 32px 36px;
          min-width: 380px;
          max-width: 440px;
          box-shadow: 0 12px 48px rgba(0,0,0,0.5);
        }
        .welcome-header {
          text-align: center;
          margin-bottom: 24px;
        }
        .welcome-header h1 {
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary, #eee);
          margin: 0 0 4px 0;
        }
        .welcome-header p {
          font-size: 13px;
          color: var(--text-muted, #888);
          margin: 0;
        }
        .welcome-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .welcome-option {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 16px;
          background: var(--bg-tertiary, #333);
          border: 1px solid var(--border-color, #444);
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          text-align: left;
          color: inherit;
          font-family: inherit;
        }
        .welcome-option:hover {
          background: var(--bg-hover, #3a3a3a);
          border-color: var(--accent, #4488ff);
        }
        .welcome-option-icon {
          width: 40px; height: 40px;
          display: flex; align-items: center; justify-content: center;
          font-size: 20px;
          background: var(--bg-primary, #1e1e1e);
          border-radius: 8px;
          color: var(--accent, #4488ff);
          flex-shrink: 0;
        }
        .welcome-option-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary, #eee);
        }
        .welcome-option-desc {
          font-size: 12px;
          color: var(--text-muted, #888);
          margin-top: 2px;
        }
`;
