import {DSH_A_DIGEST} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {types} from 'node:util';
import {captureIpcData} from './ipc-data-snapshot.js';
import type {Purpose,DshOriginalReferences,MainDshKernelClockCut} from './main-dsh-bootstrap-types.js';
const apply=Reflect.apply,freeze=Object.freeze,create=Object.create,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,keys=Reflect.ownKeys,define=Object.defineProperty,NativeWeakMap=WeakMap;
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,isProxy=types.isProxy,NativeError=Error;
function denied():never{throw new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED');}
export function createOriginalMainDshFrames(local:()=>void,current:()=>void,hasStore:()=>boolean){
  const frames=new NativeWeakMap<object,{purpose:Purpose;data:unknown;refs:DshOriginalReferences}>();
  const freezeData=(value:unknown):unknown=>{if(value&&typeof value==='object'){const names=keys(value);for(let i=0;i<names.length;i++){const row=descriptor(value,names[i]!)!;if(own(row,'value'))freezeData(row.value);}freeze(value);}return value;};
  const captureReferences=(raw:DshOriginalReferences|undefined):DshOriginalReferences=>{
   if(raw===undefined)return freeze(create(null));if(!raw||typeof raw!=='object'||isProxy(raw))denied();
   const out=create(null),names=keys(raw);
   for(let i=0;i<names.length;i++){const key=names[i]!;if(key!=='budgetObservation'&&key!=='budgetAttempt'&&key!=='budgetReservation'&&key!=='modelAttempt'&&key!=='ownerObservation'&&key!=='sourceScan'&&key!=='userControlProof'&&key!=='providerDateFact'&&key!=='budgetReserveProof'&&key!=='admissionProposal'&&key!=='budgetWorkSnapshot')denied();const row=descriptor(raw,key);if(!row||!own(row,'value')||!row.enumerable||!row.value||typeof row.value!=='object'||isProxy(row.value)||types.isPromise(row.value))denied();define(out,key,{__proto__:null,value:row.value,enumerable:true} as PropertyDescriptor);}
   return freeze(out);
  };
  const open=(purpose:Purpose,input:unknown,refs?:DshOriginalReferences)=>{local();if(!hasStore())denied();current();const data=freezeData(captureIpcData(input,'DSH_MAIN_COMMAND_INVALID')),references=captureReferences(refs),proof=freeze(create(null));current();apply(set,frames,[proof,{purpose,data,refs:references}]);local();return proof;};
  const references=(proof:object,purpose:string)=>{const row=apply(get,frames,[proof]) as {purpose:Purpose;refs:DshOriginalReferences}|undefined;if(!row||row.purpose!==purpose)denied();current();local();return row.refs;};
  const resolveFrame=(proof:object,purpose:string)=>{const frame=apply(get,frames,[proof]) as {purpose:Purpose;data:unknown}|undefined;if(!frame||frame.purpose!==purpose)denied();current();local();return freeze({data:frame.data,assertCurrent:current});};
  const methods=freeze({
   openBootstrap(purpose:'initialize'|'migrate_admission'){if(purpose!=='initialize'&&purpose!=='migrate_admission')denied();return open(purpose,purpose==='initialize'?{schemaVersion:1}:{schemaVersion:1,expectedProfileDigest:DSH_A_DIGEST});},
   openReadBasis(data:unknown,refs?:DshOriginalReferences){return open('read_basis',data,refs);},
   openReadHistory(data:unknown,refs?:DshOriginalReferences){return open('read_history',data,refs);},
   openAssessmentReserve(data:unknown,refs?:DshOriginalReferences){return open('assessment_reserve',data,refs);},
   openAssessmentResult(data:unknown,refs?:DshOriginalReferences){return open('assessment_result',data,refs);},
   openAdmissionCommit(data:unknown,refs?:DshOriginalReferences){return open('admission_commit',data,refs);},
   openDraftPrepare(data:unknown,refs?:DshOriginalReferences){return open('draft_prepare',data,refs);},
   openOwnerReconcile(data:unknown,refs?:DshOriginalReferences){return open('owner_reconcile',data,refs);},
   openSourceScan(data:unknown,refs?:DshOriginalReferences){return open('source_scan',data,refs);},
   openAdmissionWindow(data:unknown,refs?:DshOriginalReferences){return open('admission_window',data,refs);},
   openControlReceipt(data:unknown,refs?:DshOriginalReferences){return open('control_receipt',data,refs);},
   openSourceControl(data:unknown,refs?:DshOriginalReferences){return open('source_control',data,refs);},
   openClaimCommand(data:unknown,refs?:DshOriginalReferences){return open('claim_command',data,refs);},
   openGithubSourceRead(data:unknown,refs?:DshOriginalReferences){return open('github_source_read',data,refs);},
   openGithubSourceSetup(data:unknown,refs?:DshOriginalReferences){return open('github_source_setup',data,refs);},
   resolve(proof:object,purpose:string){return resolveFrame(proof,purpose);},
  });
  return freeze({references,methods});
}
export function captureOriginalMainDshCoreBootstrap(raw:unknown):'fresh'|'restored'{
    const view=captureIpcData(raw,'DSH_MAIN_CORE_BOOTSTRAP_UNCONFIRMED') as Record<string,unknown>;
    if(!view||typeof view!=='object'||keys(view).length!==6||view.kind!=='original_main_pool_bootstrap_v1'||(view.bootstrap!=='fresh'&&view.bootstrap!=='restored')||view.profile!=='ordinary_runtime_root_resource_reservation_writer_v8_protected_io'||view.schemaVersion!==4||typeof view.semanticDigest!=='string'||!/^[a-f0-9]{64}$/.test(view.semanticDigest)||typeof view.businessSealed!=='boolean')denied();
    if(view.businessSealed)denied();return view.bootstrap;
}
export function captureOriginalMainDshClockCut(raw:unknown):MainDshKernelClockCut{
   if(!raw||typeof raw!=='object'||isProxy(raw)||types.isPromise(raw))denied();
   const captured=captureIpcData(raw,'DSH_MAIN_CLOCK_CUT_INVALID') as unknown as MainDshKernelClockCut;
   if(keys(captured).length!==5||captured.kind!=='main_kernel_clock_cut_v1'||typeof captured.domainId!=='string'||!/^[a-f0-9]{64}$/.test(captured.domainId)||typeof captured.continuousLowerNs!=='string'||!/^[0-9]{1,20}$/.test(captured.continuousLowerNs)||typeof captured.continuousUpperNs!=='string'||!/^[0-9]{1,20}$/.test(captured.continuousUpperNs)||!Number.isSafeInteger(captured.wallMs)||captured.wallMs<0||captured.wallMs>253402300799999||Object.is(captured.wallMs,-0)||BigInt(captured.continuousUpperNs)<BigInt(captured.continuousLowerNs)||BigInt(captured.continuousUpperNs)-BigInt(captured.continuousLowerNs)>1000000000n)denied();
   return captured;
}
