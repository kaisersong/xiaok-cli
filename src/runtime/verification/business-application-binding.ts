import {applicationDataDescriptors} from './application-value-data.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {parseGoalApplicationBinding,goalApplicationBindingHash,type GoalApplicationBinding,type ActiveGoalApplicationBinding} from './goal-application-binding.js';
import {parseLoopApplicationBinding,loopApplicationBindingHash,type LoopApplicationBinding} from './loop-application-binding.js';
import {parseIntentApplicationBinding,intentApplicationBindingHash,type IntentApplicationBinding} from './intent-application-binding.js';
import {intentHostSubjectOwner} from './intent-host-subject.js';
import {loopHostSubjectOwner} from './loop-host-subject.js';

export type BusinessApplicationBinding=GoalApplicationBinding|LoopApplicationBinding|IntentApplicationBinding;
export interface ActiveLoopApplicationBinding {binding:Readonly<LoopApplicationBinding>;bindingHash:string;revision:number}
export interface ActiveIntentApplicationBinding {binding:Readonly<IntentApplicationBinding>;bindingHash:string;revision:number}
export type ActiveBusinessApplicationBinding=ActiveGoalApplicationBinding|ActiveLoopApplicationBinding|ActiveIntentApplicationBinding;
export interface BusinessApplicationObservation {state:'unbound'|'pending'|'active';current:Readonly<ActiveBusinessApplicationBinding>|null;pendingTransitionId:string|null}

/** Strict closed union of business values, never an approval or projection. */
export function parseBusinessApplicationBinding(raw:unknown):Readonly<BusinessApplicationBinding>{
 const descriptors=applicationDataDescriptors(raw,65536,'intent_application_data'),kind=descriptors.kind?.value;
 if(typeof kind!=='string')throw Error('business_application_kind');
 if(kind==='intent')return parseIntentApplicationBinding(raw);
 if(kind==='goal')return parseGoalApplicationBinding(raw);
 if(kind==='loop')return parseLoopApplicationBinding(raw);
 throw Error('business_application_kind');
}
export function businessApplicationBindingHash(raw:unknown):string{
 const binding=parseBusinessApplicationBinding(raw);
 return binding.kind==='goal'?goalApplicationBindingHash(binding):binding.kind==='loop'?loopApplicationBindingHash(binding):intentApplicationBindingHash(binding);
}
export function businessApplicationOwner(raw:unknown){
 const binding=parseBusinessApplicationBinding(raw);
 return binding.kind==='goal'?Object.freeze({ownerKind:'goal' as const,ownerId:binding.goalId}):binding.kind==='loop'?loopHostSubjectOwner(binding.subject):intentHostSubjectOwner(binding.subject);
}
export function businessApplicationEpoch(raw:unknown):number{
 const binding=parseBusinessApplicationBinding(raw);return binding.kind==='goal'?binding.epoch:binding.candidateRevision;
}
export function sameBusinessApplicationSubject(left:unknown,right:unknown):boolean{
 const a=parseBusinessApplicationBinding(left),b=parseBusinessApplicationBinding(right);
 if(a.kind==='goal'&&b.kind==='goal')return a.goalId===b.goalId&&a.sessionId===b.sessionId;
 return ((a.kind==='loop'&&b.kind==='loop')||(a.kind==='intent'&&b.kind==='intent'))&&json(a.subject)===json(b.subject);
}
export function parseActiveBusinessApplicationBinding(raw:unknown):Readonly<ActiveBusinessApplicationBinding>{
 const descriptors=applicationDataDescriptors(raw,3,'intent_application_data');
 if(Object.keys(descriptors).sort().join(',')!=='binding,bindingHash,revision')throw Error('business_application_active');
 const bindingHash=descriptors.bindingHash!.value,revision=descriptors.revision!.value;
 if(typeof bindingHash!=='string'||!/^[a-f0-9]{64}$/.test(bindingHash)||!Number.isSafeInteger(revision)||revision<1)throw Error('business_application_active');
 const binding=parseBusinessApplicationBinding(descriptors.binding!.value),value={binding,bindingHash,revision};
 const bindingBytes=Buffer.byteLength(json(binding));
 if(Buffer.byteLength(json(value))>(binding.kind==='intent'?bindingBytes+256:65536))throw Error('business_application_limit');
 if(bindingHash!==businessApplicationBindingHash(binding))throw Error('business_application_hash');
 return Object.freeze(value) as Readonly<ActiveBusinessApplicationBinding>;
}
