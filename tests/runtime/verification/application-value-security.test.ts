import {it,expect} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding} from '../../../src/runtime/verification/intent-application-binding.js';
import {parseGoalApplicationBinding,parseActiveGoalApplicationBinding} from '../../../src/runtime/verification/goal-application-binding.js';
import {createLoopApplicationBinding,parseLoopApplicationBinding,parseLoopCandidateBody} from '../../../src/runtime/verification/loop-application-binding.js';
import {parseBusinessApplicationBinding,parseActiveBusinessApplicationBinding,businessApplicationBindingHash,businessApplicationOwner} from '../../../src/runtime/verification/business-application-binding.js';
import {parseApplicationBindingReview} from '../../../src/runtime/verification/application-binding-review.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {APPLICATION_METHODS} from '../../../src/runtime/verification/application-transport.js';
import {applicationDataDescriptors,captureApplicationData,readApplicationOwnDataField} from '../../../src/runtime/verification/application-value-data.js';
import {parseLoopBusinessContract} from '../../../src/runtime/verification/loop-application-contract.js';
import {parsePublishedArtifactSelection} from '../../../src/runtime/verification/published-artifact-selection.js';
import {assertPublishedArtifactOwner,assertPublishedArtifactSelection} from '../../../src/runtime/verification/published-artifact-selection.js';
function goal(){return {version:1 as const,kind:'goal' as const,sessionId:'session',goalId:'goal',epoch:1,objective:'original',completionCriterion:null,expectedEvidenceKinds:[]};}
function loop(){return createLoopApplicationBinding({version:1,kind:'loop',subject:{kind:'loop-run',loopId:'artifact-evidence-regression',runId:'run',stage:null},candidateId:'candidate',candidateRevision:1,originalTriggerJson:'{"kind":"manual"}',logicalRunKey:null,contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Original',completionCriterion:'Original'},body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1,summary:'Original',nextActionKind:'none',nextActionSummary:null,diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:0,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},artifacts:[]}});}
function binding(kind:string):any{return kind==='goal'?goal():kind==='loop'?loop():createIntentApplicationBinding(intentApplicationCandidate());}
function trap(){let calls=0;const value=new Proxy({},{ownKeys(){calls++;throw Error('unexpected nested proxy trap');},getPrototypeOf(){calls++;throw Error('unexpected nested proxy trap');},getOwnPropertyDescriptor(){calls++;throw Error('unexpected nested proxy trap');}});return {value,calls:()=>calls};}
for(const kind of ['goal','loop','intent']){
 it.each(['bindingHash','revision','extra'])(`rejects nested Proxy control fields before reflection in ${kind} active wrapper: %s`,field=>{const b=binding(kind),t=trap(),raw:any={binding:b,bindingHash:businessApplicationBindingHash(b),revision:1};raw[field]=t.value;expect(()=>parseActiveBusinessApplicationBinding(raw)).toThrow();expect(t.calls()).toBe(0);});
 it(`rejects symbol fields at ${kind} active wrapper root`,()=>{const b=binding(kind),raw:any={binding:b,bindingHash:businessApplicationBindingHash(b),revision:1};raw[Symbol('approval')]=true;expect(()=>parseActiveBusinessApplicationBinding(raw)).toThrow();});
 it(`rejects an object kind before nested reflection in ${kind} direct union`,()=>{const raw=structuredClone(binding(kind)),t=trap();raw.kind=t.value;expect(()=>parseBusinessApplicationBinding(raw)).toThrow();expect(t.calls()).toBe(0);});
 it(`rejects hidden nested symbols in ${kind} bindings through every direct parser`,()=>{const raw=structuredClone(binding(kind));(kind==='goal'?raw.expectedEvidenceKinds:raw.body)[Symbol('approval')]=true;expect(()=>parseBusinessApplicationBinding(raw)).toThrow();if(kind==='goal')expect(()=>parseGoalApplicationBinding(raw)).toThrow();else if(kind==='loop')expect(()=>parseLoopApplicationBinding(raw)).toThrow();});
}
it('direct active Goal rejects both wrapper symbols and nested control Proxy',()=>{const b=goal(),raw:any={binding:b,bindingHash:businessApplicationBindingHash(b),revision:1};raw[Symbol('approval')]=true;expect(()=>parseActiveGoalApplicationBinding(raw)).toThrow();delete raw[Reflect.ownKeys(raw).find(key=>typeof key==='symbol')!];const t=trap();raw.bindingHash=t.value;expect(()=>parseActiveGoalApplicationBinding(raw)).toThrow();expect(t.calls()).toBe(0);});
it('direct Goal and all Loop create/parse/body paths reject nested Proxy before reflection',()=>{
 const t=trap();expect(()=>parseGoalApplicationBinding({...goal(),objective:t.value})).toThrow();expect(t.calls()).toBe(0);
 const b=structuredClone(loop()),{triggerHash,contractHash,candidatePayloadHash,...candidate}=b;
 for(const call of [()=>parseLoopApplicationBinding({...b,body:{...b.body,summary:t.value}}),()=>createLoopApplicationBinding({...candidate,body:{...b.body,summary:t.value}}),()=>parseLoopCandidateBody({...b.body,summary:t.value},b.subject,b.contract)]){expect(call).toThrow();expect(t.calls()).toBe(0);}
});
function review(){const b=goal();return {version:1,purpose:'completion-application-binding',authorityId:'authority',challengeId:'challenge',principal:{uid:501,auditSessionId:1,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},requestSource:'user',owner:{profileId:'profile',...businessApplicationOwner(b)},registrationHash:'a'.repeat(64),previousBindingHash:null,binding:b,bindingHash:businessApplicationBindingHash(b),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:0,validUntil:1000}};}
it.each(['root-symbol','principal-symbol','principal-proxy','hash-proxy'])('rejects untrusted native review metadata before erasure/reflection: %s',mode=>{const raw:any=review(),t=trap();if(mode==='root-symbol')raw[Symbol('approval')]=true;else if(mode==='principal-symbol')raw.principal[Symbol('approval')]=true;else if(mode==='principal-proxy')raw.principal=t.value;else raw.registrationHash=t.value;expect(()=>parseApplicationBindingReview(raw)).toThrow();expect(t.calls()).toBe(0);});
it('preserves original review canonical numeric normalization',()=>{const raw=review();raw.deadline.notBefore=-0;expect(Object.is(parseApplicationBindingReview(raw).deadline.notBefore,0)).toBe(true);});
it('returns a frozen null-prototype own-field receipt without invoking accessors',()=>{
 let reads=0;const raw:any={value:1};Object.defineProperty(raw,'kind',{enumerable:true,get(){reads++;return 'goal';}});
 expect(readApplicationOwnDataField(raw,'value','field_error')).toMatchObject({present:true,kind:'data',value:1});
 expect(readApplicationOwnDataField(raw,'kind','field_error')).toMatchObject({present:true,kind:'accessor',value:undefined});
 expect(readApplicationOwnDataField(raw,'missing','field_error')).toMatchObject({present:false,kind:'missing',value:undefined});expect(reads).toBe(0);
 const receipt=readApplicationOwnDataField(raw,'value','field_error');expect(Object.getPrototypeOf(receipt)).toBeNull();expect(Object.isFrozen(receipt)).toBe(true);
 expect(Reflect.ownKeys(receipt)).toEqual(['present','kind','value']);for(const key of Reflect.ownKeys(receipt)){const d=Object.getOwnPropertyDescriptor(receipt,key)!;expect(d).toMatchObject({writable:false,enumerable:true,configurable:false});}
});
it('does not let Object.prototype.value turn an accessor descriptor into own data',()=>{
 const raw:any={};let getterCalls=0;Object.defineProperty(raw,'summary',{enumerable:true,get(){getterCalls++;return 'real';}});
 const previous=Object.getOwnPropertyDescriptor(Object.prototype,'value');let error='';
 try{Object.defineProperty(Object.prototype,'value',{configurable:true,value:'FORGED-OWN-DATA'});try{captureApplicationData(raw,{maximumBytes:65536,maximumNodes:65536,invalid:'application_data',limit:'application_data_limit'});}catch(e){error=(e as Error).message;}}
 finally{if(previous)Object.defineProperty(Object.prototype,'value',previous);else Reflect.deleteProperty(Object.prototype,'value');}
 expect(error).toBe('application_data');expect(getterCalls).toBe(0);
});
it('returns descriptor maps with null prototypes and preserves own __proto__ data',()=>{
 const raw=Object.create(null);Object.defineProperty(raw,'__proto__',{value:'safe',enumerable:true});Object.defineProperty(raw,'value',{value:1,enumerable:true});
 const descriptors=applicationDataDescriptors(raw);expect(Object.getPrototypeOf(descriptors)).toBeNull();expect(Reflect.ownKeys(descriptors)).toEqual(['__proto__','value']);
 expect(descriptors.__proto__).toMatchObject({value:'safe',writable:false,enumerable:true,configurable:false});expect(descriptors.value?.value).toBe(1);
});
it('copies arrays with own definitions while Object.prototype numeric setters are installed',()=>{
 const prior=Object.getOwnPropertyDescriptor(Object.prototype,'0');let writes=0,copy:any;
 try{Object.defineProperty(Object.prototype,'0',{configurable:true,set(){writes++;}});copy=captureApplicationData([{value:1}],{maximumBytes:65536,maximumNodes:65536,invalid:'application_data',limit:'application_data_limit'});}
 finally{if(prior)Object.defineProperty(Object.prototype,'0',prior);else Reflect.deleteProperty(Object.prototype,'0');}
 expect(copy).toEqual([{value:1}]);expect(writes).toBe(0);
});
it('rejects coercive helper parameters before invoking caller Proxy code',()=>{
 let calls=0;const key=new Proxy({},{get(){calls++;throw Error('key trap');}}),budget={valueOf(){calls++;throw Error('budget coercion');}},label={toString(){calls++;throw Error('label coercion');}};
 expect(()=>readApplicationOwnDataField({},key as any,'field_error')).toThrow();expect(()=>applicationDataDescriptors({value:1},Number.NaN as any)).toThrow();expect(()=>applicationDataDescriptors({value:1},Number.POSITIVE_INFINITY as any)).toThrow();expect(()=>applicationDataDescriptors({value:1},budget as any)).toThrow();
 expect(()=>readApplicationOwnDataField(new Proxy({},{}),'x',label as any)).toThrow();expect(calls).toBe(0);
});
it('validates exported published owners and selectors without property reads or Proxy traps',()=>{
 let calls=0;const owner:any={ownerKind:'task',ownerId:'id'};Object.defineProperty(owner,'profileId',{enumerable:true,get(){calls++;return 'profile';}});
 expect(()=>assertPublishedArtifactOwner(owner)).toThrow('published_artifact_shape');expect(calls).toBe(0);
 const selection=new Proxy({},{get(){calls++;throw Error('selection trap');}});expect(()=>assertPublishedArtifactSelection(selection)).toThrow('published_artifact_shape');expect(()=>parsePublishedArtifactSelection(selection)).toThrow('published_artifact_shape');
 expect(calls).toBe(0);
});
it('reads capture budget fields without invoking limits accessors, proxies, or coercion',()=>{
 let calls=0;const proxy=new Proxy({},{get(){calls++;throw Error('get');},ownKeys(){calls++;throw Error('keys');}});
 expect(()=>captureApplicationData(null,proxy as any)).toThrow('application_data_budget');
 const accessor:any={maximumBytes:4,maximumNodes:1,invalid:'invalid',limit:'limit'};Object.defineProperty(accessor,'maximumDepth',{enumerable:true,get(){calls++;throw Error('depth getter');}});
 expect(()=>captureApplicationData(null,accessor)).toThrow('application_data_budget');
 const coercive:any={maximumBytes:{valueOf(){calls++;throw Error('budget coercion');}},maximumNodes:1,invalid:'invalid',limit:'limit'};expect(()=>captureApplicationData(null,coercive)).toThrow('application_data_budget');
 expect(calls).toBe(0);
});
it.each([
 [{maximumBytes:0,maximumNodes:1,invalid:'invalid',limit:'limit'},'application_data_budget'],
 [{maximumBytes:128*1024**2+1,maximumNodes:1,invalid:'invalid',limit:'limit'},'application_data_budget'],
 [{maximumBytes:4,maximumNodes:0,invalid:'invalid',limit:'limit'},'application_data_budget'],
 [{maximumBytes:4,maximumNodes:8_000_001,invalid:'invalid',limit:'limit'},'application_data_budget'],
 [{maximumBytes:4,maximumNodes:1,maximumDepth:-1,invalid:'invalid',limit:'limit'},'application_data_budget'],
 [{maximumBytes:4,maximumNodes:1,maximumDepth:129,invalid:'invalid',limit:'limit'},'application_data_budget'],
 [{maximumBytes:4,maximumNodes:1,maximumDepth:0,invalid:'invalid',limit:'limit'},null],
])('enforces fixed capture budget boundaries: %j', (limits,expected)=>{
 if(expected===null)expect(captureApplicationData(null,limits as any)).toBeNull();else expect(()=>captureApplicationData(null,limits as any)).toThrow(expected as string);
});
it('rejects nested inherited selection owner Proxy through assertion and parser without traps',()=>{
 let calls=0;const owner=new Proxy({},{getPrototypeOf(){calls++;throw Error('prototype trap');},ownKeys(){calls++;throw Error('keys trap');}}),selection={kind:'inherited',obligationId:'o',path:'out.txt',originOwner:owner,originalObligationId:'o'};
 expect(()=>assertPublishedArtifactSelection(selection)).toThrow('published_artifact_shape');expect(()=>parsePublishedArtifactSelection(selection)).toThrow('published_artifact_shape');expect(calls).toBe(0);
});
it('reads only native own kind fields when Intent, Loop body, Loop contract and trigger are inherited',()=>{
 const prior=Object.getOwnPropertyDescriptor(Object.prototype,'kind');let reads=0;
 try{
  Object.defineProperty(Object.prototype,'kind',{configurable:true,get(){reads++;return 'builtin-diagnostic';}});
  const intentRaw=structuredClone(intentApplicationCandidate());delete intentRaw.body.kind;
  expect(()=>createIntentApplicationBinding(intentRaw)).toThrow('intent_application_body');
  const b=loop(),body=structuredClone(b.body);delete body.kind;
  expect(()=>parseLoopCandidateBody(body,b.subject,b.contract)).toThrow('loop_application_body');
  const contract=structuredClone(b.contract);delete contract.kind;expect(()=>parseLoopBusinessContract(contract)).toThrow('loop_contract_shape');
  const {triggerHash:_triggerHash,contractHash:_contractHash,candidatePayloadHash:_candidatePayloadHash,...candidate}=structuredClone(b);
  expect(()=>createLoopApplicationBinding({...candidate,originalTriggerJson:'{}'})).toThrow('loop_application_trigger');
 }finally{if(prior)Object.defineProperty(Object.prototype,'kind',prior);else Reflect.deleteProperty(Object.prototype,'kind');}
 expect(reads).toBe(0);
});
it('captures direct Loop contracts before canonicalization and rejects direct selector hidden fields',()=>{
 const source=loop().contract as any;let reads=0;const contract={...source};Object.defineProperty(contract,'objective',{enumerable:true,get(){reads++;return 'poison';}});
 expect(()=>parseLoopBusinessContract(contract)).toThrow('loop_contract_shape');expect(reads).toBe(0);
 const trapped=new Proxy(source,{ownKeys(){throw Error('proxy touched');}});expect(()=>parseLoopBusinessContract(trapped)).toThrow('loop_contract_shape');
 const selection:any={kind:'local',obligationId:'o'};Object.defineProperty(selection,'path',{enumerable:true,get(){reads++;return 'out.txt';}});expect(()=>parsePublishedArtifactSelection(selection)).toThrow('published_artifact_shape');expect(reads).toBe(0);
 const hidden={kind:'local',obligationId:'o',path:'out.txt'} as any;hidden[Symbol('hidden')]=true;expect(()=>parsePublishedArtifactSelection(hidden)).toThrow('published_artifact_shape');
});
it('reads Intent contract descriptors without inherited Object.prototype.value',()=>{
 const prior=Object.getOwnPropertyDescriptor(Object.prototype,'value');let reads=0,error='';
 try{Object.defineProperty(Object.prototype,'value',{configurable:true,get(){reads++;return undefined;}});try{createIntentApplicationBinding(intentApplicationCandidate());}catch(e){error=(e as Error).message;}}
 finally{if(prior)Object.defineProperty(Object.prototype,'value',prior);else Reflect.deleteProperty(Object.prototype,'value');}
 expect(error).toBe('');expect(reads).toBe(0);
});
it('bounds Intent parent artifacts and writes created hashes without inherited accessors',()=>{
 const candidate=intentApplicationCandidate(true),binding=createIntentApplicationBinding(candidate),malformed=structuredClone(binding);delete malformed.body.artifacts;
 const priorArtifacts=Object.getOwnPropertyDescriptor(Object.prototype,'artifacts'),priorHash=Object.getOwnPropertyDescriptor(Object.prototype,'contractHash');let reads=0,writes=0,error='';
 try{
  Object.defineProperty(Object.prototype,'artifacts',{configurable:true,get(){reads++;return [];}});
  try{parseBusinessApplicationBinding(malformed);}catch(e){error=(e as Error).message;}
 }finally{if(priorArtifacts)Object.defineProperty(Object.prototype,'artifacts',priorArtifacts);else Reflect.deleteProperty(Object.prototype,'artifacts');}
 try{Object.defineProperty(Object.prototype,'contractHash',{configurable:true,set(){writes++;}});const created=createIntentApplicationBinding(candidate);expect(Object.hasOwn(created,'contractHash')).toBe(true);}
 finally{if(priorHash)Object.defineProperty(Object.prototype,'contractHash',priorHash);else Reflect.deleteProperty(Object.prototype,'contractHash');}
 expect(error).toBe('intent_application_artifacts');expect(reads).toBe(0);expect(writes).toBe(0);
});
it('keeps review envelope purpose errors ahead of invalid nested Intent body errors',()=>{
 const raw:any=review(),valid=createIntentApplicationBinding(intentApplicationCandidate()),binding=structuredClone(valid);delete binding.body.kind;
 raw.binding=binding;raw.owner={profileId:'profile',...businessApplicationOwner(valid)};raw.bindingHash=businessApplicationBindingHash(valid);raw.purpose='wrong-purpose';
 expect(()=>parseApplicationBindingReview(raw)).toThrow('application_review_purpose');
});
it.each(APPLICATION_METHODS)('signed client rejects application payload symbols and Proxy before any identity IPC: %s',async method=>{
 const keys=generateKeyPairSync('ed25519');let calls=0;const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,async roundTrip(){calls++;throw Error('unexpected identity IPC');},roundTripSync(){calls++;throw Error('unexpected sync IPC');}});
 try{for(const mode of ['binding-symbol','root-symbol','nested-proxy']){const raw:any={requestSource:'user',requestId:'request',binding:goal()},t=trap();if(mode==='binding-symbol')raw.binding[Symbol('approval')]=true;else if(mode==='root-symbol')raw[Symbol('approval')]=true;else raw.extra=t.value;await expect(client.applicationTransport.call(method,raw)).rejects.toThrow();expect(t.calls()).toBe(0);expect(calls).toBe(0);}}finally{client.dispose();}
});
it.each(APPLICATION_METHODS)('retains original pre-aborted reason before application payload processing: %s',async method=>{
 const keys=generateKeyPairSync('ed25519'),reason=Error('original abort reason'),signal=new AbortController();signal.abort(reason);let calls=0;
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,async roundTrip(){calls++;throw Error('unexpected identity IPC');},roundTripSync(){throw Error('unused');}}),t=trap();
 try{expect(await client.applicationTransport.call(method,{binding:t.value},signal.signal).catch(error=>error)).toBe(reason);expect(t.calls()).toBe(0);expect(calls).toBe(0);}finally{client.dispose();}
});
