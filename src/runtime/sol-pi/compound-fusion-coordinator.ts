import {createHash} from 'node:crypto';
import type {Tool} from '../../types.js';
import type {CompoundRegistryExecutionPort} from '../../ai/tools/index.js';
import type {SessionExecutionLease} from '../../ai/runtime/session-store/execution-authority.js';
import type {createCompoundSessionJournal} from './compound-session-journal.js';
import type {CompoundOperationRecord,CompoundOperationLedger,CompoundAdvance} from './compound-operation.js';
import {executeCompoundValidation,type CompoundValidationBackend} from './compound-validation.js';

type Request=Parameters<CompoundRegistryExecutionPort['execute']>[0];
type Journal=ReturnType<typeof createCompoundSessionJournal>;
export function parseCompoundValidation(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('compound_then_run_invalid');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(key=>!['command','workdir','timeout_ms','max_chars'].includes(key))||typeof v.command!=='string'||!v.command.trim()
  ||(v.workdir!==undefined&&typeof v.workdir!=='string')||['timeout_ms','max_chars'].some(key=>v[key]!==undefined&&(!Number.isFinite(v[key])||Number(v[key])<=0)))throw Error('compound_then_run_invalid');
 return structuredClone(v);
}
/** Combines the actual Registry preparation/execution APIs; it is not an issuer
 * of either file permission or isolated-engine qualification. */
