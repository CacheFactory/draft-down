// @archigraph core.bug-report
// Node test env: stub the minimal window surface these modules touch.
(globalThis as any).window = {
  addEventListener: () => {},
  __PLATFORM__: 'web',
};

import { installConsoleBuffer, getConsoleEntries } from '../../src/core/console-buffer';
import { collectBugReport } from '../../src/core/bug-report';

describe('console buffer', () => {
  test('captures errors and warnings, caps at 50, install is idempotent', () => {
    installConsoleBuffer();
    installConsoleBuffer(); // second install must not double-patch

    console.error('boom', { code: 42 });
    console.warn('careful');
    const entries = getConsoleEntries();
    const last = entries.slice(-2);
    expect(last[0]).toMatchObject({ level: 'error' });
    expect(last[0].message).toContain('boom');
    expect(last[0].message).toContain('42');
    expect(last[0].message.match(/boom/g)!.length).toBe(1); // not double-captured
    expect(last[1]).toMatchObject({ level: 'warn', message: 'careful' });

    for (let i = 0; i < 60; i++) console.error(`overflow-${i}`);
    expect(getConsoleEntries().length).toBe(50);
    expect(getConsoleEntries().slice(-1)[0].message).toBe('overflow-59');
  });
});

describe('collectBugReport', () => {
  function stubApp(modelBytes: number) {
    return {
      viewport: {
        renderer: {
          captureImage: () => 'data:image/jpeg;base64,QUJD',
          getStats: () => ({ fps: 60, frameTime: 16, drawCalls: 5, triangles: 12 }),
        },
      },
      document: {
        serialize: () => new ArrayBuffer(modelBytes),
        geometry: {
          getMesh: () => ({
            faces: { size: 6 },
            edges: { size: 12 },
            vertices: { size: 8 },
          }),
        },
      },
    };
  }

  beforeAll(() => {
    ((globalThis as any).window as any).api = { invoke: async (ch: string) => (ch === 'app:get-version' ? '9.9.9' : null) };
  });

  test('gathers screenshot, model, stats, version', async () => {
    const payload = await collectBugReport(stubApp(100), 'it broke', 'a@b.c', {
      includeScreenshot: true,
      includeModel: true,
    });
    expect(payload.description).toBe('it broke');
    expect(payload.reporterEmail).toBe('a@b.c');
    expect(payload.appVersion).toBe('9.9.9');
    expect(payload.screenshot).toBe('data:image/jpeg;base64,QUJD');
    expect(payload.model).toBe(btoa(String.fromCharCode(...new Uint8Array(100))));
    expect(payload.modelSkipped).toBeUndefined();
    expect(payload.stats).toMatchObject({ faces: 6, edges: 12, vertices: 8, fps: 60 });
  });

  test('skips oversized model and flags it', async () => {
    const payload = await collectBugReport(stubApp(5 * 1024 * 1024), 'big', undefined, {
      includeScreenshot: false,
      includeModel: true,
    });
    expect(payload.model).toBeUndefined();
    expect(payload.modelSkipped).toBe(true);
    expect(payload.screenshot).toBeUndefined();
  });

  test('survives an app with no document (welcome screen)', async () => {
    const payload = await collectBugReport({}, 'early crash', undefined, {
      includeScreenshot: true,
      includeModel: true,
    });
    expect(payload.description).toBe('early crash');
    expect(payload.screenshot).toBeUndefined();
    expect(payload.model).toBeUndefined();
    expect(payload.stats).toEqual({});
  });
});
