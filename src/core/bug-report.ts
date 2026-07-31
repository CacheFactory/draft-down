// @archigraph core.bug-report
// Shared bug-report collection + sending, used by BugReportModal on both the
// Electron renderer and web builds. The endpoint (a Lambda Function URL) is
// baked in at build time via webpack DefinePlugin — same pattern as
// __SKP_CONVERT_URL__. Electron's renderer CSP must list the endpoint host in
// connect-src (src/renderer/index.html).

import { ConsoleEntry, getConsoleEntries } from './console-buffer';

declare const __BUG_REPORT_URL__: string;

/** Skip attaching the model when the serialized document exceeds this —
 *  the Lambda Function URL body limit is 6MB and base64 inflates by 4/3. */
const MODEL_ATTACH_LIMIT = 4 * 1024 * 1024;

export interface BugReportPayload {
  description: string;
  reporterEmail?: string;
  appVersion: string;
  platform: string;
  timestamp: string;
  userAgent: string;
  screenshot?: string;
  model?: string;
  modelSkipped?: boolean;
  stats: Record<string, number>;
  consoleEntries: ConsoleEntry[];
}

export function getBugReportUrl(): string {
  return typeof __BUG_REPORT_URL__ !== 'undefined' ? __BUG_REPORT_URL__ : '';
}

/** Chunked base64 — one giant String.fromCharCode.apply overflows the stack. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/** Gather everything best-effort: a report filed before a document exists
 *  (e.g. from the welcome screen) still sends whatever pieces succeeded. */
export async function collectBugReport(
  app: any,
  description: string,
  reporterEmail: string | undefined,
  opts: { includeScreenshot: boolean; includeModel: boolean },
): Promise<BugReportPayload> {
  const payload: BugReportPayload = {
    description,
    reporterEmail: reporterEmail || undefined,
    appVersion: 'unknown',
    platform: (window as any).__PLATFORM__ === 'web' ? 'web' : `electron-${navigator.platform}`,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    stats: {},
    consoleEntries: getConsoleEntries(),
  };

  try {
    payload.appVersion = await (window as any).api.invoke('app:get-version');
  } catch { /* keep 'unknown' */ }

  if (opts.includeScreenshot) {
    try {
      payload.screenshot = app.viewport.renderer.captureImage(1, 'image/jpeg', 0.8);
    } catch (e) {
      console.warn('[bug-report] screenshot capture failed:', e);
    }
  }

  if (opts.includeModel) {
    try {
      const buffer: ArrayBuffer = app.document.serialize();
      if (buffer.byteLength > MODEL_ATTACH_LIMIT) {
        payload.modelSkipped = true;
      } else {
        payload.model = arrayBufferToBase64(buffer);
      }
    } catch (e) {
      console.warn('[bug-report] model serialization failed:', e);
    }
  }

  try {
    const mesh = app.document.geometry.getMesh();
    payload.stats.faces = mesh.faces.size;
    payload.stats.edges = mesh.edges.size;
    payload.stats.vertices = mesh.vertices.size;
  } catch { /* no document yet */ }
  try {
    const stats = app.viewport.renderer.getStats();
    payload.stats.fps = stats.fps;
    payload.stats.frameTime = stats.frameTime;
    payload.stats.drawCalls = stats.drawCalls;
    payload.stats.triangles = stats.triangles;
  } catch { /* renderer not ready */ }

  return payload;
}

export async function sendBugReport(
  payload: BugReportPayload,
): Promise<{ ok: boolean; error?: string }> {
  const url = getBugReportUrl();
  if (!url) return { ok: false, error: 'Bug reporting is not configured in this build.' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error || `Server responded ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}
