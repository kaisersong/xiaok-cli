// Only the explicit, separately reviewed qualified config selects this file.
import {it,expect,vi} from 'vitest';
import {mkdtempSync,realpathSync,lstatSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {ownedSessionShutdownProbe as probe,isKnownOwnedSessionServiceStopFailure} from '../../desktop/tests/fixtures/owned-session-shutdown-probe.mjs';
import {createOwnedSessionShutdownJournal} from '../../desktop/tests/fixtures/owned-session-shutdown-phase.mjs';

// Only the two fixed source Worker URLs use fresh real compiled entries.
// Every other target/options remain native. No result, IO or exit is mocked.
const workerRealm=vi.hoisted(()=>({active:undefined as any,retained:[] as any[]}));
vi.mock('node:worker_threads',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:worker_threads')>();
 const fixed=[{kind:'delivery',url:new URL('../../src/runtime/task-host/delivery-verifier-worker.js',import.meta.url)},{kind:'protection',url:new URL('../../src/runtime/task-host/protection-read-worker.ts',import.meta.url)}];
 const canonical=(value:string)=>join(realpathSync(dirname(value)),basename(value));
 const urlSearch=Object.getOwnPropertyDescriptor(URL.prototype,'search')!.get!,urlHash=Object.getOwnPropertyDescriptor(URL.prototype,'hash')!.get!;
 const targets=fixed.map(item=>({kind:item.kind,path:canonical(fileURLToPath(item.url))}));
 return {...actual,Worker:class extends actual.Worker{
  constructor(filename:ConstructorParameters<typeof actual.Worker>[0],options?:ConstructorParameters<typeof actual.Worker>[1]){
   let path:string|undefined;try{
    if(typeof filename==='string'){
     if(!filename.includes('?')&&!filename.includes('#'))path=canonical(filename);
    }else if(filename!==null&&!types.isProxy(filename)&&Object.getPrototypeOf(filename)===URL.prototype){
     // Query/hash URLs keep their original native semantics, including errors.
     if(Reflect.apply(urlSearch,filename,[])===''&&Reflect.apply(urlHash,filename,[])==='')path=canonical(fileURLToPath(filename));
    }
   }catch{/* Preserve native behavior for every unrelated/invalid entry. */}
   const target=targets.find(item=>item.path===path),active=workerRealm.active;
   if(target&&(!active||!active.outputs[target.kind])){const error=Error('owned_session_compiled_worker_not_ready');workerRealm.retained.push(error);throw error;}
   if(target){active.keep('native-worker-original-entry',filename);active.keep('native-worker-original-options',options);}
   super(target?active.outputs[target.kind]:filename,options);
   if(target){
    const box={kind:target.kind,ordinal:active.workers.length+1,raw:this,threadId:this.threadId,exited:false,exitCode:undefined as number|undefined};
    workerRealm.retained.push(box);active.workers.push(box);active.keep('original-native-worker',this);active.keep('native-worker-receipt',box);
    const observe=(code:string,facts:Record<string,unknown>)=>{try{active.journal.record(code,'fulfilled',null,facts);}catch(error){active.observerErrors.push(error);active.keep('worker-observer-error',error);}};
    observe('worker_start',{workerKind:box.kind,workerOrdinal:box.ordinal,workerThreadId:box.threadId});
    this.once('exit',code=>{box.exited=true;box.exitCode=code;observe('worker_exit',{workerKind:box.kind,workerOrdinal:box.ordinal,workerThreadId:box.threadId,workerExitCode:code});});
   }
  }
 }};
});

// Append-only worker-lifetime ownership, independent of the probe's WeakMap.
// No test/hook clears this registry or closes/restores an unconfirmed dependency.
type RetainedReference={label:string,value:unknown};
type RetainedOwnerBox={refs:RetainedReference[],expected:{entry:RetainedReference,value:unknown}[],errors:{phase:string,error:unknown}[],facts:unknown[]};
const retainedOwnerBoxes:RetainedOwnerBox[]=[];

function gate<T=void>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
type WaitGate=ReturnType<typeof gate<void>>;
// Exact predetermined leaf references only. No message acceptance or self-signed failure.
function originalPhysicalFailure(error:unknown,original:unknown):boolean{
 if(types.isProxy(error)||!(error instanceof AggregateError))return false;
 if(Reflect.ownKeys(error).some(key=>typeof key!=='string'||!['stack','message','cause','errors'].includes(key)))return false;
 const entries=Object.getOwnPropertyDescriptor(error,'errors'),cause=Object.getOwnPropertyDescriptor(error,'cause'),message=Object.getOwnPropertyDescriptor(error,'message');
 if(cause||!message||!('value'in message)||message.value!=='agent_model_physical_drain_unconfirmed')return false;
 if(!entries||!('value'in entries)||types.isProxy(entries.value)||!Array.isArray(entries.value))return false;
 const length=Object.getOwnPropertyDescriptor(entries.value,'length')?.value;
 if(length!==1||Reflect.ownKeys(entries.value).length!==2)return false;
 const item=Object.getOwnPropertyDescriptor(entries.value,'0');return !!item&&'value'in item&&item.value===original;
}

