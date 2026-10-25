import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {intentNativeLedgerHash,parseIntentNativeContracts} from '../../../src/runtime/intent-delegation/native-contract-journal.js';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
const wire=vi.hoisted(()=>({protected:false}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:any)=>wire.protected?{kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...owner}}:{kind:'ordinary'}}));
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {SQLiteSessionStore} from '../../../src/ai/runtime/session-store/sqlite-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createIntentPlan} from '../../../src/ai/intent-delegation/planner.js';
import {createEmptySessionIntentLedger,appendIntentToLedger} from '../../../src/runtime/intent-delegation/store.js';
import {captureIntentData} from '../../../src/runtime/intent-delegation/intent-commit-boundary.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const cleanup:Array<()=>unknown>=[];afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();wire.protected=false;});
const definition=()=>({version:1,obligations:[{obligationId:'original',predicateId:'original-content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.md',sha256:'a'.repeat(64),structure:'utf8'}]}}]});
async function fixture(kind:'file'|'sqlite',empty=false){
 const root=mkdtempSync(join(tmpdir(),'intent-native-store-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=kind==='file'?new FileSessionStore(root):new SQLiteSessionStore(join(root,'sessions.sqlite'));if(store instanceof SQLiteSessionStore)cleanup.push(()=>store.dispose());
 const old=createIntentPlan({sessionId:'session',instanceId:'host',input:'请根据 /tmp/old.md 写一份中文报告',skills:[]}),next=createIntentPlan({sessionId:'session',instanceId:'host',input:'请写报告，然后生成幻灯片',skills:[]});if(old.kind!=='plan'||next.kind!=='plan')throw Error('actual planner fixture');
 const ledger=appendIntentToLedger(createEmptySessionIntentLedger('session',1),old.plan,1);ledger.ownership={state:'owned',ownerInstanceId:'host',updatedAt:1};ledger.instanceId='host';
 await store.save({sessionId:'session',cwd:root,createdAt:1,updatedAt:1,lineage:['session'],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[],...(empty?{}:{intentDelegation:ledger})});
 const authority=createSessionExecutionAuthority({root,sessionIdentity:'session',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'native-original'})});cleanup.push(()=>authority.dispose());
 const lease=await authority.acquire({invocationId:'reserve-original',kind:'direct-mutation'});cleanup.push(()=>lease.releaseAfterDrain());wire.protected=true;
 const request={sessionId:'session',instanceId:'host',expectedLedgerHash:createHash('sha256').update('xiaok-intent-native-ledger-v1\0').update(json(captureIntentData((await store.load('session'))!.intentDelegation??null))).digest('hex'),plan:next.plan,definition:{verification:definition(),stages:next.plan.stages.map(stage=>({order:stage.order,templateId:stage.templateId,verification:definition()}))},requestSource:'user',now:10,lease};
 return {store,lease,request,root,authority};
}
for(const kind of ['file','sqlite'] as const)it(`${kind}: actual producer completion captures original reports and an immutable application request without business success`,async()=>{
 const f=await fixture(kind),original=await f.store.reserveIntentNativeContract(f.request as any);let now=20;
 for(const subject of original.subjects){let current=storedFixtureNativeContracts(f.store.getIntentNativeLedgerSync('session')!)[0];const base={sessionId:'session',instanceId:'host',intentId:original.intentId,expectedRevision:current.revision,expectedRequestId:subject.attempts[0].requestId,stageId:subject.stageId,retirementReason:null,requestSource:'user',now:now++,lease:f.lease};await f.store.advanceIntentNativeContractSubject({...base,phase:'enrolling'} as any);current=storedFixtureNativeContracts(f.store.getIntentNativeLedgerSync('session')!)[0];await f.store.advanceIntentNativeContractSubject({...base,expectedRevision:current.revision,phase:'enrolled',now:now++} as any);}
 const stage=original.contract.stages[0];for(const step of stage.steps){const ledger=f.store.getIntentNativeLedgerSync('session')!;await f.store.recordIntentProducerAction({sessionId:'session',instanceId:'host',intentId:original.intentId,expectedLedgerHash:createHash('sha256').update(json(captureIntentData(ledger))).digest('hex'),requestSource:'user',now:now++,lease:f.lease,action:{kind:'step-report',stepId:step.stepId,status:'completed',breadcrumb:'原完整执行报告',receiptNote:null,blockedReason:null,origin:{kind:'model-report',providerInvocationId:'provider-'+step.stepId,toolInvocationId:'tool-'+step.stepId}}});}
 const before=f.store.getIntentNativeLedgerSync('session')!,row=await (f.store as any).reserveIntentPublicationCandidate({sessionId:'session',instanceId:'host',expectedLedgerHash:intentNativeLedgerHash(before),artifactSelections:[],fileObservations:[],requestSource:'user',now:now++,lease:f.lease});
 const after=f.store.getIntentNativeLedgerSync('session')!;expect(after.intents).toEqual(before.intents);expect(after.nativeContracts).toEqual(before.nativeContracts);expect(row.body.producerReports).toEqual(before.intents.at(-1)!.producerReports);expect(row.body.executionReports).toEqual([]);expect(row.applicationAttempts[0].phase).toBe('reserved');expect(after.intents.at(-1)!.overallStatus).toBe('publication_pending');
 const saved=await f.store.load('session'),request={sessionId:'session',instanceId:'host',expectedLedgerHash:intentNativeLedgerHash(after),artifactSelections:[],fileObservations:[],requestSource:'user',now:now++,lease:f.lease};
 expect(await (f.store as any).reserveIntentPublicationCandidate(request)).toEqual(row);expect(await f.store.load('session')).toEqual(saved);
 for(const input of [{...request,requestSource:'agent'},{...request,requestSource:'scheduler'},{...request,ownerId:'forged'},{...request,expectedLedgerHash:'0'.repeat(64)}])await expect((f.store as any).reserveIntentPublicationCandidate(input)).rejects.toThrow();
 let reads=0;await expect((f.store as any).reserveIntentPublicationCandidate({...request,get artifactSelections(){reads++;return [];}})).rejects.toThrow();expect(reads).toBe(0);
 for(const mutate of [(s:any)=>{delete s.intentDelegation.publicationCandidates;},(s:any)=>{s.intentDelegation.publicationCandidates[0].body.summary='forged';},(s:any)=>{s.intentDelegation.publicationCandidates[0].applicationAttempts[0].phase='ready';}]){const changed=structuredClone(saved);mutate(changed);await expect(f.store.save(changed!,{lease:f.lease})).rejects.toThrow();}
 expect(await f.store.load('session')).toEqual(saved);
 const claimed=await (f.store as any).claimIntentPublicationApplication({sessionId:'session',instanceId:'host',candidateId:row.id,expectedLedgerHash:intentNativeLedgerHash(after),expectedRequestId:row.applicationAttempts[0].requestId,expectedRevision:1,route:json({kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...intentHostSubjectOwner({version:1,sessionId:'session',intentId:original.intentId,stageId:stage.stageId})}}),requestSource:'user',now:now++,lease:f.lease});
 expect(claimed.applicationAttempts[0].phase).toBe('preparing');expect(claimed.applicationAttempts[0].requestId).toBe(row.applicationAttempts[0].requestId);expect(f.store.getIntentNativeLedgerSync('session')!.intents).toEqual(before.intents);
 const retired=await (f.store as any).observeIntentPublicationApplication({sessionId:'session',instanceId:'host',candidateId:row.id,expectedLedgerHash:intentNativeLedgerHash(f.store.getIntentNativeLedgerSync('session')),expectedRequestId:row.applicationAttempts[0].requestId,expectedRevision:2,observation:{state:'not_prepared'},sourceChanged:false,requestSource:'user',now:now++,lease:f.lease});expect(retired.applicationAttempts[0].phase).toBe('retired');expect(retired.applicationAttempts[0].observation.state).toBe('not_prepared');
 const retried=await (f.store as any).retryIntentPublicationApplication({sessionId:'session',instanceId:'host',candidateId:row.id,expectedLedgerHash:intentNativeLedgerHash(f.store.getIntentNativeLedgerSync('session')),expectedRequestId:row.applicationAttempts[0].requestId,expectedRevision:3,requestSource:'user',now:now++,lease:f.lease});expect(retried.applicationAttempts).toHaveLength(2);expect(retried.applicationAttempts[0]).toEqual(retired.applicationAttempts[0]);expect(retried.applicationAttempts[1].phase).toBe('reserved');expect(retried.applicationAttempts[1].requestId).not.toBe(row.applicationAttempts[0].requestId);
 // The captured reader must preserve all native/application domains too; this
 // consumes the actual producer snapshot and issues no capacity/owner grant.
 const {readCapturedSessionDocument}=await import('../../../src/ai/runtime/session-store/file-store.js');
 const snapshot=(await f.store.load('session'))!,declarations=readCapturedSessionDocument(JSON.stringify({schemaVersion:1,...snapshot}),'session');
 expect(declarations.publicationDeclarations).toEqual({nativeContracts:snapshot.intentDelegation!.nativeContracts,candidates:snapshot.intentDelegation!.publicationCandidates,verificationExecutions:[]});
 expect(Object.isFrozen(declarations.publicationDeclarations.candidates[0]!.applicationAttempts[0])).toBe(true);
 const damaged=JSON.parse(JSON.stringify({schemaVersion:1,...snapshot}));damaged.intentDelegation.publicationCandidates[0].bodyHash='0'.repeat(64);
 expect(()=>readCapturedSessionDocument(JSON.stringify(damaged),'session')).toThrow();
 // Actual Store observation derives route staleness itself, regardless of the
 // caller's sourceChanged:false. Historical recovery remains writable.
 const second=await f.store.claimIntentPublicationApplication({sessionId:'session',instanceId:'host',candidateId:row.id,expectedLedgerHash:intentNativeLedgerHash(f.store.getIntentNativeLedgerSync('session')),expectedRequestId:retried.applicationAttempts[1].requestId,expectedRevision:1,route:claimed.applicationAttempts[0].route!,requestSource:'user',now:now++,lease:f.lease});
 wire.protected=false;
 const stale=await f.store.observeIntentPublicationApplication({sessionId:'session',instanceId:'host',candidateId:row.id,expectedLedgerHash:intentNativeLedgerHash(f.store.getIntentNativeLedgerSync('session')),expectedRequestId:second.applicationAttempts[1].requestId,expectedRevision:2,observation:{state:'not_prepared'},sourceChanged:false,requestSource:'user',now:now++,lease:f.lease});
 expect(stale.applicationAttempts[1].phase).toBe('stale');expect(stale.applicationAttempts[1].retirementReason).toBe('source_changed');



});

