// @vitest-environment node
import {expect,it,inject,type TestContext} from 'vitest';
import {mkdtempSync,realpathSync,writeFileSync,rmSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,homedir,userInfo} from 'node:os';
import {buildToolList,ToolRegistry} from '../../../src/ai/tools/index.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {computeSessionHistoryDigest} from '../../../src/ai/runtime/session-store/store.js';
import {parseObservationPolicyFile} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {DesktopTaskObservationStore} from '../../../src/runtime/task-host/protected-observation-store.js';
import {createDesktopProductObservationBinding,requireDesktopProductHost} from '../../electron/desktop-observation-owner.js';
import {randomBytes} from 'node:crypto';
import {acquireProfileAccountLease,assertProfileAccountWorkerReleased} from '../../../tests/support/profile-account-ownership.mjs';

// File-local fixture lifecycle only; no product replacement or shared owner API.
type QualifiedSlot={label:string;kind:'owner'|'source'|'material'|'leaf'|'native';receiver:any;method:Function;args:unknown[];called:boolean;rawWritten:boolean;raw:unknown;observed?:Promise<{ok:true}|{ok:false;error:unknown}>;outcome?:{ok:true}|{ok:false;error:unknown}};
type QualifiedRecord={ctx:TestContext;caseNonce:string;refs:unknown[];registrations:unknown[];sequence:number;seal?:number;closing:boolean;late:boolean;errors:unknown[];slots:QualifiedSlot[];constructions:Set<string>;roots:any[];natives:any[];services:any[];coordinators:any[];bodyFailure?:{error:unknown};workP?:Promise<void>;scenarioP?:Promise<void>;finished?:()=>Promise<void>;workSettled:boolean;callbackClosed:boolean;leafRestored:boolean;leaseReleased:boolean;opaqueNativeUnconfirmed:boolean;retainedForParent:boolean;rootDeleted:boolean;lease?:{release():void};account:any;closeStarted:boolean;cleanupP?:Promise<void>;abort?:()=>void;abortInstalled:boolean;hookFailure?:{error:unknown}};
const qualifiedAnchor=Symbol('xiaok.qualified.history-basis.v3.records');
const existingQualified=Object.getOwnPropertyDescriptor(process,qualifiedAnchor);
if(existingQualified&&(!Object.hasOwn(existingQualified,'value')||!Array.isArray(existingQualified.value)))throw Error('qualified_fixture_registry_unknown');
const qualifiedRecords:QualifiedRecord[]=existingQualified?.value??[];
if(!existingQualified)Object.defineProperty(process,qualifiedAnchor,{value:qualifiedRecords,enumerable:false,configurable:false,writable:false});
const holdQualified=<T,>(r:QualifiedRecord,value:T):T=>{r.refs.push(value);return value;};
function registerQualified<T>(r:QualifiedRecord,label:string,value:T):T{
 holdQualified(r,value);r.registrations.push({label,value});r.sequence++;
 if(r.closing){r.late=true;r.callbackClosed=false;r.rootDeleted=false;r.retainedForParent=true;r.errors.push(Error('qualified_fixture_late_registration'));}
 return value;
}
function qualifiedAcquire<T>(r:QualifiedRecord,label:string,construct:()=>T):T{
 registerQualified(r,'construction:'+label,construct);if(r.constructions.has(label))throw Error('qualified_fixture_duplicate_construction');r.constructions.add(label);
 const value=construct();registerQualified(r,label,value);r.constructions.delete(label);return value;
}
function qualifiedBeginProduct<T>(r:QualifiedRecord,label:string,construct:()=>Promise<T>):Promise<T>{
 r.opaqueNativeUnconfirmed=true;registerQualified(r,'product-construction:'+label,construct);if(r.constructions.has(label))throw Error('qualified_fixture_duplicate_construction');r.constructions.add(label);
 const raw=construct();registerQualified(r,'original-product-promise:'+label,raw);return raw;
}
function qualifiedSlot(r:QualifiedRecord,label:string,kind:QualifiedSlot['kind'],receiver:any,method:Function,args:unknown[]=[]){
 const slot:QualifiedSlot={label,kind,receiver,method,args,called:false,rawWritten:false,raw:undefined};
 registerQualified(r,label+':receiver',receiver);registerQualified(r,label+':method',method);registerQualified(r,label+':arguments',args);registerQualified(r,label+':slot',slot);r.slots.push(slot);return slot;
}
function qualifiedProduct<T extends {dispose():unknown}>(r:QualifiedRecord,label:string,value:T):T{
 registerQualified(r,label,value);qualifiedSlot(r,label+':dispose','owner',value,value.dispose);r.constructions.delete(label);r.opaqueNativeUnconfirmed=true;return value;
}
function qualifiedLeaf(r:QualifiedRecord,label:string,restore:()=>unknown){qualifiedSlot(r,label,'leaf',undefined,restore);}
function qualifiedRoot(r:QualifiedRecord,prefix:string):string{
 const item=registerQualified(r,'root-presence',{allocated:undefined as string|undefined,identity:undefined as any,identityWritten:false});r.roots.push(item);
 r.constructions.add('root:'+prefix);item.allocated=registerQualified(r,'raw-root',mkdtempSync(join(tmpdir(),prefix)));
 const root=registerQualified(r,'canonical-root',realpathSync(item.allocated)),native=registerQualified(r,'root-stat',lstatSync(root));
 item.identity={root,caseNonce:r.caseNonce,accountRunNonce:r.account.runNonce,externalRunToken:typeof process.env.XIAOK_ACTIVITY_FORENSICS_RUN_TOKEN==='string'&&/^[a-f0-9]{32}$/.test(process.env.XIAOK_ACTIVITY_FORENSICS_RUN_TOKEN)?process.env.XIAOK_ACTIVITY_FORENSICS_RUN_TOKEN:null,pid:process.pid,ppid:process.ppid,uid:native.uid,dev:native.dev,ino:native.ino,birthtimeMs:native.birthtimeMs};
 if(root!==item.allocated||!native.isDirectory()||native.isSymbolicLink()||native.uid!==userInfo().uid)throw Error('qualified_fixture_root_identity');
 writeFileSync(join(root,'qualified-fixture-identity.json'),JSON.stringify(item.identity)+'\n',{flag:'wx',mode:0o600});item.identityWritten=true;r.constructions.delete('root:'+prefix);return root;
}
function qualifiedNativeStore<T extends {close():unknown}>(r:QualifiedRecord,value:T):T{
 registerQualified(r,'native-store',value);
 const descriptor=Object.getOwnPropertyDescriptor(value,'db'),db=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 const open=db&&Object.getOwnPropertyDescriptor(db,'isOpen');
 const native=registerQualified(r,'native-receiver',{store:value,db,getOpen:open&&Object.hasOwn(open,'get')?open.get:undefined,openDescriptor:open,closeSlot:undefined as QualifiedSlot|undefined,probeReady:false,closed:false});r.natives.push(native);
 native.closeSlot=qualifiedSlot(r,'native-store-close','native',value,value.close);return value;
}
function qualifiedService<T extends {dispose():unknown;runtimeStatus():{blocked:boolean}}>(r:QualifiedRecord,value:T,coordinator:{snapshot():{active:number;waiting:number}}):T{
 registerQualified(r,'service',value);registerQualified(r,'coordinator',coordinator);r.services.push(value);r.coordinators.push(coordinator);qualifiedSlot(r,'service-dispose','owner',value,value.dispose);return value;
}
function qualifiedHost<T extends {stopAccepting(reason?:string):void;abortAllActive(reason?:string):void;drain():Promise<void>;closeSourceWriterForMigration():Promise<void>}>(r:QualifiedRecord,value:T):T{
 registerQualified(r,'host',value);qualifiedSlot(r,'host-stop-accepting','owner',value,value.stopAccepting,['app_shutdown']);qualifiedSlot(r,'host-abort','owner',value,value.abortAllActive,['app_shutdown']);qualifiedSlot(r,'host-drain','owner',value,value.drain);qualifiedSlot(r,'source-close','source',value,value.closeSourceWriterForMigration);return value;
}
function qualifiedMaterial<T extends {sealAndDrainInstanceMutations():Promise<void>}>(r:QualifiedRecord,value:T):T{
 registerQualified(r,'material',value);qualifiedSlot(r,'material-close','material',value,value.sealAndDrainInstanceMutations);return value;
}
function startQualifiedSlot(r:QualifiedRecord,slot:QualifiedSlot){
 if(slot.called)return;slot.called=true;
 try{
  slot.raw=Reflect.apply(slot.method,slot.receiver,slot.args);slot.rawWritten=true;holdQualified(r,slot.raw);
  slot.observed=Promise.resolve(slot.raw).then(()=>{const out={ok:true as const};slot.outcome=out;holdQualified(r,out);return out;},error=>{holdQualified(r,error);r.errors.push(error);const out={ok:false as const,error};slot.outcome=out;holdQualified(r,out);return out;});holdQualified(r,slot.observed);
 }catch(error){holdQualified(r,error);r.errors.push(error);slot.outcome={ok:false,error};slot.observed=Promise.resolve(slot.outcome);holdQualified(r,slot.observed);}
}
function beginQualifiedClose(r:QualifiedRecord){
 if(r.closeStarted)return;r.closeStarted=true;r.closing=true;r.seal=r.sequence;
 // Slots were bound to actual receivers/methods/args before closing. Only fill
 // their original-result/outcome cells here; never add a new resource/slot.
 for(const slot of r.slots)if(slot.kind==='owner'||slot.kind==='source'||slot.kind==='material')startQualifiedSlot(r,slot);
}
function qualifiedCleanup(r:QualifiedRecord):Promise<void>{
 if(r.cleanupP)return r.cleanupP;
 r.cleanupP=(async()=>{
  beginQualifiedClose(r);
  for(const slot of r.slots)if(slot.kind==='owner'||slot.kind==='source'||slot.kind==='material')await slot.observed;
  r.callbackClosed=r.workSettled&&!r.late&&!r.constructions.size&&r.sequence===r.seal&&r.slots.filter(s=>s.kind!=='leaf'&&s.kind!=='native').every(s=>s.called&&s.outcome?.ok===true);
  if(r.callbackClosed){
   for(const slot of r.slots)if(slot.kind==='leaf')startQualifiedSlot(r,slot);
   for(const slot of r.slots)if(slot.kind==='leaf')await slot.observed;
   r.leafRestored=r.slots.filter(s=>s.kind==='leaf').every(s=>s.outcome?.ok===true)&&!r.late&&r.sequence===r.seal;
   if(r.leafRestored&&r.abortInstalled&&r.abort){try{r.ctx.signal.removeEventListener('abort',r.abort);r.abortInstalled=false;}catch(error){holdQualified(r,error);r.errors.push(error);r.leafRestored=false;}}
   if(r.leafRestored){try{r.lease?.release();r.leaseReleased=Boolean(r.lease);}catch(error){holdQualified(r,error);r.errors.push(error);}}
  }
  // Opaque product DB inventory has no approved receiver seam. It is retained,
  // separately from proven callback/leaf/account closure, never declared closed.
  let publicNativeAllowed=r.callbackClosed&&r.leafRestored&&!r.late&&!r.bodyFailure;
  try{for(const c of r.coordinators){const status=c.snapshot();if(status.active!==0||status.waiting!==0)publicNativeAllowed=false;}for(const s of r.services)if(s.runtimeStatus().blocked!==false)publicNativeAllowed=false;}catch(error){holdQualified(r,error);r.errors.push(error);publicNativeAllowed=false;}
  if(publicNativeAllowed){
   // Probe capability is required BEFORE any irreversible close. An initially
   // open DB is normal; only a native boolean from the captured getter counts.
   // Missing/changed/throwing/nonboolean evidence refuses this DB's close slot.
   for(const native of r.natives){
    try{
     const slot=native.closeSlot,storeDB=Object.getOwnPropertyDescriptor(native.store,'db'),current=native.db&&Object.getOwnPropertyDescriptor(native.db,'isOpen');
     if(!slot||slot.kind!=='native'||slot.receiver!==native.store||typeof slot.method!=='function'||slot.called||slot.rawWritten||!storeDB||!Object.hasOwn(storeDB,'value')||storeDB.value!==native.db||!native.openDescriptor||native.openDescriptor.configurable!==false||typeof native.getOpen!=='function'||!current||!Object.hasOwn(current,'get')||current.get!==native.getOpen||current.configurable!==false)throw Error('qualified_fixture_native_probe_unavailable');
     const before=Reflect.apply(native.getOpen,native.db,[]);holdQualified(r,before);
     if(typeof before!=='boolean')throw Error('qualified_fixture_native_probe_nonboolean');
     native.probeReady=true;
    }catch(error){holdQualified(r,error);r.errors.push(error);r.errors.push(Error('qualified_fixture_native_close_not_authorized'));}
   }
   for(const native of r.natives)if(native.probeReady)startQualifiedSlot(r,native.closeSlot);
   for(const native of r.natives)if(native.probeReady)await native.closeSlot.observed;
   for(const native of r.natives){
    if(!native.probeReady)continue;
    const slot=native.closeSlot;
    // A rejected close never becomes healthy, even if it closed DB first.
    if(slot.called!==true||slot.rawWritten!==true||slot.outcome?.ok!==true){r.errors.push(Error('qualified_fixture_native_close_unconfirmed'));continue;}
    try{
     const storeDB=Object.getOwnPropertyDescriptor(native.store,'db'),current=Object.getOwnPropertyDescriptor(native.db,'isOpen');
     if(!storeDB||!Object.hasOwn(storeDB,'value')||storeDB.value!==native.db||!current||!Object.hasOwn(current,'get')||current.get!==native.getOpen||current.configurable!==false||Reflect.apply(native.getOpen,native.db,[])!==false)throw Error('qualified_fixture_native_close_unconfirmed');
     native.closed=true;
    }catch(error){holdQualified(r,error);r.errors.push(error);}
   }
  }
  r.retainedForParent=true;r.rootDeleted=false;
  for(const root of r.roots){
   try{if(!root.identityWritten)throw Error('qualified_fixture_partial_root_identity');const native=lstatSync(root.identity.root);if(realpathSync(root.identity.root)!==root.identity.root||native.isSymbolicLink()||['uid','dev','ino','birthtimeMs'].some(k=>(native as any)[k]!==root.identity[k]))throw Error('qualified_fixture_retained_root_changed');
    const report={version:1,...root.identity,bodyPassed:!r.bodyFailure,callbackClosed:r.callbackClosed,leafRestored:r.leafRestored,leaseReleased:r.leaseReleased,opaqueNativeUnconfirmed:r.opaqueNativeUnconfirmed,publicNativeClosed:r.natives.length>0?r.natives.every(n=>n.closed):null,retainedForParent:true,rootDeleted:false,lateRegistration:r.late,registrationCount:r.sequence,closingRegistrationCount:r.seal??null,cleanupErrorCount:r.errors.length};
    holdQualified(r,report);console.info('QUALIFIED_FIXTURE_RETAINED '+JSON.stringify(report));
   }catch(error){holdQualified(r,error);r.errors.push(error);}
  }
  if(!r.callbackClosed)r.errors.push(Error('qualified_fixture_callback_close_unknown'));
 })();holdQualified(r,r.cleanupP);return r.cleanupP;
}
function runCase(ctx:TestContext,work:(fixture:QualifiedRecord)=>Promise<void>):Promise<void>{
 const r:QualifiedRecord={ctx,caseNonce:randomBytes(16).toString('hex'),refs:[],registrations:[],sequence:0,closing:false,late:false,errors:[],slots:[],constructions:new Set(),roots:[],natives:[],services:[],coordinators:[],workSettled:false,callbackClosed:false,leafRestored:false,leaseReleased:false,opaqueNativeUnconfirmed:false,retainedForParent:true,rootDeleted:false,account:undefined,closeStarted:false,abortInstalled:false};qualifiedRecords.push(r);holdQualified(r,ctx);holdQualified(r,work);
 const scenario=(async()=>{
  await Promise.resolve();
  try{
   if(r.hookFailure)throw r.hookFailure.error;
   r.abort=()=>{holdQualified(r,{abortReason:ctx.signal.reason});beginQualifiedClose(r);};holdQualified(r,r.abort);ctx.signal.addEventListener('abort',r.abort,{once:true});r.abortInstalled=true;ctx.signal.throwIfAborted();
   for(const previous of qualifiedRecords){if(previous===r)break;if(!previous.callbackClosed||!previous.leafRestored||!previous.leaseReleased)throw Error('qualified_fixture_previous_callbacks_unknown');}
   r.account=holdQualified(r,inject('profileTestAccountOwnership' as never));assertProfileAccountWorkerReleased(r.account);
   r.lease=holdQualified(r,acquireProfileAccountLease(r.account,realpathSync(userInfo().homedir),r.caseNonce));
   const raw=work(r);r.workP=holdQualified(r,raw);
   try{await raw;}finally{r.workSettled=true;}
  }catch(error){r.bodyFailure=holdQualified(r,{error});}
  finally{try{await qualifiedCleanup(r);}catch(error){holdQualified(r,error);r.errors.push(error);}}
  if(r.bodyFailure||r.errors.length){const errors=[...(r.bodyFailure?[r.bodyFailure.error]:[]),...r.errors];if(errors.length===1)throw errors[0];throw new AggregateError(errors,'qualified_fixture_body_and_cleanup_failed',{cause:errors[0]});}
 })();r.scenarioP=holdQualified(r,scenario);r.finished=()=>scenario;holdQualified(r,r.finished);
 try{ctx.onTestFinished(r.finished);}catch(error){r.hookFailure=holdQualified(r,{error});}
 return scenario;
}

