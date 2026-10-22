// @vitest-environment node
import {expect,it,vi,inject,type TestContext} from 'vitest';
import process from 'node:process';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {isProxy,isNativeError,isPromise} from 'node:util/types';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,lstatSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
const fixture=vi.hoisted(()=>({home:''}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:fixture.home})};});
vi.unmock('../../../src/runtime/verification/ordinary-source-writer-observation.js');
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {DesktopMultiAgentService,type DesktopAgentExecutionContext} from '../../electron/desktop-multi-agent-service.js';
import {DesktopExecutionCoordinator} from '../../electron/desktop-execution-coordinator.js';
import {DesktopMultiAgentTurnMailbox,MultiAgentCommandSequencer} from '../../electron/desktop-multi-agent-mailbox.js';
import {DesktopMultiAgentWorktrees} from '../../electron/desktop-multi-agent-worktrees.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createKnownDirectoryWriterFence} from '../../../src/runtime/verification/known-directory-writer-fence.js';
import {acquireProfileAccountLease,assertProfileAccountWorkerReleased} from '../../../tests/support/profile-account-ownership.mjs';
import {closeDesktopModelPhysicalScope,assertDesktopModelPhysicalIdle,type DesktopModelPhysicalScope} from '../../electron/desktop-task-stream.js';
// Test-local fixed population. No capability/IPC, no generic owner platform.
const own=Object.getOwnPropertyDescriptor,define=Object.defineProperty,apply=Reflect.apply,prototype=Object.getPrototypeOf;
const nativeThen=Promise.prototype.then,nativeParse=JSON.parse,nativeSetSize=own(Set.prototype,'size')!.get!,nativeDelete=Reflect.deleteProperty;
type Outcome={ok:true;value:unknown}|{ok:false;error:unknown};
type Slot={raw:Promise<unknown>;outcome:Promise<Outcome>;result?:Outcome};
type QCall={tail:boolean;result:Outcome};
type Publication={directory:string;uid:number;dev:number;ino:number;path:string;bytes:Buffer;file:{dev:number;ino:number;uid:number;birthtimeMs:number}};
type CaseRecord={
 root?:string;identity?:{root:string;nonce:string;accountRunNonce:string;pid:number;ppid:number;uid:number;dev:number;ino:number;birthtimeMs:number};
 lease?:ReturnType<typeof acquireProfileAccountLease>;rootDeleted:boolean;callbackClosed:boolean;accountReleased:boolean;closing:boolean;sealed:boolean;
 extras:unknown[];restores:Array<()=>void>;rawReferences:unknown[];store?:DesktopMultiAgentStore;db?:DatabaseSync;nativeGetter?:(this:DatabaseSync)=>boolean;
 service?:DesktopMultiAgentService;host?:InProcessTaskRuntimeHost;materials?:MaterialRegistry;coordinator?:DesktopExecutionCoordinator;
 init?:Slot;action?:Slot;rootRun?:Slot;owned?:Slot;disposal?:Slot;source?:Slot;material?:Slot;postDrain?:Slot;bodyDrain?:Slot;physical?:Slot;scope?:DesktopModelPhysicalScope;
 publication?:Publication;begin?:{count:()=>number};Fput?:{error:unknown};Fsettle?:{error:unknown};expectedGateFailure?:{error:unknown};L:unknown[];ledgerResult?:{value:unknown};
 q:QCall[];ownedEntered:boolean;sessionCalls:number;authCalls:number;bindCalls:number;reconcileCalls:number;freezeDepth:number;
 H?:Promise<unknown>;C?:Function;T?:Promise<unknown>;thenCalls:number;callbackCalls:number;inTail:boolean;tailExit?:Outcome;
 tailDone:Promise<void>;resolveTail:()=>void;restoreThen?:()=>void;thenRestored:boolean;postDrainRequested:boolean;
 contextTaskId?:string;contextGroupId?:string;rootTicket?:DesktopAgentExecutionContext['memberTicket'];activeFreeze?:unknown;activeFreezeReason?:unknown;poisoned:boolean;stopMarkCompleted:boolean;leaseAttempted:boolean;allocationUnknown:boolean;scenario?:Promise<void>;work?:Slot;hookFailure?:{error:unknown};abortErrors:unknown[];probeU?:Error;probeHits:number;bodyPassed:boolean;
};
const retained:CaseRecord[]=[];
const registryKey=Symbol('known-producer-fixture-owners');
define(process,registryKey,{value:retained,writable:false,enumerable:false,configurable:false});
const registryDescriptor=own(process,registryKey)!;
expect(registryDescriptor.value).toBe(retained);
expect([registryDescriptor.writable,registryDescriptor.enumerable,registryDescriptor.configurable]).toEqual([false,false,false]);
const ownership=inject('profileTestAccountOwnership' as never) as unknown;
const nativeOs=createRequire(import.meta.url)('node:os') as typeof import('node:os');
let active:CaseRecord|undefined;
// Only the separately reviewed E negative variant changes this literal.
const BODY_STOP_U_PROBE=false;
function throwAll(errors:unknown[]):void {
 if(errors.length===1)throw errors[0];
 if(errors.length>1)throw new AggregateError(errors,'known_producer_original_and_cleanup_failed',{cause:errors[0]});
}
function proof(condition:unknown,label:string):asserts condition {if(!condition)throw Error('known_producer_proof_failed:'+label);}
function bad(r:CaseRecord,label:string):void {r.poisoned=true;if(r.sealed)r.callbackClosed=false;r.extras.push(Error('known_producer_observation_unknown:'+label));}
function safeObserve(r:CaseRecord,work:()=>void):void {try{work();}catch(error){r.poisoned=true;if(r.sealed)r.callbackClosed=false;r.extras.push(error);}}
function data(value:unknown,key:PropertyKey):unknown {
 if((typeof value!=='object'&&typeof value!=='function')||value===null||isProxy(value))throw Error('known_producer_data_receiver');
 const d=own(value,key);if(!d||!Object.hasOwn(d,'value'))throw Error('known_producer_data_descriptor');return d.value;
}
function observeP(r:CaseRecord,raw:unknown):Slot {
 if(!isPromise(raw)||isProxy(raw))throw Error('known_producer_original_promise_missing');
 const s={raw:raw as Promise<unknown>} as Slot;
 s.outcome=apply(nativeThen,raw,[value=>{const result:Outcome={ok:true,value};s.result=result;return result;},error=>{const result:Outcome={ok:false,error};s.result=result;return result;}]);
 r.rawReferences.push(raw,s.outcome);return s;
}
function instrument(r:CaseRecord,receiver:object,key:string,work:(original:Function,self:unknown,args:unknown[])=>unknown):void {
 proof(!isProxy(receiver),'method-receiver-native');let holder:object|null=receiver,descriptor:PropertyDescriptor|undefined;while(holder&&!descriptor){descriptor=own(holder,key);holder=prototype(holder);}
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function'||isProxy(descriptor.value))throw Error('known_producer_original_method_missing:'+key);const original=descriptor.value as Function;
 r.rawReferences.push(receiver,original);
 const spy=vi.spyOn(receiver as any,key).mockImplementation(function(this:unknown,...args:unknown[]){return work(original,this,args);});
 r.restores.push(()=>spy.mockRestore());
}
// Unlike tinyspy, this fixed instance wrapper never reads .then on its return.
function instrumentHostDrain(r:CaseRecord,host:InProcessTaskRuntimeHost,work:(original:Function,self:unknown,args:unknown[])=>unknown):void {
 proof(!isProxy(host)&&prototype(host)===InProcessTaskRuntimeHost.prototype,'host-drain-original-instance');
 const previous=own(host,'drain');proof(previous===undefined,'host-drain-original-own-absent');
 const descriptor=own(InProcessTaskRuntimeHost.prototype,'drain');
 proof(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function'&&!isProxy(descriptor.value)
  &&descriptor.writable===true&&descriptor.enumerable===false&&descriptor.configurable===true,'host-drain-original-data-method');
 const original=descriptor.value as Function;
 const wrapper=function(this:unknown,...args:unknown[]){return work(original,this,args);};
 r.rawReferences.push(host,original,wrapper);
 define(host,'drain',{value:wrapper,writable:true,enumerable:false,configurable:true});
 r.restores.push(()=>{
  const installed=own(host,'drain');
  proof(installed&&Object.hasOwn(installed,'value')&&installed.value===wrapper&&installed.writable===true
   &&installed.enumerable===false&&installed.configurable===true&&!Object.hasOwn(installed,'get')&&!Object.hasOwn(installed,'set'),'host-drain-installed-descriptor-unchanged');
  proof(nativeDelete(host,'drain')&&own(host,'drain')===previous,'host-drain-original-presence-restored');
  const inherited=own(InProcessTaskRuntimeHost.prototype,'drain');
  proof(inherited&&Object.hasOwn(inherited,'value')&&inherited.value===original&&inherited.writable===descriptor.writable
   &&inherited.enumerable===descriptor.enumerable&&inherited.configurable===descriptor.configurable,'host-drain-original-prototype-unchanged');
 });
}
function current():CaseRecord {if(!active)throw Error('known_producer_case_missing');if(active.closing){bad(active,'late-allocation');throw Error('known_producer_case_closing');}return active;}
function nativeOpen(r:CaseRecord):boolean {
 if(!r.store||!r.db||!r.nativeGetter||data(r.store,'db')!==r.db)throw Error('known_producer_native_receiver_changed');
 const d=own(r.db,'isOpen');if(!d||d.get!==r.nativeGetter||d.set!==undefined||d.configurable!==false)throw Error('known_producer_native_descriptor_changed');
 const value=apply(r.nativeGetter,r.db,[]);if(typeof value!=='boolean')throw Error('known_producer_native_receipt_unknown');return value;
}
function sameRoot(r:CaseRecord):void {
 const id=r.identity;if(!id||!r.root)throw Error('known_producer_root_identity_missing');const s=lstatSync(r.root);
 expect(realpathSync(r.root)).toBe(id.root);expect(s.isDirectory()&&!s.isSymbolicLink()).toBe(true);
 expect([s.uid,s.dev,s.ino,s.birthtimeMs]).toEqual([id.uid,id.dev,id.ino,id.birthtimeMs]);
}
function publicationCurrent(r:CaseRecord):void {
 const p=r.publication;if(!p)throw Error('known_producer_published_fence_missing');
 const dir=lstatSync(p.directory),f=lstatSync(p.path);
 expect(realpathSync(p.directory)).toBe(p.directory);expect(dir.isDirectory()&&!dir.isSymbolicLink()).toBe(true);
 expect([dir.uid,dir.dev,dir.ino]).toEqual([p.uid,p.dev,p.ino]);
 expect(f.isFile()&&!f.isSymbolicLink()&&f.nlink===1).toBe(true);
 expect([f.uid,f.dev,f.ino,f.birthtimeMs]).toEqual([p.file.uid,p.file.dev,p.file.ino,p.file.birthtimeMs]);
 expect(readFileSync(p.path)).toEqual(p.bytes);expect(r.begin?.count()).toBe(1);expect(r.store!.hasUsageIdentityFailure()).toBe(false);
}
function origin(r:CaseRecord,kind:'put'|'settle',self:unknown,args:unknown[],error:unknown):void {
 // Captured actual methods execute admission before body/argument consumption.
 proof(self===r.store,'origin-receiver');publicationCurrent(r);
 if(kind==='put'){
  proof(r.freezeDepth===1&&r.activeFreezeReason==='multi_agent_persistence_failed'&&args.length===2&&args[1]===true,'put-origin-call');
  proof(data(args[0],'groupId')===r.contextGroupId&&r.activeFreeze!==undefined&&data(r.activeFreeze,'id')===r.contextGroupId,'put-origin-group');
 }else{proof(args.length===0&&r.ownedEntered&&r.q.length===0,'settle-origin-call');}
 proof(!isProxy(error)&&isNativeError(error),'origin-native-error');
 const message=own(error as object,'message');proof(message&&Object.hasOwn(message,'value')&&message.value==='known_writer_fence_fenced','origin-code');
 proof(own(error as object,'cause')===undefined&&own(error as object,'errors')===undefined,'origin-leaf-shape');
 const key=kind==='put'?'Fput':'Fsettle';proof(r[key]===undefined,'origin-unique');r[key]={error};
}
function observeStore(r:CaseRecord,store:DesktopMultiAgentStore):void {
 r.store=store;r.db=data(store,'db') as DatabaseSync;const d=own(r.db,'isOpen');
 if(!d||typeof d.get!=='function'||d.configurable!==false||d.set!==undefined)throw Error('known_producer_native_getter_missing');r.nativeGetter=d.get;
 for(const [key,kind]of [['putGroup','put'],['settleBootOwnership','settle']]as const)instrument(r,store,key,(original,self,args)=>{
  try{return apply(original,self,args);}catch(error){safeObserve(r,()=>origin(r,kind,self,args,error));throw error;}
 });
}
function observeTail(r:CaseRecord,H:Promise<unknown>):void {
 proof(r.H===undefined&&isPromise(H)&&!isProxy(H),'actual-tail-native-promise');r.H=H;r.rawReferences.push(H);
 const previous=own(H,'then');
 if(previous&&(!Object.hasOwn(previous,'value')||previous.value!==nativeThen||previous.configurable!==true))throw Error('known_producer_tail_then_shape');
 const observed=function(this:unknown,...args:unknown[]){
  r.thenCalls++;
  if(this!==H||r.thenCalls!==1||args.length!==1||typeof args[0]!=='function'||r.sealed){bad(r,'tail-then-population-or-arguments');return apply(nativeThen,this,args);}
  const C=args[0] as Function;r.C=C;r.rawReferences.push(C);
  const callback=function(this:unknown,...values:unknown[]){
   r.callbackCalls++;safeObserve(r,()=>{proof(r.callbackCalls===1&&!r.inTail&&!r.sealed,'tail-callback-population');});
   r.inTail=true;let result:Outcome;
   try{const value=apply(C,this,values);result={ok:true,value};return value;}
   catch(error){result={ok:false,error};throw error;}
   finally{r.inTail=false;safeObserve(r,()=>{r.tailExit=result!;r.resolveTail();});}
  };
  // One original native call creates T; no reaction is added by the observer.
  const T=apply(nativeThen,this,[callback]);safeObserve(r,()=>{proof(r.T===undefined,'tail-promise-unique');r.T=T;r.rawReferences.push(T);});return T;
 };
 define(H,'then',{value:observed,writable:true,enumerable:false,configurable:true});
 r.restoreThen=()=>{
  const now=own(H,'then');proof(now&&Object.hasOwn(now,'value')&&now.value===observed,'tail-observer-restore-presence');
  if(previous)define(H,'then',previous);else if(!nativeDelete(H,'then'))throw Error('known_producer_tail_then_delete_failed');
  const after=own(H,'then');expect(after).toEqual(previous);r.thenRestored=true;
 };
}
function observeService(r:CaseRecord,service:DesktopMultiAgentService,host:InProcessTaskRuntimeHost):void {
 r.service=service;r.host=host;
 instrument(r,service,'trackAuthorizationStop',(original,self,args)=>{r.authCalls++;bad(r,'authorization-producer-not-zero');return apply(original,self,args);});
 for(const key of ['bindHostDeliveryOwner','reconcileActivityRuns'])instrument(r,service,key,(original,self,args)=>{if(key==='bindHostDeliveryOwner')r.bindCalls++;else r.reconcileCalls++;bad(r,'reconcile-producer-not-zero');return apply(original,self,args);});
 instrument(r,service,'freezeGroup',(original,self,args)=>{
  const previous=r.activeFreeze,previousReason=r.activeFreezeReason,previousMark=r.stopMarkCompleted;r.freezeDepth++;r.activeFreeze=args[0];r.activeFreezeReason=args[1];r.stopMarkCompleted=false;try{return apply(original,self,args);}finally{r.freezeDepth--;r.activeFreeze=previous;r.activeFreezeReason=previousReason;r.stopMarkCompleted=previousMark;}
 });
 instrument(r,service,'recordUsageStopFailure',(original,self,args)=>{
  const result=apply(original,self,args);
  safeObserve(r,()=>{proof(self===service&&!r.sealed,'ledger-instance-and-open');const value=data(args[0],'error');r.L.push(value);r.ledgerResult={value:data(result,'result')};if(!r.Fput||value!==r.Fput.error)bad(r,'ledger-incoming-without-fence-origin');});
  return result;
 });
 instrument(r,service,'markRootStopping',(original,self,args)=>{const value=apply(original,self,args);if(r.freezeDepth===1&&args[0]===r.activeFreeze)r.stopMarkCompleted=true;return value;});
 instrument(r,service,'wake',(original,self,args)=>{
  const value=apply(original,self,args);
  if(BODY_STOP_U_PROBE&&r.freezeDepth===1&&r.activeFreezeReason==='multi_agent_persistence_failed'&&r.Fput&&r.stopMarkCompleted&&args[0]===r.activeFreeze){r.probeHits++;if(r.probeHits!==1){bad(r,'body-U-duplicate');return value;}throw r.probeU;}
  return value;
 });
 instrument(r,service,'disposeOwned',(original,self,args)=>{
  safeObserve(r,()=>{proof(self===service&&args.length===0&&!r.ownedEntered,'raw-owner-call');r.ownedEntered=true;});
  const raw=apply(original,self,args);safeObserve(r,()=>{proof(r.owned===undefined,'raw-owner-unique');r.owned=observeP(r,raw);});return raw;
 });
 instrument(r,service,'dispose',(original,self,args)=>{
  const raw=apply(original,self,args);safeObserve(r,()=>{proof(self===service&&args.length===0,'public-disposal-call');if(r.disposal)proof(raw===r.disposal.raw,'public-disposal-memo');else r.disposal=observeP(r,raw);});return raw;
 });
 instrument(r,service,'tryShutdownQuiescence',(original,self,args)=>{
  let result:Outcome;
  try{const value=apply(original,self,args);result={ok:true,value};return value;}
  catch(error){result={ok:false,error};throw error;}
  finally{safeObserve(r,()=>{proof(self===service&&args.length===0&&r.ownedEntered&&!r.sealed,'quiescence-call');r.q.push({tail:r.inTail,result:result!});if(r.q.length>2)bad(r,'extra-quiescence-call');});}
 });
 instrumentHostDrain(r,host,(original,self,args)=>{
  const raw=apply(original,self,args);
  safeObserve(r,()=>{
   proof(self===host&&args.length===0&&!r.sealed,'host-drain-instance-and-arguments');
   if(r.ownedEntered&&!r.owned?.result){proof(r.q.length===1&&!r.q[0].tail&&r.q[0].result.ok&&r.q[0].result.value===false,'host-tail-origin');observeTail(r,raw as Promise<unknown>);}
   else if(r.postDrainRequested){proof(r.postDrain===undefined&&r.owned?.result!==undefined,'post-owner-drain-population');r.postDrain=observeP(r,raw);}
   else {proof(!r.ownedEntered&&r.bodyDrain===undefined&&!r.closing,'body-drain-population');r.bodyDrain=observeP(r,raw);}
  });
  return raw;
 });
}
function zeroProducerPopulation(r:CaseRecord):void {
 expect([r.authCalls,r.bindCalls,r.reconcileCalls,r.sessionCalls]).toEqual([0,0,0,0]);
 for(const key of ['activityReconcilePending','activityReconcileTimer']){const d=own(r.service!,key);expect(!d||Object.hasOwn(d,'value')&&d.value===undefined).toBe(true);}
 const stops=data(r.service!,'authorizationStops');expect(isProxy(stops)).toBe(false);expect(stops).toBeInstanceOf(Set);expect(apply(nativeSetSize,stops,[])).toBe(0);
}
async function observeDisposalForAssertions(f:{service:DesktopMultiAgentService}):Promise<void> {
 const r=current();const raw=f.service.dispose();proof(r.disposal?.raw===raw,'body-disposal-original');await r.disposal!.outcome;
}
async function guardFirstDisposal(f:{service:DesktopMultiAgentService}):Promise<void> {const r=current();const raw=f.service.dispose();proof(r.disposal?.raw===raw,'first-D-original');const out=await r.disposal!.outcome;proof(r.Fsettle!==undefined&&!out.ok&&out.error===r.Fsettle.error,'first-D-source');}
function expectedDisposal(r:CaseRecord,outcome:Outcome):void {
 if(!r.publication){expect(outcome.ok).toBe(true);return;}
 const F=r.Fput??r.Fsettle;expect(F).toBeDefined();expect(outcome.ok).toBe(false);if(outcome.ok)throw Error('known_producer_expected_disposal_rejection_missing');if(outcome.error!==F!.error){const error=Error('known_producer_proof_failed:public-disposal-exact-origin');r.expectedGateFailure={error};throw error;}
 expect(r.disposal?.raw).not.toBe(r.owned?.raw);
 if(r.Fput){expect(r.Fsettle).toBeUndefined();proof(r.L.length===1&&r.L[0]===F!.error&&r.ledgerResult?.value===F!.error,'ledger-exact-origin');}
 else{expect(r.L).toHaveLength(0);}
}
async function closeCallbacks(r:CaseRecord):Promise<void> {
 const service=r.service!,host=r.host!;zeroProducerPopulation(r);expect(r.init?.result).toEqual({ok:true,value:undefined});
 const D=service.dispose();proof(r.disposal?.raw===D,'close-disposal-original');const d=await r.disposal!.outcome;expect(r.owned).toBeDefined();const o=await r.owned!.outcome;
 expectedDisposal(r,d);
 if(r.Fsettle){expect(o.ok).toBe(false);if(!o.ok)proof(o.error===r.Fsettle.error,'raw-owner-settle-origin');expect(r.q).toHaveLength(1);expect(r.q[0].tail).toBe(false);expect(r.q[0].result.ok).toBe(false);if(!r.q[0].result.ok)proof(r.q[0].result.error===r.Fsettle.error,'quiescence-settle-origin');expect([r.H,r.C,r.T,r.tailExit]).toEqual([undefined,undefined,undefined,undefined]);}
 else{expect(o.ok).toBe(true);if(r.Fput){expect(r.H).toBeDefined();proof(r.H!==undefined&&r.C!==undefined&&r.T!==undefined&&r.thenCalls===1,'original-tail-registration-present');await r.H;proof(r.callbackCalls===1&&r.tailExit!==undefined,'actual-callback-exit-before-tail-wait');expect(r.T).toBeDefined();proof((await r.T)===false,'actual-tail-value');proof(r.tailExit?.ok===true&&r.tailExit.value===false,'actual-callback-return');await r.tailDone;expect([r.thenCalls,r.callbackCalls]).toEqual([1,1]);expect(r.q).toEqual([{tail:false,result:{ok:true,value:false}},{tail:true,result:{ok:true,value:false}}]);}else{expect(r.q).toHaveLength(1);expect(r.q[0]).toEqual({tail:false,result:{ok:true,value:true}});}}
 if(r.Fput){proof(r.bodyDrain?.result?.ok===true&&r.bodyDrain.result.value===undefined,'body-original-drain-completed');proof(r.rootRun!==undefined&&r.rootRun.result!==undefined,'body-drain-original-runner-completed');proof(r.postDrain===undefined,'fifth-post-drain-absent');}
 else{proof(r.bodyDrain===undefined,'non-root-body-drain-absent');r.postDrainRequested=true;let raw:Promise<void>;try{raw=host.drain();}finally{r.postDrainRequested=false;}proof(r.postDrain?.raw===raw,'post-owner-original-drain');const post=await r.postDrain!.outcome;proof(post.ok&&post.value===undefined,'post-owner-drain-completed');}
 if(!r.rootRun)proof(r.action===undefined&&r.scope===undefined&&r.rootTicket===undefined,'root-action-scope-fixed-absent');
 expect(host.inFlightTaskIds()).toEqual([]);expect(r.coordinator!.snapshot()).toMatchObject({active:0,waiting:0});
 if(r.rootRun){proof(r.action?.result!==undefined,'action-original-outcome');proof(r.rootRun.result!==undefined,'root-original-outcome');proof(r.scope!==undefined&&r.rootTicket?.released===true,'root-original-physical-finally');const raw=closeDesktopModelPhysicalScope(r.scope!);r.physical=observeP(r,raw);proof(closeDesktopModelPhysicalScope(r.scope!)===raw,'original-memo-physical-close');expect(await r.physical.outcome).toEqual({ok:true,value:undefined});assertDesktopModelPhysicalIdle(r.scope!);}
 // No downstream seal begins before owner/tail original receipts above settle.
 r.source=observeP(r,host.closeSourceWriterForMigration());expect(await r.source.outcome).toEqual({ok:true,value:undefined});
 r.material=observeP(r,r.materials!.sealAndDrainInstanceMutations());expect(await r.material.outcome).toEqual({ok:true,value:undefined});
 zeroProducerPopulation(r);r.sealed=true;r.restoreThen?.();if(r.H)expect(r.thenRestored).toBe(true);
}
async function finish(r:CaseRecord,body:Outcome):Promise<void> {
 r.closing=true;const failures:unknown[]=[];if(!body.ok)failures.push(body.error);
 // Stop the original owner even if a prior setup/slot validator failed.
 if(r.service)try{r.service.dispose();if(r.disposal)await r.disposal.outcome;if(r.owned)await r.owned.outcome;}catch(error){failures.push(error);}
 let callbacks=false;
 try{if(r.service)await closeCallbacks(r);if(r.allocationUnknown)throw Error('known_producer_partial_allocation_unknown');callbacks=true;}catch(error){failures.push(error);}
 failures.push(...r.abortErrors,...r.extras);
 // A negative accepted origin may be exempted only after every original
 // business assertion and all callback gates pass with no extra failure.
 const disposal=r.disposal?.result;
 if(disposal&&!disposal.ok&&(failures.length||!r.bodyPassed))failures.push(disposal.error);
 if(r.owned?.result&&!r.owned.result.ok&&failures.length)failures.push(r.owned.result.error);
 if(callbacks&&r.extras.length===0&&r.abortErrors.length===0){
  const restoreErrors:unknown[]=[];for(const restore of r.restores.slice().reverse())try{restore();}catch(error){restoreErrors.push(error);}failures.push(...restoreErrors);
  if(!restoreErrors.length){r.callbackClosed=true;try{if(r.lease)r.lease.release();else if(r.leaseAttempted)throw Error('known_producer_partial_account_lease_unknown');r.accountReleased=true;}catch(error){failures.push(error);r.callbackClosed=false;}}
 }
 const rejected=!!disposal&&!disposal.ok;
 if(!failures.length&&r.callbackClosed&&r.accountReleased&&!rejected&&r.store){
  try{
   if(r.service){expect(r.coordinator!.snapshot()).toMatchObject({active:0,waiting:0});expect(r.service.runtimeStatus().blocked).toBe(false);}
   expect(nativeOpen(r)).toBe(true);r.store.close();expect(nativeOpen(r)).toBe(false);sameRoot(r);rmSync(r.root!,{recursive:true,force:false});r.rootDeleted=true;
  }catch(error){failures.push(error);}
 }
 if(!r.rootDeleted){
  // Registry admission precedes diagnostics and is never cleared on failure.
  try{expect(retained.includes(r)).toBe(true);if(r.root)sameRoot(r);console.log('KNOWN_PRODUCER_RETAINED '+JSON.stringify({...r.identity,callbackClosed:r.callbackClosed,accountReleased:r.accountReleased,nativeClosed:r.db?!nativeOpen(r):null,rootDeleted:false,retainedForParent:true,publicDisposalRejected:rejected,bodyPassed:r.bodyPassed}));}catch(error){failures.push(error);}
 }
 if(BODY_STOP_U_PROBE&&r.rootRun){
  try{
   expect(r.bodyPassed).toBe(true);expect(r.probeHits).toBe(1);expect(r.Fput).toBeDefined();expect(r.Fsettle).toBeUndefined();
   expect(r.L).toHaveLength(2);expect(r.L[0]).toBe(r.Fput!.error);expect(r.L[1]).toBe(r.probeU);
   expect(disposal?.ok).toBe(false);if(!disposal||disposal.ok)throw Error('known_producer_body_U_rejection_missing');
   expect(isProxy(disposal.error)).toBe(false);expect(isNativeError(disposal.error)).toBe(true);
   const errors=data(disposal.error,'errors');expect(Array.isArray(errors)).toBe(true);expect(data(errors,'length')).toBe(2);expect(data(errors,'0')).toBe(r.Fput!.error);expect(data(errors,'1')).toBe(r.probeU);expect(data(disposal.error,'cause')).toBe(r.Fput!.error);
   proof(r.expectedGateFailure!==undefined&&failures.some(error=>error===r.expectedGateFailure!.error),'body-U-actual-expected-F-gate-rejection');expect(nativeOpen(r)).toBe(true);expect(r.rootDeleted).toBe(false);
   console.log('KNOWN_PRODUCER_BODY_U_PROOF '+JSON.stringify({root:r.root,nonce:r.identity?.nonce,bodyAssertionsPassed:r.bodyPassed,originFCount:1,ledgerOrder:['Fput','body-U'],publicOrder:['Fput','body-U'],cause:'Fput',probeHits:r.probeHits,rootDeleted:false,nativeOpen:true,expectedFGateRejected:true}));
  }catch(error){failures.push(error);}
 }
 r.poisoned=failures.length>0;throwAll(failures);
}
function runCase(ctx:TestContext,work:()=>Promise<unknown>):Promise<void> {
 let resolveTail!:()=>void;const tailDone=new Promise<void>(resolve=>{resolveTail=resolve;});
 const r:CaseRecord={rootDeleted:false,callbackClosed:false,accountReleased:false,closing:false,sealed:false,extras:[],restores:[],rawReferences:[],L:[],q:[],ownedEntered:false,sessionCalls:0,authCalls:0,bindCalls:0,reconcileCalls:0,freezeDepth:0,thenCalls:0,callbackCalls:0,inTail:false,tailDone,resolveTail,thenRestored:false,postDrainRequested:false,abortErrors:[],probeHits:0,bodyPassed:false,poisoned:false,stopMarkCompleted:false,leaseAttempted:false,allocationUnknown:false};
 for(const key of ['init','action','rootRun','owned','disposal','source','material','postDrain','bodyDrain','physical','scope','H','C','T','tailExit','restoreThen','expectedGateFailure'])define(r,key,{value:undefined,writable:true,enumerable:true,configurable:false});
 retained.push(r);let hookFailure:{error:unknown}|undefined;
 const scenario=(async()=>{
  await Promise.resolve();if(hookFailure)throw hookFailure.error;
  const abort=()=>{r.closing=true;r.abortErrors.push(ctx.signal.reason);for(const action of [()=>r.host?.stopAccepting('fixture_test_aborted'),()=>r.host?.abortAllActive('fixture_test_aborted'),()=>{if(r.service)r.service.dispose();}])try{action();}catch(error){r.abortErrors.push(error);}};
  let body:Outcome;
  try{
   ctx.signal.addEventListener('abort',abort,{once:true});ctx.signal.throwIfAborted();
   for(const previous of retained)if(previous!==r&&(!previous.callbackClosed||previous.poisoned))throw Error('known_producer_previous_callbacks_unknown');assertProfileAccountWorkerReleased(ownership);
   const account=realpathSync(nativeOs.userInfo().homedir),caseNonce=randomBytes(16).toString('hex');r.leaseAttempted=true;r.lease=acquireProfileAccountLease(ownership,account,caseNonce);
   active=r;const allocatedRoot=mkdtempSync(join(tmpdir(),'known-multiagent-producer-'));r.root=allocatedRoot;root=realpathSync(allocatedRoot);r.root=root;const stat=lstatSync(root);r.identity={root,nonce:caseNonce,accountRunNonce:data(ownership,'runNonce') as string,pid:process.pid,ppid:process.ppid,uid:stat.uid,dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs};
   // Preserve the original writer namespace; the outer lease is separate.
   fixture.home=join(root,'account');mkdirSync(fixture.home,{mode:0o750});mkdirSync(join(fixture.home,'.xiaok'),{mode:0o755});mkdirSync(join(fixture.home,'.xiaok','profile-sources'),{mode:0o700});
   if(BODY_STOP_U_PROBE)r.probeU=Error('controlled actual body-stop U');
   r.work=observeP(r,work());body=await r.work.outcome;r.bodyPassed=body.ok;
  }catch(error){body={ok:false,error};}
  let finishing:Outcome;
  try{await finish(r,body);finishing={ok:true,value:undefined};}catch(error){finishing={ok:false,error};}
  try{ctx.signal.removeEventListener('abort',abort);}catch(error){if(!finishing.ok)throwAll([finishing.error,error]);throw error;}
  if(!finishing.ok)throw finishing.error;
 })();r.scenario=scenario;
 try{ctx.onTestFinished(()=>scenario);}catch(error){hookFailure={error};}
 return scenario;
}
let root:string;
function storeFixture(){const r=current();r.allocationUnknown=true;const directory=join(root,'groups'),store=new DesktopMultiAgentStore(join(directory,'groups.db'));observeStore(r,store);store.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});r.allocationUnknown=false;return {store,directory};}
function publish(directory:string){
 const r=current();createKnownDirectoryWriterFence(directory,'sqlite-db').persist();
 const folder=join(fixture.home,'.xiaok','profile-sources','writer-fences'),names=readdirSync(folder).filter(name=>name.endsWith('.json'));
 expect(names).toHaveLength(1);const path=join(folder,names[0]),bytes=readFileSync(path),record=nativeParse(bytes.toString('utf8')),d=lstatSync(directory),f=lstatSync(path);
 expect(record).toMatchObject({version:1,state:'known-writer-fenced',uid:process.getuid!(),directory:{canonicalPath:directory,device:String(d.dev),inode:String(d.ino)}});
 r.publication={directory,uid:d.uid,dev:d.dev,ino:d.ino,path,bytes,file:{dev:f.dev,ino:f.ino,uid:f.uid,birthtimeMs:f.birthtimeMs}};
}
function afterActualBegin(store:DesktopMultiAgentStore,directory:string){const r=current(),db=(store as unknown as {db:DatabaseSync}).db,original=db.exec.bind(db);let count=0;const trace=vi.spyOn(db,'exec').mockImplementation(sql=>{original(sql);if(sql==='BEGIN IMMEDIATE'&&!count++){publish(directory);}});const receipt={trace,count:()=>count};r.begin=receipt;return receipt;}
async function serviceFixture(body?:(context:DesktopAgentExecutionContext)=>Promise<void>){
 const r=current(),f=storeFixture();r.allocationUnknown=true;const coordinator=new DesktopExecutionCoordinator(),service=new DesktopMultiAgentService({store:f.store,coordinator,executionDomain:{actorId:'user',profileId:'profile',workspaceId:'workspace',cwd:root},createSession:async()=>{r.sessionCalls++;throw Error('no actual execution admitted');}});
 r.service=service;r.coordinator=coordinator;
 const materials=new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024*1024});r.materials=materials;
 const host=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),materialRegistry:materials,runner:body?input=>{
  const action=(context:DesktopAgentExecutionContext)=>{safeObserve(r,()=>{r.contextGroupId=context.groupId;r.scope=service.captureRootModelPhysicalScope(context);r.rootTicket=context.memberTicket;});const raw=body(context);safeObserve(r,()=>{proof(r.action===undefined,'action-population');r.action=observeP(r,raw);});return raw;};
  const raw=service.runRoot(input,action);safeObserve(r,()=>{proof(r.rootRun===undefined,'root-population');r.contextTaskId=input.taskId;r.rootRun=observeP(r,raw);});return raw;
 }:async()=>{throw Error('no task admitted');},authorizePreparation:(taskId,marker)=>service.assertHostPreparation(taskId,marker),assertTaskAdmission:snapshot=>service.assertHostAdmission(snapshot),decideCancellation:(snapshot,reason)=>service.decideHostCancellation(snapshot,reason)});
 observeService(r,service,host);zeroProducerPopulation(r);const initialization=service.initialize(host);safeObserve(r,()=>{r.init=observeP(r,initialization);});await initialization;zeroProducerPopulation(r);r.allocationUnknown=false;return {...f,service,host,coordinator};
}

