import {parseMaterialPrepareRequest,parseMaterialRequestQuery,parseMaterialRequestObservation,parseMaterialPrepareResult,type MaterialRequestObservation} from './material-request.js';
import {readDockerReservationHandoff} from '../isolated-execution/docker-runner.js';
import type {QuiescenceExpectation} from '../isolated-execution/physical-quiescence.js';
import {readBrokerStagingCapacitySource} from '../isolated-execution/broker-staging.js';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import type {ControllerPeer} from './controller-public-daemon.js';
import type {ReceiverClockEvidence} from './receiver-store.js';
import {parseValidationMaterialDraft,type ValidationMaterialReview,type PrivateMaterialHandle,type ValidationMaterialInvocation} from './product-material-authorization.js';
import {freezeMaterialDeadline,assertMaterialDeadline,type MaterialDeadline} from './material-deadline.js';
import {canonicalVerificationJson} from './protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from './storage-budget.js';
import type {HostIssuedMountPlan} from '../isolated-execution/execution-port.js';
const materialAuthorities=new WeakMap<object,{database:Database;read(grant:object):{ownerKey:string;peer:ControllerPeer;review:ValidationMaterialReview;executableFiles:Array<{path:string;executable:boolean}>}}>();
export function readMaterialAuthorityCapacityFacts(authority:object,grant:object,database:Database){const known=materialAuthorities.get(authority);if(!known||known.database!==database)throw Error('material_capacity_authority');return known.read(grant);}
export type MaterialMountPlanHandoffFacts = {readonly authorizationId:string;readonly handoffId:string;readonly ownerKey:string;readonly invocation:Readonly<ValidationMaterialInvocation>;readonly scopeDigest:string;readonly resourceId:string} & ({readonly state:'claimed'}|{readonly state:'attached';readonly expected:Readonly<QuiescenceExpectation>});
const mountPlanHandoffs=new WeakMap<object,{authority:object;database:Database;read():Readonly<MaterialMountPlanHandoffFacts>;attach(transaction:object,expected:QuiescenceExpectation):void}>();
const attachedTickets=new WeakSet<object>();
/** A local handoff identity, not an attached consumer or physical cleanup receipt. */
export function readMaterialMountPlanHandoff(ticket:object,authority:object,database:Database):Readonly<MaterialMountPlanHandoffFacts>{const entry=mountPlanHandoffs.get(ticket);if(!entry||entry.authority!==authority||entry.database!==database)throw Error('material_handoff_ticket');return entry.read();}
/** Burn the original handoff ticket before any authority callback. */
export function attachMaterialMountPlanHandoff(ticket:object,authority:object,database:Database,transaction:object,expected:QuiescenceExpectation):void{
 const entry=mountPlanHandoffs.get(ticket);if(!entry||entry.authority!==authority||entry.database!==database||attachedTickets.has(ticket))throw Error('material_handoff_ticket');
 attachedTickets.add(ticket);entry.attach(transaction,expected);
}
function frozen<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const clone=<T>(value:T):T=>JSON.parse(canonicalVerificationJson(value));
function principal(peer:ControllerPeer){if(!peer||![peer.uid,peer.gid,peer.auditSessionId].every(Number.isSafeInteger)||peer.uid<1||peer.gid<0||peer.auditSessionId<1)throw Error('material_principal');return `kernel-session:v1:${peer.uid}:${peer.gid}:${peer.auditSessionId}`;}
interface RecordValue{request?:{requestId:string;challengeId:string};ownerKey:string;peer:ControllerPeer;principal:string;review:ValidationMaterialReview;deadline:MaterialDeadline;boot:string;executableFiles:Array<{path:string;executable:boolean}>}
/** Service-private composition, not an OS issuer on its own. Installed factory
 * supplies kernel peer, protected clock, caller-rights reads and native approval. */
