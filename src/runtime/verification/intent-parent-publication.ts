import {createHash} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import type {VerificationOwner} from './proof-authority.js';
import {parseIntentApplicationBinding,type IntentApplicationBinding} from './intent-application-binding.js';
import {intentHostSubjectOwner} from './intent-host-subject.js';
import {parseActiveBusinessApplicationBinding} from './business-application-binding.js';
import {canonicalVerificationJson as json,parseVerificationTuple,hashVerificationTuple,type VerificationDependency,type VerificationTuple} from './protocol.js';
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export interface IntentPublicationOwnerObservation {migrationEpoch:number;businessRevision:number;obligationSetRevision:number;obligationSetHash:string;currentVerification:string}
/** Private same-database fact census. It neither accepts a receiver DTO nor
 * reconstructs an authenticated reply. Unrelated historical payloads are not scanned. */
export function intentParentPublicationVector(db:Database,owner:VerificationOwner,binding:Readonly<IntentApplicationBinding>):string {
 if(binding.body.kind!=='intent-parent')return '[]';
 const parentKey=json(owner),parentMandatory=db.prepare('SELECT * FROM mandatory_observation_checks WHERE owner_key=? ORDER BY obligation_id').all(parentKey) as any[];
 const parent={owner:db.prepare('SELECT * FROM verification_owners WHERE owner_key=?').get(parentKey)??null,application:db.prepare('SELECT * FROM verification_application_pointers WHERE owner_key=?').get(parentKey)??null,mandatory:parentMandatory,edges:db.prepare('SELECT * FROM verification_owner_dependencies WHERE parent_key=? ORDER BY child_key').all(parentKey),scopes:db.prepare('SELECT * FROM verification_scopes WHERE owner_key=? ORDER BY scope_id').all(parentKey),subjects:db.prepare('SELECT * FROM verification_subjects WHERE owner_key=? ORDER BY subject_id').all(parentKey),attempts:parentMandatory.map(row=>({attempt:db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(row.active_attempt)??null,proofs:db.prepare('SELECT * FROM verifier_proofs WHERE attempt_id=? ORDER BY proof_id').all(row.active_attempt),cores:db.prepare('SELECT * FROM execution_facts_revisions WHERE attempt_id=? ORDER BY revision').all(row.active_attempt)}))};
 return json({parent,references:binding.body.stages.map(ref=>{
  const child={profileId:owner.profileId,...intentHostSubjectOwner(ref.subject)},key=json(child),journal=db.prepare('SELECT * FROM publication_journal WHERE operation_id=?').get(ref.operationId) as any;
  const payload=db.prepare('SELECT * FROM verified_publication_payloads WHERE owner_key=? AND payload_hash=?').get(key,ref.immutablePayloadHash) as any;
  const dependencies=payload?JSON.parse(payload.dependencies_json):[],owners=new Set<string>([key]);for(const dep of dependencies)if(dep.kind==='inherited')owners.add(json(dep.originOwner));
  return {reference:ref,journal:journal??null,payload:payload?{...payload,payload:hash(payload.payload)}:null,publicationOwner:journal?db.prepare('SELECT * FROM publication_owner WHERE owner_key=?').get(journal.owner_key)??null:null,decision:db.prepare('SELECT * FROM settlement_decisions WHERE operation_id=?').get(ref.operationId)??null,
   owners:[...owners].sort().map(ownerKey=>({owner:db.prepare('SELECT * FROM verification_owners WHERE owner_key=?').get(ownerKey)??null,application:db.prepare('SELECT * FROM verification_application_pointers WHERE owner_key=?').get(ownerKey)??null,edges:db.prepare('SELECT * FROM verification_owner_dependencies WHERE parent_key=? ORDER BY child_key').all(ownerKey),mandatory:db.prepare('SELECT * FROM mandatory_observation_checks WHERE owner_key=? ORDER BY obligation_id').all(ownerKey),scopes:db.prepare('SELECT * FROM verification_scopes WHERE owner_key=? ORDER BY scope_id').all(ownerKey),subjects:db.prepare('SELECT * FROM verification_subjects WHERE owner_key=? ORDER BY subject_id').all(ownerKey)})),
   attempts:dependencies.map((dep:VerificationDependency)=>({attempt:db.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(dep.activeAttemptId)??null,proofs:db.prepare('SELECT * FROM verifier_proofs WHERE attempt_id=? ORDER BY proof_id').all(dep.activeAttemptId),cores:db.prepare('SELECT * FROM execution_facts_revisions WHERE attempt_id=? ORDER BY revision').all(dep.activeAttemptId)})),
  };
 })});
}
function sections(owner:VerificationOwner,values:readonly any[]){
 if(!Array.isArray(values)||values.length>256)throw Error('intent_parent_sections');const result=new Map<string,string>();
 for(const section of values){const originOwner=section.kind==='inherited'?section.originOwner:owner,originalObligationId=section.kind==='inherited'?section.originalObligationId:section.obligationId,key=json([originOwner,originalObligationId]);
  if(result.has(key))throw Error('intent_parent_section_duplicate');result.set(key,json({originOwner,originalObligationId,definitionHash:section.definitionHash,binding:section.binding,evaluation:section.evaluation,artifacts:section.artifacts,application:section.application??null}));}
 return result;
}
/** Revalidate original stage publications against original authority rows. The
 * caller is the fixed payload factory, never a product-supplied freshness callback. */
