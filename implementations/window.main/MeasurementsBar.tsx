// @archigraph panel.measurements
import React, { useRef, useCallback, useEffect } from 'react';
import { useApp } from './AppContext';
import { unitLabel } from '../../src/core/units';

export function MeasurementsBar() {
  const { vcbLabel, vcbValue, statusText, units, activeToolId, handleVCBInput, dirty, documentName } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const value = inputRef.current?.value ?? '';
      if (value.trim()) {
        handleVCBInput(value);
      }
      if (inputRef.current) {
        inputRef.current.value = '';
        inputRef.current.blur(); // Return focus to viewport
      }
    }
    if (e.key === 'Escape') {
      if (inputRef.current) {
        inputRef.current.value = '';
        inputRef.current.blur();
      }
    }
  }, [handleVCBInput]);

  // Focus VCB when typing numbers globally
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (/^[0-9.,\-]$/.test(e.key) && inputRef.current) {
        e.preventDefault(); // Prevent the browser from also inserting the character
        inputRef.current.focus();
        inputRef.current.value = e.key === '.' ? '0.' : e.key;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="measurements-bar">
      <div className="status-section">
        <span className="status-text">{statusText}</span>
      </div>

      <div className="vcb-section">
        <span className="vcb-label">{vcbLabel}:</span>
        <input
          ref={inputRef}
          className="vcb-input"
          type="text"
          placeholder={vcbValue || `0${unitLabel(units)}`}
          onKeyDown={onKeyDown}
          tabIndex={-1}
        />
      </div>

      <div className="info-section">
        <span className="axis-indicator">
          <span style={{ color: 'var(--axis-x)' }}>X</span>
          <span style={{ color: 'var(--axis-y)' }}>Y</span>
          <span style={{ color: 'var(--axis-z)' }}>Z</span>
        </span>
        <span className="doc-name">{documentName}{dirty ? ' *' : ''}</span>
      </div>

      <style>{`
        .measurements-bar {
          display: flex;
          align-items: center;
          height: var(--statusbar-height);
          padding: 0 8px;
          background: var(--bg-secondary);
          border-top: 1px solid var(--border-color);
          gap: 16px;
          font-size: var(--font-size-small);
          flex-shrink: 0;
        }
        .status-section {
          flex: 1;
          overflow: hidden;
        }
        .status-text {
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vcb-section {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .vcb-label {
          color: var(--text-secondary);
          white-space: nowrap;
        }
        .vcb-input {
          width: 180px;
          height: 20px;
          font-family: monospace;
          font-size: var(--font-size-small);
          text-align: right;
          padding: 0 4px;
        }
        .vcb-units {
          color: var(--text-muted);
          font-size: 10px;
        }
        .info-section {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .axis-indicator {
          display: flex;
          gap: 4px;
          font-weight: bold;
          font-family: monospace;
        }
        .doc-name {
          color: var(--text-muted);
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