it('retains a real admitted Service authorization CAS plus workspace revocation tail after actual native BEGIN publishes the target',ctx=>runCase(ctx,async()=>{
 const f=await serviceFixture(),group=f.store.createGroup('thread'),access=f.service.createWorkspaceUserAccess({requestSource:'user',actorId:'user',profileId:'profile',workspaceId:'workspace'}),before=f.service.getExecutionAuthorization(),begin=afterActualBegin(f.store,f.directory);try{const receipt=await f.service.setExecutionAuthorization({requestSource:'user',access,operationId:`exec-auth:${before.bootId}:0:accepted`,expectedPermissionRevision:0,executionAllowed:false,confirm:true});expect(receipt).toMatchObject({state:'applied',executionAllowed:false,persistenceState:'confirmed'});expect(f.store.requireGroup(group.groupId).mutationBlockedReason).toBe('permission_revoked');expect(begin.count()).toBe(1);expect(()=>f.service.setExecutionAuthorization({requestSource:'agent',access,operationId:`exec-auth:${before.bootId}:1:denied`,expectedPermissionRevision:1,executionAllowed:true,confirm:true})).toThrow(/authority|source/);}finally{begin.trace.mockRestore();}await guardFirstDisposal(f);await expect(f.service.dispose()).rejects.toThrow('fenced');expect(f.host.inFlightTaskIds()).toEqual([]);expect((f.service as unknown as {bootQuiesced:boolean}).bootQuiesced).toBe(false);
}));
it('retains a real Mailbox onSeal accepted port tail while refusing a later unaccepted mailbox mutation',ctx=>runCase(ctx,async()=>{
 const f=storeFixture(),group=f.store.createGroup('thread'),agentId='root_'+group.groupId;let sealed=0;const mailbox=new DesktopMultiAgentTurnMailbox({store:f.store,groupId:group.groupId,agentId,turnId:'turn',commands:new MultiAgentCommandSequencer(),assertCurrent:()=>{},onSeal:(outcome,port)=>{expect(Object.isFrozen(port)).toBe(true);port.putAgent(group.groupId,{...f.store.getAgent(group.groupId,agentId)!,status:outcome},true);port.appendEvent(group.groupId,{kind:'status',agentId,payload:{outcome}});sealed++;}}),begin=afterActualBegin(f.store,f.directory);try{await expect(mailbox.trySealTurn()).resolves.toEqual({kind:'sealed'});expect(sealed).toBe(1);expect(f.store.getAgent(group.groupId,agentId)?.status).toBe('completed');await expect(mailbox.returnClaim('missing')).rejects.toThrow('fenced');}finally{begin.trace.mockRestore();}
}));
it('retains Worktree beforeOpaqueInvocation accepted resource tails without invoking an allocator or cleaning foreign paths',ctx=>runCase(ctx,async()=>{
 const f=storeFixture(),group=f.store.createGroup('thread'),agentId='root_'+group.groupId;f.store.putResource({resourceId:'resource',allocationToken:'fixture-owned-allocation',groupId:group.groupId,agentId,ownerBootId:f.store.bootId,kind:'worktree',canonicalPath:join(root,'owned-resource'),cleanupPolicy:'keep',cleanupEligibility:'auto',state:'allocated'});const worktrees=new DesktopMultiAgentWorktrees({store:f.store}),begin=afterActualBegin(f.store,f.directory);try{worktrees.beforeOpaqueInvocation(group.groupId,agentId);expect(f.store.resources(group.groupId)[0]?.cleanupEligibility).toBe('manual');expect(()=>worktrees.beforeOpaqueInvocation(group.groupId,agentId)).toThrow('fenced');expect(worktrees.isIdle()).toBe(true);}finally{begin.trace.mockRestore();}
}));
it('retains genuine unfenced Service shutdown quiescence using its real host and actual durable boot owner',ctx=>runCase(ctx,async()=>{
 const f=await serviceFixture();await f.service.dispose();expect(f.host.inFlightTaskIds()).toEqual([]);expect((f.service as unknown as {bootQuiesced:boolean}).bootQuiesced).toBe(true);const db=(f.store as unknown as {db:DatabaseSync}).db;expect(db.prepare('SELECT state FROM boot_owners WHERE boot_id=?').get(f.store.bootId)?.state).toBe('quiesced');
}));

