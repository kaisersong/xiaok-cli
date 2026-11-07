// @vitest-environment node
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as os from 'node:os';
import {expect,it,vi} from 'vitest';
import {createPreloadApi} from '../../electron/preload-api.js';
const channel='desktop:kswarm:default-dispatch:capture',input={projectId:'p'},result={ok:false,error:'not_ready',notInvoked:true};
function port(){return{invoke:vi.fn(async()=>result),on:vi.fn(),off:vi.fn(),removeListener:vi.fn(),send:vi.fn()};}
async function check(api:ReturnType<typeof createPreloadApi>,ipc:ReturnType<typeof port>){
 expect(await (api as any).captureDefaultDispatchOperation(input)).toEqual(result);expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith(channel,input);const cause=Error('original IPC failure');ipc.invoke.mockRejectedValueOnce(cause);await expect((api as any).captureDefaultDispatchOperation(input)).rejects.toBe(cause);
 const observed={ok:true,operation:{children:[{childKey:'original-child',taskId:'task',state:'intent_pending'}]},preparationObservations:[{childKey:'original-child',taskId:'task',status:'present'}]};ipc.invoke.mockResolvedValueOnce(observed as never);expect(await api.captureDefaultDispatchOperation(input)).toBe(observed);
}
it('TS preload exposes only the semantic capture input and preserves definite refusal and rejection',async()=>{const ipc=port();await check(createPreloadApi(ipc),ipc);});
it('sandbox CJS preload uses the same semantic tuple and retains the complete result',async()=>{
 const ipc=port();let api!:ReturnType<typeof createPreloadApi>;runInNewContext(readFileSync(new URL('../../electron/preload.cjs',import.meta.url),'utf8'),{require(name:string){if(name==='electron')return{ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_key:string,value:typeof api){api=value;}}};if(name==='os')return os;throw Error('unexpected dependency '+name);}});await check(api,ipc);
});
