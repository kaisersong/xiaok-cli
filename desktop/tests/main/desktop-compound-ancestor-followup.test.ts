import nativeProcess from 'node:process';
import {AsyncLocalStorage} from 'node:async_hooks';
import {types as qualifiedUtilTypes} from 'node:util';
import {randomBytes} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {userInfo} from 'node:os';
import {type TestContext,inject} from 'vitest';
import {acquireProfileAccountLease,assertProfileAccountWorkerReleased} from '../../../tests/support/profile-account-ownership.mjs';
import {writeFileSync} from 'node:fs';
// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext, type DesktopHostDeliveryAuthority, type DesktopMultiAgentServiceOptions } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentApprovalTransport } from '../../electron/desktop-multi-agent-approval-transport.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type {TaskRunnerInput} from '../../../src/runtime/task-host/task-runtime-host.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';
import { compileProtectionWorkerEntry } from '../fixtures/desktop-protection-worker-entry.js';
import * as publicationProducer from '../../../src/runtime/sol-pi/compound-publication-producer.js';

// Source-mode Vitest does not emit the fixed .js Worker entry. Map only that
// URL to the test-owned compiled production entry; execution and exit are native.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', protectionOutput: '', protectionRoot: '', starts: 0, exits: 0, receipts:[] as any[],unknown:false,compiled:[] as any[],builds:[] as any[] }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const sourceUrl = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url);
  const source = join(realpathSync(dirname(fileURLToPath(sourceUrl))),basename(fileURLToPath(sourceUrl)));
  const protectionUrl = new URL('../../../src/runtime/task-host/protection-read-worker.ts', import.meta.url);
  const protectionSource = join(realpathSync(dirname(fileURLToPath(protectionUrl))), basename(fileURLToPath(protectionUrl)));
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      let mapped=false;
      try{const path=typeof filename==='string'?filename:fileURLToPath(filename);mapped=join(realpathSync(dirname(path)),basename(path))===source;}catch{/* Non-owned entry remains native and must not be redirected. */}
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      let protectionMapped = false;
      try { const path = typeof filename === 'string' ? filename : fileURLToPath(filename); protectionMapped = join(realpathSync(dirname(path)), basename(path)) === protectionSource; } catch { /* unowned native entry */ }
      if (protectionMapped && !nativeWorker.protectionOutput) throw Error('fresh fixed protection Worker required');
      super(mapped ? nativeWorker.output : protectionMapped ? nativeWorker.protectionOutput : filename, options);
      qobserveWorker(this,mapped||protectionMapped);
      if (mapped || protectionMapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async()=>{
 const acquired=(root:string)=>{const canonical=realpathSync(root),stat=lstatSync(canonical);const identity={root:canonical,uid:stat.uid,dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs};nativeWorker.compiled.push(identity);if(canonical!==root||!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==userInfo().uid)throw Error('qualified_compiled_root_identity');};
 const open=async<T,>(invoke:()=>Promise<T>):Promise<T>=>{const record={raw:undefined as Promise<T>|undefined,outcome:undefined as QualifiedOutcome|undefined};nativeWorker.builds.push(record);try{const raw=invoke();record.raw=raw;const value=await raw;record.outcome={ok:true,value};return value;}catch(error){record.outcome={ok:false,error};throw error;}};
 Object.assign(nativeWorker,await open(()=>compileVerifierEntry('delivery-verifier-worker.ts',{onAcquired:acquired})));const protection=await open(()=>compileProtectionWorkerEntry({onAcquired:acquired}));nativeWorker.protectionOutput=protection.output;nativeWorker.protectionRoot=protection.root;
});
afterAll(()=>{
 const errors:unknown[]=[];
 try{expect(nativeWorker.exits).toBe(nativeWorker.starts);}catch(error){errors.push(error);}
 const safe=qualifiedRecords.length>0&&nativeWorker.compiled.length===2&&nativeWorker.builds.length===2&&nativeWorker.builds.every(build=>build.raw&&build.outcome?.ok===true)&&!nativeWorker.unknown&&nativeWorker.receipts.every(item=>item.exited)&&qualifiedRecords.every(r=>r.callbackClosed&&r.leavesClosed&&r.accountReleased);
 if(safe){for(const identity of nativeWorker.compiled)try{const stat=lstatSync(identity.root);if(realpathSync(identity.root)!==identity.root||stat.isSymbolicLink()||['uid','dev','ino','birthtimeMs'].some(k=>(stat as any)[k]!==identity[k]))throw Error('qualified_compiled_root_changed');rmSync(identity.root,{recursive:true,force:true,maxRetries:3});}catch(error){errors.push(error);}}
 else {for(const record of qualifiedRecords)if(record.late)errors.push(...record.errors);errors.push(Error('qualified_compiled_root_retained_until_worker_exit'));}
 if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'qualified_compiler_cleanup_failed',{cause:errors[0]});
});

// File-private test lifecycle; this candidate is not applied or execution-approved.
type QualifiedOutcome={ok:true;value:unknown}|{ok:false;error:unknown};
type QualifiedSlot={label:string;kind:'stop'|'owner'|'source'|'material'|'rescue'|'leaf'|'native';receiver:any;method:Function;args:unknown[];called:boolean;rawWritten:boolean;raw?:unknown;outcome?:QualifiedOutcome;reaction?:Promise<void>;workers:any[]};
type QualifiedRecord={ctx:TestContext;nonce:string;refs:unknown[];registrations:unknown[];sequence:number;seal?:number;closing:boolean;late:boolean;errors:unknown[];assertions:unknown[];expectedFailures:Set<unknown>;slots:QualifiedSlot[];closingSlots?:readonly QualifiedSlot[];pending:Set<object>;roots:any[];natives:any[];services:any[];coordinators:any[];sessions:any[];operations:any[];hostMaterials:any[];workers:any[];opaque:boolean;callbackClosed:boolean;leavesClosed:boolean;accountReleased:boolean;account:any;lease?:{release():void};workP?:Promise<void>;workOutcome?:QualifiedOutcome;scenarioP?:Promise<void>;hookFailure?:{error:unknown};abort?:()=>void;abortInstalled:boolean;closeStarted:boolean};
type QualifiedOrigin={record:QualifiedRecord;slot?:QualifiedSlot};
const qualifiedAnchor=Symbol('qualified-complex-fixture-strong-registry');
const qualifiedRecords:QualifiedRecord[]=[];
Object.defineProperty(nativeProcess,qualifiedAnchor,{value:qualifiedRecords,enumerable:false,configurable:false,writable:false});
if(Object.getOwnPropertyDescriptor(nativeProcess,qualifiedAnchor)?.value!==qualifiedRecords)throw Error('qualified_fixture_registry_unanchored');
const qualifiedALS=new AsyncLocalStorage<QualifiedOrigin>();
const qHasOwn=Object.hasOwn,qOwnDescriptor=Object.getOwnPropertyDescriptor,qNativeApply=Reflect.apply,qIsProxy=qualifiedUtilTypes.isProxy,qIsNativeError=qualifiedUtilTypes.isNativeError;
const qDOMNameGetter=qOwnDescriptor(DOMException.prototype,'name')?.get;
function qknownAbort(error:unknown):boolean{
 try{
  if((typeof error!=='object'&&typeof error!=='function')||error===null||qIsProxy(error))return false;
  if(qIsNativeError(error)){const descriptor=qOwnDescriptor(error,'name');return Boolean(descriptor&&qHasOwn(descriptor,'value')&&descriptor.value==='AbortError');}
  return Boolean(qDOMNameGetter&&qNativeApply(qDOMNameGetter,error,[])==='AbortError');
 }catch{return false;}
}

