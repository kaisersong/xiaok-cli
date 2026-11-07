import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ConversationActivityOwnerHost} from '../../../src/runtime/conversation-activity/owner-host.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';

// Real authenticated socket/host/store. The existing endpoint-registration
// boundary is scripted; no claim of real SDK inventory/finalize qualification.
describe('native attention reader birth on the original owner socket',()=>{
 const cleanup:Array<()=>void|Promise<void>>=[];
 afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
 async function fixture(){
  const root=mkdtempSync(join(tmpdir(),'attention-reader-owner-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
  const state={allowed:true,errors:[] as unknown[]};const host=new ConversationActivityOwnerHost({dataRoot:root,profileId:'profile',actorId:'user',getThread:threadId=>threadId==='thread'?{threadId,profileId:'profile',workspaceId:'workspace',deleteState:'none'}:null,
   onError:error=>state.errors.push(error),canObserveWork:()=>state.allowed,authorizeProducer:threadId=>threadId==='thread',mcpRequest:async(method)=>{if(method!=='mcpRegister')throw Error('fixture_mcp_method_unavailable');}});
  await host.start();cleanup.push(()=>host.stop());
  function client(role:'user'|'producer'='producer'){const result=new ConversationActivityOwnerClient(root,role);cleanup.push(()=>result.dispose());return result;}
  return {root,host,client,state,producer:client(),other:client(),user:client('user')};
 }
 const reference={endpointId:'endpoint',generation:'v2',taskId:'task',originalOperation:'tools/call'};
 const binding={operationId:'operation',watchId:'watch',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run'};
 async function prepare(producer:ConversationActivityOwnerClient){return producer.request<{sourceBirthRef:string}>('attentionPrepare',{threadId:'thread',operationId:'operation',creationIdempotencyKey:'operation'});}
 async function register(producer:ConversationActivityOwnerClient,sourceIncarnation=randomUUID()){
  await producer.request('mcpRegister',{endpointId:'endpoint',name:'fixture'});await producer.request('attentionReaderRegister',{endpointId:'endpoint',sourceIncarnation});return sourceIncarnation;
 }
 async function bind(producer:ConversationActivityOwnerClient,sourceBirthRef:string){return producer.request('attentionBind',{sourceBirthRef,binding,reference});}
 it('binds a reader only to the real preparing socket and freezes its native incarnation in the round',async()=>{
  const f=await fixture(),incarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  const round=await f.producer.request<any>('attentionReadBegin',{watchId:'watch'});expect(round.roundId).toMatch(/^[a-f0-9-]{36}$/);
  expect(round.readerSlots).toEqual([expect.objectContaining({watchId:'watch',readerIncarnation:incarnation,reference})]);
  await expect(f.user.request('attentionReadBegin',{watchId:'watch'})).rejects.toThrow('activity_method_forbidden');
 });
 it('refuses another authorized producer instead of transferring the original birth',async()=>{
  const f=await fixture();await register(f.producer);const birth=await prepare(f.producer);await register(f.other);
  await expect(bind(f.other,birth.sourceBirthRef)).rejects.toThrow(/attention_reader_forbidden/);expect(f.host.store.getWatch('watch')).toBeNull();
  await bind(f.producer,birth.sourceBirthRef);await expect(f.other.request('attentionReadBegin',{watchId:'watch'})).rejects.toThrow(/attention_reader_forbidden/);
 });
 it('does not let legacy bind/forget bypass the new birth and does not revoke a bound birth on forget',async()=>{
  const f=await fixture();await register(f.producer);const birth=await prepare(f.producer);
  await expect(f.producer.request('bind',{...binding,source:'mcp',mcpReference:reference})).rejects.toThrow(/attention_reader_birth_required/);
  await expect(f.producer.request('forgetAssociation',{operationId:'operation'})).rejects.toThrow(/attention_reader_birth_required/);
  await bind(f.producer,birth.sourceBirthRef);await expect(f.producer.request('attentionForget',{operationId:'operation',sourceBirthRef:birth.sourceBirthRef})).resolves.toMatchObject({forgotten:false});
  await expect(f.producer.request('attentionReadBegin',{watchId:'watch'})).resolves.toHaveProperty('roundId');
 });
 it('rejects a stale source birth after forget and same-key recreation',async()=>{
  const f=await fixture();await register(f.producer);const old=await prepare(f.producer);
  await expect(f.producer.request('attentionForget',{operationId:'operation',sourceBirthRef:old.sourceBirthRef})).resolves.toMatchObject({forgotten:true});
  const next=await prepare(f.producer);expect(next.sourceBirthRef).not.toBe(old.sourceBirthRef);
  await expect(bind(f.producer,old.sourceBirthRef)).rejects.toThrow(/attention_reader_forbidden/);expect(f.host.store.getWatch('watch')).toBeNull();
  await bind(f.producer,next.sourceBirthRef);
 });
 it('invalidates a lease on physical reader replacement and cannot requalify the old watch through idempotent bind',async()=>{
  const f=await fixture();await register(f.producer);const birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  await register(f.producer);await bind(f.producer,birth.sourceBirthRef);
  await expect(f.producer.request('attentionReadBegin',{watchId:'watch'})).rejects.toThrow(/attention_inventory_unavailable/);
 });
 it('does not let a disconnected delayed prepare promote over a newly created same-key birth',async()=>{
  const f=await fixture();await register(f.producer);const original=f.host.service.prepareAssociation.bind(f.host.service);let release!:()=>void,entered=false;
  const held=new Promise<void>(resolve=>{release=resolve;});vi.spyOn(f.host.service,'prepareAssociation').mockImplementationOnce(async(...args)=>{await original(...args);entered=true;await held;});
  const old=prepare(f.producer).catch(error=>error);await vi.waitFor(()=>expect(entered).toBe(true));f.producer.dispose();
  await vi.waitFor(async()=>{await f.other.request('forgetAssociation',{operationId:'operation'});});
  await register(f.other);const next=await prepare(f.other);release();await old;await bind(f.other,next.sourceBirthRef);
  await expect(f.other.request('attentionReadBegin',{watchId:'watch'})).resolves.toHaveProperty('roundId');
 });
 it('rejects a newly joined complete member after an authorization await',async()=>{
  const f=await fixture(),incarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  let release!:(allowed:boolean)=>void,entered=false;const held=new Promise<boolean>(resolve=>{release=resolve;});vi.spyOn(f.host.service,'canReadSource').mockImplementationOnce(()=>{entered=true;return held;});
  const read=f.producer.request('attentionReadBegin',{watchId:'watch'});void read.catch(()=>{});await vi.waitFor(()=>expect(entered).toBe(true));
  await register(f.producer,incarnation);const alias=await f.producer.request<{sourceBirthRef:string}>('attentionPrepare',{threadId:'thread',operationId:'alias',creationIdempotencyKey:'alias'});
  await f.producer.request('attentionBind',{sourceBirthRef:alias.sourceBirthRef,binding:{...binding,operationId:'alias',watchId:'alias'},reference});release(true);
  await expect(read).rejects.toThrow('attention_source_conflict');
 });
 it('supersedes an old read round without allowing a stale or foreign abort',async()=>{
  const f=await fixture();await register(f.producer);const birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  const old=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'}),next=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'});
  await expect(f.producer.request('attentionReadAbort',{roundId:old.roundId})).rejects.toThrow('attention_round_conflict');
  await expect(f.other.request('attentionReadAbort',{roundId:next.roundId})).rejects.toThrow('attention_round_conflict');
  await expect(f.producer.request('attentionReadAbort',{roundId:next.roundId})).resolves.toEqual({aborted:true});
 });
 it('keeps the nonaggregated authorization producer-only and never serializes denied source contents',async()=>{
  const f=await fixture();await register(f.producer);const birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'private',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'completed',receivedAt:1,summary:'private result',evidenceRefs:['private-evidence']});
  const aggregate=vi.spyOn(f.host.service,'getWork');await expect(f.producer.request('authorizeRead',{watchId:'watch'})).resolves.toMatchObject({projection:{summary:'private result'}});expect(aggregate).not.toHaveBeenCalled();
  await expect(f.user.request('authorizeRead',{watchId:'watch'})).rejects.toThrow('activity_method_forbidden');f.state.allowed=false;
  await expect(f.producer.request('authorizeRead',{watchId:'watch'})).rejects.toThrow('activity_source_forbidden');
  const denied=await f.user.request<any>('work',{watchId:'watch'});expect(JSON.stringify(denied)).not.toMatch(/private result|private-evidence/);
 });
 it('finalizes two independent questions atomically and preserves their versions across repeated complete reads',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'input',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'input_required',receivedAt:1,evidenceRefs:[]});
  const inventories=[{watchId:'watch',readerIncarnation,taskStatus:'input_required',businessOutcome:'unknown',questions:[{inputId:'one',expectedDigest:'a'.repeat(64)},{inputId:'two',expectedDigest:'b'.repeat(64)}]}];
  async function read(){const {roundId}=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'});return f.producer.request<any>('attentionReadFinalize',{roundId,inventories});}
  const first=await read();expect(first.view.presentation.questions).toHaveLength(2);expect(first.view.presentation.questions.map((question:any)=>question.sourceRevision)).toEqual([1,1]);
  const second=await read();expect(second.view.presentation.projectionVersion).toBe(first.view.presentation.projectionVersion);expect(second.presentationIncarnation).toBe(first.presentationIncarnation);
 });
 it('rejects extra or incomplete inventories and never closes an input-required source by omission',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'input',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'input_required',receivedAt:1,evidenceRefs:[]});
  for(const inventories of [[],[{watchId:'watch',readerIncarnation,taskStatus:'input_required',businessOutcome:'unknown',questions:[]}],
   [{watchId:'foreign',readerIncarnation,taskStatus:'input_required',businessOutcome:'unknown',questions:[{inputId:'one',expectedDigest:'a'.repeat(64)}]}]]){
   const {roundId}=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'});
   await expect(f.producer.request('attentionReadFinalize',{roundId,inventories})).rejects.toThrow(/attention_inventory/);expect(f.host.store.getAttentionPresentation('watch')).toBeNull();
  }
 });
 it('refuses a stale UI dismiss after a fresh question digest changes instead of substituting the new version',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'input',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'input_required',receivedAt:1,evidenceRefs:[]});
  const inventory={watchId:'watch',readerIncarnation,taskStatus:'input_required',businessOutcome:'unknown',questions:[{inputId:'one',expectedDigest:'a'.repeat(64)}]};
  const {roundId}=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'}),first=await f.producer.request<any>('attentionReadFinalize',{roundId,inventories:[inventory]});
  const next=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'});inventory.questions[0].expectedDigest='b'.repeat(64);
  const result=await f.producer.request<any>('attentionReadFinalize',{roundId:next.roundId,inventories:[inventory],dismiss:{expectedProjectionVersion:first.view.presentation.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation}});
  expect(result.dismissConflict).toBe(true);expect(result.dismissed).toBe(false);expect(result.view.presentation.projectionVersion).toBeGreaterThan(first.view.presentation.projectionVersion);
 });
 it('does not launder a corrupt current canonical fact when a real new state would otherwise advance it',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'input',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'input_required',receivedAt:1,evidenceRefs:[]});
  const round=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'});
  await f.producer.request('attentionReadFinalize',{roundId:round.roundId,inventories:[{watchId:'watch',readerIncarnation,taskStatus:'input_required',businessOutcome:'unknown',questions:[{inputId:'one',expectedDigest:'a'.repeat(64)}]}]});
  const db=new DatabaseSync(join(f.root,'conversation-activity.sqlite'));try{db.exec("DROP TRIGGER activity_attention_core_fact_update; UPDATE activity_attention_core_facts SET data_json=json_set(data_json,'$.core.executionState','cancelled')");}finally{db.close();}
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'running',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:2,transportGeneration:1,kind:'progress',receivedAt:2,evidenceRefs:[]});
  const next=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'});
  await expect(f.producer.request('attentionReadFinalize',{roundId:next.roundId,inventories:[{watchId:'watch',readerIncarnation,taskStatus:'working',businessOutcome:'unknown',questions:[]}]})).rejects.toThrow('attention_canonical_integrity_failed');
 });
 it('cannot revive a dismissed empty-reason running presentation after an observed running-blocked-running cycle',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  const ingest=(kind:string,sourceSequence:number)=>f.host.store.ingest('watch',{schemaVersion:1,eventId:'event:'+sourceSequence,source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence,transportGeneration:1,kind,receivedAt:sourceSequence,evidenceRefs:[]});
  const inventories=[{watchId:'watch',readerIncarnation,taskStatus:'working',businessOutcome:'unknown',questions:[]}];
  const read=async(dismiss?:any)=>{const {roundId}=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'});return f.producer.request<any>('attentionReadFinalize',{roundId,inventories,...(dismiss?{dismiss}:{})});};
  ingest('progress',1);const first=await read();expect(first.view.presentation.sourceFacts).toEqual([]);
  expect((await read({expectedProjectionVersion:first.view.presentation.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation})).dismissed).toBe(true);
  ingest('blocked',2);ingest('progress',3);const next=await read();expect(next.view.presentation.sourceFacts).toEqual([]);expect(next.view.presentation.projectionVersion).toBeGreaterThan(first.view.presentation.projectionVersion);expect(next.dismissed).toBe(false);
 });
 it('does not treat a newly joined same-core alias as a new canonical fact or clear the existing dismiss',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  const event={schemaVersion:1,eventId:'running',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'progress',receivedAt:1,evidenceRefs:[]};f.host.store.ingest('watch',event);
  const inventory={watchId:'watch',readerIncarnation,taskStatus:'working',businessOutcome:'unknown',questions:[]};
  const read=async(inventories:any[],dismiss?:any)=>{const {roundId}=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId:'watch'});return f.producer.request<any>('attentionReadFinalize',{roundId,inventories,...(dismiss?{dismiss}:{})});};
  const first=await read([inventory]);await read([inventory],{expectedProjectionVersion:first.view.presentation.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation});
  const alias=await f.producer.request<{sourceBirthRef:string}>('attentionPrepare',{threadId:'thread',operationId:'alias',creationIdempotencyKey:'alias'});
  await f.producer.request('attentionBind',{sourceBirthRef:alias.sourceBirthRef,binding:{...binding,operationId:'alias',watchId:'alias'},reference});f.host.store.ingest('alias',event);
  const next=await read([inventory,{...inventory,watchId:'alias'}]);expect(next.view.presentation.projectionVersion).toBe(first.view.presentation.projectionVersion);expect(next.dismissed).toBe(true);
 });
 it('uses one aggregate freshness for the same anchor regardless of which member requested it',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  const alias=await f.producer.request<{sourceBirthRef:string}>('attentionPrepare',{threadId:'thread',operationId:'alias',creationIdempotencyKey:'alias'});
  await f.producer.request('attentionBind',{sourceBirthRef:alias.sourceBirthRef,binding:{...binding,operationId:'alias',watchId:'alias'},reference});
  const event={schemaVersion:1,eventId:'running',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'progress',receivedAt:1,evidenceRefs:[]};
  f.host.store.ingest('watch',event);f.host.store.ingest('alias',event);f.host.store.setFreshness('alias','stale');
  const inventories=['watch','alias'].map(watchId=>({watchId,readerIncarnation,taskStatus:'working',businessOutcome:'unknown',questions:[]}));
  const read=async(watchId:string,dismiss?:any)=>{const {roundId}=await f.producer.request<{roundId:string}>('attentionReadBegin',{watchId});return f.producer.request<any>('attentionReadFinalize',{roundId,inventories,...(dismiss?{dismiss}:{})});};
  const first=await read('watch');await read('watch',{expectedProjectionVersion:first.view.presentation.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation});const second=await read('alias');
  expect(first.view.presentation.freshness).toBe('stale');expect(second.view.presentation.projectionVersion).toBe(first.view.presentation.projectionVersion);expect(second.dismissed).toBe(true);
 });
 it('closes only a proven absent question and advances its permanent revision when it reopens',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  const ingest=(kind:string,sourceSequence:number)=>f.host.store.ingest('watch',{schemaVersion:1,eventId:'q:'+sourceSequence,source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence,transportGeneration:1,kind,receivedAt:sourceSequence,evidenceRefs:[]});
  const read=async(taskStatus:string,questions:any[])=>{const {roundId}=await f.producer.request<any>('attentionReadBegin',{watchId:'watch'});return f.producer.request<any>('attentionReadFinalize',{roundId,inventories:[{watchId:'watch',readerIncarnation,taskStatus,businessOutcome:'unknown',questions}]});};
  const question={inputId:'one',expectedDigest:'a'.repeat(64)};ingest('input_required',1);const first=await read('input_required',[question]);
  ingest('progress',2);expect((await read('working',[])).view.presentation.questions).toEqual([]);
  ingest('input_required',3);const reopened=await read('input_required',[question]);expect(reopened.view.presentation.questions[0].questionRef).toBe(first.view.presentation.questions[0].questionRef);expect(reopened.view.presentation.questions[0].sourceRevision).toBe(3);
 });
 it.each(['statement','commit'])('rolls back all canonical/question/cache writes on a real SQLite %s failure',async(mode)=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'input',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'input_required',receivedAt:1,evidenceRefs:[]});
  const db=new DatabaseSync(join(f.root,'conversation-activity.sqlite'));cleanup.push(()=>db.close());
  if(mode==='statement')db.exec("CREATE TRIGGER injected_finalize_failure BEFORE INSERT ON activity_attention_bodies BEGIN SELECT RAISE(ABORT,'injected_statement_failure'); END");
  else db.exec('CREATE TABLE injected_parent(id INTEGER PRIMARY KEY); CREATE TABLE injected_child(parent_id INTEGER REFERENCES injected_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER injected_finalize_failure AFTER INSERT ON activity_attention_bodies BEGIN INSERT INTO injected_child VALUES(1); END');
  const inventories=[{watchId:'watch',readerIncarnation,taskStatus:'input_required',businessOutcome:'unknown',questions:[{inputId:'one',expectedDigest:'a'.repeat(64)}]}];
  const first=await f.producer.request<any>('attentionReadBegin',{watchId:'watch'});await expect(f.producer.request('attentionReadFinalize',{roundId:first.roundId,inventories})).rejects.toThrow(mode==='statement'?'injected_statement_failure':'FOREIGN KEY constraint failed');
  for(const table of ['activity_attention_core_facts','activity_attention_core_heads','activity_attention_question_facts','activity_attention_question_heads','activity_attention_namespaces','activity_attention_heads','activity_attention_bodies'])expect(db.prepare('SELECT count(*) AS n FROM '+table).get()).toEqual({n:0});
  db.exec('DROP TRIGGER injected_finalize_failure');
  if(mode==='commit'){await expect(f.producer.request('attentionReadBegin',{watchId:'watch'})).rejects.toThrow('conversation_activity_write_unconfirmed');}
  else{const next=await f.producer.request<any>('attentionReadBegin',{watchId:'watch'});expect((await f.producer.request<any>('attentionReadFinalize',{roundId:next.roundId,inventories})).view.presentation.questions).toHaveLength(1);}
 });
 it('consumes finalize once before authorization await and an abort revokes its eventual SQL commit',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'input',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'input_required',receivedAt:1,evidenceRefs:[]});
  const {roundId}=await f.producer.request<any>('attentionReadBegin',{watchId:'watch'});let release!:(value:any)=>void,entered=false;
  const original=f.host.service.authorizeRead.bind(f.host.service);vi.spyOn(f.host.service,'authorizeRead').mockImplementationOnce(async(...args)=>{const result=await original(...args);entered=true;await new Promise(resolve=>{release=resolve;});return result;});
  const input={roundId,inventories:[{watchId:'watch',readerIncarnation,taskStatus:'input_required',businessOutcome:'unknown',questions:[{inputId:'one',expectedDigest:'a'.repeat(64)}]}]},pending=f.producer.request('attentionReadFinalize',input);void pending.catch(()=>{});
  await vi.waitFor(()=>expect(entered).toBe(true));await expect(f.producer.request('attentionReadFinalize',input)).rejects.toThrow('attention_round_conflict');await f.producer.request('attentionReadAbort',{roundId});release(undefined);
  await expect(pending).rejects.toThrow('attention_round_conflict');expect(f.host.store.getAttentionPresentation('watch')).toBeNull();
 });

 it('publishes a successful user dismiss to the existing views without creating a read feedback loop',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'input',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'input_required',receivedAt:1,evidenceRefs:[]});
  const updates:any[]=[];const stop=await f.user.subscribe('thread',change=>updates.push(change));cleanup.push(stop);
  const inventories=[{watchId:'watch',readerIncarnation,taskStatus:'input_required',businessOutcome:'unknown',questions:[{inputId:'one',expectedDigest:'a'.repeat(64)}]}];
  const read=async(dismiss?:any)=>{const {roundId}=await f.producer.request<any>('attentionReadBegin',{watchId:'watch'});return f.producer.request<any>('attentionReadFinalize',{roundId,inventories,...(dismiss?{dismiss}:{})});};
  const first=await read();expect(updates).toEqual([]);const dismissed=await read({expectedProjectionVersion:first.view.presentation.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation});expect(dismissed.dismissed).toBe(true);
  await vi.waitFor(()=>expect(updates).toEqual([{threadId:'thread',watchId:'watch'}]));await read();await read();expect(updates).toHaveLength(1);
 });

 it('keeps an acknowledged dismiss receipt when its later view notification fails and records the actual cause',async()=>{
  const f=await fixture(),readerIncarnation=await register(f.producer),birth=await prepare(f.producer);await bind(f.producer,birth.sourceBirthRef);
  f.host.store.ingest('watch',{schemaVersion:1,eventId:'input',source:'mcp',logicalSourceId:'endpoint',sourceDataEpoch:'source-epoch',workId:'task',runId:'run',sourceSequence:1,transportGeneration:1,kind:'input_required',receivedAt:1,evidenceRefs:[]});
  const inventories=[{watchId:'watch',readerIncarnation,taskStatus:'input_required',businessOutcome:'unknown',questions:[{inputId:'one',expectedDigest:'a'.repeat(64)}]}];
  const read=async(dismiss?:any)=>{const {roundId}=await f.producer.request<any>('attentionReadBegin',{watchId:'watch'});return f.producer.request<any>('attentionReadFinalize',{roundId,inventories,...(dismiss?{dismiss}:{})});};
  const first=await read(),error=Error('original view subscriber failure');vi.spyOn(f.host.service as any,'publish').mockRejectedValueOnce(error);
  const before=f.host.store.listActivities('profile','thread').length;
  const dismissed=await read({expectedProjectionVersion:first.view.presentation.projectionVersion,expectedPresentationIncarnation:first.presentationIncarnation});expect(dismissed.dismissed).toBe(true);expect(dismissed.view.presentation.questions).toHaveLength(1);
  await vi.waitFor(()=>expect(f.state.errors).toContain(error));expect(f.host.store.listActivities('profile','thread')).toHaveLength(before);expect((await read()).dismissed).toBe(true);
 });

});
