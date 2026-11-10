// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const actor={requestSource:'user' as const,profileId:'current-owner-profile',actorId:'desktop-user:current-owner-profile'};
async function withService(run:(service:any)=>void|Promise<void>){
 const {ContinuityService}=await import('../../electron/context-continuity/service.js');
 const root=mkdtempSync(join(tmpdir(),'continuity-current-owner-'));let service:any;
 try{service=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:actor.profileId});await run(service);}
 finally{if(service)service.close();rmSync(root,{recursive:true,force:true});}
}
it('persists actual Main continuity conversations without granting agent or scheduler mutation',async()=>{
 await withService(service=>{const c=service.createConversation(actor,{operationId:'create',title:'current owner'});expect(service.getConversation(actor,c.id)).toMatchObject({id:c.id,title:'current owner'});
 for(const requestSource of ['agent','scheduler'])expect(()=>service.createConversation({...actor,requestSource,taskId:'forged'},{operationId:'denied'})).toThrow();
 expect(service.listConversations(actor)).toHaveLength(1);});
});
it('checks original reference reply identity and refuses forged copies or another profile',async()=>{
 await withService(service=>{const c=service.createConversation(actor,{operationId:'create'});service.recordMessage(actor,{conversationId:c.id,sourceKind:'desktop_task',sourceId:'source',sourceDataEpoch:'epoch',sourceMessageId:'message',sourceRevision:1,role:'user',text:'original',executionState:'settled'});
 const reference=service.createReference(actor,{conversationId:c.id,expectedRevision:service.getConversation(actor,c.id).revision,operationId:'reference'}),input={refId:reference.refId},page=service.resolveReference(actor,input);service.assertReferenceCurrent(page,actor,input);
 expect(()=>service.assertReferenceCurrent(structuredClone(page),actor,input)).toThrow();expect(()=>service.resolveReference({...actor,profileId:'other'},input)).toThrow();});
});
it('keeps Native execution unavailable in the actual runtime with all qualification flags false',async()=>{
 const {DesktopContextContinuity}=await import('../../electron/context-continuity/runtime.js');const root=mkdtempSync(join(tmpdir(),'continuity-current-runtime-'));
 const runtime=new DesktopContextContinuity(root,undefined,null);try{expect(()=>runtime.assertNativeExecutionAvailable()).toThrow();}finally{await runtime.close();rmSync(root,{recursive:true,force:true});}
});
it('binds a fixed pending input reservation to the actual Host rather than copied identity',async()=>{
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');const {MaterialRegistry}=await import('../../../src/runtime/task-host/material-registry.js');
 const root=mkdtempSync(join(tmpdir(),'continuity-current-host-'));const store=new FileTaskSnapshotStore(join(root,'tasks'));const materialRegistry=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024});
 const host=new InProcessTaskRuntimeHost({snapshotStore:store,materialRegistry,runner:async()=>{}});
 try{const reservation=host.reserveTaskIdentity();expect(reservation.sessionId).toEqual(expect.any(String));host.assertInputOwnerDependencies(store,materialRegistry);await expect(host.bindPendingInputIdentity('forged',{...reservation})).rejects.toThrow();}
 finally{await host.drain();rmSync(root,{recursive:true,force:true});}
});

