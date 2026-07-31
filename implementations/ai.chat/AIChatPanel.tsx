// @archigraph ai.chat
// AI Chat sub-window panel for DraftDown

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../window.main/AppContext';
import type { IModelAPI } from '../api.model/ModelAPI';
import {
  ChatMessage,
  buildSystemPrompt,
  buildSelectionContext,
  contextToMessage,
  getToolDefinitions,
  executeTool,
} from './AIService';

export function AIChatPanel() {
  const { app } = useApp();
  const [open, setOpen] = useState(false);

  // Opened from the AI button in the left drawing toolbar (no floating FAB)
  useEffect(() => {
    const toggle = () => setOpen(o => !o);
    window.addEventListener('toggle-ai-chat', toggle);
    return () => window.removeEventListener('toggle-ai-chat', toggle);
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const getModelAPI = useCallback((): IModelAPI | null => {
    return (app as any)?.modelAPI ?? (window as any).modelAPI ?? null;
  }, [app]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const modelAPI = getModelAPI();
    if (!modelAPI) {
      setError('Model API not available. Wait for the app to initialize.');
      return;
    }

    setInput('');
    setError(null);

    // Build selection context
    const selCtx = buildSelectionContext(modelAPI);
    const contextMsg = contextToMessage(selCtx);

    // Add user message with context
    const userMessage: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setLoading(true);

    try {
      // Build API messages: include context as a system-injected user message
      const apiMessages: Array<{ role: string; content: unknown }> = [];

      // Replay conversation history
      for (const msg of newMessages) {
        if (msg.role === 'user') {
          apiMessages.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          apiMessages.push({ role: 'assistant', content: msg.content });
        }
      }

      // Inject context into the last user message
      const lastIdx = apiMessages.length - 1;
      apiMessages[lastIdx] = {
        role: 'user',
        content: `${contextMsg}\n\n---\n\n${text}`,
      };

      // Call Claude API via main process
      let response = await window.api.invoke('ai:chat', {
        system: buildSystemPrompt(),
        messages: apiMessages,
        tools: getToolDefinitions(),
      }) as any;

      if (response.error) {
        setError(response.error);
        setLoading(false);
        return;
      }

      // Process response — handle tool use loop
      let assistantText = '';
      const toolCalls: ChatMessage['toolCalls'] = [];
      let continueMessages = [...apiMessages];

      // Tool use loop (max 25 rounds — gives Claude room to retry after errors).
      for (let round = 0; round < 25; round++) {
        if (response.stop_reason === 'end_turn' || !response.content) break;

        // Extract text and tool_use blocks
        const contentBlocks = response.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        const toolUseBlocks = contentBlocks.filter((b: any) => b.type === 'tool_use');
        const textBlocks = contentBlocks.filter((b: any) => b.type === 'text');

        for (const tb of textBlocks) {
          if (tb.text) assistantText += tb.text;
        }

        if (toolUseBlocks.length === 0) break;

        // Execute each tool call
        const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];

        for (const tu of toolUseBlocks) {
          const result = await executeTool(modelAPI, tu.name!, tu.input!);
          toolCalls.push({ name: tu.name!, input: tu.input!, result });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id!,
            content: result,
          });
        }

        // Sync scene after tool execution
        if ((app as any)?.syncScene) (app as any).syncScene();
        if ((app as any)?.syncSelection) (app as any).syncSelection();

        // Continue conversation with tool results
        continueMessages = [
          ...continueMessages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResults },
        ];

        response = await window.api.invoke('ai:chat', {
          system: buildSystemPrompt(),
          messages: continueMessages,
          tools: getToolDefinitions(),
        }) as any;

        if (response.error) {
          setError(response.error);
          break;
        }
      }

      // Extract final text from last response
      if (response.content) {
        for (const block of response.content as Array<{ type: string; text?: string }>) {
          if (block.type === 'text' && block.text) {
            assistantText += block.text;
          }
        }
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: assistantText,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, app, getModelAPI]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      sendMessage();
    }
  };

  if (!open) return null;

  return (
    <div className="ai-chat-window">
      <div className="ai-chat-header">
        <span className="ai-chat-title">AI Assistant</span>
        <div className="ai-chat-header-actions">
          <button className="ai-chat-clear" onClick={() => { setMessages([]); setError(null); }} title="Clear chat">Clear</button>
          <button className="ai-chat-close" onClick={() => setOpen(false)} title="Close">&times;</button>
        </div>
      </div>

      <div className="ai-chat-messages">
        {messages.length === 0 && (
          <div className="ai-chat-empty">
            Select geometry in the viewport, then describe what you want to do.
            <br /><br />
            Examples:
            <ul>
              <li>"Create a 3m x 5m x 3m box"</li>
              <li>"Extrude this face 2 meters"</li>
              <li>"Paint the selected faces red"</li>
              <li>"Move this 1m to the right"</li>
            </ul>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`ai-chat-msg ai-chat-msg-${msg.role}`}>
            <div className="ai-chat-msg-role">{msg.role === 'user' ? 'You' : 'AI'}</div>
            <div className="ai-chat-msg-content">{msg.content}</div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="ai-chat-tool-calls">
                {msg.toolCalls.map((tc, j) => <ToolCallRow key={j} tc={tc} />)}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="ai-chat-msg ai-chat-msg-assistant">
            <div className="ai-chat-msg-role">AI</div>
            <div className="ai-chat-thinking">Thinking...</div>
          </div>
        )}

        {error && (
          <div className="ai-chat-error">{error}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="ai-chat-input-area">
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what to do with the selection..."
          rows={2}
          disabled={loading}
        />
        <button
          className="ai-chat-send"
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>

      <style>{`
        .ai-chat-window {
          position: fixed;
          bottom: 40px;
          right: calc(var(--panel-width, 260px) + 16px);
          z-index: 9000;
          width: 380px;
          height: 520px;
          display: flex;
          flex-direction: column;
          background: var(--bg-secondary, #252526);
          border: 1px solid var(--border-color, #3e3e3e);
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          overflow: hidden;
          font-family: var(--font-family, system-ui, -apple-system, sans-serif);
          font-size: 13px;
        }
        .ai-chat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--bg-tertiary, #2d2d2d);
          border-bottom: 1px solid var(--border-color, #3e3e3e);
          flex-shrink: 0;
          cursor: default;
        }
        .ai-chat-title {
          font-weight: 600;
          color: var(--text-primary, #ccc);
          font-size: 13px;
        }
        .ai-chat-header-actions { display: flex; gap: 6px; align-items: center; }
        .ai-chat-clear, .ai-chat-close {
          background: none; border: none; color: var(--text-secondary, #999);
          cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 3px;
        }
        .ai-chat-close { font-size: 18px; line-height: 1; padding: 0 4px; }
        .ai-chat-clear:hover, .ai-chat-close:hover {
          background: var(--bg-hover, #3e3e3e); color: var(--text-primary, #ccc);
        }
        .ai-chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ai-chat-empty {
          color: var(--text-muted, #666);
          font-size: 12px;
          padding: 16px 8px;
          line-height: 1.5;
        }
        .ai-chat-empty ul {
          margin: 4px 0 0 0;
          padding-left: 18px;
        }
        .ai-chat-empty li {
          margin-bottom: 2px;
          color: var(--text-secondary, #999);
        }
        .ai-chat-msg {
          padding: 8px 10px;
          border-radius: 6px;
          max-width: 95%;
        }
        .ai-chat-msg-user {
          background: var(--accent, #0078d4);
          color: white;
          align-self: flex-end;
        }
        .ai-chat-msg-assistant {
          background: var(--bg-tertiary, #2d2d2d);
          color: var(--text-primary, #ccc);
          align-self: flex-start;
        }
        .ai-chat-msg-role {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 3px;
          opacity: 0.7;
        }
        .ai-chat-msg-content {
          white-space: pre-wrap;
          word-break: break-word;
          line-height: 1.4;
        }
        .ai-chat-tool-calls {
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px solid rgba(255,255,255,0.1);
        }
        .ai-chat-tool-call {
          display: flex;
          gap: 6px;
          align-items: baseline;
          font-size: 11px;
          margin-bottom: 2px;
        }
        .ai-chat-tool-name {
          background: rgba(0,120,212,0.3);
          padding: 1px 5px;
          border-radius: 3px;
          font-family: monospace;
          font-size: 10px;
          white-space: nowrap;
        }
        .ai-chat-tool-args {
          color: var(--text-muted, #666);
          font-family: monospace;
          font-size: 10px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ai-chat-thinking {
          color: var(--text-muted, #666);
          font-style: italic;
          animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .ai-chat-error {
          background: rgba(244,67,54,0.15);
          color: var(--danger, #f44336);
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 12px;
          line-height: 1.4;
        }
        .ai-chat-input-area {
          display: flex;
          gap: 6px;
          padding: 8px;
          border-top: 1px solid var(--border-color, #3e3e3e);
          background: var(--bg-tertiary, #2d2d2d);
          flex-shrink: 0;
        }
        .ai-chat-input {
          flex: 1;
          background: var(--bg-primary, #1e1e1e);
          color: var(--text-primary, #ccc);
          border: 1px solid var(--border-color, #3e3e3e);
          border-radius: 4px;
          padding: 6px 8px;
          font-size: 13px;
          font-family: inherit;
          resize: none;
          outline: none;
          line-height: 1.4;
        }
        .ai-chat-input:focus {
          border-color: var(--accent, #0078d4);
        }
        .ai-chat-input::placeholder {
          color: var(--text-muted, #666);
        }
        .ai-chat-send {
          padding: 6px 14px;
          background: var(--accent, #0078d4);
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          align-self: flex-end;
          white-space: nowrap;
        }
        .ai-chat-send:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .ai-chat-send:not(:disabled):hover {
          filter: brightness(1.1);
        }
        .ai-chat-tool-call.expanded { background: rgba(255,255,255,0.03); border-radius: 4px; padding: 4px 6px; }
        .ai-chat-tool-detail {
          display: block; margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10.5px; color: var(--text-secondary, #aaa); white-space: pre-wrap; word-break: break-word;
          max-height: 240px; overflow: auto; padding: 4px 6px;
          background: var(--bg-primary, #111); border-radius: 3px; border: 1px solid var(--border-color, #333);
        }
        .ai-chat-tool-detail.error { color: #f87171; border-color: #844; }
        .ai-chat-tool-detail.ok { color: #4ade80; }
        .ai-chat-tool-toggle {
          background: transparent; border: 1px solid var(--border-color, #444); color: var(--text-secondary, #888);
          font-size: 10px; padding: 1px 6px; border-radius: 10px; cursor: pointer; margin-left: auto;
        }
        .ai-chat-tool-toggle:hover { color: var(--text-primary, #ddd); border-color: #888; }
        .ai-chat-tool-row-top { display: flex; align-items: center; gap: 6px; }
      `}</style>
    </div>
  );
}

