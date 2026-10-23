// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
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
const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.unstubAllGlobals();network.bodies=[];network.beforeSend=()=>{};});
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))
('actual Desktop loop boundary sends one bounded SDK summary, commits CAS, and uses exact packed anchors in its next request',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'semantic-runtime-')));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'input.txt');writeFileSync(file,'allowed source');const expiresAt=Date.now()+240000;
 const policyFile=join(root,'policy.json');writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:file,startLine:1}],bashSources:[],semanticCompaction:{version:1,mode:'mechanism-experiment',currency:'USD',maxCalls:1,maxCostUnits:50000000,maxOutputTokens:128,expiresAt,pricing:{source:'https://api-docs.deepseek.com/quick_start/pricing',model:'deepseek-flash',inputMissUnitsPerMillion:300000000,inputHitUnitsPerMillion:6000000,outputUnitsPerMillion:1200000000,validUntil:expiresAt}}}));
 const taskId='semantic-desktop',sidecar=new DesktopTaskObservationStore(join(root,'tasks'));
 const registry=new ToolRegistry({autoMode:true},[]);cleanups.push(()=>registry.dispose());
 const persistence=sidecar.getExecutionPersistence(taskId,()=>{});
 const product=await createDesktopProductObservationBinding({taskId,cwd:root,policy:parseObservationPolicyFile(policyFile),sourceRegistry:registry,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true,persist:value=>sidecar.persistSession(taskId,value),executionPersistence:persistence});cleanups.push(()=>product.dispose());
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
},120000);

it.each(['stable','new-input'] as const)('actual managed group semantic boundary: %s',async(mode)=>{
 if(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))throw Error('actual product capacity environment required');
 const {DesktopMultiAgentStore}=await import('../../electron/desktop-multi-agent-store.js');
 const {DesktopExecutionCoordinator}=await import('../../electron/desktop-execution-coordinator.js');
 const {DesktopMultiAgentService}=await import('../../electron/desktop-multi-agent-service.js');
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 const {FileTaskSnapshotStore}=await import('../../../src/runtime/task-host/snapshot-store.js');
 const {MaterialRegistry}=await import('../../../src/runtime/task-host/material-registry.js');
 const {createDesktopProductObservationGroup}=await import('../../electron/desktop-observation-group.js');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'semantic-managed-')));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));cleanups.push(()=>store.close());
 const service=new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),createSession:async()=>{throw Error('no child requested');}});
 cleanups.push(()=>service.dispose());service.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});
 const source=join(root,'source.txt');writeFileSync(source,'source');const expiry=Date.now()+180000,policyFile=join(root,'policy.json');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:expiry,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:1,expiresAt:expiry,nativeTools:['read']},semanticCompaction:{version:1,mode:'mechanism-experiment',currency:'USD',maxCalls:1,maxCostUnits:50000000,maxOutputTokens:128,expiresAt:expiry,pricing:{source:'https://api-docs.deepseek.com/quick_start/pricing',model:'deepseek-flash',inputMissUnitsPerMillion:300000000,inputHitUnitsPerMillion:6000000,outputUnitsPerMillion:1200000000,validUntil:expiry}}}));
 const base=new ToolRegistry({autoMode:true},[]);cleanups.push(()=>base.dispose());
 const snapshots=new FileTaskSnapshotStore(join(root,'tasks'));let failure:unknown,finished=false;
 const requests:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{requests.push(String(init?.body));return new Response('data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}));
 const adapter=createAdapterFromBinding({providerId:'deepseek',providerType:'first_party',modelId:'deepseek-flash',wireModel:'deepseek-flash',protocol:'openai_legacy',apiKey:'fixture',baseUrl:'https://api.deepseek.com',headers:{},capabilities:['tools']});
 const host=new InProcessTaskRuntimeHost({snapshotStore:snapshots,groupObservationSource:service,
  materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1048576}),
  authorizePreparation:(taskId,marker)=>service.assertHostPreparation(taskId,marker),assertTaskAdmission:snapshot=>service.assertHostAdmission(snapshot),
  decideCancellation:(snapshot,reason)=>service.decideHostCancellation(snapshot,reason),getExecutionPolicy:()=>({deliveryRepair:'explicit'}),
  runner:input=>service.runRoot(input,async context=>{
   try{
    const group=await createDesktopProductObservationGroup({service,host,context,observationStore:snapshots.observations,taskId:input.taskId,cwd:root,
     policy:parseObservationPolicyFile(policyFile),sourceRegistry:base,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],permissionMode:'auto',onPrompt:async()=>true});
    cleanups.push(()=>group.dispose());
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
  })});
 cleanups.push(()=>host.drain());await service.initialize(host);
 const prepared=await service.prepareRoot(host,'thread',{prompt:'Run actual managed summary',materials:[]});await host.startTask(prepared.taskId);await host.drain();
 expect(failure,(failure as Error|undefined)?.stack).toBeUndefined();expect(finished).toBe(true);
},120000);
