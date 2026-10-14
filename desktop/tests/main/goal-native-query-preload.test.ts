// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createPreloadApi, type DesktopApi } from '../../electron/preload-api.js';
import type { GoalNativeQueryDto } from '../../shared/goal-native-query-ipc-contract.js';
function port(){return {invoke:vi.fn(async(_channel:string,..._args:unknown[]):Promise<unknown>=>null),on:vi.fn(),removeListener:vi.fn(),off:vi.fn(),send:vi.fn()};}
async function check(api:DesktopApi,ipc:ReturnType<typeof port>){
 const row:GoalNativeQueryDto={id:'summary',kind:'fork',status:'stale',objective:'Historical summary'};
 for(const result of [null,row]){ipc.invoke.mockResolvedValueOnce(result);expect(await api.getGoalNativeMutation('thread')).toEqual(result);expect(ipc.invoke).toHaveBeenLastCalledWith('desktop:goal:getNativeMutation',{threadId:'thread'});}
 const error=Error('read_unavailable');ipc.invoke.mockRejectedValueOnce(error);await expect(api.getGoalNativeMutation('thread')).rejects.toBe(error);
 // Same 4-field data contract consumed by ChatShell; no native current-state/approval claim.
 const summary:Awaited<ReturnType<DesktopApi['getGoalNativeMutation']>>=row;expect(Object.keys(summary).sort()).toEqual(['id','kind','objective','status']);
}
it('original TS semantic preload preserves query name/payload/nullable data and rejection',async()=>{const ipc=port();await check(createPreloadApi(ipc),ipc);});
it('original sandbox CJS preload preserves the same query ABI',async()=>{
 const ipc=port();let api!:DesktopApi;
 runInNewContext(readFileSync(new URL('../../electron/preload.cjs',import.meta.url),'utf8'),{require(name:string){if(name==='electron')return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_name:string,value:DesktopApi){api=value;}}};if(name==='os')return os;throw Error('unexpected_dependency');}});
 await check(api,ipc);
});