it.for(['success','host-failure','other-writer'] as const)('actual Desktop full-history publisher retains its exact basis: %s',(scenario,ctx)=>runCase(ctx,async fixture=>{
 const root=qualifiedRoot(fixture,'desktop-basis-'),source=join(root,'source.txt'),policyFile=join(root,'policy.json');writeFileSync(source,'source');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+120000,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const registry=qualifiedAcquire(fixture,'source-registry',()=>new ToolRegistry({autoMode:true},buildToolList(undefined,{cwd:root})));qualifiedLeaf(fixture,'source-registry-dispose',()=>registry.dispose());
 const sidecar=qualifiedAcquire(fixture,'observation-sidecar',()=>new DesktopTaskObservationStore(join(root,'tasks'))),taskId='basis',store=qualifiedAcquire(fixture,'separate-file-store',()=>new FileSessionStore(join(root,'compound-sessions')));
 let armed=false,product:Awaited<ReturnType<typeof createDesktopProductObservationBinding>>|undefined;
  product=await qualifiedBeginProduct(fixture,'product',()=>createDesktopProductObservationBinding({taskId,cwd:root,policy:parseObservationPolicyFile(policyFile),sourceRegistry:registry,profileRoot:join(root,'profile'),environmentRoot:join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'),credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true,executionPersistence:sidecar.getExecutionPersistence(taskId,()=>{}),persist:async value=>{
   if(armed&&scenario==='host-failure')throw Error('actual host publication failed');
   if(armed&&scenario==='other-writer'){const previous=(await store.load(value.sessionId))!;await store.save({...previous,messages:[...previous.messages,{role:'user',content:[{type:'text',text:'Other writer committed.'}]}]});}
   if(!sidecar.publishCanonicalFacts(taskId,value))await sidecar.persistSession(taskId,value);
  }}));qualifiedProduct(fixture,'product',product);
  const host=requireDesktopProductHost(product.binding),session=host.session,basis=session.getPublishedHistoryBasis();session.replaceMessages([{role:'user',content:[{type:'text',text:'This publication.'}]}]);const snapshot=session.exportSnapshot();armed=true;
  if(scenario==='success'){await host.persistHistory(snapshot);expect(session.getPublishedHistoryBasis()).toBe(computeSessionHistoryDigest(snapshot));await host.persistHistory(session.exportSnapshot());}
  else{await expect(host.persistHistory(snapshot)).rejects.toThrow();expect(session.getPublishedHistoryBasis()).toBe(basis);}
}),30000);
