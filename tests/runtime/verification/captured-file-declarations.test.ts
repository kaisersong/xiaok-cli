import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const route=vi.hoisted(()=>({protected:false}));
// Only installed lookup is a fixture. All documents/leases/journals use actual producers.
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:unknown)=>route.protected?{kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...(owner as object)}}:{kind:'ordinary'}}));
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {FileGoalStore} from '../../../src/runtime/goal/file-store.js';
import {createGoalState} from '../../../src/runtime/goal/reducer.js';
import {createGoalCompletionIntent} from '../../../src/runtime/goal/completion-intent.js';
import {createGoalPublicationAttempt} from '../../../src/runtime/goal/publication-attempt.js';
import {createIntentPlan} from '../../../src/ai/intent-delegation/planner.js';
import {createEmptySessionIntentLedger,appendIntentToLedger} from '../../../src/runtime/intent-delegation/store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {intentNativeLedgerHash} from '../../../src/runtime/intent-delegation/native-contract-journal.js';
const cleanup:Array<()=>unknown>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();route.protected=false;});
function root(){const r=mkdtempSync(join(tmpdir(),'captured-declarations-'));cleanup.push(()=>rmSync(r,{recursive:true,force:true}));return r;}
async function sessionFixture(native=false){
 const r=root(),store=new FileSessionStore(r),planned=createIntentPlan({sessionId:'session',instanceId:'host',input:'请根据 /tmp/source.md 写一份中文报告',skills:[]});if(planned.kind!=='plan')throw Error('fixture plan');
 const ledger=appendIntentToLedger(createEmptySessionIntentLedger('session',1),planned.plan,1);ledger.instanceId='host';ledger.ownership={state:'owned',ownerInstanceId:'host',updatedAt:1};
 await store.save({sessionId:'session',cwd:r,createdAt:1,updatedAt:1,lineage:['ancestor','session'],forkedFromSessionId:'ancestor',messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[],intentDelegation:ledger});
 if(native){
  const next=createIntentPlan({sessionId:'session',instanceId:'host',input:'请写报告，然后生成幻灯片',skills:[]});if(next.kind!=='plan')throw Error('fixture next plan');
  const authority=createSessionExecutionAuthority({root:r,sessionIdentity:'session',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'captured'})});cleanup.push(()=>authority.dispose());const lease=await authority.acquire({invocationId:'native-reserve',kind:'direct-mutation'});cleanup.push(()=>lease.releaseAfterDrain());route.protected=true;
  const verification={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe:{kind:'artifact-content' as const,checks:[{id:'content',path:'result.md',sha256:'a'.repeat(64),structure:'utf8' as const}]}}]};
  await store.reserveIntentNativeContract({sessionId:'session',instanceId:'host',expectedLedgerHash:intentNativeLedgerHash((await store.load('session'))!.intentDelegation),plan:next.plan,definition:{verification,stages:next.plan.stages.map(stage=>({order:stage.order,templateId:stage.templateId,verification}))},requestSource:'user',now:10,lease});
 }
 return {store,raw:readFileSync(join(r,'session.json'),'utf8'),path:join(r,'session.json')};
}
async function goalFixture(){
 const r=root(),store=new FileGoalStore(r),first=createGoalState({sessionId:'session',objective:'first',expectedEvidenceKinds:['answer'],now:1});
 const intent=createGoalCompletionIntent({state:first,taskId:'task',turnId:'turn',summary:'claim',now:1});
 await store.commit({sessionId:'session',expectedRevision:null,next:{...first,status:'cancelled'},events:[{eventId:'event',goalId:first.goalId,revision:1,type:'created',actor:'user',recordedAt:1}],turns:[{goalId:first.goalId,epoch:1,turnId:'turn',tokensUsed:0,activeWallClockMs:0,recordedAt:1}],evidence:[{goalId:first.goalId,epoch:1,goalTurnId:'turn',evidenceId:'evidence',record:{ownerKind:'task',ownerId:'task',kind:'answer',summary:'answer'},recordedAt:1}],completionIntent:{expectedRevision:null,next:intent}});
 const attempt=createGoalPublicationAttempt(intent,'agent',2,1);await store.updateCompletionAttempt('session',{expectedRevision:null,next:attempt});
 await store.updateCompletionAttempt('session',{expectedRevision:1,next:{...attempt,revision:2,status:'not_prepared',retirement:{status:'not_prepared'},updatedAt:3}});
 const retry=createGoalPublicationAttempt(intent,'user',4,2);await store.updateCompletionAttempt('session',{expectedRevision:null,next:retry});
 const second=createGoalState({sessionId:'session',objective:'second',expectedEvidenceKinds:['answer'],now:5});await store.commit({sessionId:'session',expectedRevision:1,next:second,events:[],turns:[],evidence:[]});
 return {store,first,second,intent,retry,path:join(r,'session.goal.json'),raw:readFileSync(join(r,'session.goal.json'),'utf8')};
}
function assertDeclaredStageLists<T extends {stages?:unknown}>(records:T[]):asserts records is Array<T & {stages:unknown[]}>{for(const record of records)if(!Array.isArray(record.stages))throw TypeError('fixture_captured_stages');}
it('reads actual Session/native history as declarations while keeping lineage/fork separate',async()=>{
 const {readCapturedFileSession}=await import('../../../src/ai/runtime/session-store/file-store.js');const f=await sessionFixture(true),before=await f.store.load('session');
 const facts=readCapturedFileSession(f.raw,'session');expect(facts.kind).toBe('captured-source-declarations');expect(facts.containerSessionId).toBe('session');expect(facts.storedSessionIdentity).toBe('present');expect(facts.lineageReferences).toEqual(['ancestor','session']);expect(facts.forkReference).toBe('ancestor');
 const ledger=before!.intentDelegation!;expect(new Set(facts.intentSubjects.map(row=>row.intentId))).toEqual(new Set(ledger.intents.map(row=>row.intentId)));assertDeclaredStageLists(ledger.intents);expect(facts.intentSubjects).toHaveLength(ledger.intents.reduce((n,row)=>n+1+row.stages.length,0));
 expect(Object.isFrozen(facts)).toBe(true);expect(Object.isFrozen(facts.intentSubjects)).toBe(true);expect(Object.isFrozen(facts.intentSubjects[0])).toBe(true);expect(await f.store.load('session')).toEqual(before);expect(readFileSync(f.path,'utf8')).toBe(f.raw);
});
it.each(['absent','null'] as const)('preserves the original legacy Session container without assigning reference ownership: %s',async mode=>{
 const {readCapturedFileSession}=await import('../../../src/ai/runtime/session-store/file-store.js');const f=await sessionFixture(),value=JSON.parse(f.raw);delete value.lineage;delete value.intentDelegation;mode==='absent'?delete value.sessionId:value.sessionId=null;
 const facts=readCapturedFileSession(JSON.stringify(value),'session');expect(facts.containerSessionId).toBe('session');expect(facts.storedSessionIdentity).toBe(mode);expect(facts.lineageReferences).toEqual([]);expect(facts.forkReference).toBe('ancestor');
});
it('retains protected observation reference domains without making them local sessions',async()=>{
 const {readCapturedFileSession}=await import('../../../src/ai/runtime/session-store/file-store.js');const f=await sessionFixture(),value=JSON.parse(f.raw);
 const reference={authorityId:'11111111-1111-1111-1111-111111111111',profileId:'foreign-profile',sourceSessionId:'foreign-session',ownerAgentId:'agent',scopeId:'scope',permissionGeneration:1,observationId:'observation',contentHash:'a'.repeat(64),revision:1,policyId:'policy',policyRevision:1};value.protectedObservationClosure={version:1,requiresReauthorization:true,observations:[reference]};
 const facts=readCapturedFileSession(JSON.stringify(value),'session');expect(facts.observationReferences).toEqual([reference]);expect(facts.lineageReferences).not.toContain('foreign-session');expect(Object.isFrozen(facts.observationReferences[0])).toBe(true);
});
it.each(['duplicate','unknown','foreign','foreign-intent','native-hash','mirror'] as const)('rejects incomplete or ambiguous captured Session declarations: %s',async mode=>{
 const {readCapturedFileSession}=await import('../../../src/ai/runtime/session-store/file-store.js');const f=await sessionFixture(mode==='native-hash'),v=JSON.parse(f.raw);let raw:string;
 if(mode==='unknown')v.hiddenOwner={sessionId:'hidden'};if(mode==='foreign')v.sessionId='foreign';if(mode==='foreign-intent')v.intentDelegation.intents[0].sessionId='foreign';if(mode==='native-hash')v.intentDelegation.nativeContracts[0].contractHash='b'.repeat(64);if(mode==='mirror')v.intentDelegation.latestPlan.intentId='missing';raw=JSON.stringify(v);if(mode==='duplicate')raw=raw.replace('"sessionId":"session"','"sessionId":"hidden","sessionId":"session"');
 expect(()=>readCapturedFileSession(raw,'session')).toThrow();expect(readFileSync(f.path,'utf8')).toBe(f.raw);
});
it('captures all historical Goal declarations using actual old claim and retry journals',async()=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture(),before=await f.store.load('session'),facts=readCapturedGoalSessions(f.raw,'session');
 expect(facts.kind).toBe('captured-source-declarations');expect(facts.containerSessionId).toBe('session');expect(facts.declaredGoalIds).toEqual([f.first.goalId,f.second.goalId].sort());expect(facts.declaredTaskIds).toEqual(['task']);expect(facts.referencedOwners).toEqual([{ownerKind:'task',ownerId:'task'}]);expect(Object.isFrozen(facts.declaredGoalIds)).toBe(true);expect(await f.store.load('session')).toEqual(before);expect(readFileSync(f.path,'utf8')).toBe(f.raw);
});
it.each(['absent','null'] as const)('accepts original legacy Goal optional arrays and revision: %s',async mode=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture(),v=JSON.parse(f.raw);delete v.storageRevision;for(const field of ['events','turns','evidence','completionIntents','completionAttempts'])mode==='absent'?delete v[field]:v[field]=null;
 expect(readCapturedGoalSessions(JSON.stringify(v),'session').declaredGoalIds).toEqual([f.second.goalId]);
});
it.each(['duplicate','unknown','foreign','event-shape','orphan-evidence','orphan-attempt','duplicate-sequence','gap','revision','non-user-retry'] as const)('rejects invalid captured Goal history before returning any declaration: %s',async mode=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture(),v=JSON.parse(f.raw);let raw:string;
 if(mode==='unknown')v.hiddenOwner={goalId:'hidden'};if(mode==='foreign')v.state.sessionId='foreign';if(mode==='event-shape')v.events.push({goalId:'foreign'});if(mode==='orphan-evidence')v.evidence[0].goalTurnId='missing';if(mode==='orphan-attempt')v.completionAttempts[0].intentId='missing';if(mode==='duplicate-sequence')v.completionAttempts[1].sequence=1;if(mode==='gap')v.completionAttempts[1].sequence=3;if(mode==='revision')v.completionAttempts[0].revision=1;if(mode==='non-user-retry')v.completionAttempts[1].requestSource='agent';raw=JSON.stringify(v);if(mode==='duplicate')raw=raw.replace('"goalId":','"goalId":"hidden","goalId":');
 expect(()=>readCapturedGoalSessions(raw,'session')).toThrow();expect(readFileSync(f.path,'utf8')).toBe(f.raw);
});

