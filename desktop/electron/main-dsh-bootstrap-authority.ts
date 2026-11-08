import {ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED} from './root-resource-production-qualification.js';
import type {OriginalAdmissionDatabaseBundle} from './protected-authority-database-types.js';
import {readOriginalGithubProviderDateFact,type GithubProviderDateFact} from './dsh-github-source-session.js';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {readOriginalDshAdmissionPort} from './desktop-multi-agent-store.js';
import {DSH_A_DIGEST} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {loadOriginalMainResourceAuthority} from '../../src/runtime/verification/original-main-native-loader.js';
import {prepareOriginalProtectedBudgetWorker,prepareOriginalProtectedAdmissionDatabase} from './harness-protected-budget-worker.js';
import {readOriginalHarnessBudgetWorkerBirth,HarnessOptimizationLifecycle,assertOriginalHarnessBudgetLifecycle} from './harness-optimization-lifecycle.js';
const parseClockDate=Date.parse,clockInteger=Number.isSafeInteger,clockAbs=Math.abs,clockMax=Math.max;
const requireNative=createRequire(import.meta.url),addonPath=join(dirname(fileURLToPath(import.meta.url)),'main_bootstrap.node');
const apply=Reflect.apply,freeze=Object.freeze,create=Object.create,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,keys=Reflect.ownKeys,define=Object.defineProperty,NativeWeakMap=WeakMap;
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,isProxy=types.isProxy,NativeError=Error,FunctionPrototype=Function.prototype,prototype=Object.getPrototypeOf;
type Purpose='initialize'|'migrate_admission'|'read_basis'|'read_history'|'assessment_reserve'|'assessment_result'|'admission_commit'|'owner_reconcile'|'source_scan'|'admission_window'|'control_receipt'|'source_control'|'claim_command'|'github_source_read'|'github_source_setup'|'draft_prepare';
export interface DshOriginalReferences {readonly budgetObservation?:object;readonly budgetAttempt?:object;readonly budgetReservation?:object;readonly modelAttempt?:object;readonly ownerObservation?:object;readonly sourceScan?:object;readonly userControlProof?:object;readonly providerDateFact?:object;readonly budgetReserveProof?:object;readonly admissionProposal?:object;readonly budgetWorkSnapshot?:object}
export interface MainDshBootstrapView {readonly kind:'main_dsh_native_bootstrap_v1';assertCurrent():void;assertLocal():void}
export interface MainDshBootstrapAuthority {
 bindStore(store:object):void;
 openBootstrap(purpose:'initialize'|'migrate_admission'):object;
 openReadBasis(data:unknown,refs?:DshOriginalReferences):object;
 openReadHistory(data:unknown,refs?:DshOriginalReferences):object;
 openAssessmentReserve(data:unknown,refs?:DshOriginalReferences):object;
 openAssessmentResult(data:unknown,refs?:DshOriginalReferences):object;
 openAdmissionCommit(data:unknown,refs?:DshOriginalReferences):object;
 openDraftPrepare(data:unknown,refs?:DshOriginalReferences):object;
 openOwnerReconcile(data:unknown,refs?:DshOriginalReferences):object;
 openSourceScan(data:unknown,refs?:DshOriginalReferences):object;
 openAdmissionWindow(data:unknown,refs?:DshOriginalReferences):object;
 openControlReceipt(data:unknown,refs?:DshOriginalReferences):object;
 openSourceControl(data:unknown,refs?:DshOriginalReferences):object;
 openClaimCommand(data:unknown,refs?:DshOriginalReferences):object;
 openGithubSourceRead(data:unknown,refs?:DshOriginalReferences):object;
 openGithubSourceSetup(data:unknown,refs?:DshOriginalReferences):object;
 resolve(frame:object,purpose:string):Readonly<{data:unknown;assertCurrent():void}>;
 seal():void;
}
export interface MainDshKernelClockCut {readonly kind:'main_kernel_clock_cut_v1';readonly domainId:string;readonly continuousLowerNs:string;readonly continuousUpperNs:string;readonly wallMs:number}
interface State {startedCore():object|null;readAdmission():OriginalAdmissionDatabaseBundle|null;prepareInstalled(core?:boolean):object;observeClock(fact:GithubProviderDateFact):void;clockView():MainDshClockView;clock():Readonly<MainDshKernelClockCut>|null;authority:MainDshBootstrapAuthority;store?:object;current():void;local():void;references(proof:object,purpose:string):DshOriginalReferences}
const realms=new NativeWeakMap<object,State>();let singleton:MainDshBootstrapAuthority|undefined,birthAttempted=false,birthFailure:unknown;
interface InstalledPool {assertReadyForOwner():void;open():Promise<object>;close():Promise<void>;startCore():Promise<void>;returnOwner():Promise<void>;readBootstrap(session:unknown):Promise<'fresh'|'restored'>;prepareBudgetWorker(prepared:unknown):Promise<object>;readAdmission():OriginalAdmissionDatabaseBundle|null}
const installedPools=new NativeWeakMap<object,InstalledPool>();
const NativePromise=Promise,nativeThen=Promise.prototype.then;
const originalProtectedLifecyclePrepare=HarnessOptimizationLifecycle.prototype.prepareProtectedStorage;
const rejected=<T>(raw:unknown):Promise<T>=>new NativePromise<T>((_yes,no)=>no(raw));
/** Passive private lease: no caller path, issuer, Native API or verifier. */
export function prepareOriginalMainDshInstalledRootPool(realm:unknown,store:unknown):object {
 const row=apply(get,realms,[realm]) as State|undefined;
 if(arguments.length!==2||!row||!store||row.store!==store)denied();
 row.local();return row.prepareInstalled();
}
/** Passive exact Core identity. A prepared/pending/retiring Core is never
 * legacy absence. This cannot prepare a lease, open Native IO or mint a role. */
