// @archigraph window.main
// Report a Bug modal — collects a description + diagnostics (screenshot,
// model, stats, recent console errors) and POSTs to the bug-report endpoint.
// Opened from Help ▸ Report a Bug on both Electron and web.
import React, { useEffect, useState } from 'react';
import { collectBugReport, sendBugReport } from '../../src/core/bug-report';

interface BugReportModalProps {
  visible: boolean;
  onClose: () => void;
  app: any;
}

type Status = 'idle' | 'sending' | 'success' | 'error';

export function BugReportModal({ visible, onClose, app }: BugReportModalProps) {
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeModel, setIncludeModel] = useState(true);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [successNote, setSuccessNote] = useState('');

  // Fresh form each time the modal opens (keep contents on error for retry)
  useEffect(() => {
    if (visible) {
      setDescription('');
      setEmail('');
      setIncludeScreenshot(true);
      setIncludeModel(true);
      setStatus('idle');
      setErrorMsg('');
      setSuccessNote('');
    }
  }, [visible]);

  if (!visible) return null;

  const submit = async () => {
    if (!description.trim() || status === 'sending') return;
    setStatus('sending');
    setErrorMsg('');
    const payload = await collectBugReport(app, description.trim(), email.trim() || undefined, {
      includeScreenshot,
      includeModel,
    });
    const result = await sendBugReport(payload);
    if (result.ok) {
      setSuccessNote(payload.modelSkipped
        ? 'Report sent — model was too large to attach.'
        : 'Thanks — report sent!');
      setStatus('success');
      setTimeout(onClose, 1500);
    } else {
      setErrorMsg(result.error || 'Something went wrong.');
      setStatus('error');
    }
  };

  return (
    <div className="bugreport-overlay" onClick={status === 'sending' ? undefined : onClose}>
      <div className="bugreport-modal" onClick={e => e.stopPropagation()}>
        <div className="bugreport-header">
          <h2>Report a Bug</h2>
          <button className="bugreport-close" onClick={onClose}>&times;</button>
        </div>

        {status === 'success' ? (
          <div className="bugreport-success">✓ {successNote}</div>
        ) : (
          <div className="bugreport-body">
            <label className="bugreport-label" htmlFor="bugreport-desc">
              What happened? What did you expect?
            </label>
            <textarea
              id="bugreport-desc"
              className="bugreport-textarea"
              rows={5}
              placeholder="Steps to reproduce, what you saw, what you expected…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              autoFocus
            />
            <label className="bugreport-label" htmlFor="bugreport-email">
              Your email (optional, for follow-up)
            </label>
            <input
              id="bugreport-email"
              className="bugreport-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <label className="bugreport-check">
              <input
                type="checkbox"
                checked={includeScreenshot}
                onChange={e => setIncludeScreenshot(e.target.checked)}
              />
              Include a screenshot of the viewport
            </label>
            <label className="bugreport-check">
              <input
                type="checkbox"
                checked={includeModel}
                onChange={e => setIncludeModel(e.target.checked)}
              />
              Include the current model (helps reproduce geometry bugs)
            </label>

            {status === 'error' && (
              <div className="bugreport-error">Could not send report: {errorMsg}</div>
            )}

            <div className="bugreport-actions">
              <button className="bugreport-cancel" onClick={onClose} disabled={status === 'sending'}>
                Cancel
              </button>
              <button
                className="bugreport-submit"
                onClick={submit}
                disabled={!description.trim() || status === 'sending'}
              >
                {status === 'sending' ? 'Sending…' : 'Send Report'}
              </button>
            </div>
          </div>
        )}
      </div>
      <style>{`
        .bugreport-overlay {
          position: fixed; inset: 0; z-index: 9000;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(4px);
        }
        .bugreport-modal {
          background: var(--bg-secondary, #2a2a2a);
          border-radius: 12px;
          width: 440px; max-width: 92vw;
          box-shadow: 0 12px 48px rgba(0,0,0,0.5);
          overflow: hidden;
        }
        .bugreport-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px 12px;
          border-bottom: 1px solid var(--border-color, #444);
        }
        .bugreport-header h2 {
          font-size: 16px; font-weight: 600;
          color: var(--text-primary, #eee); margin: 0;
        }
        .bugreport-close {
          background: none; border: none; color: var(--text-muted, #888);
          font-size: 20px; cursor: pointer; padding: 0 4px; line-height: 1;
        }
        .bugreport-close:hover { color: var(--text-primary, #eee); }
        .bugreport-body { padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 8px; }
        .bugreport-label { font-size: 12px; color: var(--text-muted, #999); }
        .bugreport-textarea, .bugreport-input {
          background: var(--bg-primary, #1e1e1e);
          border: 1px solid var(--border-color, #444);
          border-radius: 8px;
          color: var(--text-primary, #eee);
          font-family: inherit; font-size: 13px;
          padding: 8px 10px;
          resize: vertical;
        }
        .bugreport-textarea:focus, .bugreport-input:focus {
          outline: none; border-color: var(--accent, #4488ff);
        }
        .bugreport-check {
          display: flex; align-items: center; gap: 8px;
          font-size: 12px; color: var(--text-primary, #ddd);
          cursor: pointer; user-select: none;
        }
        .bugreport-error {
          font-size: 12px; color: #ff7070;
          background: rgba(255,80,80,0.1);
          border-radius: 6px; padding: 8px 10px;
        }
        .bugreport-actions {
          display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;
        }
        .bugreport-cancel, .bugreport-submit {
          border-radius: 8px; padding: 8px 16px;
          font-size: 13px; font-family: inherit; cursor: pointer;
        }
        .bugreport-cancel {
          background: var(--bg-tertiary, #333);
          border: 1px solid var(--border-color, #444);
          color: var(--text-primary, #ddd);
        }
        .bugreport-submit {
          background: var(--accent, #4488ff);
          border: 1px solid transparent;
          color: #fff; font-weight: 500;
        }
        .bugreport-submit:disabled, .bugreport-cancel:disabled {
          opacity: 0.5; cursor: default;
        }
        .bugreport-success {
          padding: 32px 20px; text-align: center;
          font-size: 14px; color: var(--text-primary, #eee);
        }
      `}</style>
    </div>
  );
}
