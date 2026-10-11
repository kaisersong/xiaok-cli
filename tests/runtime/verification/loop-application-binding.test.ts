import {expect,it} from 'vitest';
import {createLoopApplicationBinding,parseLoopApplicationBinding,loopApplicationBindingHash} from '../../../src/runtime/verification/loop-application-binding.js';
import {assertLoopApplicationArtifacts} from '../../../src/runtime/verification/loop-application-artifacts.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';

const H='a'.repeat(64);
function base():any {
 return {version:1,kind:'loop',subject:{kind:'loop-run',loopId:'artifact-evidence-regression',runId:'run',stage:null},candidateId:'batch',candidateRevision:1,
 originalTriggerJson:json({kind:'manual',source:'user'}),logicalRunKey:null,
 contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Publish the original diagnostic report.',completionCriterion:'Preserve the complete scan and original verification obligations.'},
 body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1000,summary:'Original scan.',nextActionKind:'none',nextActionSummary:null,
 diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:1,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},artifacts:[]}};
}
function assistant(kind:'evening'|'morning'='evening'):any {
 const value=base();value.subject.loopId=kind==='evening'?'personal-assistant-evening-reflection':'personal-assistant-morning-briefing';
 value.originalTriggerJson=json({kind:'assistant',assistantKind:kind,logicalRunKey:'original-key',source:'scheduled'});value.logicalRunKey='original-key';
 value.contract={version:1,kind:'assistant',assistantKind:kind,profileId:'default-personal-assistant',locale:'zh',timeZone:'Asia/Shanghai',dataScopes:['tasks','threads'],objective:'Publish original assistant output.',completionCriterion:'Preserve approved scope and original evidence.'};
 value.body=kind==='evening'?{kind:'assistant-evening',summary:'Original evening.',candidates:[candidate('one')],artifacts:[]}:
 {kind:'assistant-morning',recommendations:[{title:'Original recommendation',reasonCode:'open_task',evidenceRefs:[{kind:'task',id:'t1'}]}],artifacts:[]};return value;
}
function candidate(id:string):any {return{id,runId:'run',kind:'follow_up',title:'Original '+id,content:'Complete content '+id,scope:'global',projectId:null,confidence:0.75,evidenceRefs:[{kind:'task',id:'t1'}],dedupeKey:'original-'+id};}
function template():any {
 const value=base();value.contract={version:1,kind:'user-template',templateKind:'task_completion',prompt:'Original prompt.',outputDirectory:'',outputFileName:'',loopContract:{schemaVersion:'loop_contract_v1',objective:'Separate original objective.',triggerPolicy:{kind:'manual'},successCriteria:[{kind:'task_completed',strength:'weak'}],stopPolicy:{},permissionPolicy:{mode:'read_only',autoRunApproved:false,allowedToolCategories:[]},concurrencyPolicy:{perLoop:'skip_if_running',coalesceMissedRuns:false}}};
 value.body={kind:'user-template',taskId:'actual-task',executeStageId:'execute',verifyStageId:'verify',summary:'Original result.',evidenceIds:['evidence'],artifacts:[]};return value;
}
function health():any {
 const value=base();value.subject.loopId='kswarm-service-health';value.contract.scanner='kswarm-service-health';value.body.scanner='kswarm-service-health';
 value.body.diagnostic={kind:'kswarm-service-health',openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[],diagnosticKinds:[],findings:['No service anomaly.'],suggestedActions:[],logPaths:['/diagnostic-only/service.log']};return value;
}
function artifact():any {return{selection:{kind:'local',obligationId:'original',path:'out/report.txt'},sha256:H,size:4};}
function reject(change:(v:any)=>void,factory:()=>any=base){const value=factory();change(value);expect(()=>createLoopApplicationBinding(value)).toThrow();}

