// @vitest-environment node
import { expect, it, vi, inject, type TestContext } from 'vitest';
import { mkdtempSync, realpathSync, writeFileSync, rmSync, existsSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir, userInfo } from 'node:os';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import { createDesktopProductObservationBinding, requireDesktopObservationBinding } from '../../electron/desktop-observation-owner.js';
import { DesktopTaskObservationStore, desktopObservationSessionId } from '../../../src/runtime/task-host/protected-observation-store.js';

import { ToolRegistry } from '../../../src/ai/tools/index.js';

import { createAdapterFromBinding } from '../../../src/ai/models.js';
import { parseObservationPolicyFile } from '../../../src/runtime/sol-pi/product-bootstrap.js';

const network=vi.hoisted(()=>({bodies:[] as string[],beforeSend:()=>{},summary:'Tools finished; preserve original goal and execution evidence.'}));
// Only network I/O is replaced: actual HTTPS capability, SDK, builder, official
// tokenizer, user policy, runtime boundary, store CAS and live install all run.
vi.mock('node:https',async()=>{
 const actual=await vi.importActual<typeof import('node:https')>('node:https');
 const {readFileSync}=await import('node:fs');
 const pricing=readFileSync(new URL('../../../tests/fixtures/sol-pi-deepseek-pricing-20260919.html',import.meta.url),'utf8');
 const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');
 return {...actual,request:(_url:unknown,_options:unknown,onResponse:(value:unknown)=>void)=>{
  const request=new EventEmitter() as any;request.destroy=()=>{queueMicrotask(()=>request.emit('close'));};
  request.end=(body:string)=>{
   if((_options as any).method==='GET'){
    queueMicrotask(()=>{const response=new PassThrough() as any;response.statusCode=200;response.headers={'content-type':'text/html'};response.rawHeaders=['content-type','text/html'];onResponse(response);response.end(pricing);});return;
   }
   network.beforeSend();network.bodies.push(body);
   queueMicrotask(()=>{
    const response=new PassThrough() as any;response.statusCode=200;response.headers={'content-type':'text/event-stream'};response.rawHeaders=['content-type','text/event-stream'];
    onResponse(response);response.end('data: '+JSON.stringify({choices:[{delta:{content:network.summary},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');
   });
  };return request;
 }};
});
import {randomBytes} from 'node:crypto';
import {acquireProfileAccountLease,assertProfileAccountWorkerReleased} from '../../../tests/support/profile-account-ownership.mjs';

// File-local fixture lifecycle only; no product replacement or shared owner API.
type QualifiedSlot={label:string;kind:'owner'|'source'|'material'|'leaf'|'native';receiver:any;method:Function;args:unknown[];called:boolean;rawWritten:boolean;raw:unknown;observed?:Promise<{ok:true}|{ok:false;error:unknown}>;outcome?:{ok:true}|{ok:false;error:unknown}};
type QualifiedRecord={ctx:TestContext;caseNonce:string;refs:unknown[];registrations:unknown[];sequence:number;seal?:number;closing:boolean;late:boolean;errors:unknown[];slots:QualifiedSlot[];constructions:Set<string>;roots:any[];natives:any[];services:any[];coordinators:any[];bodyFailure?:{error:unknown};workP?:Promise<void>;scenarioP?:Promise<void>;finished?:()=>Promise<void>;workSettled:boolean;callbackClosed:boolean;leafRestored:boolean;leaseReleased:boolean;opaqueNativeUnconfirmed:boolean;retainedForParent:boolean;rootDeleted:boolean;lease?:{release():void};account:any;closeStarted:boolean;cleanupP?:Promise<void>;abort?:()=>void;abortInstalled:boolean;hookFailure?:{error:unknown}};
const qualifiedAnchor=Symbol('xiaok.qualified.semantic-runtime.v3.records');
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

const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))
('actual Desktop loop boundary sends one bounded SDK summary, commits CAS, and uses exact packed anchors in its next request',ctx=>runCase(ctx,async fixture=>{
 qualifiedLeaf(fixture,'network-unstub',()=>vi.unstubAllGlobals());qualifiedLeaf(fixture,'network-bodies-reset',()=>{network.bodies=[];});qualifiedLeaf(fixture,'network-before-send-reset',()=>{network.beforeSend=()=>{};});
 const root=qualifiedRoot(fixture,'semantic-runtime-');
 const file=join(root,'input.txt');writeFileSync(file,'allowed source');const expiresAt=Date.now()+240000;
 const policyFile=join(root,'policy.json');writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:file,startLine:1}],bashSources:[],semanticCompaction:{version:1,mode:'mechanism-experiment',currency:'USD',maxCalls:1,maxCostUnits:50000000,maxOutputTokens:128,expiresAt,pricing:{source:'https://api-docs.deepseek.com/quick_start/pricing',model:'deepseek-flash',inputMissUnitsPerMillion:300000000,inputHitUnitsPerMillion:6000000,outputUnitsPerMillion:1200000000,validUntil:expiresAt}}}));
 const taskId='semantic-desktop',sidecar=qualifiedAcquire(fixture,'observation-sidecar',()=>new DesktopTaskObservationStore(join(root,'tasks')));
 const registry=qualifiedAcquire(fixture,'source-registry',()=>new ToolRegistry({autoMode:true},[]));qualifiedLeaf(fixture,'source-registry-dispose',()=>registry.dispose());
 const persistence=sidecar.getExecutionPersistence(taskId,()=>{});
 const product=await qualifiedBeginProduct(fixture,'product',()=>createDesktopProductObservationBinding({taskId,cwd:root,policy:parseObservationPolicyFile(policyFile),sourceRegistry:registry,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true,persist:value=>sidecar.persistSession(taskId,value),executionPersistence:persistence}));qualifiedProduct(fixture,'product',product);
 const {session}=requireDesktopObservationBinding(product.binding,taskId,product.registry),store=persistence.store;
 session.appendUserText('Original exact goal: inspect only. Authorization must not expand.');
 for(let i=0;i<80;i++){
  session.appendAssistantBlocks([{type:'tool_use',id:`read-${i}`,name:'read',input:{file_path:`source-${i}.txt`,offset:1}}]);
  session.appendUserBlocks([{type:'tool_result',tool_use_id:`read-${i}`,content:`exact result ${i}`,is_error:i===3}]);
 }
 session.appendUserText('Exact correction: do not publish any artifact.');await store.save(session.exportSnapshot());
 const sessionFile=join(persistence.root,desktopObservationSessionId(taskId)+'.json');
 network.beforeSend=()=>{const disk=JSON.parse(readFileSync(sessionFile,'utf8'));expect(disk.semanticCompaction.reservations).toHaveLength(1);expect(disk.semanticCompaction.reservations[0].status).toBe('dispatched');expect(disk.compactions).toHaveLength(0);};
 const requests:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{requests.push(init.body);expect(JSON.parse(readFileSync(sessionFile,'utf8')).semanticCompaction.commits).toHaveLength(1);return new Response('data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}));
 const adapter=createAdapterFromBinding({providerId:'deepseek',providerType:'first_party',modelId:'deepseek-flash',wireModel:'deepseek-flash',protocol:'openai_legacy',apiKey:'fixture',baseUrl:'https://api.deepseek.com',headers:{},capabilities:['tools']});
 product.notifySubtaskBoundary();
 const messages=session.getMessages();
 await runDesktopToolLoop({observationBinding:product.binding,adapter,registry:product.registry,systemPrompt:'Complete the user task.',messages,allToolDefs:product.registry.getToolDefinitions(),signal:new AbortController().signal,taskDeadline:Date.now()+90000,
  sessionId:'desktop-session',turnId:'turn',intentId:'intent',stepId:'step',taskId,materials:[],emitRuntimeEvent:async()=>{},skillInvocation:null,skillCatalog:{} as never,dataRoot:root,taskStartTime:Date.now(),maxIterations:2,
  strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:value=>value,processToolResult:value=>value,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}});
 expect(product.diagnostics().semantic).toMatchObject({state:'compacted',attempts:1,mode:'mechanism-experiment'});
 expect(network.bodies).toHaveLength(1);expect(JSON.parse(network.bodies[0]).max_tokens).toBe(128);expect(requests).toHaveLength(1);
 expect(requests[0]).toContain('Original exact goal');expect(requests[0]).toContain('Exact correction');expect(requests[0]).toContain('exact result 3');
 const durable=(await store.load(desktopObservationSessionId(taskId)))!;expect(durable.compactions).toHaveLength(1);expect(durable.semanticCompaction!.reservations[0].status).toBe('settled');
 expect(session.exportSnapshot().compactions).toHaveLength(1);
}),120000);

