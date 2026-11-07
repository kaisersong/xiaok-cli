import {types} from 'node:util';
import {captureGithubOpaqueRecord,captureGithubReadData,githubReadRecord,githubReadFields,githubReadText,githubReadFreeze} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {createMainDshBootstrapAuthority,prepareOriginalMainDshCoreInfrastructure,startOriginalMainDshCoreInfrastructure,closeOriginalMainDshCoreInfrastructure,type MainDshBootstrapAuthority} from './main-dsh-bootstrap-authority.js';
import {readOriginalProductionRootResourceQualification} from './root-resource-production-qualification.js';
import {readOriginalMainDshControlSourceBinding,type MainDshControlSource} from './main-dsh-control-source.js';
import {createMainDshBudgetAuthoritySource,isOriginalMainDshBudgetActor,type MainDshBudgetAuthoritySource} from './main-dsh-budget-authority-source.js';
import {createMainGithubSourceConnectionPopulation,isOriginalGithubSourcePopulationBudgetActor,type MainGithubSourceConnectionPopulation} from './dsh-github-source-session.js';
import {createHarnessOptimizationRuntime,readOriginalDshBudgetRuntimeBinding,readOriginalDshBudgetRuntimeDisposal} from './harness-optimization-service.js';
import {DesktopMultiAgentStore,readOriginalDshAdmissionPort,readOriginalDshUserControlPort} from './desktop-multi-agent-store.js';
import {resolveDesktopServiceScope} from './desktop-service-scope.js';
import type {HarnessUserContext} from './harness-optimization-types.js';
import {createMainDshBusinessSource,type MainDshBusinessSource} from './main-dsh-business-source.js';

type Scope=Readonly<{profileId:string;workspaceId:string}>;
interface OriginalSourceBirth {
 readonly scope:Scope;
 readonly realm:MainDshBootstrapAuthority;
 readonly userSource:MainDshControlSource;
 readonly budgetSource:MainDshBudgetAuthoritySource;
 readonly sourcePopulation:MainGithubSourceConnectionPopulation;
}
export interface OriginalMainDshServiceSourceLease extends OriginalSourceBirth {
 readonly runtime:Awaited<ReturnType<typeof createHarnessOptimizationRuntime>>;
 readonly runtimePromise:ReturnType<typeof createHarnessOptimizationRuntime>;
 readonly harnessUserActor:HarnessUserContext;
 readonly businessSource:MainDshBusinessSource;
}
interface Row {
 readonly handle:object;readonly scope:Scope;readonly user:MainDshControlSource;
 readonly stock:ReturnType<typeof createRoomTurnCustody>;readonly negatives:ReturnType<typeof createIntrinsicSet<ReturnType<typeof createRoomTurnCustody>>>;
 birth?:OriginalSourceBirth;lease?:OriginalMainDshServiceSourceLease;preparing?:Promise<void>;claimed:boolean;transferred:boolean;failure?:{raw:unknown};
 runtime?:OriginalMainDshServiceSourceLease['runtime'];coreLease?:object;coreStock?:ReturnType<typeof createRoomTurnCustody>;store?:DesktopMultiAgentStore;closing?:Promise<void>;serviceClosing?:Promise<void>;resourcesClosed?:boolean;storeClosed?:boolean;
}
const rows=new WeakMap<object,Row>(),byUser=new WeakMap<object,Row>(),leases=new WeakMap<object,Row>(),held=createIntrinsicSet<Row>();
const runtimeOwners=new WeakMap<object,Row>();
let originalBirth:Row|undefined;
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,apply=Reflect.apply,create=Object.create,descriptor=Object.getOwnPropertyDescriptor;
const ErrorType=Error,isProxy=types.isProxy;
const freeze=Object.freeze;
const NativePromise=Promise,nativeThen=Promise.prototype.then,closeStore=DesktopMultiAgentStore.prototype.close;
const denied=()=>new ErrorType('DSH_MAIN_SERVICE_SOURCES_REQUIRED');
function disposeOriginalPreparedRuntime(this:object):Promise<void> {
 const row=apply(get,runtimeOwners,[this]) as Row|undefined;
 if(!row||row.runtime!==this||!row.birth)throw denied();
 const original=readOriginalDshBudgetRuntimeDisposal(this,row.birth.budgetSource);
 // Return the exact original SDK Promise, including its own/symbol metadata.
 return apply(original.dispose,original,[]) as Promise<void>;
}
function scopeOf(raw:unknown):Scope {
 const data=githubReadRecord(captureGithubReadData(raw));githubReadFields(data,['profileId','workspaceId']);
 return githubReadFreeze({profileId:githubReadText(data.profileId),workspaceId:githubReadText(data.workspaceId)});
}
function same(a:Scope,b:Scope):boolean{return a.profileId===b.profileId&&a.workspaceId===b.workspaceId;}

