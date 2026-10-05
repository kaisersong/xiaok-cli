import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Common main host assembly, using each arm's own production runner and stores.
 * Does not implement task execution, authorize model data, or construct bodies. */
export async function runPairedDesktopTask({sourceRoot,runDirectory,workspace,task,command,config,registry,prompt,signal,deadline,onRuntimeEvent,candidate=false}){
 const load=file=>import(pathToFileURL(join(sourceRoot,file)).href);
 const [{createDesktopModelRunnerWithRegistry},{MaterialRegistry},{FileTaskSnapshotStore},{InProcessTaskRuntimeHost}]=await Promise.all([
  load('desktop/electron/desktop-services.ts'),load('src/runtime/task-host/material-registry.ts'),load('src/runtime/task-host/snapshot-store.ts'),load('src/runtime/task-host/task-runtime-host.ts')]);
 const configRoot=join(runDirectory,'case-config');await fs.mkdir(configRoot,{recursive:true,mode:0o700});
 await fs.writeFile(join(configRoot,'config.json'),JSON.stringify(config),{mode:0o600,flag:'wx'});
 const previousFetch=globalThis.fetch;let wireAttempts=0,firstWireBodySha256=null;const wireModels=new Set();
 const previousConfig=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=configRoot;
 let restoreStream=()=>{},restoreExecute=()=>{},restoreDefinitions=()=>{};
 try {
 const nativeNames=registry.getToolDefinitions().map(tool=>tool.name).filter(name=>['read','write','edit','bash'].includes(name));
 registry.setAllowedTools(nativeNames);
 const definitions=registry.getToolDefinitions.bind(registry);
 registry.getToolDefinitions=()=>definitions().filter(tool=>nativeNames.includes(tool.name));restoreDefinitions=()=>{registry.getToolDefinitions=definitions;};
 const dataRoot=join(runDirectory,'desktop-main');await fs.mkdir(dataRoot,{recursive:true,mode:0o700});
 const materialRegistry=new MaterialRegistry({workspaceRoot:workspace,maxBytes:50*1024*1024});
 const snapshotStore=new FileTaskSnapshotStore(join(dataRoot,'tasks'));
 const activationMap=new Map();let owner,taskId,runnerDone;
 const finished=new Promise(resolve=>{runnerDone=resolve;});
 const facts={adapterStreamCalls:0,registryReturned:0,firstAdapterPromptSha256:null,qualified:false,reason:candidate?'not-created':'baseline',entry:'production-main-task-host',captures:0,recallCalls:0,recallCompleted:0,projection:null,counters:[],durableTask:false,durableSidecar:false};
 const {OpenAIAdapter}=await load('src/ai/adapters/openai.ts');
 const originalStream=OpenAIAdapter.prototype.stream;
 OpenAIAdapter.prototype.stream=function(messages,tools,system,options){facts.adapterStreamCalls++;if(facts.firstAdapterPromptSha256===null)facts.firstAdapterPromptSha256=createHash('sha256').update(JSON.stringify({messages,tools,system})).digest('hex');return originalStream.call(this,messages,tools,system,options);};
 restoreStream=()=>{OpenAIAdapter.prototype.stream=originalStream;};
 const rootExecute=registry.executeTool;restoreExecute=()=>{registry.executeTool=rootExecute;};
 const observeRegistry=target=>{const execute=target.executeTool;target.executeTool=async function(...args){const value=await execute.apply(this,args);facts.registryReturned++;return value;};};
 observeRegistry(registry);
 let requireBinding;
 if(candidate)({requireDesktopObservationBinding:requireBinding}=await load('desktop/electron/desktop-observation-owner.ts'));
 const external={request:async()=>{throw Error('SOLPI_EXTERNAL_SERVICE_NOT_ADMITTED');}};
 const runner=createDesktopModelRunnerWithRegistry(registry,[],dataRoot,external,materialRegistry,{}, {cwd:workspace,...(candidate?{observationTasks:activationMap}:{})});
 const host=new InProcessTaskRuntimeHost({materialRegistry,snapshotStore,runner:async input=>{
  try{return await runner({...input,emitRuntimeEvent:async event=>{await onRuntimeEvent(event);await input.emitRuntimeEvent(event);}});}finally{runnerDone();}
 }});
 globalThis.fetch=async(input,init)=>{wireAttempts++;if(firstWireBodySha256===null&&typeof init?.body==='string')firstWireBodySha256=createHash('sha256').update(init.body).digest('hex');try{const body=JSON.parse(String(init?.body));if(typeof body.model==='string')wireModels.add(body.model);}catch{}return previousFetch(input,init);};
 const abort=()=>{if(taskId)void host.cancelTask(taskId,'eval_deadline');};
 signal.addEventListener('abort',abort,{once:true});
 try{
  const prepared=await host.prepareTask({prompt,materials:[],permissionMode:'auto',maxToolLoopIterations:10,watchdogMs:Math.max(1,deadline-Date.now())});taskId=prepared.taskId;
  if(candidate){
   const [{parseObservationPolicyFile},{resolveRuntimeModelBinding}]=await Promise.all([load('src/runtime/sol-pi/product-bootstrap.ts'),load('src/ai/providers/control-plane.ts')]);
   const binding=resolveRuntimeModelBinding(config);const policyPath=join(runDirectory,'desktop-policy.json');
   await fs.writeFile(policyPath,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:binding.providerId,url:binding.baseUrl.replace(/\/$/,'')+'/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+180000,readFileScopes:Object.keys(task.files).map(file=>({filePath:resolve(workspace,file),startLine:1})),bashSources:command?[{command,cwd:workspace}]:[]}),{mode:0o600,flag:'wx'});
   const {homedir}=await import('node:os');
   const activation={policy:parseObservationPolicyFile(policyPath),profileRoot:join(configRoot,'observation-profile'),environmentRoot:join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1'),consumed:false,onPrompt:async()=>false};
   let current;
   Object.defineProperty(activation,'live',{get:()=>current,set:value=>{current=value;if(value){const claims=requireBinding(value.binding,taskId,value.registry);owner=claims.owner;observeRegistry(value.registry);facts.qualified=true;facts.reason=null;}}});
   activationMap.set(taskId,activation);
  }
  signal.throwIfAborted();await host.startTask(taskId);
  for await(const _event of host.subscribeTask(taskId)){}
  await finished;
  const recovered=await host.recoverTask(taskId);facts.wireAttempts=wireAttempts;facts.firstWireBodySha256=firstWireBodySha256;facts.wireModels=[...wireModels];facts.taskId=taskId;facts.taskStatus=recovered.snapshot.status;
  const disk=await new FileTaskSnapshotStore(join(dataRoot,'tasks')).recoverTask(taskId);facts.durableTask=Boolean(disk&&disk.status===recovered.snapshot.status);
  if(candidate&&owner){
   facts.projection=owner.getProjectionDiagnostics();
   const sidecarRoot=join(dataRoot,'tasks','protected-observation-sessions');
   const names=await fs.readdir(sidecarRoot).catch(()=>[]);facts.durableSidecar=Boolean(recovered.snapshot.protectedObservationClosure&&names.some(name=>name.endsWith('.json')&&name!=='latest.json'));
   const counterRoot=join(configRoot,'observation-profile','counters');
   for(const name of await fs.readdir(counterRoot).catch(()=>[])){
    const ledger=JSON.parse(await fs.readFile(join(counterRoot,name,'full-send.json'),'utf8'));
    facts.counters.push(...Object.entries(ledger.observations).map(([id,count])=>({id,fullLogicalSendCount:count})));
   }
   facts.captures=facts.counters.length;
  }
  if(recovered.snapshot.status!=='completed')throw Object.assign(Error('SOLPI_DESKTOP_TASK_'+recovered.snapshot.status),{mechanismFacts:facts});
  return facts;
 }catch(error){error.mechanismFacts??=facts;throw error;}
 finally{signal.removeEventListener('abort',abort);if(signal.aborted&&taskId)await host.cancelTask(taskId,'eval_deadline');}
 } finally {restoreStream();restoreExecute();restoreDefinitions();globalThis.fetch=previousFetch;if(previousConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previousConfig;}
}