it.for(['stable','new-input'] as const)('actual managed group semantic boundary: %s',(mode,ctx)=>runCase(ctx,async fixture=>{
 qualifiedLeaf(fixture,'network-unstub',()=>vi.unstubAllGlobals());qualifiedLeaf(fixture,'network-bodies-reset',()=>{network.bodies=[];});qualifiedLeaf(fixture,'network-before-send-reset',()=>{network.beforeSend=()=>{};});
 if(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))throw Error('actual product capacity environment required');
 const {DesktopMultiAgentStore}=await import('../../electron/desktop-multi-agent-store.js');
 const {DesktopExecutionCoordinator}=await import('../../electron/desktop-execution-coordinator.js');
 const {DesktopMultiAgentService}=await import('../../electron/desktop-multi-agent-service.js');
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');
 const {MaterialRegistry}=await import('../../../src/runtime/task-host/material-registry.js');
 const {createDesktopProductObservationGroup}=await import('../../electron/desktop-observation-group.js');
 const root=qualifiedRoot(fixture,'semantic-managed-');
 const store=qualifiedNativeStore(fixture,qualifiedAcquire(fixture,'desktop-store',()=>new DesktopMultiAgentStore(join(root,'groups.sqlite'))));
 const coordinator=qualifiedAcquire(fixture,'desktop-coordinator',()=>new DesktopExecutionCoordinator());
 const service=qualifiedService(fixture,qualifiedAcquire(fixture,'desktop-service',()=>new DesktopMultiAgentService({store,coordinator,createSession:async()=>{throw Error('no child requested');}})),coordinator);
 service.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});
 const source=join(root,'source.txt');writeFileSync(source,'source');const expiry=Date.now()+180000,policyFile=join(root,'policy.json');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:expiry,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:1,expiresAt:expiry,nativeTools:['read']},semanticCompaction:{version:1,mode:'mechanism-experiment',currency:'USD',maxCalls:1,maxCostUnits:50000000,maxOutputTokens:128,expiresAt:expiry,pricing:{source:'https://api-docs.deepseek.com/quick_start/pricing',model:'deepseek-flash',inputMissUnitsPerMillion:300000000,inputHitUnitsPerMillion:6000000,outputUnitsPerMillion:1200000000,validUntil:expiry}}}));
 const base=qualifiedAcquire(fixture,'base-registry',()=>new ToolRegistry({autoMode:true},[]));qualifiedLeaf(fixture,'base-registry-dispose',()=>base.dispose());
 const snapshots=qualifiedAcquire(fixture,'snapshot-store',()=>new FileTaskSnapshotStore(join(root,'tasks')));let failure:unknown,finished=false;
 const requests:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{requests.push(String(init?.body));return new Response('data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}));
 const adapter=createAdapterFromBinding({providerId:'deepseek',providerType:'first_party',modelId:'deepseek-flash',wireModel:'deepseek-flash',protocol:'openai_legacy',apiKey:'fixture',baseUrl:'https://api.deepseek.com',headers:{},capabilities:['tools']});
 const materials=qualifiedMaterial(fixture,qualifiedAcquire(fixture,'material-registry',()=>new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1048576})));
 const host=qualifiedHost(fixture,qualifiedAcquire(fixture,'runtime-host',()=>new InProcessTaskRuntimeHost({snapshotStore:snapshots,groupObservationSource:service,
  materialRegistry:materials,
  authorizePreparation:(taskId,marker)=>service.assertHostPreparation(taskId,marker),assertTaskAdmission:snapshot=>service.assertHostAdmission(snapshot),
  decideCancellation:(snapshot,reason)=>service.decideHostCancellation(snapshot,reason),getExecutionPolicy:()=>({deliveryRepair:'explicit'}),
  runner:input=>service.runRoot(input,async context=>{
   try{
    const group=await qualifiedBeginProduct(fixture,'group-product',()=>createDesktopProductObservationGroup({service,host,context,observationStore:snapshots.observations,taskId:input.taskId,cwd:root,
     policy:parseObservationPolicyFile(policyFile),sourceRegistry:base,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true}));
    qualifiedProduct(fixture,'group-product',group);
    group.session.appendUserText('Exact original user goal and constraints');
    for(let i=0;i<80;i++){group.session.appendAssistantBlocks([{type:'tool_use',id:`r${i}`,name:'read',input:{file_path:`s${i}.txt`}}]);group.session.appendUserBlocks([{type:'tool_result',tool_use_id:`r${i}`,content:`exact ${i}`,is_error:i===3}]);}
    group.session.appendUserText('Exact last correction');
    await snapshots.observations.persistSession(input.taskId,group.session.exportSnapshot());
    await group.runRootTurn(context,'auto',input.signal,async turn=>{
     // Real mailbox claim is confirmed before the later semantic boundary.
     store.sendMessage(context.groupId,{sender:{kind:'user',actorId:'profile'},receiverId:context.agentId,text:'ACKNOWLEDGED_INPUT'});
     const batch=await context.mailbox.drainInput();group.session.appendUserText(batch.messages[0].preview);await turn.publishHistory();await context.mailbox.confirmApplied(batch.claimId!);
     network.beforeSend=()=>{if(mode==='new-input')store.sendMessage(context.groupId,{sender:{kind:'user',actorId:'profile'},receiverId:context.agentId,text:'NEW_DURING_SUMMARY'});};
     turn.notifySubtaskBoundary();
     const nativeMessages=group.session.getMessages();
     await runDesktopToolLoop({observationBinding:turn.binding,mailbox:context.mailbox,beforeManagedTurnSeal:async()=>{group.session.replaceMessages(nativeMessages);await turn.publishHistory();},adapter,registry:turn.registry,systemPrompt:'Complete the user task.',messages:nativeMessages,allToolDefs:turn.registry.getToolDefinitions(),signal:turn.signal,taskDeadline:Date.now()+90000,
      sessionId:input.taskId,turnId:context.turnId,intentId:'intent',stepId:'step',taskId:input.taskId,materials:[],emitRuntimeEvent:input.emitRuntimeEvent,skillInvocation:null,skillCatalog:{} as never,dataRoot:root,taskStartTime:Date.now(),maxIterations:2,
      strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:value=>value,processToolResult:value=>value,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}});
     const saved=(await snapshots.observations.getExecutionPersistence(input.taskId,()=>{}).store.load(desktopObservationSessionId(input.taskId)))!;
     expect(network.bodies).toHaveLength(1);expect(saved.semanticCompaction!.reservations[0].status).toBe('settled');
     expect(saved.compactions).toHaveLength(mode==='stable'?1:0);
     expect(requests).toHaveLength(1);expect(requests[0]).toContain('ACKNOWLEDGED_INPUT');
     if(mode==='new-input')expect(requests[0]).toContain('NEW_DURING_SUMMARY');
     finished=true;
    });
   }catch(error){failure=error;throw error;}
  })})));
 await service.initialize(host);
 const prepared=await service.prepareRoot(host,'thread',{prompt:'Run actual managed summary',materials:[]});await host.startTask(prepared.taskId);await host.drain();
 expect(failure,(failure as Error|undefined)?.stack).toBeUndefined();expect(finished).toBe(true);
}),120000);