/** Fixed original Main composition. Native role is enforced by the original
 * factory; the App caller must additionally require installed qualification.
 * Isolated artifacts can exercise this same birth, never enable production. */
export function createOriginalMainDshServiceSources(raw:unknown):object {
 const options=captureGithubOpaqueRecord(raw,['scope','userSource']);
 const scope=scopeOf(options.scope),user=options.userSource as MainDshControlSource;
 const original=readOriginalMainDshControlSourceBinding(user);
 if(!same(scope,original.storageScope)||original.principalId!=='desktop-user:'+scope.profileId)throw denied();
 original.assertLocal();
 const prior=apply(get,byUser,[user]) as Row|undefined;
 if(prior){if(!same(prior.scope,scope)||prior.closing||prior.serviceClosing||prior.failure||!prior.birth)throw denied();return prior.handle;}
 if(originalBirth)throw denied();
 const handle=githubReadFreeze(create(null)) as object;
 const row:Row={handle,scope,user,stock:createRoomTurnCustody(),negatives:createIntrinsicSet(),claimed:false,transferred:false};
 originalBirth=row;
 apply(set,rows,[handle,row]);apply(set,byUser,[user,row]);held.add(row);
 try{
  row.stock.syncVoid(()=>{
   original.assertLocal();
   const realm=createMainDshBootstrapAuthority();
   const budgetSource=createMainDshBudgetAuthoritySource({realm,userSource:user});
   const sourcePopulation=createMainGithubSourceConnectionPopulation({scope,realm,userSource:user});
   row.birth=freeze({scope,realm,userSource:user,budgetSource,sourcePopulation});
   original.assertLocal();
  },undefined,[]);
  return handle;
 }catch(raw){row.failure={raw};row.stock.inventory(raw);throw raw;}
}

/** Resolve the one original budget runtime before the synchronous Services /
 * Store constructors. No caller runtime, factory or authorization callback. */
export function prepareOriginalMainDshServiceSources(candidate:unknown,raw:unknown):Promise<void> {
 const row=apply(get,rows,[candidate]) as Row|undefined;
 if(!row||row.claimed||row.closing||row.failure||!row.birth||row.preparing)throw denied();
 if(!raw||typeof raw!=='object'||isProxy(raw))throw denied();
 const options=captureGithubOpaqueRecord(raw,['dataRoot','harnessUserActor',...(descriptor(raw,'workspaceRoot')?['workspaceRoot']:[])]);
 const dataRoot=githubReadText(options.dataRoot),workspaceRoot=options.workspaceRoot===undefined?undefined:githubReadText(options.workspaceRoot);
 const actor=options.harnessUserActor as HarnessUserContext;
 if(!actor||typeof actor!=='object'||isProxy(actor))throw denied();
 const actorData=githubReadRecord(captureGithubReadData(actor));githubReadFields(actorData,['requestSource','principalId']);
 if(actorData.requestSource!=='user')throw denied();githubReadText(actorData.principalId);
 const birth=row.birth;
 let yes!:()=>void,no!:(raw:unknown)=>void;
 const preparing=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
 // Reserve before any SDK can synchronously reenter prepare.
 row.preparing=preparing;
 const operation=row.stock.root(async()=>{
  try{
   const actual=resolveDesktopServiceScope({dataRoot,...(workspaceRoot===undefined?{}:{workspaceRoot})});
   if(!same(row.scope,actual))throw denied();
   readOriginalMainDshControlSourceBinding(row.user).assertLocal();
   if(readOriginalProductionRootResourceQualification().qualified){
    row.coreStock=createRoomTurnCustody();
    row.coreLease=await row.coreStock.sdk<object>(prepareOriginalMainDshCoreInfrastructure,undefined,[birth.realm],{
     accept:value=>!!value&&typeof value==='object'&&!isProxy(value),consumer:closeOriginalMainDshCoreInfrastructure,
    });
    if(row.closing)throw denied();
    await row.coreStock.sdk(startOriginalMainDshCoreInfrastructure,undefined,[row.coreLease]);
    if(row.closing)throw denied();
    readOriginalMainDshControlSourceBinding(row.user).assertLocal();
   }
   let runtimePromise:ReturnType<typeof createHarnessOptimizationRuntime>|undefined;
   const runtime=await row.stock.sdk<Awaited<ReturnType<typeof createHarnessOptimizationRuntime>>>(()=>{runtimePromise=createHarnessOptimizationRuntime({dataRoot,profileId:row.scope.profileId,workspaceId:row.scope.workspaceId,
     authorizeUser:value=>value===actor||isOriginalMainDshBudgetActor(birth.budgetSource,value)||isOriginalGithubSourcePopulationBudgetActor(birth.sourcePopulation,value),
     manifestLookup:()=>undefined,dshBudgetAuthoritySource:birth.budgetSource,dshSourceReadAuthoritySource:birth.sourcePopulation.sourceReadAuthoritySource,...(row.coreLease?{originalCoreLease:row.coreLease}:{})});return runtimePromise;},undefined,[],{
     accept(value){
      readOriginalDshBudgetRuntimeDisposal(value,birth.budgetSource);
      row.runtime=value as OriginalMainDshServiceSourceLease['runtime'];
      apply(set,runtimeOwners,[value,row]);return true;
     },consumer:disposeOriginalPreparedRuntime,strictProxyGraph:true,
   });
   row.runtime=runtime;
   readOriginalDshBudgetRuntimeBinding(runtime,birth.budgetSource);
   const businessSource=createMainDshBusinessSource({realm:birth.realm,runtime,budgetSource:birth.budgetSource});
   row.lease=freeze({...birth,runtime,runtimePromise:runtimePromise!,harnessUserActor:actor,businessSource});
   apply(set,leases,[row.lease,row]);
   readOriginalMainDshControlSourceBinding(row.user).assertLocal();
  }catch(raw){row.failure={raw};row.stock.inventory(raw);throw raw;}
 });
 const observer=apply(nativeThen,operation,[yes,no]);row.stock.inventory(observer);
 return preparing;
}