it('accepts actual direct recovery commit and refuses any appended retry after it',async()=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture();
 const challenge={challengeId:'challenge',owner:{profileId:'profile',ownerKind:'goal' as const,ownerId:f.first.goalId},fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:200}};
 await f.store.updateCompletionAttempt('session',{expectedRevision:1,next:{...f.retry,revision:2,status:'committed',challenge,updatedAt:6,observation:{status:'committed',owner:challenge.owner,operationId:'operation',fullTupleHash:challenge.fullTupleHash,businessRevision:1,currentVerification:'valid'}}});
 const raw=readFileSync(f.path,'utf8');expect(readCapturedGoalSessions(raw,'session').declaredTaskIds).toEqual(['task']);
 const forbidden=createGoalPublicationAttempt(f.intent,'user',7,3);await expect(f.store.updateCompletionAttempt('session',{expectedRevision:null,next:forbidden})).rejects.toThrow('goal_attempt_creation');
 const value=JSON.parse(raw);value.completionAttempts.push(forbidden);expect(()=>readCapturedGoalSessions(JSON.stringify(value),'session')).toThrow('goal_journal_sequence');
});
it('validates a large reachable pending revision without iterating its numeric value',async()=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture();
 const challenge={challengeId:'challenge',owner:{profileId:'profile',ownerKind:'goal' as const,ownerId:f.first.goalId},fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:200}};
 await f.store.updateCompletionAttempt('session',{expectedRevision:1,next:{...f.retry,revision:2,status:'pending',challenge,updatedAt:6,observation:{status:'unknown',owner:challenge.owner,operationId:'operation',fullTupleHash:challenge.fullTupleHash,businessRevision:1,currentVerification:'unavailable'}}});
 const value=JSON.parse(readFileSync(f.path,'utf8'));value.completionAttempts[1].revision=Number.MAX_SAFE_INTEGER;
 // This is a structural reachability fixture, not evidence of real approvals
 // or of that many historical publication calls.
 expect(readCapturedGoalSessions(JSON.stringify(value),'session').declaredTaskIds).toEqual(['task']);
},1000);

