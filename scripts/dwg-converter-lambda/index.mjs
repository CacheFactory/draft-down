// DWG↔DXF converter — Lambda Function URL handler wrapping LibreDWG's
// dwg2dxf / dxf2dwg CLIs. Request/response mirror the SKP converter shape:
//   POST { direction: 'dwg2dxf' | 'dxf2dwg', file: <base64> }
//   →    { ok: true, file: <base64> } | { ok: false, error }
// CORS headers come from the Function URL config — do not emit them here.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export async function handler(event) {
  if (event.requestContext?.http?.method !== 'POST') {
    return json(405, { ok: false, error: 'POST only' });
  }
  let req;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    req = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  const { direction, file } = req;
  if (direction !== 'dwg2dxf' && direction !== 'dxf2dwg') {
    return json(400, { ok: false, error: "direction must be 'dwg2dxf' or 'dxf2dwg'" });
  }
  if (typeof file !== 'string' || file.length === 0) {
    return json(400, { ok: false, error: 'file (base64) is required' });
  }

  const [inExt, outExt] = direction === 'dwg2dxf' ? ['dwg', 'dxf'] : ['dxf', 'dwg'];
  const dir = mkdtempSync(join(tmpdir(), 'conv-'));
  const inPath = join(dir, `in.${inExt}`);
  const outPath = join(dir, `out.${outExt}`);
  try {
    writeFileSync(inPath, Buffer.from(file, 'base64'));
    const tool = direction === 'dwg2dxf' ? 'dwg2dxf' : 'dxf2dwg';
    // -y: overwrite output. dxf2dwg targets r2000 — LibreDWG's most reliable
    // DWG write version; AutoCAD and every viewer read r2000 fine.
    const args = direction === 'dxf2dwg'
      ? ['-y', '--as', 'r2000', '-o', outPath, inPath]
      : ['-y', '-o', outPath, inPath];
    try {
      execFileSync(tool, args, { timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      // LibreDWG exits non-zero on recoverable warnings while still writing
      // valid output — only fail if the output file didn't materialize.
      console.warn(`[${tool}] exited non-zero:`, e.stderr?.toString().slice(0, 500) ?? e.message);
    }
    const out = readFileSync(outPath); // throws if conversion truly failed
    if (out.length === 0) return json(422, { ok: false, error: 'Conversion produced empty output' });
    return json(200, { ok: true, file: out.toString('base64') });
  } catch (err) {
    console.error('conversion failed:', err);
    return json(422, { ok: false, error: `Conversion failed: ${String(err?.message ?? err)}` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
