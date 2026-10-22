// Test-only synchronous receipts. Never inspects an arbitrary error or Promise.
import {openSync,writeSync,fsyncSync}from 'node:fs';
import {createHash}from 'node:crypto';
const nativeOpen=openSync,nativeWrite=writeSync,nativeFsync=fsyncSync,nativeHash=createHash;
const stringify=JSON.stringify,assign=Object.assign,create=Object.create,is=Object.is,isSafe=Number.isSafeInteger;
export const OWNED_SESSION_PHASES=Object.freeze([
 'journal_ready','module_guard_import','ordinary_guard_dispose',
 'module_store','module_service','module_coordinator','module_runtime','module_host','module_snapshot','module_material','module_catalog','module_services','module_config','module_bootstrap','module_admission',
 'compiler_helpers_import','compile_delivery','compile_protection','worker_start','worker_exit','worker_observation','prepare_observed_session','root_response','store_construct','tools_import','service_initialize','prepare_root','start_task','prepared_entered','journal_entered',
 'session_dispose_start','pending_check','session_dispose_outcome','dispose_observation','stop_receipts','body_failure',
 'finally_gate_release','finally_session_stop','finally_service_stop','finally_host_stop','retention_record',
]);
const codes=new Set(OWNED_SESSION_PHASES),states=new Set(['entered','fulfilled','rejected']);
/** Caller owns/strongly retains the FD, every original error, and all raw records. */
export function createOwnedSessionShutdownJournal({file,runNonce,fixtureNonce,pid,ppid,keep}){
 if(typeof file!=='string'||!file.startsWith('/')||typeof runNonce!=='string'||!(/^[a-f0-9]{32}$/).test(runNonce)||typeof fixtureNonce!=='string'||!(/^[a-f0-9-]{36}$/).test(fixtureNonce)||!isSafe(pid)||pid<=0||!isSafe(ppid)||ppid<=0||typeof keep!=='function')throw Error('owned_session_phase_identity');
 const fd=keep('phase-native-fd',nativeOpen(file,'wx',0o600));
 const retained=keep('phase-raw-records',[]),errors=keep('phase-original-error-slots',[]);let seq=0,previousHash='0'.repeat(64);
 function errorSlot(error){let at=errors.findIndex(e=>is(e,error));if(at<0){keep('phase-incoming-error',error);if(errors.length>=4096)throw Error('owned_session_phase_error_limit');at=errors.length;errors.push(error);keep('phase-original-error-'+(at+1),error);}return at+1;}
 function record(phaseCode,state,slot=null,facts=null){
  if(seq>=4096)throw Error('owned_session_phase_record_limit');
  if(!codes.has(phaseCode)||!states.has(state)||(state==='rejected'?(!isSafe(slot)||slot<1||slot>errors.length):slot!==null))throw Error('owned_session_phase_schema');
  let matchesPhysicalF=null,executionCount=null,transportCount=null,tailCount=null,returnedCount=null,observerErrors=null;
  if(phaseCode==='dispose_observation'){
   if(!facts||typeof facts.matchesPhysicalF!=='boolean')throw Error('owned_session_phase_facts');
   ({matchesPhysicalF,executionCount,transportCount,tailCount,returnedCount,observerErrors}=facts);
   if(![executionCount,transportCount,tailCount,returnedCount,observerErrors].every(n=>isSafe(n)&&n>=0&&n<=1024))throw Error('owned_session_phase_facts');
  }else if(facts!==null&&!['worker_start','worker_exit','worker_observation'].includes(phaseCode))throw Error('owned_session_phase_facts');
  let workerKind=null,workerOrdinal=null,workerThreadId=null,workerExitCode=null,workerStarts=null,workerExits=null,workerObserverErrors=null;
  if(['worker_start','worker_exit','worker_observation'].includes(phaseCode)){
   if(!facts)throw Error('owned_session_phase_worker_facts');
   if(phaseCode==='worker_observation'){
    ({workerStarts,workerExits,workerObserverErrors}=facts);
    if(![workerStarts,workerExits,workerObserverErrors].every(n=>isSafe(n)&&n>=0&&n<=1024))throw Error('owned_session_phase_worker_facts');
   }else{
    ({workerKind,workerOrdinal,workerThreadId}=facts);workerExitCode=phaseCode==='worker_exit'?facts.workerExitCode:null;
    if(!['delivery','protection'].includes(workerKind)||!isSafe(workerOrdinal)||workerOrdinal<1||workerOrdinal>1024||!isSafe(workerThreadId)||workerThreadId<1||phaseCode==='worker_exit'&&(!isSafe(workerExitCode)||workerExitCode<0||workerExitCode>2147483647))throw Error('owned_session_phase_worker_facts');
   }
  }
  const row=assign(create(null),{schemaVersion:1,seq:seq+1,runNonce,fixtureNonce,pid,ppid,phaseCode,state,errorSlot:slot,matchesPhysicalF,executionCount,transportCount,tailCount,returnedCount,observerErrors,workerKind,workerOrdinal,workerThreadId,workerExitCode,workerStarts,workerExits,workerObserverErrors,previousHash});
  const hash=nativeHash('sha256').update(stringify(row)).digest('hex');const bytes=Buffer.from(stringify(assign(create(null),row,{hash}))+'\n');
  keep('phase-pending-row',row);keep('phase-pending-bytes',bytes);retained.push(row);
  let offset=0;while(offset<bytes.length){const count=nativeWrite(fd,bytes,offset,bytes.length-offset);if(!isSafe(count)||count<=0)throw Error('owned_session_phase_short_write');offset+=count;}nativeFsync(fd);
  seq++;previousHash=hash;return row;
 }
 function rejected(code,error,facts=null){try{const slot=errorSlot(error);return record(code,'rejected',slot,facts);}catch(receiptError){keep('phase-original-receipt-error',receiptError);throw new AggregateError([error,receiptError],'owned_session_original_and_phase_failed',{cause:error});}}
 const journal=Object.freeze({record,rejected,errorSlot});keep('phase-journal',journal);record('journal_ready','fulfilled');return journal;
}