it.each(['missing','historical'] as const)('refuses a Goal pending pointer without its matching current application: %s',async mode=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture(),v=JSON.parse(f.raw);v.state.pendingCompletionIntentId=mode==='missing'?'missing':f.intent.intentId;
 expect(()=>readCapturedGoalSessions(JSON.stringify(v),'session')).toThrow('captured_goal_pending_intent');
});

it('keeps the exact declared ancestry order and repeated references',async()=>{
 const {readCapturedFileSession}=await import('../../../src/ai/runtime/session-store/file-store.js');const f=await sessionFixture(),v=JSON.parse(f.raw);v.lineage=['z','m','z'];
 expect(readCapturedFileSession(JSON.stringify(v),'session').lineageReferences).toEqual(['z','m','z']);
});
it.each(['null-message','empty-usage','invalid-block','invalid-role','negative-usage'] as const)('rejects invalid captured Session core data: %s',async kind=>{
 const {readCapturedFileSession}=await import('../../../src/ai/runtime/session-store/file-store.js');const f=await sessionFixture(),v=JSON.parse(f.raw);
 if(kind==='null-message')v.messages=[null];if(kind==='empty-usage')v.usage={};if(kind==='invalid-block')v.messages=[{role:'user',content:[{type:'text',text:42}]}];if(kind==='invalid-role')v.messages=[{role:'system',content:[]}];if(kind==='negative-usage')v.usage.inputTokens=-1;
 expect(()=>readCapturedFileSession(JSON.stringify(v),'session')).toThrow();
});
it.each(['number-objective','object-evidence-kinds','array-criterion','string-evidence-kinds','unknown-evidence-kind','duplicate-evidence-kind'] as const)('checks raw Goal business field types before original normalization: %s',async kind=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture(),v=JSON.parse(f.raw);
 if(kind==='number-objective')v.state.objective=42;if(kind==='object-evidence-kinds')v.state.expectedEvidenceKinds={};if(kind==='array-criterion')v.state.completionCriterion=[];if(kind==='string-evidence-kinds')v.state.expectedEvidenceKinds='answer';if(kind==='unknown-evidence-kind')v.state.expectedEvidenceKinds=['unknown'];if(kind==='duplicate-evidence-kind')v.state.expectedEvidenceKinds=['answer','answer'];
 expect(()=>readCapturedGoalSessions(JSON.stringify(v),'session')).toThrow();
});