/** Passive original prepared tuple, for the fixed KSwarm constructor only. */
export function readOriginalMainDshPreparedSources(candidate:unknown):OriginalMainDshServiceSourceLease {
 const row=apply(get,rows,[candidate]) as Row|undefined;
 if(!row||row.closing||row.serviceClosing||row.failure||!row.lease)throw denied();return row.lease;
}

/** Constructor-only, once per original Sources. This is not a late binding or
 * an actor/permission grant. A copied handle cannot create another runtime. */
export function claimOriginalMainDshServiceSources(candidate:unknown,rawScope:unknown):OriginalMainDshServiceSourceLease {
 if(!candidate||typeof candidate!=='object'||isProxy(candidate))throw denied();
 const row=apply(get,rows,[candidate]) as Row|undefined;
 if(!row||row.claimed||row.closing||row.failure||!row.lease)throw denied();
 const scope=scopeOf(rawScope);
 if(!same(row.scope,scope))throw denied();
 readOriginalMainDshControlSourceBinding(row.user).assertLocal();
 row.claimed=true;return row.lease;
}

/** Record only the exact Store whose constructor pinned these original
 * Sources. The startup lease retains it until Services finishes its birth. */
export function recordOriginalMainDshServiceStore(lease:unknown,store:DesktopMultiAgentStore):void {
 const row=apply(get,leases,[lease]) as Row|undefined;
 if(!row||!row.claimed||row.transferred||row.closing||row.store||!row.birth)throw denied();
 readOriginalDshAdmissionPort(store,row.birth.realm);readOriginalDshUserControlPort(store,row.user);
 row.store=store;
}
export function transferOriginalMainDshServiceSources(lease:unknown):void {
 const row=apply(get,leases,[lease]) as Row|undefined;
 if(!row||!row.claimed||row.transferred||row.closing||row.failure||!row.store)throw denied();
 row.transferred=true;
}
/** Negative startup cleanup only. Once Services has received the lifetime,
 * its existing shutdown path is the sole disposer of this runtime. */
export function closeOriginalMainDshStartupSources(candidate:unknown,cause?:Readonly<{raw:unknown}>):Promise<void> {
 const row=(apply(get,rows,[candidate])??apply(get,leases,[candidate])) as Row|undefined;
 if(!row||row.transferred)throw denied();
 if(row.closing)return row.closing;
 if(cause&&!row.failure){row.failure={raw:cause.raw};row.stock.inventory(cause.raw);}
 // Publish closure before any source/runtime SDK can reenter claim/prepare.
 let yes!:()=>void,no!:(raw:unknown)=>void;
 const closed=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});row.closing=closed;
 const operation=closeResources(row,true);
 // This is a private bookkeeping observer, not an SDK return. Every actual
 // negative SDK/outcome above belongs to its retained custody before release.
 apply(nativeThen,operation,[yes,no]);
 return closed;
}

