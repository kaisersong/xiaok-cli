// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {DatabaseSync} from 'node:sqlite';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {TaskContinuitySource} from '../../electron/context-continuity/task-source.js';
import {effectSnapshotHash} from '../../electron/context-continuity/store.js';
import {DesktopContextContinuity} from '../../electron/context-continuity/runtime.js';
import type {TaskSnapshot} from '../../shared/task-types.js';
const kswarmService={getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never;
it('audits durable inventory instead of accepting a cached checkpoint after disk corruption',async()=>{
 const root=mkdtempSync(join(tmpdir(),'effect-inventory-corrupt-')),store=new FileTaskSnapshotStore(root),snapshot={taskId:'task_corrupt',sessionId:'epoch',status:'completed',events:[],context:{threadId:'thread'},prompt:'fixture',materials:[],createdAt:1,updatedAt:2} as unknown as TaskSnapshot;
 try{await store.save(snapshot);await store.recoverTask(snapshot.taskId);writeFileSync(join(root,'snapshots','task_corrupt.json'),'{corrupt');await expect(store.inspectPersistedInventory()).rejects.toThrow();}finally{rmSync(root,{recursive:true,force:true});}
});
it('keeps deletion closed before a lazy inventory audit has completed and after it fails',async()=>{
 const root=mkdtempSync(join(tmpdir(),'effect-inventory-pending-')),runtime=new DesktopContextContinuity(root);
 try{runtime.requireEffectInventory();expect(()=>runtime.assertConversationDeletionSafe('thread')).toThrow('blocked_unsettled');await expect(runtime.auditEffectInventory(async()=>{throw new Error('disk_failed');},false)).rejects.toThrow('disk_failed');expect(()=>runtime.assertConversationDeletionSafe('thread')).toThrow('blocked_unsettled');}finally{await runtime.close();rmSync(root,{recursive:true,force:true});}
});
it('continues a qualified pure-text legacy thread after restart using the full owner receipt',async()=>{
 const root=mkdtempSync(join(tmpdir(),'effect-inventory-pure-'));let histories:unknown[]=[];
 const runner=async(input:any)=>{histories.push(input.history);await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'test',stepId:'test',note:JSON.stringify({summary:'answer',artifacts:[]})});};
 let main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService,runner});
 try{const first=await main.createTask({prompt:'first',materials:[],context:{threadId:'unadopted'}});await vi.waitFor(()=>expect(main.continuity.port().service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(first.taskId)).toBeTruthy());const original=await main.recoverTask(first.taskId),port=main.continuity.port();expect(port.service.store.db.prepare('SELECT 1 FROM source_settlements WHERE task_id=?').get(first.taskId)).toBeUndefined();expect(()=>port.service.assertHistorySourceClosed(first.taskId,original.snapshot)).not.toThrow();await main.disposeMultiAgent();main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService,runner});await main.createTask({prompt:'continue',materials:[],context:{threadId:'unadopted',taskIds:[first.taskId]}});await vi.waitFor(()=>expect(histories).toHaveLength(2));expect(JSON.stringify(histories[1])).toContain('answer');expect(main.continuity.port().service.store.db.prepare('SELECT 1 FROM unproven_effects').get()).toBeUndefined();}finally{await main.disposeMultiAgent();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});

it('retains unadopted history ancestry through later archive claims and source message deletion',async()=>{
 const root=mkdtempSync(join(tmpdir(),'effect-inventory-ancestry-'));
 const main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService,runner:async input=>{await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'test',stepId:'test',note:JSON.stringify({summary:input.history?.length?'derived canary':'source canary',artifacts:[]})});}});
 try{
  const p=main.continuity.port(),ids:string[]=[];
  for(let i=0;i<3;i++){const task=await main.createTask({prompt:`turn ${i}`,materials:[],context:{threadId:'unadopted',...(ids.length?{taskIds:[ids.at(-1)!]}:{})}});ids.push(task.taskId);await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(task.taskId)).toBeTruthy());}
  const preview=await p.importer!.preview({operationId:'preview',legacyThreadId:'unadopted',taskIds:ids});const c=await p.importer!.claim({operationId:'claim',previewId:preview.previewId,expectedManifestHash:preview.manifestHash});
  const messages=p.service.listMessages(p.actor,c.id),source=messages.find(m=>m.sourceId===ids[0]&&m.role==='assistant')!,derived=messages.find(m=>m.sourceId===ids[2]&&m.role==='assistant')!;
  const ref=p.service.createReference(p.actor,{conversationId:c.id,expectedRevision:p.service.getConversation(p.actor,c.id)!.revision,firstMessageId:derived.messageId,lastMessageId:derived.messageId,operationId:'derived-ref'});
  expect(p.service.resolveReference(p.actor,{refId:ref.refId}).messages[0].text).toBe('derived canary');
  p.service.deleteMessage(p.actor,{conversationId:c.id,messageId:source.messageId});
  await expect(main.recoverTask(ids[2])).rejects.toThrow('not_readable');
  expect(()=>p.service.resolveReference(p.actor,{refId:ref.refId})).toThrow('not_readable');
 }finally{await main.disposeMultiAgent();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});