it('retains the genuine root running Activity member helper port after native BEGIN publishes the target',ctx=>runCase(ctx,async()=>{
 let entered:DesktopAgentExecutionContext|undefined;const stop=Error('controlled actual root body finished'),f=await serviceFixture(async context=>{entered=context;throw stop;}),prepared=await f.service.prepareRoot(f.host,'thread',{prompt:'Bounded real root.',materials:[]}),begin=afterActualBegin(f.store,f.directory);try{await f.host.startTask(prepared.taskId);await f.host.drain();expect(entered).toBeDefined();const context=entered!;expect(context.activityRunId).toBe('root:'+prepared.taskId);expect(f.store.getActivityMembers(context.activityRunId!)).toEqual([expect.objectContaining({memberId:context.activityMemberId,state:'running',physicalSettled:false})]);expect(f.store.getRootBinding(prepared.taskId)?.phase).toBe('active');expect(begin.count()).toBe(1);expect(f.host.inFlightTaskIds()).toEqual([]);}finally{begin.trace.mockRestore();}await observeDisposalForAssertions(f);expect((f.service as unknown as {bootQuiesced:boolean}).bootQuiesced).toBe(false);expect(f.service.runtimeStatus().blocked).toBe(true);const db=(f.store as unknown as {db:DatabaseSync}).db;expect(db.prepare('SELECT state FROM boot_owners WHERE boot_id=?').get(f.store.bootId)?.state).toBe('active');
}));
