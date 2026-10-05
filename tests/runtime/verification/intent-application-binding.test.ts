import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {createIntentPlan} from '../../../src/ai/intent-delegation/planner.js';
import {parseIntentBusinessContract} from '../../../src/runtime/verification/intent-business-contract.js';
import {createIntentApplicationBinding,parseIntentApplicationBinding,intentApplicationBindingHash} from '../../../src/runtime/verification/intent-application-binding.js';
const H='a'.repeat(64),sha=(text:string)=>createHash('sha256').update(text).digest('hex');
function candidate(parent=false):any {
 const result=createIntentPlan({instanceId:'host',sessionId:'session',input:'请写报告，然后生成幻灯片',skills:[]});if(result.kind!=='plan')throw Error('fixture');
 const {instanceId,continuationMode,steps,...plan}=result.plan,definition={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.md',sha256:sha('原文'),structure:'utf8'}]}}]};
 const contract=parseIntentBusinessContract({version:1,...plan,verification:definition,stages:plan.stages.map(s=>({...s,steps:s.steps.map(({status,...step})=>step),verification:definition}))}),stageId=contract.stages[0].stageId,subject={version:1,sessionId:contract.sessionId,intentId:contract.intentId,stageId:parent?null:stageId};
 const artifacts=[{artifactId:'original-artifact',stageId,kind:'report',label:'完整标题',summary:null,createdAt:100,content:{kind:'inline',text:'原文'},selection:{kind:'local',obligationId:'original',path:'result.md'},sha256:sha('原文'),size:Buffer.byteLength('原文')}];
 const body=parent?{kind:'intent-parent',summary:'完整结果',stages:contract.stages.map((stage,i)=>({subject:{...subject,stageId:stage.stageId},candidateId:`candidate-${i}`,candidateRevision:1,bindingHash:H,immutablePayloadHash:H,operationId:`publication-${i}`,fullTupleHash:H,committedBusinessRevision:1,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1})),artifacts}:{kind:'intent-stage',stageId,summary:'原结果',executionReports:[{kind:'step',identity:contract.stages[0].steps[0].stepId,status:'completed',requestSource:'agent',recordedAt:100}],artifacts};
 return {version:1,kind:'intent',subject,candidateId:parent?'parent':'stage',candidateRevision:1,contract,body};
}
it.each([false,true])('captures the full real planner contract and exact original candidate (parent=%s)',parent=>{
 const raw=candidate(parent),binding=createIntentApplicationBinding(raw),hash=intentApplicationBindingHash(binding);expect(parseIntentApplicationBinding(binding)).toEqual(binding);expect(Object.isFrozen(binding.body.artifacts)).toBe(true);raw.body.summary='late';expect(intentApplicationBindingHash(binding)).toBe(hash);expect(intentApplicationBindingHash(createIntentApplicationBinding(raw))).not.toBe(hash);
});
it.each(['contractHash','candidatePayloadHash'])('refuses caller forged %s',key=>{const raw:any=structuredClone(createIntentApplicationBinding(candidate()));raw[key]='f'.repeat(64);expect(()=>parseIntentApplicationBinding(raw)).toThrow();});
it('rejects foreign subject and stage/body mixing',()=>{for(const change of [(r:any)=>r.subject.sessionId='other',(r:any)=>r.subject.intentId='other',(r:any)=>r.subject.stageId=null,(r:any)=>r.body.stageId=r.contract.stages[1].stageId,(r:any)=>r.body.artifacts[0].stageId=r.contract.stages[1].stageId]){const r=candidate();change(r);expect(()=>createIntentApplicationBinding(r)).toThrow();}});
it('requires exact all-stage parent refs in original order',()=>{for(const change of [(r:any)=>r.body.stages.pop(),(r:any)=>r.body.stages.reverse(),(r:any)=>r.body.stages[1]=r.body.stages[0],(r:any)=>r.body.stages[0].subject.sessionId='other']){const r=candidate(true);change(r);expect(()=>createIntentApplicationBinding(r)).toThrow();}});
it('does not treat a reported step as an authority or allow a foreign step',()=>{const r=candidate();r.body.executionReports[0].identity=r.contract.stages[1].steps[0].stepId;expect(()=>createIntentApplicationBinding(r)).toThrow();const other=candidate();other.body.executionReports[0].proof='passed';expect(()=>createIntentApplicationBinding(other)).toThrow();});
it('rejects malformed selection, duplicated artifact and false inline hash or size',()=>{for(const change of [(r:any)=>r.body.artifacts[0].selection.path='../escape',(r:any)=>r.body.artifacts.push(r.body.artifacts[0]),(r:any)=>r.body.artifacts[0].sha256=H,(r:any)=>r.body.artifacts[0].size++]){const r=candidate();change(r);expect(()=>createIntentApplicationBinding(r)).toThrow();}});
it('preserves actual scheduler actor and failed execution report without declaring independent proof',()=>{const r=candidate();r.body.executionReports[0].requestSource='scheduler';r.body.executionReports[0].status='failed';expect(createIntentApplicationBinding(r).body).toEqual(r.body);});
it('rejects executable input with zero getter calls and hidden extra fields',()=>{let reads=0;const r=candidate();Object.defineProperty(r.body,'summary',{get(){reads++;return 'changed';},enumerable:true});expect(()=>createIntentApplicationBinding(r)).toThrow();expect(reads).toBe(0);const hidden=candidate();hidden.body[Symbol('approval')]=true;expect(()=>createIntentApplicationBinding(hidden)).toThrow();});
it('checks the complete 64KiB bound without truncating text',()=>{const r=candidate();r.body.summary='原'.repeat(3000);expect(createIntentApplicationBinding(r).body.summary).toBe(r.body.summary);r.body.summary='原'.repeat(24000);expect(()=>createIntentApplicationBinding(r)).toThrow();});

import {parseBusinessApplicationBinding,businessApplicationBindingHash,businessApplicationOwner,businessApplicationEpoch,sameBusinessApplicationSubject,parseActiveBusinessApplicationBinding} from '../../../src/runtime/verification/business-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
it.each([false,true])('dispatches Intent through the original business union without Goal/Loop coercion (parent=%s)',parent=>{
 const binding=createIntentApplicationBinding(candidate(parent));expect(parseBusinessApplicationBinding(binding)).toEqual(binding);
 expect(businessApplicationBindingHash(binding)).toBe(intentApplicationBindingHash(binding));expect(businessApplicationOwner(binding)).toEqual(intentHostSubjectOwner(binding.subject));
 expect(businessApplicationEpoch(binding)).toBe(1);expect(parseActiveBusinessApplicationBinding({binding,bindingHash:intentApplicationBindingHash(binding),revision:1}).binding).toEqual(binding);
 const next=createIntentApplicationBinding({...candidate(parent),candidateRevision:2});expect(sameBusinessApplicationSubject(binding,next)).toBe(true);
 expect(sameBusinessApplicationSubject(binding,createIntentApplicationBinding(candidate(!parent)))).toBe(false);
});
it('the union does not erase nested symbol fields before the strict Intent parser',()=>{
 const binding:any=structuredClone(createIntentApplicationBinding(candidate()));binding.body[Symbol('hidden')]=true;
 expect(()=>parseBusinessApplicationBinding(binding)).toThrow();
});
it('active union wrapper preserves strict raw binding validation instead of erasing hidden fields',()=>{
 const binding:any=structuredClone(createIntentApplicationBinding(candidate())),bindingHash=intentApplicationBindingHash(binding);binding.body[Symbol('hidden')]=true;
 expect(()=>parseActiveBusinessApplicationBinding({binding,bindingHash,revision:1})).toThrow();
});

it('outer binding and binding.kind accessors never execute through the active wrapper',()=>{let reads=0;const binding=createIntentApplicationBinding(candidate()),bindingHash=intentApplicationBindingHash(binding);expect(()=>parseActiveBusinessApplicationBinding({get binding(){reads++;return binding;},bindingHash,revision:1})).toThrow();const changed={...binding,get kind(){reads++;return 'intent';}};expect(()=>parseActiveBusinessApplicationBinding({binding:changed,bindingHash,revision:1})).toThrow();expect(reads).toBe(0);});

it('retains the same original artifact identity in independent parent stages without renaming',()=>{const raw=candidate(true);raw.body.artifacts.push({...raw.body.artifacts[0],stageId:raw.contract.stages[1].stageId});expect(createIntentApplicationBinding(raw).body.artifacts).toEqual(raw.body.artifacts);});
it('still rejects a duplicated original stage/artifact tuple and a cross-stage spoof onto that tuple',()=>{const raw=candidate(true);raw.body.artifacts.push({...raw.body.artifacts[0],stageId:raw.contract.stages[1].stageId});const repeated=structuredClone(raw);repeated.body.artifacts.push({...repeated.body.artifacts[0]});expect(()=>createIntentApplicationBinding(repeated)).toThrow('intent_application_artifact_binding');raw.body.artifacts[1].stageId=raw.body.artifacts[0].stageId;expect(()=>createIntentApplicationBinding(raw)).toThrow('intent_application_artifact_binding');});

it('retains the entire actual producer report history separately from execution terminal facts',()=>{
 const r=candidate();r.body.executionReports=[];r.body.artifacts=[];
 const action={kind:'step-report',stepId:r.contract.stages[0].steps[0].stepId,status:'failed',breadcrumb:'原失败',receiptNote:null,blockedReason:'retry',origin:{kind:'model-report',providerInvocationId:'provider-1',toolInvocationId:'tool-1'}};
 r.body.producerReports=[{protectionMode:'protected',action,requestSource:'agent',now:100,artifactId:null},{protectionMode:'protected',action:{...action,status:'completed',breadcrumb:'原重试',blockedReason:null,origin:{kind:'model-report',providerInvocationId:'provider-2',toolInvocationId:'tool-2'}},requestSource:'agent',now:101,artifactId:null}];
 const binding=createIntentApplicationBinding(r);expect(binding.body).toEqual(r.body);expect(Object.isFrozen((binding.body as any).producerReports[0].action.origin)).toBe(true);expect(parseIntentApplicationBinding(binding)).toEqual(binding);
});
it('binds producer report identities to the exact original stage and artifact population',()=>{
 const base=candidate();base.body.executionReports=[];base.body.producerReports=[{protectionMode:'protected',action:{kind:'artifact-report',stageId:base.subject.stageId,kindOfArtifact:'report',storage:'inline',label:'完整标题',path:null,inlineValue:'原文',summary:null,reportedStructuralValidation:'passed',reportedSemanticValidation:'failed',origin:{kind:'model-report',providerInvocationId:'provider',toolInvocationId:'tool'}},requestSource:'agent',now:100,artifactId:'original-artifact'}];
 expect(createIntentApplicationBinding(base).body).toEqual(base.body);
 for(const change of [(r:any)=>r.body.producerReports[0].action.stageId=r.contract.stages[1].stageId,(r:any)=>r.body.producerReports[0].artifactId='missing',(r:any)=>r.body.producerReports.push(r.body.producerReports[0]),(r:any)=>r.body.producerReports[0].action.inlineValue='late body']){const r=structuredClone(base);change(r);expect(()=>createIntentApplicationBinding(r)).toThrow();}
});