it.each([0,false,''])('refuses non-null falsy attempt fields in capture and the original writer: %j',async invalid=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');
 const {applyGoalPublicationAttemptUpdate}=await import('../../../src/runtime/goal/publication-attempt.js');
 const f=await goalFixture();
 for(const field of ['challenge','observation'] as const){
  for(const index of [0,1]){
   const v=JSON.parse(f.raw);v.completionAttempts[index][field]=invalid;
   expect(()=>readCapturedGoalSessions(JSON.stringify(v),'session')).toThrow();
  }
  const next={...createGoalPublicationAttempt(f.intent,'user',7,1),[field]:invalid};
  expect(()=>applyGoalPublicationAttemptUpdate([],f.intent,{expectedRevision:null,next:next as never})).toThrow();
 }
});
it.each(['file','sqlite'] as const)('retains original compound and forked Skill session references for %s snapshots',async kind=>{
 const {readCapturedSessionDocument,readCapturedFileSession}=await import('../../../src/ai/runtime/session-store/file-store.js');
 const {SQLiteSessionStore}=await import('../../../src/ai/runtime/session-store/sqlite-store.js');
 const {createCompoundOperationLedger,createOrGetCompoundOperation}=await import('../../../src/runtime/sol-pi/compound-operation.js');
 const {activateSkillInvocation,createEmptySessionSkillExecutionState}=await import('../../../src/ai/skills/execution-state.js');
 const r=root(),store=kind==='file'?new FileSessionStore(r):new SQLiteSessionStore(join(r,'sessions.sqlite'));if(store instanceof SQLiteSessionStore)cleanup.push(()=>store.dispose());
 const ledger=createOrGetCompoundOperation(createCompoundOperationLedger(),{dispatch:{sessionIdentity:'historical-session',hostProviderInvocationId:'provider',originalToolUseId:'tool'},inputHash:'a'.repeat(64),toolName:'write',ownerId:'host',requestSource:'user',scopeId:'scope',permissionGeneration:1}).ledger;
 const skill=activateSkillInvocation(createEmptySessionSkillExecutionState(1),{sessionId:'fork-source',agentId:'host',plan:{type:'skill_plan',requested:['fixture'],resolved:[],strategy:'inline',primarySkill:'fixture',strict:false},now:1});
 await store.save({sessionId:'session',cwd:r,createdAt:1,updatedAt:1,lineage:[],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[],skillExecution:skill.state});
 const authority=createSessionExecutionAuthority({root:r,sessionIdentity:'session',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});cleanup.push(()=>authority.dispose());const lease=await authority.acquire({invocationId:'compound',kind:'compound'});
 try{const old=(await store.load('session'))!;await store.compareAndSave({expectedStoreRevision:old.storeRevision!,expectedHistoryDigest:old.historyDigest!,nextSnapshot:{...old,compoundOperations:ledger},lease});}finally{await lease.releaseAfterDrain();}
 const read=kind==='file'?()=>readCapturedFileSession(readFileSync(join(r,'session.json'),'utf8'),'session'):async()=>readCapturedSessionDocument(JSON.stringify({schemaVersion:1,...await store.load('session')}),'session');
 const facts=await read();expect(facts.sessionReferences).toEqual(expect.arrayContaining([{relation:'compound-operation',recordId:ledger.operations[0]!.id,sessionIdentity:'historical-session'},{relation:'skill-invocation',recordId:skill.invocation.invocationId,sessionIdentity:'fork-source'}]));expect(facts.containerSessionId).toBe('session');
});
it('preserves original prompt, memory, approval and background namespaces without merging them into session ownership',async()=>{
 const {readCapturedFileSession}=await import('../../../src/ai/runtime/session-store/file-store.js');const f=await sessionFixture(),v=JSON.parse(f.raw);v.promptSnapshotId='shared';v.memoryRefs=['shared','shared'];v.approvalRefs=['shared'];v.backgroundJobRefs=['shared'];
 expect(readCapturedFileSession(JSON.stringify(v),'session').typedReferences).toEqual([{namespace:'prompt-snapshot',identity:'shared'},{namespace:'memory',identity:'shared'},{namespace:'memory',identity:'shared'},{namespace:'approval',identity:'shared'},{namespace:'background-job',identity:'shared'}]);
 for(const key of ['memoryRefs','approvalRefs','backgroundJobRefs'])expect(()=>readCapturedFileSession(JSON.stringify({...v,[key]:{sessionId:'hidden'}}),'session')).toThrow();
});
it('rejects an unreachable claimed Goal intent revision in File capture too',async()=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture(),v=JSON.parse(f.raw);v.completionIntents[0].revision=2;
 expect(()=>readCapturedGoalSessions(JSON.stringify(v),'session')).toThrow('goal_intent_revision');
});
it('keeps original direct attempt finalization committed at revision two in captured File history',async()=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture();
 const challenge={challengeId:'challenge',owner:{profileId:'profile',ownerKind:'goal' as const,ownerId:f.first.goalId},fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:200}};
 await f.store.updateCompletionAttempt('session',{expectedRevision:1,next:{...f.retry,revision:2,status:'committed',challenge,updatedAt:6,observation:{status:'committed',owner:challenge.owner,operationId:'operation',fullTupleHash:challenge.fullTupleHash,businessRevision:1,currentVerification:'valid'}}});
 await f.store.finalizeCompletionAttempt('session',f.retry.attemptId);
 const v=JSON.parse(readFileSync(f.path,'utf8'));expect(v.completionIntents[0]).toMatchObject({status:'committed',revision:2});expect(readCapturedGoalSessions(JSON.stringify(v),'session').declaredTaskIds).toEqual(['task']);
});
it('rejects a same-Goal current-epoch application mismatch without rejecting different historical goals',async()=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture(),v=JSON.parse(f.raw);v.state={...f.first,status:'cancelled',objective:'different objective'};
 expect(()=>readCapturedGoalSessions(JSON.stringify(v),'session')).toThrow('captured_goal_intent_application');
});
it('retains all actual Goal publication records including foreign profile, challenge and operation identity',async()=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js');const f=await goalFixture();
 const challenge={challengeId:'original-challenge',owner:{profileId:'foreign-profile',ownerKind:'goal' as const,ownerId:f.first.goalId},fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1,validUntil:200}};
 await f.store.updateCompletionAttempt('session',{expectedRevision:1,next:{...f.retry,revision:2,status:'committed',challenge,updatedAt:6,observation:{status:'committed',owner:challenge.owner,operationId:'original-operation',fullTupleHash:challenge.fullTupleHash,businessRevision:1,currentVerification:'valid'}}});
 const raw=readFileSync(f.path,'utf8'),value=JSON.parse(raw),facts=readCapturedGoalSessions(raw,'session');expect(facts.publication).toEqual({intents:value.completionIntents,attempts:value.completionAttempts});expect(Object.isFrozen(facts.publication.attempts[1]!.challenge!.owner)).toBe(true);
});