export function assertIntentParentPublication(input:{database:Database;owner:VerificationOwner;binding:Readonly<IntentApplicationBinding>;payloadOwner:VerificationOwner;sections:readonly unknown[];inspectOwner?:(owner:VerificationOwner)=>IntentPublicationOwnerObservation|undefined;getCurrentDependencies(owner:VerificationOwner):readonly VerificationDependency[];assertPublicationTuplesCurrent?:(tuples:readonly VerificationTuple[])=>void}):void {
 const {database:db,owner,payloadOwner}=input,binding=parseIntentApplicationBinding(input.binding);if(binding.body.kind!=='intent-parent')return;
 if(!input.inspectOwner||!input.assertPublicationTuplesCurrent)throw Error('intent_parent_authority_unavailable');
 const before=intentParentPublicationVector(db,owner,binding),union=new Map<string,string>(),tuples:VerificationTuple[]=[],originalArtifacts:unknown[]=[];
 for(const ref of binding.body.stages){
  const child={profileId:owner.profileId,...intentHostSubjectOwner(ref.subject)},key=json(child),row=db.prepare('SELECT * FROM publication_journal WHERE operation_id=?').get(ref.operationId) as any;if(!row)throw Error('intent_parent_publication_missing');
  const tuple=parseVerificationTuple(JSON.parse(row.tuple_json)),tupleHash=hashVerificationTuple(tuple),tupleOwner=json([tuple.profileId,tuple.ownerKind,tuple.ownerId,tuple.migrationEpoch]);
  if(row.tuple_json!==json(tuple)||row.tuple_hash!==tupleHash||tupleHash!==ref.fullTupleHash||row.owner_key!==tupleOwner||json({profileId:tuple.profileId,ownerKind:tuple.ownerKind,ownerId:tuple.ownerId})!==key||tuple.operationId!==ref.operationId||tuple.immutablePayloadHash!==ref.immutablePayloadHash||tuple.receiverId!==ref.receiverId||tuple.receiverProtocolVersion!==ref.receiverProtocolVersion||tuple.receiverInstanceEpoch!==ref.receiverInstanceEpoch||tuple.expectedBusinessRevision+1!==ref.committedBusinessRevision)throw Error('intent_parent_publication_binding');
  const state=JSON.parse(row.state_json),publicationOwner=db.prepare('SELECT revocation FROM publication_owner WHERE owner_key=?').get(tupleOwner) as any,decision=db.prepare('SELECT * FROM settlement_decisions WHERE operation_id=?').get(ref.operationId) as any,reply=row.reply_json?JSON.parse(row.reply_json):null;
  if(json(state)!==json({reservation:'consumed',outbox:'receiver_committed',revocation:'active'})||publicationOwner?.revocation!=='active'||decision?.owner_key!==key||decision?.tuple_hash!==tupleHash||decision?.tuple_json!==row.tuple_json||reply?.domain!=='xiaok.p3r.receiver.v1'||reply.receiverId!==ref.receiverId||reply.receiverInstanceEpoch!==ref.receiverInstanceEpoch||reply.fullTupleHash!==tupleHash||reply.result?.status!=='committed'||reply.result.fullTupleHash!==tupleHash)throw Error('intent_parent_publication_receipt');
  const replyClock=reply.result.clock;
  if(Object.keys(reply).sort().join(',')!=='challenge,domain,fullTupleHash,keyId,receiverId,receiverInstanceEpoch,result'||typeof reply.keyId!=='string'||!reply.keyId||!/^[a-f0-9]{64}$/.test(reply.challenge)||Object.keys(reply.result).sort().join(',')!=='clock,fullTupleHash,objectRevision,status,terminalRecordHash'||!Number.isSafeInteger(reply.result.objectRevision)||reply.result.objectRevision<1||!/^[a-f0-9]{64}$/.test(reply.result.terminalRecordHash)||!replyClock||Object.keys(replyClock).sort().join(',')!=='domainId,evidenceHash,lowerBound,qualificationEpoch,upperBound'||replyClock.domainId!==tuple.clockDomainId||replyClock.qualificationEpoch!==tuple.clockQualificationEpoch||!Number.isSafeInteger(replyClock.lowerBound)||!Number.isSafeInteger(replyClock.upperBound)||replyClock.lowerBound<tuple.notBefore||replyClock.upperBound<replyClock.lowerBound||replyClock.upperBound>=tuple.validUntil||!/^[a-f0-9]{64}$/.test(replyClock.evidenceHash))throw Error('intent_parent_publication_receipt');
  // journal.challenge is deliberately mutable for later receiver queries. The
  // stored terminal reply was authenticated at commit and is not a new ticket.
  tuples.push(tuple);
  const observed=input.inspectOwner(child),dependencies=input.getCurrentDependencies(child);
  if(!observed||observed.currentVerification!=='valid'||observed.migrationEpoch!==tuple.migrationEpoch||observed.businessRevision!==ref.committedBusinessRevision||observed.obligationSetRevision!==tuple.obligationSetRevision||observed.obligationSetHash!==tuple.obligationSetHash||json(dependencies)!==json(tuple.obligations))throw Error('intent_parent_publication_not_current');
  const pointer=db.prepare('SELECT current_json,pending_id FROM verification_application_pointers WHERE owner_key=?').get(key) as any;if(!pointer?.current_json||pointer.pending_id)throw Error('intent_parent_application');const current=parseActiveBusinessApplicationBinding(JSON.parse(pointer.current_json));
  if(current.binding.kind!=='intent'||current.binding.body.kind!=='intent-stage'||json(current.binding.subject)!==json(ref.subject)||current.bindingHash!==ref.bindingHash||current.binding.candidateId!==ref.candidateId||current.binding.candidateRevision!==ref.candidateRevision||current.binding.contractHash!==binding.contractHash||json(current.binding.contract)!==json(binding.contract))throw Error('intent_parent_application');
  const payload=db.prepare('SELECT * FROM verified_publication_payloads WHERE owner_key=? AND payload_hash=?').get(key,ref.immutablePayloadHash) as any;if(!payload||hash(payload.payload)!==ref.immutablePayloadHash||payload.dependencies_json!==json(dependencies))throw Error('intent_parent_payload');const body=JSON.parse(payload.payload.toString('utf8'));
  if(!Buffer.from(json(body)).equals(payload.payload)||body.version!==1||json(body.owner)!==key||json(body.application)!==json(current)||json(body.dependencies)!==json(dependencies))throw Error('intent_parent_payload');
  originalArtifacts.push(...current.binding.body.artifacts.map(artifact=>({...artifact,selection:artifact.selection.kind==='local'?{...artifact.selection,kind:'inherited',originOwner:child,originalObligationId:artifact.selection.obligationId}:artifact.selection})));
  for(const [id,value] of sections(child,body.evaluations)){const old=union.get(id);if(old!==undefined&&old!==value)throw Error('intent_parent_section_conflict');union.set(id,value);}
 }
 if(json(binding.body.artifacts)!==json(originalArtifacts))throw Error('intent_parent_artifacts');
 const actual=sections(payloadOwner,input.sections as any[]),parentLocal=sections(owner,(input.sections as any[]).filter(s=>s.kind!=='inherited'&&json(payloadOwner)===json(owner)));
 for(const key of parentLocal.keys())actual.delete(key);
 // Parent local obligations remain independently checked by the payload factory.
 if(json([...actual].sort())!==json([...union].sort()))throw Error('intent_parent_inherited_sections');
 const asserted:unknown=input.assertPublicationTuplesCurrent(tuples);if(asserted!==undefined){void Promise.resolve(asserted).catch(()=>{});throw Error('intent_parent_sync');}
 if(intentParentPublicationVector(db,owner,binding)!==before)throw Error('intent_parent_publication_changed');
}
