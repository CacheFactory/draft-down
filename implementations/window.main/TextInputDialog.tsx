// Floating text input dialog for the Text tool.
// Appears on canvas click with text, font, size, and color controls.

import React, { useState, useRef, useEffect } from 'react';

export interface TextInputResult {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
}

interface Props {
  x: number;
  y: number;
  onSubmit: (result: TextInputResult) => void;
  onCancel: () => void;
}

const FONTS = [
  'Helvetica',
  'Helvetica Bold',
  'Gentilis',
  'Gentilis Bold',
  'Optimer',
  'Optimer Bold',
];

const COLORS = [
  '#333333', '#000000', '#ffffff',
  '#e53935', '#d81b60', '#8e24aa',
  '#1e88e5', '#00acc1', '#43a047',
  '#f9a825', '#ff6f00', '#6d4c41',
];

export function TextInputDialog({ x, y, onSubmit, onCancel }: Props) {
  const [text, setText] = useState('');
  const [fontFamily, setFontFamily] = useState('Helvetica');
  const [fontSize, setFontSize] = useState(48);
  const [color, setColor] = useState('#333333');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-focus the text input
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    // Delay listener to avoid immediate dismiss from the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onCancel]);

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit({ text: text.trim(), fontFamily, fontSize, color });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // Prevent tool shortcuts
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  // Keep dialog within viewport bounds
  const left = Math.min(x, window.innerWidth - 280);
  const top = Math.min(y, window.innerHeight - 320);

  return (
    <div
      ref={dialogRef}
      className="text-input-dialog"
      style={{ left, top }}
      onKeyDown={handleKeyDown}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="tid-header">Add Text Label</div>

      <input
        ref={inputRef}
        className="tid-text-input"
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Type your text..."
      />

      <div className="tid-row">
        <label className="tid-label">Font</label>
        <select
          className="tid-select"
          value={fontFamily}
          onChange={e => setFontFamily(e.target.value)}
        >
          {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
      </div>

      <div className="tid-row">
        <label className="tid-label">Size</label>
        <input
          className="tid-size-input"
          type="number"
          min={12}
          max={200}
          value={fontSize}
          onChange={e => setFontSize(parseInt(e.target.value) || 48)}
        />
      </div>

      <div className="tid-row">
        <label className="tid-label">Color</label>
        <div className="tid-color-grid">
          {COLORS.map(c => (
            <button
              key={c}
              className={`tid-color-swatch ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>
      </div>

      <div className="tid-preview" style={{ fontFamily, fontSize: Math.min(fontSize, 32), color }}>
        {text || 'Preview'}
      </div>

      <div className="tid-buttons">
        <button className="tid-btn tid-btn-cancel" onClick={onCancel}>Cancel</button>
        <button className="tid-btn tid-btn-ok" onClick={handleSubmit} disabled={!text.trim()}>Place</button>
      </div>

      <style>{`
        .text-input-dialog {
          position: fixed;
          z-index: 1001;
          width: 260px;
          background: var(--bg-secondary, #2d2d2d);
          border: 1px solid var(--border-color, #555);
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          padding: 12px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 12px;
          color: var(--text-primary, #eee);
        }
        .tid-header {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .tid-text-input {
          width: 100%;
          padding: 8px;
          font-size: 14px;
          border: 1px solid var(--border-color, #555);
          border-radius: 4px;
          background: var(--bg-primary, #1e1e1e);
          color: var(--text-primary, #eee);
          outline: none;
          margin-bottom: 10px;
          box-sizing: border-box;
        }
        .tid-text-input:focus {
          border-color: #0078d4;
        }
        .tid-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .tid-label {
          width: 36px;
          flex-shrink: 0;
          font-size: 11px;
          color: var(--text-secondary, #aaa);
        }
        .tid-select {
          flex: 1;
          padding: 4px 6px;
          border: 1px solid var(--border-color, #555);
          border-radius: 3px;
          background: var(--bg-primary, #1e1e1e);
          color: var(--text-primary, #eee);
          font-size: 12px;
          outline: none;
        }
        .tid-size-input {
          width: 60px;
          padding: 4px 6px;
          border: 1px solid var(--border-color, #555);
          border-radius: 3px;
          background: var(--bg-primary, #1e1e1e);
          color: var(--text-primary, #eee);
          font-size: 12px;
          outline: none;
        }
        .tid-color-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .tid-color-swatch {
          width: 20px;
          height: 20px;
          border: 2px solid transparent;
          border-radius: 3px;
          cursor: pointer;
          padding: 0;
        }
        .tid-color-swatch.active {
          border-color: #0078d4;
          box-shadow: 0 0 0 1px #0078d4;
        }
        .tid-color-swatch:hover {
          border-color: #fff;
        }
        .tid-preview {
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-primary, #1e1e1e);
          border-radius: 4px;
          margin: 8px 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .tid-buttons {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .tid-btn {
          padding: 6px 16px;
          border: 1px solid var(--border-color, #555);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          background: var(--bg-primary, #1e1e1e);
          color: var(--text-primary, #eee);
        }
        .tid-btn:hover { background: var(--bg-hover, #3a3a3a); }
        .tid-btn-ok {
          background: #0078d4;
          border-color: #0078d4;
          color: white;
        }
        .tid-btn-ok:hover { background: #106ebe; }
        .tid-btn-ok:disabled { opacity: 0.5; cursor: default; }
      `}</style>
    </div>
  );
}
