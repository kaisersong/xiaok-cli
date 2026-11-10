// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContinuityService } from '../../electron/context-continuity/service.js';
const user={requestSource:'user' as const,profileId:'search-profile',actorId:'desktop-user:search-profile'};
const agent={...user,requestSource:'agent' as const,taskId:'search-consumer'};
let root:string;let service:ContinuityService;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'continuity-search-'));service=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:user.profileId});});
afterEach(()=>{service.close();rmSync(root,{recursive:true,force:true,maxRetries:3});});
function conversation(title='Search conversation'){return service.createConversation(user,{operationId:crypto.randomUUID(),title});}
function append(id:string,text:string,sourceRevision=1,sourceMessageId='message'){
 return service.recordMessage(user,{conversationId:id,sourceKind:'desktop_task',sourceId:`source_${id}`,sourceDataEpoch:'epoch',sourceMessageId,sourceRevision,role:'assistant',text,executionState:'settled'});
}
function target(){const c=conversation('Target');service.bindTask(user,{conversationId:c.id,taskId:agent.taskId});return c;}
function reference(id:string,messageId?:string){return service.createReference(user,{conversationId:id,expectedRevision:service.getConversation(user,id)!.revision,operationId:crypto.randomUUID(),...(messageId?{firstMessageId:messageId,lastMessageId:messageId}:{})});}

it('searches literal canonical keywords for user and returns exact readable links with no unrelated fallback',()=>{
 const source=conversation('中文历史');const message=append(source.id,'部署上下文 continuity 😀');
 const result=service.searchHistory(user,{query:'上下文'});
 expect(result.mode).toBe('keyword');expect(result.coverage).toBe('canonical_only');expect(result.hits).toHaveLength(1);
 expect(result.hits[0]).toMatchObject({messageId:message.messageId,revision:1,excerpt:message.text,title:'中文历史',sourceKind:'desktop_task'});
 expect(service.resolveReference(user,{refId:result.hits[0].refId}).messages[0]).toMatchObject({text:message.text,contentHash:message.contentHash});
 service.assertHistorySearchCurrent(result,user);
 expect(service.searchHistory(user,{query:'UNANSWERABLE_CANARY'}).hits).toEqual([]);
 expect(service.searchHistory(user,{query:"%' OR 1=1 --"}).hits).toEqual([]);
});

it('limits an agent to its own history and frozen explicitly attached entries without leaking current title or current revision',()=>{
 const own=target();append(own.id,'same own');const source=conversation('Original title');const first=append(source.id,'same frozen v1');const ref=reference(source.id,first.messageId);
 expect(service.searchHistory(agent,{query:'same'}).hits.map(x=>x.excerpt)).toEqual(['same own']);
 service.attachReference(user,{refId:ref.refId,targetConversationId:own.id,operationId:'explicit'});
 append(source.id,'same FUTURE_PRIVATE_V2',2);service.updateConversation(user,source.id,{title:'FUTURE_PRIVATE_TITLE'});
 const result=service.searchHistory(agent,{query:'same'});
 expect(result.hits.map(x=>x.excerpt).sort()).toEqual(['same frozen v1','same own']);
 const attached=result.hits.find(x=>x.messageId===first.messageId)!;
 expect(attached.refId).toBe(ref.refId);expect(attached.revision).toBe(1);expect(attached.title).toBeNull();
 expect(JSON.stringify(result)).not.toContain('FUTURE_PRIVATE');service.assertHistorySearchCurrent(result,agent);
 expect(service.searchHistory(agent,{query:'FUTURE_PRIVATE_V2'}).hits).toEqual([]);
});

it('requires user-only positive private origin for both target consent and broad source candidates',()=>{
 const own=target();const source=conversation();append(source.id,'private hit');
 expect(service.getHistorySearchConsent(user,own.id)).toEqual({enabled:false,revision:0});
 expect(()=>service.setHistorySearchConsent(agent,{conversationId:own.id,enabled:true})).toThrow('user_required');
 service.setHistorySearchConsent(user,{conversationId:own.id,enabled:true});
 expect(service.searchHistory(agent,{query:'private hit'}).hits).toHaveLength(1);
 service.store.db.prepare("DELETE FROM operations WHERE kind='createConversation' AND json_extract(result,'$.id')=?").run(source.id);
 expect(service.searchHistory(user,{query:'private hit'}).hits).toEqual([]);
 expect(service.searchHistory(agent,{query:'private hit'}).hits).toEqual([]);
 service.store.db.prepare("DELETE FROM operations WHERE kind='createConversation' AND json_extract(result,'$.id')=?").run(own.id);
 expect(()=>service.setHistorySearchConsent(user,{conversationId:own.id,enabled:true})).toThrow('not_readable');
});

