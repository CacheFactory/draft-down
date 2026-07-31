// @archigraph window.preferences
import React, { useState, useEffect, useCallback } from 'react';
import { UserPreferences, DEFAULT_PREFERENCES } from '../../src/core/ipc-types';
import { parseDistanceExpr, toDisplay, unitLabel, getCurrentUnit } from '../../src/core/units';

interface PreferencesWindowProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the full saved prefs so the app can apply them live. */
  onSaved?: (prefs: UserPreferences) => void;
}

type TabId = 'units' | 'rendering' | 'shortcuts' | 'workflow' | 'ai' | 'plugins';

/** Precisely format meters for editing in the current unit — deliberately
 *  NOT formatDistance (which rounds to 1 decimal and would corrupt values
 *  like 0.25m into "0.3m" on the save round-trip). */
function formatLengthPrecise(meters: number): string {
  const unit = getCurrentUnit();
  return `${Number(toDisplay(meters, unit).toFixed(6))}${unitLabel(unit)}`;
}

/** Text input for a length preference: accepts unit expressions (6", 0.5m,
 *  1', 10cm); invalid or non-positive input keeps the last valid value and
 *  shows a red border. Minimum 0.01m. */
function LengthInput({ valueMeters, onValid }: { valueMeters: number; onValid: (m: number) => void }) {
  const [text, setText] = useState(() => formatLengthPrecise(valueMeters));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(formatLengthPrecise(valueMeters));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueMeters]);
  return (
    <input
      type="text"
      className={invalid ? 'invalid' : ''}
      value={text}
      placeholder={'0.25m, 6", 1\''}
      onChange={e => {
        const t = e.target.value;
        setText(t);
        const m = parseDistanceExpr(t);
        if (isFinite(m) && m >= 0.01) {
          setInvalid(false);
          onValid(m);
        } else {
          setInvalid(true);
        }
      }}
    />
  );
}

