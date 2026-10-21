// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
const methods = ['kswarmStart', 'kswarmStop', 'kswarmRestart', 'kswarmResumeWorkflowRun'] as const;
function port() { return { invoke: vi.fn(async (channel: string, ..._args: unknown[]): Promise<unknown> => channel.endsWith('resumeWorkflowRun') ? { restored: false, reason: 'no_script_source', future: true } : undefined), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() }; }
async function check(api: ReturnType<typeof createPreloadApi>, ipc: ReturnType<typeof port>) {
  for (const method of methods) {
    const resume = method === 'kswarmResumeWorkflowRun', args = resume ? [{ projectId: 'owned', workflowRunId: 'owned-run' }] : [];
    ipc.invoke.mockClear(); expect(await Reflect.apply(api[method], api, args)).toEqual(resume ? { restored: false, reason: 'no_script_source', future: true } : undefined);
    expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('desktop:kswarm:' + (resume ? 'resumeWorkflowRun' : method.slice(6).toLowerCase()), ...args);
    const failure = Error('fixed-domain-reject'); ipc.invoke.mockRejectedValueOnce(failure); await expect(Reflect.apply(api[method], api, args)).rejects.toBe(failure);
  }
}
it('actual TS preload keeps original four action tuples, complete false result, and rejection', async () => { const ipc = port(); await check(createPreloadApi(ipc), ipc); });
it('actual sandbox CJS preload keeps original four action tuples, complete false result, and rejection', async () => {
  const ipc = port(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), { require(name: string) {
    if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
    if (name === 'os') return os; throw Error('unexpected dependency ' + name);
  } }); await check(api, ipc);
});
