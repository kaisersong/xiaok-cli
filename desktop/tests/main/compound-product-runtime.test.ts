// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {tmpdir,homedir} from 'node:os';
import {buildToolList,ToolRegistry} from '../../../src/ai/tools/index.js';
import {createAdapterFromBinding} from '../../../src/ai/models.js';
import {parseObservationPolicyFile} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {DesktopTaskObservationStore,desktopObservationSessionId} from '../../../src/runtime/task-host/protected-observation-store.js';
import {createDesktopProductObservationBinding} from '../../electron/desktop-observation-owner.js';
import {runDesktopToolLoop} from '../../electron/desktop-services.js';
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json'))).each(['success','history-save-failure'] as const)
('actual Desktop SDK compound write respects the durable history barrier: %s',async scenario=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-compound-'))),source=join(root,'source.txt'),output=join(root,'output.txt');writeFileSync(source,'source');
 const policyFile=join(root,'policy.json');writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+120000,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const registry=new ToolRegistry({autoMode:true},buildToolList(undefined,{cwd:root})),sidecar=new DesktopTaskObservationStore(join(root,'tasks')),taskId='compound-desktop';
 const persistence=sidecar.getExecutionPersistence(taskId,()=>{});
  let rejectedHistory=false;
  // The canonical tree uses the unique actual FileSessionStore, not the
  // wrapper facade returned by a per-task routing port.
  const originalCompare=FileSessionStore.prototype.compareAndSave;
  const compareSpy=scenario==='history-save-failure'?vi.spyOn(FileSessionStore.prototype,'compareAndSave').mockImplementation(async function(this:FileSessionStore,input){
    if(input.nextSnapshot.sessionId===desktopObservationSessionId(taskId)&&input.nextSnapshot.messages.some(message=>Array.isArray(message.content)&&message.content.some(block=>block.type==='tool_result'))){rejectedHistory=true;throw Error('injected durable full-batch write failure');}
    return originalCompare.call(this,input);
  }):undefined;
  const executionPersistence=persistence;
 let product:Awaited<ReturnType<typeof createDesktopProductObservationBinding>>|undefined;let protectedPublications=0;
 try{
  product=await createDesktopProductObservationBinding({taskId,cwd:root,policy:parseObservationPolicyFile(policyFile),sourceRegistry:registry,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true,persist:async value=>{if(!sidecar.publishCanonicalFacts(taskId,value))await sidecar.persistSession(taskId,value);if(value.protectedObservationClosure?.observations.length)protectedPublications++;},executionPersistence});
  const canonicalStore=new FileSessionStore(join(root,'compound-sessions'));
  expect((await canonicalStore.load(desktopObservationSessionId(taskId)))?.sessionId).toBe(desktopObservationSessionId(taskId));
  await expect(persistence.store.load(desktopObservationSessionId(taskId))).rejects.toThrow('session_alias_read_only');
  let calls=0;
  vi.stubGlobal('fetch',vi.fn(async()=>{
   calls++;
   if(calls===1)return new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'actual-write',type:'function',function:{name:'write',arguments:JSON.stringify({file_path:output,content:'desktop-native-written'})}},{index:1,id:'actual-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:source})}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
   expect(protectedPublications).toBeGreaterThan(0);
   const durable=await canonicalStore.load(desktopObservationSessionId(taskId));
   expect(durable!.compoundOperations!.directOperations).toHaveLength(1);
   expect(JSON.stringify(durable!.messages)).toContain('Create the requested file.');
   expect(durable!.messages.some(message=>Array.isArray(message.content)&&message.content.some(block=>block.type==='tool_result'))).toBe(true);
   expect(durable!.compoundOperations!.directOperations![0]).toMatchObject({stage:'settled',outcome:'completed',quiescence:'synchronous_file'});
   return new Response('data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  }));
  const adapter=createAdapterFromBinding({providerId:'deepseek',providerType:'first_party',modelId:'deepseek-flash',wireModel:'deepseek-flash',protocol:'openai_legacy',apiKey:'fixture',baseUrl:'https://api.deepseek.com',headers:{},capabilities:['tools']});
  const running=runDesktopToolLoop({observationBinding:product.binding,adapter,registry:product.registry,systemPrompt:'Write exactly once.',messages:[{role:'user',content:[{type:'text',text:'Create the requested file.'}]}],allToolDefs:product.registry.getToolDefinitions(),signal:new AbortController().signal,taskDeadline:Date.now()+90000,
   sessionId:'desktop-session',turnId:'turn',intentId:'intent',stepId:'step',taskId,materials:[],emitRuntimeEvent:async()=>{},skillInvocation:null,skillCatalog:{} as never,dataRoot:root,taskStartTime:Date.now(),maxIterations:2,
   strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:value=>value,processToolResult:value=>value,trackAutoProgress:false,trackReferenceReads:false}});
  if(scenario==='history-save-failure'){
   await expect(running).rejects.toThrow('injected durable full-batch write failure');
   expect(rejectedHistory).toBe(true);expect(calls).toBe(1);
   const durable=await canonicalStore.load(desktopObservationSessionId(taskId));
   expect(durable!.compoundOperations!.directOperations![0]).toMatchObject({stage:'settled',outcome:'completed'});
   expect(durable!.messages.some(message=>Array.isArray(message.content)&&message.content.some(block=>block.type==='tool_result'))).toBe(false);
  }else{await running;expect(calls).toBe(2);}
  expect(readFileSync(output,'utf8')).toBe('desktop-native-written');
  expect(product.diagnostics().compound).toMatchObject({completedOperations:1,unknownOperations:0,validation:'not_started'});
 }finally{vi.unstubAllGlobals();try{await product?.dispose();}finally{compareSpy?.mockRestore();registry.dispose();rmSync(root,{recursive:true,force:true});}}
},120000);