export function PreferencesWindow({ visible, onClose, onSaved }: PreferencesWindowProps) {
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [activeTab, setActiveTab] = useState<TabId>('units');
  const [modified, setModified] = useState(false);

  useEffect(() => {
    if (visible && typeof window.api !== 'undefined') {
      window.api.invoke('prefs:get').then(p => setPrefs(p));
    }
  }, [visible]);

  const updatePref = useCallback(<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setModified(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (typeof window.api !== 'undefined') {
      await window.api.invoke('prefs:set', prefs);
    }
    onSaved?.(prefs);
    setModified(false);
    onClose();
  }, [prefs, onClose, onSaved]);

  if (!visible) return null;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'units', label: 'Units' },
    { id: 'rendering', label: 'Rendering' },
    { id: 'workflow', label: 'Workflow' },
    { id: 'shortcuts', label: 'Shortcuts' },
    { id: 'ai', label: 'AI' },
    { id: 'plugins', label: 'Plugins' },
  ];

  return (
    <div className="modal-overlay">
      <div className="prefs-window">
        <div className="prefs-header">
          <h3>Preferences</h3>
          <button className="prefs-close" onClick={onClose}>×</button>
        </div>
        <div className="prefs-body">
          <div className="prefs-tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`prefs-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="prefs-content">
            {activeTab === 'units' && (
              <div className="prefs-section">
                <label className="pref-row">
                  <span>Unit System</span>
                  <select value={prefs.unitSystem} onChange={e => {
                    const sys = e.target.value as 'metric' | 'imperial';
                    updatePref('unitSystem', sys);
                    // Auto-switch default unit when system changes
                    if (sys === 'metric' && (prefs.units === 'inches' || prefs.units === 'feet')) {
                      updatePref('units', 'm');
                    } else if (sys === 'imperial' && (prefs.units === 'mm' || prefs.units === 'cm' || prefs.units === 'm')) {
                      updatePref('units', 'feet');
                    }
                  }}>
                    <option value="metric">Metric</option>
                    <option value="imperial">Imperial</option>
                  </select>
                </label>
                <label className="pref-row">
                  <span>Default Units</span>
                  <select value={prefs.units} onChange={e => updatePref('units', e.target.value as UserPreferences['units'])}>
                    {prefs.unitSystem === 'metric' ? (
                      <>
                        <option value="mm">Millimeters</option>
                        <option value="cm">Centimeters</option>
                        <option value="m">Meters</option>
                      </>
                    ) : (
                      <>
                        <option value="inches">Inches</option>
                        <option value="feet">Feet</option>
                      </>
                    )}
                  </select>
                </label>
                <div className="pref-section-title">Snapping</div>
                <label className="pref-row">
                  <span>Grid spacing (visible grid)</span>
                  <LengthInput valueMeters={prefs.gridSpacing}
                    onValid={m => updatePref('gridSpacing', m)} />
                </label>
                <label className="pref-row">
                  <span>Snap to grid</span>
                  <input type="checkbox" checked={prefs.gridSnapEnabled}
                    onChange={e => updatePref('gridSnapEnabled', e.target.checked)} />
                </label>
                <label className="pref-row">
                  <span>Grid snap increment</span>
                  <LengthInput valueMeters={prefs.gridSnapSpacing}
                    onValid={m => updatePref('gridSnapSpacing', m)} />
                </label>
                <label className="pref-row">
                  <span>Object snapping (endpoints, edges…)</span>
                  <input type="checkbox" checked={prefs.snapEnabled}
                    onChange={e => updatePref('snapEnabled', e.target.checked)} />
                </label>
              </div>
            )}
            {activeTab === 'rendering' && (
              <div className="prefs-section">
                <label className="pref-row">
                  <span>Render Quality</span>
                  <select value={prefs.renderQuality} onChange={e => updatePref('renderQuality', e.target.value as UserPreferences['renderQuality'])}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="pref-row">
                  <span>Theme</span>
                  <select value={prefs.theme} onChange={e => updatePref('theme', e.target.value as 'light' | 'dark')}>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>
              </div>
            )}
            {activeTab === 'workflow' && (
              <div className="prefs-section">
                <label className="pref-row">
                  <span>Auto-Save Interval (min)</span>
                  <input type="number" value={prefs.autoSaveInterval / 60000} min={1} max={60}
                    onChange={e => updatePref('autoSaveInterval', (parseInt(e.target.value) || 5) * 60000)} />
                </label>
              </div>
            )}
            {activeTab === 'shortcuts' && (
              <div className="prefs-section">
                {Object.entries(prefs.shortcuts).map(([action, key]) => (
                  <div key={action} className="pref-row">
                    <span>{action}</span>
                    <input type="text" value={key} readOnly style={{ width: 80, textAlign: 'center' }} />
                  </div>
                ))}
              </div>
            )}
            {activeTab === 'ai' && (
              <div className="prefs-section">
                <label className="pref-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                  <span>Anthropic API Key</span>
                  <input
                    type="password"
                    value={prefs.anthropicApiKey}
                    onChange={e => updatePref('anthropicApiKey', e.target.value)}
                    placeholder="sk-ant-..."
                    style={{ width: '100%', height: 28, fontFamily: 'monospace', fontSize: 12 }}
                  />
                </label>
                <p style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5, margin: 0 }}>
                  Required for the AI chat assistant. Get your key from{' '}
                  <span style={{ color: 'var(--accent)' }}>console.anthropic.com</span>.
                  The key is stored locally in your preferences file and never sent anywhere except the Anthropic API.
                </p>
              </div>
            )}
            {activeTab === 'plugins' && (
              <div className="prefs-section">
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No plugins installed</p>
              </div>
            )}
          </div>
        </div>
        <div className="prefs-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="prefs-save" onClick={handleSave} disabled={!modified}>Save</button>
        </div>
      </div>

      <style>{`
        .modal-overlay {
          position: fixed; inset: 0; z-index: 2000;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
        }
        .prefs-window {
          width: 600px; height: 500px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          display: flex; flex-direction: column;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .prefs-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 16px; border-bottom: 1px solid var(--border-color);
        }
        .prefs-header h3 { font-size: 14px; font-weight: 600; }
        .prefs-close { font-size: 18px; width: 24px; height: 24px; padding: 0; }
        .prefs-body { flex: 1; display: flex; overflow: hidden; }
        .prefs-tabs {
          width: 130px; border-right: 1px solid var(--border-color);
          display: flex; flex-direction: column; padding: 8px 0;
        }
        .prefs-tab {
          text-align: left; padding: 8px 16px; border-radius: 0;
          font-size: var(--font-size); color: var(--text-secondary);
        }
        .prefs-tab.active {
          background: var(--bg-active); color: #fff;
        }
        .prefs-content { flex: 1; padding: 16px; overflow-y: auto; }
        .prefs-section { display: flex; flex-direction: column; gap: 12px; }
        .pref-section-title {
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--text-muted, #888);
          margin: 14px 0 4px;
        }
        .pref-row input.invalid {
          border-color: #ff5555; outline-color: #ff5555;
        }
        .pref-row {
          display: flex; align-items: center; justify-content: space-between;
          font-size: var(--font-size);
        }
        .pref-row select, .pref-row input[type="number"] {
          width: 140px; height: 26px;
        }
        .prefs-footer {
          display: flex; justify-content: flex-end; gap: 8px;
          padding: 12px 16px; border-top: 1px solid var(--border-color);
        }
        .prefs-save {
          background: var(--accent); color: white;
          padding: 6px 16px; border-radius: 4px;
        }
        .prefs-save:hover:not(:disabled) { background: var(--accent-hover); }
      `}</style>
    </div>
  );
}
