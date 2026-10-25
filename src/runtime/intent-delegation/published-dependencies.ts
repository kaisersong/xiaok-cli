import {createHash} from 'node:crypto';
import {createInstalledVerificationClient} from '../verification/controller-client.js';
import {createOwnerEnrollmentClient} from '../verification/completion-client.js';
import {createInstalledCompletionPublisher} from '../verification/installed-completion-publication.js';
import {readInstalledCurrentOwner} from '../verification/installed-owner-state.js';
import {parseIntentHostSubject,intentHostSubjectOwner,type IntentHostSubject} from '../verification/intent-host-subject.js';
import {parseActiveBusinessApplicationBinding,type ActiveIntentApplicationBinding} from '../verification/business-application-binding.js';
import {assertIntentApplicationArtifacts} from '../verification/intent-application-artifacts.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
import type {IntentContractRegistrationObservation} from '../verification/intent-contract-enrollment.js';
import type {VerificationOwner} from '../verification/proof-authority.js';
import type {ReceiverClockEvidence} from '../verification/receiver-store.js';
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
function shape(raw:unknown,keys:string):any{const v=JSON.parse(json(raw));if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.split(' ').sort().join(','))throw Error('intent_publication_read_shape');return v;}
function integer(v:unknown,min=0){if(!Number.isSafeInteger(v)||(v as number)<min)throw Error('intent_publication_read_number');}
function digest(v:unknown){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw Error('intent_publication_read_hash');}
export interface CurrentIntentDependencyPublication {
 readonly owner:Readonly<VerificationOwner>;readonly registration:Readonly<IntentContractRegistrationObservation>;
 readonly application:Readonly<ActiveIntentApplicationBinding>;readonly operationId:string;readonly fullTupleHash:string;
 readonly businessRevision:number;readonly payloadHash:string;readonly bytes:Buffer;
 readonly receiverId:string;readonly receiverProtocolVersion:1;readonly receiverInstanceEpoch:number;
}
/** Fixed read only: complete historical bytes and one final authority observation,
 * never a business write capability or a continuously held remote lock. */