it('denies a changed journal revision before the actual first snapshot write and keeps cancellation reachable',async()=>{
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');const {MaterialRegistry}=await import('../../../src/runtime/task-host/material-registry.js');
 const root=mkdtempSync(join(tmpdir(),'continuity-current-pending-')),store=new FileTaskSnapshotStore(join(root,'tasks')),materials=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024});
 let current:{taskId:string;sessionId:string;revision:string}|null=null,revoked=false;
 const host=new InProcessTaskRuntimeHost({snapshotStore:store,materialRegistry:materials,runner:async()=>{},readPendingInputIdentity:()=>current,
  authorizeInputPreparation:()=>{if(revoked)throw Error('actual_revoked');},authorizeInputAdmission:()=>{if(revoked)throw Error('actual_revoked');}});
 try{
  const reservation=host.reserveTaskIdentity();current={taskId:reservation.taskId,sessionId:reservation.sessionId!,revision:'revision-one'};await host.bindPendingInputIdentity('input',reservation);
  current={...current,revision:'revision-two'};
  await expect(host.prepareReservedTask({prompt:'original',materials:[]},reservation)).rejects.toThrow('input_authority_changed');
  expect(await store.inspectPersistedTask(reservation.taskId)).toBeNull();
  const second=host.reserveTaskIdentity();current={taskId:second.taskId,sessionId:second.sessionId!,revision:'second'};await host.bindPendingInputIdentity('second',second);
  const prepared=await host.prepareReservedTask({prompt:'original',materials:[]},second);expect((await store.inspectPersistedTask(prepared.taskId))?.inputPreparation).toEqual({inputId:'second',inputRevision:'second'});
  const committed=host.readContinuitySourceSnapshot(prepared.taskId)!;expect(committed.sessionId).toBe(second.sessionId);committed.prompt='forged';expect(host.readContinuitySourceSnapshot(prepared.taskId)?.prompt).toBe('original');
  revoked=true;await expect(host.startTask(prepared.taskId)).rejects.toThrow('actual_revoked');await host.cancelTask(prepared.taskId,'user_cancelled');
 }finally{await host.drain();rmSync(root,{recursive:true,force:true});}
});
it('refuses a reservation from a different actual Host and rejects a forged settlement DTO',async()=>{
 const {InProcessTaskRuntimeHost,readOriginalTaskExecutionContinuityFate}=await import('../../../src/runtime/task-host/task-runtime-host.js');const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');const {MaterialRegistry}=await import('../../../src/runtime/task-host/material-registry.js');
 const root=mkdtempSync(join(tmpdir(),'continuity-cross-host-')),store=new FileTaskSnapshotStore(join(root,'tasks')),materials=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024});
 const a=new InProcessTaskRuntimeHost({snapshotStore:store,materialRegistry:materials,runner:async()=>{}}),b=new InProcessTaskRuntimeHost({snapshotStore:store,materialRegistry:materials,runner:async()=>{}});
 try{await expect(b.bindPendingInputIdentity('input',a.reserveTaskIdentity())).rejects.toThrow();expect(()=>readOriginalTaskExecutionContinuityFate(a,store,'forged','session',{taskId:'forged'} as any)).toThrow();}
 finally{await a.drain();await b.drain();rmSync(root,{recursive:true,force:true});}
});
it('preserves bare undefined from the actual SDK callback without inventing a known success',async()=>{
 const {ContinuitySdkCustody}=await import('../../electron/context-continuity/sdk-custody.js');const sdk=new ContinuitySdkCustody();let rejected=false,cause:unknown='sentinel';
 try{await sdk.invoke(()=>{throw undefined;},undefined,[]);}catch(raw){rejected=true;cause=raw;}
 expect(rejected).toBe(true);expect(cause).toBeUndefined();await sdk.waitKnown();
});
it('inventories symbol callback tails without invoking accessors or washing the unknown during close',async()=>{
 const {ContinuitySdkCustody}=await import('../../electron/context-continuity/sdk-custody.js');const sdk=new ContinuitySdkCustody();let getterCalls=0,bodyCalls=0;
 const fn=()=>{bodyCalls++;return 'value';};Object.defineProperty(fn,Symbol('tail'),{get(){getterCalls++;return 'secret';}});
 try{await sdk.invoke(fn,undefined,[]);}catch{/* Fixed SDK rejects/retains the original metadata graph. */}
 expect(getterCalls).toBe(0);await expect(sdk.waitKnown()).rejects.toThrow();expect(bodyCalls).toBeLessThanOrEqual(1);
});
it('rechecks the real Goal tool result after await and after JSON projection',async()=>{
 const {createGoalTools}=await import('../../../src/ai/tools/goal.js');let readable=true;const original=Error('reference_revoked');
 const tool=createGoalTools({getGoal:async()=>{readable=false;return {objective:'private'};},assertReadCurrent:()=>{if(!readable)throw original;},requestComplete:async()=>({accepted:true}),requestBlocked:async()=>({accepted:true})})[0]!;
 await expect(tool.execute({})).rejects.toBe(original);
 readable=true;const late=createGoalTools({getGoal:()=>({toJSON(){readable=false;return {objective:'private'};}}),assertReadCurrent:()=>{if(!readable)throw original;},requestComplete:async()=>({accepted:true}),requestBlocked:async()=>({accepted:true})})[0]!;
 await expect(late.execute({})).rejects.toBe(original);
});

it.each(['getter','proxy'])('sync SDK return is denied before an unknown %s result can be projected',async kind=>{
 const {ContinuitySdkCustody}=await import('../../electron/context-continuity/sdk-custody.js');const sdk=new ContinuitySdkCustody();let traps=0;
 const value=kind==='proxy'?new Proxy({},{get(){traps++;return 'private';},ownKeys(){traps++;return [];},getOwnPropertyDescriptor(){traps++;return undefined;}}):Object.defineProperty(Object.create(null),'private',{get(){traps++;return 'private';}});
 expect(()=>sdk.invokeSync(()=>value,undefined,[])).toThrow();expect(traps).toBe(0);await expect(sdk.waitKnown()).rejects.toThrow();
});
