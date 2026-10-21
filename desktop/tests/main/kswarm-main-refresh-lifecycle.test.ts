import type {InProcessTaskRuntimeHost as TaskHostInstance} from '../../../src/runtime/task-host/task-runtime-host.js';
// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import type {KSwarmService} from '../../electron/kswarm-service.js';
const roots:string[]=[],prior=process.env.XIAOK_CONFIG_DIR;
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});if(prior===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=prior;});
it('never dispatches a provider after external abort during actual handoff preparation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kswarm-refresh-abort-'));roots.push(root);process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const controller=new AbortController();let providers=0;
 const services=createDesktopServices({dataRoot:join(root,'data'),kswarmService:{getBaseUrl:()=> 'http://127.0.0.1:1',getDesktopMutationToken:()=> 'fixture',request:async()=>new Response('{}',{status:501})} as unknown as KSwarmService,runner:async()=>{providers++;}});
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
 const original=FileTaskSnapshotStore.prototype.save;let first=true;
 vi.spyOn(FileTaskSnapshotStore.prototype,'save').mockImplementation(async function(this:FileTaskSnapshotStore,...args:Parameters<typeof original>){if(first){first=false;enter();await held;}return original.apply(this,args);});
 const reason=new Error('external handoff revoked');
 const running=services.runKSwarmHandoffTask({signal:controller.signal,handoff:{kind:'kswarm_task_handoff_v1',runId:'run',project:{id:'project',name:'Project',goal:'normal',requirements:'',workFolder:join(root,'project')},task:{id:'task',title:'normal'}}});
 const settled=running.then(result=>({result,error:undefined}),error=>({result:undefined,error}));
 await entered;controller.abort(reason);release();
 try{expect((await settled).error).toMatchObject({name:'AbortError'});expect(providers).toBe(0);}finally{release();await services.closeTaskSourceWritersForMigration();await services.disposeMultiAgent();}
});
it('retains abort and cancellation failure identities before retiring the prepared host',async()=>{
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 const root=mkdtempSync(join(tmpdir(),'kswarm-refresh-cancel-error-'));roots.push(root);process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const controller=new AbortController();let providers=0;
 const services=createDesktopServices({dataRoot:join(root,'data'),kswarmService:{getBaseUrl:()=> 'http://127.0.0.1:1',getDesktopMutationToken:()=> 'fixture',request:async()=>new Response('{}',{status:501})} as unknown as KSwarmService,runner:async()=>{providers++;}});
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
 const original=FileTaskSnapshotStore.prototype.save;let first=true;
 vi.spyOn(FileTaskSnapshotStore.prototype,'save').mockImplementation(async function(this:FileTaskSnapshotStore,...args:Parameters<typeof original>){if(first){first=false;enter();await held;}return original.apply(this,args);});
 const failure=new Error('actual cancellation rejected');const cancel=vi.spyOn(InProcessTaskRuntimeHost.prototype,'cancelTask').mockRejectedValue(failure);
 const running=services.runKSwarmHandoffTask({signal:controller.signal,handoff:{kind:'kswarm_task_handoff_v1',runId:'run',project:{id:'project',name:'Project',goal:'normal',requirements:'',workFolder:join(root,'project')},task:{id:'task',title:'normal'}}});
 const settled=running.then(()=>undefined,error=>error);await entered;controller.abort();release();
 try{const error=await settled;expect(error).toBeInstanceOf(AggregateError);expect(error.message).toBe('kswarm_handoff_cancellation_unconfirmed');expect(error.errors).toHaveLength(2);expect(error.errors[0]).toMatchObject({name:'AbortError'});expect(error.errors[1]).toBe(failure);expect(cancel).toHaveBeenCalledTimes(1);expect(providers).toBe(0);}finally{release();cancel.mockRestore();await services.closeTaskSourceWritersForMigration();await services.disposeMultiAgent();}
});
it('cancels an actual queued handoff before a later lane grant can dispatch it',async()=>{
 const {DesktopExecutionCoordinator}=await import('../../electron/desktop-execution-coordinator.js');
 const root=mkdtempSync(join(tmpdir(),'kswarm-refresh-queue-'));roots.push(root);process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const coordinator=new DesktopExecutionCoordinator({capacity:1,backgroundCapacity:1});
 const blocker=await coordinator.acquireLease({policy:'ordinary',lane:'background'});const controller=new AbortController();let providers=0;
 const services=createDesktopServices({dataRoot:join(root,'data'),executionCoordinator:coordinator,kswarmService:{getBaseUrl:()=> 'http://127.0.0.1:1',getDesktopMutationToken:()=> 'fixture',request:async()=>new Response('{}',{status:501})} as unknown as KSwarmService,runner:async()=>{providers++;}});
 const running=services.runKSwarmHandoffTask({signal:controller.signal,handoff:{kind:'kswarm_task_handoff_v1',runId:'run',project:{id:'project',name:'Project',goal:'normal',requirements:'',workFolder:join(root,'project')},task:{id:'task',title:'normal'}}});
 const settled=running.then(()=>undefined,error=>error);
 try{for(let i=0;i<100&&coordinator.snapshot().waiting===0;i++)await new Promise(r=>setTimeout(r,5));expect(coordinator.snapshot().waiting).toBe(1);controller.abort();const error=await settled;expect(error).toMatchObject({name:'AbortError'});blocker.release();await new Promise(r=>setTimeout(r,20));expect(providers).toBe(0);expect(coordinator.snapshot().waiting).toBe(0);}finally{blocker.release();await services.closeTaskSourceWritersForMigration();await services.disposeMultiAgent();}
});
it('waits for an actually held provider after logical cancellation before retiring its handoff',async()=>{
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 const root=mkdtempSync(join(tmpdir(),'kswarm-refresh-physical-'));roots.push(root);process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const controller=new AbortController();let enter!:()=>void,release!:()=>void,cancelled!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r),logical=new Promise<void>(r=>cancelled=r);let providers=0,finished=false;
 const services=createDesktopServices({dataRoot:join(root,'data'),kswarmService:{getBaseUrl:()=> 'http://127.0.0.1:1',getDesktopMutationToken:()=> 'fixture',request:async()=>new Response('{}',{status:501})} as unknown as KSwarmService,runner:async()=>{providers++;enter();await held;}});
 const original=InProcessTaskRuntimeHost.prototype.cancelTask;
 vi.spyOn(InProcessTaskRuntimeHost.prototype,'cancelTask').mockImplementation(async function(this:TaskHostInstance,...args:Parameters<typeof original>){const result=await original.apply(this,args);cancelled();return result;});
 const running=services.runKSwarmHandoffTask({signal:controller.signal,handoff:{kind:'kswarm_task_handoff_v1',runId:'run',project:{id:'project',name:'Project',goal:'normal',requirements:'',workFolder:join(root,'project')},task:{id:'task',title:'normal'}}});
 const settled=running.then(()=>{finished=true;return undefined;},error=>{finished=true;return error;});
 try{await entered;controller.abort();await logical;await new Promise(r=>setTimeout(r,20));expect(finished).toBe(false);expect(providers).toBe(1);release();expect(await settled).toMatchObject({name:'AbortError'});}finally{release();await settled;await services.closeTaskSourceWritersForMigration();await services.disposeMultiAgent();}
});