async function readCurrentIntentPublicationSet(raw:Readonly<IntentHostSubject>,signal:AbortSignal|undefined,includeSelf:boolean){
 const subject=parseIntentHostSubject(raw),requested=intentHostSubjectOwner(subject),deadline=new AbortController(),active=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
 const timer=setTimeout(()=>deadline.abort(Error('intent_publication_read_timeout')),300000),routes=new Map<string,string>();
 let client:ReturnType<typeof createInstalledVerificationClient>|undefined;
 function route(owner:ReturnType<typeof intentHostSubjectOwner>){active.throwIfAborted();const value=readInstalledCurrentOwner(owner);if(value.kind!=='migrated'&&value.kind!=='protected-unregistered')throw Error('intent_publication_owner_unavailable');return value;}
 function current(){active.throwIfAborted();for(const [owner,original] of routes)if(json(route(JSON.parse(owner)))!==original)throw Error('intent_publication_route_changed');active.throwIfAborted();}
 async function wait<T>(work:()=>Promise<T>):Promise<T>{current();try{const value=await work();current();return value;}catch(error){active.throwIfAborted();throw error;}}
 try{
  const initialRoute=route(requested);routes.set(json(requested),json(initialRoute));client=createInstalledVerificationClient();const enrollment=createOwnerEnrollmentClient(client.completionTransport);
  const registration=await wait(()=>enrollment.readIntentContract({subject},active));if(json(registration.owner)!==json(initialRoute.owner))throw Error('intent_publication_owner');
  const ids=subject.stageId===null?registration.contract.stages.map(s=>s.stageId):registration.contract.stages.find(s=>s.stageId===subject.stageId)!.dependsOnStageIds;
  const publications:Readonly<Omit<CurrentIntentDependencyPublication,'receiverId'|'receiverProtocolVersion'|'receiverInstanceEpoch'>>[]=[];
  for(const stageId of includeSelf?[subject.stageId,...ids]:ids){
   const dependencySubject={...subject,stageId},ownerRequest=intentHostSubjectOwner(dependencySubject),originalRoute=route(ownerRequest);
   if(originalRoute.authorityId!==initialRoute.authorityId||originalRoute.owner.profileId!==initialRoute.owner.profileId)throw Error('intent_publication_route_changed');routes.set(json(ownerRequest),json(originalRoute));
   const dependency=await wait(()=>enrollment.readIntentContract({subject:dependencySubject},active));
   if(json(dependency.owner)!==json(originalRoute.owner)||json(dependency.contract)!==json(registration.contract))throw Error('intent_publication_registration');
   const inspect=async()=>{const v=shape(await wait(()=>client!.applicationTransport.call('application.inspect',ownerRequest,active)),'state current pendingTransitionId pendingTarget');if(v.state!=='active'||v.pendingTransitionId!==null||v.pendingTarget!==null)throw Error('intent_publication_application_pending');const a=parseActiveBusinessApplicationBinding(v.current);if(a.binding.kind!=='intent'||json(a.binding.subject)!==json(dependencySubject)||json(a.binding.contract)!==json(registration.contract))throw Error('intent_publication_application');return a as Readonly<ActiveIntentApplicationBinding>;};
   const application=await inspect(),publisher=createInstalledCompletionPublisher(ownerRequest,'scheduler');
   try{
    const observed=await wait(()=>publisher.observe(active));if(observed.currentVerification!=='valid'||observed.publication.status!=='committed'||!observed.publication.current||json(observed.owner)!==json(dependency.owner))throw Error('intent_publication_not_current');
    const payload=await wait(()=>publisher.readPayload(observed,active)),bytes=Buffer.from(payload.bytes),body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(bytes.length>32*1024**2||hash(bytes)!==payload.payloadHash||json(payload.owner)!==json(dependency.owner)||payload.businessRevision!==observed.businessRevision||payload.operationId!==observed.publication.operationId||payload.fullTupleHash!==observed.publication.fullTupleHash||body?.version!==1||json(body.owner)!==json(dependency.owner)||!Buffer.from(json(body)).equals(bytes)||json(parseActiveBusinessApplicationBinding(body.application))!==json(application))throw Error('intent_publication_payload');
    assertIntentApplicationArtifacts(dependency.owner,application.binding,dependency.owner,body.evaluations);
    if(json(await inspect())!==json(application)||json(await wait(()=>publisher.observe(active)))!==json(observed))throw Error('intent_publication_changed');
    publications.push(Object.freeze({owner:dependency.owner,registration:dependency,application,operationId:payload.operationId,fullTupleHash:payload.fullTupleHash,businessRevision:payload.businessRevision,payloadHash:payload.payloadHash,get bytes(){return Buffer.from(bytes);}}));
   }finally{publisher.dispose();}
  }
  const value=shape(await wait(()=>client!.publicationTransport.call(includeSelf?'publication.observeIntentCompletion':'publication.observeIntentDependencies',{subject},active)),(includeSelf?'scope ':'')+'subject owner contractHash registrationHash clock publications');
  if(includeSelf&&value.scope!=='self-and-dependencies')throw Error('intent_publication_set');
  if(json(value.subject)!==json(subject)||json(value.owner)!==json(registration.owner)||value.contractHash!==registration.contractHash||value.registrationHash!==registration.registrationHash||!Array.isArray(value.publications)||value.publications.length!==publications.length)throw Error('intent_publication_set');
  const clock=shape(value.clock,'domainId qualificationEpoch lowerBound upperBound evidenceHash');if(typeof clock.domainId!=='string'||!clock.domainId||Buffer.byteLength(clock.domainId)>160||/[\x00-\x1f\x7f]/.test(clock.domainId))throw Error('intent_publication_clock');digest(clock.evidenceHash);for(const k of ['qualificationEpoch','lowerBound','upperBound'])integer(clock[k]);if(clock.upperBound<clock.lowerBound)throw Error('intent_publication_clock');
  const complete:Readonly<CurrentIntentDependencyPublication>[]=value.publications.map((raw:any,i:number)=>{const p=shape(raw,'owner operationId fullTupleHash businessRevision immutablePayloadHash bindingHash applicationRevision candidateRevision registrationHash receiverId receiverProtocolVersion receiverInstanceEpoch'),known=publications[i],{receiverId,receiverProtocolVersion,receiverInstanceEpoch,...original}=p;if(typeof receiverId!=='string'||!receiverId||Buffer.byteLength(receiverId)>160||/[\x00-\x1f\x7f]/.test(receiverId)||receiverProtocolVersion!==1)throw Error('intent_publication_receiver');integer(receiverInstanceEpoch);if(json(original)!==json({owner:known.owner,operationId:known.operationId,fullTupleHash:known.fullTupleHash,businessRevision:known.businessRevision,immutablePayloadHash:known.payloadHash,bindingHash:known.application.bindingHash,applicationRevision:known.application.revision,candidateRevision:known.application.binding.candidateRevision,registrationHash:known.registration.registrationHash}))throw Error('intent_publication_set_changed');return Object.freeze({...known,get bytes(){return known.bytes;},receiverId,receiverProtocolVersion:1 as const,receiverInstanceEpoch}) as Readonly<CurrentIntentDependencyPublication>;});
  current();return Object.freeze({...(includeSelf?{scope:'self-and-dependencies' as const}:{}),subject,registration,clock:Object.freeze(clock) as Readonly<ReceiverClockEvidence>,publications:Object.freeze(complete)});
 }finally{clearTimeout(timer);client?.dispose();}
}

/** Existing SDK dependency gate deliberately excludes the subject itself. */
export function readCurrentIntentPublicationDependencies(raw:Readonly<IntentHostSubject>,signal?:AbortSignal){return readCurrentIntentPublicationSet(raw,signal,false);}
/** Fixed whole completion read: self and every registered dependency, one final controller clock. Not a write grant. */
export function readCurrentIntentPublicationCompletion(raw:Readonly<IntentHostSubject>,signal?:AbortSignal){return readCurrentIntentPublicationSet(raw,signal,true);}