const qhold=<T,>(r:QualifiedRecord,value:T):T=>{r.refs.push(value);return value;};
function qerror(r:QualifiedRecord,error:unknown){qhold(r,error);r.errors.push(error);}
function qregister<T>(r:QualifiedRecord,label:string,value:T):T{
 qhold(r,value);r.registrations.push({label,value});r.sequence++;
 if(r.closing){r.late=true;r.callbackClosed=false;qerror(r,Error('qualified_fixture_late_registration'));}
 return value;
}
function qconstruct<T>(r:QualifiedRecord,label:string,construct:()=>T):T{
 const pending=qregister(r,label+':construction',{label,construct});r.pending.add(pending);
 const value=construct();qregister(r,label,value);r.pending.delete(pending);return value;
}
function qslot(r:QualifiedRecord,label:string,kind:QualifiedSlot['kind'],receiver:any,method:Function,args:unknown[]=[]):QualifiedSlot{
 const slot=qregister(r,label+':slot',{label,kind,receiver,method,args,called:false,rawWritten:false,workers:[]} as QualifiedSlot);r.slots.push(slot);return slot;
}
function qspy<T extends {mockRestore():unknown}>(r:QualifiedRecord,invoke:()=>T):T{
 const value=qconstruct(r,'spy',invoke);qslot(r,'original-spy-restore','leaf',value,value.mockRestore);return value;
}
function qstub<T>(r:QualifiedRecord,invoke:()=>T):T{
 qslot(r,'original-unstub-all','leaf',vi,vi.unstubAllGlobals);return qconstruct(r,'global-stub',invoke);
}
function qaction(r:QualifiedRecord,label:string,kind:QualifiedSlot['kind'],action:()=>unknown){qslot(r,label,kind,undefined,action);}
function qcall(r:QualifiedRecord,slot:QualifiedSlot){
 if(slot.called)return;slot.called=true;
 try{
  // The ALS close context belongs only to this already-bound actual owner slot.
  // Internal Workers fill its existing observation collection, never add owners.
  const raw=qualifiedALS.run({record:r,slot},()=>Reflect.apply(slot.method,slot.receiver,slot.args));slot.raw=qhold(r,raw);slot.rawWritten=true;
  slot.reaction=qhold(r,Promise.resolve(raw).then(value=>{slot.outcome=qhold(r,{ok:true,value});},error=>{slot.outcome=qhold(r,{ok:false,error});qerror(r,error);}));
 }catch(error){slot.outcome=qhold(r,{ok:false,error});qerror(r,error);}
}
function qroot(r:QualifiedRecord,prefix:string):string{
 const root=qregister(r,'root-presence',{raw:undefined as string|undefined,identity:undefined as any,written:false});r.roots.push(root);
 root.raw=qregister(r,'root-raw',mkdtempSync(join(tmpdir(),prefix)));
 const canonical=qregister(r,'root-canonical',realpathSync(root.raw)),stat=qregister(r,'root-stat',lstatSync(canonical));
 if(canonical!==root.raw||!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==userInfo().uid)throw Error('qualified_fixture_root_identity');
 root.identity={root:canonical,nonce:r.nonce,runNonce:r.account.runNonce,pid:nativeProcess.pid,ppid:nativeProcess.ppid,uid:stat.uid,dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs};
 writeFileSync(join(canonical,'qualified-fixture-identity.json'),JSON.stringify(root.identity)+'\n',{flag:'wx',mode:0o600});root.written=true;return canonical;
}
function qnative<T extends {close():unknown}>(r:QualifiedRecord,value:T):T{
 qregister(r,'native-store',value);const descriptor=Object.getOwnPropertyDescriptor(value,'db');const db=descriptor&&qHasOwn(descriptor,'value')?descriptor.value:undefined;
 const descriptorOpen=db&&Object.getOwnPropertyDescriptor(db,'isOpen');const native=qregister(r,'native-receiver',{value,db,get:descriptorOpen?.get,closed:false,closeSlot:undefined as QualifiedSlot|undefined,probeValid:Boolean(db&&typeof descriptorOpen?.get==='function'&&descriptorOpen.configurable===false)});r.natives.push(native);native.closeSlot=qslot(r,'store.close','native',value,value.close);return value;
}
function qprobeNative(native:any):boolean{
 const storeDescriptor=qOwnDescriptor(native.value,'db');
 if(!storeDescriptor||!qHasOwn(storeDescriptor,'value')||storeDescriptor.value!==native.db)throw Error('qualified_fixture_native_receiver_changed');
 const open=qOwnDescriptor(native.db,'isOpen');
 if(!open||open.get!==native.get||open.set!==undefined||open.configurable!==false||typeof native.get!=='function')throw Error('qualified_fixture_native_getter_changed');
 const state=qNativeApply(native.get,native.db,[]);if(state!==true&&state!==false)throw Error('qualified_fixture_native_state_unknown');return state;
}
function qservice<T extends {dispose():unknown;runtimeStatus():{blocked:boolean}}>(r:QualifiedRecord,value:T,coordinator:DesktopExecutionCoordinator):T{
 qregister(r,'service',value);qregister(r,'coordinator',coordinator);r.services.push(value);r.coordinators.push(coordinator);qslot(r,'service.dispose','owner',value,value.dispose);return value;
}
function qhost<T extends InProcessTaskRuntimeHost>(r:QualifiedRecord,value:T):T{
 qregister(r,'host',value);qslot(r,'host.stopAccepting','stop',value,value.stopAccepting,['app_shutdown']);qslot(r,'host.abortAllActive','stop',value,value.abortAllActive,['app_shutdown']);qslot(r,'host.drain','owner',value,value.drain);qslot(r,'host.sourceClose','source',value,value.closeSourceWriterForMigration);
 const options=qOwnDescriptor(value,'options'),material=options&&qHasOwn(options,'value')?qOwnDescriptor(options.value,'materialRegistry'):undefined;
 const registry=material&&qHasOwn(material,'value')?material.value:undefined,close=r.slots.find(slot=>slot.kind==='material'&&slot.receiver===registry);
 const binding=qregister(r,'actual-host-material-binding',{host:value,registry,close});r.hostMaterials.push(binding);if(!close)throw Error('qualified_fixture_host_material_inventory_unknown');return value;
}
function qmaterial<T extends MaterialRegistry>(r:QualifiedRecord,value:T):T{qregister(r,'material',value);qslot(r,'material.seal','material',value,value.sealAndDrainInstanceMutations);return value;}
function qopaque<T>(r:QualifiedRecord,open:()=>T):T{r.opaque=true;return qconstruct(r,'opaque-native-owner',open);}
function qproduct<T extends {dispose():unknown}>(r:QualifiedRecord,label:string,open:()=>Promise<T>):Promise<T>{
 r.opaque=true;const pending=qregister(r,label+':pending',{});r.pending.add(pending);const raw=open();qregister(r,label+':raw',raw);
 const reaction=raw.then(value=>{qregister(r,label,value);qslot(r,label+'.dispose','owner',value,value.dispose);r.pending.delete(pending);},error=>{qhold(r,error);r.pending.delete(pending);});qhold(r,reaction);return raw;
}
function qraw<T>(r:QualifiedRecord,label:string,invoke:()=>Promise<T>):Promise<T>{
 const operation=qregister(r,label+':operation',{label,raw:undefined as Promise<T>|undefined,outcome:undefined as QualifiedOutcome|undefined,reaction:undefined as Promise<void>|undefined});r.operations.push(operation);
 const raw=invoke();operation.raw=qhold(r,raw);operation.reaction=qhold(r,raw.then(value=>{operation.outcome=qhold(r,{ok:true,value});},error=>{operation.outcome=qhold(r,{ok:false,error});}));return raw;
}
function qsession<T extends {run:Function}>(r:QualifiedRecord,session:T):T{
 qregister(r,'session',session);const observed=qregister(r,'session-observations',{session,calls:[] as any[],disposeSeen:false});r.sessions.push(observed);
 for(const name of ['run','dispose','suspend'] as const){const method=(session as any)[name];if(typeof method!=='function')continue;
  const spy=vi.spyOn(session as any,name).mockImplementation(function(this:unknown,...args:unknown[]){
   if(r.closing&&name==='run'){r.late=true;qerror(r,Error('qualified_fixture_late_session_run'));}
   const call={name,receiver:this,args,raw:undefined as unknown,outcome:undefined as QualifiedOutcome|undefined,reaction:undefined as Promise<void>|undefined};observed.calls.push(call);qhold(r,call);
   try{const raw=Reflect.apply(method,this,args);call.raw=qhold(r,raw);if(name==='dispose')observed.disposeSeen=true;
    call.reaction=qhold(r,Promise.resolve(raw).then(value=>{call.outcome=qhold(r,{ok:true,value});},error=>{call.outcome=qhold(r,{ok:false,error});if(name==='run'){if(!qknownAbort(error))r.assertions.push(error);}else qerror(r,error);}));return raw;
   }catch(error){call.outcome=qhold(r,{ok:false,error});if(name==='run'){if(!qknownAbort(error))r.assertions.push(error);}else qerror(r,error);throw error;}
  });qslot(r,'session.'+name+'.restore','leaf',spy,spy.mockRestore);
 }
 return session;
}
function qobserveWorker(worker:any,knownProductionEntry:boolean){
 const origin=qualifiedALS.getStore();const actual={worker,threadId:worker.threadId,origin,exited:false,code:undefined as number|undefined,raw:undefined as Promise<void>|undefined};
 const pending=new Promise<void>(resolve=>worker.once('exit',(code:number)=>{actual.exited=true;actual.code=code;resolve();}));actual.raw=pending;
 nativeWorker.receipts.push(actual);
 if(!origin||!knownProductionEntry){nativeWorker.unknown=true;if(origin){qhold(origin.record,actual);origin.record.late=true;origin.record.callbackClosed=false;qerror(origin.record,Error('qualified_fixture_worker_entry_or_origin_unknown'));}return;}
 const r=origin.record;qhold(r,actual);r.workers.push(actual);
 if(r.closing){
  const slot=origin.slot;
  if(!slot||!slot.receiver||!r.slots.includes(slot)||!slot.called||slot.outcome!==undefined||!['owner','source','material'].includes(slot.kind)){r.late=true;r.callbackClosed=false;qerror(r,Error('qualified_fixture_worker_origin_unknown'));}
  else slot.workers.push(actual);
 }else qregister(r,'actual-worker',actual);
}
async function qcloseGeneration(r:QualifiedRecord,store:DesktopMultiAgentStore,service:DesktopMultiAgentService,host:InProcessTaskRuntimeHost){
 const dispose=r.slots.find(s=>s.kind==='owner'&&s.receiver===service&&s.method===service.dispose);
 const drain=r.slots.find(s=>s.kind==='owner'&&s.receiver===host&&s.method===host.drain);
 const stops=r.slots.filter(s=>s.kind==='stop'&&s.receiver===host);
 const source=r.slots.find(s=>s.kind==='source'&&s.receiver===host),material=r.hostMaterials.find(item=>item.host===host)?.close;
 const native=r.natives.find(n=>n.value===store);
 if(!dispose||!drain||stops.length!==2||!source||!material||!native?.probeValid)throw Error('qualified_fixture_generation_inventory_unknown');
 const failures:unknown[]=[];
 const phases:QualifiedSlot[][]=[[...stops,dispose,drain],[source],[material]];
 for(const phase of phases){
  for(const slot of phase)qcall(r,slot);
  for(const slot of phase){await slot.reaction;if(slot.outcome?.ok!==true)failures.push(slot.outcome&&slot.outcome.ok===false?slot.outcome.error:Error('qualified_fixture_generation_close_unknown'));}
 }
 if(failures.length===1)throw failures[0];if(failures.length)throw new AggregateError(failures,'qualified_fixture_generation_close_failed',{cause:failures[0]});
 for(const coordinator of r.coordinators){const snapshot=coordinator.snapshot();if(snapshot.active!==0||snapshot.waiting!==0)throw Error('qualified_fixture_generation_not_idle');}
 if(service.runtimeStatus().blocked!==false||r.sessions.some(session=>!session.disposeSeen||session.calls.some((call:any)=>!call.outcome))||r.workers.some(worker=>!worker.exited))throw Error('qualified_fixture_generation_callbacks_unknown');
 qprobeNative(native);qcall(r,native.closeSlot);await native.closeSlot.reaction;
 if(native.closeSlot.outcome?.ok!==true||!native.closeSlot.rawWritten)throw native.closeSlot.outcome?.ok===false?native.closeSlot.outcome.error:Error('qualified_fixture_generation_native_close_unknown');
 if(qprobeNative(native)!==false)throw Error('qualified_fixture_generation_native_open');native.closed=true;
}
function qbeginClose(r:QualifiedRecord){
 if(r.closeStarted)return;r.closeStarted=true;r.closing=true;r.seal=r.sequence;r.closingSlots=Object.freeze(r.slots.slice());
 for(const kind of ['rescue','stop','owner'] as const)for(const slot of r.closingSlots)if(slot.kind===kind)qcall(r,slot);
}
async function qfinish(r:QualifiedRecord){
 qbeginClose(r);const population=r.closingSlots!;
 for(const slot of population)if(slot.kind==='stop'||slot.kind==='owner'||slot.kind==='rescue')await slot.reaction;
 for(const kind of ['source','material'] as const){for(const slot of population)if(slot.kind===kind)qcall(r,slot);for(const slot of population)if(slot.kind===kind)await slot.reaction;}
 // Never infer child callback closure from a rejected dispose/status/UI receipt.
 const ownerHealthy=population.filter(s=>['stop','owner','source','material','rescue'].includes(s.kind)).every(s=>s.called&&s.outcome?.ok===true);
 for(const operation of r.operations)await operation.reaction;
 const operationsSettled=r.operations.every(operation=>Boolean(operation.outcome));
 const sessionHealthy=r.sessions.every(s=>s.disposeSeen&&s.calls.every((c:any)=>Boolean(c.outcome)&&(c.name==='run'||c.outcome.ok===true)));
 r.callbackClosed=Boolean(r.workOutcome)&&ownerHealthy&&sessionHealthy&&operationsSettled&&!r.pending.size&&!r.late&&r.sequence===r.seal&&r.workers.every(w=>w.exited);
 if(r.callbackClosed){
  for(const slot of [...population].reverse())if(slot.kind==='leaf')qcall(r,slot);
  for(const slot of population)if(slot.kind==='leaf')await slot.reaction;
  r.leavesClosed=population.filter(s=>s.kind==='leaf').every(s=>s.outcome?.ok===true)&&!r.late&&r.sequence===r.seal;
  if(r.leavesClosed&&r.abortInstalled&&r.abort){try{r.ctx.signal.removeEventListener('abort',r.abort);r.abortInstalled=false;}catch(error){qerror(r,error);r.leavesClosed=false;}}
  if(r.leavesClosed){try{r.lease?.release();r.accountReleased=Boolean(r.lease);}catch(error){qerror(r,error);}}
 }
 let nativeAllowed=r.callbackClosed&&r.leavesClosed&&ownerHealthy&&!r.late;
 try{for(const c of r.coordinators){const snapshot=c.snapshot();if(snapshot.active!==0||snapshot.waiting!==0)nativeAllowed=false;}for(const s of r.services)if(s.runtimeStatus().blocked!==false)nativeAllowed=false;}catch(error){qerror(r,error);nativeAllowed=false;}
 for(const native of r.natives)try{if(!native.probeValid)throw Error('qualified_fixture_native_probe_unknown_before_close');qprobeNative(native);}catch(error){qerror(r,error);nativeAllowed=false;}
 if(nativeAllowed){for(const slot of population)if(slot.kind==='native')qcall(r,slot);for(const slot of population)if(slot.kind==='native')await slot.reaction;
  for(const n of r.natives)try{if(!n.closeSlot||!n.closeSlot.called||!n.closeSlot.rawWritten||n.closeSlot.outcome?.ok!==true||n.closeSlot.receiver!==n.value||typeof n.get!=='function'||qprobeNative(n)!==false)throw Error('qualified_fixture_native_close_unknown');n.closed=true;}catch(error){qerror(r,error);}}
 const assertions=r.assertions.filter(error=>!r.expectedFailures.has(error));r.errors.unshift(...assertions);
 if(!r.callbackClosed)qerror(r,Error('qualified_fixture_callback_close_unknown'));
 // No approved seam exposes product-internal betterSQLite receivers. Every root
 // stays strongly held for parent-only exact cleanup after actual worker exit.
 for(const root of r.roots)try{
  if(!root.written)throw Error('qualified_fixture_partial_root_identity');const stat=lstatSync(root.identity.root);
  if(realpathSync(root.identity.root)!==root.identity.root||stat.isSymbolicLink()||['uid','dev','ino','birthtimeMs'].some(key=>(stat as any)[key]!==root.identity[key]))throw Error('qualified_fixture_retained_identity_changed');
  console.info('QUALIFIED_FIXTURE_RETAINED '+JSON.stringify({...root.identity,callbackClosed:r.callbackClosed,leavesClosed:r.leavesClosed,accountReleased:r.accountReleased,opaqueNativeUnconfirmed:r.opaque,publicNativeClosed:r.natives.length?r.natives.every(n=>n.closed):null,rootDeleted:false,retainedForParent:true,late:r.late,sequence:r.sequence,seal:r.seal}));
 }catch(error){qerror(r,error);}
}
function runCase(ctx:TestContext,work:(r:QualifiedRecord)=>Promise<void>):Promise<void>{
 const r:QualifiedRecord={ctx,nonce:randomBytes(16).toString('hex'),refs:[],registrations:[],sequence:0,closing:false,late:false,errors:[],assertions:[],expectedFailures:new Set(),slots:[],pending:new Set(),roots:[],natives:[],services:[],coordinators:[],sessions:[],operations:[],hostMaterials:[],workers:[],opaque:false,callbackClosed:false,leavesClosed:false,accountReleased:false,account:undefined,abortInstalled:false,closeStarted:false};qualifiedRecords.push(r);qhold(r,ctx);qhold(r,work);
 const scenario=(async()=>{
  await Promise.resolve();let failure:{error:unknown}|undefined;
  try{
   if(r.hookFailure)throw r.hookFailure.error;
   r.abort=()=>{try{qhold(r,{reason:ctx.signal.reason});qbeginClose(r);}catch(error){qerror(r,error);}};qhold(r,r.abort);ctx.signal.addEventListener('abort',r.abort,{once:true});r.abortInstalled=true;ctx.signal.throwIfAborted();
   for(const previous of qualifiedRecords){if(previous===r)break;if(!previous.callbackClosed||!previous.leavesClosed||!previous.accountReleased)throw Error('qualified_fixture_previous_callback_unknown');}
   r.account=qhold(r,inject('profileTestAccountOwnership' as never));assertProfileAccountWorkerReleased(r.account);
   r.lease=qhold(r,acquireProfileAccountLease(r.account,realpathSync(userInfo().homedir),r.nonce));
   const raw=qualifiedALS.run({record:r},()=>work(r));r.workP=qhold(r,raw);
   try{const value=await raw;r.workOutcome=qhold(r,{ok:true,value});}catch(error){r.workOutcome=qhold(r,{ok:false,error});throw error;}
  }catch(error){failure=qhold(r,{error});}
  finally{try{await qfinish(r);}catch(error){qerror(r,error);}}
  const errors=[...(failure?[failure.error]:[]),...r.errors];if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'qualified_fixture_body_and_cleanup_failed',{cause:errors[0]});
 })();r.scenarioP=qhold(r,scenario);const finished=()=>scenario;qhold(r,finished);
 try{ctx.onTestFinished(finished);}catch(error){r.hookFailure=qhold(r,{error});}return scenario;
}

