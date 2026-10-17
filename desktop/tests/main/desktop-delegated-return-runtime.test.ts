// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,realpathSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {createReadTool} from '../../../src/ai/tools/read.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createAdapterFromBinding} from '../../../src/ai/models.js';
import {parseObservationPolicyFile} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {createProductObservationSubagentTool} from '../../../src/runtime/sol-pi/product-subagent-tool.js';
import {DesktopTaskObservationStore,desktopObservationSessionId} from '../../../src/runtime/task-host/protected-observation-store.js';
import {createDesktopProductObservationBinding,requireDesktopProductHost} from '../../electron/desktop-observation-owner.js';
import {runDesktopToolLoop} from '../../electron/desktop-services.js';
const cleanup:Array<()=>unknown>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.unstubAllGlobals();});
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json'))).each([false,true])('actual Desktop batch durable return publication (failure=%s) precedes its next SDK request',async failPublication=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'desktop-child-return-')));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'input.txt');writeFileSync(file,'Actual authorized child evidence');const policyFile=join(root,'policy.json');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+240000,readFileScopes:[{filePath:file,startLine:1}],bashSources:[],ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:2,expiresAt:Date.now()+200000,nativeTools:['read']}}));
 const taskId='desktop-child-return',store=new DesktopTaskObservationStore(join(root,'tasks')),children=new FileSessionStore(join(root,'children'));
 const base=new ToolRegistry({autoMode:true});cleanup.push(()=>base.dispose());base.registerTool(createReadTool({cwd:root}));
 const live=await createDesktopProductObservationBinding({taskId,cwd:root,policy:parseObservationPolicyFile(policyFile),sourceRegistry:base,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true,persist:async s=>{if(failPublication&&JSON.stringify(s.messages).includes('Child completed the real read.'))throw Error('controlled parent batch persistence failure');await store.persistSession(taskId,s);},executionPersistence:store.getExecutionPersistence(taskId,()=>{})});cleanup.push(()=>live.dispose());
 const {product,session}=requireDesktopProductHost(live.binding);session.appendUserText('Use a child to read the authorized input.');
 let adapter:ReturnType<typeof createAdapterFromBinding>;
 let completed=0;live.registry.registerTool(createProductObservationSubagentTool({product,parentOwner:product.owner,sourceRegistry:live.registry,adapter:()=>adapter,cwd:root,persist:s=>children.save(s),buildSystemPrompt:async()=> 'Read the authorized file.',onCompleted:()=>{completed++;live.notifySubtaskBoundary();}}));
 live.registry.setAllowedTools(['read','observation_read','subagent']);
 const requests:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  requests.push(init.body);const count=requests.length;
  if(count===4){const disk=await store.getExecutionPersistence(taskId,()=>{}).store.load(desktopObservationSessionId(taskId));expect(JSON.stringify(disk!.messages)).toContain('Child completed the real read.');expect(disk!.protectedObservationClosure!.observations).toHaveLength(1);}
  const delta=count===1?{tool_calls:[{index:0,id:'parent-child',type:'function',function:{name:'subagent',arguments:JSON.stringify({prompt:'Read input.txt.'})}}]}:count===2?{tool_calls:[{index:0,id:'child-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:file})}}]}:{content:count===3?'Child completed the real read.':'Parent complete.'};
  return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:count<=2?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 }));
 adapter=createAdapterFromBinding({providerId:'deepseek',providerType:'first_party',modelId:'deepseek-flash',wireModel:'deepseek-flash',protocol:'openai_legacy',apiKey:'fixture',baseUrl:'https://api.deepseek.com',headers:{},capabilities:['tools']});
 const running=runDesktopToolLoop({observationBinding:live.binding,adapter,registry:live.registry,systemPrompt:'Complete with a child.',messages:session.getMessages(),allToolDefs:live.registry.getToolDefinitions(),signal:new AbortController().signal,taskDeadline:Date.now()+90000,sessionId:'desktop-session',turnId:'turn',intentId:'intent',stepId:'step',taskId,materials:[],emitRuntimeEvent:async()=>{},skillInvocation:null,skillCatalog:{} as never,dataRoot:root,taskStartTime:Date.now(),maxIterations:2,strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:v=>v,processToolResult:v=>v,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}});
 if(failPublication){await expect(running).rejects.toThrow('controlled parent batch persistence failure');expect(completed).toBe(1);expect(requests).toHaveLength(3);expect(JSON.stringify(session.getMessages())).toContain('Child completed the real read.');return;}
 await running;expect(completed).toBe(1);expect(requests).toHaveLength(4);expect(requests[3]).toContain('Child completed the real read.');expect(session.getProtectedObservationClosure()!.observations).toHaveLength(1);
},90000);
