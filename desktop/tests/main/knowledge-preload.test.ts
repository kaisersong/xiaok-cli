// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { createPreloadApi } from '../../electron/preload-api.js';
function ipc() { return { invoke: vi.fn(async () => ({ transportOnly: true })), on: vi.fn(), off: vi.fn(), removeListener: vi.fn(), send: vi.fn() }; }
async function check(api: ReturnType<typeof createPreloadApi>, port: ReturnType<typeof ipc>) {
  const calls = [
    ['kbListCollections', []], ['kbCreateCollection', [{name:'Own',embeddingModelId:'owned',embeddingDim:384}]], ['kbDeleteCollection',['own']], ['kbListSources',['own']], ['kbAddSource',[{collectionId:'own',kind:'paste',title:'Own',text:'Own body',metadata:{legacy:[null,true]}}]], ['kbPickFiles',[]], ['kbDeleteSource',['own']], ['kbGetCollectionState',['own']], ['kbGetSourceContent',[{sourceId:'own',offset:'2',limit:Infinity}]], ['kbSearch',[{collectionId:'own',query:'own',topK:NaN}]],
  ] as const;
  const channels = ['listCollections','createCollection','deleteCollection','listSources','addSource','pickFiles','deleteSource','getCollectionState','getSourceContent','search'];let index=0;
  for (const [method, args] of calls) {
    port.invoke.mockClear();
    await (api[method] as unknown as (...args: unknown[]) => Promise<unknown>)(...args);
    expect(port.invoke).toHaveBeenCalledExactlyOnceWith('desktop:kb:' + channels[index++], ...args);
    expect(port.invoke.mock.calls[0]).toHaveLength(args.length + 1);
  }

}
it('preserves all ten actual TS Knowledge tuples with original scalar slots', async () => {
  const port = ipc(); await check(createPreloadApi(port as never), port);
});
it('preserves all ten actual CJS Knowledge tuples with no role transport additions', async () => {
  const port = ipc(); let api!: ReturnType<typeof createPreloadApi>;
  runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
    require(name: string) {
      if (name === 'electron') return { ipcRenderer: port, contextBridge: { exposeInMainWorld(_key: string, value: ReturnType<typeof createPreloadApi>) { api = value; } } };
      if (name === 'os') return os; throw Error('unexpected preload dependency ' + name);
    },
  }); await check(api, port);
});