it.each(['prompt','result'] as const)('rejects changed legacy %s despite unchanged event cursor after restart',async field=>{
 const root=mkdtempSync(join(tmpdir(),'effect-inventory-body-'));let calls=0;
 const runner=async(input:any)=>{calls++;await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'test',stepId:'test',note:JSON.stringify({summary:'owner result',artifacts:[]})});};
 let main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService,runner});
 try{
  const first=await main.createTask({prompt:'owner prompt',materials:[],context:{threadId:'unadopted'}});await vi.waitFor(()=>expect(main.continuity.port().service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(first.taskId)).toBeTruthy());await main.disposeMultiAgent();
  const path=join(root,'tasks','snapshots',first.taskId+'.json'),snapshot=JSON.parse(readFileSync(path,'utf8')),events=JSON.stringify(snapshot.events);
  if(field==='prompt')snapshot.prompt='unproven prompt canary';else snapshot.result={...snapshot.result,summary:'unproven result canary'};
  writeFileSync(path,JSON.stringify(snapshot));const actual=await new FileTaskSnapshotStore(join(root,'tasks')).recoverTask(first.taskId);expect(JSON.stringify(actual!.events)).toBe(events);expect(field==='prompt'?actual!.prompt:actual!.result!.summary).toContain('unproven');
  main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService,runner});const before=calls;await expect(main.createTask({prompt:'continue',materials:[],context:{threadId:'unadopted',taskIds:[first.taskId]}})).rejects.toThrow('blocked_unsettled');expect(calls).toBe(before);
 }finally{await main.disposeMultiAgent();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});

