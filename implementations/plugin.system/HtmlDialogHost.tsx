// @archigraph plugin.system.html-dialog-host
// Renders all currently-open HtmlDialog instances created via UI.htmlDialog().

import React, { useEffect, useRef, useState } from 'react';
import type { DialogStore, HtmlDialogImpl } from './draftdown/HostUIBackend';

export function HtmlDialogHost({ store }: { store: DialogStore }) {
  const [, setRev] = useState(0);
  useEffect(() => store.events.on(() => setRev((r) => r + 1)), [store]);

  const dialogs = store.list().filter((d) => d.visible());
  if (dialogs.length === 0) return null;

  return (
    <>
      {dialogs.map((d, i) => <HtmlDialogFrame key={i} dialog={d} />)}
    </>
  );
}

function HtmlDialogFrame({ dialog }: { dialog: HtmlDialogImpl }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const snap = dialog.snapshot();

  useEffect(() => {
    if (iframeRef.current) {
      dialog.iframe = iframeRef.current;
      if (snap.html) iframeRef.current.srcdoc = wrapHtml(snap.html);
      else if (snap.url) iframeRef.current.src = snap.url;
    }
    return () => { dialog.iframe = null; };
  }, [dialog]);

  return (
    <div
      className="dd-html-dialog"
      style={{
        position: 'fixed', left: snap.pos.x, top: snap.pos.y,
        width: snap.size.w, height: snap.size.h,
        background: 'var(--bg-secondary, #1f1f1f)',
        border: '1px solid var(--border-color, #444)',
        borderRadius: 6, boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        zIndex: 2100, display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
          borderBottom: '1px solid var(--border-color, #444)', cursor: 'move', userSelect: 'none',
          color: 'var(--text-primary, #e0e0e0)', fontSize: 12, fontWeight: 600,
        }}
      >
        <span style={{ flex: 1 }}>{snap.options.dialogTitle ?? 'Plugin Dialog'}</span>
        <button
          onClick={() => dialog.close()}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary, #999)', cursor: 'pointer', fontSize: 14 }}
        >✕</button>
      </div>
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        style={{ flex: 1, border: 'none', background: '#fff' }}
      />
    </div>
  );
}

function wrapHtml(html: string): string {
  const bridge = `
    <script>
      window.draftdown = {
        callAction: function(name) {
          var args = Array.prototype.slice.call(arguments, 1);
          window.parent.postMessage({ __draftdownDialog: true, name: name, args: args }, '*');
        }
      };
    </script>`;
  return `${bridge}${html}`;
}