export function readOriginalMainDshStartedCore(realm:unknown,store:unknown):object|null {
 const row=apply(get,realms,[realm]) as State|undefined;
 if(arguments.length!==2||!row||!store||row.store!==store)denied();
 row.local();const core=row.startedCore();row.local();return core;
}
export function openOriginalMainDshInstalledRootPool(lease:unknown):Promise<object> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.open();
}
/** Synchronous fixed database bundle; only a genuine legacy realm returns null. */
export function readOriginalMainDshAdmissionDatabase(realm:unknown):OriginalAdmissionDatabaseBundle|null{
 const row=apply(get,realms,[realm]) as State|undefined;
 if(arguments.length!==1)denied();if(!row){if(!ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED)return null;denied();}row.local();return row.readAdmission();
}
/** Negative only; remains available after the business authority is sealed. */
export function closeOriginalMainDshInstalledRootPool(lease:unknown):Promise<void> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.close();
}
/** Infrastructure only. The original realm exists before any business Store. */
export function prepareOriginalMainDshCoreInfrastructure(realm:unknown):object {
 const row=apply(get,realms,[realm]) as State|undefined;
 if(arguments.length!==1||!row)denied();row.local();return row.prepareInstalled(true);
}
export function startOriginalMainDshCoreInfrastructure(lease:unknown):Promise<void> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.startCore();
}
/** Fixed infrastructure consumer. Native issuer/session never leave Core. */
export function prepareOriginalMainDshBudgetWorker(lease:unknown,prepared:unknown):Promise<object>{
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==2||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.prepareBudgetWorker(prepared);
}
/** Passive same-Core readiness. No raw Native session/API is disclosed. */
export function assertOriginalMainDshCoreReady(lease:unknown):void{
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row||!row.readAdmission())denied();
}
export async function prepareOriginalMainDshBudgetLifecycle(lease:unknown,lifecycle:HarnessOptimizationLifecycle):Promise<Awaited<ReturnType<HarnessOptimizationLifecycle['prepare']>>>{
 assertOriginalMainDshCoreReady(lease);
 assertOriginalHarnessBudgetLifecycle(lifecycle);
 return apply(originalProtectedLifecyclePrepare,lifecycle,[]);
}
export function closeOriginalMainDshCoreInfrastructure(lease:unknown):Promise<void> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.close();
}
/** Return an accepted Owner borrow; the original Core retains the resource. */
export function returnOriginalMainDshInstalledRootPool(lease:unknown):Promise<void> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.returnOwner();
}
export function readOriginalMainDshCoreBootstrap(lease:unknown,session:unknown):Promise<'fresh'|'restored'> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==2||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.readBootstrap(session);
}
function denied():never{throw new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED');}
/** Opaque identities only. Each consumer MUST use its original domain's
 * private reader/current guard; this view never creates a known fact. */
export function readOriginalDshAdmissionReferences(realm:unknown,proof:object,purpose:string):DshOriginalReferences {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row)denied();return row.references(proof,purpose);
}
/** Role provenance only: no N capacity, work, budget, source-read or model grant. */
export function readOriginalMainDshBootstrapAuthority(realm:unknown,store:unknown,source:unknown):MainDshBootstrapView {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row||row.authority!==source||row.store!==store||!store)denied();
 readOriginalDshAdmissionPort(store,source);row.current();row.local();
 return freeze({kind:'main_dsh_native_bootstrap_v1' as const,assertCurrent:row.current,assertLocal:row.local});
}
export interface MainDshClockView {
 readonly projection:Readonly<{state:'verified';domainId:string;qualificationEpoch:number;nowMs:number}|{state:'unverified'|'rollback_detected'}>;
 assertCurrent():void;assertLocal():void;
}
/** Native ownership is independent of UTC qualification. Until an original
 * bounded anchor is available the evaluator receives an explicit unknown. */
