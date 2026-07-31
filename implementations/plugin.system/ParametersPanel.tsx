// @archigraph plugin.system.parameters-panel
// Right-rail panel mounted under EntityInfoPanel. Renders all currently-active
// ParametersStore sections as forms. Plugins/tools push schemas via UI.parameters.show(...)
// and subscribe to onChange callbacks.

import React, { useEffect, useState } from 'react';
import { ParametersStore, ParameterField, getParametersStore } from './draftdown/ParametersStore';

export function ParametersPanel() {
  const [store] = useState<ParametersStore>(() => getParametersStore());
  const [, force] = useState(0);

  useEffect(() => store.events.on(() => force(r => r + 1)), [store]);

  const sections = store.list();
  if (sections.length === 0) return null;

  return (
    <div className="dd-params-panel">
      {sections.map(s => (
        <div key={s.id} className="dd-params-section">
          <div className="dd-params-bar">
            <span className="dd-params-title">{s.title}</span>
            {s.onClose && (
              <button
                className="dd-params-close"
                title="Close"
                onClick={() => { try { s.onClose?.(); } catch (e) { console.error(e); } store.hide(s.id); }}
              >✕</button>
            )}
          </div>
          <div className="dd-params-form">
            {s.fields.map((f, i) => (
              <FieldView key={fieldKey(f, i)} field={f} value={fieldValue(s.values, f)} onChange={(v) => {
                if ('key' in f && f.key) store.setFieldInternal(s.id, f.key, v);
              }} />
            ))}
            {s.footer && <div className="dd-params-footer">{s.footer}</div>}
          </div>
        </div>
      ))}
      <style>{`
        .dd-params-panel {
          display: flex; flex-direction: column;
          border-top: 1px solid var(--border-color);
          background: var(--bg-secondary);
        }
        .dd-params-section {
          border-bottom: 1px solid var(--border-color);
          display: flex; flex-direction: column;
        }
        .dd-params-bar {
          display: flex; align-items: center; padding: 6px 10px;
          background: var(--bg-primary);
          border-bottom: 1px solid var(--border-color);
        }
        .dd-params-title {
          flex: 1; font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.04em; color: var(--text-secondary);
        }
        .dd-params-close {
          background: none; border: none; color: var(--text-secondary);
          cursor: pointer; font-size: 12px; padding: 0 4px;
        }
        .dd-params-close:hover { color: var(--text-primary); }
        .dd-params-form { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
        .dd-params-row {
          display: grid; grid-template-columns: 110px 1fr; align-items: center; gap: 6px;
          font-size: 12px; color: var(--text-primary);
        }
        .dd-params-row.boolean, .dd-params-row.button { grid-template-columns: 1fr; }
        .dd-params-row label { color: var(--text-secondary); font-size: 11px; }
        .dd-params-row input[type="text"],
        .dd-params-row input[type="number"],
        .dd-params-row select {
          width: 100%; box-sizing: border-box;
          padding: 3px 6px; font-size: 12px;
          background: var(--bg-primary); color: var(--text-primary);
          border: 1px solid var(--border-color); border-radius: 3px;
          font-family: inherit;
        }
        .dd-params-row input[type="number"]::-webkit-outer-spin-button,
        .dd-params-row input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .dd-params-vec3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
        .dd-params-help { font-size: 10px; color: var(--text-secondary); margin-top: -2px; grid-column: 1 / -1; }
        .dd-params-header { font-size: 11px; font-weight: 600; color: var(--text-primary); margin-top: 6px; }
        .dd-params-sep { height: 1px; background: var(--border-color); margin: 4px 0; }
        .dd-params-footer { font-size: 10px; color: var(--text-secondary); padding-top: 4px; line-height: 1.3; }
        .dd-params-button {
          padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 3px;
          background: var(--bg-primary); color: var(--text-primary);
          border: 1px solid var(--border-color); width: 100%;
        }
        .dd-params-button.primary {
          background: #2a6cf8; color: white; border-color: #2a6cf8;
        }
        .dd-params-button:hover:not(:disabled) { filter: brightness(1.1); }
        .dd-params-slider { display: grid; grid-template-columns: 1fr 50px; gap: 6px; align-items: center; }
        .dd-params-slider input[type="range"] { width: 100%; }
        .dd-params-color { display: flex; gap: 4px; align-items: center; }
        .dd-params-color input[type="color"] { width: 28px; height: 22px; padding: 0; border: 1px solid var(--border-color); }
      `}</style>
    </div>
  );
}

function fieldKey(f: ParameterField, idx: number): string {
  if ('key' in f && f.key) return f.key;
  return `${f.kind}-${idx}`;
}

function fieldValue(values: Record<string, unknown>, f: ParameterField): unknown {
  if ('key' in f && f.key) return values[f.key];
  return undefined;
}

