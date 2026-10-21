import {consumeExecutionCommandContext} from '../isolated-execution/docker-runner.js';
import type {ExecutionWriteContext} from './execution-command-dispatch.js';
import {types as nodeTypes} from 'node:util';
import {assertInstalledVerificationAssembly,assertInstalledVerificationCurrent,readInstalledVerificationClock,ensureInstalledVerificationQualification,recordInstalledVerificationResult,registerInstalledVerificationOutput} from './installed-controller.js';
import {assertPreparedProtectedSourceOwner,assertApprovedProtectedSourceReaderDatabase,assertPreparedProtectedSourceCurrent,bindPreparedProtectedSourceAttempt,type createApprovedProtectedSourceReader} from './approved-protected-source-reader.js';
import {parseVerificationOperationPrepareRequest,parseVerificationOperationRequestQuery,parseVerificationOperationRetireRequest,parseVerificationOperationRequestObservation,parseVerificationOperationTerminalResult,type VerificationOperationRequestQuery,type VerificationOperationRequestObservation} from './verification-operation-request.js';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import {assertVerificationCompletionDatabase,type createVerificationCompletionComposition} from './completion-composition.js';
import {assertControllerMaterialPipelineDatabase,type createControllerMaterialPipeline} from './material-pipeline.js';
import {assertDockerRunnerDatabase,readDockerReservationHandoff,type createDockerRunner} from '../isolated-execution/docker-runner.js';
import type {ControllerPeer} from './controller-public-daemon.js';
import type {VerificationOwner,MandatoryObligation} from './proof-authority.js';
import type {IndependentRecipeSpec,RecipeBinding} from './independent-recipes.js';
import type {ReceiverClockEvidence} from './receiver-store.js';
import type {MaterialDeadline} from './material-deadline.js';
import type {QuiescenceAuthority,QuiescenceExpectation,PhysicalQuiescenceReceipt} from '../isolated-execution/physical-quiescence.js';
import {assertProtectedRunLedgerDatabase,type createProtectedRunLedger} from './protected-run-ledger.js';
import {assertApprovedSourceCapabilitiesDatabase,type createApprovedSourceCapabilities} from './approved-source-capabilities.js';
import {MOUNTED_POLICY_SHA256} from '../isolated-execution/docker-volume-request.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {runVerificationTransaction,assertVerificationDatabaseBudget} from './storage-budget.js';
import {parseVerificationObligationQuery,parseVerificationObligationObservation} from './verification-obligation-observation.js';
type Host=ReturnType<typeof createVerificationCompletionComposition>['privateHost'];
const actualOperations=new WeakMap<object,{database:Database;completion:Host;assertCurrent():void}>();
const operationPreparationCommands=new WeakMap<object,{owner:ReturnType<typeof createApprovedVerificationOperations>;raw:object;database:Database}>();
export function inspectVerificationPreparationCommand(command:object,raw:object,database:Database):boolean{const facts=operationPreparationCommands.get(command);if(!facts)return false;if(facts.raw!==raw||facts.database!==database||!actualOperations.has(facts.owner))throw Error('verification_preparation_command_binding');return true;}
export function executeVerificationPreparationCommand(command:object,context:ExecutionWriteContext):boolean{const facts=operationPreparationCommands.get(command);if(!facts)return false;if(!actualOperations.has(facts.owner))throw Error('verification_preparation_command_binding');facts.owner.commitPreparedExecution(command,context);return true;}

export function assertApprovedVerificationOperationsDatabase(value:object,database:Database,completion:Host):void{const record=actualOperations.get(value);if(!record||record.database!==database||record.completion!==completion)throw Error('publication_verification_binding');record.assertCurrent();}
type Source='user'|'agent'|'scheduler';
type SubjectManifest=readonly {path:string;sha256:string;size:number;role:string}[];
export type OriginalVerificationSourceSubject=ReturnType<ReturnType<typeof createApprovedProtectedSourceReader>['prepareSubject']>;
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const clone=<T>(v:T):T=>JSON.parse(json(v));
type OperationScopeGuardIdentity={owner:VerificationOwner;scopeId:string;revision:number};
const operationScopeGuards=new WeakMap<object,{database:Database;materials:ReturnType<typeof createControllerMaterialPipeline>;completion:Host;plan:ReturnType<ReturnType<typeof createControllerMaterialPipeline>['consumeMountPlan']>['plan'];manifest:unknown;peer:ControllerPeer;scope:OperationScopeGuardIdentity;source?:OriginalVerificationSourceSubject}>();
/** Fixed original operation guard. No issuer or callback registration is public. */
export function assertApprovedOperationScopeGuard(guard:object,database:Database,scope:OperationScopeGuardIdentity):void{
 const fact=operationScopeGuards.get(guard);if(!fact)throw Error('verification_scope_guard_brand');if(fact.database!==database||json(fact.scope)!==json(scope))throw Error('verification_scope_guard_binding');
 const check=()=>{assertControllerMaterialPipelineDatabase(fact.materials,database);const manifest=fact.materials.stager.getManifest(fact.plan);if(json(manifest)!==json(fact.manifest)||fact.completion.enrollment.resolveOwnerKey(fact.peer,manifest.invocation)!==json(fact.scope.owner))throw Error('verification_operation_material_changed');};
 check();if(fact.source)assertPreparedProtectedSourceOwner(fact.source,database,fact.scope.owner);check();
}

