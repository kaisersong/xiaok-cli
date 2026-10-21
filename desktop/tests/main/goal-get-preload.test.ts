// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/goal-get-preload', getLocale: () => 'en' }, BrowserWindow: { getAllWindows: () => [] }, clipboard: {}, dialog: {}, shell: {} }));
import { createPreloadApi, type DesktopApi } from '../../electron/preload-api.js';
import { goalGetFixture, projection } from '../support/goal-get-fixture.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
it.each(['TS', 'CJS'] as const)('original %s preload transports real registered public projection/null/rejection', async variant => {
  resetIpcSchemaRegistryForTests();
  let output: ReturnType<typeof projection> | null = projection();
  let rejection: Error | undefined;
  const f = await goalGetFixture(async function () { if (rejection) throw rejection; return output; });
  const calls: Array<{ channel: string; args: unknown[] }> = [];
  const ipc = { async invoke(channel: string, ...args: unknown[]) {
    calls.push({ channel, args }); if (channel !== 'desktop:goal:get') throw Error('unexpected_channel');
    // Explicit own data-only wire surrogate: Electron IPC clones CJS-realm objects before Main.
    return f.invoke(structuredClone(args));
  }, on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() };
  try {
    let api: DesktopApi;
    if (variant === 'TS') api = createPreloadApi(ipc);
    else {
      let exposed: DesktopApi | undefined;
      runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
        require(name: string) {
          if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_name: string, value: DesktopApi) { exposed = value; } } };
          if (name === 'os') return os; throw Error('unexpected_dependency');
        },
      });
      if (!exposed) throw Error('original_CJS_api_missing'); api = exposed;
    }
    expect(await api.getGoal('thread')).toEqual(projection());
    output = null; expect(await api.getGoal('thread')).toBeNull();
    rejection = Error('original-query-error'); await expect(api.getGoal('thread')).rejects.toBe(rejection);
    expect(calls).toEqual(Array.from({ length: 3 }, () => ({ channel: 'desktop:goal:get', args: [{ threadId: 'thread' }] })));
    expect(f.calls).toEqual(['thread', 'thread', 'thread']); expect(f.gate.outstanding).toBe(0);
  } finally { await f.close(); }
});

