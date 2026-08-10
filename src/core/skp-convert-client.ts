// @archigraph svc.skp_convert
// Client for the model-conversion service (App Runner). The service enforces
// a hard 120-second request timeout, so conversions run as async jobs:
// POST /jobs returns an id immediately and GET /jobs/<id> polls until the
// ZIP (OBJ + MTL + textures) is ready. Falls back to the legacy synchronous
// POST / when the service predates the job endpoints.
// Shared by the Electron main process and the web platform bridge.

export type SkpConvertResult = { zip: ArrayBuffer } | { error: string };

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;
/** Consecutive poll fetch failures tolerated before giving up (transient network). */
const POLL_MAX_ERRORS = 3;

/** O(n) Uint8Array → base64 (chunked — a per-byte reduce is quadratic and
 *  freezes the tab for minutes on a 50MB model). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return btoa(parts.join(''));
}

async function readError(resp: Response): Promise<string> {
  const err = await resp.json().catch(() => null);
  return err?.error || `Conversion service returned HTTP ${resp.status}`;
}

export async function convertSkpViaService(
  serviceUrl: string,
  base64File: string,
  filename: string,
): Promise<SkpConvertResult> {
  const base = serviceUrl.replace(/\/+$/, '');
  const body = JSON.stringify({ file: base64File, filename });
  const headers = { 'Content-Type': 'application/json' };

  let start: Response;
  try {
    start = await fetch(`${base}/jobs`, { method: 'POST', headers, body });
  } catch (e: any) {
    return { error: `Could not reach the conversion service: ${e?.message ?? e}` };
  }

  // Older service without job endpoints → single synchronous request.
  if (start.status === 404 || start.status === 405) {
    try {
      const resp = await fetch(base, { method: 'POST', headers, body });
      if (!resp.ok) return { error: await readError(resp) };
      return { zip: await resp.arrayBuffer() };
    } catch (e: any) {
      return { error: `Conversion failed: ${e?.message ?? e}` };
    }
  }

  if (!start.ok && start.status !== 202) return { error: await readError(start) };
  const job = await start.json().catch(() => null);
  if (!job?.id) return { error: 'Conversion service returned no job id' };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let resp: Response;
    try {
      resp = await fetch(`${base}/jobs/${job.id}`);
      consecutiveErrors = 0;
    } catch (e: any) {
      if (++consecutiveErrors >= POLL_MAX_ERRORS) {
        return { error: `Lost contact with the conversion service: ${e?.message ?? e}` };
      }
      continue;
    }
    if (resp.status === 202) continue; // still converting
    if (resp.ok && (resp.headers.get('Content-Type') || '').includes('zip')) {
      return { zip: await resp.arrayBuffer() };
    }
    return { error: await readError(resp) };
  }
  return { error: 'Conversion timed out after 20 minutes' };
}