function shape(raw:unknown,keys:string[]){const encoded=json(raw);if(Buffer.byteLength(encoded)>1024**2)throw Error('verification_operation_size');const value=JSON.parse(encoded);if(!value||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('verification_operation_shape');return value;}
function sync(v:unknown){if(v!==undefined){void Promise.resolve(v).catch(()=>{});throw Error('verification_operation_sync');}}
/** Private assembly only. Installed entry must supply its actual same-DB
 * enrollment, staged material, qualified runner and source-read authority. */
export function createApprovedVerificationOperations(input:{
 database:Database;runs:ReturnType<typeof createProtectedRunLedger>;capabilities:ReturnType<typeof createApprovedSourceCapabilities>;completion:Host;materials:ReturnType<typeof createControllerMaterialPipeline>;
 raw:ReturnType<typeof createDockerRunner>;quiescence:QuiescenceAuthority;imageId:string;verifierHash:string;
 assembly:object;
 sourceReader:ReturnType<typeof createApprovedProtectedSourceReader>;
}){
 const keys=['assembly','database','runs','capabilities','completion','materials','raw','quiescence','imageId','verifierHash','sourceReader'].sort();if(!input||nodeTypes.isProxy(input)||Object.getPrototypeOf(input)!==Object.prototype)throw Error('verification_operation_ports');const descriptors=Object.getOwnPropertyDescriptors(input);if(Object.keys(descriptors).sort().join(',')!==keys.join(',')||Reflect.ownKeys(input).length!==keys.length||Object.values(descriptors).some(d=>!('value' in d)))throw Error('verification_operation_ports');
 const {database:db,completion:host,materials,raw,quiescence,imageId,verifierHash,runs,capabilities}=input;
 if(!db||!host||!materials||!raw||!quiescence||!/^sha256:[a-f0-9]{64}$/.test(input.imageId)||!/^[a-f0-9]{64}$/.test(input.verifierHash))throw Error('verification_operation_ports');
 assertInstalledVerificationAssembly(input.assembly,db,input);
 assertVerificationCompletionDatabase(host,db,verifierHash);assertControllerMaterialPipelineDatabase(materials,db);assertDockerRunnerDatabase(raw,db,imageId);assertProtectedRunLedgerDatabase(runs,db);assertApprovedSourceCapabilitiesDatabase(capabilities,db);assertApprovedProtectedSourceReaderDatabase(input.sourceReader,db,{completion:host,capabilities,runs});
 const assembly=input.assembly,clock=()=>readInstalledVerificationClock(assembly),assertCurrent=()=>assertInstalledVerificationCurrent(assembly),qualify=(signal:AbortSignal)=>ensureInstalledVerificationQualification(assembly,signal),consume=materials.consumeMountPlan.bind(materials),manifestFor=materials.stager.getManifest.bind(materials.stager),sources=input.sourceReader.prepareSubject.bind(input.sourceReader),archive=(result:{expected:QuiescenceExpectation;output:object;receipt:PhysicalQuiescenceReceipt})=>recordInstalledVerificationResult(assembly,result),registerOutput=(result:{expected:QuiescenceExpectation;output:object;receipt:PhysicalQuiescenceReceipt})=>registerInstalledVerificationOutput(assembly,result);
 const boot=randomUUID(),lifetime=new AbortController();let preparing=false,closing:Promise<void>|undefined;
 type Run=ReturnType<typeof runs.beginRun>;
 type PreparationFacts={p:ReturnType<typeof shape>;peer:ControllerPeer;material:ReturnType<typeof consume>;signal2:AbortSignal;manifest:ReturnType<typeof manifestFor>;owner:VerificationOwner;recipe:IndependentRecipeSpec;key:string;ob:{definition_json:string;active_attempt:string|null;attempt_epoch:number};definition:MandatoryObligation;original?:OriginalVerificationSourceSubject;subjectManifest:SubjectManifest;sourceRunId:string;runNonce:string;expiresAt:number;start:ReturnType<typeof capabilities.issueStart>;id:string;secret:string;request?:RequestContext;uncommitted?:QuiescenceExpectation;run?:Run;result?:{binding:RecipeBinding;attemptEpoch:number;run:Run}};
 const preparationFacts=new Map<object,PreparationFacts>();

 const dispatching=new Map<string,{plan:ReturnType<typeof consume>['plan'];run:Run;signal:AbortSignal;binding:RecipeBinding}>();
 const active=new Set<Promise<unknown>>(),prepared=new Map<string,{plan:ReturnType<typeof consume>['plan'];binding:RecipeBinding;owner:VerificationOwner;recipe:IndependentRecipeSpec;expiresAt:number;run:Run;source?:OriginalVerificationSourceSubject}>();
 if(db.inTransaction)throw Error('verification_operation_outer_transaction');
 db.exec('CREATE TABLE IF NOT EXISTS verification_operations(id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,principal TEXT NOT NULL,secret_hash TEXT NOT NULL,boot TEXT NOT NULL,state TEXT NOT NULL,record_json TEXT NOT NULL)');
 runVerificationTransaction(db,()=>{db.prepare("UPDATE verification_operations SET state='unknown' WHERE state IN ('prepared','dispatching')").run();});
 db.exec('CREATE TABLE IF NOT EXISTS verification_prepare_requests(principal TEXT NOT NULL,request_id TEXT NOT NULL,query_json TEXT NOT NULL,request_json TEXT,state TEXT NOT NULL,operation_id TEXT UNIQUE,PRIMARY KEY(principal,request_id))');
 db.exec('CREATE TABLE IF NOT EXISTS verification_operation_results(operation_id TEXT PRIMARY KEY,operation_record_hash TEXT NOT NULL,result_json TEXT NOT NULL,result_hash TEXT NOT NULL,core_revision INTEGER NOT NULL,attempt_core_hash TEXT NOT NULL,proof_id TEXT,attempt_proof_hash TEXT)');
 function current(){lifetime.signal.throwIfAborted();sync(assertCurrent());}
 function ownerFor(peer:ControllerPeer,plan:ReturnType<typeof consume>['plan']){return JSON.parse(host.enrollment.resolveOwnerKey(peer,manifestFor(plan).invocation)) as VerificationOwner;}
 function inspectObligation(payload:unknown,peerInput:ControllerPeer){
  const request=parseVerificationObligationQuery(payload),peer=clone(peerInput);current();
  if(db.inTransaction)throw Error('verification_operation_outer_transaction');
  return runVerificationTransaction(db,()=>{
   const key=host.enrollment.resolveOwnerKey(peer,request.invocation),owner=JSON.parse(key) as VerificationOwner;
   const recipe=host.enrollment.readApprovedRecipe(owner,request.obligationId),compiled=host.recipes.compile(recipe);
   const application=host.authorityHost.inspectApplication(owner);
   current();
   if(host.enrollment.resolveOwnerKey(peer,request.invocation)!==key||json(host.enrollment.readApprovedRecipe(owner,request.obligationId))!==json(recipe))throw Error('verification_observation_changed');
   const row=db.prepare('SELECT definition_json,active_attempt,attempt_epoch FROM mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(key,request.obligationId) as {definition_json:string;active_attempt:string|null;attempt_epoch:number}|undefined;
   if(!row)throw Error('verification_observation_obligation');
   const definition=JSON.parse(row.definition_json) as MandatoryObligation;
   if(definition.obligationId!==request.obligationId||definition.definitionHash!==compiled.definitionHash||json(definition.requiredCheckIds)!==json(compiled.requiredCheckIds))throw Error('verification_observation_definition');
   if(row.active_attempt!==null){
    const attempt=db.prepare('SELECT owner_key,obligation_id,epoch FROM obligation_attempts WHERE attempt_id=?').get(row.active_attempt) as {owner_key:string;obligation_id:string;epoch:number}|undefined;
    if(!attempt||attempt.owner_key!==key||attempt.obligation_id!==request.obligationId||attempt.epoch!==row.attempt_epoch)throw Error('verification_observation_epoch');
   }
   const pointer=db.prepare('SELECT current_json,pending_id FROM verification_application_pointers WHERE owner_key=?').get(key) as {current_json:string|null;pending_id:string|null}|undefined;
   const actualApplication={state:pointer?.pending_id?'pending':pointer?.current_json?'active':'unbound',current:pointer?.current_json?JSON.parse(pointer.current_json):null,pendingTransitionId:pointer?.pending_id??null};
   if(json(application)!==json(actualApplication))throw Error('verification_observation_changed');
   // Owner/recipe reads can call the host clock; do not return after a late close.
   lifetime.signal.throwIfAborted();
   return parseVerificationObligationObservation({owner,obligationId:request.obligationId,definitionHash:compiled.definitionHash,attemptEpoch:row.attempt_epoch,activeAttemptId:row.active_attempt,application:actualApplication});
  });
 }
 type RequestRow={principal:string;request_id:string;query_json:string;request_json:string|null;state:string;operation_id:string|null};
 type RequestContext={principal:string;requestId:string;queryJson:string;requestJson:string;ownerKey:string};
 function requestRow(principal:string,id:string){return db.prepare('SELECT * FROM verification_prepare_requests WHERE principal=? AND request_id=?').get(principal,id) as RequestRow|undefined;}
 function requestContext(query:Readonly<VerificationOperationRequestQuery>,peer:ControllerPeer){const owner=inspectObligation({invocation:query.invocation,obligationId:query.obligationId},peer).owner;return {owner,principal:json(peer),queryJson:json({...query,owner}),ownerKey:json(owner)};}
 function requestCurrent(query:Readonly<VerificationOperationRequestQuery>,peer:ControllerPeer,ownerKey:string){if(host.enrollment.resolveOwnerKey(peer,query.invocation)!==ownerKey)throw Error('verification_request_owner');lifetime.signal.throwIfAborted();}
 function terminalResult(operation:{id:string;state:string;record_json:string;owner_key:string}){
  const value=JSON.parse(operation.record_json),binding=value.binding;
  const row=db.prepare('SELECT * FROM verification_operation_results WHERE operation_id=?').get(operation.id) as {operation_id:string;operation_record_hash:string;result_json:string;result_hash:string;core_revision:number;attempt_core_hash:string;proof_id:string|null;attempt_proof_hash:string|null}|undefined;
  if(!row){if(operation.state==='terminal'&&value.terminalResultVersion===1)throw Error('verification_result_missing');return undefined;}
  if(operation.state!=='terminal'||row.operation_record_hash!==hash(operation.record_json)||row.result_hash!==hash(row.result_json))throw Error('verification_result_binding');
  const result=parseVerificationOperationTerminalResult(JSON.parse(row.result_json));if(result.attemptId!==binding.attemptId||json(result)!==row.result_json)throw Error('verification_result_binding');
  const historical=db.prepare('SELECT core_json FROM execution_facts_revisions WHERE attempt_id=? AND revision=?').get(binding.attemptId,row.core_revision) as {core_json:string}|undefined;
  if(!historical||hash(historical.core_json)!==row.attempt_core_hash)throw Error('verification_result_core');const core=JSON.parse(historical.core_json);
  const rawFact=db.prepare('SELECT state,exit_code FROM execution_attempts WHERE execution_id=?').get(binding.expected.executionIdentity) as {state:string;exit_code:number|null}|undefined;
  if(core.attemptId!==binding.attemptId||json(core.owner)!==operation.owner_key||json(core.execution)!==json(binding.expected)||core.subjectId!==binding.subjectId||core.runNonce!==binding.runNonce||core.coreFinalRevision!==row.core_revision||core.quiescent!==true||rawFact?.state!=='terminal'||rawFact.exit_code!==core.exitCode)throw Error('verification_result_core');
  if((row.proof_id===null)!==(row.attempt_proof_hash===null))throw Error('verification_result_proof');
  if(row.proof_id!==null){const proofRow=db.prepare('SELECT attempt_id,proof_json FROM verifier_proofs WHERE proof_id=?').get(row.proof_id) as {attempt_id:string;proof_json:string}|undefined;if(!proofRow||proofRow.attempt_id!==binding.attemptId||hash(proofRow.proof_json)!==row.attempt_proof_hash)throw Error('verification_result_proof');const proof=JSON.parse(proofRow.proof_json);if(proof.coreHash!==row.attempt_core_hash||proof.coreFinalRevision!==row.core_revision||proof.attemptId!==binding.attemptId||proof.proofId!==row.proof_id)throw Error('verification_result_proof');}
  if(result.sourceRun){const source=db.prepare('SELECT source_run_id,run_nonce,archive_hash,state FROM verification_protected_runs WHERE source_run_id=?').get(value.sourceRunId) as {source_run_id:string;run_nonce:string;archive_hash:string|null;state:string}|undefined;if(!source||!['complete','deleted'].includes(source.state)||source.run_nonce!==value.runNonce||json(result.sourceRun)!==json({sourceRunId:source.source_run_id,runNonce:source.run_nonce,archiveHash:source.archive_hash,scope:'protected-execution-run'}))throw Error('verification_result_source');}
  return result;
 }
 function observeRequest(query:Readonly<VerificationOperationRequestQuery>,context:ReturnType<typeof requestContext>,row:RequestRow|undefined):VerificationOperationRequestObservation{
  const common={...query,owner:context.owner};if(!row){if(db.prepare("SELECT 1 FROM verification_operations WHERE principal=? AND json_extract(record_json,'$.request.requestId')=?").get(context.principal,query.requestId))throw Error('verification_request_association');return parseVerificationOperationRequestObservation({...common,state:'absent'});}
  if(row.query_json!==context.queryJson||row.principal!==context.principal||row.request_id!==query.requestId)throw Error('verification_request_changed');
  const constraint=row.request_json===null?null:shape(JSON.parse(row.request_json),['requestId','invocation','obligationId','owner','expectedAttemptEpoch','requestSource','materialHandleHash']);
  if(constraint&&(json({requestId:constraint.requestId,invocation:constraint.invocation,obligationId:constraint.obligationId,owner:constraint.owner})!==context.queryJson||!['user','agent','scheduler'].includes(constraint.requestSource)||!Number.isSafeInteger(constraint.expectedAttemptEpoch)||constraint.expectedAttemptEpoch<0||typeof constraint.materialHandleHash!=='string'||! /^[a-f0-9]{64}$/.test(constraint.materialHandleHash)||json(constraint)!==row.request_json))throw Error('verification_request_record');
  if(row.state!=='operation'){if(!['not_prepared','preparing','retired'].includes(row.state)||row.operation_id!==null||(row.state==='not_prepared')!==(row.request_json===null))throw Error('verification_request_record');return parseVerificationOperationRequestObservation({...common,state:row.state});}
  if(!row.operation_id||!row.request_json)throw Error('verification_request_record');
  const operation=db.prepare('SELECT * FROM verification_operations WHERE id=?').get(row.operation_id) as {id:string;owner_key:string;principal:string;state:string;record_json:string}|undefined;
  if(!operation||operation.owner_key!==context.ownerKey||operation.principal!==context.principal)throw Error('verification_request_operation');const value=JSON.parse(operation.record_json),binding=value.binding;
  if(json(value.request)!==json({requestId:query.requestId,principal:context.principal,queryJson:context.queryJson,requestHash:hash(row.request_json)})||value.obligationId!==query.obligationId)throw Error('verification_request_operation');
  const attempt=db.prepare('SELECT owner_key,obligation_id,epoch,execution_json,facts_json FROM obligation_attempts WHERE attempt_id=?').get(binding?.attemptId) as {owner_key:string;obligation_id:string;epoch:number;execution_json:string|null;facts_json:string}|undefined;
  if(!attempt||attempt.owner_key!==context.ownerKey||attempt.obligation_id!==query.obligationId||!constraint||attempt.epoch!==constraint.expectedAttemptEpoch+1||value.requestSource!==constraint.requestSource||attempt.execution_json!==json(binding.expected))throw Error('verification_request_operation');
  const facts=JSON.parse(attempt.facts_json);if(facts.subjectId!==binding.subjectId||facts.runNonce!==binding.runNonce)throw Error('verification_request_operation');
  const resource=db.prepare('SELECT resources_json FROM docker_runner_resources WHERE execution_id=?').get(binding.expected.executionIdentity) as {resources_json:string}|undefined;
  const execution=db.prepare('SELECT session_id,operation_id,proposal_json,state,exit_code FROM execution_attempts WHERE execution_id=?').get(binding.expected.executionIdentity) as {session_id:string;operation_id:string;proposal_json:string;state:string;exit_code:number|null}|undefined;
  const member=db.prepare('SELECT expected_json,source_run_id FROM verification_run_executions WHERE execution_id=?').get(binding.expected.executionIdentity) as {expected_json:string;source_run_id:string}|undefined;
  const run=db.prepare('SELECT owner_key,run_nonce,invocation_json FROM verification_protected_runs WHERE source_run_id=?').get(value.sourceRunId) as {owner_key:string;run_nonce:string;invocation_json:string}|undefined;
  if(!resource||!execution||!member||!run||member.expected_json!==json(binding.expected)||member.source_run_id!==value.sourceRunId||run.owner_key!==context.ownerKey||run.run_nonce!==value.runNonce||run.invocation_json!==json(query.invocation))throw Error('verification_request_execution');
  const resources=JSON.parse(resource.resources_json),proposal=JSON.parse(execution.proposal_json);
  if(resources.ownerKey!==context.ownerKey||json(resources.expected)!==json(binding.expected)||execution.session_id!==query.invocation.sessionIdentity||execution.operation_id!==query.invocation.compoundOperationId
   ||json({sessionIdentity:proposal.sessionIdentity,compoundOperationId:proposal.compoundOperationId,validationInvocationId:proposal.validationInvocationId})!==json(query.invocation)||proposal.scopeDigest!==binding.expected.scopeDigest||proposal.commandDigest!==hash(json(resources.command))
   ||operation.state==='prepared'&&execution.state!=='prepared'||operation.state==='terminal'&&execution.state!=='terminal'||operation.state==='cancelled'&&(execution.state!=='terminal'||execution.exit_code!==null))throw Error('verification_request_execution');
  if(operation.state==='cancelled'){
   const sealed=db.prepare('SELECT state,archive_hash,archive_bytes,allocation_json,exit_code FROM verification_protected_runs WHERE source_run_id=?').get(value.sourceRunId);
   const producers=db.prepare('SELECT producer_id,parent_id,state FROM verification_run_producers WHERE source_run_id=?').all(value.sourceRunId) as {producer_id:string;parent_id:string|null;state:string}[];
   const members=db.prepare('SELECT execution_id,producer_id,expected_json,observation_json FROM verification_run_executions WHERE source_run_id=?').all(value.sourceRunId) as {execution_id:string;producer_id:string;expected_json:string;observation_json:string|null}[];
   if(json(sealed)!==json({state:'sealed',archive_hash:null,archive_bytes:null,allocation_json:null,exit_code:null})||producers.length!==1||producers[0].parent_id!==null||producers[0].state!=='ended'||members.length!==1||members[0].producer_id!==producers[0].producer_id||members[0].execution_id!==binding.expected.executionIdentity||members[0].expected_json!==json(binding.expected)||members[0].observation_json!==json({expected:binding.expected,exitCode:null,cancelledBeforeStart:true,complete:true,stdoutBase64:'',stderrBase64:''}))throw Error('verification_request_cancel_census');
  }
  const outcome=terminalResult(operation);
  return parseVerificationOperationRequestObservation({...common,state:'operation',operation:{id:operation.id,state:operation.state,attemptId:binding.attemptId,expected:binding.expected,...(outcome?{terminalResult:outcome}:{})}});
 }
 function requestAdmission(row:RequestRow){if((db.prepare('SELECT count(*) n FROM verification_prepare_requests').get() as {n:number}).n>=4096)throw Error('verification_request_capacity');assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json(row))+2048});
  const result=db.prepare('INSERT INTO verification_prepare_requests VALUES(?,?,?,?,?,?)').run(row.principal,row.request_id,row.query_json,row.request_json,row.state,row.operation_id);
  if(result.changes!==1||json(requestRow(row.principal,row.request_id))!==json(row))throw Error('verification_request_commit');
 }
 function lookupRequest(raw:unknown,peerInput:ControllerPeer){const query=parseVerificationOperationRequestQuery(raw),peer=clone(peerInput),context=requestContext(query,peer);return runVerificationTransaction(db,()=>{requestCurrent(query,peer,context.ownerKey);return observeRequest(query,context,requestRow(context.principal,query.requestId));});}
 function retireRequest(raw:unknown,peerInput:ControllerPeer){const request=parseVerificationOperationRetireRequest(raw),query=parseVerificationOperationRequestQuery({requestId:request.requestId,invocation:request.invocation,obligationId:request.obligationId}),peer=clone(peerInput),context=requestContext(query,peer);
  return runVerificationTransaction(db,()=>{requestCurrent(query,peer,context.ownerKey);const before=requestRow(context.principal,query.requestId);observeRequest(query,context,before);
   if(!before)requestAdmission({principal:context.principal,request_id:query.requestId,query_json:context.queryJson,request_json:null,state:'not_prepared',operation_id:null});
   else if(before.state==='preparing'){const after={...before,state:'retired'};const changed=db.prepare("UPDATE verification_prepare_requests SET state='retired' WHERE principal=? AND request_id=? AND state='preparing' AND query_json=? AND request_json=?").run(context.principal,query.requestId,before.query_json,before.request_json);if(changed.changes!==1||json(requestRow(context.principal,query.requestId))!==json(after))throw Error('verification_request_commit');}
   lifetime.signal.throwIfAborted();return observeRequest(query,context,requestRow(context.principal,query.requestId));
  });
 }
 const recovering=new Map<string,Promise<VerificationOperationRequestObservation>>();
 async function recoverOriginal(request:ReturnType<typeof parseVerificationOperationRetireRequest>,peer:ControllerPeer,signal:AbortSignal):Promise<VerificationOperationRequestObservation>{
  const query=parseVerificationOperationRequestQuery({requestId:request.requestId,invocation:request.invocation,obligationId:request.obligationId});
  signal.throwIfAborted();const before=retireRequest(request,peer);
  if(before.state!=='operation'||!['prepared','unknown','cancelling'].includes(before.operation.state))return before;
  const expected=before.operation.expected,id=before.operation.id,original=db.prepare('SELECT * FROM verification_operations WHERE id=?').get(id) as {id:string;owner_key:string;principal:string;secret_hash:string;boot:string;state:string;record_json:string};
  const rawState=raw.readExecution(expected);if(rawState.state!=='prepared'&&rawState.cancelledBeforeStart!==true)return lookupRequest(query,peer);
  const cancelling=runVerificationTransaction(db,()=>{
   if(json(db.prepare('SELECT * FROM verification_operations WHERE id=?').get(id))!==json(original))throw Error('verification_recovery_changed');
   const changed=db.prepare("UPDATE verification_operations SET state='cancelling' WHERE id=? AND state=? AND record_json=?").run(id,original.state,original.record_json);
   const row={...original,state:'cancelling'};if(changed.changes!==1||json(db.prepare('SELECT * FROM verification_operations WHERE id=?').get(id))!==json(row))throw Error('verification_recovery_commit');return row;
  });
  prepared.delete(id); // Dispatch can no longer obtain this live capability.
  const combined=AbortSignal.any([signal,lifetime.signal]);
  if(raw.readExecution(expected).state==='prepared')raw.cancelPreparedExecution(expected);
  await qualify(combined);current();combined.throwIfAborted();
  await raw.cleanupExecution(expected);
  const receipt=await quiescence.inspectExecution(expected);current();combined.throwIfAborted();
  const value=JSON.parse(cancelling.record_json);runs.sealCancelledPreparedRun({sourceRunId:value.sourceRunId,expected,receipt});
  const cancellationVector=()=>json({
   run:db.prepare('SELECT * FROM verification_protected_runs WHERE source_run_id=?').get(value.sourceRunId),
   producers:db.prepare('SELECT * FROM verification_run_producers WHERE source_run_id=? ORDER BY producer_id').all(value.sourceRunId),
   members:db.prepare('SELECT * FROM verification_run_executions WHERE source_run_id=? ORDER BY execution_id').all(value.sourceRunId),
   execution:db.prepare('SELECT * FROM execution_attempts WHERE execution_id=?').get(expected.executionIdentity),
   resource:db.prepare('SELECT * FROM docker_runner_resources WHERE execution_id=?').get(expected.executionIdentity),
   request:requestRow(json(peer),query.requestId),
  }),sealedVector=cancellationVector();
  // Fresh request and raw facts are checked after all physical callbacks. This
  // is historical cancellation, never a restored producer or dispatch handle.
  const observed=lookupRequest(query,peer);if(observed.state!=='operation'||observed.operation.id!==id||observed.operation.state!=='cancelling')throw Error('verification_recovery_changed');
  runVerificationTransaction(db,()=>{
   combined.throwIfAborted();if(cancellationVector()!==sealedVector)throw Error('verification_recovery_changed');
   if(json(db.prepare('SELECT * FROM verification_operations WHERE id=?').get(id))!==json(cancelling))throw Error('verification_recovery_changed');
   const changed=db.prepare("UPDATE verification_operations SET state='cancelled' WHERE id=? AND state='cancelling' AND record_json=?").run(id,cancelling.record_json);
   if(changed.changes!==1||json(db.prepare('SELECT * FROM verification_operations WHERE id=?').get(id))!==json({...cancelling,state:'cancelled'})||cancellationVector()!==sealedVector)throw Error('verification_recovery_commit');
  });
  // No host callback after the final durable comparison and commit.
  return parseVerificationOperationRequestObservation({...observed,operation:{...observed.operation,state:'cancelled'}});
 }
 async function recoverRequest(payload:unknown,peerInput:ControllerPeer,signal:AbortSignal):Promise<VerificationOperationRequestObservation>{
  const request=parseVerificationOperationRetireRequest(payload),peer=clone(peerInput),query=parseVerificationOperationRequestQuery({requestId:request.requestId,invocation:request.invocation,obligationId:request.obligationId});signal.throwIfAborted();
  const key=json({peer,query}),existing=recovering.get(key);if(existing){await existing;signal.throwIfAborted();return lookupRequest(query,peer);}
  const work=Promise.resolve().then(()=>recoverOriginal(request,peer,signal));recovering.set(key,work);try{return await work;}finally{if(recovering.get(key)===work)recovering.delete(key);}
 }
 async function prepareRequest(raw:unknown,peerInput:ControllerPeer,signal:AbortSignal){
  const request=parseVerificationOperationPrepareRequest(raw),query=parseVerificationOperationRequestQuery({requestId:request.requestId,invocation:request.invocation,obligationId:request.obligationId}),peer=clone(peerInput),context=requestContext(query,peer);
  signal.throwIfAborted();const requestJson=json({...query,owner:context.owner,expectedAttemptEpoch:request.expectedAttemptEpoch,requestSource:request.requestSource,materialHandleHash:hash(json(request.mountPlanHandle))});
  const prior=runVerificationTransaction(db,()=>{requestCurrent(query,peer,context.ownerKey);const existing=requestRow(context.principal,query.requestId);if(existing){const observation=observeRequest(query,context,existing);if(['not_prepared','retired'].includes(existing.state))throw Error('verification_request_retired');if(existing.request_json!==requestJson)throw Error('verification_request_changed');return observation;}
   observeRequest(query,context,undefined);if(preparing)throw Error('verification_operation_reentrant');requestAdmission({principal:context.principal,request_id:query.requestId,query_json:context.queryJson,request_json:requestJson,state:'preparing',operation_id:null});return undefined;
  });
  if(prior)return Object.freeze({created:false as const,observation:prior});
  const result=await prepare({mountPlanHandle:request.mountPlanHandle,obligationId:request.obligationId,expectedAttemptEpoch:request.expectedAttemptEpoch,requestSource:request.requestSource},peer,signal,{principal:context.principal,requestId:query.requestId,queryJson:context.queryJson,requestJson,ownerKey:context.ownerKey});
  lifetime.signal.throwIfAborted();signal.throwIfAborted();return Object.freeze({created:true as const,...result});
 }
 function assertRequestPreparing(context:RequestContext){const row=requestRow(context.principal,context.requestId);if(!row||['retired','not_prepared'].includes(row.state))throw Error('verification_request_retired');if(row.state!=='preparing'||row.operation_id!==null||row.query_json!==context.queryJson||row.request_json!==context.requestJson)throw Error('verification_request_changed');return row;}

 function commitPreparedExecution(command:object,context:ExecutionWriteContext):void{
  const facts=preparationFacts.get(command),identity=operationPreparationCommands.get(command);if(!facts||identity?.owner!==result)throw Error('verification_preparation_command_brand');
  const transaction=consumeExecutionCommandContext(context,raw,db,command);
  const {p,peer,material,signal2,manifest,owner,recipe,key,ob,definition,original,subjectManifest,expiresAt,start,id,secret,request}=facts;let {sourceRunId,runNonce}=facts;

    if(request)assertRequestPreparing(request);
    const admittedRun=runs.beginRunInTransaction({ownerKey:key,rootInvocation:manifest.invocation,authorization:start});facts.run=admittedRun;const run=admittedRun;
    current();signal2.throwIfAborted();if(json(ownerFor(peer,material.plan))!==key||json(host.enrollment.readApprovedRecipe(owner,p.obligationId))!==json(recipe))throw Error('verification_operation_changed');if(original)assertPreparedProtectedSourceCurrent(original,db);
    if((db.prepare('SELECT COUNT(*) n FROM verification_operations').get() as {n:number}).n>=4096)throw Error('verification_operation_capacity');
    const scopeId=hash(json({materialScope:manifest.scopeDigest,source:subjectManifest})),prior=db.prepare('SELECT revision FROM verification_scopes WHERE owner_key=? AND scope_id=?').get(key,scopeId) as {revision:number}|undefined,scopeRevision=(prior?.revision??0)+1;
    const scope={owner,requiredScopeId:scopeId,scopeRevision,scopeExpiresAt:expiresAt,manifest:subjectManifest};
    let subject:{subjectId:string;contentRoot:string};
    if(ob.active_attempt&&['specific-run','cumulative'].includes(definition.semantics)){
     const old=db.prepare('SELECT facts_json FROM obligation_attempts WHERE attempt_id=? AND owner_key=?').get(ob.active_attempt,key) as {facts_json:string}|undefined;if(!old)throw Error('verification_operation_original');const facts=JSON.parse(old.facts_json);
     if(recipe.kind!=='diagnostic-coverage'){sourceRunId=facts.sourceRunId;runNonce=facts.runNonce;}
     if(sourceRunId!==facts.sourceRunId||runNonce!==facts.runNonce)throw Error('verification_operation_original');subject=host.authorityHost.refreshOriginalSubject({...scope,subjectId:facts.subjectId});
    }else subject=host.authorityHost.admitCurrentSubject(scope);
    const scopeGuard=Object.freeze({}),guardScope={owner:clone(owner),scopeId,revision:scopeRevision};operationScopeGuards.set(scopeGuard,{database:db,materials,completion:host,plan:material.plan,manifest:clone(manifest),peer:clone(peer),scope:guardScope,source:original});host.authorityHost.registerScopeGuard(guardScope,scopeGuard);
    const attemptRequest={owner,obligationId:p.obligationId,expectedAttemptEpoch:p.expectedAttemptEpoch,sourceRunId,runNonce,...subject,requiredScopeId:scopeId,scopeRevision};
    const authorization=host.authorityHost.issueAuthorization({owner,method:'requestVerification',payload:attemptRequest,requestSource:p.requestSource as Source,principalId:json(peer),expiresAt});
    const attempt=host.authorityService.requestVerification(attemptRequest,{requestSource:p.requestSource,authorization});
    const execution=raw.reserveExecution({...manifest.invocation,ownerKey:key,scopeDigest:manifest.scopeDigest,command:manifest.command,materializedInput:material.plan},transaction);facts.uncommitted=execution.expected;runs.registerExecution(run!.producer,execution.expected);host.authorityHost.bindExecution(attempt.attemptId,execution.expected);
    const binding={attemptId:attempt.attemptId,subjectId:subject.subjectId,runNonce,expected:execution.expected};if(original)bindPreparedProtectedSourceAttempt(original,db,binding);assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json(binding))+8192});
    const operationRecord=json({binding,sourceRunId:run!.sourceRunId,runNonce:run!.runNonce,obligationId:p.obligationId,requestSource:p.requestSource,expiresAt,terminalResultVersion:1,...(request?{request:{requestId:request.requestId,principal:request.principal,queryJson:request.queryJson,requestHash:hash(request.requestJson)}}:{})});
    const inserted=db.prepare("INSERT INTO verification_operations VALUES(?,?,?,?,?,'prepared',?)").run(id,key,json(peer),hash(secret),boot,operationRecord);
    const expectedOperation={id,owner_key:key,principal:json(peer),secret_hash:hash(secret),boot,state:'prepared',record_json:operationRecord};
    if(inserted.changes!==1||json(db.prepare('SELECT * FROM verification_operations WHERE id=?').get(id))!==json(expectedOperation))throw Error('verification_operation_commit');
    materials.attachMountPlanHandoff(material.handoff,transaction,execution.expected);
    if(request){const before=assertRequestPreparing(request);if(key!==request.ownerKey)throw Error('verification_request_material');
     const changed=db.prepare("UPDATE verification_prepare_requests SET state='operation',operation_id=? WHERE principal=? AND request_id=? AND state='preparing' AND query_json=? AND request_json=? AND operation_id IS NULL").run(id,request.principal,request.requestId,request.queryJson,request.requestJson);
     if(changed.changes!==1||json(requestRow(request.principal,request.requestId))!==json({...before,state:'operation',operation_id:id}))throw Error('verification_request_commit');
    }
    signal2.throwIfAborted();readDockerReservationHandoff(transaction,db,execution.expected);
    if(json(db.prepare('SELECT * FROM verification_operations WHERE id=?').get(id))!==json(expectedOperation))throw Error('verification_operation_commit');
    facts.result={binding,attemptEpoch:attempt.attemptEpoch,run:admittedRun};
 }
 async function prepare(payload:unknown,peerInput:ControllerPeer,signal:AbortSignal,request?:RequestContext){
  current();if(preparing||db.inTransaction)throw Error('verification_operation_reentrant');preparing=true;let uncommitted:QuiescenceExpectation|undefined,run:Run|undefined;
  try{
   const p=shape(payload,['mountPlanHandle','obligationId','expectedAttemptEpoch','requestSource']),peer=clone(peerInput);
   if(!['user','agent','scheduler'].includes(p.requestSource)||typeof p.obligationId!=='string'||!p.obligationId||p.obligationId.length>160||!Number.isSafeInteger(p.expectedAttemptEpoch)||p.expectedAttemptEpoch<0)throw Error('verification_operation_request');
   // Consume the actual one-use plan before any callback/await can reenter.
   const material=consume(p.mountPlanHandle,peer),signal2=AbortSignal.any([signal,lifetime.signal]);
   if(request){const handoff=materials.readMountPlanHandoff(material.handoff),query=JSON.parse(request.queryJson);if(handoff.ownerKey!==request.ownerKey||json(material.review.invocation)!==json(query.invocation))throw Error('verification_request_material');assertRequestPreparing(request);}
   await qualify(signal2);current();signal2.throwIfAborted();const manifest=clone(manifestFor(material.plan)),owner=ownerFor(peer,material.plan),recipe=host.enrollment.readApprovedRecipe(owner,p.obligationId),key=json(owner),sample=clock();
   if(material.deadline.clockDomainId!==sample.domainId||material.deadline.clockQualificationEpoch!==sample.qualificationEpoch||material.deadline.continuousExpiresAt<=sample.upperBound)throw Error('verification_operation_deadline');
   const ob=db.prepare('SELECT definition_json,active_attempt,attempt_epoch FROM mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(key,p.obligationId) as {definition_json:string;active_attempt:string|null;attempt_epoch:number}|undefined;
   if(!ob||ob.attempt_epoch!==p.expectedAttemptEpoch)throw Error('verification_attempt_cas');const definition=JSON.parse(ob.definition_json) as MandatoryObligation;
   let original:OriginalVerificationSourceSubject|undefined,subjectManifest:SubjectManifest,sourceRunId:string,runNonce:string,expiresAt=material.deadline.continuousExpiresAt;
   if(recipe.kind==='diagnostic-coverage'){
    original=sources(owner,recipe,material.deadline,p.obligationId);assertPreparedProtectedSourceCurrent(original,db);subjectManifest=clone(original.manifest);sourceRunId=original.sourceRunId;runNonce=original.runNonce;expiresAt=Math.min(expiresAt,original.expiresAt);
   }else{
    const reservedPath='__xiaok_verification_runtime__.json';if(manifest.files.some(f=>f.path.toLowerCase()===reservedPath))throw Error('verification_subject_reserved_path');
    const runtime=Buffer.from(json({command:manifest.command,imageId,policyHash:MOUNTED_POLICY_SHA256}));
    subjectManifest=[...manifest.files.map(f=>({path:f.path,sha256:f.contentHash,size:f.size,role:f.executable?'executable':'input'})),{path:reservedPath,sha256:hash(runtime),size:runtime.length,role:'runtime-contract'}];sourceRunId=manifest.invocation.validationInvocationId;runNonce=randomUUID();
   }
   if(!Number.isSafeInteger(expiresAt)||expiresAt<=sample.upperBound)throw Error('verification_operation_deadline');
   const recipePlan=host.recipes.compile(recipe);if(recipePlan.definitionHash!==definition.definitionHash||json(recipePlan.requiredCheckIds)!==json(definition.requiredCheckIds))throw Error('verification_operation_recipe');
   const start=capabilities.issueStart({owner,obligationId:p.obligationId,peer,invocation:manifest.invocation,deadline:material.deadline});
   const id=randomUUID(),secret=randomBytes(32).toString('hex');
   const command=Object.freeze({}),facts:PreparationFacts={p,peer,material,signal2,manifest,owner,recipe,key,ob,definition,original,subjectManifest,sourceRunId,runNonce,expiresAt,start,id,secret,request};
   preparationFacts.set(command,facts);operationPreparationCommands.set(command,{owner:result,raw,database:db});
   try{raw.reserveCommand(command);}finally{uncommitted=facts.uncommitted;run=facts.run;preparationFacts.delete(command);operationPreparationCommands.delete(command);}
   const committed=facts.result;if(!committed)throw Error('verification_preparation_command_result');
   uncommitted=undefined;prepared.set(id,{plan:material.plan,binding:committed.binding,owner,recipe,expiresAt,run:committed.run,source:original});return Object.freeze({operationHandle:Object.freeze({id,secret}),attemptId:committed.binding.attemptId,attemptEpoch:committed.attemptEpoch,sourceRunId:committed.run.sourceRunId,runNonce:committed.run.runNonce});
  }catch(error){try{if(uncommitted)raw.discardUncommittedExecution(uncommitted);if(run)runs.discardUncommittedRun(run.producer);}catch(cleanup){throw new AggregateError([error,cleanup],'verification_operation_rollback_cleanup');}throw error;}finally{preparing=false;}
 }
 async function dispatch(payload:unknown,peerInput:ControllerPeer,signal:AbortSignal){
  current();if(db.inTransaction)throw Error('verification_operation_outer_transaction');const p=shape(payload,['operationHandle']),h=shape(p.operationHandle,['id','secret']),peer=clone(peerInput);
  const item=prepared.get(h.id);if(!item)throw Error('verification_operation_unknown');
  runVerificationTransaction(db,()=>{const row=db.prepare('SELECT * FROM verification_operations WHERE id=?').get(h.id) as {principal:string;secret_hash:string;boot:string;state:string}|undefined;
   if(!row||row.principal!==json(peer)||row.secret_hash!==hash(h.secret)||row.boot!==boot||row.state!=='prepared')throw Error('verification_operation_handle');db.prepare("UPDATE verification_operations SET state='dispatching' WHERE id=?").run(h.id);});prepared.delete(h.id);
  const signal2=AbortSignal.any([signal,lifetime.signal]);dispatching.set(json(item.binding),{plan:item.plan,run:item.run,signal:signal2,binding:item.binding});let result:Awaited<ReturnType<typeof raw.dispatchExecution>>|undefined,receipt:PhysicalQuiescenceReceipt|undefined,producerSealed=false;
  try{
   await qualify(signal2);current();if(json(ownerFor(peer,item.plan))!==json(item.owner))throw Error('verification_operation_owner');if(item.source)assertPreparedProtectedSourceCurrent(item.source,db);host.readApprovedRecipeBinding(item.binding);signal2.throwIfAborted();
   result=await raw.dispatchExecution(item.binding.expected,{signal:signal2});receipt=await quiescence.inspectExecution(item.binding.expected);sync(archive({...result,receipt}));runs.recordActualExecution({...result,receipt});
   raw.assertOutputDisclosure(result.output,{expected:item.binding.expected});sync(registerOutput({...result,receipt}));const plan=host.recipes.compile(item.recipe),evaluation=await host.recipes.evaluate(plan,item.binding);
   const captured=raw.readCapturedOutput(result.output,{expected:item.binding.expected});const complete=captured.complete&&!captured.truncated;
   await raw.cleanupExecution(item.binding.expected);
   runs.endProducer(item.run.producer);runs.seal(item.run.producer);producerSealed=true;const source=complete?await runs.complete(item.run.sourceRunId):undefined;
   const retention=complete&&evaluation.checks.every(c=>c.passed)?host.payloads.prepareRetention(evaluation):undefined;
   const finalResult=result,finalReceipt=receipt;
   const fixedFacts=()=>json({
    operation:db.prepare('SELECT * FROM verification_operations WHERE id=?').get(h.id),
    requests:db.prepare('SELECT * FROM verification_prepare_requests WHERE operation_id=?').all(h.id),
    execution:db.prepare('SELECT * FROM execution_attempts WHERE execution_id=?').get(item.binding.expected.executionIdentity),
    resource:db.prepare('SELECT * FROM docker_runner_resources WHERE execution_id=?').get(item.binding.expected.executionIdentity),
    run:db.prepare('SELECT * FROM verification_protected_runs WHERE source_run_id=?').get(item.run.sourceRunId),
    members:db.prepare('SELECT * FROM verification_run_executions WHERE source_run_id=? ORDER BY execution_id').all(item.run.sourceRunId),
    producers:db.prepare('SELECT * FROM verification_run_producers WHERE source_run_id=? ORDER BY producer_id').all(item.run.sourceRunId),
    attempt:db.prepare('SELECT attempt_id,owner_key,obligation_id,epoch,facts_json,execution_json FROM obligation_attempts WHERE attempt_id=?').get(item.binding.attemptId),
   });
   const beforeFacts=fixedFacts(),originalOperation=db.prepare('SELECT * FROM verification_operations WHERE id=?').get(h.id) as {id:string;state:string;record_json:string;owner_key:string};
   if(originalOperation.state!=='dispatching'||json(JSON.parse(originalOperation.record_json).binding)!==json(item.binding)||originalOperation.owner_key!==json(item.owner))throw Error('verification_result_operation');
   const outcome=runVerificationTransaction(db,()=>{
    if(fixedFacts()!==beforeFacts)throw Error('verification_result_changed');
    const originalCore={coreId:randomUUID(),coreFinalRevision:1,exitCode:finalResult.exitCode,quiescent:true,outputHashes:[hash(captured.stdout),hash(captured.stderr),...(retention?[retention.bundleHash]:[])]},originalChecks=evaluation.checks.map(c=>({id:c.id,passed:complete&&c.passed}));
    host.authorityHost.recordControllerResult(item.binding.attemptId,originalCore,{verifierHash,checks:originalChecks,validUntil:item.expiresAt},finalReceipt);
    const attempt=db.prepare('SELECT core_json,proof_json FROM obligation_attempts WHERE attempt_id=?').get(item.binding.attemptId) as {core_json:string;proof_json:string|null};
    const core=JSON.parse(attempt.core_json),proof=attempt.proof_json?JSON.parse(attempt.proof_json):null;
    if(json(Object.fromEntries(Object.keys(originalCore).map(k=>[k,core[k]])))!==json(originalCore)||proof&&(json(proof.checks)!==json(originalChecks)||proof.checkDigest!==hash(json(originalChecks))||proof.verifierHash!==verifierHash||proof.coreHash!==hash(attempt.core_json)))throw Error('verification_result_core');
    const proofFacts=()=>json({attempt:db.prepare('SELECT core_json,proof_json,state FROM obligation_attempts WHERE attempt_id=?').get(item.binding.attemptId),core:db.prepare('SELECT * FROM execution_facts_revisions WHERE attempt_id=? AND revision=?').get(item.binding.attemptId,core.coreFinalRevision),proof:proof?db.prepare('SELECT * FROM verifier_proofs WHERE proof_id=?').get(proof.proofId):null}),originalProofFacts=proofFacts();
    if(retention)host.payloads.commitRetention(retention.token);
    const historical=parseVerificationOperationTerminalResult({attemptId:item.binding.attemptId,...(source?{sourceRun:{sourceRunId:source.sourceRunId,runNonce:source.runNonce,archiveHash:source.archiveHash,scope:source.scope}}:{}),verificationAtCompletion:host.authorityService.inspectOwner(item.owner)?.currentVerification??'unavailable'});
    signal2.throwIfAborted();if(fixedFacts()!==beforeFacts||proofFacts()!==originalProofFacts)throw Error('verification_result_changed');
    const resultJson=json(historical);
    const row={operation_id:h.id,operation_record_hash:hash(originalOperation.record_json),result_json:resultJson,result_hash:hash(resultJson),core_revision:core.coreFinalRevision,attempt_core_hash:hash(attempt.core_json),proof_id:proof?.proofId??null,attempt_proof_hash:attempt.proof_json?hash(attempt.proof_json):null};
    assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json(row))+2048});
    const inserted=db.prepare('INSERT INTO verification_operation_results VALUES(?,?,?,?,?,?,?,?)').run(row.operation_id,row.operation_record_hash,row.result_json,row.result_hash,row.core_revision,row.attempt_core_hash,row.proof_id,row.attempt_proof_hash);
    if(inserted.changes!==1||json(db.prepare('SELECT * FROM verification_operation_results WHERE operation_id=?').get(h.id))!==json(row)||fixedFacts()!==beforeFacts)throw Error('verification_result_commit');
    const changed=db.prepare("UPDATE verification_operations SET state='terminal' WHERE id=? AND state='dispatching' AND record_json=?").run(h.id,originalOperation.record_json);
    const expectedFacts=JSON.parse(beforeFacts);expectedFacts.operation.state='terminal';
    if(changed.changes!==1||fixedFacts()!==json(expectedFacts)||proofFacts()!==originalProofFacts||json(db.prepare('SELECT * FROM verification_operation_results WHERE operation_id=?').get(h.id))!==json(row))throw Error('verification_result_commit');
    if(json(terminalResult({...originalOperation,state:'terminal'}))!==resultJson)throw Error('verification_result_commit');
    return historical;
   });
   return Object.freeze({attemptId:outcome.attemptId,...(outcome.sourceRun?{sourceRun:outcome.sourceRun}:{}),currentVerification:outcome.verificationAtCompletion});
  }catch(error){
   // Factual finalization never turns a denied read into further material access.
   // An archive callback may fail after actual terminal capture; its success is
   // not the authority to clean up already stopped guest resources.
   try{if(raw.readExecution(item.binding.expected).state==='terminal'){await raw.cleanupExecution(item.binding.expected);receipt=await quiescence.inspectExecution(item.binding.expected);}}catch{/* Unknown physical cleanup remains in the original durable raw ledger. */}
   try{
    if(!receipt){const state=raw.readExecution(item.binding.expected);if(state.state==='prepared'){raw.cancelPreparedExecution(item.binding.expected);await raw.cleanupExecution(item.binding.expected);}receipt=await quiescence.inspectExecution(item.binding.expected);}
    const out=result?raw.readCapturedOutput(result.output,{expected:item.binding.expected}):undefined,plan=host.recipes.compile(item.recipe),state=raw.readExecution(item.binding.expected);
    if(state.cancelledBeforeStart)runs.recordCancelledExecution({expected:item.binding.expected,receipt});else if(result)runs.recordActualExecution({...result,receipt});
    host.authorityHost.recordControllerResult(item.binding.attemptId,{coreId:randomUUID(),coreFinalRevision:1,exitCode:state.exitCode??null,quiescent:true,outputHashes:out?[hash(out.stdout),hash(out.stderr)]:[]},{verifierHash,checks:plan.requiredCheckIds.map(id=>({id,passed:false})),validUntil:item.expiresAt},receipt);
   }catch{/* Original durable execution remains available for explicit factual reconciliation. */}
   db.prepare("UPDATE verification_operations SET state='unknown' WHERE id=? AND state='dispatching'").run(h.id);throw error;
  }finally{dispatching.delete(json(item.binding));if(!producerSealed){runs.endProducer(item.run.producer);runs.seal(item.run.producer);}}
 }
 function activeBinding(binding:RecipeBinding){current();const active=dispatching.get(json(binding));if(!active)throw Error('verification_operation_not_dispatching');active.signal.throwIfAborted();host.readApprovedRecipeBinding(binding);return active;}
 const result=Object.freeze({commitPreparedExecution,
  inspectObligation,lookupRequest,retireRequest,
  recoverRequest(payload:unknown,peer:ControllerPeer,signal:AbortSignal){const work=recoverRequest(payload,peer,signal);active.add(work);void work.then(()=>active.delete(work),()=>active.delete(work));return work;},
  prepareRequest(payload:unknown,peer:ControllerPeer,signal:AbortSignal){const work=prepareRequest(payload,peer,signal);active.add(work);void work.then(()=>active.delete(work),()=>active.delete(work));return work;},
  getOriginalPlan(binding:RecipeBinding){return activeBinding(binding).plan;},
  signalForBinding(binding:RecipeBinding){return activeBinding(binding).signal;},
  registerCaseExecution(binding:RecipeBinding,expected:QuiescenceExpectation,database:Database){if(database!==db||!db.inTransaction)throw Error('verification_operation_case_transaction');runs.registerExecution(activeBinding(binding).run.producer,expected);},
  recordCaseResult(result:{expected:QuiescenceExpectation;output:object;receipt:PhysicalQuiescenceReceipt}){if(!runs.hasExecution(result.expected))throw Error('verification_operation_case_unregistered');sync(archive(result));runs.recordActualExecution(result);},
  recordCaseCancellation(result:{expected:QuiescenceExpectation;receipt:PhysicalQuiescenceReceipt}){if(!runs.hasExecution(result.expected))throw Error('verification_operation_case_unregistered');runs.recordCancelledExecution(result);},
  prepare(payload:unknown,peer:ControllerPeer,signal:AbortSignal){const work=prepare(payload,peer,signal);active.add(work);void work.then(()=>active.delete(work),()=>active.delete(work));return work;},dispatch(payload:unknown,peer:ControllerPeer,signal:AbortSignal){const work=dispatch(payload,peer,signal);active.add(work);void work.then(()=>active.delete(work),()=>active.delete(work));return work;},
  stageVerifiedPayload(owner:VerificationOwner){current();return host.payloads.stageRetained(owner);},
  close(){
   if(closing)return closing;
   closing=Promise.resolve().then(async()=>{
    await Promise.allSettled([...active]);const failures:unknown[]=[];
    for(const [id,item] of prepared){try{
     const row=db.prepare('SELECT boot,state,record_json FROM verification_operations WHERE id=?').get(id) as {boot:string;state:string;record_json:string}|undefined;
     if(!row||row.boot!==boot||row.state!=='prepared'||json(JSON.parse(row.record_json).binding)!==json(item.binding)||raw.readExecution(item.binding.expected).state!=='prepared')throw Error('verification_operation_close_unconfirmed');
     raw.cancelPreparedExecution(item.binding.expected);await raw.cleanupExecution(item.binding.expected);
     const receipt=await quiescence.inspectExecution(item.binding.expected);runs.recordCancelledExecution({expected:item.binding.expected,receipt});runs.endProducer(item.run.producer);runs.seal(item.run.producer);
     const changed=db.prepare("UPDATE verification_operations SET state='cancelled' WHERE id=? AND boot=? AND state='prepared'").run(id,boot);if(changed.changes!==1)throw Error('verification_operation_close_cas');prepared.delete(id);
    }catch(error){failures.push(error);try{db.prepare("UPDATE verification_operations SET state='unknown' WHERE id=? AND boot=? AND state='prepared'").run(id,boot);}catch{/* Preserve original database and private member for explicit recovery. */}}}
    if(failures.length)throw new AggregateError(failures,'verification_operation_close_unknown');
   });
   lifetime.abort();return closing;
  },
 });
 actualOperations.set(result,{database:db,completion:host,assertCurrent:current});return result;
}
