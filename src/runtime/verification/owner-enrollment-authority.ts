import {assertNativeSqliteArrayConstruction} from './native-sqlite-construction-intrinsics.js';
import {readIntentSqlContract} from './intent-sql-parsing-context.js';
import {createRegistrationCensusDatabase,REGISTRATION_TABLE_KEYS} from './registration-census-database.js';
import {isDeepStrictEqual as initialIsDeepStrictEqual} from 'node:util';
const isDeepStrictEqual=initialIsDeepStrictEqual;
import {captureRegistrationSnapshot} from './registration-value-snapshot.js';
import {assertKSwarmSqlIntegrity} from './kswarm-sql-integrity.js';
import {captureKSwarmEnrollmentData} from './kswarm-enrollment-data.js';
import {assertKSwarmEnrollmentCapability} from './kswarm-enrollment-capability.js';
import {createKSwarmEnrollmentStore} from './kswarm-enrollment-store.js';
import {kswarmHostSubjectOwner,parseKSwarmHostSubject,type KSwarmHostSubject} from './kswarm-host-subject.js';
import {goalVerificationRegistration} from '../goal/verification-definition.js';
import {assertIntentEnrollmentEnvelope} from './intent-contract-enrollment.js';
import type { OwnerEnrollmentRequest, OwnerEnrollmentRequestObservation, OwnerEnrollmentRequestRecovery, OwnerEnrollmentChallenge } from './owner-enrollment-request.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import type {ControllerPeer} from './controller-public-daemon.js';
import type {createCompletionBoundary} from './completion-boundary.js';
import {createProfileOwnerRegistry,type PublicProfileIndex,type EnrollmentContext,type OwnerEnrollment} from './profile-owner-registry.js';
import {parseOwnerEnrollmentReview,parseOwnerEnrollmentRegistration,parseGoalForkSourceSnapshot,goalRegistrationHash,type OwnerEnrollmentReview} from './owner-enrollment-review.js';
import {parseMigrationMarker} from './migration-markers.js';
import type {ReceiverClockEvidence} from './receiver-store.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from './storage-budget.js';
import type {VerificationOwner,MandatoryObligation} from './proof-authority.js';
import {parseIndependentRecipeDefinition} from './independent-recipes.js';
import {isIntentContractOwner,parseIntentContractEnrollment,intentContractOriginalRegistration,intentContractDependencies,intentOriginalRegistrationHash} from './intent-contract-enrollment.js';
import {parseIntentHostSubject,intentHostSubjectOwner,type IntentHostSubject} from './intent-host-subject.js';
import {intentBusinessContractHash} from './intent-business-contract.js';
import {parseLoopHostSubject,loopHostSubjectOwner,type LoopHostSubject} from './loop-host-subject.js';
interface Principal extends ControllerPeer {accountGeneration:string;source:'macos-local-generateduid'}
interface RequestRow {request_id:string;principal_json:string;proposal_json:string;request_hash:string;challenge_id:string|null;state:string;owner_json:string|null}
interface Row {id:string;principal:string;boot:string;state:string;review_json:string}
const hash=(value:unknown)=>createHash('sha256').update(json(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))).digest('hex');
function copy<T>(value:T):T{const text=json(value);if(Buffer.byteLength(text)>1024**2)throw Error('enrollment_payload_limit');return JSON.parse(text);}
function shape(value:unknown,keys:string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('enrollment_shape');}
function peerValue(raw:ControllerPeer){const peer=copy(raw);shape(peer,['uid','gid','auditSessionId']);if(![peer.uid,peer.gid,peer.auditSessionId].every(x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff)||peer.uid===0||peer.auditSessionId===0)throw Error('enrollment_principal');return Object.freeze(peer);}
/** Private installed composition. Actual broker/native ports remain required.
 * This controller creates no proof of successful execution and is not OS qualification. */