it.each([['builtin',base],['health',health],['user-template',template],['evening',()=>assistant()],['morning',()=>assistant('morning')]] as const)('captures full actual producer description: %s',(_name,factory)=>{
 const source=factory(),value=createLoopApplicationBinding(source);
 expect(parseLoopApplicationBinding(value)).toEqual(value);expect(value).toMatchObject(source);
 for(const field of ['triggerHash','contractHash','candidatePayloadHash'] as const)expect(value[field]).toMatch(/^[a-f0-9]{64}$/);
 expect(loopApplicationBindingHash(value)).toMatch(/^[a-f0-9]{64}$/);
 expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(value.subject)).toBe(true);expect(Object.isFrozen(value.contract)).toBe(true);expect(Object.isFrozen(value.body)).toBe(true);
});
it('preserves task-only empty outputs and distinct prompt/objective without minting proof',()=>{
 const value=createLoopApplicationBinding(template());expect(value.contract).toMatchObject({outputDirectory:'',outputFileName:'',prompt:'Original prompt.',loopContract:{objective:'Separate original objective.',successCriteria:[{kind:'task_completed',strength:'weak'}]}});
 expect(Object.keys(value).sort()).toEqual(['version','kind','subject','candidateId','candidateRevision','originalTriggerJson','triggerHash','logicalRunKey','contract','contractHash','body','candidatePayloadHash'].sort());
});
it('rejects a non-enumerable required root field before candidate capture',()=>{
 const raw=base();Object.defineProperty(raw,'contract',{value:raw.contract,enumerable:false,writable:true,configurable:true});
 expect(()=>createLoopApplicationBinding(raw)).toThrow('loop_application_shape');
});
it.each([
 ['wrong version','version','loop_application_kind'],
 ['invalid subject','subject','loop_subject_shape'],
 ['invalid candidate id','candidateId','loop_application_identity'],
 ['invalid revision','candidateRevision','loop_application_number'],
] as const)('preserves historical %s error before malformed trigger parsing',(_name,field,error)=>{
 const raw=base();raw.originalTriggerJson='{';
 if(field==='version')raw.version=2;
 if(field==='subject')raw.subject={};
 if(field==='candidateId')raw.candidateId='';
 if(field==='candidateRevision')raw.candidateRevision=0;
 expect(()=>createLoopApplicationBinding(raw)).toThrow(error);
});
it.each([['non-string',42],['blank',' ']] as const)('preserves trigger text validation for %s input',(_name,trigger)=>{
 const raw=base();raw.originalTriggerJson=trigger;
 expect(()=>createLoopApplicationBinding(raw)).toThrow('loop_application_text');
});
it('parses the trigger once after complete capture, so JSON.parse reentry cannot alter the bound candidate',()=>{
 const expected=createLoopApplicationBinding(base()),raw=base(),original=JSON.parse;let triggerParses=0;
 try{
  JSON.parse=function(text:any,...args:any[]){if(text===raw.originalTriggerJson){triggerParses++;raw.body.summary='reentered';}return Reflect.apply(original,this,[text,...args]);} as typeof JSON.parse;
  const actual=createLoopApplicationBinding(raw);
  expect(triggerParses).toBe(1);expect(actual.body.summary).toBe('Original scan.');expect(actual.candidatePayloadHash).toBe(expected.candidatePayloadHash);
 }finally{JSON.parse=original;}
});
it('Loop wrapper checks all section shapes before path preflight through its public entry',()=>{
 const binding=createLoopApplicationBinding(base()),owner={profileId:'profile',...loopHostSubjectOwner(binding.subject)},artifact={path:'x'.repeat(5000),sha256:H,size:0,bytesBase64:''};
 const section={obligationId:'output',definitionHash:H,binding:{},evaluation:{},artifacts:[artifact]},extra={obligationId:'second',definitionHash:H,binding:{},evaluation:{},artifacts:[],unexpected:true};
 expect(()=>assertLoopApplicationArtifacts(owner,binding,owner,[section,extra])).toThrow('published_artifact_sections');
});
it.each([
 (v:any)=>{v.contract=assistant().contract;},
 (v:any)=>{v.contract.scanner='kswarm-service-health';},
 (v:any)=>{v.body.scanner='kswarm-service-health';},
 (v:any)=>{v.body.diagnostic.kind='kswarm-service-health';},
 (v:any)=>{v.body.diagnostic.findings=[];},
 (v:any)=>{v.body.metadata={nativeApproved:true};},
])('rejects builtin cross-kind and undeclared metadata: %j',change=>reject(change));
it('accepts service-health string findings but rejects classifier objects/metadata',()=>{
 expect(()=>createLoopApplicationBinding(health())).not.toThrow();
 reject(v=>{v.body.diagnostic.findings=[{kind:'service_not_running',metadata:{approved:true}}];},health);
 reject(v=>{v.body.diagnostic.notificationDecision={approved:true};},health);
});
it.each(['execute','verify'])('rejects builtin bound to non-scan stage %s',stageKind=>reject(v=>{v.subject.stage={stageId:'stage',stageKind};}));
it('accepts actual scan stage and changes hash when its parent changes',()=>{
 const raw=base();raw.subject.stage={stageId:'stage',stageKind:'scan'};const first=createLoopApplicationBinding(raw);
 raw.subject.runId='other-run';const second=createLoopApplicationBinding(raw);expect(loopApplicationBindingHash(first)).not.toBe(loopApplicationBindingHash(second));
 raw.subject.loopId='other-loop';expect(()=>createLoopApplicationBinding(raw)).toThrow();
 const user=template();user.subject.stage={stageId:'verify',stageKind:'verify'};const original=createLoopApplicationBinding(user);user.subject.loopId='other-loop';expect(loopApplicationBindingHash(createLoopApplicationBinding(user))).not.toBe(loopApplicationBindingHash(original));
});
it('requires terminal user stage to equal the actual verify stage and preserves distinct stage identities',()=>{
 const raw=template();raw.subject.stage={stageId:'verify',stageKind:'verify'};expect(()=>createLoopApplicationBinding(raw)).not.toThrow();
 for(const stage of [{stageId:'other',stageKind:'verify'},{stageId:'verify',stageKind:'execute'},{stageId:'verify',stageKind:'scan'}])reject(v=>{v.subject.stage=stage;},template);
 reject(v=>{v.body.executeStageId=v.body.verifyStageId;},template);
});
function execution():any {
 const raw=template();raw.subject.stage={stageId:'execute',stageKind:'execute'};
 const {verifyStageId,...body}=raw.body;raw.body={...body,kind:'user-template-execute'};return raw;
}
it('captures an execute-only candidate with the complete original task contract',()=>{
 const raw=execution(),value=createLoopApplicationBinding(raw);
 expect(parseLoopApplicationBinding(value)).toEqual(value);expect(value.body).toEqual(raw.body);
 expect(value.contract).toEqual(template().contract);expect(Object.isFrozen(value.body)).toBe(true);
 const changed=execution();changed.body.taskId='different-task';
 expect(createLoopApplicationBinding(changed).candidatePayloadHash).not.toBe(value.candidatePayloadHash);
});
it.each([null,{stageId:'verify',stageKind:'verify'},{stageId:'execute',stageKind:'scan'},{stageId:'other',stageKind:'execute'}])('rejects execution body at a different subject: %j',stage=>{
 const raw=execution();raw.subject.stage=stage;expect(()=>createLoopApplicationBinding(raw)).toThrow('loop_application_body_binding');
});
it('rejects foreign contracts, invented verify stage and completion grants on execution bodies',()=>{
 const raw=execution();raw.contract=base().contract;expect(()=>createLoopApplicationBinding(raw)).toThrow('loop_application_body_binding');
 for(const extra of [{verifyStageId:'verify'},{completed:true},{nativeApproved:true}]){
  const candidate=execution();Object.assign(candidate.body,extra);expect(()=>createLoopApplicationBinding(candidate)).toThrow('loop_application_shape');
 }
});
it.each(['evening','morning'] as const)('rejects assistant stage invention and opposite output branch: %s',kind=>{
 reject(v=>{v.subject.stage={stageId:'fake',stageKind:'verify'};},()=>assistant(kind));
 reject(v=>{v.contract.assistantKind=kind==='evening'?'morning':'evening';},()=>assistant(kind));
 reject(v=>{if(kind==='evening')v.body.recommendations=[];else v.body.candidates=[];},()=>assistant(kind));
});
it('binds the complete evening candidate set and content, not merely runId/summary',()=>{
 const first=createLoopApplicationBinding(assistant()),late=assistant();late.body.candidates.push(candidate('two'));
 const second=createLoopApplicationBinding(late);expect(second.candidatePayloadHash).not.toBe(first.candidatePayloadHash);
 late.body.candidates[0].content='Changed complete content';expect(createLoopApplicationBinding(late).candidatePayloadHash).not.toBe(second.candidatePayloadHash);
 reject(v=>{v.body.candidates.push(structuredClone(v.body.candidates[0]));},assistant);
 reject(v=>{v.body.candidates[0].runId='other-run';},assistant);
 reject(v=>{v.body.candidates[0].scope='project';},assistant);
 reject(v=>{v.body.candidates[0].confidence=1.1;},assistant);
 reject(v=>{v.body.candidates[0].evidenceRefs[0].authorization={};},assistant);
});
it('requires evening candidate byte-lexical ID order without silently sorting',()=>{
 const raw=assistant();raw.body.candidates=[candidate('a'),candidate('z')];const captured=createLoopApplicationBinding(raw);
 const changed:any=structuredClone(captured);changed.body.candidates.reverse();expect(()=>parseLoopApplicationBinding(changed)).toThrow();
 raw.body.candidates.reverse();expect(()=>createLoopApplicationBinding(raw)).toThrow(/candidate_order/);
});
it('rejects oversized original trigger JSON before parsing it',()=>{
 const raw=base();raw.originalTriggerJson='{"kind":"'+ 'x'.repeat(65540) +'"}';
 const nativeParse=JSON.parse;let calls=0;
 try{JSON.parse=function(...args:any[]){calls++;return Reflect.apply(nativeParse,this,args);};expect(()=>createLoopApplicationBinding(raw)).toThrow('loop_application_limit');}
 finally{JSON.parse=nativeParse;}
 expect(calls).toBe(0);
});
it('preserves morning recommendation order/reasons and the actual maximum of three',()=>{
 const raw=assistant('morning');raw.body.recommendations.push({title:'Second',reasonCode:'different',evidenceRefs:[{kind:'task',id:'t2'}]});
 const first=createLoopApplicationBinding(raw);raw.body.recommendations.reverse();expect(createLoopApplicationBinding(raw).candidatePayloadHash).not.toBe(first.candidatePayloadHash);
 raw.body.recommendations.push(...structuredClone(raw.body.recommendations));expect(()=>createLoopApplicationBinding(raw)).toThrow();
});
it.each(['triggerHash','contractHash','candidatePayloadHash'] as const)('rejects forged %s even with otherwise well-formed input',field=>{
 const original=createLoopApplicationBinding(base()),changed:any=structuredClone(original);changed[field]=(changed[field][0]==='a'?'b':'a').repeat(64);expect(()=>parseLoopApplicationBinding(changed)).toThrow();
});
it.each(['body','contract','trigger','revision','candidate','logical-key'])('rejects changed signed body without recomputing the original binding: %s',mode=>{
 const value:any=structuredClone(createLoopApplicationBinding(base()));
 if(mode==='body')value.body.summary='changed';if(mode==='contract')value.contract.objective='changed';if(mode==='trigger')value.originalTriggerJson=json({kind:'other'});
 if(mode==='revision')value.candidateRevision++;if(mode==='candidate')value.candidateId='different';if(mode==='logical-key')value.logicalRunKey='changed';expect(()=>parseLoopApplicationBinding(value)).toThrow();
});
it('requires complete canonical trigger JSON and preserves non-authoritative original fields',()=>{
 for(const originalTriggerJson of ['{ "kind":"manual" }','{"kind":"a","kind":"b"}','not-json'])reject(v=>{v.originalTriggerJson=originalTriggerJson;});
 const raw=base();raw.originalTriggerJson=json({kind:'manual',requestSource:'scheduler',authorization:'ordinary untrusted text'});
 expect(createLoopApplicationBinding(raw).originalTriggerJson).toBe(raw.originalTriggerJson);
});
it('enforces safe revision and the complete encoded size without truncating text',()=>{
 for(const candidateRevision of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN])reject(v=>{v.candidateRevision=candidateRevision;});
 reject(v=>{v.body.summary='x'.repeat(65536);});
 const raw=base();raw.body.summary='x'.repeat(40000);raw.contract.objective='y'.repeat(30000);expect(()=>createLoopApplicationBinding(raw)).toThrow();
});
it('uses the original strict artifact selection and rejects self-reported malformed hashes/paths',()=>{
 const raw=base();raw.body.artifacts=[artifact()];expect(createLoopApplicationBinding(raw).body).toMatchObject({artifacts:raw.body.artifacts});
 for(const path of ['../secret','/absolute','C:/secret','https://example.test/file'])reject(v=>{v.body.artifacts=[artifact()];v.body.artifacts[0].selection.path=path;});
 for(const sha256 of ['f'.repeat(63),'G'.repeat(64)])reject(v=>{v.body.artifacts=[{...artifact(),sha256}];});
 for(const size of [-1,1.5,Number.MAX_SAFE_INTEGER+1])reject(v=>{v.body.artifacts=[{...artifact(),size}];});
 reject(v=>{v.body.artifacts=[artifact(),artifact()];});
});
it('keeps local and inherited selection namespaces distinct even at the same logical path',()=>{
 const raw=base(),inherited=artifact();inherited.selection={...inherited.selection,kind:'inherited',originOwner:{profileId:'p',ownerKind:'loop',ownerId:'other'},originalObligationId:'original'};
 raw.body.artifacts=[artifact(),inherited];expect(()=>createLoopApplicationBinding(raw)).not.toThrow();
 reject(v=>{v.body.artifacts=[{...artifact(),selection:{...artifact().selection,originOwner:inherited.selection.originOwner}}];});
});
it('captures all nested data, rejects getters without evaluating them, and accepts no extra grant fields',()=>{
 const raw=assistant(),value:any=createLoopApplicationBinding(raw);raw.body.candidates[0].content='mutated';raw.contract.dataScopes.reverse();
 expect(value.body.candidates[0].content).toBe('Complete content one');expect(value.contract.dataScopes).toEqual(['tasks','threads']);
 expect(Object.isFrozen(value.body.candidates[0].evidenceRefs[0])).toBe(true);
 let reads=0;const accessor=base();Object.defineProperty(accessor.body,'summary',{enumerable:true,get(){reads++;return 'injected';}});
 expect(()=>createLoopApplicationBinding(accessor)).toThrow();expect(reads).toBe(0);
 reject(v=>{v.nativeGrant={};});reject(v=>{v.subject.sessionId='invented';});
});
