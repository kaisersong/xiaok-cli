import { types } from 'node:util';
import type { SqliteWithAuthorizer } from './multi-agent-authorization.js';
const own=Object.getOwnPropertyDescriptor, keys=Reflect.ownKeys, apply=Reflect.apply;
const define=Object.defineProperty, proto=Object.getPrototypeOf, isProxy=types.isProxy;
const isNativeError=types.isNativeError,isPromise=types.isPromise;
const NativeAggregate=AggregateError, aggregatePrototype=AggregateError.prototype;
const arrayPrototype=Array.prototype;
const hasOwn=Object.hasOwn;
const trustedLeafStack=Object.freeze(Object.assign(Object.create(null),own(new Error('ap10-native-leaf-stack-pattern'),'stack')));
const trustedStack=Object.freeze(Object.assign(Object.create(null),own(new NativeAggregate([],'ap10-native-stack-pattern'),'stack')));
function closedStack(value:object,pattern:PropertyDescriptor=trustedStack):boolean{
 const d=own(value,'stack');if(!d)return true;if(hasOwn(d,'value'))return true;
 return !hasOwn(pattern,'value')&&hasOwn(pattern,'get')&&d.get===pattern.get&&d.set===pattern.set&&d.enumerable===pattern.enumerable&&d.configurable===pattern.configurable;
}
function readMethod(receiver:object,key:PropertyKey):Function{
 let current:object|null=receiver;
 while(current){if(isProxy(current))throw Error('ap10_observer_proxy_receiver');const d=own(current,key);if(d){if(!hasOwn(d,'value')||typeof d.value!=='function'||isProxy(d.value))throw Error('ap10_observer_method_not_data');return d.value;}current=proto(current);}
 throw Error('ap10_observer_method_missing');
}
type Method='exec'|'prepare'|'get'|'run'|'all'|'iterate';
type Domain='F'|'G';
type Deny={ action:number; table:string|null; column:string|null; sequence:number };
type Token={ id:number; domain:Domain; receiver:object; method:Method; arity:number; denies:Deny[] };
type Fault={ token:Token; error:unknown };
type Ledger={ error:unknown; result:unknown; record:object };
type Patch={ receiver:object; key:PropertyKey; before?:PropertyDescriptor; installed:PropertyDescriptor };
function data(value:unknown,key:PropertyKey):PropertyDescriptor|undefined{
 if((typeof value!=='object'&&typeof value!=='function')||value===null||isProxy(value))return;
 const d=own(value,key);return d&&hasOwn(d,'value')?d:undefined;
}
function sameDescriptor(a:PropertyDescriptor|undefined,b:PropertyDescriptor|undefined):boolean{
 if(!a||!b)return a===b;
 return ['value','get','set','writable','enumerable','configurable'].every(key=>hasOwn(a,key)===hasOwn(b,key)&&(!hasOwn(a,key)||a[key as keyof PropertyDescriptor]===b[key as keyof PropertyDescriptor]));
}
export function throwAp10Original(errors:readonly unknown[]):void{
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new NativeAggregate(errors,'ap10_body_and_cleanup_failed',{cause:errors[0]});
}
/** Only an actual saved ledger result is supplied by NativeFaultProbe.seal.
 * This pure strict-shape check never reads an error getter or traverses leaves. */
function closedNativeLeaf(value:unknown):boolean{
 if(value===null||typeof value!=='object'||isProxy(value)||!isNativeError(value)||!closedStack(value,trustedLeafStack))return false;
 const allowed=new Set<PropertyKey>(['stack','message','code','errcode','errstr']);
 for(const key of keys(value)){
  if(!allowed.has(key))return false;
  if(key==='stack')continue;
  const d=data(value,key);if(!d)return false;
  if(key==='errcode'){if(typeof d.value!=='number'||!Number.isSafeInteger(d.value)||d.value<0)return false;}
  else if(typeof d.value!=='string')return false;
 }
 return !!data(value,'message');
}
export function isExactAp10LedgerResult(value:unknown,expected:readonly unknown[]):boolean{
 if(!expected.length||expected.some(leaf=>!closedNativeLeaf(leaf)))return false;
 if(expected.length===1)return value===expected[0];
 if(value===null||typeof value!=='object'||isProxy(value)||proto(value)!==aggregatePrototype)return false;
 const allowed=new Set<PropertyKey>(['stack','message','cause','errors']);
 if(keys(value).some(key=>!allowed.has(key))||!closedStack(value))return false;
 const message=data(value,'message'),cause=data(value,'cause'),errors=data(value,'errors');
 if(!message||message.value!=='multi_agent_identity_and_stop_failed'||!cause||cause.value!==expected[0]||!errors)return false;
 const list=errors.value;
 if(!Array.isArray(list)||isProxy(list)||proto(list)!==arrayPrototype)return false;
 const length=data(list,'length');if(!length||length.value!==expected.length||keys(list).length!==expected.length+1)return false;
 for(let i=0;i<expected.length;i++){const d=data(list,String(i));if(!d||d.value!==expected[i])return false;}
 return true;
}
/** A synchronous native call observer, scoped to one real DB and its exact
 * returned statements. No replacement statement/Proxy/error interpretation. */