it('a genuinely prepared observed session attempts independent stops after its original usage closure fails',ctx=>{
 // Publish the stable box before any root, callback, gate or owner is acquired.
 const ownerBox:RetainedOwnerBox={refs:[],expected:[],errors:[],facts:[]};
 const ownerIndex=retainedOwnerBoxes.length;retainedOwnerBoxes.push(ownerBox);
 const keep=<T,>(label:string,value:T):T=>{const entry={label,value};ownerBox.refs.push(entry);ownerBox.expected.push({entry,value});return value;};
 const recordError=(phase:string,error:unknown)=>{ownerBox.errors.push({phase,error});keep('error:'+phase,error);};
 const verifyRetention=()=>{
  if(retainedOwnerBoxes[ownerIndex]!==ownerBox||ownerBox.refs.length!==ownerBox.expected.length)throw Error('owned_session_retention_registry_mismatch');
  for(let index=0;index<ownerBox.expected.length;index++){
   const expected=ownerBox.expected[index];
   if(ownerBox.refs[index]!==expected.entry||!Object.is(ownerBox.refs[index].value,expected.value))throw Error('owned_session_retention_reference_mismatch');
  }
 };
 keep('context',ctx);keep('context-signal',ctx.signal);keep('probe',probe);keep('keep',keep);keep('record-error',recordError);keep('verify-retention',verifyRetention);
 // Setup starts on the next microtask, after the exact original scenario/join
 // promise is published below. No allocated root can outrun its owning box.
 let hookInstallFailure:{error:unknown}|undefined;
 const scenario=(async()=>{
  await Promise.resolve();
  let root:string|undefined,allocatedRoot:string|undefined,stat:ReturnType<typeof lstatSync>|undefined,identity:any;
  let identityWritten=false,listenerAttempted=false;
  let phaseJournal:ReturnType<typeof createOwnedSessionShutdownJournal>|undefined;
  let journal:WaitGate|undefined,journalEntered:WaitGate|undefined,rootResponse:WaitGate|undefined,preparedEntered:WaitGate|undefined;
  let prepared:Awaited<ReturnType<import('../../desktop/electron/desktop-multi-agent-runtime.js').DesktopMultiAgentRuntime['prepareObservationSession']>>|undefined;
  let childID:string|undefined,stopOnAbort:(()=>void)|undefined;
  let originalDispose:Promise<void>|undefined,bodyFailure:{error:unknown}|undefined,bodyAccepted=false;
  let acceptedOriginalPhysical:{error:unknown}|undefined;
  let acceptedServiceStopFailure:{error:unknown}|undefined;
  let originalJournalFailure:Error|undefined;
  let host:any,service:any,store:any,base:any,bridge:any,runtime:any;
  const presence=keep('setup-presence',{pid:process.pid,ppid:process.ppid} as Record<string,unknown>);
  const fixtureErrors=keep('fixture-errors',[] as unknown[]);
  const fixtureErrorSources=keep('fixture-error-sources',[] as Array<string|undefined>);
  const cleanupError=(phase:string,error:unknown,stopCode?:string)=>{fixtureErrors.push(error);fixtureErrorSources.push(stopCode);recordError(phase,error);};
  const unexpectedCleanup=(error:unknown,index:number)=>!bodyAccepted||!acceptedOriginalPhysical||(error!==acceptedOriginalPhysical.error&&!(fixtureErrorSources[index]==='finally_service_stop'&&acceptedServiceStopFailure&&error===acceptedServiceStopFailure.error));
  const check=keep('check',()=>ctx.signal.throwIfAborted());
  const holdGate=(label:string)=>{const value=keep(label,gate());keep(label+':promise',value.promise);keep(label+':resolve',value.resolve);keep(label+':reject',value.reject);return value;};
  keep('cleanup-error',cleanupError);keep('hold-gate',holdGate);
  const phaseWait=keep('phase-wait',async<T,>(code:string,work:()=>Promise<T>|T,checkAfter=true):Promise<T>=>{
   phaseJournal!.record(code,'entered');let result:T;
   try{const original=keep('phase-original-operation',work());result=await original;}
   catch(error){recordError('await:'+code,error);phaseJournal!.rejected(code,error);throw error;}
   keep('phase-original-value:'+code,result);phaseJournal!.record(code,'fulfilled');if(checkAfter)check();return result;
  });
  // Diagnostic IO failure cannot prevent an independent safe original stop.
  const finalStop=keep('phase-final-stop',async(code:string,action:()=>unknown)=>{
   let operationFailure:{error:unknown}|undefined;const receiptErrors:unknown[]=[];
   try{phaseJournal?.record(code,'entered');}catch(error){receiptErrors.push(error);recordError('finally-phase-enter',error);}
   try{await keep('original-finally-stop-result',action());}catch(error){operationFailure=keep('finally-operation-error',{error});recordError('finally-operation',error);
    if(code==='finally_service_stop'&&bodyAccepted&&acceptedOriginalPhysical&&prepared&&originalJournalFailure!==undefined){
     try{
      const snapshot=keep('service-stop-suspend-snapshot',probe.snapshot(prepared.session));
      if(isKnownOwnedSessionServiceStopFailure(code,bodyAccepted,acceptedOriginalPhysical,error,snapshot.suspendFailures,originalJournalFailure))acceptedServiceStopFailure=keep('accepted-service-stop-failure',{error});
     }catch(observationError){receiptErrors.push(observationError);recordError('finally-suspend-observation',observationError);}
    }
   }
   try{if(operationFailure)phaseJournal?.rejected(code,operationFailure.error);else phaseJournal?.record(code,'fulfilled');}catch(error){receiptErrors.push(error);recordError('finally-phase-result',error);}
   const all=[...(operationFailure?[operationFailure.error]:[]),...receiptErrors];
   if(all.length===1)throw all[0];if(all.length)throw new AggregateError(all,'owned_session_stop_and_phase_failed',{cause:all[0]});
  });
  try{
   if(hookInstallFailure)throw hookInstallFailure.error;check();
   const nonce=keep('run-nonce',process.env.XIAOK_OWNED_SESSION_SHUTDOWN_NONCE),container=keep('container',process.env.XIAOK_OWNED_SESSION_SHUTDOWN_CONTAINER);
   presence.nonce=nonce;presence.container=container;
   if(process.env.XIAOK_OWNED_SESSION_SHUTDOWN_CASE!=='1'||!nonce||!/^[a-f0-9]{32}$/.test(nonce)||!container)throw Error('owned_session_launch_required');
   const parent=keep('parent-canonical',realpathSync(container));presence.parent=parent;const parentStat=keep('parent-stat',lstatSync(parent));
   if(parent!==container||!parentStat.isDirectory()||parentStat.isSymbolicLink()||parentStat.uid!==process.getuid?.())throw Error('owned_session_container_identity');
   const environmentRoot=keep('environment-root',join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'));
   if(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))throw Error('actual_registered_observation_recipe_required');
   // Retain the allocation before realpath/stat/identity write can fail.
   allocatedRoot=keep('allocated-root',mkdtempSync(join(parent,'observed-shutdown-')));
   root=keep('canonical-root',realpathSync(allocatedRoot));stat=keep('root-stat',lstatSync(root));
   const fixtureNonce=keep('fixture-nonce',randomUUID());presence.fixtureNonce=fixtureNonce;
   identity=keep('root-identity',{root,nonce,fixtureNonce,pid:process.pid,ppid:process.ppid,uid:stat.uid,dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs});
   writeFileSync(join(root,'identity.json'),JSON.stringify(identity,null,2)+'\n');identityWritten=true;
   phaseJournal=createOwnedSessionShutdownJournal({file:join(root,'phase-v1.jsonl'),runNonce:nonce,fixtureNonce,pid:process.pid,ppid:process.ppid,keep});
   const F=keep('original-journal-failure',Error('OWNED_ORIGINAL_JOURNAL_FAILURE'));originalJournalFailure=F;
   journal=holdGate('journal');journalEntered=holdGate('journal-entered');rootResponse=holdGate('root-response');preparedEntered=holdGate('prepared-entered');
   stopOnAbort=keep('abort-listener',()=>{
    for(const value of [journal,rootResponse,preparedEntered,journalEntered]){try{value?.resolve();}catch(error){cleanupError('abort-gate-release',error);}}
    try{const original=keep('abort-service-dispose-promise',service?.dispose());if(original)keep('abort-service-dispose-observation',original.catch((error:unknown)=>{cleanupError('abort-service-dispose-rejection',error);}));}catch(error){cleanupError('abort-service-dispose',error);}
   });
   listenerAttempted=true;ctx.signal.addEventListener('abort',stopOnAbort,{once:true});
   if(ctx.signal.aborted)stopOnAbort();
   const workerOwner=keep('worker-owner',{outputs:{} as Record<string,string>,workers:[] as Array<{kind:string,ordinal:number,raw:unknown,threadId:number,exited:boolean,exitCode?:number}>,observerErrors:[] as unknown[],keep,journal:phaseJournal});
   workerRealm.retained.push(workerOwner);workerRealm.active=workerOwner;keep('worker-realm',workerRealm);
   const compilerAllocations=keep('compiler-allocations',[] as Array<Record<string,unknown>>);presence.compilerAllocations=compilerAllocations;
   const acquireCompiler=keep('acquire-compiler',(kind:string,allocated:string)=>{
    // First instruction transfers the raw allocation to the stable caller box.
    keep('compiler-raw-allocation:'+kind,allocated);const entry=keep('compiler-allocation:'+kind,{kind,allocated} as Record<string,unknown>);compilerAllocations.push(entry);
    const canonical=keep('compiler-canonical:'+kind,realpathSync(allocated)),native=keep('compiler-stat:'+kind,lstatSync(canonical));
    Object.assign(entry,{canonical,runNonce:nonce,fixtureNonce,pid:process.pid,ppid:process.ppid,uid:native.uid,dev:native.dev,ino:native.ino,birthtimeMs:native.birthtimeMs});
    const artifacts=realpathSync(fileURLToPath(new URL('../../.artifacts/',import.meta.url)));
    if(canonical!==allocated||!canonical.startsWith(artifacts+'/')||!native.isDirectory()||native.isSymbolicLink()||native.uid!==process.getuid?.())throw Error('owned_compiler_root_identity');
    writeFileSync(join(canonical,'owned-observed-compiler-identity.json'),JSON.stringify(entry,null,2)+'\n',{flag:'wx',mode:0o600});entry.identityWritten=true;
   });
   const managedModule=keep('single-root-managed-module',await phaseWait('module_guard_import',()=>import('../../desktop/electron/desktop-managed-agent-session.js')));
   const ordinarySdk=keep('ordinary-guard-sdk',vi.fn(()=>{throw Error('ORDINARY_GUARD_SDK_FORBIDDEN');})),ordinaryRegistry=keep('ordinary-guard-registry',vi.fn(()=>{throw Error('ORDINARY_GUARD_REGISTRY_FORBIDDEN');})),ordinaryContext=keep('ordinary-guard-context',vi.fn(()=>{throw Error('ORDINARY_GUARD_CONTEXT_FORBIDDEN');})),ordinaryEmit=keep('ordinary-guard-emit',vi.fn());
   const ordinary=keep('ordinary-guard-session',new managedModule.DesktopManagedAgentSession({adapter:{stream:ordinarySdk},systemPrompt:'',materials:[],dataRoot:root,skillCatalog:{} as never,getTurnContext:ordinaryContext,createRegistry:ordinaryRegistry,emitRuntimeEvent:ordinaryEmit}));
   probe.register(ordinary);const ordinaryDispose=keep('ordinary-guard-original-dispose',ordinary.dispose());expect(keep('ordinary-guard-repeated-dispose',ordinary.dispose())).toBe(ordinaryDispose);
   await phaseWait('ordinary_guard_dispose',()=>ordinaryDispose);expect(probe.snapshot(ordinary).events.map(e=>e.kind)).toEqual(['tail']);expect(probe.snapshot(ordinary).observerErrors).toBe(0);expect(ordinarySdk).not.toHaveBeenCalled();expect(ordinaryRegistry).not.toHaveBeenCalled();expect(ordinaryContext).not.toHaveBeenCalled();expect(ordinaryEmit).not.toHaveBeenCalled();
   const {DesktopMultiAgentStore}=await phaseWait('module_store',()=>import('../../desktop/electron/desktop-multi-agent-store.js'));
   const {DesktopMultiAgentService}=await phaseWait('module_service',()=>import('../../desktop/electron/desktop-multi-agent-service.js'));
   const {DesktopExecutionCoordinator}=await phaseWait('module_coordinator',()=>import('../../desktop/electron/desktop-execution-coordinator.js'));
   const {DesktopMultiAgentRuntime}=await phaseWait('module_runtime',()=>import('../../desktop/electron/desktop-multi-agent-runtime.js'));
   const {InProcessTaskRuntimeHost}=await phaseWait('module_host',()=>import('../../src/runtime/task-host/task-runtime-host.js'));
   const {FileTaskSnapshotStore}=await phaseWait('module_snapshot',()=>import('../../src/runtime/task-host/snapshot-store.js'));
   const {MaterialRegistry}=await phaseWait('module_material',()=>import('../../src/runtime/task-host/material-registry.js'));
   const registryModule=await phaseWait('module_catalog',()=>import('../../desktop/electron/desktop-multi-agent-catalog-bridge.js'));
   const servicesModule=await phaseWait('module_services',()=>import('../../desktop/electron/desktop-services.js'));
   const configModule=await phaseWait('module_config',()=>import('../../src/utils/config.js'));
   const {parseObservationPolicyFile}=await phaseWait('module_bootstrap',()=>import('../../src/runtime/sol-pi/product-bootstrap.js'));
   const {mapDesktopModelUsageAdmission}=await phaseWait('module_admission',()=>import('../../desktop/electron/desktop-model-usage-admission.js'));
   const [verifierCompiler,protectionCompiler]=await phaseWait('compiler_helpers_import',async()=>{
    const verifier=keep('verifier-helper-module',await import('../../desktop/tests/fixtures/desktop-post-seal-verifier-contract.js'));
    const protection=keep('protection-helper-module',await import('../../desktop/tests/fixtures/desktop-protection-worker-entry.js'));return [verifier,protection] as const;
   });
   const compiledDelivery=keep('compiled-delivery',await phaseWait('compile_delivery',()=>verifierCompiler.compileVerifierEntry('delivery-verifier-worker.ts',{onAcquired:keep('delivery-acquired',(allocated:string)=>acquireCompiler('delivery',allocated))})));
   const compiledProtection=keep('compiled-protection',await phaseWait('compile_protection',()=>protectionCompiler.compileProtectionWorkerEntry({onAcquired:keep('protection-acquired',(allocated:string)=>acquireCompiler('protection',allocated))})));
   workerOwner.outputs.delivery=compiledDelivery.output;workerOwner.outputs.protection=compiledProtection.output;
   phaseJournal.record('store_construct','entered');
   store=keep('store',new DesktopMultiAgentStore(join(root,'groups.sqlite')));keep('native-db',(store as any).db);phaseJournal.record('store_construct','fulfilled');
   const coordinator=keep('coordinator',new DesktopExecutionCoordinator());
   const serviceOptions=keep('service-options',{store,coordinator,closeGraceMs:10,
    createSession:keep('create-session',(input:any)=>{keep('create-session-input',input);return keep('create-session-result',runtime.createSession(input));}),
    prepareObservationMessage:keep('prepare-message',(input:any)=>{keep('prepare-message-input',input);return keep('prepare-message-result',runtime.prepareObservationMessage(input));}),
    prepareObservationSession:keep('prepare-observation-session',async(input:any)=>{keep('prepare-observation-input',input);const pending=keep('original-prepare-observation-promise',runtime.prepareObservationSession(input));const actual=keep('prepared-result',await phaseWait('prepare_observed_session',()=>pending,false));prepared=actual;keep('prepared-session',actual.session);keep('prepared-owner',actual.owner);keep('prepared-registry',actual.registry);keep('prepared-publication',actual.publication);keep('prepared-observation-store',actual.observationStore);keep('prepared-release-callback',actual.releasePreparation);childID=input.identity.id;probe.register(actual.session);preparedEntered!.resolve();return actual;})});
   service=keep('service',new DesktopMultiAgentService(serviceOptions));
   runtime=keep('runtime',new DesktopMultiAgentRuntime({service}));service.registerThread({threadId:'owned-thread',profileId:'owned-profile',workspaceId:'owned-workspace',cwd:root});
   const capture=keep('original-capture',service.captureAdmittedUsage);
   const captureSpy=keep('capture-spy',vi.spyOn(service,'captureAdmittedUsage'));keep('capture-spy-restorer',captureSpy.mockRestore);
   captureSpy.mockImplementation(keep('capture-replacement',function(this:any,context:any,id:any){
    keep('capture-context',context);const original=keep('original-admission',capture.call(this,context,id));
    return context.agentId===childID?keep('mapped-admission',mapDesktopModelUsageAdmission(original,keep('journal-callback',()=>{journalEntered!.resolve();return journal!.promise;}))):original;
   }));
   const source=join(root,'source.txt'),policyFile=join(root,'policy.json'),expiresAt=Date.now()+240000;writeFileSync(source,'owned source');
   writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'},ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:1,expiresAt,nativeTools:['read']}}));
   const configSpy=keep('config-spy',vi.spyOn(configModule,'loadConfig'));keep('config-spy-restorer',configSpy.mockRestore);configSpy.mockResolvedValue({schemaVersion:2,defaultProvider:'deepseek',defaultModelId:'current',providers:{deepseek:{type:'custom',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:'fixture-only'}},models:{current:{provider:'deepseek',model:'deepseek-flash',label:'Current'}},defaultMode:'interactive'} as never);
   const {buildToolList}=await phaseWait('tools_import',()=>import('../../src/ai/tools/index.js'));check();const tools=keep('tools',buildToolList(undefined,{cwd:root}));const read=keep('read-tool',tools.find(t=>t.definition.name==='read')!);
   base=keep('base-registry',new registryModule.DesktopOwnedToolRegistry({autoMode:true},[read]));bridge=keep('catalog-bridge',new registryModule.DesktopToolCatalogBridge({registry:base,workspaceId:'owned-workspace',getService:keep('get-service',()=>service)}));
   const snapshots=keep('snapshots',new FileTaskSnapshotStore(join(root,'tasks'))),materialRegistry=keep('material-registry',new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1048576}));keep('observation-store',snapshots.observations);
   let rootCalls=0,childCalls=0;
   const response=keep('response-factory',(delta:unknown,tool=false)=>keep('response',new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:3,completion_tokens:2}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})));
   keep('original-fetch',globalThis.fetch);keep('global-restorer',vi.unstubAllGlobals);
   const fetchWork=keep('fetch-work',async(url:any,init:any)=>{keep('fetch-url',url);keep('fetch-init',init);
    if(url!=='https://api.deepseek.com/chat/completions'||init?.method!=='POST'||typeof init.body!=='string')throw Error('owned_session_unexpected_network_leaf');
    const body=JSON.parse(init.body),system=body.messages[0]?.content;
    if(typeof system!=='string')throw Error('owned_session_request_shape');
    if(system.includes('Assigned Desktop agent: /root/owned_child\n')){childCalls++;return response({content:'Owned child reply.'});}
    if(++rootCalls===1)return response({tool_calls:[{index:0,id:'owned-spawn',type:'function',function:{name:'spawn_agent',arguments:JSON.stringify({task_name:'owned_child',message:'Reply once.',fork_context:false})}}]},true);
    await phaseWait('root_response',()=>rootResponse!.promise,false);return response({content:'Owned root reply.'});
   });
   const fetchLeaf=keep('fetch-leaf',vi.fn(keep('fetch-callback',(url:any,init:any)=>keep('fetch-original-promise',fetchWork(url,init)))));vi.stubGlobal('fetch',fetchLeaf);
   let delivery:any;
   const hostOptions=keep('host-options',{snapshotStore:snapshots,groupObservationSource:service,materialRegistry,
    authorizePreparation:keep('authorize-preparation',(id:any,marker:any)=>service.assertHostPreparation(id,marker)),assertTaskAdmission:keep('assert-admission',(s:any)=>service.assertHostAdmission(s)),
    decideCancellation:keep('decide-cancellation',(s:any,r:any)=>service.decideHostCancellation(s,r)),getExecutionPolicy:keep('get-execution-policy',()=>({deliveryRepair:'explicit' as const})),onDeliveryReport:keep('delivery-callback',(report:any)=>keep('delivery-result',service.recordHostDelivery({requestSource:'scheduler',authority:delivery,report}))),
    runner:keep('host-runner',(input:any)=>{keep('host-runner-input',input);return keep('original-run-root-promise',service.runRoot(input,keep('root-runner-callback',async(context:any)=>{keep('root-context',context);
     const activation=keep('activation',{policy:parseObservationPolicyFile(policyFile),profileRoot:join(root!,'profile'),environmentRoot,onPrompt:keep('prompt-callback',async()=>true),consumed:false});
     const runnerMaterials=keep('runner-material-registry',new MaterialRegistry({workspaceRoot:join(root!,'runner-materials'),maxBytes:1048576}));
     const observationTasks=keep('observation-tasks',new Map([[input.taskId,activation]]));
     const runner=keep('model-runner',servicesModule.createDesktopModelRunnerWithRegistry(base,[read],root!,{} as never,runnerMaterials,{},
      keep('model-runner-options',{observationTasks,observationGroupHost:{getHost:keep('get-host',()=>host),observationStore:snapshots.observations},multiAgent:{runtime,service,catalog:bridge,workspaceId:'owned-workspace',cwd:root!}})));
     return keep('original-model-runner-promise',runner(keep('model-runner-input',{...input,permissionMode:'auto' as const}),context));
    })));})});
   host=keep('host',new InProcessTaskRuntimeHost(hostOptions));
   await phaseWait('service_initialize',()=>keep('original-initialize-promise',service.initialize(host)));check();delivery=keep('delivery-owner',service.bindHostDeliveryOwner(host));
   const task=keep('prepared-task',await phaseWait('prepare_root',()=>keep('original-prepare-root-promise',service.prepareRoot(host,'owned-thread',{prompt:'Perform only the owned child request.',materials:[]}))));check();await phaseWait('start_task',()=>keep('original-start-task-promise',host.startTask(task.taskId)));check();
   await phaseWait('prepared_entered',()=>preparedEntered!.promise);check();await phaseWait('journal_entered',()=>journalEntered!.promise);check();expect(childCalls).toBe(1);
   const actual=keep('actual-session',prepared!.session);phaseJournal.record('session_dispose_start','entered');originalDispose=keep('original-session-dispose-promise',actual.dispose());phaseJournal.record('session_dispose_start','fulfilled');expect(keep('repeated-session-dispose-promise',actual.dispose())).toBe(originalDispose);
   let completed=false;keep('dispose-pending-observation',originalDispose.then(keep('dispose-fulfilled-observer',()=>{completed=true;}),keep('dispose-rejected-observer',()=>{completed=true;})));await phaseWait('pending_check',()=>keep('pending-check-promise',new Promise<void>(keep('pending-check-executor',r=>{keep('pending-check-resolve',r);setImmediate(r);}))));check();expect(completed).toBe(false);
   expect(probe.snapshot(actual).events).toHaveLength(0);journal!.reject(F);
   const failure=keep('dispose-outcome',await phaseWait('session_dispose_outcome',()=>keep('dispose-outcome-promise',originalDispose!.then(keep('dispose-outcome-fulfilled',()=>({ok:true as const})),keep('dispose-outcome-rejected',(error:unknown)=>{recordError('original-session-dispose',error);return{ok:false as const,error};}))),false));
   // Persist the original outcome and caller stop population BEFORE assertions
   // or finally can become pending. A matching F never means healthy cleanup.
   const early=keep('early-dispose-observation',probe.snapshot(actual));
   const earlyFacts=keep('early-dispose-facts',{matchesPhysicalF:!failure.ok&&originalPhysicalFailure(failure.error,F),executionCount:early.events.filter(e=>e.kind==='execution').length,transportCount:early.events.filter(e=>e.kind==='transport').length,tailCount:early.events.filter(e=>e.kind==='tail').length,returnedCount:early.events.filter(e=>e.returned).length,observerErrors:early.observerErrors});
   if(failure.ok)phaseJournal.record('dispose_observation','fulfilled',null,earlyFacts);else phaseJournal.rejected('dispose_observation',failure.error,earlyFacts);
   check();expect(failure.ok).toBe(false);
   if(failure.ok)throw Error('original_physical_failure_missing');
   const state=keep('dispose-observations',probe.snapshot(actual));expect(state.observerErrors).toBe(0);expect(probe.quality().observerErrors).toBe(0);
   expect(state.events.map(e=>e.kind)).toEqual(['execution','transport']);expect(state.events.some(e=>e.kind==='tail')).toBe(false);
   if(!originalPhysicalFailure(failure.error,F))throw new AggregateError([failure.error,Error('unexpected_original_disposal_error_tree')],'owned_session_disposal_validation_failed',{cause:failure.error});
   expect(state.events.every(e=>e.returned&&e.raw instanceof Promise)).toBe(true);
   for(const event of state.events){keep('original-stop-event',event);keep('original-stop-promise',event.raw);}await phaseWait('stop_receipts',()=>keep('stop-receipts-join',Promise.all(state.events.map(e=>e.raw))));check();expect(keep('final-repeated-session-dispose-promise',actual.dispose())).toBe(originalDispose);acceptedOriginalPhysical=keep('accepted-original-physical',{error:failure.error});bodyAccepted=true;
  }catch(error){bodyFailure=keep('body-failure',{error});recordError('body',error);try{phaseJournal?.rejected('body_failure',error);}catch(receiptError){recordError('body-phase',receiptError);bodyFailure=keep('body-and-phase-failure',{error:new AggregateError([error,receiptError],'owned_session_body_and_phase_failed',{cause:error})});}}
  finally{
   // Only release test-owned waits and attempt the original high-level stops.
   // No leaf close/rm, mock restore, registry disposal or authority revoke here,
   // including partial setup and every unknown/rejected shutdown outcome.
   try{const active=workerRealm.active;if(active)phaseJournal?.record('worker_observation','fulfilled',null,{workerStarts:active.workers.length,workerExits:active.workers.filter((worker:any)=>worker.exited).length,workerObserverErrors:active.observerErrors.length});}catch(error){cleanupError('worker-observation',error);}
   try{phaseJournal?.record('finally_gate_release','entered');}catch(error){cleanupError('finally-phase-gate-enter',error);}
   for(const value of [journal,rootResponse,preparedEntered,journalEntered]){
    try{value?.resolve();}catch(error){cleanupError('finally-gate-release',error);}
   }
   try{phaseJournal?.record('finally_gate_release','fulfilled');}catch(error){cleanupError('finally-phase-gate-result',error);}
   const actions=keep('shutdown-actions',[
    keep('session-stop-action',()=>prepared?.session.dispose()),
    keep('service-stop-action',()=>service?.dispose()),
    keep('host-stop-action',()=>host?.drain()),
   ]);
   const stopCodes=['finally_session_stop','finally_service_stop','finally_host_stop'];
   // Start all independent safe original stops before joining any pending one.
   // Each observer is attached only to our own native wrapper Promise, never
   // to a provider/original public stop Promise; those are held in finalStop.
   const pending=keep('all-independent-final-stops',actions.map((action,index)=>{
    const raw=keep('original-final-stop-wrapper',finalStop(stopCodes[index],action));
    const observed=keep('final-stop-outcome-promise',raw.then(
     ()=>keep('final-stop-outcome',{ok:true as const}),
     error=>keep('final-stop-outcome',{ok:false as const,error}),
    ));
    return keep('final-stop-receipt',{code:stopCodes[index],raw,observed});
   }));
   for(const receipt of pending){const outcome=await receipt.observed;if(!outcome.ok)cleanupError('finally-stop',outcome.error,receipt.code);}
   if(listenerAttempted&&stopOnAbort){try{ctx.signal.removeEventListener('abort',stopOnAbort);}catch(error){cleanupError('remove-abort-listener',error);}}
   let observations:ReturnType<typeof probe.snapshot>|undefined;
   try{if(prepared)observations=keep('retained-observations',probe.snapshot(prepared.session));}catch(error){cleanupError('retained-observations',error);}
   if(!identityWritten)cleanupError('incomplete-identity',Error('owned_session_partial_identity_unknown'));
   if(workerRealm.active&&(workerRealm.active.observerErrors.length||workerRealm.active.workers.some((worker:any)=>!worker.exited)))cleanupError('unconfirmed-native-worker',Error('owned_session_native_worker_exit_unconfirmed'));
   try{phaseJournal?.record('retention_record','entered');}catch(error){cleanupError('retention-phase-enter',error);}
   try{
    const facts=keep('retained-log-facts',{
     ...presence,...(identity??{}),allocatedRoot:allocatedRoot??null,root:root??null,
     availableStat:stat?{uid:stat.uid,dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs}:null,
     identityWritten,identityState:identityWritten?'written':'partial_or_unknown',setupState:bodyAccepted?'assertions_completed':'partial_or_unknown',deletionAuthorized:false,
     bodyAccepted,cleanupFailures:fixtureErrors.length,
     unexpectedCleanupFailures:fixtureErrors.filter(unexpectedCleanup).length,
     callerStopKinds:observations?.events.map(e=>e.kind)??[],callerReturnedReceipts:observations?.events.filter(e=>e.returned).length??0,
     observerErrors:probe.quality().observerErrors,dependenciesRetained:true,ownerIndex,
     compilerAllocations:presence.compilerAllocations??[],workers:workerRealm.active?.workers.map((worker:any)=>({kind:worker.kind,ordinal:worker.ordinal,threadId:worker.threadId,exited:worker.exited,exitCode:worker.exitCode??null}))??[],workerObserverErrors:workerRealm.active?.observerErrors.length??0,
    });ownerBox.facts.push(facts);
    // Exact readback of the stable registry slot, entries and original values.
    // Logging failure is recorded below; neither branch releases the box.
    verifyRetention();console.info('OWNED_SESSION_SHUTDOWN_RETAINED '+JSON.stringify(facts));
   }catch(error){cleanupError('retention-readback-or-log',error);}
   try{phaseJournal?.record('retention_record','fulfilled');}catch(error){cleanupError('retention-phase-result',error);}
   const unexpected=fixtureErrors.filter(unexpectedCleanup);
   keep('unexpected-cleanup-errors',unexpected);
   if(bodyFailure||unexpected.length){
    if(bodyFailure&&!unexpected.length)throw bodyFailure.error;
    const failure=keep('scenario-and-cleanup-error',new AggregateError([...(bodyFailure?[bodyFailure.error]:[]),...unexpected],'owned_session_scenario_and_cleanup_failed',{cause:bodyFailure?.error}));recordError('final',failure);throw failure;
   }
  }
 })();
 keep('original-scenario-promise',scenario);
 const onFinished=keep('finished-hook',()=>scenario);
 try{ctx.onTestFinished(onFinished);}catch(error){hookInstallFailure=keep('finished-hook-install-failure',{error});recordError('finished-hook-install',error);}
 return scenario;
});
