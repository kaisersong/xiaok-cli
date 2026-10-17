// Common frozen paired worker; launched only by explicit paired --execute.
import fs from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { tasks, score, safeRead, allowedTool, createFinalReplyCapture, classifyExecution } from './baseline-core.mjs';
import { sandboxEvaluate } from './baseline-sandbox.mjs';
import {runPairedDesktopTask} from './paired-desktop.mjs';
import {createPairedMechanism} from './paired-mechanism.mjs';
if(process.argv.length!==5)throw Error('SOLPI_PAIRED_HOST_LAUNCH_REQUIRED');
const outerDeadline=setTimeout(()=>process.exit(124),119000);outerDeadline.unref();
const [repo,runRoot,relativeDirectory]=process.argv.slice(2),dir=join(runRoot,relativeDirectory),root=join(dir,'workspace');
const manifest=JSON.parse(await fs.readFile(join(runRoot,'manifest.json'),'utf8'));
if(!await fs.stat(join(runRoot,'started.json')).catch(()=>null)||!manifest.schedule.some(e=>e.relativeDirectory===relativeDirectory&&manifest.sourceRoots[e.arm]===repo&&['baseline','eligible','not-ready'].includes(e.mechanismAvailability)))throw Error('SOLPI_PAIRED_HOST_LAUNCH_REQUIRED');
const entry=JSON.parse(await fs.readFile(join(dir,'entry.json'),'utf8'));
const task=tasks.find(t=>t.id===entry.taskId),source=p=>import(pathToFileURL(join(repo,p)).href);
const [{loadConfig},{createAdapter},{ToolRegistry},{createReadTool},{createEditTool},{createWriteTool},{bashTool},{AgentRuntime},{AgentSessionState},{AgentRunController},{runDesktopToolLoop},{DesktopManagedAgentSession}]=await Promise.all([
 source('src/utils/config.ts'),source('src/ai/models.ts'),source('src/ai/tools/index.ts'),source('src/ai/tools/read.ts'),source('src/ai/tools/edit.ts'),source('src/ai/tools/write.ts'),source('src/ai/tools/bash.ts'),source('src/ai/runtime/agent-runtime.ts'),source('src/ai/runtime/session.ts'),source('src/ai/runtime/controller.ts'),source('desktop/electron/desktop-services.ts'),source('desktop/electron/desktop-managed-agent-session.ts')]);
