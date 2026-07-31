// @archigraph plugin.system.ruby-console
// DraftDown's Ruby Console — the REPL inside the app. Plugins use it to test snippets
// without restarting. We expose it as a draggable panel that evaluates JavaScript
// against the installed `DraftDown`/`Geom`/`UI` globals.
//
// Reference: #html_dialog (in real DraftDown the
// console is a separate window; we render it inline for simplicity).

import React, { useEffect, useRef, useState } from 'react';

interface Entry {
  kind: 'in' | 'out' | 'err' | 'log';
  text: string;
}

interface Props {
  visible: boolean;
  onClose(): void;
}

export function RubyConsolePanel({ visible, onClose }: Props) {
  const [history, setHistory] = useState<Entry[]>(() => [
    { kind: 'log', text: 'DraftDown Console — uses the DraftDown Ruby API JS façade.' },
    { kind: 'log', text: 'Try: DraftDown.activeModel.entities.addFace(new Geom.Point3d(0,0,0), new Geom.Point3d(1,0,0), new Geom.Point3d(1,0,1)).pushpull(1)' },
  ]);
  const [input, setInput] = useState('');
  const [recall, setRecall] = useState<string[]>([]);
  const [recallIdx, setRecallIdx] = useState(-1);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [history]);

  if (!visible) return null;

  const run = () => {
    const src = input.trim();
    if (!src) return;
    setHistory((h) => [...h, { kind: 'in', text: src }]);
    setRecall((r) => [...r, src]); setRecallIdx(-1);
    setInput('');
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('DraftDown', 'UI', 'Geom', 'Length', `"use strict"; return (${src});`);
      const w = window as any;
      const result = fn(w.DraftDown, w.UI, w.Geom, w.Length);
      const text = formatResult(result);
      setHistory((h) => [...h, { kind: 'out', text }]);
    } catch (e: any) {
      // Retry as a statement (e.g. var declarations) if the expression form failed.
      try {
        // eslint-disable-next-line no-new-func
        const fn2 = new Function('DraftDown', 'UI', 'Geom', 'Length', `"use strict"; ${src}`);
        const w = window as any;
        fn2(w.DraftDown, w.UI, w.Geom, w.Length);
        setHistory((h) => [...h, { kind: 'out', text: '⏎' }]);
      } catch (e2: any) {
        setHistory((h) => [...h, { kind: 'err', text: e2?.message ?? String(e) }]);
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); return; }
    if (e.key === 'ArrowUp' && recall.length > 0) {
      e.preventDefault();
      const next = recallIdx < 0 ? recall.length - 1 : Math.max(0, recallIdx - 1);
      setRecallIdx(next); setInput(recall[next]);
    }
    if (e.key === 'ArrowDown' && recallIdx >= 0) {
      e.preventDefault();
      const next = recallIdx + 1;
      if (next >= recall.length) { setRecallIdx(-1); setInput(''); }
      else { setRecallIdx(next); setInput(recall[next]); }
    }
  };

  return (
    <div className="ruby-console">
      <div className="ruby-console-bar">
        <span className="ruby-console-title">Console</span>
        <button className="ruby-console-clear" onClick={() => setHistory([])}>Clear</button>
        <button className="ruby-console-close" onClick={onClose}>✕</button>
      </div>
      <div ref={scroll} className="ruby-console-log">
        {history.map((e, i) => (
          <div key={i} className={`ruby-console-line ${e.kind}`}>
            {e.kind === 'in' && <span className="prompt">&gt;&gt; </span>}
            {e.kind === 'out' && <span className="prompt">=&gt; </span>}
            {e.kind === 'err' && <span className="prompt">! </span>}
            <span>{e.text}</span>
          </div>
        ))}
      </div>
      <div className="ruby-console-input">
        <span className="prompt">&gt;&gt;</span>
        <input
          value={input}
          autoFocus
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='DraftDown.activeModel.entities.addLine(new Geom.Point3d(0,0,0), new Geom.Point3d(1,0,0))'
          spellCheck={false}
        />
      </div>
      <style>{`
        .ruby-console {
          position: fixed; right: 16px; bottom: 60px; width: 560px; height: 320px;
          background: var(--bg-secondary, #1f1f1f); border: 1px solid var(--border-color, #444);
          border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          display: flex; flex-direction: column; z-index: 2000;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
          color: var(--text-primary, #e0e0e0);
        }
        .ruby-console-bar {
          display: flex; align-items: center; gap: 8px; padding: 6px 10px;
          border-bottom: 1px solid var(--border-color, #444);
          background: var(--bg-primary, #111);
        }
        .ruby-console-title { flex: 1; font-weight: 600; }
        .ruby-console-clear, .ruby-console-close {
          background: transparent; border: 1px solid var(--border-color, #444);
          color: var(--text-secondary, #999); padding: 2px 8px; border-radius: 3px;
          cursor: pointer; font-size: 11px;
        }
        .ruby-console-close { border: none; }
        .ruby-console-log {
          flex: 1; overflow: auto; padding: 8px 10px;
        }
        .ruby-console-line { padding: 1px 0; white-space: pre-wrap; word-break: break-word; }
        .ruby-console-line .prompt { color: #888; user-select: none; }
        .ruby-console-line.in { color: #fff; }
        .ruby-console-line.out { color: #6cf; }
        .ruby-console-line.err { color: #f66; }
        .ruby-console-line.log { color: #aaa; font-style: italic; }
        .ruby-console-input {
          display: flex; align-items: center; gap: 6px; padding: 6px 10px;
          border-top: 1px solid var(--border-color, #444);
        }
        .ruby-console-input .prompt { color: #888; }
        .ruby-console-input input {
          flex: 1; background: transparent; color: inherit;
          border: none; outline: none; font: inherit;
        }
      `}</style>
    </div>
  );
}

function formatResult(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'function') return `[Function ${v.name || ''}]`;
  if (v && (v as any).toString && (v as any).toString !== Object.prototype.toString) {
    try { return String(v); } catch (e) { console.warn('[RubyConsole.formatResult] toString threw:', e); }
  }
  try { return JSON.stringify(v, null, 2); } catch (e) {
    console.warn('[RubyConsole.formatResult] JSON.stringify threw, falling back to String():', e);
    return String(v);
  }
}