it('keeps historical Goal task associations separate from the new empty Goal',async()=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js'),f=await goalFixture(),facts=readCapturedGoalSessions(f.raw,'session');
 const associations=Reflect.get(facts,'goalAssociations');expect(Array.isArray(associations)).toBe(true);
 expect(associations).toEqual([f.first.goalId,f.second.goalId].sort().map(goalId=>({goalId,logicalContainerId:'session',completionTasks:goalId===f.first.goalId?[{intentId:f.intent.intentId,taskId:'task',epoch:1,originalPath:'completionIntents[0]'}]:[],evidenceOwners:goalId===f.first.goalId?[{ownerKind:'task',ownerId:'task',epoch:1,goalTurnId:'turn',evidenceId:'evidence',originalPath:'evidence[0]',kind:'answer',summary:'answer',recordedAt:1}]:[]})));
 expect(Object.isFrozen(associations)).toBe(true);expect(Object.isFrozen(associations[0])).toBe(true);expect(readFileSync(f.path,'utf8')).toBe(f.raw);
});
it('retains actual same-owner evidence in each original epoch including URI and metadata',async()=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js'),{reduceGoal}=await import('../../../src/runtime/goal/reducer.js');
 const r=root(),store=new FileGoalStore(r),first=createGoalState({sessionId:'epochs',objective:'first',expectedEvidenceKinds:['answer'],now:1});
 const record={ownerKind:'task' as const,ownerId:'same-task',kind:'answer' as const,summary:'full original summary',uri:'file:///original/result.md',metadata:{original:{ownerId:'opaque-not-a-grant'},list:[1,2]}};
 await store.commit({sessionId:'epochs',expectedRevision:null,next:first,events:[],turns:[{goalId:first.goalId,epoch:1,turnId:'turn-1',tokensUsed:0,activeWallClockMs:0,recordedAt:1}],evidence:[{goalId:first.goalId,epoch:1,goalTurnId:'turn-1',evidenceId:'ev-1',record,recordedAt:1}]});
 const next=reduceGoal(first,{type:'replace',objective:'second epoch',expectedEvidenceKinds:['answer'],now:2});
 await store.commit({sessionId:'epochs',expectedRevision:first.revision,next,events:[],turns:[{goalId:first.goalId,epoch:2,turnId:'turn-2',tokensUsed:0,activeWallClockMs:0,recordedAt:2}],evidence:[{goalId:first.goalId,epoch:2,goalTurnId:'turn-2',evidenceId:'ev-2',record,recordedAt:2}]});
 const path=join(r,'epochs.goal.json'),raw=readFileSync(path,'utf8'),facts=readCapturedGoalSessions(raw,'epochs'),associations=Reflect.get(facts,'goalAssociations');expect(Array.isArray(associations)).toBe(true);
 const evidence=associations[0].evidenceOwners;expect(evidence).toHaveLength(2);expect(evidence.map((v:any)=>[v.epoch,v.goalTurnId,v.evidenceId,v.originalPath,v.recordedAt])).toEqual([[1,'turn-1','ev-1','evidence[0]',1],[2,'turn-2','ev-2','evidence[1]',2]]);
 for(const v of evidence){expect(v).toMatchObject(record);if(v.metadata===undefined)throw Error('captured_evidence_metadata_missing');expect(Object.isFrozen(v.metadata.original)).toBe(true);expect(Object.isFrozen(v.metadata.list)).toBe(true);}expect(facts.referencedOwners).toEqual([{ownerKind:'task',ownerId:'same-task'}]);expect(readFileSync(path,'utf8')).toBe(raw);
});
it.each(['absent','null'] as const)('retains an empty association for an original legacy Goal: %s',async mode=>{
 const {readCapturedGoalSessions}=await import('../../../src/runtime/goal/file-store.js'),f=await goalFixture(),v=JSON.parse(f.raw);for(const field of ['events','turns','evidence','completionIntents','completionAttempts'])mode==='absent'?delete v[field]:v[field]=null;
 expect(Reflect.get(readCapturedGoalSessions(JSON.stringify(v),'session'),'goalAssociations')).toEqual([{goalId:f.second.goalId,logicalContainerId:'session',completionTasks:[],evidenceOwners:[]}]);
});
