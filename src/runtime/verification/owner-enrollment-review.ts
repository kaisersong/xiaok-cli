import {captureKSwarmEnrollmentData} from './kswarm-enrollment-data.js';
import {assertIntentEnrollmentEnvelope} from './intent-contract-enrollment.js';
import {createHash} from 'node:crypto';
import {parseGoalApplicationBinding,goalApplicationBindingHash,type GoalApplicationBinding} from './goal-application-binding.js';
import type {VerificationOwner} from './proof-authority.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {parseOwnerEnrollment,type OwnerEnrollment} from './profile-owner-registry.js';
import {parseIndependentRecipeDefinition,type IndependentRecipeSpec} from './independent-recipes.js';
import type {MandatoryObligation} from './proof-authority.js';
export interface OwnerEnrollmentReview {
 version:1;purpose:'completion-owner-enrollment';authorityId:string;challengeId:string;
 principal:{uid:number;accountGeneration:string;auditSessionId:number};profileSlot:'default';enrollment:OwnerEnrollment;
 registration:{migrationEpoch:number;obligations:readonly {obligation:MandatoryObligation;recipe:IndependentRecipeSpec}[];
 source:{kind:'new-owner';fork?:GoalForkSource}|{kind:'migration';sourceSessionId:string;sourceStoreRevision:number;sourceSnapshotHash:string;migrationId:string}};
 deadline:{domainId:string;qualificationEpoch:number;notBefore:number;validUntil:number};
}
export interface GoalForkSource {
 authorityId:string;owner:VerificationOwner;sessionId:string;applicationHash:string;
 registrationHash:string;obligationSetHash:string;dependencies:readonly VerificationOwner[];
}
export interface GoalForkSourceSnapshot {
 source:Readonly<GoalForkSource>;registration:OwnerEnrollmentReview['registration'];application:Readonly<GoalApplicationBinding>;
}
function shape(value:unknown,keys:string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('enrollment_review_shape');}
function id(v:unknown){if(typeof v!=='string'||!v||Buffer.byteLength(v)>160||/[\x00-\x1f\x7f]/.test(v))throw Error('enrollment_review_identifier');}
function integer(v:unknown,min=0){if(!Number.isSafeInteger(v)||(v as number)<min)throw Error('enrollment_review_number');}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
/** Pure parser for the complete native review. No parsed value is an approval. */
export function parseOwnerEnrollmentReview(raw:unknown):Readonly<OwnerEnrollmentReview>{
 raw=captureKSwarmEnrollmentData(raw,true);assertIntentEnrollmentEnvelope(raw);
 const serialized=json(raw);if(Buffer.byteLength(serialized)>65536||Buffer.byteLength(serialized.replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')))>65536)throw Error('enrollment_review_limit');
 const r=JSON.parse(serialized);shape(r,['version','purpose','authorityId','challengeId','principal','profileSlot','enrollment','registration','deadline']);
 if(r.version!==1||r.purpose!=='completion-owner-enrollment'||r.profileSlot!=='default')throw Error('enrollment_review_purpose');id(r.authorityId);id(r.challengeId);
 shape(r.principal,['uid','accountGeneration','auditSessionId']);integer(r.principal.uid,1);integer(r.principal.auditSessionId,1);if(r.principal.uid>=0xffffffff||r.principal.auditSessionId>0xffffffff||typeof r.principal.accountGeneration!=='string'||!/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(r.principal.accountGeneration))throw Error('enrollment_review_principal');
 r.enrollment=parseOwnerEnrollment(r.enrollment);
 r.registration=parseOwnerEnrollmentRegistration(r.registration);
 if(r.registration.source.kind==='new-owner'&&r.registration.source.fork&&(r.enrollment.ownerKind!=='goal'||!r.enrollment.goalSessionId||r.enrollment.ownerId===r.registration.source.fork.owner.ownerId||r.enrollment.goalSessionId===r.registration.source.fork.sessionId))throw Error('enrollment_fork_target');
 shape(r.deadline,['domainId','qualificationEpoch','notBefore','validUntil']);id(r.deadline.domainId);integer(r.deadline.qualificationEpoch);integer(r.deadline.notBefore);integer(r.deadline.validUntil);if(r.deadline.validUntil<=r.deadline.notBefore||r.deadline.validUntil-r.deadline.notBefore>300000)throw Error('enrollment_review_deadline');
 return freeze(r) as Readonly<OwnerEnrollmentReview>;
}

export function parseOwnerEnrollmentRegistration(raw:unknown):OwnerEnrollmentReview['registration'] {
 const registration=JSON.parse(json(raw));
 shape(registration,['migrationEpoch','obligations','source']);integer(registration.migrationEpoch,1);
 if(!Array.isArray(registration.obligations)||!registration.obligations.length||registration.obligations.length>256)throw Error('enrollment_review_obligations');
 const seen=new Set<string>();
 for(const entry of registration.obligations){
  shape(entry,['obligation','recipe']);const o=entry.obligation;shape(o,['obligationId','predicateId','predicateVersion','semantics','definitionHash','requiredCheckIds']);[o.obligationId,o.predicateId,o.predicateVersion].forEach(id);
  if(seen.has(o.obligationId)||!['current-subject','specific-run','cumulative'].includes(o.semantics))throw Error('enrollment_review_obligations');seen.add(o.obligationId);
  const definition=parseIndependentRecipeDefinition(entry.recipe);
  if(o.definitionHash!==definition.definitionHash||json(o.requiredCheckIds)!==json(definition.requiredCheckIds))throw Error('enrollment_review_recipe_binding');entry.recipe=definition.spec;
 }
 const source=registration.source;
 if(source?.kind==='new-owner'){shape(source,source.fork===undefined?['kind']:['kind','fork']);if(source.fork!==undefined)source.fork=parseGoalForkSource(source.fork);if(registration.migrationEpoch!==1)throw Error('enrollment_review_migration');}
 else{shape(source,['kind','sourceSessionId','sourceStoreRevision','sourceSnapshotHash','migrationId']);if(source.kind!=='migration')throw Error('enrollment_review_migration');id(source.sourceSessionId);id(source.migrationId);integer(source.sourceStoreRevision);if(typeof source.sourceSnapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceSnapshotHash))throw Error('enrollment_review_migration');}
 return freeze(registration) as OwnerEnrollmentReview['registration'];
}

export function parseGoalForkSource(raw:unknown):Readonly<GoalForkSource> {
 const source=JSON.parse(json(raw));shape(source,['authorityId','owner','sessionId','applicationHash','registrationHash','obligationSetHash','dependencies']);
 id(source.authorityId);id(source.sessionId);
 const owner=(v:any)=>{shape(v,['profileId','ownerKind','ownerId']);id(v.profileId);id(v.ownerId);if(!['goal','task','intent','loop','project'].includes(v.ownerKind))throw Error('enrollment_fork_owner');};
 owner(source.owner);if(source.owner.ownerKind!=='goal')throw Error('enrollment_fork_owner');
 for(const key of ['applicationHash','registrationHash','obligationSetHash'])if(typeof source[key]!=='string'||!/^[a-f0-9]{64}$/.test(source[key]))throw Error('enrollment_fork_hash');
 if(!Array.isArray(source.dependencies)||source.dependencies.length>256)throw Error('enrollment_fork_dependencies');
 const seen=new Set<string>();for(const child of source.dependencies){owner(child);const key=json(child);if(child.profileId!==source.owner.profileId||key===json(source.owner)||seen.has(key))throw Error('enrollment_fork_dependencies');seen.add(key);}
 if(json(source.dependencies)!==json([...source.dependencies].sort((a,b)=>json(a).localeCompare(json(b)))))throw Error('enrollment_fork_dependencies');
 return freeze(source) as Readonly<GoalForkSource>;
}
export function goalRegistrationHash(registration:OwnerEnrollmentReview['registration']):string {
 return createHash('sha256').update('xiaok-goal-original-registration-v1\0').update(json(registration)).digest('hex');
}
/** Pure read-result parser; a snapshot is neither an approval nor a proof. */
export function parseGoalForkSourceSnapshot(raw:unknown):Readonly<GoalForkSourceSnapshot> {
 const text=json(raw);if(Buffer.byteLength(text)>65536)throw Error('enrollment_fork_limit');
 const value=JSON.parse(text);shape(value,['source','registration','application']);
 value.source=parseGoalForkSource(value.source);value.registration=parseOwnerEnrollmentRegistration(value.registration);value.application=parseGoalApplicationBinding(value.application);
 if(value.source.registrationHash!==goalRegistrationHash(value.registration)||value.source.applicationHash!==goalApplicationBindingHash(value.application)||value.source.owner.ownerId!==value.application.goalId||value.source.sessionId!==value.application.sessionId)throw Error('enrollment_fork_binding');
 return freeze(value) as Readonly<GoalForkSourceSnapshot>;
}