for(const kind of ['file','sqlite'] as const)it(`${kind}: actual producer retains 10 KiB inline report twice in the complete legal stage body`,async()=>{
 const f=await fixture(kind),native=await f.store.reserveIntentNativeContract(f.request as any);let now=20;
 for(const subject of native.subjects){let current=storedFixtureNativeContracts(f.store.getIntentNativeLedgerSync('session')!)[0]!;const base={sessionId:'session',instanceId:'host',intentId:native.intentId,expectedRevision:current.revision,expectedRequestId:subject.attempts[0]!.requestId,stageId:subject.stageId,retirementReason:null,requestSource:'user',now:now++,lease:f.lease};await f.store.advanceIntentNativeContractSubject({...base,phase:'enrolling'} as any);current=storedFixtureNativeContracts(f.store.getIntentNativeLedgerSync('session')!)[0]!;await f.store.advanceIntentNativeContractSubject({...base,expectedRevision:current.revision,phase:'enrolled',now:now++} as any);}
 const stage=native.contract.stages[0]!,text='x'.repeat(10000);const record=async(action:any)=>{const ledger=f.store.getIntentNativeLedgerSync('session')!;await f.store.recordIntentProducerAction({sessionId:'session',instanceId:'host',intentId:native.intentId,expectedLedgerHash:createHash('sha256').update(json(ledger)).digest('hex'),requestSource:'user',now:now++,lease:f.lease,action});};
 await record({kind:'artifact-report',stageId:stage.stageId,kindOfArtifact:'report',storage:'inline',label:'original',path:null,inlineValue:text,summary:null,reportedStructuralValidation:'pending',reportedSemanticValidation:'pending',origin:{kind:'model-report',providerInvocationId:'actual-artifact-provider',toolInvocationId:'actual-artifact-tool'}});
 for(const step of stage.steps)await record({kind:'step-report',stepId:step.stepId,status:'completed',breadcrumb:'actual result',receiptNote:null,blockedReason:null,origin:{kind:'model-report',providerInvocationId:'actual-provider-'+step.stepId,toolInvocationId:'actual-tool-'+step.stepId}});
 const ledger=f.store.getIntentNativeLedgerSync('session')!,original=ledger.intents.find(r=>r.intentId===native.intentId)!.artifacts![0]!;
 const candidate=await f.store.reserveIntentPublicationCandidate({sessionId:'session',instanceId:'host',expectedLedgerHash:intentNativeLedgerHash(ledger),requestSource:'user',now:now++,lease:f.lease,artifactSelections:[{artifactId:storedFixtureString(storedFixtureObject(original).artifactId),obligationId:'original',path:'result.md'}],fileObservations:[]});
 expect(candidate.body.kind).toBe('intent-stage');if(candidate.body.kind!=='intent-stage')throw Error('stage');expect(candidate.body.artifacts[0]!.content).toEqual({kind:'inline',text});expect(candidate.body.producerReports!.find(r=>r.action.kind==='artifact-report')!.action).toMatchObject({inlineValue:text});
 console.info(json({kind,actualStageBodyBytes:Buffer.byteLength(json(candidate.body)),actualLedgerBytes:Buffer.byteLength(json(f.store.getIntentNativeLedgerSync('session')))}));
});

// Test-only observations keep original raw references; no authority or modern ledger assertion.
function isStoredFixtureObject(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function storedFixtureObject(value:unknown):Record<string,unknown>{
 if(!isStoredFixtureObject(value))throw Error('stored_fixture_object');
 return value;
}
function storedFixtureString(value:unknown):string{
 if(typeof value!=='string')throw Error('stored_fixture_string');
 return value;
}
function storedFixtureNativeContracts(ledger:{sessionId:string;nativeContracts?:unknown}){
 return parseIntentNativeContracts(ledger.nativeContracts,ledger.sessionId);
}
