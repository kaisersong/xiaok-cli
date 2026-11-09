import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
// Original metadata transaction component. These fixtures are admitted by the
// trusted Store owner; no claim of a Main/Native private-frame producer grant.
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(){const root=mkdtempSync(join(tmpdir(),'native-attention-finalizer-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'activity.sqlite'),store=new ConversationActivityStore(file);cleanup.push(()=>store.close());store.prepareAssociation({operationId:'operation',creationIdempotencyKey:'operation',origin:{profileId:'profile',workspaceId:'workspace',threadId:'thread',actorId:'user'}});store.bindWork({operationId:'operation',watchId:'watch',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run'});const reference={sourceKind:'codex_native_approval',taskId:'task',taskSessionId:'host-session',executionThreadId:'thread',nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeGeneration:1,nativeIncarnation:randomUUID()};const {enrollment,delivery}=store.enrollNativeAttentionSource('watch',reference);const one={inputId:randomUUID(),expectedDigest:'a'.repeat(64),requestDigest:'b'.repeat(64)},two={inputId:randomUUID(),expectedDigest:'c'.repeat(64),requestDigest:'d'.repeat(64)};
 const inventory=(revision:number,questions=[one,two])=>({sourceKind:'codex_native_approval',watchId:'watch',readerIncarnation:reference.nativeIncarnation,enrollmentIncarnation:enrollment.enrollmentIncarnation,bindingDigest:enrollment.bindingDigest,reference,coverage:'native_approvals_exclusive_execution_v1',inventoryRevision:revision,inventoryDigest:revision.toString(16).padStart(64,'0'),taskStatus:questions.length?'input_required':'working',businessOutcome:'unknown',questions});
 const read=(input:any)=>{const captured=store.captureAttentionRead('watch');return store.finalizeAttentionReadRound('watch',{expectedMembershipDigest:captured.membershipDigest,expectedProjectionVersion:captured.projectionVersion,expectedPresentationIncarnation:captured.presentationIncarnation,inventories:[input]});};
 return{root,file,store,reference,enrollment,delivery,one,two,inventory,read};}
it('updates the original projection/card/fact/questions/cache together, answers one independently, and clears only its owned wait',()=>{
 const f=fixture();const first=f.read(f.inventory(2));expect(first.view.projection.executionState).toBe('input_required');expect(first.view.presentation.questions).toHaveLength(2);expect(first.view.presentation.questions.every(q=>q.ownerKind==='task_host'&&q.answerApiRef==='answerQuestion')).toBe(true);
 const unchanged=f.read(f.inventory(2));expect(unchanged.view.presentation.projectionVersion).toBe(first.view.presentation.projectionVersion);
 const second=f.read(f.inventory(3,[f.two]));expect(second.view.presentation.questions).toHaveLength(1);expect(second.view.presentation.questions[0].sourceRevision).toBe(1);
 const final=f.read(f.inventory(4,[]));expect(final.view.projection.executionState).toBe('running');expect(final.view.projection.sourceSequence).toBe(0);expect(final.view.presentation.questions).toEqual([]);expect(f.store.getOrdinaryAttentionFact('watch').schemaVersion).toBe(2);
 const db=new DatabaseSync(f.file,{readOnly:true});try{const card=JSON.parse((db.prepare("SELECT data_json FROM conversation_activities WHERE activity_id='created:watch'").get() as any).data_json);expect(card.projection.executionState).toBe('running');expect((db.prepare('SELECT COUNT(*) AS n FROM source_events').get() as any).n).toBe(0);}finally{db.close();}
});
it('rejects counter replay, same-counter equivocation and a stale original begin CAS without refreshing it',()=>{
 const f=fixture();f.read(f.inventory(2));const before=f.store.getProjection('watch');expect(()=>f.read(f.inventory(1))).toThrow(/native_inventory/);expect(()=>f.read({...f.inventory(2),inventoryDigest:'e'.repeat(64)})).toThrow(/native_inventory/);expect(f.store.getProjection('watch')).toEqual(before);
 const captured=f.store.captureAttentionRead('watch');f.store.setFreshness('watch','stale',undefined,f.delivery);
 expect(()=>f.store.finalizeAttentionReadRound('watch',{expectedMembershipDigest:captured.membershipDigest,expectedProjectionVersion:captured.projectionVersion,expectedPresentationIncarnation:captured.presentationIncarnation,inventories:[f.inventory(3,[])]})).toThrow('attention_source_conflict');expect(f.store.getProjection('watch')?.executionState).toBe('input_required');
});
it('never clears a same-state foreign Host wait, even after a later Native input event or owner restart',()=>{
 const f=fixture();f.read(f.inventory(2));
 const event={schemaVersion:1,eventId:'foreign',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:1,transportGeneration:0,kind:'input_required',receivedAt:1,evidenceRefs:[]};f.store.ingest('watch',event,f.delivery);
 expect(()=>f.read(f.inventory(3,[]))).toThrow('attention_native_coverage_unknown');expect(f.store.getProjection('watch')?.executionState).toBe('input_required');
 f.store.ingest('watch',{...event,schemaVersion:2,eventId:'native-again',sourceSequence:2,questionId:f.one.inputId,questionOwner:{schemaVersion:1,kind:'codex_native_approval',taskSessionId:'host-session',nativeIncarnation:f.reference.nativeIncarnation,nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeTurnGeneration:1,approvalToken:f.one.inputId,requestDigest:f.one.requestDigest}},f.delivery);
 expect(()=>f.read(f.inventory(4,[]))).toThrow('attention_native_coverage_unknown');
 f.store.close();const next=new ConversationActivityStore(f.file);try{expect(next.getNativeAttentionEnrollment('watch')?.coverageLost).toBe(true);}finally{next.close();}
});
it('rolls back all original projection and question writes when a real SQLite cache write fails',()=>{
 const f=fixture();f.read(f.inventory(2));const before=f.store.getProjection('watch'),presentation=f.store.getAttentionPresentation('watch');const db=new DatabaseSync(f.file);
 try{db.exec("CREATE TRIGGER native_cache_fault BEFORE UPDATE ON activity_attention_bodies BEGIN SELECT RAISE(ABORT,'native_cache_io_sentinel'); END");expect(()=>f.read(f.inventory(3,[]))).toThrow('native_cache_io_sentinel');expect(f.store.getProjection('watch')).toEqual(before);expect(f.store.getAttentionPresentation('watch')).toEqual(presentation);}finally{db.close();}
});