function FieldView({ field, value, onChange }: { field: ParameterField; value: unknown; onChange: (v: unknown) => void }) {
  if (field.kind === 'header') {
    return <div className="dd-params-header">{field.text}</div>;
  }
  if (field.kind === 'separator') {
    return <div className="dd-params-sep" />;
  }
  if (field.kind === 'button') {
    return (
      <div className="dd-params-row button">
        <button
          className={`dd-params-button${field.primary ? ' primary' : ''}`}
          onClick={() => { try { field.onClick(); } catch (e) { console.error(e); } }}
        >{field.label}</button>
      </div>
    );
  }
  if (field.kind === 'boolean') {
    return (
      <div className="dd-params-row boolean">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
        {field.help && <div className="dd-params-help">{field.help}</div>}
      </div>
    );
  }
  if (field.kind === 'number' || field.kind === 'integer') {
    return (
      <div className="dd-params-row">
        <label>{field.label}{field.kind === 'number' && (field as any).unit ? ` (${(field as any).unit})` : ''}</label>
        <NumberInput
          value={value as number | undefined}
          fallback={field.default}
          integer={field.kind === 'integer'}
          step={(field as any).step}
          min={field.min}
          max={field.max}
          onChange={onChange}
        />
        {(field as any).help && <div className="dd-params-help">{(field as any).help}</div>}
      </div>
    );
  }
  if (field.kind === 'slider') {
    const numericFallback = field.default ?? field.min;
    const numericValue = (typeof value === 'number') ? value : numericFallback;
    return (
      <div className="dd-params-row">
        <label>{field.label}{field.unit ? ` (${field.unit})` : ''}</label>
        <div className="dd-params-slider">
          <input type="range" min={field.min} max={field.max} step={field.step ?? 1} value={numericValue}
                 onChange={(e) => onChange(parseFloat(e.target.value))} />
          <NumberInput
            value={value as number | undefined}
            fallback={field.default ?? field.min}
            step={field.step}
            min={field.min}
            max={field.max}
            onChange={onChange}
          />
        </div>
      </div>
    );
  }
  if (field.kind === 'text') {
    return (
      <div className="dd-params-row">
        <label>{field.label}</label>
        <input type="text" value={(value as string) ?? ''} placeholder={field.placeholder ?? ''}
               onChange={(e) => onChange(e.target.value)} />
        {field.help && <div className="dd-params-help">{field.help}</div>}
      </div>
    );
  }
  if (field.kind === 'select') {
    const v = (value !== undefined ? value : field.default ?? field.options[0]?.value) as string | number;
    return (
      <div className="dd-params-row">
        <label>{field.label}</label>
        <select value={String(v)} onChange={(e) => {
          const opt = field.options.find(o => String(o.value) === e.target.value);
          onChange(opt ? opt.value : e.target.value);
        }}>
          {field.options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
        {field.help && <div className="dd-params-help">{field.help}</div>}
      </div>
    );
  }
  if (field.kind === 'color') {
    const v = ((value as string) ?? field.default ?? '#cccccc');
    return (
      <div className="dd-params-row">
        <label>{field.label}</label>
        <div className="dd-params-color">
          <input type="color" value={v} onChange={(e) => onChange(e.target.value)} />
          <input type="text" value={v} onChange={(e) => onChange(e.target.value)} />
        </div>
      </div>
    );
  }
  if (field.kind === 'vec3' || field.kind === 'point3d') {
    const v = (value as { x: number; y: number; z: number }) ?? field.default ?? { x: 0, y: 0, z: 0 };
    return (
      <div className="dd-params-row">
        <label>{field.label}{(field as any).unit ? ` (${(field as any).unit})` : ''}</label>
        <div className="dd-params-vec3">
          {(['x', 'y', 'z'] as const).map((k) => (
            <NumberInput
              key={k}
              value={v[k]}
              fallback={(field.default as any)?.[k] ?? 0}
              onChange={(n) => onChange({ ...v, [k]: typeof n === 'number' ? n : 0 })}
            />
          ))}
        </div>
      </div>
    );
  }
  return null;
}

/**
 * Number input that holds its own *string* state so users can clear it, type
 * partial values like "0." or "-", and select-replace the contents normally.
 * The numeric value is pushed to the store only when the string parses cleanly.
 */
function NumberInput({
  value, fallback, integer, step, min, max, onChange,
}: {
  value: number | undefined;
  fallback: number | undefined;
  integer?: boolean;
  step?: number | string;
  min?: number;
  max?: number;
  onChange: (v: number | undefined) => void;
}) {
  const initial = (typeof value === 'number') ? String(value) : (fallback !== undefined ? String(fallback) : '');
  const [text, setText] = React.useState(initial);
  const lastExternal = React.useRef<number | undefined>(value);

  // If the parent pushes a new value (e.g. UI.parameters.update from a plugin),
  // re-sync the displayed string. We avoid clobbering the user's in-progress
  // typing by only re-syncing when the external value actually changes AND
  // doesn't already match what the user has typed.
  React.useEffect(() => {
    if (value === lastExternal.current) return;
    lastExternal.current = value;
    if (value === undefined) return;
    const parsed = parseFloat(text);
    if (Number.isFinite(parsed) && parsed === value) return; // already in sync
    setText(String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      step={step ?? (integer ? 1 : 'any') as any}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        // Allow the field to be empty / partial without snapping back.
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
          onChange(undefined);
          return;
        }
        const n = integer ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isFinite(n)) {
          let clamped = n;
          if (typeof min === 'number' && clamped < min) clamped = min;
          if (typeof max === 'number' && clamped > max) clamped = max;
          lastExternal.current = clamped;
          onChange(clamped);
        }
      }}
      onBlur={(e) => {
        // On blur: if the field is empty / unparseable, fall back to the default
        // (or the last known good value) so the form remains usable.
        const raw = e.target.value;
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.' || !Number.isFinite(parseFloat(raw))) {
          if (typeof fallback === 'number') {
            setText(String(fallback));
            lastExternal.current = fallback;
            onChange(fallback);
          }
        } else {
          // Normalize displayed text to the parsed number (e.g. "01.50" → "1.5").
          const n = integer ? parseInt(raw, 10) : parseFloat(raw);
          if (Number.isFinite(n)) {
            setText(String(n));
            lastExternal.current = n;
            onChange(n);
          }
        }
      }}
    />
  );
}