export function readOriginalMainDshClock(realm:unknown,store:unknown,source:unknown):MainDshClockView {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row||row.authority!==source||row.store!==store||!store)denied();
 row.current();row.local();return row.clockView();
}
/** Records only original, immutable response evidence. No caller timestamp,
 * verifier callback or status DTO can establish this operational clock. */
export function observeOriginalMainDshClockDate(fact:unknown,realm:unknown,store:unknown,source:unknown):void {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row||row.authority!==source||row.store!==store||!store)denied();
 row.local();const original=readOriginalGithubProviderDateFact(fact,realm,store,source);row.observeClock(original);row.local();
}
/** Original kernel measurement only. No verified UTC/time-bound inference is
 * made here. Native member checks precede any caller property. */
export function readOriginalMainDshClockCut(realm:unknown,store:unknown,source:unknown):Readonly<MainDshKernelClockCut>|null {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row||row.authority!==source||row.store!==store||!store)denied();
 row.local();const cut=row.clock();row.local();return cut;
}
/** Fixed package addon only. This factory accepts no caller path/API/verifier. */
export function createMainDshBootstrapAuthority():MainDshBootstrapAuthority {
 // ABI guard precedes dlopen. The C++ role predicate independently rejects
 // Node, workers and Electron run-as-node; these JS fields grant nothing.
 if(process.platform!=='darwin'||process.versions.modules!=='140'||!process.versions.electron?.startsWith('39.'))throw new NativeError('DSH_MAIN_NATIVE_UNAVAILABLE');
 if(singleton)return singleton;
 if(birthAttempted)throw birthFailure;birthAttempted=true;
 try{
  const api=requireNative(addonPath) as object;
  const method=(name:string):Function=>{const d=descriptor(api,name);if(!d||!own(d,'value')||typeof d.value!=='function'||isProxy(d.value)||prototype(d.value)!==FunctionPrototype)denied();return d.value;};
  const birth=method('createOriginalMainIssuer'),assert=method('assertOriginalMainIssuerCurrent'),revoke=method('revokeOriginalMainIssuer');
  const issuer=apply(birth,api,[]);if(!issuer||typeof issuer!=='object'||isProxy(issuer)||types.isPromise(issuer))denied();
  let sealed=false,failed=false,store:object|undefined;
  const local=()=>{if(sealed||failed)denied();};
  const current=()=>{local();try{const result=apply(assert,api,[issuer]);if(result!==undefined)denied();}catch(error){failed=true;throw error;}local();};
  let installedLease:object|undefined;
  let installedCore=false;
  const prepareInstalled=(core=false):object=>{
   if(installedLease){if(core&&!installedCore)denied();return installedLease;}
   local();
   installedCore=core;
   const lease=freeze(create(null)),stock=createRoomTurnCustody(),negativeStock=createRoomTurnCustody(),ownerCleanup=createRoomTurnCustody();
   let opening:Promise<object>|undefined,closing:Promise<void>|undefined,connectEntered=false,connected:object|undefined,rootSession:object|undefined,rootApi:object|undefined;
   let rootClose:Function|undefined,installationClose:Function|undefined;
   let coreStarting:Promise<void>|undefined,ownerOpening:Promise<object>|undefined,ownerReturning:Promise<void>|undefined,ownerBorrowed=false;
   let budgetOpening:Promise<object>|undefined,budgetPrepared:unknown;
   let admissionBundle:OriginalAdmissionDatabaseBundle|undefined,admissionClose:Function|undefined,coreReady=false;
   let releaseOwner!:()=>void,rejectOwner!:(raw:unknown)=>void;
   const ownerReturned=new NativePromise<void>((yes,no)=>{releaseOwner=yes;rejectOwner=no;});
   // Observe the private rejection even if shutdown has not requested close.
   apply(nativeThen,ownerReturned,[undefined,()=>{}]);
   const fixedMethod=(target:object,name:string):Function=>{
    const d=descriptor(target,name);
    if(!d||!own(d,'value')||typeof d.value!=='function'||isProxy(d.value))denied();return d.value;
   };
   const progress=()=>{local();if(closing)denied();};
   const releaseNamespace=()=>{};
   const openRaw=():Promise<object>=>{
     if(closing)return rejected(new NativeError('DSH_MAIN_INSTALLED_ROOT_CLOSING'));
     if(opening)return opening;
     let yes!:(value:object)=>void,no!:(raw:unknown)=>void;
     opening=new NativePromise<object>((resolve,reject)=>{yes=resolve;no=reject;});
     const operation=stock.root(async()=>{
      progress();current();progress();
      const connect=fixedMethod(api,'connectOriginalMainInstallation');
      installationClose=fixedMethod(api,'closeOriginalMainInstallation');
      rootApi=await stock.sdk<object>(loadOriginalMainResourceAuthority,undefined,[],{accept:value=>!!value&&typeof value==='object'&&!isProxy(value),consumer:releaseNamespace});
      progress();rootClose=fixedMethod(rootApi,'close');
      const rootOpen=fixedMethod(rootApi,'openOriginalInstalledMainIssuer');
      await stock.consumeResource(releaseNamespace,rootApi,[]);progress();
      connectEntered=true;
      connected=await stock.sdk<object>(connect,api,[issuer],{accept:value=>value===issuer,consumer:installationClose});
      progress();
      rootSession=await stock.sdk<object>(rootOpen,rootApi,[issuer],{accept:value=>!!value&&typeof value==='object'&&!isProxy(value)&&!types.isPromise(value),consumer:rootClose});
      progress();return rootSession;
     });
     apply(nativeThen,operation,[yes,no]);return opening;
   };
   const readBootstrap=async():Promise<'fresh'|'restored'>=>{
    if(!rootApi||!rootSession)denied();
    const raw=await stock.sdk(fixedMethod(rootApi,'readOriginalMainPoolBootstrap'),rootApi,[rootSession]);
    const view=captureIpcData(raw,'DSH_MAIN_CORE_BOOTSTRAP_UNCONFIRMED') as Record<string,unknown>;
    if(!view||typeof view!=='object'||keys(view).length!==6||view.kind!=='original_main_pool_bootstrap_v1'||(view.bootstrap!=='fresh'&&view.bootstrap!=='restored')||view.profile!=='ordinary_runtime_root_resource_reservation_writer_v8_protected_io'||view.schemaVersion!==4||typeof view.semanticDigest!=='string'||!/^[a-f0-9]{64}$/.test(view.semanticDigest)||typeof view.businessSealed!=='boolean')denied();
    if(view.businessSealed)denied();return view.bootstrap;
   };
   const state:InstalledPool={
    assertReadyForOwner(){progress();if(!installedCore||!coreReady||ownerReturning)denied();},
    readAdmission(){progress();if(!installedCore)return null;if(!coreReady||!admissionBundle)denied();return admissionBundle;},
    prepareBudgetWorker(prepared){
     if(!installedCore||!coreStarting||closing||ownerReturning)return rejected(new NativeError('DSH_MAIN_CORE_NOT_STARTED'));
     readOriginalHarnessBudgetWorkerBirth(prepared).assertLocal();
     if(budgetOpening){if(prepared!==budgetPrepared)return rejected(new NativeError('DSH_MAIN_CORE_BUDGET_ALREADY_ATTEMPTED'));return budgetOpening;}
     budgetPrepared=prepared;
     let yes!:(value:object)=>void,no!:(raw:unknown)=>void;
     budgetOpening=new NativePromise<object>((resolve,reject)=>{yes=resolve;no=reject;});
     const operation=(async()=>{await coreStarting;progress();await readBootstrap();progress();current();readOriginalHarnessBudgetWorkerBirth(prepared).assertLocal();
      const value=await prepareOriginalProtectedBudgetWorker(prepared,issuer);progress();return value;})();
     apply(nativeThen,operation,[yes,no]);return budgetOpening;
    },
    open(){
     if(!installedCore)return openRaw();
     if(closing||ownerReturning)return rejected(new NativeError('DSH_MAIN_INSTALLED_ROOT_CLOSING'));
     if(ownerOpening)return ownerOpening;
     if(!coreStarting)return rejected(new NativeError('DSH_MAIN_CORE_NOT_STARTED'));
     let yes!:(value:object)=>void,no!:(raw:unknown)=>void;
     ownerOpening=new NativePromise<object>((resolve,reject)=>{yes=resolve;no=reject;});
     const operation=(async()=>{await coreStarting;progress();ownerBorrowed=true;return rootSession!;})();
     apply(nativeThen,operation,[yes,no]);return ownerOpening;
    },
    startCore(){
     if(!installedCore)return rejected(new NativeError('DSH_MAIN_CORE_LEASE_REQUIRED'));
     if(closing)return rejected(new NativeError('DSH_MAIN_INSTALLED_ROOT_CLOSING'));
     if(coreStarting)return coreStarting;
     let yes!:()=>void,no!:(raw:unknown)=>void;
     coreStarting=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
     const operation=(async()=>{
      await openRaw();progress();
      const result=await stock.sdk(fixedMethod(rootApi!,'bootstrapOriginalMainPool'),rootApi,[rootSession]);progress();
      if(result!=='fresh'&&result!=='restored')denied();
      const confirmed=await readBootstrap();progress();if(confirmed!==result)denied();
      admissionBundle=prepareOriginalProtectedAdmissionDatabase(issuer);admissionClose=fixedMethod(admissionBundle,'closeOwned');progress();coreReady=true;
     })();
     apply(nativeThen,operation,[yes,no]);return coreStarting;
    },
    async readBootstrap(candidate){
     if(!installedCore||!coreStarting||!ownerBorrowed||ownerReturning||candidate!==rootSession)denied();
     await coreStarting;progress();const result=await readBootstrap();progress();return result;
    },
    returnOwner(){
     if(!installedCore)return state.close();
     if(ownerReturning)return ownerReturning;
     let yes!:()=>void,no!:(raw:unknown)=>void;
     ownerReturning=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
     const operation=(async()=>{
      if(ownerOpening)try{await ownerOpening;}catch{/* Retain the original rejected positive Promise. */}
      if(rootSession){
       const raw=await ownerCleanup.sdk(fixedMethod(rootApi!,'sealOriginalMainRootBusiness'),rootApi,[rootSession]);
       if(raw!==undefined)denied();await ownerCleanup.waitPhysicalKnown();
      }
      releaseOwner();
     })();
     apply(nativeThen,operation,[yes,(raw:unknown)=>{rejectOwner(raw);no(raw);}]);return ownerReturning;
    },
    close(){
     if(closing)return closing;
     let yes!:()=>void,no!:(raw:unknown)=>void;
     closing=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
     const operation=(async()=>{
      if(opening)try{await opening;}catch{/* The original open Promise preserves its exact first value. */}
      if(coreStarting)try{await coreStarting;}catch{/* Preserve Core startup's original first value. */}
      if(ownerBorrowed)await ownerReturned;
      if(admissionBundle){const raw=await negativeStock.sdk(admissionClose!,admissionBundle,[]);if(raw!==undefined)denied();}
      // A failed/BUSY Root close must never reach infrastructure close.
      if(rootSession){const raw=await stock.consumeResource(rootClose!,rootSession,[rootSession]);if(raw!==undefined)denied();}
      if(connectEntered){
       const raw=connected?await stock.consumeResource(installationClose!,connected,[issuer]):await negativeStock.sdk(installationClose!,api,[issuer]);
       if(raw!==undefined)denied();
      }
      await stock.waitPhysicalKnown();
      await negativeStock.waitPhysicalKnown();
      await ownerCleanup.waitPhysicalKnown();
     })();
     apply(nativeThen,operation,[yes,no]);return closing;
    },
   };
   apply(set,installedPools,[lease,state]);installedLease=lease;return lease;
  };
  const frames=new NativeWeakMap<object,{purpose:Purpose;data:unknown;refs:DshOriginalReferences}>();
  const freezeData=(value:unknown):unknown=>{if(value&&typeof value==='object'){const names=keys(value);for(let i=0;i<names.length;i++){const row=descriptor(value,names[i]!)!;if(own(row,'value'))freezeData(row.value);}freeze(value);}return value;};
  const captureReferences=(raw:DshOriginalReferences|undefined):DshOriginalReferences=>{
   if(raw===undefined)return freeze(create(null));if(!raw||typeof raw!=='object'||isProxy(raw))denied();
   const out=create(null),names=keys(raw);
   for(let i=0;i<names.length;i++){const key=names[i]!;if(key!=='budgetObservation'&&key!=='budgetAttempt'&&key!=='budgetReservation'&&key!=='modelAttempt'&&key!=='ownerObservation'&&key!=='sourceScan'&&key!=='userControlProof'&&key!=='providerDateFact'&&key!=='budgetReserveProof'&&key!=='admissionProposal'&&key!=='budgetWorkSnapshot')denied();const row=descriptor(raw,key);if(!row||!own(row,'value')||!row.enumerable||!row.value||typeof row.value!=='object'||isProxy(row.value)||types.isPromise(row.value))denied();define(out,key,{__proto__:null,value:row.value,enumerable:true} as PropertyDescriptor);}
   return freeze(out);
  };
  const open=(purpose:Purpose,input:unknown,refs?:DshOriginalReferences)=>{local();if(!store)denied();current();const data=freezeData(captureIpcData(input,'DSH_MAIN_COMMAND_INVALID')),references=captureReferences(refs),proof=freeze(create(null));current();apply(set,frames,[proof,{purpose,data,refs:references}]);local();return proof;};
  const references=(proof:object,purpose:string)=>{const row=apply(get,frames,[proof]) as {purpose:Purpose;refs:DshOriginalReferences}|undefined;if(!row||row.purpose!==purpose)denied();current();local();return row.refs;};
  const authority:MainDshBootstrapAuthority=freeze({
   bindStore(candidate:object){local();if(store&&store!==candidate)denied();readOriginalDshAdmissionPort(candidate,authority);current();store=candidate;const row=apply(get,realms,[authority]) as State;row.store=candidate;},
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
   resolve(proof:object,purpose:string){const frame=apply(get,frames,[proof]) as {purpose:Purpose;data:unknown}|undefined;if(!frame||frame.purpose!==purpose)denied();current();local();return freeze({data:frame.data,assertCurrent:current});},
   seal(){if(sealed)return;sealed=true;try{const result=apply(revoke,api,[issuer]);if(result!==undefined)denied();}catch(error){failed=true;throw error;}},
  });
  const clock=():Readonly<MainDshKernelClockCut>|null=>{
   current();const clockMethod=descriptor(api,'readOriginalMainClockCut');if(!clockMethod)return null;
   const raw=apply(method('readOriginalMainClockCut'),api,[issuer]);
   if(!raw||typeof raw!=='object'||isProxy(raw)||types.isPromise(raw))denied();
   const captured=captureIpcData(raw,'DSH_MAIN_CLOCK_CUT_INVALID') as unknown as MainDshKernelClockCut;
   if(keys(captured).length!==5||captured.kind!=='main_kernel_clock_cut_v1'||typeof captured.domainId!=='string'||!/^[a-f0-9]{64}$/.test(captured.domainId)||typeof captured.continuousLowerNs!=='string'||!/^[0-9]{1,20}$/.test(captured.continuousLowerNs)||typeof captured.continuousUpperNs!=='string'||!/^[0-9]{1,20}$/.test(captured.continuousUpperNs)||!Number.isSafeInteger(captured.wallMs)||captured.wallMs<0||captured.wallMs>253402300799999||Object.is(captured.wallMs,-0)||BigInt(captured.continuousUpperNs)<BigInt(captured.continuousLowerNs)||BigInt(captured.continuousUpperNs)-BigInt(captured.continuousLowerNs)>1000000000n)denied();
   local();return freeze(captured);
  };
  type Anchor={ref:string;nativeDomain:string;upperMs:number;continuousUpper:bigint;continuousLower:bigint;epoch:number};
  let anchor:Anchor|undefined,clockEpoch=0,clockLastNow=0,clockLost=false;
  const millis=(ns:bigint)=>Number((ns+999999n)/1000000n);
  const observeClock=(fact:GithubProviderDateFact):void=>{
   const cut=fact.localClockCut;if(!cut)return;
   const before=cut.before,after=cut.after;
   if(before.domainId!==after.domainId)return;
   const begin=BigInt(before.continuousLowerNs),end=BigInt(after.continuousUpperNs);
   if(end<begin||end-begin>30000000000n)return;
   const serverUpper=parseClockDate(fact.exclusiveSecondUpperBound),rtt=millis(end-begin),upperMs=serverUpper+rtt;
   // Explicit operational product policy approved by the user: this five minute
   // sanity window is not a provider accuracy guarantee or event-clock proof.
   if(!clockInteger(upperMs)||upperMs<0||upperMs>253402300799999||clockAbs(after.wallMs-serverUpper)>300000)return;
   if(anchor?.ref===fact.factRef)return;
   if(anchor&&anchor.nativeDomain!==after.domainId){clockLost=true;return;}
   if(!anchor||clockLost){clockEpoch++;clockLost=false;}
   const carried=anchor?anchor.upperMs+millis(end-anchor.continuousUpper):0;
   anchor={ref:fact.factRef,nativeDomain:after.domainId,upperMs:clockMax(upperMs,after.wallMs,carried,clockLastNow),continuousUpper:end,continuousLower:BigInt(after.continuousLowerNs),epoch:clockEpoch};
  };
  const clockView=():MainDshClockView=>{
   const cut=clock();
   const unknown=()=>freeze({projection:freeze({state:'unverified' as const}),assertCurrent:current,assertLocal:local});
   if(!cut||!anchor||clockLost)return unknown();
   const captured=anchor,nowLower=BigInt(cut.continuousLowerNs),nowUpper=BigInt(cut.continuousUpperNs);
   if(cut.domainId!==captured.nativeDomain||nowLower<captured.continuousLower||nowUpper-captured.continuousUpper>60000000000n){clockLost=true;return unknown();}
   // The operational provider anchor may lead local time, but must never
   // postpone a local deadline when the provider Date happens to lag it.
   const nowMs=clockMax(clockLastNow,cut.wallMs,captured.upperMs+millis(nowUpper-captured.continuousLower));
   if(!clockInteger(nowMs)||nowMs>253402300799999||clockAbs(cut.wallMs-nowMs)>300000){clockLost=true;return unknown();}
   clockLastNow=nowMs;
   const assertLocal=()=>{local();if(clockLost||!anchor||anchor.epoch!==captured.epoch||anchor.nativeDomain!==captured.nativeDomain)denied();};
   const assertCurrent=()=>{current();const fresh=clock();if(!fresh||fresh.domainId!==captured.nativeDomain||BigInt(fresh.continuousLowerNs)<nowLower||BigInt(fresh.continuousUpperNs)-nowUpper>1000000000n){clockLost=true;denied();}assertLocal();};
   return freeze({projection:freeze({state:'verified' as const,domainId:'operational-server-time-v1:'+cut.domainId,qualificationEpoch:captured.epoch,nowMs}),assertCurrent,assertLocal});
  };
  const startedCore=():object|null=>{
   local();if(!installedCore)return null;if(!installedLease)denied();
   const pool=apply(get,installedPools,[installedLease]) as InstalledPool|undefined;
   if(!pool)denied();pool.assertReadyForOwner();return installedLease;
  };
  const readAdmission=():OriginalAdmissionDatabaseBundle|null=>{local();if(!installedLease||!installedCore)return null;const pool=apply(get,installedPools,[installedLease]) as InstalledPool|undefined;if(!pool)denied();return pool.readAdmission();};
  apply(set,realms,[authority,{authority,current,local,references,clock,observeClock,clockView,prepareInstalled,readAdmission,startedCore}]);current();singleton=authority;return authority;
 }catch(error){birthFailure=error;throw error;}
}
