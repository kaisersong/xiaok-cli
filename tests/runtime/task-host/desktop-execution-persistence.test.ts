import {FileTaskSnapshotStore,recoverTaskSnapshotSync} from '../../../src/runtime/task-host/snapshot-store.js';
import {buildHistoryFromTaskSnapshots} from '../../../src/runtime/task-host/task-runtime-host.js';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {DesktopTaskObservationStore,desktopObservationSessionId} from '../../../src/runtime/task-host/protected-observation-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
it('initializes only via real CAS and exposes one task-bound live store preserving full session facts',async()=>{
 const root=mkdtempSync(join(tmpdir(),'desktop-execution-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const sidecar=new DesktopTaskObservationStore(root);let current=true;
 const port=sidecar.getExecutionPersistence('task',()=>{if(!current)throw Error('execution expired');});const session=new AgentSessionState();const initial={...session.exportSnapshot(),sessionId:desktopObservationSessionId('task')};
 const authority=createSessionExecutionAuthority({root:port.root,sessionIdentity:initial.sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'task'})});cleanup.push(()=>authority.dispose());
 const tasks=new FileTaskSnapshotStore(root);const task={taskId:'task',sessionId:'business',status:'running' as const,prompt:'task',materials:[],events:[],createdAt:1,updatedAt:1};await tasks.save(task);
 const lease=await authority.acquire({invocationId:'init',kind:'compaction'});
 try{await port.initialize(initial,lease);}finally{await lease.releaseAfterDrain();}
 expect(await sidecar.readProtectionInWorker('task')).toEqual({closure:undefined,executionProtected:true});
 expect(await sidecar.read('task')).toBeUndefined();expect(sidecar.readSync('task')).toBeUndefined();
 const protectedTask=(await tasks.recoverTask('task'))!;expect(protectedTask.executionProtected).toBe(true);expect(protectedTask.protectedObservationClosure).toBeUndefined();expect(()=>buildHistoryFromTaskSnapshots([protectedTask])).toThrow('SOL_PI_PROTECTED_HISTORY_RESTORE_NOT_READY');
 await tasks.save(task);expect(recoverTaskSnapshotSync(root,'task')!.executionProtected).toBe(true);
 const loaded=(await port.store.load(initial.sessionId))!;expect(loaded.executionProtected).toBe(true);expect(loaded.storeRevision).toBe(1);
 await expect(port.store.load('other')).rejects.toThrow();
 const seen:number[]=[];const unsub=port.store.onCommit!(s=>{seen.push(s.storeRevision!);});
 const withMessage={...loaded,messages:[{role:'user' as const,content:[{type:'text' as const,text:'retained'}]}]};await sidecar.persistSession('task',withMessage);expect(seen).toEqual([2]);unsub();
 expect((await port.store.load(initial.sessionId))!.messages).toEqual(withMessage.messages);
 const closure={version:1 as const,requiresReauthorization:true as const,observations:[]};await sidecar.save('task',closure);const afterClosure=(await port.store.load(initial.sessionId))!;expect(afterClosure.messages).toEqual(withMessage.messages);const revision=afterClosure.storeRevision;await sidecar.save('task',closure);expect((await port.store.load(initial.sessionId))!.storeRevision).toBe(revision);
 current=false;await expect(port.store.load(initial.sessionId)).rejects.toThrow('execution expired');await expect(port.store.save(withMessage)).rejects.toThrow('execution expired');
});
it('does not reinterpret an old unmarked missing closure sidecar as initialized',async()=>{
 const root=mkdtempSync(join(tmpdir(),'desktop-old-sidecar-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'protected-observation-sessions');mkdirSync(path);const snapshot={...new AgentSessionState().exportSnapshot(),sessionId:desktopObservationSessionId('task'),schemaVersion:1};writeFileSync(join(path,snapshot.sessionId+'.json'),JSON.stringify(snapshot));const sidecar=new DesktopTaskObservationStore(root);await expect(sidecar.read('task')).rejects.toThrow();await expect(sidecar.readProtectionInWorker('task')).rejects.toMatchObject({code:'SOL_PI_PROTECTED_HISTORY_STORE_UNAVAILABLE'});expect(()=>sidecar.readSync('task')).toThrow();
});
it('actual task host issues a live incarnation port and never auto-repairs or reuses it after settlement',async()=>{
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');const {MaterialRegistry}=await import('../../../src/runtime/task-host/material-registry.js');
 const root=mkdtempSync(join(tmpdir(),'desktop-host-port-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const snapshots=new FileTaskSnapshotStore(join(root,'tasks'));let captured:ReturnType<DesktopTaskObservationStore['getExecutionPersistence']>|undefined;let calls=0;let gateCalls=0;
 const host=new InProcessTaskRuntimeHost({snapshotStore:snapshots,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),completionGate:async()=>{gateCalls++;throw Error('unexpected repair');},runner:async input=>{
  calls++;captured=input.executionPersistence!;const snapshot={...new AgentSessionState().exportSnapshot(),sessionId:desktopObservationSessionId(input.taskId)};const authority=createSessionExecutionAuthority({root:captured.root,sessionIdentity:snapshot.sessionId,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:input.taskId})});const lease=await authority.acquire({invocationId:'init',kind:'compaction'});
  try{await captured.initialize(snapshot,lease);}finally{await lease.releaseAfterDrain();authority.dispose();}
 }});
 const {taskId}=await host.createTask({prompt:'Short bounded answer',materials:[]});await host.drain();expect(calls).toBe(1);expect(gateCalls).toBe(0);expect(captured).toBeDefined();await expect(captured!.store.load(desktopObservationSessionId(taskId))).rejects.toThrow('SOL_PI_DESKTOP_EXECUTION_EXPIRED');expect((await snapshots.recoverTask(taskId))!.executionProtected).toBe(true);
});
