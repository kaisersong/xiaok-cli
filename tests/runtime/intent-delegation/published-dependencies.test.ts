import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const wire=vi.hoisted(()=>({call:undefined as any,route:undefined as any,opened:0,closed:0,calls:[] as string[],hook:undefined as undefined|((method:string)=>void)}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>{wire.opened++;const call=async(method:string,payload:unknown)=>{wire.calls.push(method);const result=await wire.call(method,payload);wire.hook?.(method);return result;};return {completionTransport:{call},applicationTransport:{call},publicationTransport:{call},dispose(){wire.closed++;}};}}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:any)=>wire.route(owner)}));
import {readCurrentIntentPublicationDependencies} from '../../../src/runtime/intent-delegation/published-dependencies.js';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding,intentApplicationBindingHash} from '../../../src/runtime/verification/intent-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {intentBusinessContractHash} from '../../../src/runtime/verification/intent-business-contract.js';
import {intentContractOriginalRegistration,intentOriginalRegistrationHash} from '../../../src/runtime/verification/intent-contract-enrollment.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {parseIndependentRecipeDefinition} from '../../../src/runtime/verification/independent-recipes.js';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex'),H='a'.repeat(64);
let state:any;
beforeEach(()=>{
 wire.opened=wire.closed=0;wire.calls=[];wire.hook=undefined;
 const raw=intentApplicationCandidate(),subject={...raw.subject,stageId:null},contract=raw.contract,registrations=new Map(),items=contract.stages.map((stage:any,i:number)=>{
  const currentSubject={...subject,stageId:stage.stageId},owner={profileId:'profile',...intentHostSubjectOwner(currentSubject)};
  const binding=createIntentApplicationBinding({...raw,subject:currentSubject,candidateId:`stage-${i}`,body:{...raw.body,stageId:stage.stageId,executionReports:[],artifacts:raw.body.artifacts.map((a:any)=>({...a,stageId:stage.stageId}))}}),active={binding,bindingHash:intentApplicationBindingHash(binding),revision:1};
  const registration={owner,subject:currentSubject,contract,contractHash:intentBusinessContractHash(contract),registrationHash:intentOriginalRegistrationHash(intentContractOriginalRegistration({subject:currentSubject,contract}))};registrations.set(owner.ownerId,registration);
  const artifactDefinition=parseIndependentRecipeDefinition(stage.verification.obligations[0].recipe);
  const body={version:1,owner,application:active,dependencies:[],evaluations:[{obligationId:'original',definitionHash:artifactDefinition.definitionHash,binding:{},evaluation:{},artifacts:[{path:'result.md',sha256:hash('原文'),size:Buffer.byteLength('原文'),bytesBase64:Buffer.from('原文').toString('base64')}]}]},bytes=Buffer.from(json(body));
  return {owner,active,body,bytes,registration,observation:{owner,businessRevision:1,currentVerification:'valid',publication:{status:'committed',current:true,operationId:`operation-${i}`,fullTupleHash:H}}};
 });
 const parentOwner={profileId:'profile',...intentHostSubjectOwner(subject)};registrations.set(parentOwner.ownerId,{owner:parentOwner,subject,contract,contractHash:intentBusinessContractHash(contract),registrationHash:intentOriginalRegistrationHash(intentContractOriginalRegistration({subject,contract}))});
 state={subject,contract,items,registrations,set:{subject,owner:parentOwner,registrationHash:registrations.get(parentOwner.ownerId).registrationHash,contractHash:intentBusinessContractHash(contract),clock:{domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H},publications:items.map((v:any)=>({owner:v.owner,operationId:v.observation.publication.operationId,fullTupleHash:H,businessRevision:1,immutablePayloadHash:hash(v.bytes),bindingHash:v.active.bindingHash,applicationRevision:1,candidateRevision:1,registrationHash:v.registration.registrationHash,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1}))}};
 wire.route=(owner:any)=>({kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...owner}});
 wire.call=async(method:string,p:any)=>{
  if(method==='completion.read-intent-contract')return structuredClone(registrations.get(intentHostSubjectOwner(p.subject).ownerId));
  if(method==='publication.observeIntentDependencies')return structuredClone(state.set);
  const item=items.find((v:any)=>v.owner.ownerId===p.ownerId);if(!item)throw Error('fixture_owner');
  if(method==='application.inspect')return {state:'active',current:item.active,pendingTransitionId:null,pendingTarget:null};
  if(method==='publication.observeOwner')return structuredClone(item.observation);
  if(method==='publication.readOwnerPayload'){const part=item.bytes.subarray(p.offset,Math.min(p.offset+17,item.bytes.length));return {owner:item.owner,businessRevision:1,...item.observation.publication,status:undefined,current:undefined,payloadHash:hash(item.bytes),totalBytes:item.bytes.length,offset:p.offset,bytes:part.toString('base64'),eof:p.offset+part.length===item.bytes.length};}
  throw Error('unexpected '+method);
 };
 // Explicit exact transport fields; no helper receipt or publication capability is mocked.
 const original=wire.call;wire.call=async(m:string,p:any)=>{const value=await original(m,p);if(m==='publication.readOwnerPayload'){delete value.status;delete value.current;}return value;};
});
it('fixed original clients read every page and exact complete set; returned bytes are defensive historical data',async()=>{
 const result=await readCurrentIntentPublicationDependencies(state.subject);expect(result.publications).toHaveLength(2);expect(wire.calls.filter(v=>v==='publication.readOwnerPayload').length).toBeGreaterThan(2);expect(wire.calls.at(-1)).toBe('publication.observeIntentDependencies');expect(wire.closed).toBe(wire.opened);
 const original=Buffer.from(result.publications[0].bytes);result.publications[0].bytes.fill(0);expect(result.publications[0].bytes).toEqual(original);expect(Object.isFrozen(result)).toBe(true);
});
it.each(['missing','order','payloadHash','registrationHash','applicationRevision'])('refuses final set %s rather than returning a subset',async mode=>{if(mode==='missing')state.set.publications.pop();else if(mode==='order')state.set.publications.reverse();else state.set.publications[0][mode==='payloadHash'?'immutablePayloadHash':mode]=mode==='applicationRevision'?2:'b'.repeat(64);await expect(readCurrentIntentPublicationDependencies(state.subject)).rejects.toThrow();expect(wire.closed).toBe(wire.opened);});
it('hash-consistent payload with substituted actual artifact bytes is refused',async()=>{const item=state.items[0];item.body.evaluations[0].artifacts[0].bytesBase64=Buffer.from('假的').toString('base64');item.bytes=Buffer.from(json(item.body));state.set.publications[0].immutablePayloadHash=hash(item.bytes);await expect(readCurrentIntentPublicationDependencies(state.subject)).rejects.toThrow();});
it('route drift at final set callback is rejected',async()=>{wire.hook=method=>{if(method==='publication.observeIntentDependencies')wire.route=(owner:any)=>({kind:'protected-unregistered',authorityId:'other',owner:{profileId:'profile',...owner}});};await expect(readCurrentIntentPublicationDependencies(state.subject)).rejects.toThrow();});
it('abort waits for the actual held transport before disposing original clients',async()=>{
 const controller=new AbortController(),original=wire.call;let entered!:()=>void,release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 wire.call=async(method:string,payload:unknown)=>{if(method==='completion.read-intent-contract'){entered();await held;}return original(method,payload);};
 let settled=false;const work=readCurrentIntentPublicationDependencies(state.subject,controller.signal);void work.then(()=>{settled=true;},()=>{settled=true;});
 await started;controller.abort(Error('original_action_closed'));await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);expect(wire.closed).toBe(0);
 release();await expect(work).rejects.toThrow('original_action_closed');expect(wire.closed).toBe(wire.opened);expect(wire.calls).toEqual(['completion.read-intent-contract']);
});