async function closeResources(row:Row,startup:boolean):Promise<void> {
  const errors:unknown[]=[];
  const negativeVoid=(fn:Function,receiver:unknown)=>{const stock=createRoomTurnCustody();row.negatives.add(stock);stock.syncVoid(fn,receiver,[]);};
  const negative=(fn:Function,receiver:unknown)=>{const stock=createRoomTurnCustody();row.negatives.add(stock);return stock.sdk(fn,receiver,[]);};
  if(row.preparing)try{await row.preparing;}catch(raw){if(!row.failure)row.failure={raw};}
  const birth=row.birth;
  if(birth){
   if(row.lease)try{negativeVoid(row.lease.businessSource.stopAccepting,row.lease.businessSource);}catch(raw){errors[errors.length]=raw;}
   if(row.lease)try{await negative(row.lease.businessSource.close,row.lease.businessSource);}catch(raw){errors[errors.length]=raw;}
   try{negativeVoid(birth.sourcePopulation.stopAccepting,birth.sourcePopulation);}catch(raw){errors[errors.length]=raw;}
   try{negativeVoid(birth.budgetSource.seal,birth.budgetSource);}catch(raw){errors[errors.length]=raw;}
   try{await negative(birth.sourcePopulation.close,birth.sourcePopulation);}catch(raw){errors[errors.length]=raw;}
   try{await negative(birth.budgetSource.drain,birth.budgetSource);}catch(raw){errors[errors.length]=raw;}
   if(row.runtime)try{await row.stock.consumeResource(disposeOriginalPreparedRuntime,row.runtime,[]);}catch(raw){errors[errors.length]=raw;}
   if(startup){
    if(row.store)try{negativeVoid(closeStore,row.store);row.storeClosed=true;}catch(raw){errors[errors.length]=raw;}
    if(row.coreLease)try{await row.coreStock!.consumeResource(closeOriginalMainDshCoreInfrastructure,row.coreLease,[row.coreLease]);await row.coreStock!.waitPhysicalKnown();}catch(raw){errors[errors.length]=raw;}
    try{negativeVoid(birth.realm.seal,birth.realm);}catch(raw){errors[errors.length]=raw;}
   }
  }
  try{await row.stock.waitPhysicalKnown();}catch(raw){errors[errors.length]=raw;}
  const negatives=row.negatives.snapshot();
  for(let i=0;i<negatives.length;i++)try{await negatives[i]!.waitPhysicalKnown();}catch(raw){errors[errors.length]=raw;}
  if(errors.length)throw errors[0];
  row.resourcesClosed=true;
  if(startup&&row.failure)throw row.failure.raw;

}

/** Called by the original Services shutdown owner, after its ingress drain.
 * Leaves the shared groups Store for the existing final durable-close phase. */
export function closeOriginalMainDshServiceResources(lease:unknown):Promise<void> {
 const row=apply(get,leases,[lease]) as Row|undefined;
 if(!row||!row.transferred)throw denied();
 if(row.serviceClosing)return row.serviceClosing;
 let yes!:()=>void,no!:(raw:unknown)=>void;
 const closing=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});row.serviceClosing=closing;
 apply(nativeThen,closeResources(row,false),[yes,no]);return closing;
}
/** Final durable phase only, after the one shared runtime is physically closed. */
export async function finishOriginalMainDshServiceStore(lease:unknown):Promise<void> {
 const row=apply(get,leases,[lease]) as Row|undefined;
 if(!row||!row.transferred||!row.resourcesClosed||!row.store||!row.birth)throw denied();
 let first:{raw:unknown}|undefined;
 if(!row.storeClosed){
  const stock=createRoomTurnCustody();row.negatives.add(stock);
  try{stock.syncVoid(closeStore,row.store,[]);await stock.waitPhysicalKnown();row.storeClosed=true;}catch(raw){first={raw};}
 }
 if(row.coreLease)try{await row.coreStock!.consumeResource(closeOriginalMainDshCoreInfrastructure,row.coreLease,[row.coreLease]);await row.coreStock!.waitPhysicalKnown();}catch(raw){first??={raw};}
 const authority=createRoomTurnCustody();row.negatives.add(authority);
 try{authority.syncVoid(row.birth.realm.seal,row.birth.realm,[]);await authority.waitPhysicalKnown();}catch(raw){first??={raw};}
 if(first)throw first.raw;
}
