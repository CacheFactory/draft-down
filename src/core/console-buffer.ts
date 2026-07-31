// @archigraph core.console-buffer
// Bounded ring buffer of recent console errors/warnings, attached to bug
// reports. Installed once at startup by BOTH entry points (Electron renderer
// and web) — patches console.error/warn and captures window error events.

export interface ConsoleEntry {
  level: 'error' | 'warn';
  message: string;
  time: string;
}

const MAX_ENTRIES = 50;
const MAX_MESSAGE_LEN = 500;
const entries: ConsoleEntry[] = [];
let installed = false;

function safeStringify(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function push(level: 'error' | 'warn', args: unknown[]): void {
  const message = args.map(safeStringify).join(' ').slice(0, MAX_MESSAGE_LEN);
  entries.push({ level, message, time: new Date().toISOString() });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

export function installConsoleBuffer(): void {
  if (installed) return;
  installed = true;

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    origError(...args);
    push('error', args);
  };
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    push('warn', args);
  };

  window.addEventListener('error', (e) => {
    push('error', [`[window error] ${e.message} (${e.filename}:${e.lineno})`]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    push('error', [`[unhandled rejection] ${safeStringify(e.reason)}`]);
  });
}

export function getConsoleEntries(): ConsoleEntry[] {
  return [...entries];
}
