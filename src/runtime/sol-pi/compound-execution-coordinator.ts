import type {createIntentProducerRegistryAdapter} from '../../ai/tools/intent-delegation.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {acquireSessionExecutionChain,acquireSessionExecutionFactChain,assertSessionExecutionChainLeaf,type SessionExecutionChain} from '../../ai/runtime/session-store/execution-chain.js';
import {executeCompoundFusion} from './compound-fusion-coordinator.js';
import {executeDirectIsolatedCommand,type CompoundValidationBackend} from './compound-validation.js';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Tool} from '../../types.js';
import type {CompoundRegistryExecutionPort} from '../../ai/tools/index.js';
import type {SessionExecutionAuthority,SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import type {createCompoundSessionJournal} from './compound-session-journal.js';
import type {CompoundOperationLedger,CompoundOperationRecord} from './compound-operation.js';
import type {DirectOperationRecord} from './compound-direct-operation.js';
import {getManagedCompoundCancellationAdapter} from './compound-managed-control.js';

export interface CompoundExecutionCoordinator extends CompoundRegistryExecutionPort { dispose():Promise<void>; publishCurrentHistory():Promise<void> }
export function abortablePreparation<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason??new DOMException('Aborted','AbortError'));
  signal.addEventListener('abort',abort,{once:true});
  void promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  if(signal.aborted)abort();
 });
}
type Journal=ReturnType<typeof createCompoundSessionJournal>;
function canonical(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
 throw Error('compound_input_not_json');
}
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
function uncertain(ledger:CompoundOperationLedger):boolean{
 return ledger.operations.some(r=>['edit_started','validation_started','outcome_unknown'].includes(r.stage))
  ||(ledger.directOperations??[]).some(r=>r.stage==='started'||r.stage==='outcome_unknown')
  ||(ledger.providerAttempts??[]).some(r=>r.transportState==='reserved'||r.transportState==='unknown');
}
function snapshotTools(tools:readonly Tool[]){return tools.map(tool=>({tool,execute:tool.execute,permission:tool.permission,precondition:tool.compoundFilePrecondition,definition:structuredClone(tool.definition)}));}
/** Host-bound registry coordinator. This initial implementation admits direct
 * synchronous native files and audited reads. Fusion/commands require the actual
 * qualified execution port and are never silently reduced to plain file writes. */
