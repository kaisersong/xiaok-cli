import {readOriginalDshAdmissionPort} from './desktop-multi-agent-store.js';
import {readOriginalGithubProviderDateFact} from './dsh-github-source-session.js';
import type {DshOriginalReferences,MainDshBootstrapAuthority,MainDshBootstrapView,MainDshClockView,MainDshKernelClockCut} from './main-dsh-bootstrap-types.js';
import {ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED} from './root-resource-production-qualification.js';
import {HarnessOptimizationLifecycle,assertOriginalHarnessBudgetLifecycle} from './harness-optimization-lifecycle.js';
import type {State,InstalledPool} from './main-dsh-bootstrap-types.js';
import type {OriginalAdmissionDatabaseBundle} from './protected-authority-database-types.js';
import type {OriginalRootNmpLedger} from '../../src/runtime/verification/original-root-nmp-ledger.js';
const apply=Reflect.apply,get=WeakMap.prototype.get,NativeError=Error,NativePromise=Promise,freeze=Object.freeze;
const originalProtectedLifecyclePrepare=HarnessOptimizationLifecycle.prototype.prepareProtectedStorage;
const rejected=<T>(raw:unknown):Promise<T>=>new NativePromise<T>((_yes,no)=>no(raw));
function denied():never{throw new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED');}
/** Fixed Main binds its original private tables once. This factory never writes them. */
export function createOriginalMainDshCoreAccessors(realms:WeakMap<object,State>,installedPools:WeakMap<object,InstalledPool>){
/** Passive private lease: no caller path, issuer, Native API or verifier. */
function prepareOriginalMainDshInstalledRootPool(realm:unknown,store:unknown):object {
 const row=apply(get,realms,[realm]) as State|undefined;
 if(arguments.length!==2||!row||!store||row.store!==store)denied();
 row.local();return row.prepareInstalled();
}
/** Passive exact Core identity. A prepared/pending/retiring Core is never
 * legacy absence. This cannot prepare a lease, open Native IO or mint a role. */
function readOriginalMainDshStartedCore(realm:unknown,store:unknown):object|null {
 const row=apply(get,realms,[realm]) as State|undefined;
 if(arguments.length!==2||!row||!store||row.store!==store)denied();
 row.local();const core=row.startedCore();row.local();return core;
}
function openOriginalMainDshInstalledRootPool(lease:unknown):Promise<object> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.open();
}
/** Synchronous fixed database bundle; only a genuine legacy realm returns null. */
function readOriginalMainDshAdmissionDatabase(realm:unknown):OriginalAdmissionDatabaseBundle|null{
 const row=apply(get,realms,[realm]) as State|undefined;
 if(arguments.length!==1)denied();if(!row){if(!ORIGINAL_PRODUCTION_ROOT_RESOURCE_QUALIFIED)return null;denied();}row.local();return row.readAdmission();
}
/** Negative only; remains available after the business authority is sealed. */
function closeOriginalMainDshInstalledRootPool(lease:unknown):Promise<void> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.close();
}
/** Infrastructure only. The original realm exists before any business Store. */
function prepareOriginalMainDshCoreInfrastructure(realm:unknown):object {
 const row=apply(get,realms,[realm]) as State|undefined;
 if(arguments.length!==1||!row)denied();row.local();return row.prepareInstalled(true);
}
function startOriginalMainDshCoreInfrastructure(lease:unknown):Promise<void> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.startCore();
}
/** Fixed infrastructure consumer. Native issuer/session never leave Core. */
function prepareOriginalMainDshBudgetWorker(lease:unknown,prepared:unknown):Promise<object>{
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==2||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.prepareBudgetWorker(prepared);
}
/** Complete historical accounting from this Core's original private connection.
 * The projection carries no session, capability, FD-closure or enrollment grant. */
