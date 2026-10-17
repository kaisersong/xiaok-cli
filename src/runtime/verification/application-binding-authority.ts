import {captureApplicationData} from './application-value-data.js';
import {assertIntentApplicationEnvelope} from './intent-application-binding.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import type {VerificationOwner} from './proof-authority.js';
import {assertVerificationCompletionCompositionDatabase,type createVerificationCompletionComposition} from './completion-composition.js';
import {parseApplicationBindingReview,applicationBindingReviewBytes,type ApplicationBindingReview} from './application-binding-review.js';
import {parseBusinessApplicationBinding,businessApplicationBindingHash,businessApplicationOwner,businessApplicationEpoch,sameBusinessApplicationSubject,type BusinessApplicationBinding} from './business-application-binding.js';
import type {ControllerPeer} from './controller-public-daemon.js';
import type {ReceiverClockEvidence} from './receiver-store.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from './storage-budget.js';
type Source='user'|'agent'|'scheduler';
type Principal=ControllerPeer&{accountGeneration:string;source:'macos-local-generateduid'};
interface Row{id:string;principal:string;boot:string;state:string;review_json:string;transition_id:string}
interface RequestRow {request_id:string;principal_json:string;binding_json:string;challenge_id:string|null}
type Phase='prepared'|'authorizing'|'approved'|'committed'|'failed'|'retired'|'not_approved';
interface RequestResult {state:'absent'|'not_prepared'|'not_approved'|'pending'|'reauthorization_required'|'registration_changed'|'committed';challengePhase?:Phase;challenge?:Readonly<{challengeId:string;canonicalReview:Readonly<ApplicationBindingReview>;alreadyCommitted:boolean}>;observation?:ReturnType<typeof inspectApplicationValue>}
function inspectApplicationValue(host:ReturnType<typeof createVerificationCompletionComposition>['privateHost'],db:Database,owner:Readonly<VerificationOwner>) {
 const value=host.authorityHost.inspectApplication(owner);let pendingTarget:Readonly<BusinessApplicationBinding>|null=null;
 if(value.pendingTransitionId){const row=db.prepare("SELECT binding_json FROM verification_application_transitions WHERE transition_id=? AND owner_key=? AND state='pending'").get(value.pendingTransitionId,json(owner)) as {binding_json:string}|undefined;if(!row)throw Error('application_operation_pending_target');pendingTarget=parseBusinessApplicationBinding(JSON.parse(row.binding_json));}
 return Object.freeze({...value,pendingTarget});
}
function shape(raw:unknown,keys:string[]):Record<string,any>{assertIntentApplicationEnvelope(raw);const value=JSON.parse(json(captureApplicationData(raw,{maximumBytes:1048576,maximumNodes:1048576,invalid:'application_operation_shape',limit:'application_operation_limit'})));if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw Error('application_operation_shape');return value;}
/** Native binding coordinator over the original completion database. A parsed
 * review or public observation never substitutes this private composition. */