export function createMaterialAuthority(options:{database:Database;engineBinding:{engineId:string;incarnation:string};clock():ReceiverClockEvidence;wallNow():number;resolveOwnerKey?(peer:ControllerPeer,invocation:ValidationMaterialInvocation):string;inspectFile(peer:ControllerPeer,file:{path:string;byteLimit:number},signal:AbortSignal):Promise<{sha256:string;size:number;executable:boolean}>;approve(peer:ControllerPeer,review:ValidationMaterialReview,signal:AbortSignal,deadline:Readonly<MaterialDeadline>):Promise<{reviewHash:string;uid:number;auditSessionId:number}>;stage(grant:object,review:ValidationMaterialReview,signal:AbortSignal):Promise<HostIssuedMountPlan>;acceptPlan(plan:HostIssuedMountPlan):void;discardPlan(plan:HostIssuedMountPlan):void}){
 const {database:db,clock,wallNow,inspectFile,approve,stage,acceptPlan,discardPlan}=options,resolveOwner=options.resolveOwnerKey??((peer:ControllerPeer,invocation:ValidationMaterialInvocation)=>principal(peer)+':'+invocation.sessionIdentity),engineBinding=Object.freeze(clone(options.engineBinding)),boot=randomUUID();
 const grants=new WeakMap<object,{id:string;record:RecordValue}>(),plans=new Map<string,{secretHash:string;principal:string;grant:object;plan:HostIssuedMountPlan;review:ValidationMaterialReview}>();
 db.exec('CREATE TABLE IF NOT EXISTS material_authority_challenges(id TEXT PRIMARY KEY,state TEXT NOT NULL,record_json TEXT NOT NULL,secret_hash TEXT)');
 db.exec('CREATE TABLE IF NOT EXISTS material_mount_plan_handoffs(authorization_id TEXT PRIMARY KEY,handoff_id TEXT UNIQUE NOT NULL,record_json TEXT NOT NULL,state TEXT NOT NULL)');
 db.exec("CREATE UNIQUE INDEX IF NOT EXISTS material_handoff_one_execution ON material_mount_plan_handoffs(json_extract(record_json,'$.expected.executionIdentity')) WHERE state='attached'");
 db.exec('CREATE TABLE IF NOT EXISTS material_authority_requests(request_id TEXT NOT NULL,principal TEXT NOT NULL,owner_key TEXT NOT NULL,invocation_json TEXT NOT NULL,draft_json TEXT,challenge_id TEXT UNIQUE,state TEXT NOT NULL,PRIMARY KEY(principal,request_id))');
 function ownerKey(peer:ControllerPeer,invocation:ValidationMaterialInvocation){const value=resolveOwner(peer,invocation);if(typeof value!=='string'||!value||Buffer.byteLength(value)>1024){void Promise.resolve(value).catch(()=>{});throw Error('material_owner');}return value;}
 function check(record:RecordValue){if(record.ownerKey!==ownerKey(record.peer,record.review.invocation))throw Error('material_owner');if(record.boot!==boot||canonicalVerificationJson(record.review.engineBinding)!==canonicalVerificationJson(engineBinding))throw Error('material_authority_epoch');assertMaterialDeadline(record.deadline,{wallNow:wallNow(),clock:clock()});if(record.request){const row=requestRow(record.principal,record.request.requestId);const {scopeDigest:_,engineBinding:__,...reviewDraft}=record.review;const draftJson=canonicalVerificationJson({...reviewDraft,materials:reviewDraft.materials.map(({path,byteLimit})=>({path,byteLimit}))});if(!row||row.draft_json!==draftJson||row.challenge_id!==record.request.challengeId||row.owner_key!==record.ownerKey||row.invocation_json!==canonicalVerificationJson(record.review.invocation))throw Error('material_request_changed');if(['retired','not_prepared'].includes(row.state))throw Error('material_request_retired');if(!['preparing','mapped'].includes(row.state))throw Error('material_request_changed');}}
 function read(id:string,peer:ControllerPeer){if(typeof id!=='string'||id.length>160)throw Error('material_handle');const row=db.prepare('SELECT * FROM material_authority_challenges WHERE id=?').get(id) as {state:string;record_json:string;secret_hash:string|null}|undefined;if(!row)throw Error('material_handle');const record=JSON.parse(row.record_json) as RecordValue;if(record.principal!==principal(peer))throw Error('material_principal');check(record);assertRequestActive(id);return{row,record};}
 function retireExpired(){
  const now=wallNow(),sample=clock();
  for(const row of db.prepare("SELECT id,record_json FROM material_authority_challenges WHERE state IN ('prepared','authorizing','authorized','staging','staged')").all() as {id:string;record_json:string}[]){
   const record=JSON.parse(row.record_json) as RecordValue;
   let retire=record.boot!==boot;
   if(!retire){try{assertMaterialDeadline(record.deadline,{wallNow:now,clock:sample});}catch(error){if((error as Error).message!=='material_deadline_expired'&&(error as Error).message!=='material_deadline_domain')throw error;retire=true;}}
   // This retires an authorization only. It never refunds stored bytes or
   // claims an in-flight execution quiescent.
   if(retire)db.prepare("UPDATE material_authority_challenges SET state='expired' WHERE id=?").run(row.id);
  }
  // These are one-use authorization tickets, not execution or storage records.
  // Missing ids always reject; deleting a retired ticket cannot recreate a grant.
  // Durable staging scope/byte reservations and execution journals remain intact.
  db.prepare("DELETE FROM material_authority_challenges WHERE state IN ('expired','revoked','failed') AND id NOT IN (SELECT challenge_id FROM material_authority_requests WHERE challenge_id IS NOT NULL)").run();
  for(const [id,plan] of plans){const known=grants.get(plan.grant);if(!known||!db.prepare("SELECT 1 FROM material_authority_challenges WHERE id=? AND state IN ('staging','staged')").get(known.id))plans.delete(id);}
 }
 function assertGrant(grant:object){const known=grants.get(grant);if(!known)throw Error('material_grant');check(known.record);assertRequestActive(known.id);const row=db.prepare('SELECT state FROM material_authority_challenges WHERE id=?').get(known.id) as {state:string}|undefined;if(!row||!['staging','staged'].includes(row.state))throw Error('material_grant');return known;}
 type HandoffRow={authorization_id:string;handoff_id:string;record_json:string;state:string};
 function handoffRow(id:string){return db.prepare('SELECT * FROM material_mount_plan_handoffs WHERE authorization_id=?').get(id) as HandoffRow|undefined;}
 function executionSnapshot(expected:QuiescenceExpectation,original:RecordValue,staging:{manifest:unknown;allocation:{engineBinding:unknown}}){
  if(!expected||Object.keys(expected).sort().join(',')!=='compoundOperationId,executionIdentity,scopeDigest,sessionIdentity,validationInvocationId'||Object.values(expected).some(v=>typeof v!=='string'||!v||v.length>160))throw Error('material_handoff_execution');
  const resources=db.prepare('SELECT * FROM docker_runner_resources WHERE execution_id=?').get(expected.executionIdentity) as {resources_json:string}|undefined;
  const execution=db.prepare('SELECT * FROM execution_attempts WHERE execution_id=?').get(expected.executionIdentity) as {session_id:string;operation_id:string;proposal_json:string}|undefined;
  if(!resources||!execution)throw Error('material_handoff_execution');const raw=JSON.parse(resources.resources_json),proposal=JSON.parse(execution.proposal_json);
  if(raw.ownerKey!==original.ownerKey||canonicalVerificationJson(raw.expected)!==canonicalVerificationJson(expected)||canonicalVerificationJson(raw.command)!==canonicalVerificationJson(original.review.exactCommand)
   ||expected.scopeDigest!==original.review.scopeDigest||canonicalVerificationJson({sessionIdentity:expected.sessionIdentity,compoundOperationId:expected.compoundOperationId,validationInvocationId:expected.validationInvocationId})!==canonicalVerificationJson(original.review.invocation)
   ||execution.session_id!==expected.sessionIdentity||execution.operation_id!==expected.compoundOperationId
   ||proposal.sessionIdentity!==expected.sessionIdentity||proposal.compoundOperationId!==expected.compoundOperationId||proposal.validationInvocationId!==expected.validationInvocationId||proposal.scopeDigest!==expected.scopeDigest
   ||proposal.commandDigest!==hash(canonicalVerificationJson(original.review.exactCommand))||proposal.materializationDigest!==hash(canonicalVerificationJson(staging.manifest))
   ||canonicalVerificationJson({engineId:raw.engine?.engineId,incarnation:raw.engine?.incarnation})!==canonicalVerificationJson(staging.allocation.engineBinding)
   ||proposal.engineBindingId!==raw.engine.engineId||proposal.engineEpoch!==raw.engine.epoch||proposal.imageId!==raw.imageId)throw Error('material_handoff_execution');
  return canonicalVerificationJson({resources,execution});
 }
 function inspectHandoff(raw:{authorizationId:string},rawPeer:ControllerPeer):Readonly<MaterialMountPlanHandoffFacts>|Readonly<{state:'unclaimed';authorizationId:string}>{
  const query=clone(raw),peer=clone(rawPeer),who=principal(peer);
  if(!query||Object.keys(query).join(',')!=='authorizationId'||typeof query.authorizationId!=='string'||!query.authorizationId||query.authorizationId.length>160)throw Error('material_handoff_input');
  const row=handoffRow(query.authorizationId);
  if(!row){
   const challenge=db.prepare('SELECT record_json FROM material_authority_challenges WHERE id=?').get(query.authorizationId) as {record_json:string}|undefined;
   if(!challenge)throw Error('material_handoff_unknown');const original=JSON.parse(challenge.record_json) as RecordValue;
   if(original.principal!==who||principal(original.peer)!==who||ownerKey(peer,original.review.invocation)!==original.ownerKey)throw Error('material_handoff_owner');
   if(handoffRow(query.authorizationId)||canonicalVerificationJson(db.prepare('SELECT record_json FROM material_authority_challenges WHERE id=?').get(query.authorizationId))!==canonicalVerificationJson(challenge))throw Error('material_handoff_changed');
   return Object.freeze({state:'unclaimed',authorizationId:query.authorizationId});
  }
  const value=JSON.parse(row.record_json),original=value.authorization as RecordValue;
  if(!['claimed','attached'].includes(row.state)||row.authorization_id!==query.authorizationId||typeof row.handoff_id!=='string'||!/^[a-f0-9-]{36}$/.test(row.handoff_id)
   ||!value||Object.keys(value).sort().join(',')!==(row.state==='attached'?'allocation,authorization,expected,resourceRecordHash':'allocation,authorization,resourceRecordHash')||typeof value.resourceRecordHash!=='string'||!/^[a-f0-9]{64}$/.test(value.resourceRecordHash)
   ||!original||original.principal!==who||principal(original.peer)!==who)throw Error('material_handoff_record');
  const allocation=value.allocation,resource=db.prepare('SELECT record_json,state,scope_digest FROM broker_staging_intents WHERE resource_id=?').get(allocation?.resourceId) as {record_json:string;state:string;scope_digest:string}|undefined;
  if(!resource||!['published','deleting','deleted'].includes(resource.state)||hash(resource.record_json)!==value.resourceRecordHash)throw Error('material_handoff_resource');
  const stored=JSON.parse(resource.record_json);
  if(canonicalVerificationJson(stored.allocation)!==canonicalVerificationJson(allocation)||allocation.ownerKey!==original.ownerKey||allocation.scopeDigest!==original.review.scopeDigest||resource.scope_digest!==allocation.scopeDigest
   ||canonicalVerificationJson(stored.manifest.invocation)!==canonicalVerificationJson(original.review.invocation)||canonicalVerificationJson(stored.manifest.command)!==canonicalVerificationJson(original.review.exactCommand))throw Error('material_handoff_resource');
  const execution=row.state==='attached'?executionSnapshot(value.expected,original,stored):null;
  const challenge=db.prepare('SELECT record_json FROM material_authority_challenges WHERE id=?').get(row.authorization_id) as {record_json:string}|undefined;
  if(challenge&&canonicalVerificationJson(JSON.parse(challenge.record_json))!==canonicalVerificationJson(original))throw Error('material_handoff_changed');
  if(ownerKey(peer,original.review.invocation)!==original.ownerKey)throw Error('material_handoff_owner');
  // Re-read after the only host callback; history is factual, not revived grant authority.
  if(canonicalVerificationJson(handoffRow(query.authorizationId))!==canonicalVerificationJson(row)
   ||canonicalVerificationJson(db.prepare('SELECT record_json,state,scope_digest FROM broker_staging_intents WHERE resource_id=?').get(allocation.resourceId))!==canonicalVerificationJson(resource)
   ||canonicalVerificationJson(db.prepare('SELECT record_json FROM material_authority_challenges WHERE id=?').get(row.authorization_id)??null)!==canonicalVerificationJson(challenge??null))throw Error('material_handoff_changed');
  if(execution!==null&&executionSnapshot(value.expected,original,stored)!==execution)throw Error('material_handoff_changed');
  const common={authorizationId:row.authorization_id,handoffId:row.handoff_id,ownerKey:original.ownerKey,invocation:clone(original.review.invocation),scopeDigest:allocation.scopeDigest,resourceId:allocation.resourceId};
  return row.state==='attached'?frozen({...common,state:'attached' as const,expected:clone(value.expected) as QuiescenceExpectation}):frozen({...common,state:'claimed' as const});
 }
 type RequestRow={request_id:string;principal:string;owner_key:string;invocation_json:string;draft_json:string|null;challenge_id:string|null;state:string};
 function requestRow(who:string,id:string){return db.prepare('SELECT * FROM material_authority_requests WHERE principal=? AND request_id=?').get(who,id) as RequestRow|undefined;}
 function assertRequestQuota(){const n=db.prepare('SELECT (SELECT COUNT(*) FROM material_authority_requests)+(SELECT COUNT(*) FROM material_authority_challenges WHERE id NOT IN (SELECT challenge_id FROM material_authority_requests WHERE challenge_id IS NOT NULL)) AS n').get() as {n:number};if(n.n>=4096)throw Error('material_request_limit');}
 function requestRetired(id:string){const row=db.prepare('SELECT state FROM material_authority_requests WHERE challenge_id=?').get(id) as {state:string}|undefined;return row?.state==='retired'||row?.state==='not_prepared';}
 function assertRequestActive(id:string){const row=db.prepare('SELECT state FROM material_authority_requests WHERE challenge_id=?').get(id) as {state:string}|undefined;if(row&&['retired','not_prepared'].includes(row.state))throw Error('material_request_retired');if(row&&row.state!=='mapped')throw Error('material_request_changed');}
 function assertPreparing(row:RequestRow){const current=requestRow(row.principal,row.request_id);if(current?.state==='retired'||current?.state==='not_prepared')throw Error('material_request_retired');if(row.state!=='preparing'||canonicalVerificationJson(current??null)!==canonicalVerificationJson(row))throw Error('material_request_changed');}
 function writeRequest(row:RequestRow,previous?:RequestRow){
  assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(canonicalVerificationJson(row))+4096});
  if(previous&&canonicalVerificationJson(requestRow(row.principal,row.request_id)??null)!==canonicalVerificationJson(previous))throw Error('material_request_changed');
  const result=previous?db.prepare('UPDATE material_authority_requests SET state=? WHERE principal=? AND request_id=? AND state=?').run(row.state,row.principal,row.request_id,previous.state):db.prepare('INSERT INTO material_authority_requests VALUES(?,?,?,?,?,?,?)').run(row.request_id,row.principal,row.owner_key,row.invocation_json,row.draft_json,row.challenge_id,row.state);
  if(result.changes!==1||canonicalVerificationJson(requestRow(row.principal,row.request_id)??null)!==canonicalVerificationJson(row))throw Error('material_request_commit');assertVerificationDatabaseBudget(db,{additionalBytes:0});
 }
 function requestFacts(row:RequestRow):MaterialRequestObservation{
  if(!['preparing','mapped','retired','not_prepared'].includes(row.state))throw Error('material_request_record');
  if(row.draft_json!==null){const draft=JSON.parse(row.draft_json);const parsed=parseMaterialPrepareRequest({requestId:row.request_id,requestSource:'user',draft});if(canonicalVerificationJson(parsed.draft)!==row.draft_json||canonicalVerificationJson(parsed.draft.invocation)!==row.invocation_json||!row.challenge_id)throw Error('material_request_record');}
  else if(row.state!=='not_prepared'||row.challenge_id!==null)throw Error('material_request_record');
  const challenge=row.challenge_id?db.prepare('SELECT * FROM material_authority_challenges WHERE id=?').get(row.challenge_id) as {state:string;record_json:string}|undefined:undefined;
  if(row.state==='mapped'&&!challenge)throw Error('material_request_record');
  let resources:Array<{resourceId:string;state:string}>=[];let handoff:MaterialMountPlanHandoffFacts|Readonly<{state:'unclaimed';authorizationId:string}>|undefined;
  if(challenge){const value=JSON.parse(challenge.record_json) as RecordValue;if(value.request?.requestId!==row.request_id||value.request?.challengeId!==row.challenge_id||value.ownerKey!==row.owner_key||value.principal!==row.principal||canonicalVerificationJson(value.review.invocation)!==row.invocation_json)throw Error('material_request_record');const draft=JSON.parse(row.draft_json!);const {scopeDigest,engineBinding:_,...review}=value.review;const original={...review,materials:review.materials.map(({path,byteLimit})=>({path,byteLimit}))};if(canonicalVerificationJson(original)!==canonicalVerificationJson(draft))throw Error('material_request_record');
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='broker_staging_intents'").get())resources=(db.prepare('SELECT resource_id AS resourceId,state FROM broker_staging_intents WHERE scope_digest=? ORDER BY resource_id').all(scopeDigest) as typeof resources);
   if(handoffRow(row.challenge_id!)){const inspected=inspectHandoff({authorizationId:row.challenge_id!},value.peer);if(inspected.state==='unclaimed')throw Error('material_request_changed');handoff=inspected;}
  }
  return parseMaterialRequestObservation({requestId:row.request_id,state:row.state as MaterialRequestObservation['state'],...(row.challenge_id?{challengeId:row.challenge_id}:{}),...(challenge?{challengePhase:challenge.state}:{}),resources,...(handoff?{handoff}:{})});
 }
 function requestVector(row:RequestRow|undefined){const id=row?.challenge_id;return canonicalVerificationJson({row:row??null,challenge:id?db.prepare('SELECT * FROM material_authority_challenges WHERE id=?').get(id)??null:null,handoff:id?handoffRow(id)??null:null,resources:db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='broker_staging_intents'").get()?db.prepare('SELECT * FROM broker_staging_intents ORDER BY resource_id').all():[]});}
 function checkedRequest(query:ReturnType<typeof parseMaterialRequestQuery>,peer:ControllerPeer){const who=principal(peer),row=requestRow(who,query.requestId),vector=requestVector(row),owner=ownerKey(peer,query.invocation);
  if(!row&&(db.prepare("SELECT 1 FROM material_authority_challenges WHERE json_extract(record_json,'$.principal')=? AND json_extract(record_json,'$.request.requestId')=?").get(who,query.requestId)
   ||db.prepare("SELECT 1 FROM material_mount_plan_handoffs WHERE json_extract(record_json,'$.authorization.principal')=? AND json_extract(record_json,'$.authorization.request.requestId')=?").get(who,query.requestId)))throw Error('material_request_changed');if(row&&(row.owner_key!==owner||row.invocation_json!==canonicalVerificationJson(query.invocation)))throw Error('material_request_binding');if(requestVector(requestRow(who,query.requestId))!==vector)throw Error('material_request_changed');return {who,owner,row};}
 function lookupMaterialRequest(raw:unknown,peerInput:ControllerPeer):MaterialRequestObservation{if(db.inTransaction)throw Error('material_outer_transaction');const query=parseMaterialRequestQuery(raw),peer=clone(peerInput),{who,row}=checkedRequest(query,peer),before=requestVector(row);const facts=row?requestFacts(row):frozen({requestId:query.requestId,state:'absent' as const});if(requestVector(requestRow(who,query.requestId))!==before)throw Error('material_request_changed');return facts;}
 function retireMaterialRequest(raw:unknown,peerInput:ControllerPeer):MaterialRequestObservation{if(db.inTransaction)throw Error('material_outer_transaction');const query=parseMaterialRequestQuery(raw,true),peer=clone(peerInput);return runVerificationTransaction(db,()=>{const {who,owner,row}=checkedRequest(query,peer);let final=row;if(!row){assertRequestQuota();final={request_id:query.requestId,principal:who,owner_key:owner,invocation_json:canonicalVerificationJson(query.invocation),draft_json:null,challenge_id:null,state:'not_prepared'};writeRequest(final);}else if(!['retired','not_prepared'].includes(row.state)){final={...row,state:'retired'};writeRequest(final,row);}const before=requestVector(final),facts=requestFacts(final!);if(requestVector(requestRow(who,query.requestId))!==before)throw Error('material_request_changed');return facts;});}
 async function prepareMaterialRequest(raw:unknown,peerInput:ControllerPeer,signal:AbortSignal){if(db.inTransaction)throw Error('material_outer_transaction');const input=parseMaterialPrepareRequest(raw),peer=clone(peerInput);signal.throwIfAborted();const result=runVerificationTransaction(db,()=>{const {who,owner,row}=checkedRequest({requestId:input.requestId,invocation:input.draft.invocation},peer);if(row){if(['retired','not_prepared'].includes(row.state))throw Error('material_request_retired');if(row.draft_json!==canonicalVerificationJson(input.draft))throw Error('material_request_binding');return {created:false,row};}parseValidationMaterialDraft(input.draft,wallNow());const refreshed=checkedRequest({requestId:input.requestId,invocation:input.draft.invocation},peer);if(refreshed.row||refreshed.owner!==owner)throw Error('material_request_changed');signal.throwIfAborted();assertRequestQuota();const next:RequestRow={request_id:input.requestId,principal:who,owner_key:owner,invocation_json:canonicalVerificationJson(input.draft.invocation),draft_json:canonicalVerificationJson(input.draft),challenge_id:randomUUID(),state:'preparing'};writeRequest(next);return {created:true,row:next};});
  if(!result.created)return parseMaterialPrepareResult({...lookupMaterialRequest({requestId:input.requestId,invocation:input.draft.invocation},peer),created:false});
  const challenge=await prepareOriginal(input.draft,peer,signal,result.row);signal.throwIfAborted();const facts=lookupMaterialRequest({requestId:input.requestId,invocation:input.draft.invocation},peer);signal.throwIfAborted();if(facts.state!=='mapped'||facts.challengePhase!=='prepared')throw Error('material_request_retired');return parseMaterialPrepareResult({...facts,...challenge,created:true});
 }
 async function prepareOriginal(raw:unknown,peerInput:ControllerPeer,signal:AbortSignal,request?:RequestRow){
   // The intent must commit before irreversible I/O; an enclosing transaction may roll back.
   if(db.inTransaction)throw Error('material_outer_transaction');
   signal.throwIfAborted();const peer=Object.freeze({...peerInput}),who=principal(peer),now=wallNow(),draft=parseValidationMaterialDraft(raw,now),deadline=freezeMaterialDeadline({requestedWallExpiry:draft.expiresAt,wallNow:now,clock:clock(),maximumLifetimeMs:300000});
   const materials:ValidationMaterialReview['materials']=[],executableFiles:Array<{path:string;executable:boolean}>=[];
   for(const item of draft.materials){signal.throwIfAborted();assertMaterialDeadline(deadline,{wallNow:wallNow(),clock:clock()});const facts=await inspectFile(peer,item,signal);if(!facts||!/^[a-f0-9]{64}$/.test(facts.sha256)||!Number.isSafeInteger(facts.size)||facts.size<0||facts.size>item.byteLimit||typeof facts.executable!=='boolean')throw Error('material_inspection');materials.push({...item,sha256:facts.sha256,size:facts.size});executableFiles.push({path:item.path,executable:facts.executable});}
   if(draft.editedFile&&materials.find(f=>f.path===draft.editedFile!.path)?.sha256!==draft.editedFile.afterHash)throw Error('material_edited_changed');
   const unsigned={...draft,materials,engineBinding},review:ValidationMaterialReview={...unsigned,scopeDigest:hash(canonicalVerificationJson({...unsigned,executableFiles}))};
   // Exactly the complete review must fit the native, nontruncated UI contract.
   if(Buffer.byteLength(canonicalVerificationJson(review).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')))>65536)throw Error('material_review_limit');
   const record:RecordValue={...(request?{request:{requestId:request.request_id,challengeId:request.challenge_id!}}:{}),ownerKey:ownerKey(peer,review.invocation),peer,principal:who,review,deadline,boot,executableFiles};check(record);signal.throwIfAborted();const id=request?.challenge_id??randomUUID(),json=canonicalVerificationJson(record);
   runVerificationTransaction(db,()=>{retireExpired();if(request){assertPreparing(request);if(record.ownerKey!==request.owner_key||canonicalVerificationJson(record.review.invocation)!==request.invocation_json)throw Error('material_request_binding');}else assertRequestQuota();const peerCount=db.prepare("SELECT COUNT(*) AS n FROM material_authority_challenges WHERE state IN ('prepared','authorizing','authorized','staging','staged') AND json_extract(record_json,'$.principal')=?").get(who) as {n:number};if(peerCount.n>=64)throw Error('material_principal_limit');const active=db.prepare("SELECT COUNT(*) AS n FROM material_authority_challenges WHERE state IN ('prepared','authorizing','authorized','staging','staged')").get() as {n:number};if(active.n>=4096)throw Error('material_active_limit');assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json)+4096});const inserted=db.prepare('INSERT INTO material_authority_challenges VALUES(?,?,?,NULL)').run(id,'prepared',json);if(inserted.changes!==1||canonicalVerificationJson(db.prepare('SELECT * FROM material_authority_challenges WHERE id=?').get(id))!==canonicalVerificationJson({id,state:'prepared',record_json:json,secret_hash:null}))throw Error('material_request_commit');if(request){assertPreparing(request);writeRequest({...request,state:'mapped'},request);}});
   return Object.freeze({challengeId:id,canonicalReview:clone(review)});
  }
 const api=Object.freeze({
  prepareRequest:prepareMaterialRequest,lookupRequest:lookupMaterialRequest,retireRequest:retireMaterialRequest,
  prepare(raw:unknown,peer:ControllerPeer,signal:AbortSignal){return prepareOriginal(raw,peer,signal);},
  async authorize(id:string,peerInput:ControllerPeer,signal:AbortSignal):Promise<PrivateMaterialHandle>{
   // The intent must commit before irreversible I/O; an enclosing transaction may roll back.
   if(db.inTransaction)throw Error('material_outer_transaction');
   const peer=Object.freeze({...peerInput});signal.throwIfAborted();const {record}=runVerificationTransaction(db,()=>{const value=read(id,peer);if(value.row.state!=='prepared')throw Error('material_challenge_consumed');db.prepare("UPDATE material_authority_challenges SET state='authorizing' WHERE id=?").run(id);return value;});
   try{const approved=await approve(peer,clone(record.review),signal,Object.freeze(clone(record.deadline)));signal.throwIfAborted();check(record);const expected=hash(canonicalVerificationJson(record.review).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));if(approved?.reviewHash!==expected||approved.uid!==peer.uid||approved.auditSessionId!==peer.auditSessionId)throw Error('material_approval_binding');const secret=randomBytes(32).toString('hex');runVerificationTransaction(db,()=>{check(record);assertRequestActive(id);const changed=db.prepare("UPDATE material_authority_challenges SET state='authorized',secret_hash=? WHERE id=? AND state='authorizing'").run(hash(secret),id);if(changed.changes!==1)throw Error('material_challenge_consumed');});return Object.freeze({id,secret});}
   catch(error){db.prepare("UPDATE material_authority_challenges SET state='failed' WHERE id=? AND state='authorizing'").run(id);throw error;}
  },
  async stage(input:{grantHandle:PrivateMaterialHandle;invocation:ValidationMaterialInvocation},peerInput:ControllerPeer,signal:AbortSignal){
   // The intent must commit before irreversible I/O; an enclosing transaction may roll back.
   if(db.inTransaction)throw Error('material_outer_transaction');
   const peer=Object.freeze({...peerInput}),value=clone(input);signal.throwIfAborted();const {record}=runVerificationTransaction(db,()=>{const result=read(value.grantHandle.id,peer);if(result.row.state!=='authorized'||typeof value.grantHandle.secret!=='string'||hash(value.grantHandle.secret)!==result.row.secret_hash||canonicalVerificationJson(value.invocation)!==canonicalVerificationJson(result.record.review.invocation))throw Error('material_grant');db.prepare("UPDATE material_authority_challenges SET state='staging' WHERE id=?").run(value.grantHandle.id);return result;});
   const grant=Object.freeze({});grants.set(grant,{id:value.grantHandle.id,record});
   let stagedPlan:HostIssuedMountPlan|undefined;
   const sync=(v:unknown)=>{if(v!==undefined){void Promise.resolve(v).catch(()=>{});throw Error('material_handoff_sync');}};
   try{const plan=stagedPlan=await stage(grant,clone(record.review),signal);signal.throwIfAborted();assertGrant(grant);const id=randomUUID(),secret=randomBytes(32).toString('hex');const changed=db.prepare("UPDATE material_authority_challenges SET state='staged' WHERE id=? AND state='staging'").run(value.grantHandle.id);if(changed.changes!==1)throw Error('material_challenge_consumed');sync(acceptPlan(plan));assertGrant(grant);plans.set(id,{secretHash:hash(secret),principal:principal(peer),grant,plan,review:record.review});return Object.freeze({mountPlanHandle:{id,secret},command:clone(record.review.exactCommand),scopeDigest:record.review.scopeDigest,invocation:clone(record.review.invocation)});}
   catch(error){db.prepare("UPDATE material_authority_challenges SET state='failed' WHERE id=? AND state IN ('staging','staged')").run(value.grantHandle.id);if(stagedPlan&&!requestRetired(value.grantHandle.id)){try{sync(discardPlan(stagedPlan));}catch(cleanupError){throw new AggregateError([error,cleanupError],'material_handoff_cleanup_unknown');}}throw error;}
  },
  consumeMountPlan(handle:PrivateMaterialHandle,peerInput:ControllerPeer){
   if(db.inTransaction)throw Error('material_outer_transaction');
   const input=clone(handle),peer=clone(peerInput),known=plans.get(input.id);
   if(!known||known.principal!==principal(peer)||hash(input.secret)!==known.secretHash)throw Error('material_plan');
   plans.delete(input.id); // Burn before callbacks and SQL; failure never restores this capability.
   const grant=assertGrant(known.grant),record=grant.record,allocation=clone(readBrokerStagingCapacitySource(known.plan,db));
   if(allocation.ownerKey!==record.ownerKey||allocation.scopeDigest!==record.review.scopeDigest)throw Error('material_handoff_resource');
   const id=randomUUID();
   const fact=runVerificationTransaction(db,()=>{
    assertGrant(known.grant);
    if(canonicalVerificationJson(readBrokerStagingCapacitySource(known.plan,db))!==canonicalVerificationJson(allocation))throw Error('material_handoff_resource');
    const resource=db.prepare('SELECT record_json,state FROM broker_staging_intents WHERE resource_id=?').get(allocation.resourceId) as {record_json:string;state:string}|undefined;
    if(!resource||resource.state!=='published')throw Error('material_handoff_resource');
    const encoded=canonicalVerificationJson({authorization:record,allocation,resourceRecordHash:hash(resource.record_json)});
    assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(encoded)+1024});
    const expected={authorization_id:grant.id,handoff_id:id,record_json:encoded,state:'claimed'};
    const written=db.prepare("INSERT INTO material_mount_plan_handoffs VALUES(?,?,?,'claimed')").run(grant.id,id,encoded);
    if(written.changes!==1||canonicalVerificationJson(handoffRow(grant.id))!==canonicalVerificationJson(expected))throw Error('material_handoff_commit');
    const result=inspectHandoff({authorizationId:grant.id},peer);
    if(result.state!=='claimed')throw Error('material_handoff_commit');
    return result;
   });
   const handoff=Object.freeze({});mountPlanHandoffs.set(handoff,{authority:api,database:db,read(){const current=inspectHandoff({authorizationId:grant.id},peer);if(current.state==='unclaimed'||current.handoffId!==fact.handoffId)throw Error('material_handoff_changed');return current;},attach(transaction,rawExpected){
    const expected=clone(rawExpected),source=readDockerReservationHandoff(transaction,db,expected);
    if(source.plan!==known.plan||source.ownerKey!==fact.ownerKey)throw Error('material_handoff_execution');
    const current=inspectHandoff({authorizationId:grant.id},peer);if(current.state!=='claimed'||canonicalVerificationJson(current)!==canonicalVerificationJson(fact))throw Error('material_handoff_changed');
    const before=handoffRow(grant.id)!;const encoded=canonicalVerificationJson({...JSON.parse(before.record_json),expected});
    assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(encoded)+1024});
    // This read has no host callbacks and requires a live same-DB private transaction.
    readDockerReservationHandoff(transaction,db,expected);
    const changed=db.prepare("UPDATE material_mount_plan_handoffs SET state='attached',record_json=? WHERE authorization_id=? AND handoff_id=? AND state='claimed' AND record_json=?").run(encoded,grant.id,id,before.record_json);
    if(changed.changes!==1||canonicalVerificationJson(handoffRow(grant.id))!==canonicalVerificationJson({...before,state:'attached',record_json:encoded}))throw Error('material_handoff_attach_commit');
    const after=inspectHandoff({authorizationId:grant.id},peer);if(after.state!=='attached'||canonicalVerificationJson(after.expected)!==canonicalVerificationJson(expected))throw Error('material_handoff_attach_commit');
    readDockerReservationHandoff(transaction,db,expected);
   }});
   return Object.freeze({plan:known.plan,review:clone(known.review),deadline:Object.freeze(clone(record.deadline)),handoff});
  },
  inspectMountPlanHandoff:inspectHandoff,
  /** Private cleanup gate: observed expiry is durably retired before it can
   * justify deletion. A later wall-clock rollback cannot revive this ticket. */
  assertScopeInactive(scopeDigest:string):void{if(db.inTransaction)throw Error('material_outer_transaction');if(!/^[a-f0-9]{64}$/.test(scopeDigest))throw Error('material_scope');runVerificationTransaction(db,()=>{
   for(const row of db.prepare('SELECT id,state,record_json FROM material_authority_challenges').all() as {id:string;state:string;record_json:string}[]){const record=JSON.parse(row.record_json) as RecordValue;if(!record.review||typeof record.review.scopeDigest!=='string')throw Error('material_record_unknown');if(record.review.scopeDigest!==scopeDigest)continue;
    if(['expired','revoked','failed'].includes(row.state))continue;
    if(!['prepared','authorizing','authorized','staging','staged'].includes(row.state))throw Error('material_record_unknown');
    let inactive=record.boot!==boot;if(!inactive){try{assertMaterialDeadline(record.deadline,{wallNow:wallNow(),clock:clock()});if(record.request){const row=requestRow(record.principal,record.request.requestId);const {scopeDigest:_,engineBinding:__,...reviewDraft}=record.review;const draftJson=canonicalVerificationJson({...reviewDraft,materials:reviewDraft.materials.map(({path,byteLimit})=>({path,byteLimit}))});if(!row||row.draft_json!==draftJson||row.challenge_id!==record.request.challengeId||row.owner_key!==record.ownerKey||row.invocation_json!==canonicalVerificationJson(record.review.invocation))throw Error('material_request_changed');if(['retired','not_prepared'].includes(row.state))throw Error('material_request_retired');if(!['preparing','mapped'].includes(row.state))throw Error('material_request_changed');}}catch(error){if(!['material_deadline_expired','material_deadline_domain'].includes((error as Error).message))throw error;inactive=true;}}
    if(!inactive)throw Error('material_scope_active');db.prepare("UPDATE material_authority_challenges SET state='expired' WHERE id=?").run(row.id);
   }
  });},
  assertGrant(grant:object):void{assertGrant(grant);},
  getGrantFacts(grant:object){const record=assertGrant(grant).record;return clone({ownerKey:record.ownerKey,peer:record.peer,review:record.review,executableFiles:record.executableFiles});},
  getGrantReview(grant:object){return clone(assertGrant(grant).record.review);},
  revoke(id:string,peer:ControllerPeer):void{if(db.inTransaction)throw Error('material_outer_transaction');runVerificationTransaction(db,()=>{read(id,peer);db.prepare("UPDATE material_authority_challenges SET state='revoked' WHERE id=?").run(id);});},
 });
 materialAuthorities.set(api,{database:db,read:api.getGrantFacts});return api;
}
