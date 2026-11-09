import {appendIntrinsic,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {createOriginalMainDshKSwarmCoreChild,createOriginalMainDshBrokerCoreChild,closeOriginalMainDshCoreChild,type OriginalMainDshCoreChild} from './main-dsh-core-child-custody.js';
import {createOriginalMainDshChildFunctionCustody} from './main-dsh-core-child-functions.js';
import {createOriginalMainDshComponentCustody} from './main-dsh-component-custody.js';
import {combineOriginalMainDshCoreCloseError} from './main-dsh-core-kswarm-cleanup.js';
import type {DshOriginalReferences,MainDshBootstrapAuthority,MainDshBootstrapView,MainDshKernelClockCut,MainDshClockView,State,InstalledPool,MainDshCoreCloseFailure} from './main-dsh-bootstrap-types.js';
export type {DshOriginalReferences,MainDshBootstrapAuthority,MainDshBootstrapView,MainDshKernelClockCut,MainDshClockView} from './main-dsh-bootstrap-types.js';
import {createOriginalMainDshCoreAccessors} from './main-dsh-core-accessors.js';
import {createOriginalMainDshFrames,captureOriginalMainDshCoreBootstrap,captureOriginalMainDshClockCut} from './main-dsh-bootstrap-data.js';
import {createOriginalMainDshOperationalClock} from './main-dsh-bootstrap-clock.js';
import {decodeOriginalRootNmpLedger,type OriginalRootNmpLedger} from '../../src/runtime/verification/original-root-nmp-ledger.js';
import type {OriginalAdmissionDatabaseBundle} from './protected-authority-database-types.js';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {readOriginalDshAdmissionPort} from './desktop-multi-agent-store.js';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {loadOriginalMainResourceAuthority} from '../../src/runtime/verification/original-main-native-loader.js';
import {prepareOriginalProtectedBudgetWorker,prepareOriginalProtectedAdmissionDatabase} from './harness-protected-budget-worker.js';
import {readOriginalHarnessBudgetWorkerBirth} from './harness-optimization-lifecycle.js';
const requireNative=createRequire(import.meta.url),addonPath=join(dirname(fileURLToPath(import.meta.url)),'main_bootstrap.node');
const apply=Reflect.apply,freeze=Object.freeze,create=Object.create,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,keys=Reflect.ownKeys,define=Object.defineProperty,NativeWeakMap=WeakMap;
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,isProxy=types.isProxy,NativeError=Error,FunctionPrototype=Function.prototype,prototype=Object.getPrototypeOf;
const realms=new NativeWeakMap<object,State>();let singleton:MainDshBootstrapAuthority|undefined,birthAttempted=false,birthFailure:unknown;
const installedPools=new NativeWeakMap<object,InstalledPool>();
export const {joinOriginalMainDshServiceComponent,assertOptionalOriginalMainDshServiceComponent,prepareOriginalMainDshKSwarmChild,prepareOriginalMainDshBrokerChild,prepareOriginalMainDshInstalledRootPool,readOriginalMainDshStartedCore,openOriginalMainDshInstalledRootPool,readOriginalMainDshAdmissionDatabase,closeOriginalMainDshInstalledRootPool,prepareOriginalMainDshCoreInfrastructure,startOriginalMainDshCoreInfrastructure,prepareOriginalMainDshBudgetWorker,readOriginalMainDshRootNmpLedger,assertOriginalMainDshCoreReady,prepareOriginalMainDshBudgetLifecycle,closeOriginalMainDshCoreInfrastructure,returnOriginalMainDshInstalledRootPool,readOriginalMainDshCoreBootstrap,readOriginalDshAdmissionReferences,readOriginalMainDshBootstrapAuthority,readOriginalMainDshClock,observeOriginalMainDshClockDate,readOriginalMainDshClockCut}=createOriginalMainDshCoreAccessors(realms,installedPools);
const NativePromise=Promise,nativeThen=Promise.prototype.then;
const rejected=<T>(raw:unknown):Promise<T>=>new NativePromise<T>((_yes,no)=>no(raw));
function denied():never{throw new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED');}
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
  const optional=(name:string)=>descriptor(api,name)?method(name):undefined;
  const serviceComponentAssert=optional('assertOriginalMainDshServiceComponent');
  const ksMethods=freeze({prepare:optional('prepareOriginalKSwarmChild'),assert:optional('assertOriginalKSwarmChildPort'),terminal:optional('assertOriginalKSwarmChildTerminal')});
  const brokerMethods=freeze({prepare:optional('prepareOriginalBrokerChild'),assert:optional('assertOriginalBrokerChildPort'),terminal:optional('assertOriginalBrokerChildTerminal')});
  const issuer=apply(birth,api,[]);if(!issuer||typeof issuer!=='object'||isProxy(issuer)||types.isPromise(issuer))denied();
  let sealed=false,failed=false,store:object|undefined;
  const local=()=>{if(sealed||failed)denied();};
  const current=()=>{local();try{const result=apply(assert,api,[issuer]);if(result!==undefined)denied();}catch(error){failed=true;throw error;}local();};
  const component=createOriginalMainDshComponentCustody(serviceComponentAssert,api,issuer,local);
  let installedLease:object|undefined;
  let installedCore=false;
  const prepareInstalled=(core=false):object=>{
   if(installedLease){if(core&&!installedCore)denied();return installedLease;}
   local();
   installedCore=core;
   const lease=freeze(create(null)),stock=createRoomTurnCustody(),negativeStock=createRoomTurnCustody(),ownerCleanup=createRoomTurnCustody(),ledgerStock=createRoomTurnCustody();
   let opening:Promise<object>|undefined,closing:Promise<void>|undefined,connectEntered=false,connected:object|undefined,rootSession:object|undefined,rootApi:object|undefined;
   let rootClose:Function|undefined,installationClose:Function|undefined;
   let coreStarting:Promise<void>|undefined,ownerOpening:Promise<object>|undefined,ownerReturning:Promise<void>|undefined,ownerBorrowed=false;
   let budgetOpening:Promise<object>|undefined,budgetPrepared:unknown;
   const ks=createOriginalMainDshKSwarmCoreChild(),broker=createOriginalMainDshBrokerCoreChild();
   const childProgress=()=>{progress();if(ownerReturning)denied();};
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
    return captureOriginalMainDshCoreBootstrap(raw);
   };
   const prepareChild=(child:OriginalMainDshCoreChild,methods:Readonly<{prepare?:Function;assert?:Function;terminal?:Function}>):Promise<object>=>{
    if(!installedCore||!coreStarting||closing||ownerReturning)return rejected(new NativeError('DSH_MAIN_CORE_NOT_STARTED'));
    if(child.opening)return child.opening;
    let yes!:(value:object)=>void,no!:(raw:unknown)=>void;
    child.opening=new NativePromise<object>((resolve,reject)=>{yes=resolve;no=reject;});define(child.opening,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);
    child.functions=createOriginalMainDshChildFunctionCustody(methods);
    const operation=child.stock.root(async()=>{
     await coreStarting;childProgress();if(!coreReady)denied();
     await readBootstrap();childProgress();current();childProgress();
     child.assert=methods.assert;child.terminal=methods.terminal;if(!methods.prepare||!child.assert||!child.terminal)denied();
     await child.functions!.capture();childProgress();current();childProgress();
     child.entered=true;
     await child.stock.sdk<object>(methods.prepare,api,[issuer],{accept:value=>{
      if(!value||typeof value!=='object'||isProxy(value)||types.isPromise(value))return false;
      child.port=value;return true;
     },consumer:child.terminal,strictProxyGraph:true});childProgress();
     const raw=await child.stock.sdk(child.assert,api,[child.port]);if(raw!==undefined)denied();childProgress();
    });
    const reject=(raw:unknown)=>{child.failure={raw};no(raw);};
    apply(nativeThen,operation,[()=>{try{childProgress();yes(child.port!);}catch(raw){reject(raw);}},reject]);
    return child.opening;
   };
   const state:InstalledPool={
    readLedger(){
     if(!installedCore||!coreReady||!rootApi||!rootSession||closing)return rejected(new NativeError('DSH_MAIN_CORE_NOT_STARTED'));
     // Accepted historical IO is independent of business revoke. Native still
     // checks the same original environment/PID/connection/physical identity.
     return ledgerStock.root(async()=>{
      const raw=await ledgerStock.sdk(fixedMethod(rootApi!,'readOriginalRootPoolLedger'),rootApi,[rootSession]);
      return decodeOriginalRootNmpLedger(raw);
     });
    },
    assertReadyForOwner(){progress();if(!installedCore||!coreReady||ownerReturning)denied();},
    readAdmission(){progress();if(!installedCore)return null;if(!coreReady||!admissionBundle)denied();return admissionBundle;},
    prepareKSwarmChild(){return prepareChild(ks,ksMethods);},
    prepareBrokerChild(){return prepareChild(broker,brokerMethods);},
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
      let childFirst:MainDshCoreCloseFailure|undefined,childUnknown=false;
      if(ownerBorrowed)try{await ownerReturned;}catch(raw){childFirst={raw};childUnknown=true;}
      const children=[ks,broker];
      const childResults=await settleIntrinsicOperations(children,child=>closeOriginalMainDshCoreChild(child,api));
      for(let i=0;i<childResults.length;i++){
       const result=childResults[i]!;
       if(result.status==='rejected'){childUnknown=true;if(!childFirst)childFirst={raw:result.reason};else{childFirst.secondary??=[];appendIntrinsic(childFirst.secondary,result.reason);}}
       else if(result.value){if(!childFirst)childFirst=result.value;else{childFirst.secondary??=[];appendIntrinsic(childFirst.secondary,combineOriginalMainDshCoreCloseError(result.value));}}
      }
      if(childUnknown)throw combineOriginalMainDshCoreCloseError(childFirst!);
      try{
      if(admissionBundle){const raw=await negativeStock.sdk(admissionClose!,admissionBundle,[]);if(raw!==undefined)denied();}
      await ledgerStock.waitPhysicalKnown();
      const componentResult=await negativeStock.sdk(component.join,component,[]);if(componentResult!==undefined)denied();
      // A failed/BUSY Root close must never reach infrastructure close.
      if(rootSession){const raw=await stock.consumeResource(rootClose!,rootSession,[rootSession]);if(raw!==undefined)denied();}
      if(connectEntered){
       const raw=connected?await stock.consumeResource(installationClose!,connected,[issuer]):await negativeStock.sdk(installationClose!,api,[issuer]);
       if(raw!==undefined)denied();
      }
      await stock.waitPhysicalKnown();
      await negativeStock.waitPhysicalKnown();
      await ownerCleanup.waitPhysicalKnown();
      }catch(raw){if(childFirst)throw combineOriginalMainDshCoreCloseError(childFirst,{raw});throw raw;}
      if(childFirst)throw combineOriginalMainDshCoreCloseError(childFirst);
     })();
     apply(nativeThen,operation,[yes,no]);return closing;
    },
   };
   apply(set,installedPools,[lease,state]);installedLease=lease;return lease;
  };
  const {references,methods}=createOriginalMainDshFrames(local,current,()=>!!store);
  const authority:MainDshBootstrapAuthority=freeze({
   bindStore(candidate:object){local();if(store&&store!==candidate)denied();readOriginalDshAdmissionPort(candidate,authority);current();store=candidate;const row=apply(get,realms,[authority]) as State;row.store=candidate;},
   ...methods,
   seal(){if(sealed)return;sealed=true;try{const result=apply(revoke,api,[issuer]);if(result!==undefined)denied();}catch(error){failed=true;throw error;}},
  });
  const clock=():Readonly<MainDshKernelClockCut>|null=>{
   current();const clockMethod=descriptor(api,'readOriginalMainClockCut');if(!clockMethod)return null;
   const raw=apply(method('readOriginalMainClockCut'),api,[issuer]);
   const captured=captureOriginalMainDshClockCut(raw);
   local();return freeze(captured);
  };
  const {observeClock,clockView}=createOriginalMainDshOperationalClock(clock,current,local);
  const startedCore=():object|null=>{
   local();if(!installedCore)return null;if(!installedLease)denied();
   const pool=apply(get,installedPools,[installedLease]) as InstalledPool|undefined;
   if(!pool)denied();pool.assertReadyForOwner();return installedLease;
  };
  const readAdmission=():OriginalAdmissionDatabaseBundle|null=>{local();if(!installedLease||!installedCore)return null;const pool=apply(get,installedPools,[installedLease]) as InstalledPool|undefined;if(!pool)denied();return pool.readAdmission();};
  apply(set,realms,[authority,{assertServiceComponent:component.assert,joinServiceComponent:component.join,authority,current,local,references,clock,observeClock,clockView,prepareInstalled,readAdmission,startedCore}]);current();singleton=authority;return authority;
 }catch(error){birthFailure=error;throw error;}
}