export async function executeCompoundFusion(input:{
 request:Request;inputHash:string;signal:AbortSignal;journal:Journal;backend:CompoundValidationBackend;
 permissionGeneration:number;assertCurrent():void;getPermissionRevision():number;
 assertCommandTool():void;
 noteCommittedRecord?(record:CompoundOperationRecord):void;
 withLease<T>(work:(lease:SessionExecutionLease)=>Promise<T>,signal?:AbortSignal):Promise<T>;
 settlePrepared(id:string,outcome:'cancelled'|'denied'|'invalid'):Promise<void>;
 settleCommittedValidation(id:string,status:'cancelled'|'denied'):Promise<void>;
 persistCurrentHistory?(lease:SessionExecutionLease):Promise<void>;
 composeResult?(invocationId:string,before:string,body:string,after:string):string;
 createProjector?(invocationId:string,lease:SessionExecutionLease):(nativeResult:string)=>Promise<string>;
 prepare<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>;
 uncertain(ledger:CompoundOperationLedger):boolean;
}):Promise<string>{
 const {request,journal,signal,withLease}=input,context=request.context!,native=request.native,tool=request.tool as Tool;
 const validationInput=parseCompoundValidation(request.input.then_run),editInput={...request.input};delete editInput.then_run;
 input.assertCommandTool();
 const created=await withLease(async lease=>{
  if(input.uncertain(await journal.read(lease)))throw Error('compound_session_outcome_unknown');
  await input.persistCurrentHistory?.(lease);
  return journal.createOrGet({hostProviderInvocationId:context.hostProviderInvocationId!,originalToolUseId:context.toolInvocationId!,inputHash:input.inputHash,toolName:tool.definition.name as 'edit'|'write',permissionGeneration:input.permissionGeneration},lease);
 },signal);
 if(!created.created)return `[operation ${created.operation.id}; duplicate delivery is not executed again]`;
 let record=created.operation as CompoundOperationRecord;const currentStage=()=>record.stage;
 let precondition:ReturnType<NonNullable<Tool['compoundFilePrecondition']>>;
 try{precondition=tool.compoundFilePrecondition!(editInput);}
 catch(error){await input.settlePrepared(record.id,'invalid');throw error;}
 let lease:SessionExecutionLease|undefined,failedPersistence:unknown;
 const persist=async(change:CompoundAdvance)=>{
  if(!lease)throw Error('compound_native_phase_outside_lease');
  try{record=await journal.advance(record.id,change,lease);input.noteCommittedRecord?.(record);}catch(error){failedPersistence=error;throw error;}
 };
 let finalInputHash='';let preparedInput:Awaited<ReturnType<CompoundValidationBackend['prepareValidationInput']>>|undefined;
 const edit=await input.prepare(native.prepare(request.name,editInput,{signal,toolInvocationId:record.editInvocationId,compoundPhase:{
  assertBeforeFileMutation:()=>{input.assertCurrent();lease?.assertCurrent();},
  beforeFileMutation:async fact=>{
   if(fact.filePath!==precondition.filePath||fact.beforeHash!==precondition.beforeHash)throw Error('compound_file_precondition_changed');
   input.assertCurrent();lease?.assertCurrent();await persist({stage:'edit_started',finalInputHash,file:{path:fact.filePath,beforeHash:fact.beforeHash,afterHash:fact.afterHash}});
  },
  fileMutationCommitted:async fact=>{if(!record.file||record.file.path!==fact.filePath||record.file.afterHash!==fact.afterHash)throw Error('compound_file_commit_mismatch');await persist({stage:'edit_committed',file:{path:fact.filePath,beforeHash:precondition.beforeHash,afterHash:fact.afterHash}});},
 }}),signal).catch(async error=>{await input.settlePrepared(record.id,signal.aborted?'cancelled':'invalid');throw error;});
 if(edit.kind!=='prepared'){
  await input.settlePrepared(record.id,edit.reason==='cancelled'?'cancelled':edit.reason==='denied'?'denied':'invalid');
  return edit.message;
 }
 // Both independent approval interactions happen before reacquiring the effect
 // lease. A denied validator does not revoke a separately approved file edit.
 const validation=await input.prepare(native.prepare('bash',validationInput,{signal,toolInvocationId:record.validationInvocationId,compoundPhase:{
  executeIsolatedCommand:async(actual,revalidate)=>{if(!preparedInput)throw Error('compound_materials_not_prepared');return executeCompoundValidation({backend:input.backend,preparedInput,record,actual,
   context:{...context,signal},persist,assertCurrent:()=>{input.assertCurrent();lease?.assertCurrent();input.assertCommandTool();revalidate();}});},
 }}),signal).catch(async error=>{await input.settlePrepared(record.id,signal.aborted?'cancelled':'invalid');throw error;});
 finalInputHash=createHash('sha256').update(JSON.stringify({edit:edit.invocation.input,validation:validation.kind==='prepared'?validation.invocation.input:validationInput})).digest('hex');
 const edited=await withLease(async acquired=>{
  lease=acquired;input.assertCurrent();input.assertCommandTool();
  await input.persistCurrentHistory?.(lease);
  if(input.uncertain(await journal.read(lease)))throw Error('compound_session_outcome_unknown');
  if(input.getPermissionRevision()!==input.permissionGeneration){await persist({stage:'settled',editStatus:'denied'});return 'Error: compound permission revision changed before editing';}
  let editResult:string;
  try{editResult=await lease.trackInFlight(native.execute(edit.invocation,input.createProjector?.(context.toolInvocationId!,lease)));}
  catch(error){if(failedPersistence)throw failedPersistence;if(currentStage()==='edit_started')await persist({stage:'outcome_unknown'});throw error;}
  if(failedPersistence)throw failedPersistence;
  if(currentStage()!=='edit_committed'){
   if(currentStage()==='edit_started')await persist({stage:'outcome_unknown'});
   else await persist({stage:'settled',editStatus:'failed'});
   return `Error: [operation ${record.id}; edit=${record.editStatus}; validation=not_started]\n${editResult}`;
  }
  if(validation.kind!=='prepared'){
   await persist({stage:'settled',validation:{status:validation.reason==='cancelled'?'cancelled':'denied',exitCode:null}});
   return `Error: [operation ${record.id}; edit=succeeded; validation=${record.validation.status}]\n${editResult}\n${validation.message}`;
  }
  return {editResult};
 },signal);
 if(typeof edited==='string')return edited;
 try{
  input.assertCurrent();signal.throwIfAborted();
  const final=validation.kind==='prepared'?validation.invocation.input:validationInput;
  preparedInput=await input.prepare(input.backend.prepareValidationInput({sessionIdentity:record.dispatch.sessionIdentity,compoundOperationId:record.id,
   validationInvocationId:record.validationInvocationId,editedFile:structuredClone(record.file!),command:{command:String(final.command),workdir:typeof final.workdir==='string'?final.workdir:process.cwd()},signal}),signal);
 }catch(error){
  await input.settleCommittedValidation(record.id,signal.aborted?'cancelled':'denied');
  return `Error: [operation ${record.id}; edit=succeeded; validation=not_started; material authorization unavailable]\n${edited.editResult}`;
 }
 return withLease(async acquired=>{
  lease=acquired;input.assertCurrent();input.assertCommandTool();
  const ledger=await journal.read(lease),durable=ledger.operations.find(item=>item.id===record.id);
  if(!durable||durable.stage!=='edit_committed'||durable.finalInputHash!==record.finalInputHash||JSON.stringify(durable.file)!==JSON.stringify(record.file))throw Error('compound_validation_operation_changed');
  if(input.uncertain(ledger))throw Error('compound_session_outcome_unknown');
  const currentFile=tool.compoundFilePrecondition!(editInput);
  if(currentFile.filePath!==record.file!.path||currentFile.beforeHash!==record.file!.afterHash||input.getPermissionRevision()!==input.permissionGeneration){
   await persist({stage:'settled',validation:{status:'denied',exitCode:null}});return 'Error: edited file or permission changed while validation materials were approved; edit was not replayed';
  }
  await input.persistCurrentHistory?.(lease);
  if(validation.kind!=='prepared')throw Error('compound_validation_not_prepared');
  let validationResult:string;
  try{validationResult=await lease.trackInFlight(native.execute(validation.invocation,input.createProjector?.(context.toolInvocationId!,lease)));}
  catch(error){if(failedPersistence)throw failedPersistence;if(currentStage()==='validation_started')await persist({stage:'outcome_unknown'});throw error;}
  if(failedPersistence)throw failedPersistence;
  if(currentStage()==='edit_committed')await persist({stage:'settled',validation:{status:'not_started',exitCode:null}});
  else if(currentStage()==='validation_started')await persist({stage:'outcome_unknown'});
  const before = `${record.validation.status==='succeeded'?'':'Error: '}[operation ${record.id}; edit=succeeded; validation=${record.validation.status}; exitCode=${record.validation.exitCode}]\n${edited.editResult}\n`;
  return input.composeResult ? input.composeResult(context.toolInvocationId!,before,validationResult,'') : before+validationResult;
 },signal);
}
