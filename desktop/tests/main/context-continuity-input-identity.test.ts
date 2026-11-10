// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
function fixture(extra:Record<string,unknown>={}){const root=mkdtempSync(join(tmpdir(),'input-identity-'));roots.push(root);const store=new FileTaskSnapshotStore(join(root,'tasks')),host=new InProcessTaskRuntimeHost({snapshotStore:store,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024}),runner:vi.fn(async()=>{}),...extra});return {root,store,host};}
const input={prompt:'original input',materials:[]},marker={groupId:'group',rootEpoch:1,rootTurnId:'turn',preparationId:'preparation',bootId:'boot'};
it('allocates source epoch before input acceptance and consumes that exact epoch once',async()=>{
 let identity:any;const inputGate=vi.fn(),f=fixture({readPendingInputIdentity:()=>identity,authorizeInputPreparation:inputGate});const reservation=f.host.reserveTaskIdentity();
 expect((reservation as any).sessionId).toBeTruthy();identity={taskId:reservation.taskId,sessionId:(reservation as any).sessionId,revision:'pending-1'};
 await f.host.bindPendingInputIdentity('input-1',reservation);const task=await f.host.prepareTask(input,{reservation} as any);
 expect((await f.store.recoverTask(task.taskId))?.sessionId).toBe((reservation as any).sessionId);expect(inputGate).toHaveBeenCalled();await expect(f.host.prepareTask(input,{reservation} as any)).rejects.toThrow(/reservation/);
});
it('a linked input cannot bypass ledger authorization through the existing MA marker branch',async()=>{
 let identity:any,valid=true;const maGate=vi.fn(),inputGate=vi.fn(()=>{if(!valid)throw new Error('input_claim_revoked');});const f=fixture({authorizePreparation:maGate,readPendingInputIdentity:()=>identity,authorizeInputPreparation:inputGate});const reservation=f.host.reserveTaskIdentity();identity={taskId:reservation.taskId,sessionId:(reservation as any).sessionId,revision:'pending-1'};await f.host.bindPendingInputIdentity('input-1',reservation);valid=false;
 await expect(f.host.prepareTask(input,{reservation,marker})).rejects.toThrow('input_claim_revoked');expect(await f.store.recoverTask(reservation.taskId)).toBeNull();
});
it('a linked input with valid claim still needs the actual MA marker authority',async()=>{
 let identity:any;const maGate=vi.fn(()=>{throw new Error('ma_binding_missing');}),inputGate=vi.fn();const f=fixture({authorizePreparation:maGate,readPendingInputIdentity:()=>identity,authorizeInputPreparation:inputGate});const reservation=f.host.reserveTaskIdentity();identity={taskId:reservation.taskId,sessionId:(reservation as any).sessionId,revision:'pending-1'};await f.host.bindPendingInputIdentity('input-1',reservation);
 await expect(f.host.prepareTask(input,{reservation,marker})).rejects.toThrow('ma_binding_missing');expect(await f.store.recoverTask(reservation.taskId)).toBeNull();
});
it('restores only an actual current pending owner identity, without accepting caller-selected IDs',async()=>{
 const identity={taskId:'task_pending',sessionId:'source_pending',revision:'pending-1'},f=fixture({readPendingInputIdentity:()=>identity,authorizeInputPreparation:()=>{}});
 const reservation=await (f.host as any).restorePendingInputIdentity('input-1');expect(reservation).toMatchObject({taskId:identity.taskId,sessionId:identity.sessionId});
 await expect(f.host.prepareTask(input,{reservation:{...reservation}} as any)).rejects.toThrow(/reservation/);const task=await f.host.prepareTask(input,{reservation} as any);expect((await f.store.recoverTask(task.taskId))?.sessionId).toBe(identity.sessionId);
});
it.each(['json','journal.jsonl'])('never overwrites an existing/corrupt %s even when a new ID generator collides',async suffix=>{
 const f=fixture({createTaskId:()=> 'task_collision'}),path=join(f.root,'tasks','snapshots',`task_collision.${suffix}`);mkdirSync(join(f.root,'tasks','snapshots'),{recursive:true});writeFileSync(path,'PRIVATE_OLD_BYTES');
 await expect(f.host.prepareTask(input)).rejects.toThrow('task_identity_conflict');expect(readFileSync(path,'utf8')).toBe('PRIVATE_OLD_BYTES');
});
it('two actual hosts sharing the same task files cannot create the same task identity twice',async()=>{
 const f=fixture({createTaskId:()=> 'task_concurrent'}),other=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(f.root,'tasks')),materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'materials'),maxBytes:1024}),runner:async()=>{},createTaskId:()=> 'task_concurrent'});
 const results=await Promise.allSettled([f.host.prepareTask({...input,prompt:'first'}),other.prepareTask({...input,prompt:'second'})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);const original=(await f.store.inspectPersistedInventory())[0];expect(['first','second']).toContain(original.prompt);
});
it('the same Host refuses concurrent prepare collisions before its initial checkpoint commit',async()=>{
 const f=fixture({createTaskId:()=> 'task_concurrent'}),results=await Promise.allSettled([f.host.prepareTask(input),f.host.prepareTask(input)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
});
it('restore refuses an orphan journal rather than treating missing checkpoint as absence',async()=>{
 const identity={taskId:'task_pending',sessionId:'source_pending',revision:'pending-1'},f=fixture({readPendingInputIdentity:()=>identity,authorizeInputPreparation:()=>{}});mkdirSync(join(f.root,'tasks','snapshots'),{recursive:true});writeFileSync(join(f.root,'tasks','snapshots','task_pending.journal.jsonl'),'orphan');
 await expect((f.host as any).restorePendingInputIdentity('input-1')).rejects.toThrow('task_identity_conflict');
});
it('rechecks the input owner after checkpoint IO before publishing preparation',async()=>{
 let identity:any,valid=true;const published=vi.fn(),f=fixture({readPendingInputIdentity:()=>identity,authorizeInputPreparation:()=>{if(!valid)throw new Error('input_claim_revoked');},onPreparedSnapshot:published}),reservation=f.host.reserveTaskIdentity();identity={taskId:reservation.taskId,sessionId:reservation.sessionId,revision:'pending-1'};await f.host.bindPendingInputIdentity('input-1',reservation);
 const create=f.store.createTaskSnapshot.bind(f.store);vi.spyOn(f.store,'createTaskSnapshot').mockImplementation(async snapshot=>{await create(snapshot);valid=false;});
 await expect(f.host.prepareTask(input,{reservation})).rejects.toThrow('input_claim_revoked');expect(published).not.toHaveBeenCalled();expect(await f.store.recoverTask(reservation.taskId)).not.toBeNull();
});
it('refuses execution while actual preparation is publishing',async()=>{
 let identity:any,release!:()=>void,entered!:()=>void;const blocked=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r),runner=vi.fn(async()=>{}),f=fixture({runner,readPendingInputIdentity:()=>identity,authorizeInputPreparation:()=>{},onPreparedSnapshot:async()=>{entered();await blocked;}}),reservation=f.host.reserveTaskIdentity();identity={taskId:reservation.taskId,sessionId:reservation.sessionId,revision:'pending-1'};await f.host.bindPendingInputIdentity('input-1',reservation);const preparing=f.host.prepareTask(input,{reservation});await ready;
 try{await expect(f.host.startTask(reservation.taskId)).rejects.toThrow('task_preparation_incomplete');expect(runner).not.toHaveBeenCalled();}finally{release();await preparing;await f.host.drain();}
});
it('cannot return valid preparation after owner revocation in publication',async()=>{
 let identity:any,valid=true;const f=fixture({readPendingInputIdentity:()=>identity,authorizeInputPreparation:()=>{if(!valid)throw new Error('input_claim_revoked');},onPreparedSnapshot:()=>{valid=false;}}),reservation=f.host.reserveTaskIdentity();identity={taskId:reservation.taskId,sessionId:reservation.sessionId,revision:'pending-1'};await f.host.bindPendingInputIdentity('input-1',reservation);
 await expect(f.host.prepareTask(input,{reservation})).rejects.toThrow('input_claim_revoked');
});
it('one genuine reservation cannot acquire two concurrent input origins',async()=>{
 let identity:any;const f=fixture({readPendingInputIdentity:()=>identity,authorizeInputPreparation:()=>{}}),reservation=f.host.reserveTaskIdentity();identity={taskId:reservation.taskId,sessionId:reservation.sessionId,revision:'pending-1'};const results=await Promise.allSettled([f.host.bindPendingInputIdentity('input-1',reservation),f.host.bindPendingInputIdentity('input-2',reservation)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
it('persisted input tasks deny execution without the actual input admission owner',async()=>{
 let identity:any;const runner=vi.fn(async()=>{}),f=fixture({runner,readPendingInputIdentity:()=>identity,authorizeInputPreparation:()=>{}}),reservation=f.host.reserveTaskIdentity();identity={taskId:reservation.taskId,sessionId:reservation.sessionId,revision:'pending-1'};await f.host.bindPendingInputIdentity('input-1',reservation);await f.host.prepareTask(input,{reservation});const other=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(f.root,'tasks')),materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'materials'),maxBytes:1024}),runner});await expect(other.startTask(reservation.taskId)).rejects.toThrow('input_admission_unavailable');await other.drain();expect(runner).not.toHaveBeenCalled();
});
it('the last actual no-runner cancellation owns one physical settlement for a concurrent cohort',async()=>{
 const settled=vi.fn(),f=fixture({onExecutionSettled:settled}),task=await f.host.prepareTask(input);await Promise.all([f.host.cancelTask(task.taskId),f.host.cancelTask(task.taskId)]);expect(settled).toHaveBeenCalledOnce();expect(settled.mock.calls[0]?.[0].status).toBe('cancelled');
});
it('no-runner cancellation waits for the original preparation IO before its physical observer',async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r),settled=vi.fn(),f=fixture({createTaskId:()=> 'task_preparing',onExecutionSettled:settled,onPreparedSnapshot:async()=>{entered();await gate;}}),preparing=f.host.prepareTask(input);await ready;let cancelReturned=false;const cancelled=f.host.cancelTask('task_preparing').then(()=>{cancelReturned=true;});await new Promise(r=>setImmediate(r));expect(settled).not.toHaveBeenCalled();expect(cancelReturned).toBe(false);release();await preparing;await cancelled;expect(settled).toHaveBeenCalledOnce();
});