function readOriginalMainDshRootNmpLedger(lease:unknown):Promise<OriginalRootNmpLedger>{
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.readLedger();
}
/** Passive same-Core readiness. No raw Native session/API is disclosed. */
function assertOriginalMainDshCoreReady(lease:unknown):void{
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row||!row.readAdmission())denied();
}
async function prepareOriginalMainDshBudgetLifecycle(lease:unknown,lifecycle:HarnessOptimizationLifecycle):Promise<Awaited<ReturnType<HarnessOptimizationLifecycle['prepare']>>>{
 assertOriginalMainDshCoreReady(lease);
 assertOriginalHarnessBudgetLifecycle(lifecycle);
 return apply(originalProtectedLifecyclePrepare,lifecycle,[]);
}
function closeOriginalMainDshCoreInfrastructure(lease:unknown):Promise<void> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.close();
}
/** Return an accepted Owner borrow; the original Core retains the resource. */
function returnOriginalMainDshInstalledRootPool(lease:unknown):Promise<void> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.returnOwner();
}
function readOriginalMainDshCoreBootstrap(lease:unknown,session:unknown):Promise<'fresh'|'restored'> {
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==2||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.readBootstrap(session);
}
/** Opaque identities only. Each consumer MUST use its original domain's
 * private reader/current guard; this view never creates a known fact. */
function readOriginalDshAdmissionReferences(realm:unknown,proof:object,purpose:string):DshOriginalReferences {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row)denied();return row.references(proof,purpose);
}
/** Role provenance only: no N capacity, work, budget, source-read or model grant. */
function readOriginalMainDshBootstrapAuthority(realm:unknown,store:unknown,source:unknown):MainDshBootstrapView {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row||row.authority!==source||row.store!==store||!store)denied();
 readOriginalDshAdmissionPort(store,source);row.current();row.local();
 return freeze({kind:'main_dsh_native_bootstrap_v1' as const,assertCurrent:row.current,assertLocal:row.local});
}
/** Native ownership is independent of UTC qualification. Until an original
 * bounded anchor is available the evaluator receives an explicit unknown. */
function readOriginalMainDshClock(realm:unknown,store:unknown,source:unknown):MainDshClockView {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row||row.authority!==source||row.store!==store||!store)denied();
 row.current();row.local();return row.clockView();
}
/** Records only original, immutable response evidence. No caller timestamp,
 * verifier callback or status DTO can establish this operational clock. */
function observeOriginalMainDshClockDate(fact:unknown,realm:unknown,store:unknown,source:unknown):void {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row||row.authority!==source||row.store!==store||!store)denied();
 row.local();const original=readOriginalGithubProviderDateFact(fact,realm,store,source);row.observeClock(original);row.local();
}
/** Original kernel measurement only. No verified UTC/time-bound inference is
 * made here. Native member checks precede any caller property. */
function readOriginalMainDshClockCut(realm:unknown,store:unknown,source:unknown):Readonly<MainDshKernelClockCut>|null {
 const row=realm&&typeof realm==='object'?apply(get,realms,[realm]) as State|undefined:undefined;
 if(!row||row.authority!==source||row.store!==store||!store)denied();
 row.local();const cut=row.clock();row.local();return cut;
}
/** Fixed same-Core Native KSwarm resource. This never registers a caller Source. */
function prepareOriginalMainDshKSwarmChild(lease:unknown):Promise<object>{
 const row=apply(get,installedPools,[lease]) as InstalledPool|undefined;
 if(arguments.length!==1||!row)return rejected(new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED'));
 return row.prepareKSwarmChild();
}
return Object.freeze({prepareOriginalMainDshKSwarmChild,readOriginalDshAdmissionReferences,readOriginalMainDshBootstrapAuthority,readOriginalMainDshClock,observeOriginalMainDshClockDate,readOriginalMainDshClockCut,prepareOriginalMainDshInstalledRootPool,readOriginalMainDshStartedCore,openOriginalMainDshInstalledRootPool,readOriginalMainDshAdmissionDatabase,closeOriginalMainDshInstalledRootPool,prepareOriginalMainDshCoreInfrastructure,startOriginalMainDshCoreInfrastructure,prepareOriginalMainDshBudgetWorker,readOriginalMainDshRootNmpLedger,assertOriginalMainDshCoreReady,prepareOriginalMainDshBudgetLifecycle,closeOriginalMainDshCoreInfrastructure,returnOriginalMainDshInstalledRootPool,readOriginalMainDshCoreBootstrap});
}