export function createOwnerEnrollmentAuthority(input:{
 kswarmCapability?:object;database:Database;authorityId:string;completion:ReturnType<typeof createCompletionBoundary>;clock():ReceiverClockEvidence;
 resolvePrincipal(peer:ControllerPeer):Principal;
 approve(review:Readonly<OwnerEnrollmentReview>,signal:AbortSignal):Promise<{uid:number;auditSessionId:number;reviewHash:string}>;
 profilePublication:{publish(index:Readonly<PublicProfileIndex>):void;assertPublished(index:Readonly<PublicProfileIndex>):void};
}){
 const {database:db,authorityId,completion,clock:readClock,resolvePrincipal,approve}=input,boot=randomUUID(),lifetime=new AbortController();completion.host.assertDatabaseConnection(db);
 const registrationDatabase=createRegistrationCensusDatabase(db),registrationEvidence=new WeakMap<object,unknown>();
 const publishProfile=input.profilePublication.publish.bind(input.profilePublication),assertProfilePublished=input.profilePublication.assertPublished.bind(input.profilePublication);
 db.exec(`CREATE TABLE IF NOT EXISTS owner_enrollment_challenges(id TEXT PRIMARY KEY,principal TEXT NOT NULL,boot TEXT NOT NULL,state TEXT NOT NULL,review_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS owner_enrollment_requests(request_id TEXT PRIMARY KEY,principal_json TEXT NOT NULL,proposal_json TEXT NOT NULL,request_hash TEXT NOT NULL,challenge_id TEXT UNIQUE,state TEXT NOT NULL,owner_json TEXT);
 CREATE TABLE IF NOT EXISTS owner_enrollment_intents(logical_owner_key TEXT PRIMARY KEY,registration_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS owner_enrollment_invocation_receipts(owner_key TEXT NOT NULL,invocation_json TEXT NOT NULL,logical_owner_key TEXT NOT NULL,registration_json TEXT NOT NULL,PRIMARY KEY(owner_key,invocation_json));
 CREATE TABLE IF NOT EXISTS owner_enrollment_goal_sessions(logical_owner_key TEXT PRIMARY KEY,owner_key TEXT UNIQUE NOT NULL,goal_session_id TEXT NOT NULL,registration_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS owner_enrollment_loop_subjects(logical_owner_key TEXT PRIMARY KEY,owner_key TEXT UNIQUE NOT NULL,subject_json TEXT NOT NULL,registration_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS owner_enrollment_intent_contracts(logical_owner_key TEXT PRIMARY KEY,owner_key TEXT UNIQUE NOT NULL,contract_json TEXT NOT NULL,registration_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS owner_enrollment_clock(domain_id TEXT NOT NULL,qualification_epoch INTEGER NOT NULL,last_lower INTEGER NOT NULL,PRIMARY KEY(domain_id,qualification_epoch));`);
 if(!(db.prepare('PRAGMA main.table_info(owner_enrollment_intents)').all() as {name:string}[]).some(c=>c.name==='committed'))db.exec('ALTER TABLE main.owner_enrollment_intents ADD COLUMN committed INTEGER NOT NULL DEFAULT 0 CHECK(committed IN (0,1))');
 if(!(db.prepare('PRAGMA main.table_info(owner_enrollment_intents)').all() as {name:string}[]).some(c=>c.name==='loop_subject_json'))db.exec('ALTER TABLE main.owner_enrollment_intents ADD COLUMN loop_subject_json TEXT');
 if(!(db.prepare('PRAGMA main.table_info(owner_enrollment_intents)').all() as {name:string}[]).some(c=>c.name==='intent_contract_json'))db.exec('ALTER TABLE main.owner_enrollment_intents ADD COLUMN intent_contract_json TEXT');
 const kswarm=createKSwarmEnrollmentStore(db),kswarmCapability=input.kswarmCapability;
 function assertKSwarmCapability(owner:{ownerKind:string}){if(owner.ownerKind==='kswarm'){assertKSwarmSqlIntegrity(db);assertKSwarmEnrollmentCapability(kswarmCapability,db);assertKSwarmSqlIntegrity(db);}}
 function enrollmentTransaction<T>(enrollment:{ownerKind:string},work:()=>T):T{return runVerificationTransaction(db,()=>{assertKSwarmCapability(enrollment);const result=work();assertKSwarmCapability(enrollment);return result;});}
 function assertKSwarmReady(owner:VerificationOwner,allowPending=false){assertKSwarmCapability(owner);const result=kswarm.ready(owner,allowPending);if(result)assertMigrationPublished(owner,result.registration.migrationEpoch);return result;}
 function clock(){lifetime.signal.throwIfAborted();completion.host.assertDatabaseConnection(db);const c=copy(readClock());lifetime.signal.throwIfAborted();shape(c,['domainId','qualificationEpoch','lowerBound','upperBound','evidenceHash']);if(typeof c.domainId!=='string'||!c.domainId||!Number.isSafeInteger(c.qualificationEpoch)||c.qualificationEpoch<0||!Number.isSafeInteger(c.lowerBound)||c.lowerBound<0||!Number.isSafeInteger(c.upperBound)||c.upperBound<c.lowerBound||typeof c.evidenceHash!=='string'||!/^[a-f0-9]{64}$/.test(c.evidenceHash))throw Error('enrollment_clock');
  const prior=db.prepare('SELECT last_lower FROM main.owner_enrollment_clock WHERE domain_id=? AND qualification_epoch=?').get(c.domainId,c.qualificationEpoch) as {last_lower:number}|undefined;if(prior&&c.lowerBound<prior.last_lower)throw Error('enrollment_clock_regressed');
  db.prepare('INSERT INTO main.owner_enrollment_clock VALUES(?,?,?) ON CONFLICT(domain_id,qualification_epoch) DO UPDATE SET last_lower=excluded.last_lower').run(c.domainId,c.qualificationEpoch,c.lowerBound);return c;
 }
 function principal(peer:ControllerPeer){lifetime.signal.throwIfAborted();const facts=copy(resolvePrincipal(peer));shape(facts,['uid','gid','auditSessionId','accountGeneration','source']);if(facts.uid!==peer.uid||facts.gid!==peer.gid||facts.auditSessionId!==peer.auditSessionId||facts.source!=='macos-local-generateduid'||typeof facts.accountGeneration!=='string'||!/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(facts.accountGeneration))throw Error('enrollment_principal');return facts;}
 function check(review:Readonly<OwnerEnrollmentReview>,peer:ControllerPeer){const inspect=()=>{const p=principal(peer),c=clock();if(review.authorityId!==authorityId||review.principal.uid!==p.uid||review.principal.auditSessionId!==p.auditSessionId||review.principal.accountGeneration!==p.accountGeneration)throw Error('enrollment_principal');if(review.deadline.domainId!==c.domainId||review.deadline.qualificationEpoch!==c.qualificationEpoch||c.lowerBound<review.deadline.notBefore||c.upperBound>=review.deadline.validUntil)throw Error('enrollment_deadline');};if(review.enrollment.ownerKind==='kswarm')return enrollmentTransaction(review.enrollment,inspect);inspect();}
 function checkAuthorizing(review:Readonly<OwnerEnrollmentReview>,peer:ControllerPeer){check(review,peer);const row=db.prepare('SELECT * FROM main.owner_enrollment_challenges WHERE id=?').get(review.challengeId) as Row|undefined;if(!row||row.boot!==boot||row.state!=='authorizing'||row.principal!==json(peer)||row.review_json!==json(review))throw Error('enrollment_challenge_consumed');}
 function logical(review:Readonly<Pick<OwnerEnrollmentReview,'principal'|'enrollment'>>){return json({uid:review.principal.uid,accountGeneration:review.principal.accountGeneration,ownerKind:review.enrollment.ownerKind,ownerId:review.enrollment.ownerId});}
 function assertGoalSessionProposal(review:Readonly<OwnerEnrollmentReview>){
  const session=review.enrollment.goalSessionId;if(session===undefined)return;
  const original=db.prepare('SELECT goal_session_id FROM main.owner_enrollment_goal_sessions WHERE logical_owner_key=?').get(logical(review)) as {goal_session_id:string}|undefined;
  if(original&&original.goal_session_id!==session)throw Error('enrollment_goal_session_changed');
  const profile=db.prepare('SELECT profile_id,account_id FROM main.verification_profiles WHERE uid=?').get(review.principal.uid) as {profile_id:string;account_id:string}|undefined;
  if(!profile)return;
  if(profile.account_id!==review.principal.accountGeneration.toLowerCase())throw Error('enrollment_principal');
  const ownerKey=json({profileId:profile.profile_id,ownerKind:'goal',ownerId:review.enrollment.ownerId});
  const pointer=db.prepare('SELECT current_json,pending_id FROM main.verification_application_pointers WHERE owner_key=?').get(ownerKey) as {current_json:string|null;pending_id:string|null}|undefined;
  if(pointer?.current_json&&JSON.parse(pointer.current_json).binding?.sessionId!==session)throw Error('enrollment_goal_session_changed');
  if(pointer?.pending_id){
   const pending=db.prepare('SELECT binding_json FROM main.verification_application_transitions WHERE transition_id=? AND owner_key=?').get(pointer.pending_id,ownerKey) as {binding_json:string}|undefined;
   if(!pending||JSON.parse(pending.binding_json).sessionId!==session)throw Error('enrollment_goal_session_changed');
  }
 }
 function immutable(review:Readonly<OwnerEnrollmentReview>,forkPeer?:ControllerPeer){
  assertKSwarmCapability(review.enrollment);kswarm.assertProposal(review);
  assertGoalSessionProposal(review);
  assertLoopSubjectProposal(review);assertIntentProposal(review);
  const old=db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logical(review)) as {registration_json:string;committed:number}|undefined;
  if(!old||old.committed!==1){
   const record=forkPeer?null:db.prepare('SELECT principal FROM main.owner_enrollment_challenges WHERE id=?').get(review.challengeId) as {principal:string}|undefined;
   const peer=forkPeer??(record?peerValue(JSON.parse(record.principal)):undefined);
   if(review.registration.source.kind==='new-owner'&&review.registration.source.fork){if(!peer)throw Error('enrollment_fork_principal');assertForkSource(review,peer);}
  }
  if(old&&old.registration_json!==json(review.registration)){
   const prior=JSON.parse(old.registration_json) as OwnerEnrollmentReview['registration'],next=review.registration;
   if(old.committed!==1||prior.migrationEpoch!==next.migrationEpoch||json(prior.source)!==json(next.source)||next.obligations.length<=prior.obligations.length||json(next.obligations.slice(0,prior.obligations.length))!==json(prior.obligations))throw Error('enrollment_registration_immutable');
  }
  return old;
 }
 function assertLoopSubjectProposal(review:Readonly<Pick<OwnerEnrollmentReview,'principal'|'enrollment'>>){
  if(review.enrollment.ownerKind!=='loop')return;
  const logicalKey=logical(review),subject=review.enrollment.loopSubject;
  const intent=db.prepare('SELECT registration_json,committed,loop_subject_json FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logicalKey) as {registration_json:string;committed:number;loop_subject_json:string|null}|undefined;
  const receipt=db.prepare('SELECT owner_key,subject_json,registration_json FROM main.owner_enrollment_loop_subjects WHERE logical_owner_key=?').get(logicalKey) as {owner_key:string;subject_json:string;registration_json:string}|undefined;
  const profile=db.prepare('SELECT profile_id,account_id FROM main.verification_profiles WHERE uid=?').get(review.principal.uid) as {profile_id:string;account_id:string}|undefined;
  if(profile&&profile.account_id!==review.principal.accountGeneration.toLowerCase())throw Error('enrollment_principal');
  const ownerKey=profile?json({profileId:profile.profile_id,ownerKind:'loop',ownerId:review.enrollment.ownerId}):null;
  if(intent?.loop_subject_json!=null){
   if(subject!==undefined&&intent.loop_subject_json!==json(subject))throw Error('enrollment_loop_subject_changed');
   if(intent.committed===1){
    if(!receipt||!ownerKey||receipt.owner_key!==ownerKey||receipt.subject_json!==intent.loop_subject_json)throw Error('enrollment_loop_subject_receipt');
    try{
     if(json(parseLoopHostSubject(JSON.parse(receipt.subject_json)))!==receipt.subject_json
      ||!extendsRegistration(parseOwnerEnrollmentRegistration(JSON.parse(receipt.registration_json)),parseOwnerEnrollmentRegistration(JSON.parse(intent.registration_json))))throw Error('binding');
    }catch{throw Error('enrollment_loop_subject_receipt');}
    return;
   }
   // Only the exact originally approved subject can resume its own pending
   // registration. A plain invocation cannot activate a failed subject intent.
   if(subject===undefined||receipt)throw Error('enrollment_loop_subject_uncommitted');
   if(ownerKey&&(db.prepare("SELECT 1 FROM main.verification_registered_owners WHERE owner_key=? AND state='active'").get(ownerKey)
    ||db.prepare('SELECT 1 FROM main.verification_owners WHERE owner_key=?').get(ownerKey)
    ||db.prepare('SELECT 1 FROM main.mandatory_observation_checks WHERE owner_key=?').get(ownerKey)))throw Error('enrollment_loop_subject_legacy');
   return;
  }
  if(receipt)throw Error('enrollment_loop_subject_receipt');
  if(subject===undefined)return; // Existing ordinary invocation enrollment.
  if(intent)throw Error('enrollment_loop_subject_legacy');
  // An absent enrollment intent does not establish a new business owner. The
  // census and insertion of its native-approved intent share one transaction.
  if(ownerKey&&(db.prepare('SELECT 1 FROM main.verification_registered_owners WHERE owner_key=?').get(ownerKey)
   ||db.prepare('SELECT 1 FROM main.verification_owners WHERE owner_key=?').get(ownerKey)
   ||db.prepare('SELECT 1 FROM main.mandatory_observation_checks WHERE owner_key=?').get(ownerKey)
   ||db.prepare('SELECT 1 FROM main.verification_registered_invocations WHERE owner_key=?').get(ownerKey)
   ||db.prepare('SELECT 1 FROM main.owner_enrollment_invocation_receipts WHERE owner_key=?').get(ownerKey)))throw Error('enrollment_loop_subject_legacy');
 }
 function intentLogical(owner:VerificationOwner){const profile=db.prepare('SELECT uid,account_id,state FROM main.verification_profiles WHERE profile_id=?').get(owner.profileId) as {uid:number;account_id:string;state:string}|undefined;if(!profile)throw Error('enrollment_intent_profile');return {profile,key:json({uid:profile.uid,accountGeneration:profile.account_id.toUpperCase(),ownerKind:owner.ownerKind,ownerId:owner.ownerId})};}
 interface IntentReadNode {ownerKey:string;binding:ReturnType<typeof parseIntentContractEnrollment>;encoded:string;originalRegistration:OwnerEnrollmentReview['registration'];children:VerificationOwner[]}
 function intentReadGraph(owner:VerificationOwner,binding:ReturnType<typeof parseIntentContractEnrollment>,contractJson:string):Map<string,IntentReadNode>{
  // This context is constructed only after the seed's original receipt and
  // canonical contract have passed. It caches parsed structure, never SQL facts.
  const result=new Map<string,IntentReadNode>();
  for(const stageId of [null,...binding.contract.stages.map(stage=>stage.stageId)]){
   const subject=Object.freeze({...binding.subject,stageId}),nodeOwner={...intentHostSubjectOwner(subject),profileId:owner.profileId},key=json(nodeOwner),stage=stageId===null?undefined:binding.contract.stages.find(item=>item.stageId===stageId)!;
   const ids=stageId===null?binding.contract.stages.map(item=>item.stageId):stage!.dependsOnStageIds;
   result.set(key,{ownerKey:key,binding:Object.freeze({subject,contract:binding.contract}),encoded:'{"contract":'+contractJson+',"subject":'+json(subject)+'}',originalRegistration:goalVerificationRegistration(stageId===null?binding.contract.verification:stage!.verification),children:ids.map(id=>({...intentHostSubjectOwner({...subject,stageId:id}),profileId:owner.profileId}))});
  }
  if(!result.has(json(owner)))throw Error('enrollment_intent_receipt');return result;
 }
 function intentReceipt(owner:VerificationOwner,allowPending=false,expected?:IntentReadNode){
  const {profile,key}=intentLogical(owner),registered=db.prepare('SELECT uid,state FROM main.verification_registered_owners WHERE owner_key=?').get(json(owner)) as {uid:number;state:string}|undefined;
  const intent=db.prepare('SELECT registration_json,committed,intent_contract_json FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(key) as {registration_json:string;committed:number;intent_contract_json:string|null}|undefined;
  const receipt=db.prepare('SELECT * FROM main.owner_enrollment_intent_contracts WHERE logical_owner_key=?').get(key) as {owner_key:string;contract_json:string;registration_json:string}|undefined;
  if(!registered||registered.uid!==profile.uid||(!allowPending&&(profile.state!=='active'||registered.state!=='active'))||!intent||intent.committed!==1||!intent.intent_contract_json||!receipt||receipt.owner_key!==json(owner)||receipt.contract_json!==intent.intent_contract_json)throw Error('enrollment_intent_receipt');
  if(expected&&(expected.ownerKey!==json(owner)||receipt.contract_json!==expected.encoded))throw Error('enrollment_intent_receipt');
  const binding=expected?.binding??readIntentSqlContract(db,receipt.contract_json),mapped=intentHostSubjectOwner(binding.subject),registration=parseOwnerEnrollmentRegistration(JSON.parse(intent.registration_json));
  if(owner.ownerKind!==mapped.ownerKind||owner.ownerId!==mapped.ownerId||(!expected&&json(binding)!==receipt.contract_json)||!extendsRegistration(expected?.originalRegistration??intentContractOriginalRegistration(binding),registration)||!extendsRegistration(parseOwnerEnrollmentRegistration(JSON.parse(receipt.registration_json)),registration))throw Error('enrollment_intent_receipt');
  const actual=db.prepare('SELECT migration_epoch,pending FROM main.verification_owners WHERE owner_key=?').get(json(owner)) as {migration_epoch:number;pending:number}|undefined;
  const mandatory=db.prepare('SELECT obligation_id,definition_json FROM main.mandatory_observation_checks WHERE owner_key=? ORDER BY obligation_id').all(json(owner)) as {obligation_id:string;definition_json:string}[];
  if(!actual||actual.migration_epoch!==registration.migrationEpoch||actual.pending!==0||mandatory.length!==registration.obligations.length||registration.obligations.some(e=>mandatory.find(m=>m.obligation_id===e.obligation.obligationId)?.definition_json!==json(e.obligation)))throw Error('enrollment_intent_registration');
  assertMigrationPublished(owner,actual.migration_epoch);
  return {binding,registration,profile};
 }
 function assertIntentNode(owner:VerificationOwner,contractJson:string,visited=new Set<string>(),allowPending=false,graph?:Map<string,IntentReadNode>):void{
  const key=json(owner);if(visited.has(key))return;visited.add(key);if(visited.size>4096)throw Error('enrollment_intent_graph');
  const expected=graph?.get(key);if(graph&&!expected)throw Error('enrollment_intent_graph');
  const receipt=intentReceipt(owner,allowPending,expected);
  if(!graph&&json(receipt.binding.contract)!==contractJson)throw Error('enrollment_intent_contract_changed');
  const currentGraph=graph??intentReadGraph(owner,receipt.binding,contractJson),children=currentGraph.get(key)!.children;
  const actual=(db.prepare('SELECT child_key FROM main.verification_owner_dependencies WHERE parent_key=? ORDER BY child_key').all(key) as {child_key:string}[]).map(r=>r.child_key).sort();
  if(json(actual)!==json(children.map(json).sort()))throw Error('enrollment_intent_graph');
  for(const child of children)assertIntentNode(child,contractJson,visited,false,currentGraph);
 }
 function assertIntentReady(owner:VerificationOwner):void{
  if(!isIntentContractOwner(owner))return;const {binding}=intentReceipt(owner),parent={...intentHostSubjectOwner({...binding.subject,stageId:null}),profileId:owner.profileId};
  assertIntentNode(parent,json(binding.contract));
 }
 function assertIntentProposal(review:Readonly<Pick<OwnerEnrollmentReview,'principal'|'enrollment'>> & {registration?:OwnerEnrollmentReview['registration']}):void{
  if(!isIntentContractOwner(review.enrollment)){if(review.enrollment.intentContract!==undefined)throw Error('enrollment_intent_owner');return;}
  const key=logical(review),binding=review.enrollment.intentContract;
  const intent=db.prepare('SELECT registration_json,committed,intent_contract_json FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(key) as {registration_json:string;committed:number;intent_contract_json:string|null}|undefined;
  const receipt=db.prepare('SELECT * FROM main.owner_enrollment_intent_contracts WHERE logical_owner_key=?').get(key) as {owner_key:string;contract_json:string;registration_json:string}|undefined;
  const profile=db.prepare('SELECT profile_id,account_id FROM main.verification_profiles WHERE uid=?').get(review.principal.uid) as {profile_id:string;account_id:string}|undefined;
  if(profile&&profile.account_id!==review.principal.accountGeneration.toLowerCase())throw Error('enrollment_principal');
  const owner=profile?{profileId:profile.profile_id,ownerKind:'intent' as const,ownerId:review.enrollment.ownerId}:undefined;
  if(intent?.intent_contract_json){
   if(binding&&json(binding)!==intent.intent_contract_json)throw Error('enrollment_intent_contract_changed');
   if(intent.committed===1){
    if(!owner)throw Error('enrollment_intent_receipt');const original=intentReceipt(owner,true),checkedNodes=new Set<string>();assertIntentNode(owner,json(original.binding.contract),checkedNodes,true);
    // Explicit subject-only renewals must validate already committed siblings too;
    // absent future stages remain absent until their own native enrollment.
    for(const stageId of [null,...original.binding.contract.stages.map(stage=>stage.stageId)]){
     const node={...intentHostSubjectOwner({...original.binding.subject,stageId}),profileId:owner.profileId},nodeKey=json(node);
     if(db.prepare('SELECT 1 FROM main.owner_enrollment_intent_contracts WHERE owner_key=?').get(nodeKey))assertIntentNode(node,json(original.binding.contract),checkedNodes,nodeKey===json(owner));
     else if(db.prepare('SELECT 1 FROM main.verification_owners WHERE owner_key=?').get(nodeKey)||db.prepare("SELECT 1 FROM main.verification_registered_owners WHERE owner_key=? AND state='active'").get(nodeKey))throw Error('enrollment_intent_receipt');
    }
    if(!binding)assertIntentReady(owner);
    if(review.registration&&!extendsRegistration(original.registration,review.registration))throw Error('enrollment_registration_immutable');return;
   }
   if(!binding||receipt)throw Error('enrollment_intent_uncommitted');
  }else{
   if(!binding||intent||receipt)throw Error('enrollment_intent_receipt');
  }
  if(!binding)throw Error('enrollment_intent_receipt');
  if(review.registration&&json(review.registration)!==json(intentContractOriginalRegistration(binding)))throw Error('enrollment_intent_original_obligations');
  if(owner){const ownerKey=json(owner);if(db.prepare("SELECT 1 FROM main.verification_registered_owners WHERE owner_key=? AND (?=0 OR state='active')").get(ownerKey,intent?1:0)
   ||db.prepare('SELECT 1 FROM main.verification_owners WHERE owner_key=?').get(ownerKey)||db.prepare('SELECT 1 FROM main.mandatory_observation_checks WHERE owner_key=?').get(ownerKey)
   ||db.prepare('SELECT 1 FROM main.verification_registered_invocations WHERE owner_key=?').get(ownerKey)||db.prepare('SELECT 1 FROM main.owner_enrollment_invocation_receipts WHERE owner_key=?').get(ownerKey))throw Error('enrollment_intent_legacy');}
  const dependencies=intentContractDependencies(binding);if(dependencies.length&&!owner)throw Error('enrollment_intent_predecessor');
  for(const child of dependencies)assertIntentNode({...child,profileId:owner!.profileId},json(binding.contract));
 }
 const grants=new WeakMap<object,{review:Readonly<OwnerEnrollmentReview>;peer:ControllerPeer;consumed:boolean;signal:AbortSignal;originalChallenge:Row;originalRequest:RequestRow|null;originalOthers:readonly Record<string,any>[]|null;originalOwn:Record<string,any>|null;assertIdentity(state:'authorizing'|'committed',owner?:VerificationOwner):void;finalExpected?:Record<string,unknown>;committed?:boolean;committedOwner?:Readonly<VerificationOwner>;result?:Readonly<{owner:Readonly<VerificationOwner>;readGrant:ReturnType<typeof completion.host.issueReadScope>}>}>();
 function grant(proposal:Readonly<OwnerEnrollment>,context:Readonly<EnrollmentContext>,consume:boolean){const known=grants.get(context.authorization);if(!known||context.requestSource!=='user'||json(proposal)!==json(known.review.enrollment)||json(context.peer)!==json(known.peer)||(consume&&known.consumed)||(!consume&&!known.consumed))throw Error('enrollment_private_authorization');if(consume)known.consumed=true;known.signal.throwIfAborted();known.assertIdentity(known.committed?'committed':'authorizing',known.committedOwner??known.result?.owner);
  if(!consume&&known.committed){
   check(known.review,known.peer);const row=db.prepare('SELECT * FROM main.owner_enrollment_challenges WHERE id=?').get(known.review.challengeId) as Row|undefined;
   if(!row||row.boot!==boot||row.state!=='committed'||row.principal!==json(known.peer)||row.review_json!==json(known.review))throw Error('enrollment_challenge_consumed');
   const intent=immutable(known.review,known.peer);if(!intent||intent.committed!==1||intent.registration_json!==json(known.review.registration))throw Error('enrollment_registration_immutable');
  }else checkAuthorizing(known.review,known.peer);
  immutable(known.review,known.peer);known.assertIdentity(known.committed?'committed':'authorizing',known.committedOwner??known.result?.owner);}
 function commitEnrollment(owner:Readonly<VerificationOwner>,proposal:Readonly<OwnerEnrollment>,context:Readonly<EnrollmentContext>){
  assertNativeSqliteArrayConstruction();
  if(!db.inTransaction)throw Error('enrollment_final_transaction');
  const entry=grants.get(context.authorization);if(!entry)throw Error('enrollment_private_authorization');
  const originalChallenge=entry.originalChallenge;
  if(!originalChallenge)throw Error('enrollment_challenge_consumed');
  const originalRequest=entry.originalRequest;
  const expectedChallenge={...originalChallenge,state:'committed'},expectedRequest=originalRequest?{...originalRequest,state:'committed',owner_json:json(owner)}:null;
  const originalContract=isIntentContractOwner(owner)?entry.review.enrollment.intentContract??parseIntentContractEnrollment(JSON.parse((db.prepare('SELECT intent_contract_json FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logical(entry.review)) as {intent_contract_json:string}).intent_contract_json)):undefined;
  const activation={owner,invocations:proposal.invocations};
  let expectedRegistration:readonly Record<string,any>[]|null=null,expectedBeforeActivation:readonly Record<string,any>[]|null=null;
  if(originalContract||owner.ownerKind==='kswarm'){
   const key=json(owner),logicalKey=logical(entry.review),registration=entry.review.registration,encoded=json(registration);
   const vectors=captureRegistrationSnapshot(registrationReadVector(owner,undefined,originalContract),false),own=vectors.find(row=>row.key===key);
   if(entry.originalOthers!==null&&!isDeepStrictEqual(entry.originalOthers,registrationVector(vectors.filter(row=>row.key!==key))))throw Error('enrollment_final_changed');
   if(!own)throw Error('enrollment_final_changed');
   let originalOwn=entry.originalOwn;
   if(originalOwn===null){
    // No profile existed at authorize entry. Derive the only permitted fresh
    // rows from the approved identity, never from publication callbacks.
    const profiles=[{uid:entry.peer.uid,account_id:entry.review.principal.accountGeneration.toLowerCase(),profile_id:owner.profileId,state:'pending'}];
    const empty=(key:string)=>({key,profiles,dependencies:[],intents:[],owner:[],verification:[],mandatory:[],invocations:[],invocationReceipts:[],goalSessions:[],loopSubjects:[],intentContracts:[],kswarmSubjects:[],storageFeatures:owner.ownerKind==='kswarm'?[{feature:'kswarm-owner',minimum_schema:2}]:registrationRows(db.prepare('SELECT * FROM main.verification_storage_features ORDER BY feature').all() as Record<string,any>[]),migration:[],application:[],history:[],transitions:[]});
    const keys=new Set([key,...(originalContract?[null,...originalContract.contract.stages.map(stage=>stage.stageId)].map(stageId=>json({...intentHostSubjectOwner({...originalContract.subject,stageId}),profileId:owner.profileId})):[])]);
    const expectedOthers=registrationVector([...keys].filter(value=>value!==key).map(empty));
    if(!isDeepStrictEqual(expectedOthers,registrationVector(vectors.filter(row=>row.key!==key))))throw Error('enrollment_final_changed');
    originalOwn=captureRegistrationSnapshot(empty(key));
   }
   // Only the registry's documented pending insertions may precede this FINAL.
   // The business/recipe/application rows remain exactly the pre-native facts.
   const expected=captureRegistrationSnapshot(originalOwn,false);
   if(expected.owner.length===0)expected.owner=[{owner_key:key,uid:entry.peer.uid,state:'pending'}];
   for(const invocation of proposal.invocations){const value=json(invocation);if(!expected.invocations.some((row:Record<string,any>)=>row.invocation_json===value))expected.invocations.push({profile_id:owner.profileId,invocation_json:value,owner_key:key,state:'pending'});}
   expected.invocations=registrationRows(expected.invocations);
   if(expected.intents.length===0)expected.intents=[{logical_owner_key:logicalKey,registration_json:encoded,committed:0,loop_subject_json:null,intent_contract_json:originalContract?json(originalContract):null}];
   if(owner.ownerKind==='kswarm'){
    expected.storageFeatures=[{feature:'kswarm-owner',minimum_schema:2}];
    if(expected.kswarmSubjects.length===0)expected.kswarmSubjects=[{logical_owner_key:logicalKey,owner_key:entry.originalOwn===null?null:key,subject_json:json(entry.review.enrollment.kswarmSubject),registration_json:encoded,invocations_json:'[]',committed:0}];
   }
   if(!isDeepStrictEqual(captureRegistrationSnapshot(expected),captureRegistrationSnapshot(own)))throw Error('enrollment_final_changed');
   const mandatory=own.mandatory as Record<string,any>[];let additions=0;
   for(const value of registration.obligations)if(!mandatory.some(row=>row.obligation_id===value.obligation.obligationId)){mandatory.push({owner_key:key,obligation_id:value.obligation.obligationId,definition_json:json(value.obligation),active_attempt:null,attempt_epoch:0});additions++;}
   const edges=own.dependencies as Record<string,any>[];let newEdges=0;
   if(originalContract&&entry.review.enrollment.intentContract)for(const child of intentContractDependencies(originalContract)){const childKey=json({...child,profileId:owner.profileId});if(!edges.some(row=>row.child_key===childKey)){edges.push({parent_key:key,child_key:childKey});newEdges++;}}
   const previous=own.verification.length?own.verification[0]:{owner_key:key,migration_epoch:registration.migrationEpoch,business_revision:0,set_revision:0,epoch:0,pending:0,current_subject:null};
   own.verification=[{...previous,set_revision:previous.set_revision+(additions?1:0)+newEdges}];
   own.mandatory=registrationRows(mandatory);own.dependencies=registrationRows(edges);
   own.intents=registrationRows(own.intents.map((row:Record<string,any>)=>{if(row.logical_owner_key!==logicalKey)throw Error('enrollment_final_changed');return {...row,registration_json:encoded,committed:1};}));
   if(originalContract)own.intentContracts=[{logical_owner_key:logicalKey,owner_key:key,contract_json:json(originalContract),registration_json:encoded}];
   if(owner.ownerKind==='kswarm'){const roster=[...new Set([...(JSON.parse(own.kswarmSubjects[0].invocations_json) as unknown[]).map(json),...proposal.invocations.map(json)])].sort().map(value=>JSON.parse(value));own.kswarmSubjects=[{logical_owner_key:logicalKey,owner_key:key,subject_json:json(entry.review.enrollment.kswarmSubject),registration_json:encoded,invocations_json:json(roster),committed:1}];}
   const receipts=own.invocationReceipts as Record<string,any>[];
   for(const invocation of proposal.invocations){const value=json(invocation),index=receipts.findIndex(row=>row.invocation_json===value),row={owner_key:key,invocation_json:value,logical_owner_key:logicalKey,registration_json:encoded};if(index<0)receipts.push(row);else receipts[index]=row;}
   own.invocationReceipts=registrationRows(receipts);expectedBeforeActivation=registrationVector(vectors);
   for(const vector of vectors)for(const profile of vector.profiles)profile.state='active';
   own.owner=registrationRows(own.owner.map((row:Record<string,any>)=>({...row,state:'active'})));
   own.invocations=registrationRows(own.invocations.map((row:Record<string,any>)=>{if(proposal.invocations.some(invocation=>json(invocation)===row.invocation_json))row.state='active';return row;}));
   expectedRegistration=registrationVector(vectors);
  }
  grant(proposal,context,false);
  const known=grants.get(context.authorization)!;if(known.committed)throw Error('enrollment_challenge_consumed');const {review,peer,signal}=known;
  signal.throwIfAborted();checkAuthorizing(review,peer);const prior=immutable(review,peer);if(!prior)throw Error('enrollment_registration_immutable');
  const encoded=json(review.registration),key=json(owner),logicalKey=logical(review);
  assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(encoded)*(review.enrollment.invocations.length+1+(review.enrollment.goalSessionId===undefined?0:1)+(review.enrollment.loopSubject===undefined?0:1)+(review.enrollment.intentContract===undefined?0:1))+Buffer.byteLength(json(review.enrollment))*3+8192});
  const payload={owner,migrationEpoch:review.registration.migrationEpoch,obligations:review.registration.obligations.map(entry=>entry.obligation)};
  const token=completion.authority.host.issueAuthorization({owner,method:'registerObligations',payload,requestSource:'user',principalId:json(peer),expiresAt:review.deadline.validUntil});
  completion.authority.service.registerObligations(payload,{requestSource:'user',authorization:token});checkAuthorizing(review,peer);signal.throwIfAborted();
  if(review.registration.source.kind==='new-owner'&&review.registration.source.fork){
   for(const child of review.registration.source.fork.dependencies){
    const payload={owner,child},authorization=completion.authority.host.issueAuthorization({owner,method:'registerOwnerDependency',payload,requestSource:'user',principalId:json(peer),expiresAt:review.deadline.validUntil});
    completion.authority.service.registerOwnerDependency(payload,{requestSource:'user',authorization});checkAuthorizing(review,peer);signal.throwIfAborted();
   }
  }
  if(review.enrollment.intentContract!==undefined){
   for(const child of intentContractDependencies(review.enrollment.intentContract).map(value=>({...value,profileId:owner.profileId}))){
    const payload={owner,child},authorization=completion.authority.host.issueAuthorization({owner,method:'registerOwnerDependency',payload,requestSource:'user',principalId:json(peer),expiresAt:review.deadline.validUntil});
    completion.authority.service.registerOwnerDependency(payload,{requestSource:'user',authorization});checkAuthorizing(review,peer);signal.throwIfAborted();
   }
  }
  const readGrant=owner.ownerKind==='kswarm'?undefined:completion.host.issueReadScope({owner,peer,expiresAt:review.deadline.validUntil});checkAuthorizing(review,peer);signal.throwIfAborted();
  if(db.prepare('UPDATE main.owner_enrollment_intents SET registration_json=?,committed=1 WHERE logical_owner_key=? AND registration_json=? AND committed=?').run(encoded,logicalKey,prior.registration_json,prior.committed).changes!==1)throw Error('enrollment_registration_immutable');
  for(const invocation of review.enrollment.invocations){
   const value=json(invocation),old=db.prepare('SELECT logical_owner_key FROM main.owner_enrollment_invocation_receipts WHERE owner_key=? AND invocation_json=?').get(key,value) as {logical_owner_key:string}|undefined;
   if(old&&old.logical_owner_key!==logicalKey)throw Error('enrollment_invocation_binding');
   db.prepare('INSERT INTO main.owner_enrollment_invocation_receipts VALUES(?,?,?,?) ON CONFLICT(owner_key,invocation_json) DO UPDATE SET registration_json=excluded.registration_json').run(key,value,logicalKey,encoded);
  }
  if(review.enrollment.goalSessionId!==undefined){
   assertGoalSessionProposal(review);
   const old=db.prepare('SELECT owner_key FROM main.owner_enrollment_goal_sessions WHERE logical_owner_key=?').get(logicalKey) as {owner_key:string}|undefined;
   if(old&&old.owner_key!==key)throw Error('enrollment_goal_session_owner');
   if(!old&&(db.prepare('SELECT count(*) n FROM main.owner_enrollment_goal_sessions').get() as {n:number}).n>=4096)throw Error('enrollment_goal_session_capacity');
   db.prepare('INSERT INTO main.owner_enrollment_goal_sessions VALUES(?,?,?,?) ON CONFLICT(logical_owner_key) DO UPDATE SET registration_json=excluded.registration_json').run(logicalKey,key,review.enrollment.goalSessionId,encoded);
  }
  if(review.enrollment.loopSubject!==undefined){
   const old=db.prepare('SELECT owner_key,subject_json FROM main.owner_enrollment_loop_subjects WHERE logical_owner_key=?').get(logicalKey) as {owner_key:string;subject_json:string}|undefined;
   const subjectJson=json(review.enrollment.loopSubject);
   if(old&&(old.owner_key!==key||old.subject_json!==subjectJson))throw Error('enrollment_loop_subject_receipt');
   if(!old&&(db.prepare('SELECT count(*) n FROM main.owner_enrollment_loop_subjects').get() as {n:number}).n>=4096)throw Error('enrollment_loop_subject_capacity');
   db.prepare('INSERT INTO main.owner_enrollment_loop_subjects VALUES(?,?,?,?) ON CONFLICT(logical_owner_key) DO UPDATE SET registration_json=excluded.registration_json').run(logicalKey,key,subjectJson,encoded);
  }
  kswarm.commit(owner,review);if(owner.ownerKind==='kswarm')assertKSwarmReady(owner,true);
  if(isIntentContractOwner(owner)){
   const priorContract=db.prepare('SELECT intent_contract_json FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logicalKey) as {intent_contract_json:string|null}|undefined;
   if(!priorContract?.intent_contract_json)throw Error('enrollment_intent_receipt');
   if(!db.prepare('SELECT 1 FROM main.owner_enrollment_intent_contracts WHERE logical_owner_key=?').get(logicalKey)&&(db.prepare('SELECT count(*) n FROM main.owner_enrollment_intent_contracts').get() as {n:number}).n>=4096)throw Error('enrollment_intent_capacity');
   if(db.prepare('INSERT INTO main.owner_enrollment_intent_contracts VALUES(?,?,?,?) ON CONFLICT(logical_owner_key) DO UPDATE SET registration_json=excluded.registration_json').run(logicalKey,key,priorContract.intent_contract_json,encoded).changes!==1)throw Error('enrollment_intent_receipt');
   const actual=db.prepare('SELECT * FROM main.owner_enrollment_intent_contracts WHERE logical_owner_key=?').get(logicalKey);
   if(json(actual)!==json({logical_owner_key:logicalKey,owner_key:key,contract_json:priorContract.intent_contract_json,registration_json:encoded}))throw Error('enrollment_intent_receipt');
  }
  checkAuthorizing(review,peer);signal.throwIfAborted();
  if(db.prepare("UPDATE main.owner_enrollment_challenges SET state='committed' WHERE id=? AND state='authorizing'").run(review.challengeId).changes!==1)throw Error('enrollment_challenge_consumed');
  const requestRow=db.prepare('SELECT * FROM main.owner_enrollment_requests WHERE challenge_id=?').get(review.challengeId) as RequestRow|undefined;
  if(requestRow){
   const request=requestParts({requestId:requestRow.request_id,enrollment:review.enrollment,registration:review.registration},peer);findRequest(request);
   if(requestRow.state!=='mapped'||requestRow.owner_json!==null||db.prepare("UPDATE main.owner_enrollment_requests SET state='committed',owner_json=? WHERE request_id=? AND state='mapped'").run(json(owner),requestRow.request_id).changes!==1)throw Error('enrollment_request_retired');
  }
  // Private local phase only. No result escapes until the registry FINAL COMMIT succeeds.
  known.committed=true;known.committedOwner=owner;if(readGrant)known.result=Object.freeze({owner,readGrant});
  if(expectedBeforeActivation!==null&&!isDeepStrictEqual(registrationReadVector(owner,undefined,originalContract),expectedBeforeActivation))throw Error('enrollment_final_changed');
  const registration=registrationReadVector(owner,activation,originalContract);
  if(expectedRegistration!==null&&!isDeepStrictEqual(expectedRegistration,registration))throw Error('enrollment_final_changed');
  known.finalExpected=captureRegistrationSnapshot({registration:expectedRegistration??registration,challenge:expectedChallenge,request:expectedRequest,principal:peer});
  if(!isDeepStrictEqual(enrollmentFinalVector(owner,review,peer,true),known.finalExpected))throw Error('enrollment_final_changed');
 }
 function assertInvocationCommitted(owner:Readonly<VerificationOwner>,invocation:Readonly<OwnerEnrollment['invocations'][number]>,peer:ControllerPeer){
  const assertStable=fenceRegistrationRead(owner),p=principal(peer),logicalKey=json({uid:p.uid,accountGeneration:p.accountGeneration,ownerKind:owner.ownerKind,ownerId:owner.ownerId});
  assertLoopSubjectProposal({principal:p,enrollment:{ownerKind:owner.ownerKind,ownerId:owner.ownerId,invocations:[invocation]}});assertIntentReady(owner);assertKSwarmReady(owner);
  const registeredInvocation=db.prepare('SELECT owner_key,state FROM main.verification_registered_invocations WHERE profile_id=? AND invocation_json=?').get(owner.profileId,json(invocation)) as {owner_key:string;state:string}|undefined;if(registeredInvocation?.owner_key!==json(owner)||registeredInvocation.state!=='active')throw Error('enrollment_invocation_binding');
  const receipt=db.prepare('SELECT logical_owner_key,registration_json FROM main.owner_enrollment_invocation_receipts WHERE owner_key=? AND invocation_json=?').get(json(owner),json(invocation)) as {logical_owner_key:string;registration_json:string}|undefined;
  const committed=db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logicalKey) as {registration_json:string;committed:number}|undefined;
  if(!receipt||receipt.logical_owner_key!==logicalKey||!committed||committed.committed!==1)throw Error('enrollment_invocation_uncommitted');
  const original=JSON.parse(receipt.registration_json) as OwnerEnrollmentReview['registration'],current=JSON.parse(committed.registration_json) as OwnerEnrollmentReview['registration'];
  if(original.migrationEpoch!==current.migrationEpoch||json(original.source)!==json(current.source)||current.obligations.length<original.obligations.length||json(current.obligations.slice(0,original.obligations.length))!==json(original.obligations))throw Error('enrollment_invocation_registration');
  return ()=>{lifetime.signal.throwIfAborted();assertStable();if(owner.ownerKind==='kswarm')assertKSwarmSqlIntegrity(db);};
 }
 const registry=createProfileOwnerRegistry({database:db,authorityId,resolvePrincipal(peer){const p=principal(peer);return {uid:p.uid,accountId:p.accountGeneration.toLowerCase()};},assertEnrollmentAuthorization:(p,c)=>grant(p,c,true),assertEnrollmentCurrent:(p,c)=>grant(p,c,false),publishProfile,assertProfilePublished,commitEnrollment,assertInvocationCommitted,assertEnrollmentFinal(owner,proposal,context){const known=grants.get(context.authorization);if(!known?.committed||!known.finalExpected)throw Error('enrollment_final_commit_missing');known.signal.throwIfAborted();if(!isDeepStrictEqual(enrollmentFinalVector(owner,known.review,known.peer,false),known.finalExpected))throw Error('enrollment_final_changed');if(owner.ownerKind==='kswarm')assertKSwarmSqlIntegrity(db);}});
 function load(id:string,peer:ControllerPeer){if(typeof id!=='string'||id.length>160)throw Error('enrollment_challenge');const row=db.prepare('SELECT * FROM main.owner_enrollment_challenges WHERE id=?').get(id) as Row|undefined;if(!row||row.principal!==json(peer))throw Error('enrollment_principal');if(row.boot!==boot||row.state!=='prepared')throw Error('enrollment_challenge_consumed');const review=parseOwnerEnrollmentReview(JSON.parse(row.review_json));check(review,peer);immutable(review,peer);return review;}


 function requestCount(){return (db.prepare(`SELECT (SELECT count(*) FROM main.owner_enrollment_requests)+(SELECT count(*) FROM main.owner_enrollment_challenges c WHERE NOT EXISTS(SELECT 1 FROM main.owner_enrollment_requests r WHERE r.challenge_id=c.id)) n`).get() as {n:number}).n;}
 function requestParts(raw:OwnerEnrollmentRequest,peer:ControllerPeer){
  raw=captureKSwarmEnrollmentData(raw,true);assertIntentEnrollmentEnvelope(raw);const value=copy(raw);shape(value,['requestId','enrollment','registration']);
  if(typeof value.requestId!=='string'||!value.requestId||Buffer.byteLength(value.requestId)>160||/[\x00-\x1f\x7f]/.test(value.requestId))throw Error('enrollment_request_identifier');
  const p=principal(peer),c=clock();
  const review=parseOwnerEnrollmentReview({version:1,purpose:'completion-owner-enrollment',authorityId,challengeId:'request-shape',principal:{uid:p.uid,accountGeneration:p.accountGeneration,auditSessionId:p.auditSessionId},profileSlot:'default',enrollment:value.enrollment,registration:value.registration,deadline:{domainId:c.domainId,qualificationEpoch:c.qualificationEpoch,notBefore:c.lowerBound,validUntil:c.lowerBound+300000}});
  if(review.registration.source.kind!=='new-owner')throw Error('enrollment_migration_unavailable');
  const proposal={enrollment:review.enrollment,registration:review.registration},principalJson=json(p),proposalJson=json(proposal);
  return {id:value.requestId,principal:p,proposal,principalJson,proposalJson,hash:hash({authorityId,principal:p,proposal})};
 }
 type RequestParts=ReturnType<typeof requestParts>;
 function findRequest(request:RequestParts){
  const row=db.prepare('SELECT * FROM main.owner_enrollment_requests WHERE request_id=?').get(request.id) as RequestRow|undefined;
  if(row&&(row.principal_json!==request.principalJson||row.proposal_json!==request.proposalJson||row.request_hash!==request.hash))throw Error('enrollment_request_binding');return row;
 }
 function insertRequest(request:RequestParts,state:'mapped'|'not_prepared',challengeId:string|null){
  // The new challenge already counts as one slot; mapping it must not count twice.
  if(requestCount()+(challengeId?0:1)>4096)throw Error('enrollment_capacity');
  assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(request.principalJson)+Buffer.byteLength(request.proposalJson)+8192});
  db.prepare('INSERT INTO main.owner_enrollment_requests VALUES(?,?,?,?,?,?,NULL)').run(request.id,request.principalJson,request.proposalJson,request.hash,challengeId,state);
 }
 function extendsRegistration(original:OwnerEnrollmentReview['registration'],current:OwnerEnrollmentReview['registration']){
  return current.migrationEpoch===original.migrationEpoch&&json(current.source)===json(original.source)&&current.obligations.length>=original.obligations.length&&json(current.obligations.slice(0,original.obligations.length))===json(original.obligations);
 }
 function observeRequest(row:RequestRow,request:RequestParts):OwnerEnrollmentRequestObservation{
  if(row.state==='not_prepared'){if(row.challenge_id!==null||row.owner_json!==null)throw Error('enrollment_request_corrupt');return Object.freeze({state:'not_prepared' as const});}
  const original=db.prepare('SELECT * FROM main.owner_enrollment_challenges WHERE id=?').get(row.challenge_id) as Row|undefined;
  if(!original)throw Error('enrollment_request_corrupt');
  const review=parseOwnerEnrollmentReview(JSON.parse(original.review_json));
  if(review.challengeId!==row.challenge_id||review.authorityId!==authorityId||json({enrollment:review.enrollment,registration:review.registration})!==request.proposalJson
    ||review.principal.uid!==request.principal.uid||review.principal.auditSessionId!==request.principal.auditSessionId||review.principal.accountGeneration!==request.principal.accountGeneration
    ||original.principal!==json({uid:request.principal.uid,gid:request.principal.gid,auditSessionId:request.principal.auditSessionId}))throw Error('enrollment_request_binding');
  const challenge:OwnerEnrollmentChallenge=Object.freeze({challengeId:review.challengeId,canonicalReview:review});
  if(row.state==='committed'){
   if(original.state!=='committed'||!row.owner_json)throw Error('enrollment_request_corrupt');
   const owner=JSON.parse(row.owner_json) as VerificationOwner;shape(owner,['profileId','ownerKind','ownerId']);
   if(owner.ownerKind!==review.enrollment.ownerKind||owner.ownerId!==review.enrollment.ownerId||typeof owner.profileId!=='string'||json(owner)!==row.owner_json)throw Error('enrollment_request_corrupt');
   const profile=db.prepare('SELECT * FROM main.verification_profiles WHERE uid=?').get(request.principal.uid) as {account_id:string;profile_id:string}|undefined;
   if(!profile||profile.account_id!==request.principal.accountGeneration.toLowerCase()||profile.profile_id!==owner.profileId)throw Error('enrollment_request_binding');
   const registered=db.prepare('SELECT uid FROM main.verification_registered_owners WHERE owner_key=?').get(row.owner_json) as {uid:number}|undefined;
   const registration=db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logical(review)) as {registration_json:string;committed:number}|undefined;
   if(registered?.uid!==request.principal.uid||!registration||registration.committed!==1||!extendsRegistration(review.registration,JSON.parse(registration.registration_json)))throw Error('enrollment_request_receipt');
   assertLoopSubjectProposal(review);assertIntentProposal(review);assertKSwarmReady(owner);
   for(const invocation of review.enrollment.invocations){
    const receipt=db.prepare('SELECT logical_owner_key,registration_json FROM main.owner_enrollment_invocation_receipts WHERE owner_key=? AND invocation_json=?').get(row.owner_json,json(invocation)) as {logical_owner_key:string;registration_json:string}|undefined;
    if(!receipt||receipt.logical_owner_key!==logical(review)||(!extendsRegistration(review.registration,JSON.parse(receipt.registration_json))||!extendsRegistration(JSON.parse(receipt.registration_json),JSON.parse(registration.registration_json))))throw Error('enrollment_request_receipt');
   }
   if(review.enrollment.goalSessionId!==undefined){
    const receipt=db.prepare('SELECT owner_key,goal_session_id,registration_json FROM main.owner_enrollment_goal_sessions WHERE logical_owner_key=?').get(logical(review)) as {owner_key:string;goal_session_id:string;registration_json:string}|undefined;
    if(!receipt||receipt.owner_key!==row.owner_json||receipt.goal_session_id!==review.enrollment.goalSessionId||!extendsRegistration(review.registration,JSON.parse(receipt.registration_json))||!extendsRegistration(JSON.parse(receipt.registration_json),JSON.parse(registration.registration_json)))throw Error('enrollment_request_receipt');
   }
   if(review.enrollment.loopSubject!==undefined){
    const receipt=db.prepare('SELECT registration_json FROM main.owner_enrollment_loop_subjects WHERE logical_owner_key=?').get(logical(review)) as {registration_json:string}|undefined;
    if(!receipt||!extendsRegistration(review.registration,JSON.parse(receipt.registration_json)))throw Error('enrollment_request_receipt');
   }
   return Object.freeze({state:'committed' as const,challenge,owner:Object.freeze(owner)});
  }
  if(row.owner_json!==null||row.state==='not_approved'&&original.state!=='not_approved'||row.state==='mapped'&&!['prepared','authorizing','failed','retired'].includes(original.state)||!['mapped','not_approved'].includes(row.state))throw Error('enrollment_request_corrupt');
  return Object.freeze({state:row.state as 'mapped'|'not_approved',challenge});
 }
 function prepareInTransaction(raw:{enrollment:OwnerEnrollment;registration:OwnerEnrollmentReview['registration']},peer:ControllerPeer){
   raw=captureKSwarmEnrollmentData(raw,true);assertIntentEnrollmentEnvelope(raw);const proposal=copy(raw);shape(proposal,['enrollment','registration']);const p=principal(peer),c=clock(),id=randomUUID();
   const review=parseOwnerEnrollmentReview({version:1,purpose:'completion-owner-enrollment',authorityId,challengeId:id,principal:{uid:p.uid,accountGeneration:p.accountGeneration,auditSessionId:p.auditSessionId},profileSlot:'default',...proposal,deadline:{domainId:c.domainId,qualificationEpoch:c.qualificationEpoch,notBefore:c.lowerBound,validUntil:c.lowerBound+300000}});
   if(review.registration.source.kind!=='new-owner')throw Error('enrollment_migration_unavailable');check(review,peer);immutable(review,peer);

    const now=clock();db.prepare("UPDATE main.owner_enrollment_challenges SET state='retired' WHERE state IN ('prepared','authorizing') AND (boot<>? OR json_extract(review_json,'$.deadline.domainId')<>? OR json_extract(review_json,'$.deadline.qualificationEpoch')<>? OR json_extract(review_json,'$.deadline.validUntil')<=?)").run(boot,now.domainId,now.qualificationEpoch,now.lowerBound);
    // Missing identifiers fail closed. Never retain unauthenticated review bodies
    // forever; immutable accepted registration intents live in a separate table.
    db.prepare("DELETE FROM main.owner_enrollment_challenges WHERE state IN ('retired','failed','committed','not_approved') AND NOT EXISTS(SELECT 1 FROM main.owner_enrollment_requests r WHERE r.challenge_id=owner_enrollment_challenges.id)").run();
    if(requestCount()>=4096||(db.prepare("SELECT count(*) n FROM main.owner_enrollment_challenges WHERE state IN ('prepared','authorizing') AND principal=?").get(json(peer)) as {n:number}).n>=64)throw Error('enrollment_capacity');
    check(review,peer);immutable(review,peer);assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json(review))+8192});db.prepare("INSERT INTO main.owner_enrollment_challenges VALUES(?,?,?,'prepared',?)").run(id,json(peer),boot,json(review));
   return Object.freeze({challengeId:id,canonicalReview:review});
 }
 // Internal FINAL reads must not reenter the registry's mutation lock. Resolve
 // only an already active source from this same DB, actual principal and the
 // installed publication; this read cannot enroll or issue an authorization.
 function existingGoalOwner(ownerId:string,peer:ControllerPeer):Readonly<VerificationOwner>{
  if(typeof ownerId!=='string'||!ownerId||Buffer.byteLength(ownerId)>160||/[\x00-\x1f\x7f]/.test(ownerId))throw Error('enrollment_fork_owner');
  const p=principal(peer),profile=db.prepare('SELECT account_id,profile_id,state FROM main.verification_profiles WHERE uid=?').get(p.uid) as {account_id:string;profile_id:string;state:string}|undefined;
  if(!profile||profile.state!=='active'||profile.account_id!==p.accountGeneration.toLowerCase())throw Error('application_registration_owner');
  const published:unknown=assertProfilePublished({version:1,authorityId,uid:p.uid,accountId:profile.account_id,profileId:profile.profile_id});
  if(published!==undefined){void Promise.resolve(published).catch(()=>{});throw Error('enrollment_fork_publication_sync');}
  const owner=Object.freeze({profileId:profile.profile_id,ownerKind:'goal' as const,ownerId});
  const registered=db.prepare('SELECT uid,state FROM main.verification_registered_owners WHERE owner_key=?').get(json(owner)) as {uid:number;state:string}|undefined;
  if(registered?.uid!==p.uid||registered.state!=='active'||json(principal(peer))!==json(p))throw Error('application_registration_owner');
  return owner;
 }
 function assertMigrationPublished(owner:VerificationOwner,migrationEpoch:number){
     if(db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='migration_publication_intents'").get()){
      const row=db.prepare('SELECT state,published,marker_json FROM main.migration_publication_intents WHERE owner_key=?').get(json(owner)) as {state:string;published:number;marker_json:string}|undefined;
      if(row){if(row.state!=='migrated'||row.published!==1)throw Error('enrollment_migration_pending');const marker=parseMigrationMarker(JSON.parse(row.marker_json));if(marker.state!=='migrated'||marker.authorityId!==authorityId||marker.migrationEpoch!==migrationEpoch||json({profileId:marker.profileId,ownerKind:marker.ownerKind,ownerId:marker.ownerId})!==json(owner))throw Error('enrollment_migration_binding');}
     }
 }
 // Snapshot actual durable inputs, including inherited owners. This final
 // comparison performs no host callbacks, so even the last clock/profile port
 // cannot swap facts after they were checked and before a read result escapes.
 function registrationRows<T extends Record<string,any>>(rows:readonly T[]):T[]{
  if(rows.length<2)return [...rows];
  return rows.map(row=>({row,key:json(row)})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(value=>value.row);
 }
 function registrationVector(nodes:readonly Record<string,any>[]):Record<string,any>[]{
  const sorted=[...nodes].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  for(let index=0;index<sorted.length;index++)if(typeof sorted[index]!.key!=='string'||(index>0&&sorted[index-1]!.key===sorted[index]!.key))throw Error('application_registration_changed');
  return captureRegistrationSnapshot(sorted);
 }
 function registrationReadVector(owner:VerificationOwner,activation?:{owner:VerificationOwner;invocations:readonly unknown[]},originalIntent?:ReturnType<typeof parseIntentContractEnrollment>):Record<string,any>[]{
  assertNativeSqliteArrayConstruction();
  if(registrationDatabase){
   if(activation===undefined&&originalIntent===undefined){const data=registrationDatabase.collectFixedRegistrationData(owner);if(data){registrationEvidence.set(data.vector,data.evidence);return data.vector;}}
   const census=registrationDatabase.begin(),root=json(owner),pending=[root],identities=new Map<string,VerificationOwner>(),dependencies=new Map<string,Record<string,any>[]>();
   if(isIntentContractOwner(owner)){
    const receipt=census.groups('owner_enrollment_intent_contracts',[root]).get(root)![0];
    if(receipt||originalIntent){const binding=originalIntent??readIntentSqlContract(db,receipt!.contract_json);for(const stageId of [null,...binding.contract.stages.map(stage=>stage.stageId)])pending.push(json({...intentHostSubjectOwner({...binding.subject,stageId}),profileId:owner.profileId}));}
   }
   while(pending.length){const frontier:string[]=[];while(pending.length){const key=pending.pop()!;if(identities.has(key))continue;identities.set(key,JSON.parse(key));if(identities.size>4096)throw Error('application_registration_changed');frontier.push(key);}const found=census.groups('verification_owner_dependencies',frontier);for(const key of frontier){const edges=found.get(key)!;dependencies.set(key,edges);for(const edge of edges)pending.push(edge.child_key);}}
   const keys=[...identities.keys()],profileRows=new Map(keys.map(key=>[key,census.records('SELECT * FROM main.verification_profiles WHERE profile_id=? OR uid IN (SELECT uid FROM main.verification_registered_owners WHERE owner_key=?) ORDER BY uid',[identities.get(key)!.profileId,key])])),logicalByOwner=new Map<string,string[]>(),logicalKeys=new Set<string>();
   for(const key of keys){const identity=identities.get(key)!,logical=profileRows.get(key)!.map(p=>json({uid:p.uid,accountGeneration:p.account_id.toUpperCase(),ownerKind:identity.ownerKind,ownerId:identity.ownerId}));logicalByOwner.set(key,logical);for(const value of logical)logicalKeys.add(value);}
   const grouped=new Map<keyof typeof REGISTRATION_TABLE_KEYS,Map<string,Record<string,any>[]>>();
   for(const table of Object.keys(REGISTRATION_TABLE_KEYS) as Array<keyof typeof REGISTRATION_TABLE_KEYS>){if(table==='verification_owner_dependencies')continue;grouped.set(table,census.groups(table,REGISTRATION_TABLE_KEYS[table]==='logical_owner_key'?[...logicalKeys]:keys));}
   const rows=(table:keyof typeof REGISTRATION_TABLE_KEYS,key:string)=>captureRegistrationSnapshot(registrationRows(grouped.get(table)!.get(key)??[]),false),storageFeatures=registrationRows(census.records('SELECT * FROM main.verification_storage_features ORDER BY feature')),vectors:Record<string,any>[]=[];
   for(const key of keys){const identity=identities.get(key)!,profiles=profileRows.get(key)!,logical=logicalByOwner.get(key)!,owners=rows('verification_registered_owners',key),invocations=rows('verification_registered_invocations',key);
    if(activation&&identity.profileId===activation.owner.profileId)for(const profile of profiles)profile.state='active';
    if(activation&&key===json(activation.owner)){for(const row of owners)row.state='active';for(const row of invocations)if(activation.invocations.some(v=>json(v)===row.invocation_json))row.state='active';}
    vectors.push({key,profiles,dependencies:registrationRows(dependencies.get(key)!),intents:registrationRows(logical.flatMap(value=>rows('owner_enrollment_intents',value))),owner:owners,verification:rows('verification_owners',key),mandatory:rows('mandatory_observation_checks',key),invocations,invocationReceipts:rows('owner_enrollment_invocation_receipts',key),goalSessions:rows('owner_enrollment_goal_sessions',key),loopSubjects:rows('owner_enrollment_loop_subjects',key),intentContracts:rows('owner_enrollment_intent_contracts',key),kswarmSubjects:registrationRows(logical.flatMap(value=>rows('owner_enrollment_kswarm_subjects',value))),storageFeatures:captureRegistrationSnapshot(storageFeatures),migration:rows('migration_publication_intents',key),application:rows('verification_application_pointers',key),history:rows('verification_application_history',key),transitions:rows('verification_application_transitions',key)});
   }
   census.finish();const vector=registrationVector(vectors);registrationEvidence.set(vector,census.evidence);return vector;
  }
  const root=json(owner),pending=[root],seen=new Set<string>(),vectors:Record<string,any>[]=[];
  // Intent admission checks the complete immutable parent contract, not merely
  // this stage's predecessors. Fence those same facts, including missing rows.
  if(isIntentContractOwner(owner)){
   const receipt=db.prepare('SELECT contract_json FROM main.owner_enrollment_intent_contracts WHERE owner_key=?').get(root) as {contract_json:string}|undefined;
   if(receipt||originalIntent){const binding=originalIntent??readIntentSqlContract(db,receipt!.contract_json);
    for(const stageId of [null,...binding.contract.stages.map(stage=>stage.stageId)])pending.push(json({...intentHostSubjectOwner({...binding.subject,stageId}),profileId:owner.profileId}));
   }
  }
  const rows=(table:string,key:string,value:string)=>{
   if(!db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?").get(table))return [];
   return registrationRows(db.prepare(`SELECT * FROM main.${table} WHERE ${key}=?`).all(value) as Record<string,any>[]);
  };
  while(pending.length){
   const key=pending.pop()!;if(seen.has(key))continue;seen.add(key);if(seen.size>4096)throw Error('application_registration_changed');
   const identity=JSON.parse(key) as VerificationOwner;
   const profiles=db.prepare('SELECT * FROM main.verification_profiles WHERE profile_id=? OR uid IN (SELECT uid FROM main.verification_registered_owners WHERE owner_key=?) ORDER BY uid').all(identity.profileId,key) as {uid:number;account_id:string}[];
   const logicalKeys=profiles.map(p=>json({uid:p.uid,accountGeneration:p.account_id.toUpperCase(),ownerKind:identity.ownerKind,ownerId:identity.ownerId}));
   const dependencies=rows('verification_owner_dependencies','parent_key',key);
   for(const edge of dependencies)pending.push(edge.child_key);
   if(activation&&identity.profileId===activation.owner.profileId)for(const profile of profiles)(profile as any).state='active';
   const registeredOwners=registrationRows(rows('verification_registered_owners','owner_key',key).map(row=>{if(activation&&key===json(activation.owner))row.state='active';return row;}));
   const registeredInvocations=registrationRows(rows('verification_registered_invocations','owner_key',key).map(row=>{if(activation&&key===json(activation.owner)&&activation.invocations.some(v=>json(v)===row.invocation_json))row.state='active';return row;}));
   vectors.push({key,profiles,dependencies,
    intents:registrationRows(logicalKeys.flatMap(k=>rows('owner_enrollment_intents','logical_owner_key',k))),
    owner:registeredOwners,verification:rows('verification_owners','owner_key',key),
    mandatory:rows('mandatory_observation_checks','owner_key',key),invocations:registeredInvocations,
    invocationReceipts:rows('owner_enrollment_invocation_receipts','owner_key',key),goalSessions:rows('owner_enrollment_goal_sessions','owner_key',key),loopSubjects:rows('owner_enrollment_loop_subjects','owner_key',key),intentContracts:rows('owner_enrollment_intent_contracts','owner_key',key),kswarmSubjects:registrationRows(logicalKeys.flatMap(k=>rows('owner_enrollment_kswarm_subjects','logical_owner_key',k))),storageFeatures:registrationRows(db.prepare('SELECT * FROM main.verification_storage_features ORDER BY feature').all() as Record<string,any>[]),
    migration:rows('migration_publication_intents','owner_key',key),application:rows('verification_application_pointers','owner_key',key),
    history:rows('verification_application_history','owner_key',key),transitions:rows('verification_application_transitions','owner_key',key),
   });
  }
  return registrationVector(vectors);
 }
 function enrollmentFinalVector(owner:VerificationOwner,review:Readonly<OwnerEnrollmentReview>,peer:ControllerPeer,activation:boolean):Record<string,unknown>{return captureRegistrationSnapshot({registration:registrationReadVector(owner,activation?{owner,invocations:review.enrollment.invocations}:undefined),challenge:db.prepare('SELECT * FROM main.owner_enrollment_challenges WHERE id=?').get(review.challengeId)??null,request:db.prepare('SELECT * FROM main.owner_enrollment_requests WHERE challenge_id=?').get(review.challengeId)??null,principal:peer});}
 function fenceRegistrationRead(owner:VerificationOwner){if(owner.ownerKind==='kswarm')assertKSwarmSqlIntegrity(db);const before=registrationReadVector(owner);return ()=>{const after=registrationReadVector(owner);if(!isDeepStrictEqual(after,before)||!isDeepStrictEqual(registrationEvidence.get(after),registrationEvidence.get(before)))throw Error('application_registration_changed');if(owner.ownerKind==='kswarm')assertKSwarmSqlIntegrity(db);};}
 function validatedApplicationRegistration(raw:VerificationOwner,rawPeer:ControllerPeer,sessionId:string){
   const owner=copy(raw),peer=peerValue(rawPeer);shape(owner,['profileId','ownerKind','ownerId']);
   if(owner.ownerKind!=='goal'||typeof sessionId!=='string'||!sessionId||Buffer.byteLength(sessionId)>160||/[\x00-\x1f\x7f]/.test(sessionId))throw Error('application_registration_session');
   return runVerificationTransaction(db,()=>{
    clock();const assertStable=fenceRegistrationRead(owner),p=principal(peer),resolved=existingGoalOwner(owner.ownerId,peer);
    if(json(resolved)!==json(owner))throw Error('application_registration_owner');
    const logicalKey=json({uid:p.uid,accountGeneration:p.accountGeneration,ownerKind:owner.ownerKind,ownerId:owner.ownerId});
    const intent=db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logicalKey) as {registration_json:string;committed:number}|undefined;
    if(!intent||intent.committed!==1)throw Error('application_registration_unapproved');
    const registration=parseOwnerEnrollmentRegistration(JSON.parse(intent.registration_json)),actual=completion.authority.service.inspectOwner(owner);
    const session=db.prepare('SELECT logical_owner_key,goal_session_id,registration_json FROM main.owner_enrollment_goal_sessions WHERE owner_key=?').get(json(owner)) as {logical_owner_key:string;goal_session_id:string;registration_json:string}|undefined;
    if(session){
     if(session.logical_owner_key!==logicalKey||session.goal_session_id!==sessionId||!extendsRegistration(JSON.parse(session.registration_json),registration))throw Error('application_registration_session');
    }else{
     const invocation=db.prepare("SELECT invocation_json FROM main.verification_registered_invocations WHERE profile_id=? AND owner_key=? AND state='active' AND json_extract(invocation_json,'$.sessionIdentity')=? ORDER BY invocation_json LIMIT 1").get(owner.profileId,json(owner),sessionId) as {invocation_json:string}|undefined;
     if(!invocation)throw Error('application_registration_session');
     assertInvocationCommitted(owner,JSON.parse(invocation.invocation_json),peer);
    }
    if(!actual||actual.migrationEpoch!==registration.migrationEpoch||(db.prepare('SELECT count(*) n FROM main.mandatory_observation_checks WHERE owner_key=?').get(json(owner)) as {n:number}).n!==registration.obligations.length)throw Error('application_registration_changed');
    assertMigrationPublished(owner,actual.migrationEpoch);
    for(const entry of registration.obligations){
     const original=db.prepare('SELECT definition_json FROM main.mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(json(owner),entry.obligation.obligationId) as {definition_json:string}|undefined;
     if(!original||original.definition_json!==json(entry.obligation))throw Error('application_registration_changed');
    }
    if(json(principal(peer))!==json(p)||json(existingGoalOwner(owner.ownerId,peer))!==json(owner))throw Error('application_registration_principal');clock();assertStable();
    return Object.freeze({owner:Object.freeze(owner),registrationHash:goalRegistrationHash(registration),registration,actual});
   });
 }

 function readGoalForkSource(ownerId:string,sessionId:string,peer:ControllerPeer){
  return runVerificationTransaction(db,()=>{
   const owner=existingGoalOwner(ownerId,peer);
   const assertStable=fenceRegistrationRead(owner);
   const original=validatedApplicationRegistration(owner,peer,sessionId),application=completion.authority.host.inspectApplication(owner);
   if(application.state!=='active'||!application.current||application.pendingTransitionId!==null||application.current.binding.kind!=='goal'||application.current.binding.sessionId!==sessionId)throw Error('enrollment_fork_application');
   const dependencies=(db.prepare('SELECT child_key FROM main.verification_owner_dependencies WHERE parent_key=?').all(json(owner)) as {child_key:string}[]).map(row=>JSON.parse(row.child_key) as VerificationOwner).sort((a,b)=>json(a).localeCompare(json(b)));
   const snapshot=parseGoalForkSourceSnapshot({source:{authorityId,owner,sessionId,applicationHash:application.current.bindingHash,registrationHash:original.registrationHash,obligationSetHash:original.actual.obligationSetHash,dependencies},registration:original.registration,application:application.current.binding});assertStable();return snapshot;
  });
 }
 function assertForkSource(review:Readonly<OwnerEnrollmentReview>,peer:ControllerPeer){
  if(review.registration.source.kind!=='new-owner'||!review.registration.source.fork)return;
  const source=review.registration.source.fork;
  const actual=readGoalForkSource(source.owner.ownerId,source.sessionId,peer);
  if(json(actual.source)!==json(source)||json(actual.registration.obligations)!==json(review.registration.obligations))throw Error('enrollment_fork_source_changed');
 }
 function readIntentRegistrationSnapshot(raw:VerificationOwner,rawPeer:ControllerPeer,rawSubject:Readonly<IntentHostSubject>){
   const owner=copy(raw),peer=peerValue(rawPeer),subject=parseIntentHostSubject(rawSubject),mapped=intentHostSubjectOwner(subject);shape(owner,['profileId','ownerKind','ownerId']);
   if(owner.ownerKind!==mapped.ownerKind||owner.ownerId!==mapped.ownerId)throw Error('application_registration_owner');
   return runVerificationTransaction(db,()=>{clock();const assertStable=fenceRegistrationRead(owner),p=principal(peer);
    if(json(registry.resolveOwner(peer,mapped))!==json(owner))throw Error('application_registration_owner');assertIntentReady(owner);const receipt=intentReceipt(owner);
    if(json(receipt.binding.subject)!==json(subject))throw Error('application_registration_owner');
    if(json(principal(peer))!==json(p)||json(registry.resolveOwner(peer,mapped))!==json(owner))throw Error('application_registration_principal');clock();assertStable();
    return Object.freeze({owner:Object.freeze(owner) as Readonly<VerificationOwner & {ownerKind:'intent'}>,subject,contract:receipt.binding.contract,contractHash:intentBusinessContractHash(receipt.binding.contract),registration:receipt.registration,registrationHash:intentOriginalRegistrationHash(receipt.registration)});
   });
  }
 const api=Object.freeze({
  /** Private read-only inventory: expiry is judged by this authorizer's original clock. */
  getLiveSourceRegistrationReviews():ReadonlyArray<Readonly<OwnerEnrollmentReview>>{
   return runVerificationTransaction(db,()=>{
    const now=clock(),result:Readonly<OwnerEnrollmentReview>[]=[];
    const rows=db.prepare("SELECT * FROM main.owner_enrollment_challenges WHERE state IN ('prepared','authorizing') ORDER BY id").all() as Row[];
    const originalRows=json(rows);
    for(const row of rows){
     const review=parseOwnerEnrollmentReview(JSON.parse(row.review_json));
     if(row.boot!==boot||review.deadline.domainId!==now.domainId||review.deadline.qualificationEpoch!==now.qualificationEpoch||review.deadline.validUntil<=now.lowerBound)continue;
     const peer=peerValue(JSON.parse(row.principal));
     if(row.id!==review.challengeId)throw Error('enrollment_challenge_binding');
     if(row.state==='authorizing')checkAuthorizing(review,peer);else load(row.id,peer);
     immutable(review,peer);result.push(review);
    }
    clock();if(json(db.prepare("SELECT * FROM main.owner_enrollment_challenges WHERE state IN ('prepared','authorizing') ORDER BY id").all())!==originalRows)throw Error('application_registration_changed');return Object.freeze(result);
   });
  },
  prepare(raw:{enrollment:OwnerEnrollment;registration:OwnerEnrollmentReview['registration']},rawPeer:ControllerPeer){
   raw=captureKSwarmEnrollmentData(raw,true);assertKSwarmCapability(raw.enrollment);
   if(db.inTransaction)throw Error('enrollment_outer_transaction');const peer=peerValue(rawPeer);
   return enrollmentTransaction(raw.enrollment,()=>prepareInTransaction(raw,peer));
  },
  prepareRequest(raw:OwnerEnrollmentRequest,rawPeer:ControllerPeer){
   raw=captureKSwarmEnrollmentData(raw,true);assertKSwarmCapability(raw.enrollment);
   if(db.inTransaction)throw Error('enrollment_outer_transaction');const peer=peerValue(rawPeer);
   return enrollmentTransaction(raw.enrollment,()=>{
    const request=requestParts(raw,peer),existing=findRequest(request);
    if(existing){const observed=observeRequest(existing,request);
     if(observed.state==='not_prepared'||observed.state==='not_approved')throw Error('enrollment_request_retired');
     if(!('challenge' in observed))throw Error('enrollment_request_corrupt');
     return Object.freeze({created:false,challenge:observed.challenge});
    }
    const challenge=prepareInTransaction(request.proposal,peer);
    insertRequest(request,'mapped',challenge.challengeId);
    return Object.freeze({created:true,challenge});
   });
  },
  lookupRequest(raw:OwnerEnrollmentRequest,rawPeer:ControllerPeer):OwnerEnrollmentRequestObservation{
   raw=captureKSwarmEnrollmentData(raw,true);assertKSwarmCapability(raw.enrollment);
   if(db.inTransaction)throw Error('enrollment_outer_transaction');const peer=peerValue(rawPeer);
   return enrollmentTransaction(raw.enrollment,()=>{const request=requestParts(raw,peer),row=findRequest(request);return row?observeRequest(row,request):Object.freeze({state:'absent' as const});});
  },
  recoverRequest(raw:OwnerEnrollmentRequest,rawPeer:ControllerPeer):OwnerEnrollmentRequestRecovery{
   raw=captureKSwarmEnrollmentData(raw,true);assertKSwarmCapability(raw.enrollment);
   if(db.inTransaction)throw Error('enrollment_outer_transaction');const peer=peerValue(rawPeer);
   return enrollmentTransaction(raw.enrollment,()=>{
    const request=requestParts(raw,peer),row=findRequest(request);
    if(!row){insertRequest(request,'not_prepared',null);return Object.freeze({state:'not_prepared' as const});}
    const observed=observeRequest(row,request);if(observed.state==='absent')throw Error('enrollment_request_corrupt');if(observed.state!=='mapped')return observed;
    if(db.prepare("UPDATE main.owner_enrollment_challenges SET state='not_approved' WHERE id=? AND state IN ('prepared','authorizing','failed','retired')").run(row.challenge_id).changes!==1)throw Error('enrollment_request_corrupt');
    if(db.prepare("UPDATE main.owner_enrollment_requests SET state='not_approved' WHERE request_id=? AND state='mapped'").run(row.request_id).changes!==1)throw Error('enrollment_request_corrupt');
    return Object.freeze({state:'not_approved' as const,challenge:observed.challenge});
   });
  },
  async authorize(id:string,rawPeer:ControllerPeer,signal:AbortSignal){
   if(db.inTransaction)throw Error('enrollment_outer_transaction');const peer=peerValue(rawPeer),active=AbortSignal.any([signal,lifetime.signal]);active.throwIfAborted();
   // Capture original mapping and the original graph before the first clock,
   // principal, qualification or native callback can change them.
   const originalChallenge=db.prepare('SELECT * FROM main.owner_enrollment_challenges WHERE id=?').get(id) as Row|undefined;
   if(!originalChallenge)throw Error('enrollment_challenge');
   const originalRequest=(db.prepare('SELECT * FROM main.owner_enrollment_requests WHERE challenge_id=?').get(id) as RequestRow|undefined)??null;
   const originalReview=parseOwnerEnrollmentReview(JSON.parse(originalChallenge.review_json));assertKSwarmCapability(originalReview.enrollment);
   let originalOthers:readonly Record<string,any>[]|null=null,originalOwn:Record<string,any>|null=null;
   if(isIntentContractOwner(originalReview.enrollment)||originalReview.enrollment.ownerKind==='kswarm'){
    const profile=db.prepare('SELECT profile_id FROM main.verification_profiles WHERE uid=?').get(peer.uid) as {profile_id:string}|undefined;
    if(profile){const owner={profileId:profile.profile_id,ownerKind:originalReview.enrollment.ownerKind,ownerId:originalReview.enrollment.ownerId};
     const stored=db.prepare('SELECT contract_json FROM main.owner_enrollment_intent_contracts WHERE owner_key=?').get(json(owner)) as {contract_json:string}|undefined;
     const binding=originalReview.enrollment.intentContract??(stored?parseIntentContractEnrollment(JSON.parse(stored.contract_json)):undefined);
     if(binding||originalReview.enrollment.ownerKind==='kswarm'){const originalVectors=registrationReadVector(owner,undefined,binding);originalOthers=registrationVector(originalVectors.filter(value=>value.key!==json(owner)));const own=originalVectors.find(value=>value.key===json(owner));originalOwn=own?captureRegistrationSnapshot(own):null;}
    }
   }
   const assertIdentity=(state:'prepared'|'authorizing'|'committed',owner?:VerificationOwner)=>{
    active.throwIfAborted();const expectedRequest=originalRequest&&state==='committed'?{...originalRequest,state:'committed',owner_json:json(owner)}:originalRequest;
    if(json(db.prepare('SELECT * FROM main.owner_enrollment_challenges WHERE id=?').get(id)??null)!==json({...originalChallenge,state}))throw Error('enrollment_challenge_consumed');
    if(json(db.prepare('SELECT * FROM main.owner_enrollment_requests WHERE challenge_id=?').get(id)??null)!==json(expectedRequest))throw Error('enrollment_request_changed');
   };
   const review=runVerificationTransaction(db,()=>{const r=load(id,peer);assertIdentity('prepared');if(db.prepare("UPDATE main.owner_enrollment_challenges SET state='authorizing' WHERE id=? AND state='prepared'").run(id).changes!==1)throw Error('enrollment_challenge_consumed');assertIdentity('authorizing');return r;});
   const authorization=Object.freeze({});
   try{
    const result=copy(await approve(review,active));active.throwIfAborted();shape(result,['uid','auditSessionId','reviewHash']);if(result.uid!==peer.uid||result.auditSessionId!==peer.auditSessionId||result.reviewHash!==hash(review))throw Error('enrollment_native_reply');checkAuthorizing(review,peer);assertIdentity('authorizing');
    runVerificationTransaction(db,()=>{checkAuthorizing(review,peer);if(!immutable(review,peer)){assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json(review.registration))+Buffer.byteLength(json(review.enrollment))+4096});db.prepare('INSERT INTO main.owner_enrollment_intents(logical_owner_key,registration_json,loop_subject_json,intent_contract_json) VALUES(?,?,?,?)').run(logical(review),json(review.registration),review.enrollment.loopSubject===undefined?null:json(review.enrollment.loopSubject),review.enrollment.intentContract===undefined?null:json(review.enrollment.intentContract));}kswarm.stage(review);});
    grants.set(authorization,{review,peer,consumed:false,signal:active,originalChallenge,originalRequest,originalOthers,originalOwn,assertIdentity});
    const context={peer,requestSource:'user' as const,authorization};registry.enroll(review.enrollment,context);
    if(review.enrollment.ownerKind==='kswarm'){const known=grants.get(authorization)!;if(!known.committedOwner)throw Error('enrollment_final_commit_missing');const owner=known.committedOwner;known.result=runVerificationTransaction(db,()=>{assertKSwarmCapability(owner);const fence=fenceRegistrationRead(owner);assertKSwarmReady(owner);check(review,peer);const readGrant=completion.host.issueReadScope({owner,peer,expiresAt:review.deadline.validUntil});assertKSwarmReady(owner);check(review,peer);fence();return Object.freeze({owner,readGrant});});}
    active.throwIfAborted();
    const committedResult=grants.get(authorization)?.result;if(!committedResult)throw Error('enrollment_final_commit_missing');return committedResult;
   }catch(error){try{runVerificationTransaction(db,()=>{db.prepare("UPDATE main.owner_enrollment_challenges SET state='failed' WHERE id=? AND state='authorizing'").run(id);});}catch{/* A failed audit write cannot make a consumed challenge reusable. */}throw error;}
   finally{grants.delete(authorization);}
  },
  openOwner(raw:{ownerKind:OwnerEnrollment['ownerKind'];ownerId:string},rawPeer:ControllerPeer){
   if(db.inTransaction)throw Error('enrollment_outer_transaction');const peer=peerValue(rawPeer),request=copy(raw);
   return runVerificationTransaction(db,()=>{const p=principal(peer),owner=registry.resolveOwner(peer,request),assertStable=fenceRegistrationRead(owner);
    const checkCurrent=()=>{if(json(principal(peer))!==json(p)||json(registry.resolveOwner(peer,request))!==json(owner))throw Error('enrollment_principal');
     const state=completion.authority.service.inspectOwner(owner);if(!state||state.obligationCount<1)throw Error('enrollment_owner_unregistered');
     assertMigrationPublished(owner,state.migrationEpoch);assertIntentReady(owner);assertKSwarmReady(owner);
    };
    checkCurrent();const c=clock(),readGrant=completion.host.issueReadScope({owner,peer,expiresAt:c.lowerBound+300000});checkCurrent();clock();assertStable();return Object.freeze({owner,readGrant});
   });
  },
  /** Private recipe lookup. A parsed definition or a partial enrollment is not approval. */
  readApplicationRegistration(raw:VerificationOwner,rawPeer:ControllerPeer,sessionId:string){
   const {owner,registrationHash}=validatedApplicationRegistration(raw,rawPeer,sessionId);return Object.freeze({owner,registrationHash});
  },
  readLoopApplicationRegistration(raw:VerificationOwner,rawPeer:ControllerPeer,rawSubject:Readonly<LoopHostSubject>){
   const owner=copy(raw),peer=peerValue(rawPeer),subject=parseLoopHostSubject(rawSubject),mapped=loopHostSubjectOwner(subject);
   shape(owner,['profileId','ownerKind','ownerId']);if(owner.ownerKind!==mapped.ownerKind||owner.ownerId!==mapped.ownerId)throw Error('application_registration_owner');
   return runVerificationTransaction(db,()=>{
    clock();const assertStable=fenceRegistrationRead(owner),p=principal(peer),review={principal:p,enrollment:{...mapped,loopSubject:subject,invocations:[]}};
    if(json(registry.resolveOwner(peer,mapped))!==json(owner))throw Error('application_registration_owner');
    assertLoopSubjectProposal(review);
    const intent=db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logical(review)) as {registration_json:string;committed:number}|undefined;
    if(!intent||intent.committed!==1)throw Error('application_registration_unapproved');
    const registration=parseOwnerEnrollmentRegistration(JSON.parse(intent.registration_json)),actual=completion.authority.service.inspectOwner(owner);
    if(!actual||actual.migrationEpoch!==registration.migrationEpoch||(db.prepare('SELECT count(*) n FROM main.mandatory_observation_checks WHERE owner_key=?').get(json(owner)) as {n:number}).n!==registration.obligations.length)throw Error('application_registration_changed');
    assertMigrationPublished(owner,actual.migrationEpoch);
    for(const entry of registration.obligations){
     const original=db.prepare('SELECT definition_json FROM main.mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(json(owner),entry.obligation.obligationId) as {definition_json:string}|undefined;
     if(!original||original.definition_json!==json(entry.obligation))throw Error('application_registration_changed');
    }
    if(json(principal(peer))!==json(p)||json(registry.resolveOwner(peer,mapped))!==json(owner))throw Error('application_registration_principal');
    assertLoopSubjectProposal(review);
    const current=db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(logical(review));
    if(json(current)!==json(intent))throw Error('application_registration_changed');clock();assertStable();
    return Object.freeze({owner:Object.freeze(owner),subject,registrationHash:createHash('sha256').update('xiaok-loop-original-registration-v1\0').update(json(registration)).digest('hex')});
   });
  },
  readKSwarmApplicationRegistration(raw:VerificationOwner,rawPeer:ControllerPeer,rawSubject:Readonly<KSwarmHostSubject>){
   const subject=parseKSwarmHostSubject(rawSubject),mapped=kswarmHostSubjectOwner(subject),owner=copy(raw),peer=peerValue(rawPeer);assertKSwarmCapability(owner);
   if(owner.ownerKind!==mapped.ownerKind||owner.ownerId!==mapped.ownerId)throw Error('enrollment_kswarm_subject');
   return runVerificationTransaction(db,()=>{const fence=fenceRegistrationRead(owner),p=principal(peer);clock();
    if(json(registry.resolveOwner(peer,mapped))!==json(owner))throw Error('enrollment_kswarm_principal');
    const original=assertKSwarmReady(owner);if(!original||json(original.subject)!==json(subject))throw Error('enrollment_kswarm_subject');
    if(json(principal(peer))!==json(p)||json(registry.resolveOwner(peer,mapped))!==json(owner))throw Error('enrollment_kswarm_principal');assertKSwarmReady(owner);clock();fence();
    return Object.freeze({owner:Object.freeze(owner),subject,registrationHash:createHash('sha256').update('xiaok-kswarm-original-registration-v1\0').update(json(original.registration)).digest('hex')});
   });
  },
  captureRegistrationReadFence(owner:VerificationOwner){return fenceRegistrationRead(copy(owner));},
  readIntentApplicationRegistration(raw:VerificationOwner,rawPeer:ControllerPeer,rawSubject:Readonly<IntentHostSubject>){const {registration,...result}=readIntentRegistrationSnapshot(raw,rawPeer,rawSubject);return Object.freeze(result);},
  readIntentRegistration(raw:unknown,rawPeer:ControllerPeer){return runVerificationTransaction(db,()=>{const subject=parseIntentHostSubject(raw),peer=peerValue(rawPeer),p=principal(peer),profile=db.prepare('SELECT profile_id,account_id FROM main.verification_profiles WHERE uid=?').get(p.uid) as {profile_id:string;account_id:string}|undefined;if(!profile||profile.account_id!==p.accountGeneration.toLowerCase())throw Error('enrollment_principal');const {contract,...result}=readIntentRegistrationSnapshot({...intentHostSubjectOwner(subject),profileId:profile.profile_id},peer,subject);return Object.freeze(result);});},
  readIntentContract(raw:unknown,rawPeer:ControllerPeer){const subject=parseIntentHostSubject(raw),peer=peerValue(rawPeer),p=principal(peer),profile=db.prepare('SELECT profile_id,account_id FROM main.verification_profiles WHERE uid=?').get(p.uid) as {profile_id:string;account_id:string}|undefined;if(!profile||profile.account_id!==p.accountGeneration.toLowerCase())throw Error('enrollment_principal');return api.readIntentApplicationRegistration({...intentHostSubjectOwner(subject),profileId:profile.profile_id},peer,subject);},
  readGoalForkSource(raw:{ownerKind:'goal';ownerId:string;sessionId:string},rawPeer:ControllerPeer){
   const query=copy(raw),peer=peerValue(rawPeer);shape(query,['ownerKind','ownerId','sessionId']);
   if(query.ownerKind!=='goal')throw Error('enrollment_fork_owner');
   return readGoalForkSource(query.ownerId,query.sessionId,peer);
  },
  readApprovedRecipe(raw:VerificationOwner,obligationId:string){
   const owner=copy(raw);shape(owner,['profileId','ownerKind','ownerId']);
   if(typeof obligationId!=='string'||!obligationId||obligationId.length>160)throw Error('enrollment_recipe');
   return runVerificationTransaction(db,()=>{
    clock();const key=json(owner),assertStable=fenceRegistrationRead(owner);assertIntentReady(owner);assertKSwarmReady(owner);
    const profile=db.prepare("SELECT p.uid,p.account_id FROM main.verification_registered_owners o JOIN main.verification_profiles p ON p.uid=o.uid WHERE o.owner_key=? AND o.state='active' AND p.state='active' AND p.profile_id=?").get(key,owner.profileId) as {uid:number;account_id:string}|undefined;
    if(!profile)throw Error('enrollment_recipe_owner');
    const intent=db.prepare('SELECT registration_json,committed FROM main.owner_enrollment_intents WHERE logical_owner_key=?').get(json({uid:profile.uid,accountGeneration:profile.account_id.toUpperCase(),ownerKind:owner.ownerKind,ownerId:owner.ownerId})) as {registration_json:string;committed:number}|undefined;
    if(!intent||intent.committed!==1)throw Error('enrollment_recipe_unapproved');
    const registration=JSON.parse(intent.registration_json) as OwnerEnrollmentReview['registration'];
    const actual=completion.authority.service.inspectOwner(owner);
    const entry=registration.obligations.find(item=>item.obligation.obligationId===obligationId);
    const mandatory=db.prepare('SELECT definition_json FROM main.mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(key,obligationId) as {definition_json:string}|undefined;
    if(!actual||actual.migrationEpoch!==registration.migrationEpoch||!entry||!mandatory||json(entry.obligation)!==mandatory.definition_json)throw Error('enrollment_recipe_binding');
    const parsed=parseIndependentRecipeDefinition(entry.recipe),definition=JSON.parse(mandatory.definition_json) as MandatoryObligation;
    if(parsed.definitionHash!==definition.definitionHash||json(parsed.requiredCheckIds)!==json(definition.requiredCheckIds))throw Error('enrollment_recipe_binding');
    clock();assertStable();return parsed.spec;
   });
  },
  resolveOwnerKey:registry.resolveOwnerKey,getProfile:registry.getProfile,createCapacityOwnerBinding:registry.createCapacityOwnerBinding,
  close(){lifetime.abort();},
 });return api;
}