it('revokes managed exact grants on opt-out and leaves consumed derived output permanently invalid',()=>{
 const own=target();const source=conversation();append(source.id,'remember deployment');service.setHistorySearchConsent(user,{conversationId:own.id,enabled:true});
 const result=service.searchHistory(agent,{query:'deployment'});expect(result.hits).toHaveLength(1);
 service.assertHistorySearchCurrent(result,agent);
 service.recordMessage(user,{conversationId:own.id,sourceKind:'desktop_task',sourceId:agent.taskId,sourceDataEpoch:'epoch-target',sourceMessageId:'answer',sourceRevision:1,role:'assistant',text:'derived deployment',executionState:'settled'});
 service.setHistorySearchConsent(user,{conversationId:own.id,enabled:false});
 expect(()=>service.assertHistorySearchCurrent(result,agent)).toThrow('not_readable');
 expect(()=>service.resolveReference(agent,{refId:result.hits[0].refId})).toThrow('not_readable');
 expect(()=>service.assertTaskReadable(agent.taskId)).toThrow('not_readable');
 service.setHistorySearchConsent(user,{conversationId:own.id,enabled:true});expect(()=>service.assertTaskReadable(agent.taskId)).toThrow('not_readable');
});

it('promotes an explicitly attached managed grant atomically, including idempotent retry, and rejects a revoked cached attach',()=>{
 const own=target();const source=conversation();append(source.id,'explicit promotion');service.setHistorySearchConsent(user,{conversationId:own.id,enabled:true});
 const result=service.searchHistory(agent,{query:'promotion'});const input={refId:result.hits[0].refId,targetConversationId:own.id,operationId:'promote'};
 const grant=service.attachReference(user,input);expect(service.attachReference(user,input)).toEqual(grant);
 service.setHistorySearchConsent(user,{conversationId:own.id,enabled:false});
 expect(service.resolveReference(agent,{refId:input.refId}).messages[0].text).toBe('explicit promotion');
 service.revokeGrant(user,grant);expect(()=>service.attachReference(user,input)).toThrow('not_readable');
});

it('rejects copied, edited, foreign-actor, revoked-zero-hit and deleted-source result proofs',()=>{
 const own=target();const source=conversation();append(source.id,'proof canary');service.setHistorySearchConsent(user,{conversationId:own.id,enabled:true});
 const result=service.searchHistory(agent,{query:'proof'});service.assertHistorySearchCurrent(result,agent);
 expect(()=>service.assertHistorySearchCurrent(structuredClone(result),agent)).toThrow('not_readable');
 expect(()=>service.assertHistorySearchCurrent(result,{...agent,taskId:'other'})).toThrow('not_readable');
 const empty=service.searchHistory(agent,{query:'NO_HIT'});service.store.db.prepare('UPDATE task_bindings SET revoked=1 WHERE task_id=?').run(agent.taskId);
 expect(()=>service.assertHistorySearchCurrent(empty,agent)).toThrow('not_readable');
 const userResult=service.searchHistory(user,{query:'proof'});service.tombstoneConversation(user,source.id);
 expect(()=>service.assertHistorySearchCurrent(userResult,user)).toThrow('not_readable');
});

it('rejects source/principal/query-language widening fields and bounds UTF-8 excerpts around emoji and Chinese',()=>{
 const c=conversation();for(let i=0;i<25;i++)append(c.id,'😀'.repeat(700)+'目标关键词'+'文'.repeat(800),1,`m${i}`);
 const result=service.searchHistory(user,{query:'目标关键词',limit:20});expect(result.hits).toHaveLength(20);
 expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
 for(const hit of result.hits){expect(hit.excerpt).toContain('目标关键词');expect(hit.excerpt).not.toContain('\uFFFD');expect(hit.excerpt.length).toBeLessThanOrEqual(800);}
 for(const input of [{query:''},{query:'x',limit:21},{query:'x',after:20,before:10},{query:'x',sourceKinds:['room']},{query:'x',conversationId:c.id},{query:'x',profileId:user.profileId}]){
  expect(()=>service.searchHistory(user,input as Parameters<ContinuityService['searchHistory']>[1])).toThrow('invalid_argument');
 }
});
it('returns as many long-title/long-query hits as fit rather than failing a valid bounded request',()=>{
 const c=conversation('很长的标题'.repeat(150));const query='词'.repeat(256);
 for(let i=0;i<20;i++)append(c.id,query,1,`long${i}`);
 const result=service.searchHistory(user,{query});expect(result.hits.length).toBeGreaterThan(0);expect(result.hits.length).toBeLessThan(20);
 expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);for(const hit of result.hits)expect(hit.excerpt).toBe(query);
});
it('does not return unclaimed pending/unknown records even to a user search',()=>{
 const c=conversation();
 for(const state of ['pending','unknown'] as const)service.recordMessage(user,{conversationId:c.id,sourceKind:'desktop_task',sourceId:`task_${state}`,sourceDataEpoch:'epoch',sourceMessageId:'m',sourceRevision:1,role:'assistant',text:'UNCLAIMED_SEARCH_CANARY',executionState:state});
 expect(service.listMessages(user,c.id)).toHaveLength(2);
 expect(service.searchHistory(user,{query:'UNCLAIMED_SEARCH_CANARY'}).hits).toEqual([]);
});
