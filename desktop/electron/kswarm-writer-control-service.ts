import type {IpcMainInvokeEvent} from 'electron';
import {captureIpcData} from './ipc-data-snapshot.js';
import {inspectKSwarmWriter,prepareKSwarmInitialPlanWriter,isKSwarmOwnedControlUnavailable,type KSwarmService} from './kswarm-service.js';
import type {KSwarmWriterControlSource,WriterControlFrame} from './kswarm-writer-control-source.js';
import {WRITER_CONTROL_OUTPUT,type WriterControlMethod,type WriterControlResult} from '../shared/kswarm-writer-control-ipc-contract.js';
export interface WriterControlInvocation {readonly frame:WriterControlFrame;run():Promise<WriterControlResult>;fail(error:unknown):void}
export interface KSwarmWriterControlService {
 openInspect(event:IpcMainInvokeEvent,requestSource:'user'|'agent'|'scheduler'):WriterControlInvocation;
 openPrepare(event:IpcMainInvokeEvent,requestSource:'user'|'agent'|'scheduler'):WriterControlInvocation;
 openMigrate(event:IpcMainInvokeEvent,requestSource:'user'|'agent'|'scheduler'):WriterControlInvocation;
 readFailure(method:WriterControlMethod):unknown;
}
function closed(value:WriterControlResult):WriterControlResult{return Object.freeze(WRITER_CONTROL_OUTPUT.parse(value));}
const unavailable=(reason:Extract<WriterControlResult,{ok:false}>['reason'])=>closed({ok:false,state:'unavailable',reason,canPrepare:false,canMigrate:false});
/** Configuration only. It neither starts services nor authorizes project/model
 * execution. Native failures keep their original object and remote cause. */
export function createKSwarmWriterControlService(options:{source:KSwarmWriterControlSource;service:KSwarmService}):KSwarmWriterControlService{
 const source=options.source,service=options.service,failures=new Map<WriterControlMethod,unknown>(),hasFailure=failures.has.bind(failures),setFailure=failures.set.bind(failures),getFailure=failures.get.bind(failures);
 let preparationUnknown=false;
 function project(method:WriterControlMethod,raw:unknown):WriterControlResult{
  const value=captureIpcData(raw,'WRITER_CONTROL_RESPONSE_INVALID') as {ok?:unknown;error?:unknown;profile?:Record<string,unknown>};
  if(!value||typeof value!=='object')throw Error('WRITER_CONTROL_RESPONSE_INVALID');
  if(value.ok===false){
   if(value.error==='INITIAL_PLAN_FRESH_STORE_REQUIRED')return unavailable('existing_data');
   if(value.error==='INITIAL_PLAN_FRESH_RECONCILIATION_REQUIRED')return unavailable('reconciliation_required');
   if(['INITIAL_PLAN_PROFILE_UNQUALIFIED','PROTECTED_PROTOCOL_STORAGE_REQUIRED','PROJECT_SCOPE_MISMATCH'].includes(value.error as string))return unavailable('storage_unavailable');
   throw Error('WRITER_CONTROL_RESPONSE_INVALID');
  }
  if(value.ok!==true||!value.profile||typeof value.profile!=='object')throw Error('WRITER_CONTROL_RESPONSE_INVALID');
  if(method==='prepare'){
   if(value.profile.schemaVersion!==2||value.profile.profile!=='ordinary_initial_plan_acceptance_writer_v1')throw Error('WRITER_CONTROL_RESPONSE_INVALID');
  }else{
   if(!Object.hasOwn(value.profile,'floor'))throw Error('WRITER_CONTROL_RESPONSE_INVALID');
   if(value.profile.floor===null)return closed({ok:true,state:'unprepared',reason:'none',canPrepare:true,canMigrate:false});
   if(!value.profile.floor||typeof value.profile.floor!=='object')throw Error('WRITER_CONTROL_RESPONSE_INVALID');
  }
  return closed({ok:true,state:'prepared',reason:'none',canPrepare:false,canMigrate:false});
 }
 function open(method:WriterControlMethod,event:IpcMainInvokeEvent,requestSource:'user'|'agent'|'scheduler'):WriterControlInvocation{
  if(requestSource!=='user')throw Error('WRITER_CONTROL_AUTHORITY_REQUIRED');
  const frame=method==='prepare'?source.openPrepare(event,requestSource):source.openInspect(event,requestSource);let consumed=false,attempted=false;
  const operation=method==='prepare'?'prepare_initial_plan_writer':'inspect_writer';
  function fail(error:unknown){if(!hasFailure(method))setFailure(method,error);if(method==='prepare'&&attempted)preparationUnknown=true;}
  return Object.freeze({frame,fail,async run(){
   if(consumed)throw Error('WRITER_CONTROL_INVOCATION_CONSUMED');consumed=true;
   try{
    frame.assertCurrent();
    // No qualification source is installed yet. Metadata never opens migration.
    if(method==='migrate')return unavailable('runtime_not_ready');
    if(method==='prepare'&&preparationUnknown)throw Error('OWNED_CONTROL_OUTCOME_UNKNOWN');
    attempted=true;
    const raw=await (method==='prepare'?prepareKSwarmInitialPlanWriter(service,frame.context):inspectKSwarmWriter(service,frame.context));
    const result=project(method,raw);frame.assertCurrent();return method==='inspect'&&preparationUnknown?unavailable('outcome_unknown'):result;
   }catch(error){
    if(isKSwarmOwnedControlUnavailable(error,service,operation,frame.context)){attempted=false;if(!hasFailure(method))setFailure(method,error);return unavailable('not_owned');}
    fail(error);
    throw error;
   }
  }});
 }
 return Object.freeze({openInspect:(event:IpcMainInvokeEvent,who:'user'|'agent'|'scheduler')=>open('inspect',event,who),openPrepare:(event:IpcMainInvokeEvent,who:'user'|'agent'|'scheduler')=>open('prepare',event,who),openMigrate:(event:IpcMainInvokeEvent,who:'user'|'agent'|'scheduler')=>open('migrate',event,who),readFailure:getFailure});
}