function terminalRead(store:ConversationActivityStore){const captured=store.captureAttentionRead('watch');return store.finalizeAttentionReadRound('watch',{expectedMembershipDigest:captured.membershipDigest,expectedProjectionVersion:captured.projectionVersion,expectedPresentationIncarnation:captured.presentationIncarnation,inventories:[]});}
it('keeps an independently verified block while Native questions are answered independently',()=>{
 const f=fixture();f.store.ingest('watch',{schemaVersion:1,eventId:'blocked',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:1,transportGeneration:0,kind:'blocked',receivedAt:1,evidenceRefs:[]},f.delivery);
 for(const [revision,questions] of [[2,[f.one,f.two]],[3,[f.two]],[4,[]]] as const){const result=f.read(f.inventory(revision,[...questions]));expect(result.view.projection.executionState).toBe('blocked');expect(result.view.presentation.questions).toHaveLength(questions.length);expect(result.view.presentation.sourceFacts.some(fact=>fact.reasonCode==='ordinary_work_blocked')).toBe(true);}
});
it('closes Native questions only from the actual original terminal event and this watch receipt',()=>{
 const f=fixture();f.read(f.inventory(2));f.store.ingest('watch',{schemaVersion:1,eventId:'terminal',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:1,transportGeneration:0,kind:'completed',receivedAt:1,evidenceRefs:[]},f.delivery);
 const result=terminalRead(f.store);expect(result.view.projection.executionState).toBe('completed');expect(result.view.projection.businessOutcome).toBe('success');expect(result.view.presentation.questions).toEqual([]);
 const db=new DatabaseSync(f.file);try{db.exec('DELETE FROM watch_event_receipts');expect(()=>terminalRead(f.store)).toThrow('attention_native_terminal_unverified');}finally{db.close();}
});
it('never treats a snapshot-only terminal state as an original terminal receipt',()=>{
 const f=fixture();f.read(f.inventory(2));f.store.reconcileSnapshot('watch','host-session',1,'completed',false,f.delivery);expect(()=>terminalRead(f.store)).toThrow('attention_native_terminal_unverified');
 const db=new DatabaseSync(f.file,{readOnly:true});try{expect((db.prepare('SELECT COUNT(*) AS n FROM activity_attention_question_heads WHERE is_open=1').get() as any).n).toBe(2);}finally{db.close();}
});
it('retains the original currently referenced Native terminal receipt through real retention cleanup',()=>{
 const f=fixture();f.read(f.inventory(2));f.store.ingest('watch',{schemaVersion:1,eventId:'terminal',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:1,transportGeneration:0,kind:'completed',receivedAt:1,evidenceRefs:[]},f.delivery);
 const db=new DatabaseSync(f.file);try{db.exec('UPDATE source_event_retention SET received_at=0');}finally{db.close();}
 f.store.pruneRetention();expect(terminalRead(f.store).view.presentation.questions).toEqual([]);
});