export function createApplicationBindingAuthority(input:{database:Database;authorityId:string;completion:ReturnType<typeof createVerificationCompletionComposition>;clock():ReceiverClockEvidence;assertCurrent():void;resolvePrincipal(peer:ControllerPeer):Principal;approve(review:Readonly<ApplicationBindingReview>,signal:AbortSignal):Promise<{uid:number;auditSessionId:number;reviewHash:string}>}){
 const {database:db,authorityId,completion}=input,host=completion.privateHost;
 const readClock=input.clock.bind(input),resolve=input.resolvePrincipal.bind(input),native=input.approve.bind(input),assertCurrent=input.assertCurrent.bind(input);
 const boot=randomUUID(),lifetime=new AbortController();
 function current(){lifetime.signal.throwIfAborted();assertVerificationCompletionCompositionDatabase(completion,db);const result:unknown=assertCurrent();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('application_operation_sync');}}
 current();if(db.inTransaction)throw Error('application_operation_outer_transaction');
 db.exec(`CREATE TABLE IF NOT EXISTS goal_application_challenges(id TEXT PRIMARY KEY,principal TEXT NOT NULL,boot TEXT NOT NULL,state TEXT NOT NULL,review_json TEXT NOT NULL,transition_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS goal_application_requests(request_id TEXT PRIMARY KEY,principal_json TEXT NOT NULL,binding_json TEXT NOT NULL,challenge_id TEXT);
 CREATE TABLE IF NOT EXISTS goal_application_clock(domain_id TEXT NOT NULL,qualification_epoch INTEGER NOT NULL,last_lower INTEGER NOT NULL,PRIMARY KEY(domain_id,qualification_epoch));`);
 function peer(raw:ControllerPeer):ControllerPeer{const p=shape(raw,['uid','gid','auditSessionId']);if(![p.uid,p.gid,p.auditSessionId].every(n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff)||p.uid===0||p.auditSessionId===0)throw Error('application_operation_peer');return p as ControllerPeer;}
 function principal(p:ControllerPeer):Principal{const facts=shape(resolve(p),['uid','gid','auditSessionId','accountGeneration','source']);if(facts.uid!==p.uid||facts.gid!==p.gid||facts.auditSessionId!==p.auditSessionId||facts.source!=='macos-local-generateduid'||typeof facts.accountGeneration!=='string'||!/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(facts.accountGeneration))throw Error('application_operation_principal');return facts as Principal;}
 function clock(){current();const c=shape(readClock(),['domainId','qualificationEpoch','lowerBound','upperBound','evidenceHash']) as ReceiverClockEvidence;
  if(typeof c.domainId!=='string'||!c.domainId||Buffer.byteLength(c.domainId)>160||![c.qualificationEpoch,c.lowerBound,c.upperBound].every(n=>Number.isSafeInteger(n)&&n>=0)||c.upperBound<c.lowerBound||typeof c.evidenceHash!=='string'||!/^[a-f0-9]{64}$/.test(c.evidenceHash))throw Error('application_operation_clock');
  const before=db.prepare('SELECT last_lower FROM goal_application_clock WHERE domain_id=? AND qualification_epoch=?').get(c.domainId,c.qualificationEpoch) as {last_lower:number}|undefined;
  if(before&&c.lowerBound<before.last_lower)throw Error('application_operation_clock_regressed');
  db.prepare('INSERT INTO goal_application_clock VALUES(?,?,?) ON CONFLICT(domain_id,qualification_epoch) DO UPDATE SET last_lower=excluded.last_lower').run(c.domainId,c.qualificationEpoch,c.lowerBound);return c;
 }
 function originalRegistration(owner:Readonly<VerificationOwner>,p:ControllerPeer,binding:Readonly<BusinessApplicationBinding>){
  if(binding.kind==='goal')return host.enrollment.readApplicationRegistration(owner,p,binding.sessionId);
  if(binding.kind==='loop')return host.enrollment.readLoopApplicationRegistration(owner,p,binding.subject);
  const original=host.enrollment.readIntentApplicationRegistration(owner,p,binding.subject);
  if(original.contractHash!==binding.contractHash||json(original.contract)!==json(binding.contract))throw Error('application_operation_contract_changed');
  return original;
 }
 function approvedCurrent(review:Readonly<ApplicationBindingReview>,p:ControllerPeer){
  current();const facts=principal(p),c=clock(),d=review.deadline;
  if(review.authorityId!==authorityId||json(review.principal)!==json({uid:facts.uid,accountGeneration:facts.accountGeneration,auditSessionId:facts.auditSessionId}))throw Error('application_operation_principal');
  if(d.domainId!==c.domainId||d.qualificationEpoch!==c.qualificationEpoch||c.lowerBound<d.notBefore||c.upperBound>=d.validUntil)throw Error('application_operation_deadline');
  if(originalRegistration(review.owner,p,review.binding).registrationHash!==review.registrationHash)throw Error('application_operation_registration_changed');
 }
 function load(id:unknown,p:ControllerPeer){current();if(typeof id!=='string'||!id||id.length>160)throw Error('application_operation_id');const row=db.prepare('SELECT * FROM goal_application_challenges WHERE id=?').get(id) as Row|undefined;if(!row||row.principal!==json(p))throw Error('application_operation_principal');const review=parseApplicationBindingReview(JSON.parse(row.review_json));if(review.challengeId!==row.id)throw Error('application_operation_challenge');const facts=principal(p);if(json(review.principal)!==json({uid:facts.uid,accountGeneration:facts.accountGeneration,auditSessionId:facts.auditSessionId}))throw Error('application_operation_principal');return{row,review};}
 function assertRow(r:Row,state:string){const now=db.prepare('SELECT * FROM goal_application_challenges WHERE id=?').get(r.id);if(!now||json(now)!==json({...r,state}))throw Error('application_operation_consumed');}
 function finish(r:Row,review:Readonly<ApplicationBindingReview>,p:ControllerPeer){
  return runVerificationTransaction(db,()=>{
   const check=()=>{approvedCurrent(review,p);assertRow(r,'approved');};check();
   const result=host.authorityHost.finishApplicationTransition(review.owner,r.transition_id,check);
   if(result.state==='active'&&result.current?.bindingHash===review.bindingHash)db.prepare("UPDATE goal_application_challenges SET state='committed' WHERE id=? AND state='approved'").run(r.id);
   return result;
  });
 }
 function source(value:unknown){if(!['user','agent','scheduler'].includes(value as string))throw Error('application_operation_source');}
 function prepareContext(raw:{requestSource:Source;binding:Readonly<BusinessApplicationBinding>},rawPeer:ControllerPeer){
   current();if(db.inTransaction)throw Error('application_operation_outer_transaction');const request=shape(raw,['requestSource','binding']);if(request.requestSource!=='user')throw Error('application_operation_source');const p=peer(rawPeer),binding=parseBusinessApplicationBinding(request.binding);
   const open=host.enrollment.openOwner(businessApplicationOwner(binding),p),original=originalRegistration(open.owner,p,binding);
   return {p,binding,open,original};
 }
 function prepareKernel(context:ReturnType<typeof prepareContext>){
  const {p,binding,open,original}=context;

    const c=clock(),facts=principal(p),a=host.authorityHost.inspectApplication(open.owner),bindingHash=businessApplicationBindingHash(binding);
    if(a.current&&a.current.bindingHash===bindingHash&&a.state==='active'){
     const committed=db.prepare("SELECT * FROM goal_application_challenges WHERE state='committed' AND json_extract(review_json,'$.owner.profileId')=? AND json_extract(review_json,'$.owner.ownerKind')=? AND json_extract(review_json,'$.owner.ownerId')=? AND json_extract(review_json,'$.bindingHash')=? ORDER BY rowid DESC LIMIT 1").get(open.owner.profileId,open.owner.ownerKind,open.owner.ownerId,bindingHash) as Row|undefined;
     if(!committed)throw Error('application_operation_committed_record_missing');
     const originalReview=parseApplicationBindingReview(JSON.parse(committed.review_json));
     if(originalReview.registrationHash!==original.registrationHash)throw Error('application_operation_registration_changed');
     return Object.freeze({challengeId:committed.id,canonicalReview:originalReview,alreadyCommitted:true});
    }
    if(a.current&&(!sameBusinessApplicationSubject(a.current.binding,binding)||businessApplicationEpoch(binding)<=businessApplicationEpoch(a.current.binding)))throw Error('application_operation_epoch');
    let transitionId:string=randomUUID();
    if(a.pendingTransitionId){const target=db.prepare('SELECT binding_json,registration_hash,state FROM verification_application_transitions WHERE transition_id=? AND owner_key=?').get(a.pendingTransitionId,json(open.owner)) as {binding_json:string;registration_hash:string;state:string}|undefined;
     if(!target||target.state!=='pending'||target.binding_json!==json(binding)||target.registration_hash!==original.registrationHash)throw Error('application_operation_pending_target');transitionId=a.pendingTransitionId;}
    db.prepare("UPDATE goal_application_challenges SET state='retired' WHERE state IN ('prepared','authorizing') AND (boot<>? OR json_extract(review_json,'$.deadline.domainId')<>? OR json_extract(review_json,'$.deadline.qualificationEpoch')<>? OR json_extract(review_json,'$.deadline.validUntil')<=?)").run(boot,c.domainId,c.qualificationEpoch,c.lowerBound);
    if(db.prepare("SELECT 1 FROM goal_application_challenges WHERE state IN ('prepared','authorizing') AND json_extract(review_json,'$.owner.profileId')=? AND json_extract(review_json,'$.owner.ownerKind')=? AND json_extract(review_json,'$.owner.ownerId')=?").get(open.owner.profileId,open.owner.ownerKind,open.owner.ownerId))throw Error('application_operation_inflight');
    // Retired challenges grant nothing. Keep committed/approved history for exact restart lookup.
    db.prepare("DELETE FROM goal_application_challenges WHERE state IN ('retired','failed') AND NOT EXISTS (SELECT 1 FROM goal_application_requests WHERE challenge_id=goal_application_challenges.id)").run();
    assertRequestCapacity();
    const challengeId=randomUUID(),review=parseApplicationBindingReview({version:1,purpose:'completion-application-binding',authorityId,challengeId,principal:{uid:facts.uid,accountGeneration:facts.accountGeneration,auditSessionId:facts.auditSessionId},requestSource:'user',owner:open.owner,registrationHash:original.registrationHash,previousBindingHash:a.current?.bindingHash??null,binding,bindingHash,deadline:{domainId:c.domainId,qualificationEpoch:c.qualificationEpoch,notBefore:c.lowerBound,validUntil:c.lowerBound+300000}});
    approvedCurrent(review,p);assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json(review))+8192});
    db.prepare("INSERT INTO goal_application_challenges VALUES(?,?,?,'prepared',?,?)").run(challengeId,json(p),boot,json(review),transitionId);
    return Object.freeze({challengeId,canonicalReview:review,alreadyCommitted:false});

 }
 function assertRequestCapacity(){
  const count=db.prepare('SELECT (SELECT count(*) FROM goal_application_requests)+(SELECT count(*) FROM goal_application_challenges c WHERE NOT EXISTS(SELECT 1 FROM goal_application_requests r WHERE r.challenge_id=c.id)) n').get() as {n:number};
  if(count.n>=4096)throw Error('application_operation_capacity');
 }
 function requestContext(raw:{requestSource:Source;requestId:string;binding:Readonly<BusinessApplicationBinding>},rawPeer:ControllerPeer){
  current();if(db.inTransaction)throw Error('application_operation_outer_transaction');const value=shape(raw,['requestSource','requestId','binding']);source(value.requestSource);
  if(typeof value.requestId!=='string'||!value.requestId||Buffer.byteLength(value.requestId)>160||/[\x00-\x1f\x7f]/.test(value.requestId))throw Error('application_request_id');
  const p=peer(rawPeer),binding=parseBusinessApplicationBinding(value.binding),principalJson=json(principal(p));
  return {requestId:value.requestId as string,p,binding,principalJson,requestSource:value.requestSource as Source};
 }
 function readRequest(context:ReturnType<typeof requestContext>):RequestRow|undefined {
  current();if(json(principal(context.p))!==context.principalJson)throw Error('application_request_principal');
  const row=db.prepare('SELECT * FROM goal_application_requests WHERE request_id=?').get(context.requestId) as RequestRow|undefined;
  if(row&&(row.principal_json!==context.principalJson||row.binding_json!==json(context.binding)))throw Error('application_request_principal_or_binding');
  return row;
 }
 function requestChallenge(row:RequestRow,context:ReturnType<typeof requestContext>){
  if(!row.challenge_id)throw Error('application_request_not_prepared');
  const original=load(row.challenge_id,context.p);
  if(original.review.authorityId!==authorityId||json(original.review.binding)!==row.binding_json)throw Error('application_request_binding');
  if(!['prepared','authorizing','approved','committed','failed','retired','not_approved'].includes(original.row.state))throw Error('application_request_phase');
  return original;
 }
 function requestResult(row:RequestRow,context:ReturnType<typeof requestContext>,override?:RequestResult['state']):RequestResult {
  if(!row.challenge_id)return Object.freeze({state:'not_prepared'});
  const {row:challenge,review}=requestChallenge(row,context),phase=challenge.state as Phase;
  const state=override??(phase==='committed'?'committed':['not_approved','failed','retired'].includes(phase)?'not_approved':'pending');
  const result:RequestResult={state,challengePhase:phase,challenge:Object.freeze({challengeId:challenge.id,canonicalReview:review,alreadyCommitted:phase==='committed'})};
  if(state!=='not_approved')result.observation=inspectApplicationValue(host,db,review.owner);
  readRequest(context);return Object.freeze(result);
 }
 return Object.freeze({
  prepare(raw:{requestSource:Source;binding:Readonly<BusinessApplicationBinding>},rawPeer:ControllerPeer){
   const context=prepareContext(raw,rawPeer);return runVerificationTransaction(db,()=>prepareKernel(context));
  },
  prepareRequest(raw:{requestSource:Source;requestId:string;binding:Readonly<BusinessApplicationBinding>},rawPeer:ControllerPeer){
   const context=requestContext(raw,rawPeer);if(context.requestSource!=='user')throw Error('application_operation_source');
   const prepared=prepareContext({requestSource:'user',binding:context.binding},context.p);
   return runVerificationTransaction(db,()=>{
    const old=readRequest(context);
    if(old){const original=requestChallenge(old,context);if(['not_approved','failed','retired'].includes(original.row.state))throw Error('application_request_not_approved');return Object.freeze({created:false,challenge:Object.freeze({challengeId:original.row.id,canonicalReview:original.review,alreadyCommitted:original.row.state==='committed'})});}
    assertRequestCapacity();assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(context.principalJson)+Buffer.byteLength(json(context.binding))+8192});
    const challenge=prepareKernel(prepared);
    // A new request cannot borrow a different audit session's old challenge.
    load(challenge.challengeId,context.p);readRequest(context);
    db.prepare('INSERT INTO goal_application_requests VALUES(?,?,?,?)').run(context.requestId,context.principalJson,json(context.binding),challenge.challengeId);
    assertVerificationDatabaseBudget(db,{additionalBytes:0});
    return Object.freeze({created:true,challenge});
   });
  },
  lookupRequest(raw:{requestSource:Source;requestId:string;binding:Readonly<BusinessApplicationBinding>},rawPeer:ControllerPeer):RequestResult {
   const context=requestContext(raw,rawPeer);return runVerificationTransaction(db,()=>{const row=readRequest(context);return row?requestResult(row,context):Object.freeze({state:'absent'});});
  },
  recoverRequest(raw:{requestSource:Source;requestId:string;binding:Readonly<BusinessApplicationBinding>},rawPeer:ControllerPeer):RequestResult {
   const context=requestContext(raw,rawPeer);
   return runVerificationTransaction(db,()=>{
    const row=readRequest(context);
    if(!row){assertRequestCapacity();assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(context.principalJson)+Buffer.byteLength(json(context.binding))+4096});db.prepare('INSERT INTO goal_application_requests VALUES(?,?,?,NULL)').run(context.requestId,context.principalJson,json(context.binding));readRequest(context);return Object.freeze({state:'not_prepared'});}
    if(!row.challenge_id)return Object.freeze({state:'not_prepared'});
    const original=requestChallenge(row,context);
    if(original.row.state==='approved'){
     if(originalRegistration(original.review.owner,context.p,context.binding).registrationHash!==original.review.registrationHash)return requestResult(row,context,'registration_changed');
     try{finish(original.row,original.review,context.p);}catch(error){if(error instanceof Error&&error.message==='application_operation_deadline')return requestResult(row,context,'reauthorization_required');throw error;}
    }else if(original.row.state!=='committed'){
     db.prepare("UPDATE goal_application_challenges SET state='not_approved' WHERE id=? AND state IN ('prepared','authorizing','failed','retired')").run(original.row.id);
    }
    return requestResult(row,context);
   });
  },
  async authorize(raw:{requestSource:Source;challengeId:string},rawPeer:ControllerPeer,signal:AbortSignal){
   current();if(db.inTransaction)throw Error('application_operation_outer_transaction');const request=shape(raw,['requestSource','challengeId']);if(request.requestSource!=='user')throw Error('application_operation_source');const p=peer(rawPeer),active=AbortSignal.any([signal,lifetime.signal]);active.throwIfAborted();
   const {row,review}=runVerificationTransaction(db,()=>{const loaded=load(request.challengeId,p);if(loaded.row.boot!==boot||loaded.row.state!=='prepared')throw Error('application_operation_consumed');approvedCurrent(loaded.review,p);db.prepare("UPDATE goal_application_challenges SET state='authorizing' WHERE id=?").run(loaded.row.id);return loaded;});
   try{
    const reply=shape(await native(review,active),['uid','auditSessionId','reviewHash']);active.throwIfAborted();
    if(reply.uid!==p.uid||reply.auditSessionId!==p.auditSessionId||reply.reviewHash!==createHash('sha256').update(applicationBindingReviewBytes(review)).digest('hex'))throw Error('application_operation_native_reply');
    runVerificationTransaction(db,()=>{active.throwIfAborted();approvedCurrent(review,p);assertRow(row,'authorizing');
     host.authorityHost.beginApplicationTransition({owner:review.owner,transitionId:row.transition_id,previousBindingHash:review.previousBindingHash,binding:review.binding,registrationHash:review.registrationHash});
     approvedCurrent(review,p);db.prepare("UPDATE goal_application_challenges SET state='approved' WHERE id=? AND state='authorizing'").run(row.id);
    });
    return finish(row,review,p);
   }catch(error){if(!lifetime.signal.aborted)try{db.prepare("UPDATE goal_application_challenges SET state='failed' WHERE id=? AND state='authorizing'").run(row.id);}catch{/* Never make a consumed challenge reusable. */}throw error;}
  },
  inspect(raw:{ownerKind:'goal'|'loop'|'intent';ownerId:string},rawPeer:ControllerPeer){current();const request=shape(raw,['ownerKind','ownerId']);if(!['goal','loop','intent'].includes(request.ownerKind))throw Error('application_operation_owner');const p=peer(rawPeer),open=host.enrollment.openOwner(request as {ownerKind:'goal'|'loop'|'intent';ownerId:string},p),a=host.authorityHost.inspectApplication(open.owner);
   return inspectApplicationValue(host,db,open.owner);
  },
  reconcile(raw:{requestSource:Source;challengeId:string},rawPeer:ControllerPeer){current();if(db.inTransaction)throw Error('application_operation_outer_transaction');const request=shape(raw,['requestSource','challengeId']);source(request.requestSource);const p=peer(rawPeer),{row,review}=load(request.challengeId,p);originalRegistration(review.owner,p,review.binding);
   if(row.state==='committed')return host.authorityHost.inspectApplication(review.owner);
   if(row.state!=='approved')throw Error('application_operation_reauthorization_required');return finish(row,review,p);
  },
  close(){lifetime.abort();},
 });
}
