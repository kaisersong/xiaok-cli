import {withIntentSqlParsingContext} from './intent-sql-parsing-context.js';
import {PUBLICATION_SETTLEMENT_FENCE_SQL} from './kswarm-sql-integrity.js';
import {parseIntentHostSubject,intentHostSubjectOwner} from './intent-host-subject.js';
import {intentContractDependencies} from './intent-contract-enrollment.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import {assertVerificationCompletionDatabase,assertVerificationCompletionCompositionDatabase,type createVerificationCompletionComposition} from './completion-composition.js';
import {assertApprovedVerificationOperationsDatabase,type createApprovedVerificationOperations} from './approved-verification-operation.js';
import type {createReceiverTransport} from './receiver-transport.js';
import type {ControllerPeer} from './controller-public-daemon.js';
import type {ReceiverClockEvidence} from './receiver-store.js';
import type {VerificationOwner} from './proof-authority.js';
import type {Identity} from './receiver-authentication.js';
import {parsePublicationOperationReview,publicationReviewBytes,type PublicationOperationReview} from './publication-operation-review.js';
import type {authorizePublicationOperation} from './publication-operation-authorization.js';
import {canonicalVerificationJson as json,parseVerificationTuple,hashVerificationTuple,type VerificationTuple} from './protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from './storage-budget.js';
type Source='user'|'agent'|'scheduler';
type Principal=ControllerPeer&{accountGeneration:string;source:'macos-local-generateduid'};
interface Row{id:string;owner_key:string;principal:string;boot:string;state:string;review_json:string;payload_id:string;decision_json:string|null}
function shape(raw:unknown,keys:string[]):Record<string,any>{const value=JSON.parse(json(raw));if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('publication_operation_shape');return value;}
/** Sole private publication coordinator. Parsed data and native receipts alone
 * cannot substitute the real same-DB proof, immutable payload and receiver journal. */