export function createCompoundExecutionCoordinator(options:{
 executionChain?:SessionExecutionChain;validationBackend?:CompoundValidationBackend;commandTool?:Tool;
 observationQueries?:readonly {tool:Tool;assertCurrent():void}[];
 cancellationTools?:readonly Tool[];
 assertSupervisedDelegation?(lease:SessionExecutionLease):void;
 captureGlobalSupervision?(lease:SessionExecutionLease):(issued?:DirectOperationRecord|CompoundOperationRecord)=>void;
 delegation?:{tools:readonly Tool[];execute(request:Parameters<CompoundRegistryExecutionPort['execute']>[0],inputHash:string,signal:AbortSignal,withLease:<T>(callback:(lease:SessionExecutionLease)=>Promise<T>,signal?:AbortSignal)=>Promise<T>,settlePrepared:(id:string,outcome:'cancelled'|'denied'|'invalid')=>Promise<void>):Promise<string>};
 intentReports?:ReturnType<typeof createIntentProducerRegistryAdapter>;
 journal:Journal;authority:SessionExecutionAuthority;sessionIdentity:string;assertCurrent():void;
 composeResult?(invocationId:string,before:string,body:string,after:string):string;
 createProjector?(invocationId:string,lease:SessionExecutionLease):(nativeResult:string)=>Promise<string>;
 settlePublishedDelegations?(lease:SessionExecutionLease):Promise<void>; persistCurrentHistory?(lease:SessionExecutionLease):Promise<void>;getPermissionRevision():number;executionSignal?:AbortSignal;readonlyTools:readonly Tool[];fileTools:readonly Tool[];
}):CompoundExecutionCoordinator{
 if(options.executionChain)assertSessionExecutionChainLeaf(options.executionChain,{authority:options.authority,sessionIdentity:options.sessionIdentity});
 const globalSupervision=new AsyncLocalStorage<{check(issued?:DirectOperationRecord|CompoundOperationRecord):void;issued?:DirectOperationRecord|CompoundOperationRecord}>();
 const noteCommittedRecord=(record:DirectOperationRecord|CompoundOperationRecord)=>{const active=globalSupervision.getStore();if(active)active.issued=structuredClone(record);};
 const assertExecutionCurrent=()=>{options.assertCurrent();const active=globalSupervision.getStore();active?.check(active.issued);};
 const lifetime=new AbortController(),closeReason=new DOMException('Compound owner disposed','AbortError');let disposed=false;let disposal:Promise<void>|undefined;
 const reads=snapshotTools(options.readonlyTools),files=snapshotTools(options.fileTools),commands=snapshotTools(options.commandTool?[options.commandTool]:[]);
 const intentReports=snapshotTools(options.intentReports?.tools??[]);
 const delegated=snapshotTools(options.delegation?.tools??[]);
 const queries=snapshotTools((options.observationQueries??[]).map(entry=>entry.tool));
 const cancellations=snapshotTools(options.cancellationTools??[]);
 if(files.some(entry=>!['write','edit'].includes(entry.definition.name)||!entry.precondition))throw Error('compound_native_file_adapter_required');
 const matches=(entries:ReturnType<typeof snapshotTools>,tool:Tool|undefined)=>entries.some(entry=>entry.tool===tool&&tool.execute===entry.execute&&tool.permission===entry.permission&&tool.compoundFilePrecondition===entry.precondition&&isDeepStrictEqual(tool.definition,entry.definition));
 const pending=new Map<string,{hash:string;promise:Promise<string>}>();
 const withLease=async<T>(callback:(lease:SessionExecutionLease)=>Promise<T>,signal?:AbortSignal,checkGlobal=true,rejectAdmission?:()=>void):Promise<T>=>{
  assertExecutionCurrent();const permissionRevision=options.getPermissionRevision();
  const request={invocationId:`compound:${randomUUID()}`,kind:'direct-mutation' as const,signal,assertAdmission:()=>{options.assertCurrent();if(options.getPermissionRevision()!==permissionRevision)throw Error('compound_permission_changed');if(rejectAdmission?.()!==undefined)throw Error('compound_admission_async');}};
  let scope:SessionExecutionLease,lease:SessionExecutionLease;
  if(options.executionChain){const acquired=await acquireSessionExecutionChain(options.executionChain,request);scope=acquired;lease=acquired.childLease;}
  else lease=scope=await options.authority.acquire(request);
  try{assertExecutionCurrent();scope.assertCurrent();const check=checkGlobal?options.captureGlobalSupervision?.(lease):undefined;if(checkGlobal&&options.captureGlobalSupervision&&typeof check!=='function')throw Error('compound_global_supervision_invalid');return await scope.trackInFlight(globalSupervision.run({check:check??(()=>{})},()=>callback(lease)));}finally{await scope.releaseAfterDrain();}
 };
 const facts=(record:DirectOperationRecord|{id:string;terminalKind:string})=>`[operation ${record.id}: ${'stage'in record?record.stage+':'+String(record.outcome):record.terminalKind}; duplicate delivery is not executed again]`;
 const withFactLease=async(work:(lease:SessionExecutionLease)=>Promise<void>)=>{
  const invocationId=`issued-fact:${randomUUID()}`;
  const scope=options.executionChain?await acquireSessionExecutionFactChain(options.executionChain,{invocationId}):await options.authority.acquire({invocationId,kind:'recovery'});
  const lease='childLease'in scope?scope.childLease as SessionExecutionLease:scope;
  try{await scope.trackInFlight(work(lease));}finally{await scope.releaseAfterDrain();}
 };
 const settlePrepared=(operationId:string,outcome:'cancelled'|'denied'|'invalid',compound=false)=>withFactLease(lease=>compound
  ?options.journal.settleIssuedPreparedCompoundFacts({operationId,outcome:outcome==='invalid'?'failed':outcome},lease)
  :options.journal.settleIssuedPreparedDirectFacts({operationId,outcome},lease));
 const settleCommittedValidation=(operationId:string,validationStatus:'cancelled'|'denied')=>withFactLease(lease=>options.journal.settleIssuedCommittedEditFacts({operationId,validationStatus},lease));
 async function run(request:Parameters<CompoundRegistryExecutionPort['execute']>[0],inputHash:string):Promise<string>{
  const {native,tool}=request;
  const context=request.context?{...request.context,signal:AbortSignal.any([request.context.signal,options.executionSignal,lifetime.signal].filter((s):s is AbortSignal=>!!s))}:undefined;
  assertExecutionCurrent();context?.signal?.throwIfAborted();
  if(!context||context.session.sessionId!==options.sessionIdentity||!context.hostProviderInvocationId||!context.toolInvocationId)throw Error('compound_dispatch_context_required');
  if(matches(cancellations,tool)){
   const adapter=getManagedCompoundCancellationAdapter(tool!);if(!adapter)throw Error('compound_managed_cancel_changed');
   const current=()=>{assertExecutionCurrent();context.signal.throwIfAborted();if(getManagedCompoundCancellationAdapter(tool!)!==adapter)throw Error('compound_managed_cancel_changed');adapter.assertCurrent();};
   current();const nativeInvocationId=`cancel:${digest([options.sessionIdentity,context.hostProviderInvocationId,context.toolInvocationId])}`;
   const prepared=await abortablePreparation(native.prepare(request.name,{...request.input},{signal:context.signal,toolInvocationId:nativeInvocationId}),context.signal);current();
   if(prepared.kind!=='prepared')return prepared.message;
   const ticket=adapter.prepareCancellation({nativeInvocationId,finalInput:prepared.invocation.input});
   let open=true,work:Promise<string>|undefined;
   try{
    const result=await adapter.runCancellation(ticket,()=>{
     if(!open||work)throw Error('compound_managed_cancel_replayed');current();
     work=Promise.resolve().then(()=>native.execute(prepared.invocation));return work;
    });
    if(!work||result!==await work)throw Error('compound_managed_cancel_result_changed');return result;
   }finally{open=false;if(work)await work.catch(()=>{});}
  }
  const readonly=matches(reads,tool);
  const query=matches(queries,tool)?options.observationQueries!.find(entry=>entry.tool===tool):undefined;
  const initial=await withLease(async lease=>{const ledger=await options.journal.read(lease);if(uncertain(ledger)&&matches(delegated,tool)&&options.assertSupervisedDelegation){options.assertSupervisedDelegation(lease);return {ledger,supervised:true};}return {ledger,supervised:false};},context.signal,!readonly&&!query);
  if(uncertain(initial.ledger)&&!initial.supervised&&!readonly&&!query)return 'Error: session mutation outcome unknown; explicit host recovery is required';
  if(query){
   query.assertCurrent();
   const prepared=await abortablePreparation(native.prepare(request.name,{...request.input},{signal:context.signal}),context.signal);
   assertExecutionCurrent();query.assertCurrent();
   if(prepared.kind!=='prepared')return prepared.message;
   // The fixed service query may wait on a child that needs this ancestor's
   // lease. Its original authorized publication barrier owns its own CAS.
   const result=await native.execute(prepared.invocation);
   assertExecutionCurrent();query.assertCurrent();return result;
  }
  if(readonly){
   const prepared=await abortablePreparation(native.prepare(request.name,{...request.input},{signal:context.signal}),context.signal);assertExecutionCurrent();
   if(prepared.kind!=='prepared')return prepared.message;
   // Read approval is lock-free, but its archive closure barrier must serialize
   // with this session's mutation/CAS writers. Unknown effect state still permits
   // the host-classified read; it cannot clear or alter that effect fact.
   return withLease(lease=>lease.trackInFlight(native.execute(prepared.invocation,options.createProjector?.(context.toolInvocationId!,lease))),context.signal,false);
  }
  if(matches(intentReports,tool))return options.intentReports!.execute({...request,context},(callback,signal,admission)=>withLease(async lease=>{if(uncertain(await options.journal.read(lease)))throw Error('session mutation outcome unknown; explicit host recovery is required');return callback(lease);},signal,true,admission),()=>{options.assertCurrent();if(!matches(intentReports,tool))throw Error('intent_producer_tool_changed');});
  if(matches(delegated,tool))return options.delegation!.execute({...request,context},inputHash,context.signal,withLease,settlePrepared);
  const isCommand=matches(commands,tool)&&!!options.validationBackend?.prepareDirectInput;
  if(!matches(files,tool)&&!isCommand)return 'Error: compound execution adapter is not qualified for this mutation';
  if(Object.hasOwn(request.input,'then_run')){
   if(isCommand)throw Error('compound_then_run_file_only');
   if(!options.validationBackend||!options.commandTool)return 'Error: qualified compound validation execution port is required';
   return executeCompoundFusion({request:{...request,context},inputHash,signal:context.signal,journal:options.journal,backend:options.validationBackend,
    permissionGeneration:options.getPermissionRevision(),assertCurrent:assertExecutionCurrent,noteCommittedRecord,getPermissionRevision:options.getPermissionRevision,
    assertCommandTool:()=>{if(!matches(commands,native.registeredTool('bash')))throw Error('compound_native_command_adapter_changed');},
    withLease,settleCommittedValidation,settlePrepared:(id,outcome)=>settlePrepared(id,outcome,true),persistCurrentHistory:options.persistCurrentHistory,createProjector:options.createProjector,composeResult:options.composeResult,prepare:abortablePreparation,uncertain});
  }
  const permissionGeneration=options.getPermissionRevision();
  const created=await withLease(async lease=>{
   if(uncertain(await options.journal.read(lease)))return undefined;
   await options.persistCurrentHistory?.(lease);
   return options.journal.createOrGetDirect({hostProviderInvocationId:context.hostProviderInvocationId!,originalToolUseId:context.toolInvocationId!,inputHash,toolName:tool!.definition.name,permissionGeneration},lease);
  },context.signal);
  if(!created)return 'Error: session mutation outcome unknown; explicit host recovery is required';
  if(!created.created)return facts(created.operation);
  let record=created.operation as DirectOperationRecord;
  let precondition:ReturnType<NonNullable<Tool['compoundFilePrecondition']>>|undefined;
  try{precondition=isCommand?undefined:tool!.compoundFilePrecondition!(request.input);}
  catch(error){await settlePrepared(record.id,'invalid');throw error;}
  let preparedCommandInput:Awaited<ReturnType<CompoundValidationBackend['prepareValidationInput']>>|undefined;
  let executionLease:SessionExecutionLease|undefined,started=false,committed=false,failedPersistence:unknown;
  let finalInputHash='';
  const persist=async(change:Parameters<Journal['advanceDirect']>[1])=>{
   if(!executionLease)throw Error('compound_native_phase_outside_lease');
   try{record=await options.journal.advanceDirect(record.id,change,executionLease);noteCommittedRecord(record);if(record.stage==='started')started=true;if(record.stage==='settled'&&record.quiescence)committed=true;return record;}catch(error){failedPersistence=error;throw error;}
  };
  // Every approval/hook stage is outside the session lock. Registry admission has
  // already excluded all unsupervised executable hook runners.
  const prepared=await abortablePreparation(native.prepare(request.name,{...request.input},{signal:context.signal,toolInvocationId:record.id,compoundPhase:isCommand?{
   executeIsolatedCommand:async(actual,revalidate)=>{if(!preparedCommandInput)throw Error('compound_materials_not_prepared');return executeDirectIsolatedCommand({backend:options.validationBackend!,preparedInput:preparedCommandInput,record,validationInvocationId:`${record.id}:command`,finalInputHash,actual,context,persist,assertCurrent:()=>{assertExecutionCurrent();executionLease?.assertCurrent();revalidate();}});},
  }:{
   assertBeforeFileMutation:()=>{assertExecutionCurrent();executionLease?.assertCurrent();},
   beforeFileMutation:async fact=>{if(fact.filePath!==precondition!.filePath||fact.beforeHash!==precondition!.beforeHash)throw Error('compound_file_precondition_changed');assertExecutionCurrent();executionLease?.assertCurrent();await persist({stage:'started',finalInputHash,fileFacts:{adapter:'synchronous-native-file-v1',path:fact.filePath,beforeHash:fact.beforeHash,afterHash:fact.afterHash}});started=true;},
   fileMutationCommitted:async fact=>{if(!record.fileFacts||fact.filePath!==record.fileFacts.path||fact.afterHash!==record.fileFacts.afterHash)throw Error('compound_file_commit_mismatch');await persist({stage:'settled',outcome:'completed',quiescence:'synchronous_file'});committed=true;},
  }}),context.signal).catch(async error=>{await settlePrepared(record.id,context.signal.aborted?'cancelled':'invalid');throw error;});
  if(prepared.kind==='not_started'){
   await settlePrepared(record.id,prepared.reason==='denied'?'denied':prepared.reason==='cancelled'?'cancelled':'invalid');
   return prepared.message;
  }
  finalInputHash=digest({name:prepared.invocation.toolName,input:prepared.invocation.input});
  if(isCommand){
   try{
    const command=prepared.invocation.input;
    preparedCommandInput=await abortablePreparation(options.validationBackend!.prepareDirectInput!({sessionIdentity:options.sessionIdentity,operationId:record.id,validationInvocationId:`${record.id}:command`,
     command:{command:String(command.command),workdir:typeof command.workdir==='string'?command.workdir:process.cwd()},signal:context.signal}),context.signal);
   }catch(error){
    await settlePrepared(record.id,context.signal.aborted?'cancelled':'denied');
    return 'Error: isolated command materials were not authorized; no command was dispatched';
   }
  }
  return withLease(async lease=>{
   executionLease=lease;assertExecutionCurrent();
   await options.persistCurrentHistory?.(lease);
   if(uncertain(await options.journal.read(lease)))return 'Error: session mutation outcome unknown; approved operation was not executed';
   if(options.getPermissionRevision()!==permissionGeneration){await persist({stage:'settled',outcome:'denied'});return 'Error: compound permission revision changed before mutation';}
   let result:string;
   try{result=await lease.trackInFlight(native.execute(prepared.invocation,options.createProjector?.(context.toolInvocationId!,lease)));}
   catch(error){if(failedPersistence)throw failedPersistence;if(started&&!committed&&record.stage==='started')await persist({stage:'outcome_unknown',outcome:'unknown'});throw error;}
   if(failedPersistence)throw failedPersistence;
   if(!started)await persist({stage:'settled',outcome:'invalid'});
   else if(!committed&&record.stage==='started')await persist({stage:'outcome_unknown',outcome:'unknown'});
   if(record.stage==='outcome_unknown'){
    const before=`Error: [operation ${record.id}; outcome=unknown; trusted recovery required]\n`;
    return options.composeResult?options.composeResult(context.toolInvocationId!,before,result,''):before+result;
   }
   return result;
  },context.signal).then(async result=>{
   if(record.stage==='prepared')await settlePrepared(record.id,context.signal.aborted?'cancelled':'invalid');
   return result;
  },async error=>{
   if(record.stage==='prepared'){
    try{await settlePrepared(record.id,context.signal.aborted?'cancelled':'invalid');}
    catch(settlementError){throw new AggregateError([error,settlementError],'compound_preparation_finalization_failed');}
   }
   throw error;
  });
 }
 return Object.freeze({describeTool(tool:Tool){
  if(!options.validationBackend||!options.commandTool||!matches(files,tool))return tool.definition;
  const definition=structuredClone(tool.definition),bashSchema=commands[0].definition.inputSchema;
  return {...definition,inputSchema:{...definition.inputSchema,properties:{...(definition.inputSchema.properties??{}),then_run:{type:'object',description:'仅编辑成功后运行独立授权的隔离验证；编辑成功而验证失败时保留编辑。',properties:structuredClone(bashSchema.properties??{}),required:['command'],additionalProperties:false}}}};
 },execute(request:Parameters<CompoundRegistryExecutionPort['execute']>[0]):Promise<string>{
  if(disposed)return Promise.reject(Error('compound_owner_disposed'));
  assertExecutionCurrent();const inputHash=digest({name:request.name,input:request.input});
  const key=JSON.stringify([options.sessionIdentity,request.context?.hostProviderInvocationId,request.context?.toolInvocationId]);
  const existing=pending.get(key);if(existing){if(existing.hash!==inputHash)return Promise.reject(Error('dispatch_identity_conflict'));return existing.promise;}
  const promise=Promise.resolve().then(()=>run(request,inputHash));pending.set(key,{hash:inputHash,promise});
  void promise.then(()=>pending.delete(key),()=>pending.delete(key));return promise;
 },async publishCurrentHistory():Promise<void>{
  if(disposed)throw Error('compound_owner_disposed');
  await withLease(async lease=>{await options.persistCurrentHistory?.(lease);await options.settlePublishedDelegations?.(lease);},options.executionSignal,false);
 },dispose():Promise<void>{
  if(disposal)return disposal;disposed=true;
  const original=[...pending.values()].map(entry=>entry.promise),errors:unknown[]=[];
  disposal=Promise.resolve().then(async()=>{
   const results=await Promise.allSettled(original);
   for(const result of results)if(result.status==='rejected'&&result.reason!==closeReason)errors.push(result.reason);
   if(errors.length)throw new AggregateError(errors,'compound_physical_drain_unconfirmed');
  });
  try{lifetime.abort(closeReason);}catch(error){errors.push(error);}return disposal;
 }});
}