export class Ap10NativeFaultProbe {
 private readonly statements=new WeakSet<object>();
 private readonly patches:Patch[]=[];
 private readonly faults:Fault[]=[];
 private readonly guards:Fault[]=[];
 private readonly ledger:Ledger[]=[];
 private readonly problems:unknown[]=[];
 private active:Token|undefined;
 private domain:Domain='F';
 private sequence=0; private tokenSequence=0; private businessDenies=0; private guardDenies=0;
 private sealed?:{result:unknown;faults:number;ledger:number;denies:number;problems:number};
 private authorizerInstalled=false;
 private readonly authorizer:SqliteWithAuthorizer['setAuthorizer'];
 constructor(readonly db:SqliteWithAuthorizer,readonly service?:object){
  this.authorizer=readMethod(db,'setAuthorizer') as SqliteWithAuthorizer['setAuthorizer'];
  if(typeof this.authorizer!=='function')throw Error('ap10_native_authorizer_unavailable');
 }
 install():void{
  const specimen=this.db.prepare('SELECT 1');
  const statementPrototype=proto(specimen);
  try{
   this.wrap(this.db,'exec','exec');this.wrap(this.db,'prepare','prepare');
   for(const method of ['get','run','all','iterate']as const)this.wrap(statementPrototype,method,method);
   if(this.service)this.patchLedger(this.service);
  }catch(error){this.problems.push(error);throw error;}
 }
 private issue(reason:string,original?:{error:unknown}):void{this.problems.push(original?original.error:Error(reason));}
 private patch(receiver:object,key:PropertyKey,original:Function,wrapper:Function):void{
  const before=own(receiver,key),installed={...(before??{writable:true,enumerable:false,configurable:true}),value:wrapper};
  if(before&&(!hasOwn(before,'value')||before.value!==original||before.configurable!==true))throw Error('ap10_observer_descriptor_unavailable');
  define(receiver,key,installed);this.patches.push({receiver,key,before,installed});
 }
 private wrap(receiver:object,key:Method,method:Method):void{
  const original=readMethod(receiver,key);
  if(typeof original!=='function'||isProxy(original))throw Error('ap10_native_method_unavailable');
  const self=this;
  this.patch(receiver,key,original,function(this:object,...args:unknown[]){
   const belongs=method==='exec'||method==='prepare'?this===self.db:self.statements.has(this);
   if(!belongs)return apply(original,this,args);
   const parent=self.active,token:Token={id:++self.tokenSequence,domain:self.domain,receiver:this,method,arity:args.length,denies:[]};
   if(parent)self.issue('ap10_native_nested_token_unknown');
   self.active=token;
   let result:unknown,failed:{error:unknown}|undefined;
   try{result=apply(original,this,args);}catch(error){failed={error};}
   try{
    if(failed){
     if(token.denies.length){
      const collection=token.domain==='F'?self.faults:self.guards;collection.push({token,error:failed.error});
      if(self.sealed)self.issue('ap10_native_fault_after_seal');
     }else self.issue('ap10_native_throw_without_same_token_deny',{error:failed.error});
    }else{
     if(token.denies.length)self.issue('ap10_native_deny_returned');
     if(method==='prepare'){
      if(result===null||typeof result!=='object'||isProxy(result))self.issue('ap10_native_statement_unknown');
      else self.statements.add(result);
     }
    }
   }catch(error){self.issue('ap10_native_observer_error',{error});}
   finally{if(self.active!==token)self.issue('ap10_native_token_replaced');self.active=parent;}
   if(failed)throw failed.error;
   return result;
  });
 }
 private patchLedger(service:object):void{
  const original=readMethod(service,'recordUsageStopFailure');
  if(typeof original!=='function'||isProxy(original))throw Error('ap10_ledger_method_unavailable');
  const self=this;
  this.patch(service,'recordUsageStopFailure',original,function(this:object,...args:unknown[]){
   // The original production call always executes first, with identical args.
   const result=apply(original,this,args);
   try{
   if(this!==service){self.issue('ap10_foreign_ledger_receiver');return result;}
   const incoming=args.length===1?data(args[0],'error'):undefined;
   const actualResult=data(result,'result');
   if(!incoming||keys(args[0] as object).length!==1||!actualResult||result===null||typeof result!=='object'||isProxy(result))self.issue('ap10_ledger_data_unknown',{error:result});
   else{
    const matches=self.faults.filter(f=>f.error===incoming.value);
    if(matches.length!==1||incoming.value===undefined||incoming.value===null)self.issue('ap10_ledger_not_unique_native_fault',{error:incoming.value});
    self.ledger.push({error:incoming.value,result:actualResult.value,record:result});
   }
   if(self.sealed)self.issue('ap10_ledger_after_seal');
   }catch(error){self.issue('ap10_ledger_observer_error',{error});}
   return result;
  });
 }
 private installAuthorizer(predicate:(action:number,table:string|null,column:string|null)=>number):void{
  if(this.authorizerInstalled)throw Error('ap10_authorizer_already_installed');
  const self=this;
  apply(this.authorizer,this.db,[(action:number,table:string|null,column:string|null)=>{
   const decision=predicate(action,table,column);
   if(decision===1){
    const row={action,table,column,sequence:++self.sequence};
    if(self.domain==='F')self.businessDenies++;else self.guardDenies++;
    if(!self.active)self.issue('ap10_authorizer_deny_outside_token');else self.active.denies.push(row);
    if(self.sealed)self.issue('ap10_authorizer_deny_after_seal');
   }
   return decision;
  }]);this.authorizerInstalled=true;
 }
 runNativeGuard():void{
  if(this.faults.length||this.ledger.length||this.sealed)throw Error('ap10_guard_not_before_business');
  this.domain='G';
  const stmt=this.db.prepare('SELECT group_id FROM groups LIMIT 1');
  const before=this.guards.length;let caught:{error:unknown}|undefined;
  try{
   this.installAuthorizer((action,table)=>action===20&&table==='groups'?1:0);
   try{stmt.run();}catch(error){caught={error};}
  }finally{this.clear();this.domain='F';}
  if(!caught||this.guards.length!==before+1||this.guards.at(-1)!.token.method!=='run'||this.guards.at(-1)!.error!==caught.error||!this.guardDenies||this.faults.length||this.ledger.length||this.problems.length)throw Error('ap10_real_statement_run_guard_unconfirmed');
 }
 arm(predicate:(action:number,table:string|null,column:string|null)=>number):void{
  if(this.sealed||this.domain!=='F'||!this.guards.length)throw Error('ap10_business_arm_order');
  this.installAuthorizer(predicate);
 }
 clear():void{apply(this.authorizer,this.db,[null]);this.authorizerInstalled=false;}
 seal(expectedDenyCount:number):unknown{
  if(!this.service||this.sealed||!this.faults.length||!this.ledger.length||this.problems.length||this.active||expectedDenyCount!==this.businessDenies)throwAp10Original([...this.problems,Error('ap10_native_ledger_not_closed')]);
  const leaves:unknown[]=[];
  for(const row of this.ledger)if(!leaves.some(value=>value===row.error))leaves.push(row.error);
  const result=this.ledger.at(-1)!.result;
  if(!isExactAp10LedgerResult(result,leaves))throw Error('ap10_ledger_result_shape_or_identity');
  this.sealed={result,faults:this.faults.length,ledger:this.ledger.length,denies:this.businessDenies,problems:this.problems.length};
  return result;
 }
 assertSealed():void{
  const s=this.sealed;
  if(!s||this.active||this.problems.length!==s.problems||this.faults.length!==s.faults||this.ledger.length!==s.ledger||this.businessDenies!==s.denies)throwAp10Original([...this.problems,Error('ap10_sealed_observation_changed')]);
 }
 expected(error:unknown):boolean{this.assertSealed();return this.sealed!.result===error;}
 restore():void{
  if(this.service)this.assertSealed();
  else if(this.authorizerInstalled||this.faults.length||this.ledger.length||this.problems.length||this.guards.length!==1||this.guards[0]!.token.method!=='run')throw Error('ap10_guard_only_restore_unknown');
  const errors:unknown[]=[];
  for(const patch of [...this.patches].reverse())try{
   if(!sameDescriptor(own(patch.receiver,patch.key),patch.installed))throw Error('ap10_observer_restore_conflict');
   if(patch.before)define(patch.receiver,patch.key,patch.before);else if(!Reflect.deleteProperty(patch.receiver,patch.key))throw Error('ap10_observer_restore_failed');
  }catch(error){errors.push(error);}
  throwAp10Original(errors);
 }
 diagnostics(){return{nativeFaults:this.faults.map(f=>({token:f.token.id,method:f.token.method,arity:f.token.arity,denies:f.token.denies.length})),guardFaults:this.guards.map(f=>({token:f.token.id,method:f.token.method,denies:f.token.denies.length})),ledgerCount:this.ledger.length,businessDenies:this.businessDenies,guardDenies:this.guardDenies,observerErrors:this.problems.length};}
}