function ToolCallRow({ tc }: { tc: { name: string; input: Record<string, unknown>; result?: string } }) {
  const [expanded, setExpanded] = useState(false);
  // Try to parse the result so we can pull `ok`, `error`, `created` etc.
  let parsed: any = tc.result;
  let ok = true;
  let summary = '';
  try {
    if (typeof tc.result === 'string') parsed = JSON.parse(tc.result);
  } catch (e) { console.warn('[AIChatPanel.ToolCallRow] result was not valid JSON, keeping raw:', e); }

  if (parsed && typeof parsed === 'object') {
    if (parsed.ok === false) ok = false;
    if (tc.name === 'execute_script') {
      const c = parsed.created ?? {};
      const r = parsed.removed ?? {};
      const counts = (o: any) =>
        `F${(o.faces ?? []).length} E${(o.edges ?? []).length} V${(o.vertices ?? []).length} G${(o.groups ?? []).length}`;
      summary = ok
        ? `"${parsed.operationName ?? ''}" — created ${counts(c)}${(r.faces?.length || r.edges?.length) ? `, removed ${counts(r)}` : ''}`
        : `"${parsed.operationName ?? ''}" — ${parsed.error ?? 'failed'}`;
    } else if (tc.name === 'inspect') {
      summary = `${Array.isArray(parsed) ? parsed.length : 0} entit${(Array.isArray(parsed) && parsed.length === 1) ? 'y' : 'ies'}`;
    } else if (tc.name === 'read_state') {
      const s = parsed.selection?.counts ?? {};
      summary = `selection: F${s.faces ?? 0} E${s.edges ?? 0} V${s.vertices ?? 0} · model: ${parsed.model?.totalFaces ?? 0} faces, ${parsed.model?.totalEdges ?? 0} edges`;
    } else if (tc.name === 'read_api_reference') {
      const s = typeof parsed === 'string' ? parsed.length : (typeof tc.result === 'string' ? tc.result.length : 0);
      summary = `${s.toLocaleString()} chars`;
    }
  }

  const inputPreview = (() => {
    if (tc.name === 'execute_script') {
      const op = (tc.input as any).operationName ?? '';
      const script = String((tc.input as any).script ?? '').replace(/\s+/g, ' ').trim();
      return op + ' — ' + (script.length > 60 ? script.slice(0, 60) + '…' : script);
    }
    if (tc.name === 'inspect') {
      const ids = (tc.input as any).ids ?? [];
      return Array.isArray(ids) ? `${ids.length} id(s)` : '';
    }
    return JSON.stringify(tc.input ?? {}, null, 0).slice(0, 80);
  })();

  return (
    <div className={`ai-chat-tool-call ${expanded ? 'expanded' : ''}`}>
      <div className="ai-chat-tool-row-top">
        <span className="ai-chat-tool-name" style={{ color: ok ? '#4ade80' : '#f87171' }}>{tc.name}</span>
        <span className="ai-chat-tool-args">{summary || inputPreview}</span>
        <button className="ai-chat-tool-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'hide' : 'show'}
        </button>
      </div>
      {expanded && (
        <>
          {tc.name === 'execute_script' && (
            <div className="ai-chat-tool-detail">
              {String((tc.input as any).script ?? '')}
            </div>
          )}
          {tc.name !== 'execute_script' && (
            <div className="ai-chat-tool-detail">
              input: {JSON.stringify(tc.input, null, 2)}
            </div>
          )}
          <div className={`ai-chat-tool-detail ${ok ? 'ok' : 'error'}`}>
            {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
          </div>
        </>
      )}
    </div>
  );
}