it('withdraws v1 body-incomplete proofs and a real rejected-start finalizer cannot re-sign them',async()=>{
 const root=mkdtempSync(join(tmpdir(),'effect-proof-upgrade-'));let runtime=new DesktopContextContinuity(root);
 const store=new FileTaskSnapshotStore(join(root,'tasks')),p=runtime.port(),c=p.service.createConversation(p.actor,{operationId:'c'}),source=new TaskContinuitySource(p.service,p.actor),snapshot={taskId:'task_old_receipt',sessionId:'epoch',prompt:'owner prompt',status:'completed',context:{threadId:c.id},events:[],materials:[],createdAt:1,updatedAt:2} as TaskSnapshot;
 try{
  await store.save(snapshot);await source.bindPrepared({conversationId:c.id,taskId:snapshot.taskId,publicPrompt:snapshot.prompt},async()=>snapshot);source.capture(snapshot,{physicallySettled:true});await runtime.close();
  const old=new DatabaseSync(join(root,'continuity.sqlite'));try{old.exec("ALTER TABLE effect_owner_receipts DROP COLUMN snapshot_hash; UPDATE guarded_effect_runs SET policy=1; DELETE FROM continuity_meta WHERE key='effectReceiptPolicy'");}finally{old.close();}
  runtime=new DesktopContextContinuity(root);const after=runtime.port();expect(after.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts').get()).toBeUndefined();expect(after.service.store.db.prepare('SELECT 1 FROM source_settlements').get()).toBeUndefined();
  const finalized=vi.fn((value:TaskSnapshot)=>runtime.capture(value,{physicallySettled:true})),runner=vi.fn(async()=>{}),host=new InProcessTaskRuntimeHost({snapshotStore:store,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace')}),runner,assertTaskAdmission:()=>{throw new Error('admission_denied');},onExecutionSettled:finalized});
  await expect(host.startTask(snapshot.taskId)).rejects.toThrow('admission_denied');await host.drain();expect(finalized).toHaveBeenCalledOnce();expect(runner).not.toHaveBeenCalled();expect(after.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts').get()).toBeUndefined();expect(after.service.store.db.prepare('SELECT 1 FROM source_settlements').get()).toBeUndefined();expect(()=>after.service.assertHistorySourceClosed(snapshot.taskId,snapshot)).toThrow('blocked_unsettled');expect(()=>after.service.registerGuardedRun(after.actor,snapshot.taskId,snapshot.sessionId)).toThrow('blocked_reconciliation');
 }finally{await runtime.close();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
it('normalizes durable JSON key order and never rewrites an existing owner proof for changed content',async()=>{
 const root=mkdtempSync(join(tmpdir(),'effect-proof-immutable-')),runtime=new DesktopContextContinuity(root),p=runtime.port(),snapshot={taskId:'task_immutable',sessionId:'epoch',prompt:'owner',status:'completed',events:[],materials:[],createdAt:1,updatedAt:2,context:{threadId:'legacy',loadedTaskIds:[]}} as TaskSnapshot;
 try{const reordered=Object.fromEntries(Object.entries(snapshot).reverse()) as unknown as TaskSnapshot;expect(effectSnapshotHash(snapshot)).toBe(effectSnapshotHash(reordered));p.service.registerGuardedRun(p.actor,snapshot.taskId,snapshot.sessionId);expect(p.service.recordEffectOwnerReceipt(p.actor,snapshot)).toBe(true);expect(()=>p.service.recordEffectOwnerReceipt(p.actor,{...snapshot,prompt:'changed'})).toThrow('blocked_reconciliation');expect(()=>p.service.assertHistorySourceClosed(snapshot.taskId,snapshot)).not.toThrow();expect(()=>p.service.assertHistorySourceClosed(snapshot.taskId,{...snapshot,prompt:'changed'})).toThrow('blocked_unsettled');}finally{await runtime.close();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});

it.each(['missing-receipt','changed-body'] as const)('blocks real restart deletion when policy2 has %s instead of an exact closure proof',async fault=>{
 const root=mkdtempSync(join(tmpdir(),'effect-inventory-crash-'));
 let main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService,runner:async input=>{await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'test',stepId:'test',note:JSON.stringify({summary:'owner result',artifacts:[]})});}});
 try{
  const p=main.continuity.port(),c=p.service.createConversation(p.actor,{operationId:'target'});
  // Inject a crash-state at the actual owner receipt commit; no synthetic terminal snapshot.
  const receipt=fault==='missing-receipt'?vi.spyOn(p.service,'recordEffectOwnerReceipt').mockReturnValue(false):undefined;
  const task=await main.createTask({prompt:'owner prompt',materials:[],context:{threadId:c.id}});
  await vi.waitFor(async()=>expect((await main.recoverTask(task.taskId)).snapshot.status).toBe('completed'));
  if(receipt)await vi.waitFor(()=>expect(receipt).toHaveBeenCalled());else await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(task.taskId)).toBeTruthy());
  expect(p.service.store.db.prepare('SELECT policy FROM guarded_effect_runs WHERE task_id=?').get(task.taskId)?.policy).toBe(2);
  if(receipt)expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(task.taskId)).toBeUndefined();
  receipt?.mockRestore();await main.disposeMultiAgent();
  if(fault==='changed-body'){const path=join(root,'tasks','snapshots',task.taskId+'.json'),snapshot=JSON.parse(readFileSync(path,'utf8'));snapshot.result={...snapshot.result,summary:'unproven changed body'};writeFileSync(path,JSON.stringify(snapshot));}
  main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService});await main.multiAgent!.ready;const m=main.multiAgent!;m.service.registerThread({threadId:c.id,profileId:m.profileId,workspaceId:m.workspaceId,cwd:m.cwd});
  const access=m.service.createUserAccess({requestSource:'user',actorId:`desktop-user:${m.profileId}`,profileId:m.profileId,workspaceId:m.workspaceId,threadId:c.id}),before=m.service.readThreadDeletion({access});
  const result=await m.service.deleteThread({access,requestSource:'user',confirmTerminate:true,expectedThreadRevision:before.threadRevision,operationId:`delete:${before.threadRevision}:receipt-crash`});
  expect(result.state).not.toBe('completed');
  expect(main.continuity.port().service.store.db.prepare('SELECT 1 FROM unproven_effects WHERE task_id=?').get(task.taskId)).toBeTruthy();
  expect(main.continuity.port().service.store.db.prepare('SELECT deleted FROM conversations WHERE id=?').get(c.id)?.deleted).toBe(0);
 }finally{await main.disposeMultiAgent();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
