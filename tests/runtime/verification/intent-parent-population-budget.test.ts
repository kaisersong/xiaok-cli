import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding,parseIntentApplicationBinding,intentApplicationBindingHash} from '../../../src/runtime/verification/intent-application-binding.js';
import {parseActiveBusinessApplicationBinding,parseBusinessApplicationBinding} from '../../../src/runtime/verification/business-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const H='a'.repeat(64),sha=(text:string)=>createHash('sha256').update(text).digest('hex');
function population(){
 const raw=structuredClone(intentApplicationCandidate(true)),sample=structuredClone(raw.contract.stages[0]);
 const verification={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result',sha256:sha(''),structure:'bytes'}]}}]};
 raw.contract.verification=verification;raw.contract.stages=Array.from({length:99},(_,i)=>({...structuredClone(sample),stageId:`s${i}`,order:i,label:'stage',deliverable:'result',templateId:'template',verification,dependsOnStageIds:[],steps:[{...sample.steps[0],stepId:`p${i}`,key:'main',order:0,skillName:null,dependsOn:[]}]}));
 raw.body.artifacts=[];raw.body.stages=[];return raw;
}
function inherit(raw:any,stage:any,artifacts:any[],candidateId:string){
 const subject={...raw.subject,stageId:stage.stageId};
 const child=createIntentApplicationBinding({...raw,subject,candidateId,body:{kind:'intent-stage',stageId:stage.stageId,summary:raw.body.summary,executionReports:[],artifacts}});
 raw.body.stages.push({subject,candidateId,candidateRevision:1,bindingHash:intentApplicationBindingHash(child),immutablePayloadHash:H,operationId:candidateId,fullTupleHash:H,committedBusinessRevision:1,receiverId:candidateId,receiverProtocolVersion:1,receiverInstanceEpoch:1});
 raw.body.artifacts.push(...child.body.artifacts.map(a=>({...a,selection:a.selection.kind==='local'?{...a.selection,kind:'inherited',originOwner:{profileId:'profile',...intentHostSubjectOwner(subject)},originalObligationId:a.selection.obligationId}:a.selection})));
 return child;
}
it.runIf(process.env.SOLPI_INTENT_POPULATION==='1')('retains original 99 legal children with 40 complete file artifacts each beyond one-child node count',()=>{
 const raw=population();
 for(const stage of raw.contract.stages){const artifacts=Array.from({length:40},(_,i)=>({artifactId:`${stage.stageId}-${i}`,stageId:stage.stageId,kind:'report',label:'',summary:null,createdAt:1,content:{kind:'file',originalPath:`${stage.stageId}-${i}.txt`},selection:{kind:'local',obligationId:'original',path:`result-${i}`},sha256:sha(''),size:0}));inherit(raw,stage,artifacts,stage.stageId);}
 const binding=createIntentApplicationBinding(raw);expect(binding.body.artifacts).toEqual(raw.body.artifacts);expect(binding.body.artifacts).toHaveLength(3960);
 expect(parseIntentApplicationBinding(binding)).toEqual(binding);expect(Object.isFrozen(binding.body.artifacts[3959]!.selection)).toBe(true);
 expect(parseActiveBusinessApplicationBinding({binding,bindingHash:intentApplicationBindingHash(binding),revision:1}).binding).toEqual(binding);
});
it.runIf(process.env.SOLPI_INTENT_POPULATION==='1')('preserves escaped legal reference identities and a complete full-size original last-child summary',()=>{
 const raw=population(),identity='"\\'.repeat(80);raw.contract.sessionId=raw.subject.sessionId=identity;raw.contract.intentId=raw.subject.intentId=identity;
 raw.body.summary='x'.repeat(62500);
 for(const stage of raw.contract.stages){const candidateId=identity.slice(0,156)+stage.stageId;const child=inherit(raw,stage,[],candidateId);const {contract,...nonContract}=child;expect(Buffer.byteLength(json(nonContract))).toBeLessThanOrEqual(65536);}
 const binding=createIntentApplicationBinding(raw);expect(binding.body).toEqual(raw.body);expect(parseActiveBusinessApplicationBinding({binding,bindingHash:intentApplicationBindingHash(binding),revision:1}).binding).toEqual(binding);
});
it.each(['"\\','\b\n\0','中文','😀','\ud800','\x7f'])('preserves exact canonical stage boundary for %j and rejects the next byte',sample=>{
 const raw=intentApplicationCandidate();raw.body.summary=sample.repeat(20);const first=createIntentApplicationBinding(raw),{contract,...nonContract}=first;
 raw.body.summary+='x'.repeat(65536-Buffer.byteLength(json(nonContract)));const binding=createIntentApplicationBinding(raw),{contract:acceptedContract,...accepted}=binding;
 expect(Buffer.byteLength(json(accepted))).toBe(65536);expect(parseIntentApplicationBinding(binding)).toEqual(binding);
 const excess=structuredClone(binding);if(!Reflect.set(excess.body,'summary',excess.body.summary+'x'))throw new TypeError('summary_assignment_failed');expect(()=>parseIntentApplicationBinding(excess)).toThrow('intent_application_limit');
});
it('rejects an oversized string before canonical serializer receives it',()=>{
 const raw=intentApplicationCandidate();raw.body.summary='x'.repeat(1024**2);let oversizedCalls=0;const stringify=JSON.stringify;
 const spy=vi.spyOn(JSON,'stringify').mockImplementation((...args:any[])=>{if(typeof args[0]==='string'&&args[0].length>=65536){oversizedCalls++;throw Error('oversized_string_was_serialized');}return (stringify as any)(...args);});
 try{expect(()=>createIntentApplicationBinding(raw)).toThrow('intent_application_limit');expect(oversizedCalls).toBe(0);}finally{spy.mockRestore();}
});
it('rejects a proxy before any reflection trap',()=>{
 let traps=0;const raw=new Proxy(intentApplicationCandidate(),{getPrototypeOf(){traps++;throw Error('proxy trap');},ownKeys(){traps++;throw Error('proxy trap');}});
 expect(()=>createIntentApplicationBinding(raw)).toThrow('intent_application_data');expect(traps).toBe(0);
});
it('rejects proxies before reflection through every direct and active business parser sibling',()=>{
 const binding=createIntentApplicationBinding(intentApplicationCandidate()),bindingHash=intentApplicationBindingHash(binding);let traps=0;
 const proxied=new Proxy(binding,{getOwnPropertyDescriptor(){traps++;throw Error('business proxy trap');}}),active=new Proxy({binding,bindingHash,revision:1},{getOwnPropertyDescriptor(){traps++;throw Error('wrapper proxy trap');}});
 for(const input of [()=>parseBusinessApplicationBinding(proxied),()=>parseActiveBusinessApplicationBinding({binding:proxied,bindingHash,revision:1}),()=>parseActiveBusinessApplicationBinding(active)])expect(input).toThrow('intent_application_data');
 expect(traps).toBe(0);
});
it('rejects one oversized stage artifact group instead of borrowing empty siblings budgets',()=>{
 const raw=population(),stage=raw.contract.stages[0],bytes='x'.repeat(65536);raw.body.artifacts=[{artifactId:'too-large',stageId:stage.stageId,kind:'report',label:'',summary:null,createdAt:1,content:{kind:'inline',text:bytes},selection:{kind:'local',obligationId:'original',path:'result'},sha256:sha(bytes),size:bytes.length}];
 raw.body.stages=raw.contract.stages.map((s:any)=>({subject:{...raw.subject,stageId:s.stageId},candidateId:s.stageId,candidateRevision:1,bindingHash:H,immutablePayloadHash:H,operationId:s.stageId,fullTupleHash:H,committedBusinessRevision:1,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1}));
 expect(()=>createIntentApplicationBinding(raw)).toThrow('intent_application_limit');
});
it('keeps oversized original contract and stage candidate rejection',()=>{for(const field of ['contract','body']){const raw=structuredClone(intentApplicationCandidate());if(field==='contract')raw.contract.normalizedIntent='x'.repeat(65536);else raw.body.summary='x'.repeat(65536);expect(()=>createIntentApplicationBinding(raw)).toThrow();}});