export function createApprovedPublicationOperations(input:{database:Database;authorityId:string;completion:ReturnType<typeof createVerificationCompletionComposition>;verification:Pick<ReturnType<typeof createApprovedVerificationOperations>,'stageVerifiedPayload'>;receiverIdentity:Identity;receiver:Pick<ReturnType<typeof createReceiverTransport>,'stagePayload'|'call'>;clock():ReceiverClockEvidence;assertCurrent():void;resolvePrincipal(peer:ControllerPeer):Principal;approve(review:Readonly<PublicationOperationReview>,signal:AbortSignal):ReturnType<typeof authorizePublicationOperation>}){
 const {database:db,authorityId,completion,verification,receiver:transport,receiverIdentity,clock:clockPort,assertCurrent:currentPort,resolvePrincipal:principalPort,approve:approvalPort}=input;
 assertVerificationCompletionCompositionDatabase(completion,db);
 const host=completion.privateHost;
 assertVerificationCompletionDatabase(host,db);assertApprovedVerificationOperationsDatabase(verification,db,host);
 const invoke=completion.public.invoke.bind(completion.public),stagePayload=verification.stageVerifiedPayload.bind(verification),send=transport.call.bind(transport),upload=transport.stagePayload.bind(transport),readClock=clockPort.bind(input),check=currentPort.bind(input),resolve=principalPort.bind(input),approveNative=approvalPort.bind(input),receiver=JSON.parse(json(receiverIdentity)) as Identity;
 if(db.inTransaction)throw Error('publication_operation_outer_transaction');
 const boot=randomUUID(),lifetime=new AbortController(),pending=new Set<Promise<unknown>>();let closed=false,closing:Promise<void>|undefined;
 function current(){if(closed)throw Error('publication_operation_closed');assertVerificationCompletionDatabase(host,db);const result:unknown=check();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('publication_operation_current_sync');}}
 function clock(){current();const c=readClock();if(!c||!Number.isSafeInteger(c.lowerBound)||!Number.isSafeInteger(c.upperBound)||c.lowerBound<0||c.upperBound<c.lowerBound||!Number.isSafeInteger(c.qualificationEpoch)||c.qualificationEpoch<0||typeof c.domainId!=='string'||!c.domainId||!/^[a-f0-9]{64}$/.test(c.evidenceHash))throw Error('publication_operation_clock');return c;}
 function peer(raw:ControllerPeer){const p=shape(raw,['uid','gid','auditSessionId']) as ControllerPeer;if(![p.uid,p.gid,p.auditSessionId].every(Number.isSafeInteger)||p.uid<1||p.gid<0||p.auditSessionId<1)throw Error('publication_operation_peer');return p;}
 function principal(p:ControllerPeer){const value=shape(resolve(p),['uid','gid','auditSessionId','accountGeneration','source']) as Principal;if(value.uid!==p.uid||value.gid!==p.gid||value.auditSessionId!==p.auditSessionId||value.source!=='macos-local-generateduid'||!/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(value.accountGeneration))throw Error('publication_operation_principal');return value;}
 const ownerOf=(t:VerificationTuple):VerificationOwner=>({profileId:t.profileId,ownerKind:t.ownerKind,ownerId:t.ownerId});
 function opened(owner:Pick<VerificationOwner,'ownerKind'|'ownerId'>,p:ControllerPeer){if(!['task','intent','goal','loop','project'].includes(owner.ownerKind))throw Error('publication_operation_owner_kind');return host.enrollment.openOwner({ownerKind:owner.ownerKind,ownerId:owner.ownerId},p);}
 function load(id:unknown,p:ControllerPeer,existingOpen?:ReturnType<typeof opened>){current();if(typeof id!=='string'||id.length>160)throw Error('publication_operation_id');const r=db.prepare('SELECT * FROM publication_operations WHERE id=?').get(id) as Row|undefined;if(!r||r.principal!==json(p))throw Error('publication_operation_unknown');const review=parsePublicationOperationReview(JSON.parse(r.review_json));const facts=principal(p);if(json(review.principal)!==json({uid:facts.uid,accountGeneration:facts.accountGeneration,auditSessionId:facts.auditSessionId}))throw Error('publication_operation_principal');const open=existingOpen??opened(ownerOf(review.tuple),p);invoke('completion.inspect',{owner:open.owner,readGrant:open.readGrant},p);if(json(open.owner)!==r.owner_key)throw Error('publication_operation_owner');return{row:r,review,open};}
 function assertCurrentTuple(t:VerificationTuple){
  const owner=ownerOf(t),state=host.authorityService.inspectOwner(owner),c=clock();
  const decision=db.prepare('SELECT tuple_hash FROM settlement_decisions WHERE operation_id=? AND owner_key=?').get(t.operationId,json(owner)) as {tuple_hash:string}|undefined;
  if(!state||state.currentVerification!=='valid'||state.migrationEpoch!==t.migrationEpoch||state.businessRevision!==t.expectedBusinessRevision+(decision?.tuple_hash===hashVerificationTuple(t)?1:0)||state.obligationSetRevision!==t.obligationSetRevision||state.obligationSetHash!==t.obligationSetHash||json(host.authorityService.getCurrentDependencies(owner))!==json(t.obligations)||c.domainId!==t.clockDomainId||c.qualificationEpoch!==t.clockQualificationEpoch||c.lowerBound<t.notBefore||c.upperBound>=t.validUntil)throw Error('publication_operation_not_current');
 }
 function currentTuple(t:VerificationTuple,payloadId:string){
  assertCurrentTuple(t);const owner=ownerOf(t);
  const body=host.payloads.read(payloadId,owner);if(createHash('sha256').update(body).digest('hex')!==t.immutablePayloadHash)throw Error('publication_operation_payload');return body;
 }
 function receiverRequest(review:PublicationOperationReview,readGrant:unknown,p:ControllerPeer){return invoke('completion.receiver-challenge',{owner:ownerOf(review.tuple),tuple:review.tuple,readGrant},p) as {fullTupleHash:string;challenge:string};}
 function accept(review:PublicationOperationReview,readGrant:unknown,p:ControllerPeer,reply:unknown){return invoke('completion.receiver-reply',{owner:ownerOf(review.tuple),tuple:review.tuple,readGrant,reply},p);}
 function outcome(review:PublicationOperationReview){
  const t=review.tuple,h=hashVerificationTuple(t),r=db.prepare('SELECT tuple_hash,state_json,reply_json FROM publication_journal WHERE operation_id=?').get(t.operationId) as {tuple_hash:string;state_json:string;reply_json:string|null}|undefined;
  if(!r||r.tuple_hash!==h)throw Error('publication_operation_journal');const state=JSON.parse(r.state_json),reply=r.reply_json?JSON.parse(r.reply_json):undefined;
  const status=state.reservation==='consumed'&&state.outbox==='receiver_committed'&&reply?.result?.status==='committed'?'committed':state.reservation==='cancelled'&&reply?.result?.status==='cancelled'?'cancelled':'unknown';
  return Object.freeze({status,owner:ownerOf(t),operationId:t.operationId,fullTupleHash:h,businessRevision:t.expectedBusinessRevision+1,currentVerification:host.authorityService.inspectOwner(ownerOf(t))?.currentVerification??'unavailable'});
 }
 current();db.exec('CREATE TABLE IF NOT EXISTS publication_operations(id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,principal TEXT NOT NULL,boot TEXT NOT NULL,state TEXT NOT NULL,review_json TEXT NOT NULL,payload_id TEXT NOT NULL,decision_json TEXT);');
 db.exec(`CREATE TABLE IF NOT EXISTS publication_prepare_requests(principal_key TEXT NOT NULL,request_id TEXT NOT NULL,request_json TEXT NOT NULL,challenge_id TEXT NOT NULL UNIQUE,PRIMARY KEY(principal_key,request_id));
 CREATE TABLE IF NOT EXISTS publication_request_tombstones(principal_key TEXT NOT NULL,request_id TEXT NOT NULL,request_json TEXT NOT NULL,PRIMARY KEY(principal_key,request_id));
 ${PUBLICATION_SETTLEMENT_FENCE_SQL.replace('CREATE TRIGGER ','CREATE TRIGGER IF NOT EXISTS ')}`);
 function challenge(review:PublicationOperationReview){return Object.freeze({challengeId:review.challengeId,owner:ownerOf(review.tuple),fullTupleHash:hashVerificationTuple(review.tuple),deadline:review.deadline});}
 function requestId(value:unknown):asserts value is string{if(typeof value!=='string'||!value||Buffer.byteLength(value)>160||/[\x00-\x1f\x7f]/.test(value))throw Error('publication_request_identity');}
 function requestKey(who:ControllerPeer){return json(principal(who));}
 function requestRow(id:string,who:ControllerPeer){return db.prepare('SELECT request_json,challenge_id FROM publication_prepare_requests WHERE principal_key=? AND request_id=?').get(requestKey(who),id) as {request_json:string;challenge_id:string}|undefined;}
 function requestTomb(id:string,who:ControllerPeer){return db.prepare('SELECT request_json FROM publication_request_tombstones WHERE principal_key=? AND request_id=?').get(requestKey(who),id) as {request_json:string}|undefined;}
 function requestCapacity(){const n=(db.prepare('SELECT (SELECT count(*) FROM publication_prepare_requests)+(SELECT count(*) FROM publication_request_tombstones) n').get() as {n:number}).n;if(n>=4096)throw Error('publication_request_capacity');}
 function prepareRequest(raw:unknown,rawPeer:ControllerPeer){const p=shape(raw,['ownerKind','ownerId','requestSource','requestId']);requestId(p.requestId);return prepare({ownerKind:p.ownerKind,ownerId:p.ownerId,requestSource:p.requestSource},rawPeer,{requestId:p.requestId,requestJson:json(p)});}
 function lookupRequest(raw:unknown,rawPeer:ControllerPeer){current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');const p=shape(raw,['requestId']),who=peer(rawPeer);requestId(p.requestId);if(requestTomb(p.requestId,who))return Object.freeze({state:'not_prepared' as const});const original=requestRow(p.requestId,who);if(!original)return Object.freeze({state:'absent' as const});const initial=load(original.challenge_id,who);return runVerificationTransaction(db,()=>{const row=requestRow(p.requestId,who);if(!row||json(row)!==json(original))throw Error('publication_request_changed');return Object.freeze({state:'prepared' as const,challenge:challenge(load(row.challenge_id,who,initial.open).review)});});}
 function recoverUnapproved(raw:unknown,rawPeer:ControllerPeer){current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');const p=shape(raw,['challengeId']),who=peer(rawPeer),initial=load(p.challengeId,who);return runVerificationTransaction(db,()=>recoverInTransaction(p.challengeId,who,initial.open));}
 function recoverInTransaction(id:unknown,who:ControllerPeer,open:ReturnType<typeof opened>){if(!db.inTransaction)throw Error('publication_recovery_transaction');
  const {row,review}=load(id,who,open),t=review.tuple,h=hashVerificationTuple(t),key=json(ownerOf(t));
  const decision=db.prepare('SELECT tuple_hash,tuple_json,owner_key FROM settlement_decisions WHERE operation_id=?').get(t.operationId) as {tuple_hash:string;tuple_json:string;owner_key:string}|undefined;
  const journal=db.prepare('SELECT tuple_hash,tuple_json,owner_key FROM publication_journal WHERE operation_id=?').get(t.operationId) as {tuple_hash:string;tuple_json:string;owner_key:string}|undefined;
  const result={owner:ownerOf(t),challengeId:review.challengeId,operationId:t.operationId,fullTupleHash:h};
  if(decision||journal){if(!decision||!journal||[decision,journal].some(r=>r.tuple_hash!==h||r.tuple_json!==json(t))||decision.owner_key!==key||journal.owner_key!==json([t.profileId,t.ownerKind,t.ownerId,t.migrationEpoch])||row.state==='not_approved')throw Error('publication_operation_settlement');return Object.freeze({status:'settlement_exists' as const,...result});}
  if(!['prepared','authorizing','approved','unknown','not_approved'].includes(row.state))throw Error('publication_operation_state');
  if(row.state!=='not_approved'&&db.prepare("UPDATE publication_operations SET state='not_approved' WHERE id=? AND state=? AND review_json=?").run(row.id,row.state,row.review_json).changes!==1)throw Error('publication_operation_consumed');
  load(id,who,open);return Object.freeze({status:'not_approved' as const,...result});
 }
 function recoverRequest(raw:unknown,rawPeer:ControllerPeer){
  current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');const p=shape(raw,['ownerKind','ownerId','requestSource','requestId']),who=peer(rawPeer);requestId(p.requestId);if(!['user','agent','scheduler'].includes(p.requestSource))throw Error('publication_operation_source');const encoded=json(p),open=opened({ownerKind:p.ownerKind,ownerId:p.ownerId},who);
  return runVerificationTransaction(db,()=>{const tomb=requestTomb(p.requestId,who),existing=requestRow(p.requestId,who);if(tomb){if(tomb.request_json!==encoded||existing)throw Error('publication_request_changed');return Object.freeze({status:'not_prepared' as const});}
   if(existing){if(existing.request_json!==encoded)throw Error('publication_request_changed');const original=load(existing.challenge_id,who,open);return Object.freeze({...recoverInTransaction(existing.challenge_id,who,open),challenge:challenge(original.review)});}
   invoke('completion.inspect',{owner:open.owner,readGrant:open.readGrant},who);requestCapacity();assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(encoded)+2048});db.prepare('INSERT INTO publication_request_tombstones VALUES(?,?,?)').run(requestKey(who),p.requestId,encoded);return Object.freeze({status:'not_prepared' as const});
  });
 }
 function prepare(raw:unknown,rawPeer:ControllerPeer,request?:{requestId:string;requestJson:string}){
  current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');const p=shape(raw,['ownerKind','ownerId','requestSource']),who=peer(rawPeer);if(!['user','agent','scheduler'].includes(p.requestSource))throw Error('publication_operation_source');
  const open=opened({ownerKind:p.ownerKind,ownerId:p.ownerId},who);
  return runVerificationTransaction(db,()=>{
   if(request){const tomb=requestTomb(request.requestId,who);if(tomb){if(tomb.request_json!==request.requestJson)throw Error('publication_request_changed');throw Error('publication_request_not_prepared');}const old=requestRow(request.requestId,who);if(old){if(old.request_json!==request.requestJson)throw Error('publication_request_changed');return challenge(load(old.challenge_id,who,open).review);}requestCapacity();}
   invoke('completion.inspect',{owner:open.owner,readGrant:open.readGrant},who);
   const principalFacts=principal(who),owner=open.owner,state=host.authorityService.inspectOwner(owner);
   if(!state||state.currentVerification!=='valid')throw Error('publication_operation_not_current');
   const payload=stagePayload(owner),dependencies=host.authorityService.getCurrentDependencies(owner),c=clock();let validUntil=c.lowerBound+300000;
   for(const d of dependencies){const proof=db.prepare('SELECT proof_json FROM verifier_proofs WHERE proof_id=?').get(d.proofId) as {proof_json:string}|undefined,scope=db.prepare('SELECT expires_at FROM verification_scopes WHERE owner_key=? AND scope_id=? AND revision=?').get(json(d.kind==='inherited'?d.originOwner:owner),d.requiredScopeId,d.scopeRevision) as {expires_at:number}|undefined;if(!proof||!scope||!Number.isSafeInteger(scope.expires_at))throw Error('publication_operation_proof');validUntil=Math.min(validUntil,JSON.parse(proof.proof_json).validUntil,scope.expires_at);}
   const id=randomUUID(),tuple=parseVerificationTuple({schemaVersion:1,...owner,migrationEpoch:state.migrationEpoch,expectedBusinessRevision:state.businessRevision,obligationSetRevision:state.obligationSetRevision,obligationSetHash:state.obligationSetHash,obligations:dependencies,operationId:randomUUID(),immutablePayloadHash:payload.immutablePayloadHash,receiverId:receiver.receiverId,receiverProtocolVersion:1,receiverInstanceEpoch:receiver.receiverInstanceEpoch,reservationId:randomUUID(),nonce:randomUUID(),notBefore:c.lowerBound,validUntil,clockDomainId:c.domainId,clockQualificationEpoch:c.qualificationEpoch});
   const review=parsePublicationOperationReview({version:1,purpose:'completion-publication',authorityId,challengeId:id,principal:{uid:principalFacts.uid,accountGeneration:principalFacts.accountGeneration,auditSessionId:principalFacts.auditSessionId},requestSource:p.requestSource,tuple,deadline:{domainId:c.domainId,qualificationEpoch:c.qualificationEpoch,notBefore:tuple.notBefore,validUntil:tuple.validUntil}});
   currentTuple(tuple,payload.payloadId);if(json(principal(who))!==json(principalFacts))throw Error('publication_operation_principal');
   if((db.prepare('SELECT COUNT(*) n FROM publication_operations').get() as {n:number}).n>=4096)throw Error('publication_operation_capacity');assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json(review))+8192});
   db.prepare("INSERT INTO publication_operations VALUES(?,?,?,?,'prepared',?,?,NULL)").run(id,json(owner),json(who),boot,json(review),payload.payloadId);if(request){assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(request.requestJson)+2048});db.prepare('INSERT INTO publication_prepare_requests VALUES(?,?,?,?)').run(requestKey(who),request.requestId,request.requestJson,id);}return challenge(review);
  });
 }
 async function approve(raw:unknown,rawPeer:ControllerPeer,signal:AbortSignal){
  current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');const p=shape(raw,['challengeId']),who=peer(rawPeer),active=AbortSignal.any([signal,lifetime.signal]);active.throwIfAborted();
  const initial=load(p.challengeId,who);
  const original=runVerificationTransaction(db,()=>{const loaded=load(p.challengeId,who,initial.open);if(loaded.row.boot!==boot||loaded.row.state!=='prepared')throw Error('publication_operation_consumed');currentTuple(loaded.review.tuple,loaded.row.payload_id);db.prepare("UPDATE publication_operations SET state='authorizing' WHERE id=?").run(p.challengeId);return loaded;});
  const {review}=original,t=review.tuple,owner=ownerOf(t);
  try{
   const receipt=JSON.parse(json(await approveNative(review,active)));active.throwIfAborted();
   const expected={version:1,purpose:'completion-publication',authorityId,challengeId:review.challengeId,uid:review.principal.uid,accountGeneration:review.principal.accountGeneration,auditSessionId:review.principal.auditSessionId,requestSource:review.requestSource,fullReviewHash:createHash('sha256').update(publicationReviewBytes(review)).digest('hex')};if(json(receipt)!==json(expected))throw Error('publication_operation_native_reply');
   const afterApproval=load(p.challengeId,who);
   runVerificationTransaction(db,()=>{const fresh=load(p.challengeId,who,afterApproval.open);if(fresh.row.state!=='authorizing'||fresh.row.boot!==boot||fresh.row.review_json!==json(review))throw Error('publication_operation_consumed');currentTuple(t,fresh.row.payload_id);active.throwIfAborted();assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json(receipt))+4096});db.prepare("UPDATE publication_operations SET state='approved',decision_json=? WHERE id=?").run(json(receipt),p.challengeId);});
   const mutation=(method:'completion.settle'|'completion.authorize')=>{active.throwIfAborted();if(load(p.challengeId,who).row.state==='not_approved')throw Error('publication_operation_not_approved');currentTuple(t,original.row.payload_id);const authorization=host.completionScopes.issueMutation({owner,peer:who,expiresAt:review.deadline.validUntil,method,tuple:t,requestSource:review.requestSource as Source});return invoke(method,{owner,tuple:t,authorization,requestSource:review.requestSource},who);};
   mutation('completion.settle');const open=opened(owner,who),binding=receiverRequest(review,open.readGrant,who);assertCurrentTuple(t);const captured=host.payloads.capture(original.row.payload_id,owner),body=captured.readBytes();if(createHash('sha256').update(body).digest('hex')!==t.immutablePayloadHash)throw Error('publication_operation_payload');active.throwIfAborted();
   const beforePublish=()=>{active.throwIfAborted();load(p.challengeId,who);assertCurrentTuple(t);captured.assertCurrent();};
   const staged=await upload({tuple:t,...binding},body,active,beforePublish);active.throwIfAborted();load(p.challengeId,who);accept(review,open.readGrant,who,staged.envelope);
   if(staged.envelope.payload.result.status!=='prepared')return outcome(review);
   mutation('completion.authorize');active.throwIfAborted();const committed=await send('commit',{tuple:t,...binding,expectedRevision:staged.envelope.payload.result.objectRevision},active,beforePublish);active.throwIfAborted();load(p.challengeId,who);accept(review,open.readGrant,who,committed.envelope);
   const result=outcome(review);db.prepare("UPDATE publication_operations SET state=? WHERE id=?").run(result.status==='committed'?'committed':result.status==='cancelled'?'cancelled':'unknown',p.challengeId);return result;
  }catch(error){try{db.prepare("UPDATE publication_operations SET state='unknown' WHERE id=? AND state NOT IN ('committed','cancelled','not_approved')").run(p.challengeId);}catch{/* Original durable facts remain; no replay. */}throw error;}
 }
 async function reconcile(raw:unknown,rawPeer:ControllerPeer,signal:AbortSignal){
  current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');const p=shape(raw,['challengeId']),who=peer(rawPeer),active=AbortSignal.any([signal,lifetime.signal]);active.throwIfAborted();const {review,open}=load(p.challengeId,who),binding=receiverRequest(review,open.readGrant,who);
  const reply=await send('query',{tuple:review.tuple,...binding},active);active.throwIfAborted();load(p.challengeId,who);accept(review,open.readGrant,who,reply.envelope);const result=outcome(review);if(result.status!=='unknown')db.prepare('UPDATE publication_operations SET state=? WHERE id=?').run(result.status,p.challengeId);return result;
 }
 async function observeOwner(raw:unknown,rawPeer:ControllerPeer,signal:AbortSignal){
  current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');
  const requested=shape(raw,['ownerKind','ownerId']),who=peer(rawPeer),active=AbortSignal.any([signal,lifetime.signal]);active.throwIfAborted();
  const originalPrincipal=principal(who),open=opened({ownerKind:requested.ownerKind,ownerId:requested.ownerId},who),key=json(open.owner);
  function readOwner(){current();active.throwIfAborted();if(json(principal(who))!==json(originalPrincipal))throw Error('publication_operation_principal');const fresh=opened(open.owner,who);if(json(fresh.owner)!==key)throw Error('publication_observation_owner');invoke('completion.inspect',{owner:fresh.owner,readGrant:fresh.readGrant},who);const state=host.authorityService.inspectOwner(fresh.owner);if(!state)throw Error('publication_observation_owner');return {open:fresh,state};}
  const initial=readOwner();
  const decisions=db.prepare("SELECT tuple_hash,tuple_json FROM settlement_decisions WHERE owner_key=? AND json_extract(tuple_json,'$.expectedBusinessRevision')=?").all(key,initial.state.businessRevision-1) as {tuple_hash:string;tuple_json:string}[];
  if(!decisions.length)return Object.freeze({owner:open.owner,businessRevision:initial.state.businessRevision,currentVerification:initial.state.currentVerification,publication:Object.freeze({status:'absent' as const})});
  if(decisions.length!==1)throw Error('publication_observation_ambiguous');
  const decision=decisions[0],tuple=parseVerificationTuple(JSON.parse(decision.tuple_json));if(hashVerificationTuple(tuple)!==decision.tuple_hash||json(ownerOf(tuple))!==key)throw Error('publication_observation_binding');
  const rows=db.prepare("SELECT * FROM publication_operations WHERE owner_key=? AND json_extract(review_json,'$.tuple.operationId')=?").all(key,tuple.operationId) as Row[];
  if(rows.length!==1)throw Error('publication_observation_operation');
  const review=parsePublicationOperationReview(JSON.parse(rows[0].review_json));
  if(review.authorityId!==authorityId||json(review.tuple)!==json(tuple)||review.principal.uid!==originalPrincipal.uid||review.principal.accountGeneration!==originalPrincipal.accountGeneration)throw Error('publication_observation_binding');
  outcome(review);const binding=receiverRequest(review,initial.open.readGrant,who);
  const reply=await send('query',{tuple,...binding},active,()=>{current();active.throwIfAborted();if(json(principal(who))!==json(originalPrincipal))throw Error('publication_operation_principal');});
  const fresh=readOwner();if(fresh.state.businessRevision!==initial.state.businessRevision)throw Error('publication_observation_changed');
  accept(review,fresh.open.readGrant,who,reply.envelope);const result=outcome(review);
  const remote=reply.envelope.payload.result.status;
  if(result.status!=='unknown'&&remote!==result.status)throw Error('publication_observation_receiver_conflict');
  const isCurrent=result.status==='committed'&&fresh.state.currentVerification==='valid'&&fresh.state.migrationEpoch===tuple.migrationEpoch&&fresh.state.obligationSetRevision===tuple.obligationSetRevision&&fresh.state.obligationSetHash===tuple.obligationSetHash&&json(host.authorityService.getCurrentDependencies(fresh.open.owner))===json(tuple.obligations);
  return Object.freeze({owner:fresh.open.owner,businessRevision:fresh.state.businessRevision,currentVerification:fresh.state.currentVerification,publication:Object.freeze({status:result.status,current:isCurrent,operationId:tuple.operationId,fullTupleHash:decision.tuple_hash})});
 }
 async function observeIntentDependencies(raw:unknown,rawPeer:ControllerPeer,signal:AbortSignal,includeSelf=false){
  const p=shape(raw,['subject']),subject=parseIntentHostSubject(p.subject),who=peer(rawPeer);
  current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');
  const active=AbortSignal.any([signal,lifetime.signal]),originalPrincipal=json(principal(who));active.throwIfAborted();
  const original=host.enrollment.readIntentContract(subject,who),dependencies=intentContractDependencies({subject:original.subject,contract:original.contract}),owners=includeSelf?[intentHostSubjectOwner(original.subject),...dependencies]:dependencies,tuples:VerificationTuple[]=[];
  for(const owner of owners){
   active.throwIfAborted();const observed=await observeOwner(owner,who,active);
   if(observed.publication.status!=='committed'||!observed.publication.current)throw Error('publication_intent_set_not_current');
   const row=db.prepare('SELECT tuple_json FROM settlement_decisions WHERE operation_id=? AND owner_key=? AND tuple_hash=?').get(observed.publication.operationId,json(observed.owner),observed.publication.fullTupleHash) as {tuple_json:string}|undefined;
   if(!row)throw Error('publication_intent_set_changed');const tuple=parseVerificationTuple(JSON.parse(row.tuple_json));
   if(tuple.expectedBusinessRevision+1!==observed.businessRevision)throw Error('publication_intent_set_changed');tuples.push(tuple);
  }
  current();active.throwIfAborted();if(json(principal(who))!==originalPrincipal)throw Error('publication_operation_principal');
  return runVerificationTransaction(db,()=>withIntentSqlParsingContext(db,()=>{
   const registration=host.enrollment.readIntentContract(subject,who);if(json(registration)!==json(original))throw Error('publication_intent_set_registration');
   const fence=host.enrollment.captureRegistrationReadFence(registration.owner);
   const result=includeSelf?host.authorityHost.inspectIntentPublicationCompletion({registration,tuples}):host.authorityHost.inspectIntentPublicationDependencies({registration,tuples});
   fence();active.throwIfAborted();return result;
  }));
 }
 async function observeLoopSet(raw:unknown,rawPeer:ControllerPeer,signal:AbortSignal){
  const p=shape(raw,['owners']),who=peer(rawPeer);
  if(!Array.isArray(p.owners)||p.owners.length<1||p.owners.length>3)throw Error('publication_loop_set');
  const owners=p.owners.map((v:unknown)=>{const o=shape(v,['ownerKind','ownerId']);requestId(o.ownerId);if(o.ownerKind!=='loop')throw Error('publication_loop_set');return {ownerKind:'loop' as const,ownerId:o.ownerId as string};});
  if(new Set(owners.map((o:{ownerId:string})=>o.ownerId)).size!==owners.length)throw Error('publication_loop_set');
  current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');
  const active=AbortSignal.any([signal,lifetime.signal]),originalPrincipal=json(principal(who)),tuples:VerificationTuple[]=[];
  for(const owner of owners){
   active.throwIfAborted();const observed=await observeOwner(owner,who,active);
   if(observed.publication.status!=='committed'||!observed.publication.current)throw Error('publication_loop_set_not_current');
   const row=db.prepare('SELECT tuple_json FROM settlement_decisions WHERE operation_id=? AND owner_key=? AND tuple_hash=?').get(observed.publication.operationId,json(observed.owner),observed.publication.fullTupleHash) as {tuple_json:string}|undefined;
   if(!row)throw Error('publication_loop_set_changed');const tuple=parseVerificationTuple(JSON.parse(row.tuple_json));
   if(tuple.expectedBusinessRevision+1!==observed.businessRevision)throw Error('publication_loop_set_changed');tuples.push(tuple);
  }
  current();active.throwIfAborted();if(json(principal(who))!==originalPrincipal)throw Error('publication_operation_principal');
  // Return the complete DTO from the authoritative transaction. Never splice
  // applications or current flags from earlier per-owner network observations.
  return host.authorityHost.inspectLoopPublicationSet(tuples);
 }
 async function readOwnerPayload(raw:unknown,rawPeer:ControllerPeer,signal:AbortSignal){
  current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');
  const p=shape(raw,['ownerKind','ownerId','operationId','fullTupleHash','offset','maxBytes']),who=peer(rawPeer),originalPrincipal=principal(who),active=AbortSignal.any([signal,lifetime.signal]);
  if(typeof p.operationId!=='string'||!p.operationId||p.operationId.length>160||typeof p.fullTupleHash!=='string'||!/^[a-f0-9]{64}$/.test(p.fullTupleHash)||!Number.isSafeInteger(p.offset)||p.offset<0||!Number.isSafeInteger(p.maxBytes)||p.maxBytes<1||p.maxBytes>262144)throw Error('publication_payload_request');
  const observed=await observeOwner({ownerKind:p.ownerKind,ownerId:p.ownerId},who,active);
  if(observed.publication.status!=='committed'||!observed.publication.current||observed.publication.operationId!==p.operationId||observed.publication.fullTupleHash!==p.fullTupleHash)throw Error('publication_payload_not_current');
  const rows=db.prepare("SELECT * FROM publication_operations WHERE owner_key=? AND json_extract(review_json,'$.tuple.operationId')=?").all(json(observed.owner),p.operationId) as Row[];
  if(rows.length!==1)throw Error('publication_payload_binding');const row=rows[0],review=parsePublicationOperationReview(JSON.parse(row.review_json)),tuple=review.tuple;
  if(hashVerificationTuple(tuple)!==p.fullTupleHash||json(ownerOf(tuple))!==json(observed.owner)||tuple.expectedBusinessRevision+1!==observed.businessRevision)throw Error('publication_payload_binding');
  function check(){current();active.throwIfAborted();if(json(principal(who))!==json(originalPrincipal))throw Error('publication_operation_principal');const open=opened(observed.owner,who);if(json(open.owner)!==json(observed.owner))throw Error('publication_payload_binding');invoke('completion.inspect',{owner:open.owner,readGrant:open.readGrant},who);const actual=db.prepare('SELECT * FROM publication_operations WHERE id=?').get(row.id) as Row|undefined;if(!actual||actual.review_json!==row.review_json||actual.payload_id!==row.payload_id||actual.owner_key!==row.owner_key)throw Error('publication_payload_changed');}
  check();assertCurrentTuple(tuple);const captured=host.payloads.capture(row.payload_id,observed.owner),body=captured.readBytes();
  if(createHash('sha256').update(body).digest('hex')!==tuple.immutablePayloadHash)throw Error('publication_operation_payload');
  if(body.length>32*1024**2||p.offset>body.length)throw Error('publication_payload_bounds');
  const end=Math.min(body.length,p.offset+p.maxBytes),bytes=body.subarray(p.offset,end).toString('base64');
  assertCurrentTuple(tuple);captured.assertCurrent();check();const last=clock();if(last.domainId!==tuple.clockDomainId||last.qualificationEpoch!==tuple.clockQualificationEpoch||last.lowerBound<tuple.notBefore||last.upperBound>=tuple.validUntil)throw Error('publication_operation_not_current');
  return Object.freeze({owner:observed.owner,businessRevision:observed.businessRevision,operationId:tuple.operationId,fullTupleHash:p.fullTupleHash,payloadHash:tuple.immutablePayloadHash,totalBytes:body.length,offset:p.offset,bytes,eof:end===body.length});
 }
 async function recoverExpired(raw:unknown,rawPeer:ControllerPeer,signal:AbortSignal){
  current();if(db.inTransaction)throw Error('publication_operation_outer_transaction');
  const p=shape(raw,['challengeId']),who=peer(rawPeer),active=AbortSignal.any([signal,lifetime.signal]);active.throwIfAborted();
  const {review,open}=load(p.challengeId,who),t=review.tuple;
  // Settlement and journal creation share the original database transaction.
  // A missing/mismatched pair is corruption, never authority to invent a tuple.
  const decision=db.prepare('SELECT tuple_hash,tuple_json FROM settlement_decisions WHERE operation_id=? AND owner_key=?').get(t.operationId,json(ownerOf(t))) as {tuple_hash:string;tuple_json:string}|undefined;
  if(!decision||decision.tuple_hash!==hashVerificationTuple(t)||decision.tuple_json!==json(t))throw Error('publication_operation_settlement');
  outcome(review);
  const binding=receiverRequest(review,open.readGrant,who);
  const reply=await send('query',{tuple:t,...binding},active);active.throwIfAborted();load(p.challengeId,who);accept(review,open.readGrant,who,reply.envelope);
  let result=outcome(review);
  if(result.status==='unknown'){
   const c=clock();if(c.domainId!==t.clockDomainId||c.qualificationEpoch!==t.clockQualificationEpoch||c.lowerBound<t.validUntil)throw Error('publication_operation_not_expired');
   // Recheck identity after the query await and immediately before cancellation.
   const fresh=load(p.challengeId,who),cancelBinding=receiverRequest(review,fresh.open.readGrant,who);active.throwIfAborted();
   const cancelled=await send('cancel',{tuple:t,...cancelBinding},active,()=>{active.throwIfAborted();load(p.challengeId,who);const freshClock=clock();if(freshClock.domainId!==t.clockDomainId||freshClock.qualificationEpoch!==t.clockQualificationEpoch||freshClock.lowerBound<t.validUntil)throw Error('publication_operation_not_expired');});active.throwIfAborted();load(p.challengeId,who);accept(review,fresh.open.readGrant,who,cancelled.envelope);
   result=outcome(review);
  }
  if(result.status!=='unknown')db.prepare('UPDATE publication_operations SET state=? WHERE id=?').run(result.status,p.challengeId);
  return result;
 }
 function track<T>(work:Promise<T>){pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}
 return Object.freeze({observeIntentCompletion(raw:unknown,p:ControllerPeer,signal:AbortSignal){return track(observeIntentDependencies(raw,p,signal,true));},observeIntentDependencies(raw:unknown,p:ControllerPeer,signal:AbortSignal){return track(observeIntentDependencies(raw,p,signal));},observeLoopSet(raw:unknown,p:ControllerPeer,signal:AbortSignal){return track(observeLoopSet(raw,p,signal));},prepare: (raw:unknown,p:ControllerPeer)=>prepare(raw,p),prepareRequest,lookupRequest,recoverRequest,recoverUnapproved,readOwnerPayload(raw:unknown,p:ControllerPeer,signal:AbortSignal){return track(readOwnerPayload(raw,p,signal));},observeOwner(raw:unknown,p:ControllerPeer,signal:AbortSignal){return track(observeOwner(raw,p,signal));},recoverExpired(raw:unknown,p:ControllerPeer,signal:AbortSignal){return track(recoverExpired(raw,p,signal));},approve(raw:unknown,p:ControllerPeer,signal:AbortSignal){return track(approve(raw,p,signal));},reconcile(raw:unknown,p:ControllerPeer,signal:AbortSignal){return track(reconcile(raw,p,signal));},close(){if(!closing){closing=Promise.resolve().then(async()=>{await Promise.allSettled([...pending]);});closed=true;lifetime.abort();}return closing;}});
}