const configChunks=[];for await(const chunk of process.stdin)configChunks.push(chunk);
const frozenConfig=JSON.parse(Buffer.concat(configChunks).toString('utf8'));
const adapter=createAdapter(frozenConfig);
let adapterStreamCalls=0,firstAdapterPromptSha256=null;const originalStream=adapter.stream.bind(adapter);adapter.stream=(messages,tools,system,options)=>{adapterStreamCalls++;if(firstAdapterPromptSha256===null)firstAdapterPromptSha256=createHash('sha256').update(JSON.stringify({messages,tools,system})).digest('hex');return originalStream(messages,tools,system,options);};
const {projectDesktopToolResultForModel}=await source('desktop/electron/desktop-tool-result.ts');
const model={name:adapter.getModelName(),capabilities:adapter.getCapabilities?.()??{},harness:adapter.getHarnessProfileId?.()??null};
process.chdir(root);
const command=task.id==='code'?'node verify.cjs':null;
const verifier=task.id==='code'?`import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL('./baseline-sandbox.mjs',import.meta.url))).href)}).then(async m=>{const r=await m.sandboxEvaluate('invoice.cjs',false);if(r.verified)console.log('VISIBLE_VECTORS_PASSED:3');else{console.log('VISIBLE_VECTORS_FAILED');process.exitCode=1;}});`:null;
if(verifier)await fs.writeFile(join(root,'verify.cjs'),verifier,{mode:0o400});
const spec={root,readable:Object.keys(task.files),writable:task.id==='code'?['invoice.cjs']:task.id==='artifact'?['answer.json']:[],command};
const readFiles=new Set(),replyCapture=createFinalReplyCapture();
const runtimeSession=new AgentSessionState();let mechanism;
if(entry.arm==='candidate'&&entry.surface==='cli'&&entry.mechanismAvailability==='eligible'){
 const {resolveRuntimeModelBinding}=await source('src/ai/providers/control-plane.ts');const binding=resolveRuntimeModelBinding(frozenConfig);
 mechanism=await createPairedMechanism({sourceRoot:repo,registrationSourceRoot:manifest.sourceRoots.candidate,runDirectory:dir,workspace:root,task,session:runtimeSession,command,recipeEnvironment:manifest.recipeEnvironment,protocol:binding.protocol,profileId:adapter.getHarnessProfileId?.(),destination:{provider:binding.providerId,model:binding.wireModel,url:binding.baseUrl.replace(/\/$/,'')+'/chat/completions'}});
}
let visibleVerified=false,toolCalls=0,deniedCalls=0,registryReturned=0,bashObserved=0,recallCalls=0,recallCompleted=0;
const registry=new ToolRegistry({autoMode:true,hooksRunner:{runPreHooks:async(name,input)=>{
 replyCapture.beforeTool();
 let ok=name==='observation_read'?Boolean(mechanism)||(entry.arm==='candidate'&&entry.surface==='desktop'):allowedTool(name,input,spec);if(ok&&name!=='bash'&&name!=='observation_read'){
  try{const s=await fs.lstat(resolve(root,input.file_path));ok=s.isFile()&&!s.isSymbolicLink()&&await fs.realpath(resolve(root,input.file_path))===resolve(root,input.file_path);}catch(e){ok=name==='write'&&e.code==='ENOENT';}
 }
 if(!ok)deniedCalls++;return {ok,message:'Eval task workspace allowlist'};
},runPostHooks:async()=>[],runHooks:async()=>({ok:true})},onToolObserved:event=>{replyCapture.beforeTool();toolCalls++;if(event.toolName==='observation_read'){recallCalls++;if(event.ok&&!event.result.startsWith('Error:'))recallCompleted++;}if(event.toolName==='bash')bashObserved++;if(event.toolName==='read'&&event.ok)readFiles.add(relative(root,resolve(root,event.input.file_path)));if(event.toolName==='bash'&&event.ok&&event.result.includes('VISIBLE_VECTORS_PASSED:3'))visibleVerified=true;}},[createReadTool({cwd:root}),...(spec.writable.length?[createEditTool({cwd:root}),createWriteTool({cwd:root})]:[]),...(command?[bashTool]:[]),...(mechanism?[mechanism.recallTool]:[])]);
const executeTool=registry.executeTool.bind(registry);registry.executeTool=async(...args)=>{const result=await executeTool(...args);registryReturned++;return result;};
const prompt=`当前工作目录就是本任务的隔离目录。所有文件参数使用给定相对文件名。验收要求先用 read 成功读取下面列出的每个材料文件，再完成任务。\n${task.prompt}\n材料文件：${Object.keys(task.files).join('、')}${command?`\n验证时调用bash，workdir必须为 .，command必须逐字使用：${command}`:''}`;
await fs.writeFile(join(dir,'prompt.txt'),prompt,{mode:0o600});
const systemPrompt='完成给定工作目录内的任务，使用提供的工具读取真实材料。不要访问其他资源。遵循输出格式。代码任务只能导出同步纯函数。';
const emitRuntimeEvent=replyCapture.onDesktopEvent;
const controller=new AbortController(),deadline=Date.now()+110000,timer=setTimeout(()=>controller.abort(),110000),id=randomUUID();
process.env.XIAOK_METRICS_DIR=join(dir,'metrics');process.env.XIAOK_MODEL_RECOVERY_WINDOW_MS='0';process.env.XIAOK_TURN_TIMEOUT_MS='100000';
let execution='rejected',session,mechanismFacts={qualified:false,reason:entry.mechanismAvailability};const started=performance.now();
try{
 if(entry.surface.startsWith('cli')){
  const runtime=new AgentRuntime({adapter,registry,session:runtimeSession,...(mechanism?{observationOwner:mechanism.owner}:{}),controller:new AgentRunController(),systemPrompt,maxIterations:10,providerSurfaceKind:entry.surface==='cli'?'cli-chat-task':'cli-subagent'});
  // Keep only the final assistant message; commentary before tool execution is not the final answer.
  await runtime.run(prompt,replyCapture.onCliEvent,controller.signal);
 }else if(entry.surface==='desktop'){
  mechanismFacts=await runPairedDesktopTask({sourceRoot:repo,runDirectory:dir,workspace:root,task,command,config:frozenConfig,registry,prompt,signal:controller.signal,deadline,onRuntimeEvent:emitRuntimeEvent,candidate:entry.arm==='candidate'&&entry.mechanismAvailability==='eligible'});
 }else{
  session=new DesktopManagedAgentSession({adapter,systemPrompt,forkContext:false,getTurnContext:()=>({groupId:'eval-group',agentId:'eval-agent',turn:1,turnId:id,cwd:'.',signal:controller.signal,effectiveDeadline:deadline}),createRegistry:()=>({registry,dispose:()=>{}}),dataRoot:dir,materials:[],skillCatalog:{},emitRuntimeEvent,maxIterations:10});await session.run(prompt,controller.signal);
 }
 execution=classifyExecution(true,controller.signal.aborted,Date.now(),deadline);
}catch(error){if(error?.mechanismFacts)mechanismFacts=error.mechanismFacts;execution=classifyExecution(false,controller.signal.aborted,Date.now(),deadline);}finally{clearTimeout(timer);await session?.dispose?.();registry.dispose();if(mechanism){try{mechanismFacts=mechanism.diagnostics();}finally{mechanism.dispose();}}}
if(entry.surface==='desktop'){mechanismFacts={...mechanismFacts,recallCalls,recallCompleted};adapterStreamCalls=mechanismFacts.adapterStreamCalls??0;firstAdapterPromptSha256=mechanismFacts.firstAdapterPromptSha256??null;registryReturned=mechanismFacts.registryReturned??0;}
const wallMs=performance.now()-started,reply=replyCapture.getText();
let unchanged=true,artifact=null,hiddenVerified=false,hiddenEvaluation=null,artifactSha=null;
for(const [name,content]of Object.entries(task.files)){if(spec.writable.includes(name))continue;try{if(await safeRead(root,name)!==content)unchanged=false;}catch{unchanged=false;}}
if(verifier&&await safeRead(root,'verify.cjs').catch(()=>null)!==verifier)unchanged=false;
if(task.id==='artifact')try{artifact=await safeRead(root,'answer.json');artifactSha=createHash('sha256').update(artifact).digest('hex');}catch{}
if(task.id==='code')try{const content=await safeRead(root,'invoice.cjs');artifactSha=createHash('sha256').update(content).digest('hex');hiddenEvaluation=await sandboxEvaluate(join(root,'invoice.cjs'));hiddenVerified=hiddenEvaluation.verified;if(hiddenEvaluation.reason==='sandbox-unavailable')execution='sandbox-unavailable';}catch{}
const outcome=score(task.id,{readFiles:[...readFiles],reply,artifact,unchanged,visibleVerified,hiddenVerified,execution});
const metrics=[];for(const file of await fs.readdir(join(dir,'metrics'))){if(/^metrics-[0-9a-f-]+\.json$/.test(file)){const content=await safeRead(join(dir,'metrics'),file);const report=JSON.parse(content);metrics.push({file,sha256:createHash('sha256').update(content).digest('hex'),complete:report.complete,events:report.events});}}
const result={...entry,...outcome,mechanism:mechanismFacts,status:outcome.passed?'passed':execution==='resolved'?'failed':execution,execution,wallMs,adapterStreamCalls,firstAdapterPromptSha256,inputPromptSha256:createHash('sha256').update(prompt).digest('hex'),promptSha256:entry.surface==='desktop'?null:createHash('sha256').update(systemPrompt+'\n'+prompt).digest('hex'),reply,artifactSha,unchanged,visibleVerified,hiddenVerified,hiddenEvaluation,readFiles:[...readFiles],toolCalls,registryReturned,bashObserved,deniedCalls,model,metrics,actualCost:null,wireAttempts:mechanismFacts.wireAttempts??null};
await fs.writeFile(join(dir,'result.tmp'),JSON.stringify(result,null,2),{mode:0o600});await fs.rename(join(dir,'result.tmp'),join(dir,'result.json'));
