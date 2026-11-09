// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as os from 'node:os';
import {registerUserTaskSubmissionIpc} from '../../electron/user-task-submission-typed-ipc.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
import {createPreloadApi} from '../../electron/preload-api.js';
import {TASK7_INPUTS} from '../../shared/task7-ipc-contract.js';
const submissionId='main-submission:123e4567-e89b-42d3-a456-426614174000:123e4567-e89b-42d3-a456-426614174001';
const wire={action:'submit_new',gestureId:'123e4567-e89b-42d3-a456-426614174000',input:{kind:'materials',prompt:'hello',materials:[]}};
afterEach(resetIpcSchemaRegistryForTests);
it('real typed registrar authorizes before hostile getters, validates the union, and rechecks after await',async()=>{
 let listener:any,allowed=true;const producer=vi.fn(async()=>({taskId:'actual',submissionId}));
 registerUserTaskSubmissionIpc({handle(_channel:string,handler:unknown){listener=handler;}} as never,producer,()=>{if(!allowed)throw Error('sender_forbidden');});
 let reads=0;allowed=false;await expect(listener({}, {get action(){reads++;return 'submit_new';}})).rejects.toThrow('sender_forbidden');expect(reads).toBe(0);expect(producer).not.toHaveBeenCalled();
 allowed=true;await expect(listener({},wire)).resolves.toEqual({taskId:'actual',submissionId});
 await expect(listener({},{action:'retry_existing',submissionId,prompt:'replacement'})).rejects.toThrow();expect(producer).toHaveBeenCalledOnce();
 producer.mockImplementationOnce(async()=>{allowed=false;return {taskId:'actual',submissionId};});await expect(listener({},wire)).rejects.toThrow('sender_forbidden');
});
it('old create wire rejects new submission identities instead of silently dropping them',()=>{
 for(const method of ['createTask','createTaskWithFiles'] as const){
  const input=method==='createTask'?{prompt:'x',materials:[]}:{prompt:'x',filePaths:[]};
  expect(TASK7_INPUTS[method].safeParse([input]).success).toBe(true);
  for(const extra of [{gestureId:wire.gestureId},{submissionId}])expect(TASK7_INPUTS[method].safeParse([{...input,...extra}]).success).toBe(false);
 }
});
it.each(['ts','cjs'])('the real %s preload exposes only the semantic submission RPC',async kind=>{
 const ipc={invoke:vi.fn(async()=>({taskId:'actual',submissionId})),on:vi.fn(),off:vi.fn(),removeListener:vi.fn(),send:vi.fn()};let api:ReturnType<typeof createPreloadApi>;
 if(kind==='ts')api=createPreloadApi(ipc);
 else {runInNewContext(readFileSync(new URL('../../electron/preload.cjs',import.meta.url),'utf8'),{require(name:string){if(name==='electron')return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_name:string,value:typeof api){api=value;}}};if(name==='os')return os;throw Error('unexpected');}});}
 expect(await api!.submitUserTask(wire as never)).toEqual({taskId:'actual',submissionId});expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('desktop:submitUserTask',wire);
 expect(Object.keys(api!).filter(key=>/Submission|submitUserTask/.test(key))).toEqual(['submitUserTask']);
});