const qualifiedCompiledAnchor=Symbol('qualified-compiled-worker-strong-registry');
Object.defineProperty(nativeProcess,qualifiedCompiledAnchor,{value:nativeWorker,enumerable:false,configurable:false,writable:false});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('P2 actual managed ancestor followup', () => {
  async function setup(__q:QualifiedRecord,createSession: DesktopMultiAgentServiceOptions['createSession'], body: (context: DesktopAgentExecutionContext,input:TaskRunnerInput) => Promise<void>, policy: { expectedDisposeError?:Error|(()=>Error|undefined); isolatedConfigRoot?: boolean; multiAgentLeaseMs?: number; coreIdleTimeoutMs?: number; prepareObservationSession?: DesktopMultiAgentServiceOptions['prepareObservationSession']; prepareObservationMessage?: DesktopMultiAgentServiceOptions['prepareObservationMessage']; prepareObservationFollowup?:DesktopMultiAgentServiceOptions['prepareObservationFollowup'] } = {}) {
    const root = qroot(__q,'xiaok-multi-agent-service-');
    if(policy.isolatedConfigRoot){const previous=process.env.XIAOK_CONFIG_DIR;qaction(__q,'old-cleanup-line-66','leaf',()=>{if(previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previous;});process.env.XIAOK_CONFIG_DIR=root;}
    void 0 /* typed actual-resource close slot registered at acquisition */;
    const store = qnative(__q,qconstruct(__q,'multi-agent-store',()=>new DesktopMultiAgentStore(join(root, 'groups.sqlite'))));
    void 0 /* typed actual-resource close slot registered at acquisition */;
    const coordinator = qconstruct(__q,'coordinator',()=>new DesktopExecutionCoordinator({ multiAgentLeaseMs: policy.multiAgentLeaseMs }));
    const service = qservice(__q,qconstruct(__q,'multi-agent-service',()=>new DesktopMultiAgentService({ store, coordinator, createSession: async input => {
      const session = await qraw(__q,'ordinary-session-factory',()=>createSession(input));
      return qsession(__q,session);
    }, prepareObservationSession: policy.prepareObservationSession, prepareObservationMessage: policy.prepareObservationMessage, prepareObservationFollowup:policy.prepareObservationFollowup, closeGraceMs: 10 })),coordinator);
    void 0 /* typed actual-resource close slot registered at acquisition */;
    service.registerThread({ threadId: 't1', profileId: 'p1', workspaceId: 'w1', cwd: root });
    let deliveryAuthority!: DesktopHostDeliveryAuthority;
    const host = qhost(__q,qconstruct(__q,'task-host',()=>new InProcessTaskRuntimeHost({
      snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      groupObservationSource: service,
      materialRegistry: qmaterial(__q,qconstruct(__q,'materials',()=>new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 * 1024 }))),
      runner: input => qraw(__q,'actual-root-run',()=>service.runRoot(input, async context => {
        try { return await body(context,input); }
        catch (error) { __q.assertions.push(error); throw error; }
      })),
      authorizePreparation: (taskId, marker) => service.assertHostPreparation(taskId, marker),
      assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
      getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
      onDeliveryReport: report => service.recordHostDelivery({ requestSource: 'scheduler', authority: deliveryAuthority, report }),
    })));
    await service.initialize(host);
    deliveryAuthority = service.bindHostDeliveryOwner(host);
    void 0 /* typed actual-resource close slot registered at acquisition */;
    const start = async () => {
      const prepared = await service.prepareRoot(host, 't1', { prompt: 'run root', materials: [] });
      if (policy.coreIdleTimeoutMs !== undefined) {
        // Explicit test-only policy before activation. The real core timer and
        // service event/settlement paths remain untouched; Desktop has no default.
        const groups = (service as unknown as { groups: Map<string, { core: object }> }).groups;
        Object.defineProperty(groups.get(store.getRootBinding(prepared.taskId)!.groupId)!.core, 'idleTimeoutMs', { value: policy.coreIdleTimeoutMs });
      }
      await host.startTask(prepared.taskId);
      return prepared.taskId;
    };
    return { root, store, service, coordinator, host, start };
  }

  it.for(['success','unpublished-ack','unknown-resource','own-effect','active-window','final-history-failure','final-history-failure-shutdown','root-tail'] as const)('uses exact drained descendant resources for a fresh user turn: %s',(scenario,ctx)=>runCase(ctx,async(__q)=>{
    const finalHistoryFailure=scenario==='final-history-failure'||scenario==='final-history-failure-shutdown';
    const negative=!['success','active-window','final-history-failure','final-history-failure-shutdown','root-tail'].includes(scenario);
    const finalPublication=qspy(__q,()=>vi.spyOn(publicationProducer,'publishCompoundFinalPublication'));void 0 /* original leaf restore registered before mutation */;
    const {writeFileSync,readFileSync}=await import('node:fs'),{homedir}=await import('node:os');
    const {DesktopMultiAgentRuntime}=await import('../../electron/desktop-multi-agent-runtime.js');
    const {DesktopOwnedToolRegistry,DesktopToolCatalogBridge}=await import('../../electron/desktop-multi-agent-catalog-bridge.js');
    const {createDesktopModelRunnerWithRegistry}=await import('../../electron/desktop-services.js');
    const {buildToolList}=await import('../../../src/ai/tools/index.js'),{parseObservationPolicyFile}=await import('../../../src/runtime/sol-pi/product-bootstrap.js');
    let expectedFailure:Error|undefined;let runtime!:InstanceType<typeof DesktopMultiAgentRuntime>,rootCalls=0,childCalls=0,descendantCalls=0;
    let retainedActivation:import('../../electron/desktop-observation-owner.js').DesktopObservationTaskActivation|undefined;
    const generationTwoInvocations=new Set<string>();
    const entered=deferred<void>(),release=deferred<void>(),outcome=deferred<string>(),rootPublished=deferred<void>();
    const response=(delta:unknown,tool=false)=>new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:tool?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
    const tool=(id:string,name:string,args:unknown)=>response({tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},true);
    const f=await setup(__q,input=>runtime.createSession(input),async(context,input)=>{
      const source=join(f.root,'source.txt');writeFileSync(source,'Selected source');const policyFile=join(f.root,'policy.json'),expiresAt=Date.now()+240000;
      writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'},ordinaryChildren:{enabled:true,maxDepth:2,maxChildren:3,expiresAt,nativeTools:['read']}}));
      const config=await import('../../../src/utils/config.js'),mock=qspy(__q,()=>vi.spyOn(config,'loadConfig')).mockResolvedValue({schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'current',providers:{deepseek:{type:'custom',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'fixture-only'}},models:{current:{provider:'deepseek',model:'deepseek-flash',label:'Current'}},defaultMode:'interactive'} as never);void 0 /* original leaf restore registered before mutation */;
      const read=buildToolList(undefined,{cwd:f.root}).find(t=>t.definition.name==='read')!,base=qconstruct(__q,'registry-or-catalog',()=>new DesktopOwnedToolRegistry({autoMode:true},[read]));qaction(__q,'old-cleanup-line-131','leaf',()=>base.dispose());
      const bridge=qconstruct(__q,'registry-or-catalog',()=>new DesktopToolCatalogBridge({registry:base,workspaceId:'w1',getService:()=>f.service}));qaction(__q,'old-cleanup-line-132','leaf',()=>bridge.dispose());
      const activation:import('../../electron/desktop-observation-owner.js').DesktopObservationTaskActivation=retainedActivation??{policy:parseObservationPolicyFile(policyFile),profileRoot:join(f.root,'profile'),environmentRoot:join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'),onPrompt:async()=>true,consumed:false};
      retainedActivation=activation;
      const runner=createDesktopModelRunnerWithRegistry(base,[read],f.root,{} as never,qmaterial(__q,qconstruct(__q,'materials',()=>new MaterialRegistry({workspaceRoot:join(f.root,'runner-materials'),maxBytes:1048576}))),{}, {observationTasks:new Map([[input.taskId,activation]]),observationGroupHost:{getHost:()=>f.host,observationStore:new FileTaskSnapshotStore(join(f.root,'tasks')).observations},multiAgent:{runtime,service:f.service,catalog:bridge,workspaceId:'w1',cwd:f.root}});
      try{await runner({...input,permissionMode:'auto'},context);}
      catch(error){if(scenario==='final-history-failure-shutdown'&&context.signal.aborted&&error instanceof Error&&error.name==='AbortError')__q.expectedFailures.add(error);throw error;}
    },{expectedDisposeError:()=>expectedFailure,isolatedConfigRoot:true,prepareObservationSession:input=>runtime.prepareObservationSession(input),prepareObservationMessage:input=>runtime.prepareObservationMessage(input),prepareObservationFollowup:async preparation=>{
      const facts=f.service.inspectManagedFollowupPreparation(preparation),path=join(f.root,'compound-sessions',facts.childSession.exportSnapshot().sessionId+'.json'),original=readFileSync(path,'utf8');
      if(negative){
        const snapshot=JSON.parse(original),ledger=snapshot.compoundOperations,row=ledger.directOperations[0];
        const {advanceDirectOperation,createOrGetDirectOperation}=await import('../../../src/runtime/sol-pi/compound-direct-operation.js');
        if(scenario==='unpublished-ack')row.delegation.managed.ackPublished=false;
        else if(scenario==='unknown-resource')snapshot.compoundOperations=advanceDirectOperation(ledger,row.id,{stage:'outcome_unknown',outcome:'unknown'});
        else{const created=createOrGetDirectOperation(ledger,{dispatch:{...row.dispatch,originalToolUseId:'unfinished-own-effect'},toolName:'write',inputHash:row.inputHash,ownerId:row.ownerId,requestSource:'agent',scopeId:row.scopeId,permissionGeneration:row.permissionGeneration});snapshot.compoundOperations=advanceDirectOperation(created.ledger,created.operation.id,{stage:'started',finalInputHash:row.inputHash});}
        writeFileSync(path,JSON.stringify(snapshot));
      }
      try{return await runtime.prepareObservationFollowup(preparation);}catch(error){if(negative)expectedFailure=error as Error;outcome.resolve(String(error));throw error;}
      finally{if(negative)writeFileSync(path,original);}
    }});

    if(scenario==='success'){
      const {DesktopManagedAgentSession}=await import('../../electron/desktop-managed-agent-session.js');
      const originalRun=DesktopManagedAgentSession.prototype.run;
      const rejectionObserver=qspy(__q,()=>vi.spyOn(DesktopManagedAgentSession.prototype,'run')).mockImplementation(function(this:InstanceType<typeof DesktopManagedAgentSession>,...args){
        const raw=originalRun.apply(this,args);
        void raw.then(()=>{},error=>{outcome.resolve(String(error));});
        return raw;
      });void 0 /* original leaf restore registered before mutation */;
    }
    const followupTarget=f.service as unknown as {activateManagedFollowup(...args:unknown[]):Promise<void>},activate=followupTarget.activateManagedFollowup.bind(followupTarget);
    const activationSpy=qspy(__q,()=>vi.spyOn(followupTarget,'activateManagedFollowup')).mockImplementation(async(...args)=>{try{return await activate(...args);}catch(error){outcome.resolve(String(error));throw error;}});void 0 /* original leaf restore registered before mutation */;
    if(scenario==='active-window'){
      const followup=f.service.followup.bind(f.service),spy=qspy(__q,()=>vi.spyOn(f.service,'followup')).mockImplementation(async input=>{const result=await followup(input);expect(result.state).toBe('queued_next_admission');release.resolve();return result;});void 0 /* original leaf restore registered before mutation */;
    }
    if(finalHistoryFailure){
      const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js'),original=FileSessionStore.prototype.compareAndSave,error=Error('actual final assistant history save failed');__q.expectedFailures.add(error);
      const spy=qspy(__q,()=>vi.spyOn(FileSessionStore.prototype,'compareAndSave')).mockImplementation(async function(this:InstanceType<typeof FileSessionStore>,input){
        if(input.nextSnapshot.messages.at(-1)?.content.some(block=>block.type==='text'&&block.text==='First child turn completed.')){
          throw error;
        }
        return original.call(this,input);
      });void 0 /* original leaf restore registered before mutation */;
    }
    if(scenario==='final-history-failure-shutdown'){
      const eventOwner=f.service as unknown as {captureCoreEvent(group:unknown,event:{kind:string;agent:{error?:string;status:string}}):void},capture=eventOwner.captureCoreEvent.bind(eventOwner);let stopped=false;
      const eventSpy=qspy(__q,()=>vi.spyOn(eventOwner,'captureCoreEvent')).mockImplementation((group,event)=>{
        if(!stopped&&event.kind==='status'&&event.agent.error==='actual final assistant history save failed'){
          stopped=true;release.resolve();const actualDispose=f.service.dispose();qhold(__q,actualDispose);qhold(__q,actualDispose.then(()=>{},failure=>{qhold(__q,failure);}));
        }
        capture(group,event);
      });void 0 /* original leaf restore registered before mutation */;
    }
    const tailEntered=deferred<void>(),tailRelease=deferred<void>();
    if(scenario==='root-tail'){
      const original=FileTaskSnapshotStore.prototype.saveWithReceipt;let held=false;
      const spy=qspy(__q,()=>vi.spyOn(FileTaskSnapshotStore.prototype,'saveWithReceipt')).mockImplementation(async function(this:FileTaskSnapshotStore,snapshot,previous){
        if(!held&&snapshot.status==='completed'){held=true;tailEntered.resolve();await tailRelease.promise;}
        return original.call(this,snapshot,previous);
      });void 0 /* original leaf restore registered before mutation */;qaction(__q,'old-cleanup-line-190','rescue',()=>tailRelease.resolve());
    }
    runtime=new DesktopMultiAgentRuntime({service:f.service});
    qstub(__q,()=>vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      try{
      const body=JSON.parse(String(init?.body)),system=String(body.messages[0].content),groupId=f.store.getThread('t1')!.activeGroupId!;
      if(system.includes('Assigned Desktop agent: /root/managed/descendant\n')){
        descendantCalls++;entered.resolve();
        if(descendantCalls===1){await release.promise;if(scenario==='active-window')return response({tool_calls:[
          {index:0,id:'descendant-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:join(f.root,'source.txt')})}},
          {index:1,id:'descendant-send',type:'function',function:{name:'send_message',arguments:JSON.stringify({target:'/root/managed',message:'The selected source is available for the next turn.'})}},
        ]},true);}
        if(scenario==='active-window'&&descendantCalls===2)expect(childCalls).toBe(3);
        return response({content:'Descendant completed.'});
      }
      if(system.includes('Assigned Desktop agent: /root/managed\n')){
        childCalls++;if(childCalls===1){await rootPublished.promise;return tool('spawn-descendant','spawn_agent',{task_name:'descendant',message:'Continue independently.'});}
        if(childCalls===2){expect(body.messages.find((r:{tool_call_id?:string})=>r.tool_call_id==='spawn-descendant')?.content).not.toMatch(/^Error:/);await entered.promise;return response({content:'First child turn completed.'});}
        const child=f.store.allAgents(groupId).find(a=>a.canonicalName==='/root/managed')!,{FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js'),{desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
        expect((await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id)))?.compoundOperations?.managedTurns?.records.at(-1)).toMatchObject({generation:2,state:'active',turnId:child.turnId});
        if(scenario==='active-window'){
          const durable=await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id));
          const attempt=durable!.compoundOperations!.providerAttempts!.at(-1)!;
          expect(attempt.attemptIndex).toBe(0);expect(generationTwoInvocations.has(attempt.logicalInvocationId)).toBe(false);generationTwoInvocations.add(attempt.logicalInvocationId);
          if(childCalls===3)expect(descendantCalls).toBe(1);else {expect(childCalls).toBe(4);expect(JSON.stringify(body.messages)).toContain('Descendant completed.');}
          expect((await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id)))?.protectedObservationClosure?.observations).toHaveLength(1);
        }else expect(f.store.allAgents(groupId).find(a=>a.canonicalName==='/root/managed/descendant')).toMatchObject({status:'completed',executionActive:false,resourcesReleased:false});
        outcome.resolve('generation 2');return response({content:'Second child turn completed.'});
      }
      rootCalls++;if(rootCalls===1)return tool('spawn-managed','spawn_agent',{task_name:'managed',message:'Create a long-lived descendant.'});
      rootPublished.resolve();await vi.waitFor(()=>expect(f.store.allAgents(groupId).find(a=>a.canonicalName==='/root/managed'),JSON.stringify(f.store.allAgents(groupId).map(a=>({name:a.canonicalName,status:a.status,error:a.error})))).toMatchObject({status:scenario==='final-history-failure-shutdown'?expect.stringMatching(/^(failed|interrupted|closed)$/):finalHistoryFailure?'failed':'completed',executionActive:false}),{timeout:20000});
      if(scenario==='active-window'&&rootCalls===2)return tool('ancestor-followup','followup_task',{target:'/root/managed',message:'Continue with the descendant publication.'});
      return response({content:'Root completed.'});
      }catch(error){__q.assertions.push(error);outcome.resolve(String(error));throw error;}
    })));void 0 /* original leaf restore registered before mutation */;
    try{
      await f.start();
      if(scenario==='root-tail'){
        await tailEntered.promise;const previousCalls=rootCalls;
        const owner=retainedActivation!.group!.product.owner,controller=new AbortController(),cancelled=publicationProducer.waitForCompoundFinalPublication(owner,controller.signal);
        controller.abort(Error('cancel only this new waiter'));await expect(cancelled).rejects.toThrow('cancel only this new waiter');
        expect(()=>publicationProducer.bindCompoundFinalPublicationConsumer(owner,'replacement',{register:async()=>{},inspectReceipt:()=>{throw Error('not called');}})).toThrow('compound_final_consumer_already_bound');
        await f.start();
        await new Promise(resolve=>setTimeout(resolve,40));expect(rootCalls).toBe(previousCalls);expect(__q.assertions).toEqual([]);
        tailRelease.resolve();await f.host.drain();expect(rootCalls).toBe(previousCalls+1);return;
      }
      if(scenario==='final-history-failure-shutdown'){
        await vi.waitFor(()=>expect(f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).find(a=>a.canonicalName==='/root/managed')).toMatchObject({executionActive:false,status:expect.stringMatching(/^(failed|interrupted|closed)$/)}),{timeout:20000});
        const group=f.store.getThread('t1')!.activeGroupId!,child=f.store.allAgents(group).find(a=>a.canonicalName==='/root/managed')!;
        const terminalEvents=f.store.readEvents(group,0,1000).filter(event=>event.kind==='status'&&event.agentId===child.id&&['failed','interrupted','closed'].includes(String((event.payload.agent as {status?:string})?.status)));
        expect(terminalEvents.length).toBeGreaterThan(0);
        for(const event of terminalEvents){const agent=event.payload.agent as {error?:string;lastResult?:string;resultSummary?:string};expect(agent.error).toBeUndefined();expect(agent.lastResult).toBeUndefined();expect(agent.resultSummary).toBeUndefined();}
        return;
      }
      await f.host.drain();expect(rootCalls).toBeGreaterThanOrEqual(2);
      if(scenario==='success')expect(finalPublication.mock.calls.length,JSON.stringify(f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).map(a=>({name:a.canonicalName,status:a.status,error:a.error})))).toBeGreaterThan(0);
      if(scenario==='active-window'){expect(await outcome.promise).toBe('generation 2');await vi.waitFor(()=>expect(descendantCalls).toBe(2),{timeout:10000});expect(childCalls).toBeGreaterThanOrEqual(3);expect(childCalls).toBeLessThanOrEqual(4);return;}
      expect(childCalls).toBe(2);expect(descendantCalls).toBe(1);
      if(finalHistoryFailure){
        const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js'),{desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
        const child=f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).find(a=>a.canonicalName==='/root/managed')!,snapshot=await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id));
        expect(child.status).toBe('failed');expect(JSON.stringify(snapshot?.messages)).not.toContain('First child turn completed.');
        expect(child).toMatchObject({bodyUnavailable:true});expect(child.lastResult).toBeUndefined();
        const originalStatusEvents=f.store.readEvents(f.store.getThread('t1')!.activeGroupId!,0,1000).filter(event=>event.kind==='status'&&event.agentId===child.id);
        expect(JSON.stringify(originalStatusEvents)).not.toContain('actual final assistant history save failed');
        expect(JSON.stringify(originalStatusEvents)).not.toContain('First child turn completed.');
        const failedGroup=f.store.getThread('t1')!.activeGroupId!,messages=f.store.listMessages(failedGroup,`root_${failedGroup}`),failure=messages.find(message=>message.sender.kind==='agent'&&message.sender.agentId===child.id&&message.bodyUnavailable);
        expect(failure).toMatchObject({preview:'FINAL_CONTENT_NOT_PERSISTED',bodyUnavailable:true});
        const page=f.store.readContent(failedGroup,child.resultContentId!,0);expect(page).toMatchObject({bodyUnavailable:true,status:'failed'});expect(Buffer.from(page.base64,'base64').toString()).toBe('FINAL_CONTENT_NOT_PERSISTED');
        expect(snapshot?.compoundOperations?.providerAttempts?.every(row=>row.transportState==='drained')).toBe(true);return;
      }
      {
        const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js'),{desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
        const child=f.store.allAgents(f.store.getThread('t1')!.activeGroupId!).find(a=>a.canonicalName==='/root/managed')!;
        expect(JSON.stringify((await new FileSessionStore(join(f.root,'compound-sessions')).load(desktopObservationSessionId(child.id)))?.messages)).toContain('First child turn completed.');
        expect(child.bodyUnavailable).not.toBe(true);expect(child.lastResult).toContain('First child turn completed.');
      }
      const groupId=f.store.getThread('t1')!.activeGroupId!,child=f.store.allAgents(groupId).find(a=>a.canonicalName==='/root/managed')!,access=f.service.createUserAccess({requestSource:'user',actorId:'actual-user',threadId:'t1',profileId:'p1',workspaceId:'w1'});
      expect(await f.service.userFollowup({access,requestSource:'user',groupId,agentId:child.id,operationId:'actual-user-ancestor-followup',expectedTurn:child.turn,message:'Continue while your descendant remains active.'})).toMatchObject({state:'queued_next_admission',expectedTurn:2});
      expect(childCalls).toBe(2);release.resolve();
      const actual=await outcome.promise;
      if(scenario==='success'){expect(actual).toBe('generation 2');expect(childCalls).toBe(3);}
      else{expect(actual).toMatch(scenario==='unpublished-ack'?/compound_tree_branch_unpublished/:/compound_followup_old_turn_not_drained/);expect(childCalls).toBe(2);}
      expect(descendantCalls).toBe(1);
    }finally{rootPublished.resolve();release.resolve();}
  }),120000);
});
