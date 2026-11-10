// @vitest-environment node
import { afterEach,beforeEach,expect,it } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { TaskContinuitySource } from '../../electron/context-continuity/task-source.js';
import type { TaskSnapshot } from '../../shared/task-types.js';
import { digest } from '../../electron/context-continuity/store.js';
const actor={requestSource:'user' as const,profileId:'p',actorId:'desktop-user:p'};
let root:string,service:ContinuityService;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'native-policy-'));service=new ContinuityService({dbPath:join(root,'store.sqlite'),profileId:'p'});});
afterEach(()=>{service.close();rmSync(root,{recursive:true,force:true});});
async function fixture(){
 const source=service.createConversation(actor,{operationId:'source'}),target=service.createConversation(actor,{operationId:'target'});
 service.recordMessage(actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'task_private',sourceDataEpoch:'e',sourceMessageId:'m',sourceRevision:1,role:'assistant',text:'private',executionState:'settled'});
 const ref=service.createReference(actor,{conversationId:source.id,expectedRevision:service.getConversation(actor,source.id)!.revision,operationId:'ref'});
 service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'grant'});
 const projection=new TaskContinuitySource(service,actor);
 const snapshot=(taskId:string,status='completed')=>({taskId,sessionId:`session_${taskId}`,prompt:'work',status,context:{threadId:target.id},events:[],createdAt:1,updatedAt:2,materials:[]}) as TaskSnapshot;
 for(const taskId of ['task_A','task_B']){const s=snapshot(taskId);await projection.bindPrepared({conversationId:target.id,taskId,publicPrompt:'work'},async()=>s);projection.capture(s,{physicallySettled:true});}
 await projection.bindPrepared({conversationId:target.id,taskId:'task_native',publicPrompt:'next',sourceKind:'native_codex'},async()=>snapshot('task_native','running'));
 return {target,ref,projection,snapshot};
}
it('refuses direct, transitive and warm-route revocable context before native admission',async()=>{
 const f=await fixture();service.resolveReference({...actor,requestSource:'agent',taskId:'task_A'},{refId:f.ref.refId});
 service.recordSourceTasks(actor,'task_B',['task_A']);
 for(const sources of [['task_A'],['task_B'],['task_A','task_native']])expect(()=>service.acquireNativeContext(actor,'task_native',sources)).toThrow('native_revocable_context_unsupported');
 expect(service.store.db.prepare('SELECT * FROM native_context_fences').all()).toEqual([]);
});
it('holds a durable source closure against late child/reference/history/mailbox dependency growth and retains unknown barriers after restart',async()=>{
 const f=await fixture();service.recordSourceTasks(actor,'task_B',['task_A']);service.acquireNativeContext(actor,'task_native',['task_B']);
 expect(()=>service.resolveReference({...actor,requestSource:'agent',taskId:'task_A'},{refId:f.ref.refId})).toThrow('native_context_frozen');
 expect(()=>service.recordSourceTasks(actor,'task_A',['task_B'])).toThrow('native_context_frozen');
 expect(()=>service.recordHistory(actor,'task_A',[f.snapshot('task_B')])).toThrow('native_context_frozen');
 service.close();service=new ContinuityService({dbPath:join(root,'store.sqlite'),profileId:'p'});
 expect(()=>service.resolveReference({...actor,requestSource:'agent',taskId:'task_A'},{refId:f.ref.refId})).toThrow('native_context_frozen');
 expect(service.store.db.prepare('SELECT ref_id FROM context_dependencies').all()).toEqual([]);
});
it('does not release a native source fence for a bounded parent turn receipt without execution closure proof',async()=>{
 const f=await fixture();service.acquireNativeContext(actor,'task_native',['task_A']);
 const message=service.listMessages(actor,f.target.id).find(m=>m.sourceId==='task_A')!;
 expect(()=>service.deleteMessage(actor,{conversationId:f.target.id,messageId:message.messageId})).toThrow('blocked_unsettled');
 expect(()=>service.tombstoneConversation(actor,f.target.id)).toThrow('blocked_unsettled');
 expect(service.getConversation(actor,f.target.id)).not.toBeNull();
 const terminal=f.snapshot('task_native','cancelled');expect(()=>f.projection.capture(terminal,{physicallySettled:true})).toThrow('native_settlement_unavailable');
 expect(()=>service.deleteMessage(actor,{conversationId:f.target.id,messageId:message.messageId})).toThrow('blocked_unsettled');
 expect(()=>f.projection.capture(terminal,{physicallySettled:true,sourceEpoch:terminal.sessionId,eventCount:0,prefixHash:digest([])})).toThrow('native_settlement_unavailable');
 expect(()=>service.deleteMessage(actor,{conversationId:f.target.id,messageId:message.messageId})).toThrow('blocked_unsettled');
 expect(()=>service.tombstoneConversation(actor,f.target.id)).toThrow('blocked_unsettled');
});