import { vi,inject } from 'vitest';
import { mkdtempSync,realpathSync,lstatSync } from 'node:fs';
import { tmpdir,userInfo } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopToolCatalogBridge } from '../../electron/desktop-multi-agent-catalog-bridge.js';
import { DesktopCapabilityCatalog } from '../../electron/desktop-multi-agent-capabilities.js';
import { CodexTaskBridge } from '../../electron/codex-task-bridge.js';
import type { DesktopApprovalOwner } from '../../electron/desktop-multi-agent-approval-transport.js';
import type { createDesktopServices } from '../../electron/desktop-services.js';
import type { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import {acquireProfileAccountLease,assertProfileAccountWorkerReleased} from '../../../tests/support/profile-account-ownership.mjs';
type Facade=ReturnType<typeof createDesktopServices>;
type Outcome={ok:true;value:unknown}|{ok:false;error:unknown};
type Slot={name:string;receiver:object;args:unknown[];raw?:unknown;rawWritten:boolean;outcome?:Outcome;observed?:Promise<Outcome>};
type ClosureRecord={services?:Facade;service?:DesktopMultiAgentService;host?:InProcessTaskRuntimeHost;catalog?:DesktopToolCatalogBridge;codex?:CodexTaskBridge;approval?:object};
/** A fixed AP10 receipt validator. It consumes only this helper's retained
 * raw-call slots; it cannot stop owners, mutate authority or release resources. */
export function isAp10UpstreamReceiptSet(slots:readonly Slot[],captured:ClosureRecord,expected:unknown):boolean{
 if(expected===null||typeof expected!=='object'||isProxy(expected)||!isNativeError(expected))return false;
 const allowed=new Set(['facadeDispose','serviceDispose','rawDisposeOwned','codexDispose','approvalDispose','hostDrain','goalStop','hostStop','hostAbort','goalDrain','recoverTask','scopeDispose','fixtureListener']);
 if(slots.some(slot=>!allowed.has(slot.name)))return false;
 const one=(name:string,receiver:object|undefined,ok:boolean)=>{
  const rows=slots.filter(row=>row.name===name);
  const row=rows[0];
  if(!receiver||rows.length!==1||!row||row.receiver!==receiver||!row.rawWritten||!isPromise(row.raw)||isProxy(row.raw)||!row.outcome||row.outcome.ok!==ok)return undefined;
  if(ok&&(!row.outcome.ok||row.outcome.value!==undefined))return undefined;
  return row;
 };
 const facade=one('facadeDispose',captured.services,false),service=one('serviceDispose',captured.service,false),raw=one('rawDisposeOwned',captured.service,true);
 if(!facade||!service||!raw||facade.raw===service.raw||service.raw===raw.raw||facade.raw===raw.raw)return false;
 if(!facade.outcome||facade.outcome.ok||facade.outcome.error!==expected||!service.outcome||service.outcome.ok||service.outcome.error!==expected)return false;
 if(!one('codexDispose',captured.codex,true)||!one('approvalDispose',captured.approval,true))return false;
 const drains=slots.filter(row=>row.name==='hostDrain');
 return !!captured.host&&drains.length>0&&drains.every(row=>row.receiver===captured.host&&row.rawWritten&&isPromise(row.raw)&&!isProxy(row.raw)&&row.outcome?.ok===true&&row.outcome.value===undefined);
}
const abortedGetter=own(AbortSignal.prototype,'aborted')!.get!;
function signalAborted(signal:unknown):boolean{if(!signal||typeof signal!=='object'||isProxy(signal))return false;try{return apply(abortedGetter,signal,[])===true;}catch{return false;}}
export function isAp10ScopeReceiptSet(scopes:ReadonlyArray<{handle:object;signal:AbortSignal;calls:readonly Slot[]}>):boolean{
 return scopes.length>0&&scopes.every(scope=>scope.calls.length===1&&scope.calls[0]!.receiver===scope.handle&&scope.calls[0]!.rawWritten&&scope.calls[0]!.outcome?.ok===true&&scope.calls[0]!.outcome.value===undefined&&signalAborted(scope.signal));
}
const then=Promise.prototype.then;
const owners:Ap10CaseOwner[]=[];
// Worker-lifetime strong ownership. Never cleared, not a shared Symbol.for key.
define(process,Symbol('ap10-native-fault-owners'),{value:owners,writable:false,configurable:false});
export class Ap10CaseOwner {
 readonly references=new Map<string,unknown>();
 readonly callbacks:Slot[]=[];
 readonly observerErrors:unknown[]=[];
 readonly scopes:Array<{handle:object;signal:AbortSignal;calls:Slot[]}>=[];
 readonly captured:ClosureRecord=Object.create(null);
 readonly restorations:Array<()=>void>=[];
 private diagnosticStatus?:{active:number;waiting:number;blocked:boolean};
 readonly identity:{root:string;nonce:string;workerPid:number;workerPpid:number;uid:number;dev:number;ino:number;birthtimeMs:number;runToken:string|null};
 readonly root:string;
 probe?:Ap10NativeFaultProbe;
 private closed=false;
 private poisoned=false;
 private readonly leaseTerminal=Object.assign(Object.create(null),{status:'not-attempted' as 'not-attempted'|'attempting'|'failed-unknown'|'released'});
 get callbackClosed():boolean{return this.closed&&!this.poisoned;}
 get accountLeaseStatus():string{return this.leaseTerminal.status;}
 private body?:Outcome;
 private terminal?:unknown;
 private finishPromise?:Promise<void>;
 private closing=false;
 private acquired=false;
 private accountLease?:ReturnType<typeof acquireProfileAccountLease>;
 private readonly caseNonce=randomUUID().replaceAll('-','');
 private readonly cleanup:Array<()=>void|Promise<void>>;
 private readonly stopMethods=new Map<string,{receiver:object;key:PropertyKey;original:Function}>();
 constructor(kind:string,cleanup:Array<()=>void|Promise<void>>){
  if(owners.some(owner=>owner.callbackClosed!==true))throw Error('ap10_previous_case_callbacks_unknown');
  this.cleanup=cleanup;this.references.set('self',this);this.references.set('registry',owners);owners.push(this);
  this.references.set('kind',kind);this.references.set('leaseTerminal',this.leaseTerminal);
  let allocated:string|undefined;
  try{
   // This is the actual setup-owned private account. Its existing lease gates
   // global home restoration too; a local callback-unknown cannot bypass it.
   const accountOwnership=inject('profileTestAccountOwnership' as never);
   this.references.set('profileAccountOwnership',accountOwnership);
   assertProfileAccountWorkerReleased(accountOwnership);
   const accountHome=realpathSync(userInfo().homedir);this.references.set('profileAccountHome',accountHome);
   const lease=acquireProfileAccountLease(accountOwnership,accountHome,this.caseNonce);
   this.accountLease=lease;this.references.set('profileAccountLease',lease);
   allocated=mkdtempSync(join(tmpdir(),'xiaok-ap10-native-fault-'));this.references.set('allocatedRoot',allocated);
   console.info('XIAOK_AP10_ROOT_ALLOCATED '+JSON.stringify({allocatedRoot:allocated,workerPid:process.pid,workerPpid:process.ppid,identityComplete:false,deletionAuthorized:false}));
   this.root=realpathSync(allocated);const stat=lstatSync(this.root);
   this.identity={root:this.root,nonce:this.caseNonce,workerPid:process.pid,workerPpid:process.ppid,uid:stat.uid,dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs,runToken:process.env.XIAOK_ACTIVITY_FORENSICS_RUN_TOKEN??null};
   this.references.set('identity',this.identity);
   console.info('XIAOK_AP10_ROOT_CREATED '+JSON.stringify({...this.identity,callbackClosed:false,opaqueNativeUnconfirmed:true,retainedForParent:true,nativeCloseAuthorized:false,deletionAuthorized:false}));
  }catch(error){
   this.references.set('partialSetupFailure',{error});
   try{console.info('XIAOK_AP10_PARTIAL_ROOT '+JSON.stringify({allocatedRoot:allocated??null,workerPid:process.pid,workerPpid:process.ppid,callbackClosed:false,identityComplete:false,deletionAuthorized:false}));}
   catch(diagnostic){throwAp10Original([error,diagnostic]);}
   throw error;
  }
 }
 private note(error:unknown){this.observerErrors.push(error);this.poisoned=true;/* Never rewrite the physical lease state after release. */}
 private unique<K extends keyof ClosureRecord>(key:K,value:NonNullable<ClosureRecord[K]>):void{
  const previous=this.captured[key];
  if(previous&&previous!==value){this.note(Error('ap10_foreign_owner_'+key));return;}
  this.captured[key]=value;this.references.set(key,value);
 }
 private bindStop(name:string,receiver:object,key:PropertyKey):void{
  if(this.closing||this.stopMethods.has(name))throw Error('ap10_stop_binding_duplicate_or_late');
  const original=readMethod(receiver,key);const record={receiver,key,original};
  this.stopMethods.set(name,record);this.references.set('stopMethod:'+name,record);
 }
 private watch(name:string,receiver:object,original:Function,args:unknown[],promise:boolean):unknown{
  const slot:Slot=Object.assign(Object.create(null),{name,receiver,args,raw:undefined,rawWritten:false,outcome:undefined,observed:undefined});this.callbacks.push(slot);
  if(this.callbackClosed)this.note(Error('ap10_callback_after_closed'));
  try{
   const raw=apply(original,receiver,args);slot.raw=raw;slot.rawWritten=true;
   if(promise||isPromise(raw)){
    if(!isPromise(raw)||isProxy(raw)){this.note(Error('ap10_original_promise_missing_'+name));return raw;}
    slot.observed=apply(then,raw,[(value:unknown)=>{const result:Outcome={ok:true,value};slot.outcome=result;return result;},(error:unknown)=>{const result:Outcome={ok:false,error};slot.outcome=result;return result;}]);
   }else slot.outcome={ok:true,value:raw};
   return raw;
  }catch(error){slot.outcome={ok:false,error};throw error;}
 }
 private spy(receiver:object,key:PropertyKey,handler:(receiver:object,original:Function,args:unknown[])=>unknown):void{
  const original=readMethod(receiver,key),before=own(receiver,key);
  const owner=this;
  const wrapper=function(this:object,...args:unknown[]){
   let called=false,raw:unknown,failed:{error:unknown}|undefined;
   const callOriginal=function(this:object,...actual:unknown[]){
    if(called){owner.note(Error('ap10_observer_duplicate_original_call'));if(failed)throw failed.error;return raw;}
    called=true;try{raw=apply(original,this,actual);return raw;}catch(error){failed={error};throw error;}
   };
   try{return handler(this,callOriginal,args);}catch(error){
    if(failed&&error===failed.error)throw error;
    owner.note(error);
    if(!called)return apply(original,this,args);
    if(failed)throw failed.error;
    return raw;
   }
  };
  const installed={...(before??{writable:true,enumerable:false,configurable:true}),value:wrapper};
  if(before&&(!hasOwn(before,'value')||!before.configurable))throw Error('ap10_callback_observer_descriptor');
  define(receiver,key,installed);
  this.restorations.push(()=>{
   if(!sameDescriptor(own(receiver,key),installed))throw Error('ap10_callback_restore_conflict:'+(typeof key==='string'?key:'nonstring'));
   if(before)define(receiver,key,before);else if(!Reflect.deleteProperty(receiver,key))throw Error('ap10_callback_restore_failed');
  });
 }
 installBeforeFactory(onApprovalBound:(service:DesktopMultiAgentService,owner:DesktopApprovalOwner)=>void):void{
  const self=this;
  this.spy(DesktopMultiAgentService.prototype,'initialize',(receiver,original,args)=>{
   self.unique('service',receiver as DesktopMultiAgentService);
   const host=args[0] as InProcessTaskRuntimeHost;
   if(!host||typeof host!=='object'){self.note(Error('ap10_primary_host_missing'));return apply(original,receiver,args);}
   if(!self.captured.host){self.unique('host',host);self.spy(host,'drain',(r,f,a)=>self.watch('hostDrain',r,f,a,true));self.bindStop('hostStop',host,'stopAccepting');self.bindStop('hostAbort',host,'abortAllActive');}
   else if(self.captured.host!==host)self.note(Error('ap10_foreign_host'));
   return apply(original,receiver,args);
  });
  this.spy(DesktopMultiAgentService.prototype,'disposeOwned',(receiver,original,args)=>self.watch('rawDisposeOwned',receiver,original,args,true));
  this.spy(DesktopMultiAgentService.prototype,'dispose',(receiver,original,args)=>self.watch('serviceDispose',receiver,original,args,true));
  this.spy(DesktopMultiAgentService.prototype,'bindApprovalTransport',(receiver,original,args)=>{
   self.unique('service',receiver as DesktopMultiAgentService);self.unique('approval',args[0] as object);
   if(args[0]&&!self.references.has('approvalSpyInstalled')){
    self.references.set('approvalSpyInstalled',true);
    self.spy(args[0] as object,'dispose',(r,f,a)=>self.watch('approvalDispose',r,f,a,true));
   }
   const owner=apply(original,receiver,args);
   try{onApprovalBound(receiver as DesktopMultiAgentService,owner);}catch(error){self.note(error);}
   return owner;
  });
  this.spy(CodexTaskBridge.prototype,'selected',(receiver,original,args)=>{self.unique('codex',receiver as CodexTaskBridge);return apply(original,receiver,args);});
  this.spy(CodexTaskBridge.prototype,'dispose',(receiver,original,args)=>{self.unique('codex',receiver as CodexTaskBridge);return self.watch('codexDispose',receiver,original,args,true);});
  this.spy(DesktopToolCatalogBridge.prototype,'applyExecutionAuthorization',(receiver,original,args)=>{if(!self.captured.catalog){self.unique('catalog',receiver as DesktopToolCatalogBridge);self.bindStop('catalogDispose',receiver,'dispose');}else if(self.captured.catalog!==receiver)self.note(Error('ap10_foreign_catalog'));return apply(original,receiver,args);});
  this.spy(DesktopCapabilityCatalog.prototype,'createScopedRegistry',(receiver,original,args)=>{
   const handle=apply(original,receiver,args);
   if(self.captured.catalog&&receiver!==self.captured.catalog.catalog){self.note(Error('ap10_foreign_scope_catalog'));return handle;}
   const authority=data(handle,'authority'),signal=authority&&data(authority.value,'signal');
   if(!handle||typeof handle!=='object'||isProxy(handle)||!signal){self.note(Error('ap10_scope_data_missing'));return handle;}
   const record={handle,signal:signal.value as AbortSignal,calls:[] as Slot[]};self.scopes.push(record);
   self.spy(handle,'dispose',(r,f,a)=>{const length=self.callbacks.length;try{return self.watch('scopeDispose',r,f,a,false);}finally{record.calls.push(self.callbacks[length]!);}});
   return handle;
  });
 }
 onAcquired(services:Facade):void{
  this.unique('services',services);
  if(this.acquired||this.closing){this.note(Error('ap10_facade_acquisition_duplicate_or_late'));throw Error('ap10_facade_acquisition_invalid');}
  this.acquired=true;
  for(const [name,key]of [['facadeDispose','disposeMultiAgent'],['sourceClose','closeTaskSourceWritersForMigration'],['artifactServiceDrain','sealAndDrainArtifactWorkspaceServiceInstance'],['materialAndFileManagerDrain','closeMaterialRegistryAndArtifactFileManagerInstances']]as const)this.bindStop(name,services,key);
  this.bindStop('goalStop',services.goalShutdown.ingress,'stopAccepting');this.bindStop('goalDrain',services.goalShutdown.ingress,'drain');
  this.spy(services,'recoverTask',(r,f,a)=>this.watch('recoverTask',r,f,a,true));
  if(!services.multiAgent||services.multiAgent.service!==this.captured.service){this.note(Error('ap10_facade_service_identity'));throw Error('ap10_facade_service_identity');}
 }
 startNative(db:SqliteWithAuthorizer):Ap10NativeFaultProbe{
  if(!this.acquired||!this.captured.service||this.probe)throw Error('ap10_probe_acquisition_order');
  const probe=new Ap10NativeFaultProbe(db,this.captured.service);this.probe=probe;this.references.set('nativeProbe',probe);probe.install();probe.runNativeGuard();return probe;
 }
 acceptBody(denyCount:number):void{
  const receipts=this.callbacks.filter(slot=>slot.name==='recoverTask'&&slot.outcome?.ok);
  const terminal=receipts.at(-1)?.outcome;
  if(!terminal||!terminal.ok)throw Error('ap10_original_terminal_receipt_missing');
  const snapshot=data(terminal.value,'snapshot'),status=snapshot&&data(snapshot.value,'status');
  if(!status||!['failed','cancelled','interrupted'].includes(status.value))throw Error('ap10_original_terminal_not_closed');
  this.terminal=terminal.value;this.references.set('businessTerminal',this.terminal);this.probe!.seal(denyCount);this.body={ok:true,value:undefined};
 }
 failBody(error:unknown):void{this.body={ok:false,error};this.references.set('bodyFailure',{error});}
 private start(name:string,receiver:object,key:PropertyKey,args:unknown[]=[],promise=true):Slot{
  const offset=this.callbacks.length;
  try{
   const binding=this.stopMethods.get(name);
   if(name!=='fixtureListener'&&(!binding||binding.receiver!==receiver||binding.key!==key||readMethod(receiver,key)!==binding.original))throw Error('ap10_stop_method_binding_changed_'+name);
   this.watch(name,receiver,binding?.original??readMethod(receiver,key),args,promise);
  }catch(error){if(this.callbacks.length===offset)this.callbacks.push({name,receiver,args,rawWritten:false,outcome:{ok:false,error}});}
  return this.callbacks[offset]!;
 }
 private async join(slots:readonly Slot[],errors:unknown[]):Promise<void>{
  // All actions have already been invoked. Await original nonthrow outcomes in
  // fixed registration order; never race/timeout or fabricate a release.
  for(const slot of slots){
   if(!slot){errors.push(Error('ap10_callback_slot_missing'));continue;}
   if(slot.observed)await slot.observed;
   if(!slot.outcome)errors.push(Error('ap10_callback_pending_or_unknown_'+slot.name));
   else if(!slot.outcome.ok)errors.push(slot.outcome.error);
   else if(!['goalDrain','recoverTask','facadeDispose','serviceDispose'].includes(slot.name)&&slot.outcome.value!==undefined)errors.push(Error('ap10_void_callback_returned_value_'+slot.name));
  }
 }
 private requireOne(name:string,receiver:object|undefined):Slot{
  const slots=this.callbacks.filter(slot=>slot.name===name);
  if(!receiver||slots.length!==1||slots[0]!.receiver!==receiver||!slots[0]!.rawWritten||!slots[0]!.outcome?.ok)throw Error('ap10_owner_receipt_unconfirmed_'+name);
  return slots[0]!;
 }
 finish():Promise<void>{return this.finishPromise??=(this.finishOwned());}
 private async finishOwned():Promise<void>{
  this.closing=true;const errors:unknown[]=[];let observerCursor=0;
  const collectObserverErrors=()=>{while(observerCursor<this.observerErrors.length)errors.push(this.observerErrors[observerCursor++]);};
  if(this.body?.ok===false)errors.push(this.body.error);
  const services=this.captured.services,host=this.captured.host;
  const safe:Slot[]=[];
  if(this.probe)try{this.probe.clear();}catch(error){errors.push(error);}
  // The unchanged fixture release/unsubscribe callbacks are independent; start
  // every one before awaiting any. No service/native/root close is in this list.
  for(const action of this.cleanup.splice(0).reverse()){
   const receiver={action};safe.push(this.start('fixtureListener',receiver,'action',[],false));
  }
  if(services){safe.push(this.start('goalStop',services.goalShutdown.ingress,'stopAccepting',[],false));}
  if(host){safe.push(this.start('hostStop',host,'stopAccepting',['app_shutdown'],false));safe.push(this.start('hostAbort',host,'abortAllActive',['app_shutdown'],false));}
  const upstream:Slot[]=[];
  if(services)upstream.push(this.start('facadeDispose',services,'disposeMultiAgent'));
  if(host){try{host.drain();}catch(error){errors.push(error);}}

  await this.join(safe,errors);await this.join(upstream,errors);
  // Expected C is a negative receipt only; classify the facade rejection apart
  // from all independent actual owner callbacks.
  const publicSlot=upstream.find(slot=>slot.name==='facadeDispose');

  if(publicSlot?.outcome&&!publicSlot.outcome.ok&&this.body?.ok){
   try{if(this.probe?.expected(publicSlot.outcome.error)){
    const i=errors.lastIndexOf(publicSlot.outcome.error);if(i>=0)errors.splice(i,1);
   }else errors.push(Error('ap10_unexpected_dispose_identity'));}catch(error){errors.push(error);}
  }else errors.push(Error('ap10_expected_dispose_rejection_missing'));
  let expectedC:unknown;try{this.probe!.assertSealed();const facade=publicSlot?.outcome;if(facade&&!facade.ok&&this.probe!.expected(facade.error))expectedC=facade.error;}catch(error){errors.push(error);}
  const pending=this.callbacks.filter(slot=>['rawDisposeOwned','serviceDispose','codexDispose','approvalDispose','hostDrain'].includes(slot.name));
  const unrelated:unknown[]=[];await this.join(pending,unrelated);
  // serviceDispose is the expected sticky negative, never a fulfilled receipt.
  const serviceSlots=pending.filter(slot=>slot.name==='serviceDispose');
  for(const slot of serviceSlots)if(slot.outcome&&!slot.outcome.ok){
   try{if(this.probe?.expected(slot.outcome.error)){const index=unrelated.lastIndexOf(slot.outcome.error);if(index>=0)unrelated.splice(index,1);}}catch(error){errors.push(error);}
  }
  errors.push(...unrelated);collectObserverErrors();
  try{
   if(!isAp10UpstreamReceiptSet(this.callbacks,this.captured,expectedC))throw Error('ap10_upstream_fixed_population_unknown');
   const raw=this.requireOne('rawDisposeOwned',this.captured.service);
   this.requireOne('codexDispose',this.captured.codex);this.requireOne('approvalDispose',this.captured.approval);
   if(serviceSlots.length!==1||raw.raw===serviceSlots[0]!.raw||serviceSlots[0]!.raw===publicSlot?.raw)throw Error('ap10_original_disposal_promises_not_distinct');
   const drains=this.callbacks.filter(slot=>slot.name==='hostDrain');
   if(!host||!drains.length||drains.some(slot=>slot.receiver!==host||!slot.outcome?.ok)||host.inFlightTaskIds().length)throw Error('ap10_actual_host_drains_unknown');
   // Actual public coordinator/status facts are consistency checks, never a
   // substitute for any original owner receipt. An intentionally blocked fault
   // is permitted; nonzero activity cannot be signed as callback-closed.
   const options=data(this.captured.service,'options'),coordinator=options&&data(options.value,'coordinator');
   if(!coordinator||!coordinator.value||typeof coordinator.value!=='object'||isProxy(coordinator.value))throw Error('ap10_actual_coordinator_missing');
   this.references.set('coordinator',coordinator.value);
   const snapshot=apply(readMethod(coordinator.value,'snapshot'),coordinator.value,[]);
   const active=data(snapshot,'active'),waiting=data(snapshot,'waiting');
   const runtime=apply(readMethod(this.captured.service!,'runtimeStatus'),this.captured.service,[]),blocked=data(runtime,'blocked');
   if(!active||!waiting||!blocked||!Number.isSafeInteger(active.value)||active.value<0||!Number.isSafeInteger(waiting.value)||waiting.value<0||typeof blocked.value!=='boolean')throw Error('ap10_actual_runtime_diagnostic_unknown');
   this.diagnosticStatus={active:active.value,waiting:waiting.value,blocked:blocked.value};this.references.set('actualRuntimeSnapshot',snapshot);this.references.set('actualRuntimeStatus',runtime);
   if(active.value!==0||waiting.value!==0)throw Error('ap10_activity_conflicts_with_callback_closure');
   if(this.callbacks.some(slot=>!slot.outcome))throw Error('ap10_observed_callback_still_pending');
   if(!this.body?.ok||!this.terminal||!this.acquired)throw Error('ap10_business_or_acquisition_incomplete');
   this.probe!.assertSealed();
  }catch(error){errors.push(error);}
  // A dependency boundary: unknown upstream means NO source/material/artifact
  // close, NO observer restore and NO next-case admission.
  if(!errors.length&&services){
   // Frozen 612f dependency order: all upstream original receipts first,
   // source -> artifact service -> grouped material/file-manager, then the
   // Goal/catalog/scopes receipt gates. Unknown never starts a later phase.
   const source=this.start('sourceClose',services,'closeTaskSourceWritersForMigration');await this.join([source],errors);collectObserverErrors();
   if(!errors.length){const artifact=this.start('artifactServiceDrain',services,'sealAndDrainArtifactWorkspaceServiceInstance');await this.join([artifact],errors);collectObserverErrors();}
   if(!errors.length){const material=this.start('materialAndFileManagerDrain',services,'closeMaterialRegistryAndArtifactFileManagerInstances');await this.join([material],errors);collectObserverErrors();}
   if(!errors.length){
    const goal=this.start('goalDrain',services.goalShutdown.ingress,'drain',[0]);await this.join([goal],errors);collectObserverErrors();
    if(!goal.outcome?.ok||goal.outcome.value!==true)errors.push(Error('ap10_goal_drain_unconfirmed'));
   }
   if(!errors.length&&this.captured.catalog){const catalog=this.start('catalogDispose',this.captured.catalog,'dispose',[],false);await this.join([catalog],errors);collectObserverErrors();}
   if(!errors.length)try{
    this.requireOne('catalogDispose',this.captured.catalog);
    if(!isAp10ScopeReceiptSet(this.scopes))throw Error('ap10_scope_dispose_population_unknown');
    this.probe!.assertSealed();
   }catch(error){errors.push(error);}
  }
  collectObserverErrors();
  if(this.callbacks.some(slot=>!slot.outcome))errors.push(Error('ap10_callback_not_settled_at_restore_gate'));
  if(!errors.length){
   // Native DB/root remain retained even when callback isolation is proven.
   try{vi.restoreAllMocks();}catch(error){errors.push(error);}
   try{this.probe!.restore();}catch(error){errors.push(error);}
   for(const restore of [...this.restorations].reverse())try{restore();}catch(error){errors.push(error);}
   try{vi.unstubAllEnvs();}catch(error){errors.push(error);}
  }
  try{
   const stat=lstatSync(this.root);if(realpathSync(this.root)!==this.identity.root||stat.uid!==this.identity.uid||stat.dev!==this.identity.dev||stat.ino!==this.identity.ino||stat.birthtimeMs!==this.identity.birthtimeMs)throw Error('ap10_retained_root_identity_changed');
   console.info('XIAOK_AP10_RETAINED_ROOT '+JSON.stringify({...this.identity,callbackClosed:false,closureProvenBeforeLeaseRelease:errors.length===0,accountLeaseReleased:false,opaqueNativeUnconfirmed:true,retainedForParent:true,nativeCloseAuthorized:false,deletionAuthorized:false,unexpectedFailures:errors.length,probe:this.probe?.diagnostics()??null,runtime:this.diagnosticStatus??null,callbackPopulation:this.callbacks.map(slot=>({name:slot.name,rawWritten:slot.rawWritten,settled:slot.outcome!==undefined,ok:slot.outcome?.ok??null,originalPromise:slot.rawWritten&&isPromise(slot.raw)&&!isProxy(slot.raw)}))}));
  }catch(error){errors.push(error);}
  // Finish every fallible evidence/log/Map operation BEFORE release. The
  // helper's immutable ledger acknowledgement is the physical release receipt.
  // No post-release logging or catch may falsely turn it back into retained.
  collectObserverErrors();this.references.set('cleanupErrors',errors);
  if(errors.length)throwAp10Original(errors);
  if(!this.accountLease)throw Error('ap10_actual_account_lease_missing');
  this.references.set('leaseReleasePrepared',true);
  this.leaseTerminal.status='attempting';
  try{this.accountLease.release();}
  catch(error){this.leaseTerminal.status='failed-unknown';throw error;}
  this.leaseTerminal.status='released';this.closed=true;

 }
}