it('keeps an observed source gap unknown after later diagnostics and a same-turn Native input event',()=>{
 const f=fixture();f.read(f.inventory(2));f.store.ingestRetainedPage('watch',{sourceDataEpoch:'host-session',coveredThrough:1,gapRanges:[{from:1,through:1,reason:'progress_compacted'}],events:[]},f.delivery);
 f.store.setFreshness('watch','unavailable','transport_error',f.delivery);
 f.store.ingest('watch',{schemaVersion:2,eventId:'native-after-gap',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:2,transportGeneration:0,kind:'input_required',receivedAt:1,evidenceRefs:[],questionId:f.one.inputId,questionOwner:{schemaVersion:1,kind:'codex_native_approval',taskSessionId:'host-session',nativeIncarnation:f.reference.nativeIncarnation,nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeTurnGeneration:1,approvalToken:f.one.inputId,requestDigest:f.one.requestDigest}},f.delivery);
 expect(()=>f.read(f.inventory(3,[]))).toThrow('attention_native_coverage_unknown');expect(f.store.getProjection('watch')?.executionState).toBe('input_required');
});
it('preserves a verified independent block through the actual Native approval event writer sibling',()=>{
 const f=fixture();f.store.ingest('watch',{schemaVersion:1,eventId:'block',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:1,transportGeneration:0,kind:'blocked',receivedAt:1,evidenceRefs:[]},f.delivery);
 f.store.ingest('watch',{schemaVersion:2,eventId:'native-after-block',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:2,transportGeneration:0,kind:'input_required',receivedAt:1,evidenceRefs:[],questionId:f.one.inputId,questionOwner:{schemaVersion:1,kind:'codex_native_approval',taskSessionId:'host-session',nativeIncarnation:f.reference.nativeIncarnation,nativeSessionId:'native-session',nativeThreadId:'native-thread',nativeTurnId:'native-turn',nativeTurnGeneration:1,approvalToken:f.one.inputId,requestDigest:f.one.requestDigest}},f.delivery);
 expect(f.store.getProjection('watch')?.executionState).toBe('blocked');expect(f.read(f.inventory(2)).view.presentation.questions).toHaveLength(2);expect(f.read(f.inventory(3,[])).view.projection.executionState).toBe('blocked');
});
it.each(['direct','retained','retained-prefix'] as const)('persists a rejected %s source gap without accepting a page prefix or clearing Native questions',kind=>{
 const f=fixture();f.read(f.inventory(2));const before=f.store.getProjection('watch');
 const event={schemaVersion:1,eventId:'future',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'host-session',workId:'task',runId:'run',sourceSequence:kind==='retained-prefix'?3:2,transportGeneration:0,kind:'heartbeat',receivedAt:1,evidenceRefs:[]};
 if(kind==='direct')expect(()=>f.store.ingest('watch',event,f.delivery)).toThrow('activity_source_gap');
 else expect(()=>f.store.ingestRetainedPage('watch',{sourceDataEpoch:'host-session',coveredThrough:event.sourceSequence,gapRanges:[],events:kind==='retained-prefix'?[{...event,eventId:'prefix',sourceSequence:1},event]:[event]},f.delivery)).toThrow('activity_source_gap');
 expect(f.store.getProjection('watch')).toEqual(before);expect(f.store.getNativeAttentionEnrollment('watch')?.coverageLost).toBe(true);
 f.store.ingest('watch',{...event,eventId:'later-valid',sourceSequence:1},f.delivery);expect(()=>f.read(f.inventory(3,[]))).toThrow('attention_native_coverage_unknown');
 const db=new DatabaseSync(f.file,{readOnly:true});try{expect((db.prepare('SELECT COUNT(*) AS n FROM source_events').get() as {n:number}).n).toBe(1);}finally{db.close();}
});
