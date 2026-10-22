import type { PersistedSessionSnapshot } from '../../../src/ai/runtime/session-store.js';
import * as summaryScope from '../../../src/runtime/sol-pi/semantic-summary-attempt.js';
import {installProductCompoundCoordinator} from '../../../src/runtime/sol-pi/product-compound-coordinator.js';
import { afterEach, expect, it, vi } from 'vitest';
import {setImmediate as yieldEventLoop} from 'node:timers/promises';
// Let the real worker process pending IPC between synchronous product cases.
afterEach(async()=>{await yieldEventLoop();await yieldEventLoop();});
import { mkdtempSync, realpathSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { createProductObservationSubagentTool } from '../../../src/runtime/sol-pi/product-subagent-tool.js';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { holdCompoundDeletionCensus } from '../../../src/ai/runtime/session-store/compound-deletion-census.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import { parseObservationPolicyFile, createProductObservationOwner } from '../../../src/runtime/sol-pi/product-bootstrap.js';

const intentRoute=vi.hoisted(()=>({protected:false}));const intentController=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>({completionTransport:{call:intentController.call},publicationTransport:{call:intentController.call},applicationTransport:{call:intentController.call},dispose(){}})}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:any)=>intentRoute.protected?{kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...owner}}:{kind:'ordinary'}}));
import {registerProductIntentNativeFixture} from '../../support/product-intent-native-fixture.js';
import {createIntentDelegationTools} from '../../../src/ai/tools/intent-delegation.js';
import {createEmptySessionIntentLedger,SessionIntentDelegationStore} from '../../../src/runtime/intent-delegation/store.js';
const network=vi.hoisted(()=>({priceChanged:false,bodies:[] as string[],beforeSend:()=>{},finishReason:'stop' as string|null,lateError:false,toolResponse:false,summary:'Tools finished; preserve original goal and execution evidence.'}));
// Only network I/O is replaced: actual HTTPS capability, SDK, builder, official
// tokenizer, user policy, runtime boundary, store CAS and live install all run.
vi.mock('node:https',async()=>{
 const actual=await vi.importActual<typeof import('node:https')>('node:https');
 const {readFileSync}=await import('node:fs');
 const pricing=readFileSync(new URL('../../fixtures/sol-pi-deepseek-pricing-20260919.html',import.meta.url),'utf8');
 const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');
 return {...actual,request:(_url:unknown,_options:unknown,onResponse:(value:unknown)=>void)=>{
  const request=new EventEmitter() as any;request.destroy=()=>{queueMicrotask(()=>request.emit('close'));};
  request.end=(body:string)=>{
   if((_options as any).method==='GET'){
    queueMicrotask(()=>{const response=new PassThrough() as any;response.statusCode=200;response.headers={'content-type':'text/html'};response.rawHeaders=['content-type','text/html'];onResponse(response);response.end(network.priceChanged?pricing.replace('$0.3','$0.9'):pricing);});return;
   }
   network.beforeSend();network.bodies.push(body);
   queueMicrotask(()=>{
    const response=new PassThrough() as any;response.statusCode=200;response.headers={'content-type':'text/event-stream'};response.rawHeaders=['content-type','text/event-stream'];
    onResponse(response);
    const delta=network.toolResponse?{content:network.summary,tool_calls:[{index:0,id:'unexpected-summary-tool',type:'function',function:{name:'write',arguments:'{}'}}]}:{content:network.summary};
    const data='data: '+JSON.stringify({choices:[{delta,finish_reason:network.finishReason}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\n';
    if(network.lateError){response.write(data);setImmediate(()=>response.destroy(Error('controlled late summary transport failure')));}
    else response.end(data+'data: [DONE]\n\n');
   });
  };return request;
 }};
});
const cleanups:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.unstubAllGlobals();network.bodies=[];network.priceChanged=false;intentRoute.protected=false;intentController.call.mockReset();network.beforeSend=()=>{};network.finishReason='stop';network.lateError=false;network.toolResponse=false;network.summary='Tools finished; preserve original goal and execution evidence.';});
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))
.each(['success','compound','compound-intent','archived','tool-boundary','named-child','pricing-unavailable','automatic','empty','truncated','missing-terminal','late-error','tool-response','stale','revoke','settlement-failure','commit-failure'] as const)('actual Runtime semantic lifecycle: %s',async scenario=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'semantic-runtime-')));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'input.txt');writeFileSync(file,scenario==='archived'?'head '.repeat(1500)+'ARCHIVED_MIDDLE_MUST_USE_REFERENCE'+'tail '.repeat(1500):'allowed source');const expiresAt=Date.now()+240000;
 const policyFile=join(root,'policy.json');writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:file,startLine:1}],bashSources:[],...(['compound','compound-intent'].includes(scenario)?{compoundExecution:{version:1,mode:'mechanism-experiment'}}:{}),...(scenario==='named-child'?{ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:1,expiresAt,nativeTools:['read']}}:{}),semanticCompaction:{version:1,mode:scenario==='automatic'?'automatic':'mechanism-experiment',currency:'USD',maxCalls:1,maxCostUnits:50000000,maxOutputTokens:128,expiresAt,pricing:{source:'https://api-docs.deepseek.com/quick_start/pricing',model:'deepseek-flash',inputMissUnitsPerMillion:300000000,inputHitUnitsPerMillion:6000000,outputUnitsPerMillion:1200000000,validUntil:expiresAt}}}));
 const session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'semantic-runtime',cwd:root});
 if(scenario==='compound-intent'){const ledger=createEmptySessionIntentLedger('semantic-runtime',1);ledger.instanceId='actual-host';ledger.ownership={state:'owned',ownerInstanceId:'actual-host',updatedAt:1};const intentSnapshot: PersistedSessionSnapshot = {...session.exportSnapshot(),intentDelegation:ledger};session.restoreSnapshot(intentSnapshot);}
 const storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),registry=new ToolRegistry({autoMode:true},[]);cleanups.push(()=>registry.dispose());
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],permissionManager:registry.getObservationPermissionRevisionPort(),persist:value=>store.save({...value,...(scenario==='compound-intent'?{intentDelegation:store.getIntentNativeLedgerSync(value.sessionId)}:{})}),executionPersistence:{store,root:storeRoot}});cleanups.push(()=>product.dispose());
 session.appendUserText('Original exact goal: inspect only. Authorization must not expand.');
 if(scenario==='archived'){
  registry.registerTool(createReadTool({cwd:root}));registry.registerTool(product.recallTool);
  const id='archived-read';
  const content=await registry.executeTool('read',{file_path:file,max_chars:80},{...mcpTestContext(new AbortController().signal),observationCollector:product.owner.collectorFor(id),projectObservationResult:value=>product.owner.projectToolResult(id,value),observationProvenance:()=>product.owner.getResultProvenance(id)});
  product.owner.finalizeToolResult(id,content);
  session.appendAssistantBlocks([{type:'tool_use',id,name:'read',input:{file_path:file,max_chars:80}}]);session.appendUserBlocks([{type:'tool_result',tool_use_id:id,content}]);
 }

 for(let i=0;i<80;i++){
  session.appendAssistantBlocks([{type:'tool_use',id:`read-${i}`,name:'read',input:{file_path:`source-${i}.txt`,offset:1}}]);
  session.appendUserBlocks([{type:'tool_result',tool_use_id:`read-${i}`,content:`exact result ${i}`,is_error:i===3}]);
 }
 session.appendUserText('Exact correction: do not publish any artifact.');await store.save(session.exportSnapshot());
 if(scenario==='compound-intent'){await registerProductIntentNativeFixture({store,product,sessionId:'semantic-runtime',session},intentController,()=>{intentRoute.protected=true;},cleanups);for(const tool of createIntentDelegationTools({ledgerStore:new SessionIntentDelegationStore(store),sessionId:'semantic-runtime',instanceId:'actual-host'}).filter(tool=>['intent_step_update','intent_stage_artifact'].includes(tool.definition.name)))registry.registerTool(tool);}
 if(['compound','compound-intent'].includes(scenario)){session.notePublishedHistory(session.exportSnapshot(),session.getPublishedHistoryBasis());const coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry});cleanups.push(()=>coordinator!.dispose());}
 let capturedScope:summaryScope.SemanticSummaryProviderScope|undefined;
 if(['compound','compound-intent'].includes(scenario)){
  const reserve=summaryScope.reserveActiveSemanticSummaryProviderScope,consume=summaryScope.consumeSemanticSummaryProviderScope;
  const reserveSpy=vi.spyOn(summaryScope,'reserveActiveSemanticSummaryProviderScope').mockImplementation(facts=>{if(facts.logicalInvocationId.startsWith('semantic-summary:')){expect(()=>reserve({...facts,serializedBodySha256:'f'.repeat(64)})).toThrow('BINDING');expect(()=>reserve({...facts,logicalInvocationId:'another-request'})).toThrow('BINDING');}const scope=reserve(facts);if(scope)capturedScope=scope;return scope;});
  const consumeSpy=vi.spyOn(summaryScope,'consumeSemanticSummaryProviderScope').mockImplementation(scope=>{consume(scope);expect(()=>consume(scope)).toThrow('USED');expect(()=>summaryScope.inspectSemanticSummaryProviderLease({...scope},()=>{throw Error('forged scope reached lease');})).toThrow('CLOSED');});
  cleanups.push(()=>{reserveSpy.mockRestore();consumeSpy.mockRestore();});
 }
 const sessionFile=join(storeRoot,'semantic-runtime.json');
 network.beforeSend=()=>{const disk=JSON.parse(readFileSync(sessionFile,'utf8'));expect(disk.semanticCompaction.reservations).toHaveLength(1);expect(disk.semanticCompaction.reservations[0].status).toBe('dispatched');expect(disk.compactions).toHaveLength(0);};
 if(scenario==='pricing-unavailable')network.priceChanged=true;
 if(scenario==='empty')network.summary='';
 if(scenario==='truncated')network.finishReason='length';
 if(scenario==='missing-terminal')network.finishReason=null;
 if(scenario==='late-error')network.lateError=true;
 if(scenario==='tool-response'){network.toolResponse=true;network.finishReason='tool_calls';}
 if(scenario==='revoke'){const check=network.beforeSend;network.beforeSend=()=>{check();product.revoke();};}
 if(scenario==='stale'){const check=network.beforeSend;network.beforeSend=()=>{check();session.appendUserText('A correction arrived while the summary was running.');};}
 if(scenario==='settlement-failure'||scenario==='commit-failure'){
  const original=store.compareAndSave.bind(store);
  vi.spyOn(store,'compareAndSave').mockImplementation(async input=>{
   const ledger=input.nextSnapshot.semanticCompaction;
   if(scenario==='settlement-failure'&&ledger?.reservations.some(item=>item.status==='settled')||scenario==='commit-failure'&&ledger?.commits.length)throw Error('controlled durable failure');
   return original(input);
  });
 }
 let warmup=false;const warmupBodies:string[]=[];
 const requests:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{if(warmup)warmupBodies.push(init.body);else requests.push(init.body);if(scenario==='named-child'&&requests.length<=3){const delta=requests.length===1?{tool_calls:[{index:0,id:'real-child',type:'function',function:{name:'subagent',arguments:JSON.stringify({prompt:'Read the authorized input.txt and report.'})}}]}:requests.length===2?{tool_calls:[{index:0,id:'real-child-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:file})}}]}:{content:'Actual named child inspected source.'};return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:requests.length<3?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}if(scenario==='tool-boundary'&&requests.length===1)return new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'finished-child-call',type:'function',function:{name:'finished_child',arguments:'{}'}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});if(!warmup&&scenario!=='compound-intent')expect(JSON.parse(readFileSync(sessionFile,'utf8')).semanticCompaction?.commits??[]).toHaveLength(['success','compound','archived','tool-boundary','named-child'].includes(scenario)?1:0);return new Response('data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}));
 const adapter=createAdapterFromBinding({providerId:'deepseek',providerType:'first_party',modelId:'deepseek-flash',wireModel:'deepseek-flash',protocol:'openai_legacy',apiKey:'fixture',baseUrl:'https://api.deepseek.com',headers:{},capabilities:['tools']});
 if(scenario==='archived'){
  warmup=true;
  for(let i=0;i<2;i++){
   const prepared=await product.owner.prepareRequest({logicalInvocationId:`warmup-${i}`,messages:session.getMessages(),tools:registry.getToolDefinitions(),systemPrompt:'Complete the user task.',requestPreview:adapter.getObservationRequestPreview!.bind(adapter)});
   for await(const _ of adapter.stream(prepared.messages,registry.getToolDefinitions(),'Complete the user task.',{providerDisclosure:prepared.providerDisclosure})){}
  }
  warmup=false;expect(warmupBodies).toHaveLength(2);for(const body of warmupBodies)expect(body).toContain('ARCHIVED_MIDDLE_MUST_USE_REFERENCE');
 }
 const originalClosure=session.getProtectedObservationClosure();
 const outcomes:unknown[]=[];let notified=false;let runtime:AgentRuntime;
 let actualChildCompletions=0;
 if(scenario==='named-child'){registry.registerTool(createReadTool({cwd:root}));registry.registerTool(createProductObservationSubagentTool({product,parentOwner:product.owner,sourceRegistry:registry,adapter:()=>adapter,cwd:root,persist:snapshot=>store.save(snapshot),buildSystemPrompt:async()=> 'Read the authorized source.',onCompleted:()=>{actualChildCompletions++;runtime.notifySubtaskBoundary();}}));}
 if(scenario==='tool-boundary')registry.registerTool({definition:{name:'finished_child',description:'Host completion boundary fixture',inputSchema:{type:'object',properties:{},additionalProperties:false}},permission:'safe',async execute(){runtime.notifySubtaskBoundary();return 'host child terminal result';}});
 runtime=new AgentRuntime({adapter,registry,session,controller:new AgentRunController(),systemPrompt:'Complete the user task.',maxIterations:2,observationOwner:product.owner,semanticCompactionOwner:product.semanticCompactionOwner,
  onSemanticCompactionOutcome:value=>outcomes.push(value),takePendingInput:()=>{if(!notified&&!['tool-boundary','named-child'].includes(scenario)){notified=true;runtime.notifySubtaskBoundary();}return undefined;}});
 if(scenario==='revoke'){
  await expect(runtime.run('Continue.',()=>{})).rejects.toThrow();
  expect(requests).toHaveLength(0);expect(session.exportSnapshot().compactions).toHaveLength(0);
  expect((await store.load('semantic-runtime'))!.semanticCompaction!.reservations[0].status).toBe('dispatched');return;
 }
 if(scenario==='settlement-failure'||scenario==='commit-failure'){
  await expect(runtime.run('Continue.',()=>{})).rejects.toThrow('controlled durable failure');
  expect(requests).toHaveLength(0);expect(session.exportSnapshot().compactions).toHaveLength(0);
  expect((await store.load('semantic-runtime'))!.semanticCompaction!.commits).toHaveLength(0);
  expect(network.bodies).toHaveLength(1);return;
 }
 await runtime.run('Continue.',()=>{});
 const status=['success','compound','archived','tool-boundary','named-child'].includes(scenario)?'compacted':['empty','truncated','missing-terminal','late-error','tool-response'].includes(scenario)?'failed':'skipped';
 expect(outcomes).toMatchObject([{status,attempted:!['automatic','pricing-unavailable'].includes(scenario),economicAdmission:'not-passed'}]);
 if(scenario==='compound-intent'){expect(outcomes).toMatchObject([{status:'skipped',attempted:true,reason:'no_gain'}]);expect(intentController.call.mock.calls.filter(([method])=>method==='publication.observeIntentDependencies')).toHaveLength(2);}
 expect(network.bodies).toHaveLength(['automatic','pricing-unavailable'].includes(scenario)?0:1);if(network.bodies[0])expect(JSON.parse(network.bodies[0]).max_tokens).toBe(128);
 expect(requests).toHaveLength(scenario==='named-child'?4:scenario==='tool-boundary'?2:1);
 if(['compound','compound-intent'].includes(scenario)){expect(capturedScope).toBeDefined();let escapedWork=0;expect(()=>summaryScope.inspectSemanticSummaryProviderLease(capturedScope!,()=>{escapedWork++;})).toThrow('CLOSED');expect(escapedWork).toBe(0);const durable=(await store.load('semantic-runtime'))!;expect(durable.semanticCompaction!.reservations).toHaveLength(1);expect(durable.compoundOperations!.providerAttempts).toHaveLength(1);expect(durable.compoundOperations!.providerAttempts![0]).toMatchObject({transportState:'drained',rootAdmission:{rootSessionIdentity:'semantic-runtime'}});}
 if(scenario==='named-child'){expect(actualChildCompletions).toBe(1);expect(requests[3]).toContain('Actual named child inspected source.');expect(session.getProtectedObservationClosure()?.observations).toHaveLength(1);}
 if(scenario==='tool-boundary')expect(requests[1]).toContain('host child terminal result');
 expect(requests[0]).toContain('Original exact goal');expect(requests[0]).toContain('Exact correction');expect(requests[0]).toContain('exact result 3');
 if(scenario==='stale')expect(requests[0]).toContain('A correction arrived');
 const durable=(await store.load('semantic-runtime'))!;expect(durable.compactions).toHaveLength(['success','compound','archived','tool-boundary','named-child'].includes(scenario)?1:0);
 if(!['automatic','pricing-unavailable'].includes(scenario))expect(durable.semanticCompaction!.reservations[0].status).toBe(['truncated','missing-terminal','late-error','tool-response'].includes(scenario)?'unknown':'settled');
 else expect(durable.semanticCompaction).toBeUndefined();
 expect(session.exportSnapshot().compactions).toHaveLength(['success','compound','archived','tool-boundary','named-child'].includes(scenario)?1:0);
 if(scenario==='archived'){
  expect(durable.protectedObservationClosure).toEqual(originalClosure);expect(requests[0]).not.toContain('ARCHIVED_MIDDLE_MUST_USE_REFERENCE');expect(requests[0]).toContain('observation_read id=');
 }
 if(['empty','truncated','missing-terminal','late-error','tool-response'].includes(scenario)){
  expect(outcomes[0]).toMatchObject({status:'failed',reason:'summary_failed'});
  const charged=structuredClone(durable.semanticCompaction!);
  expect(charged.reservations).toHaveLength(1);expect(charged.reservations[0].maximumCostUnits).toBeGreaterThan(0);
  expect(charged.commits).toHaveLength(0);expect(charged.generation).toBe(0);
  if(scenario==='empty'){const release=holdCompoundDeletionCensus(storeRoot,durable,0);release();}
  else expect(()=>holdCompoundDeletionCensus(storeRoot,durable,0)).toThrow('session_delete_semantic_unsettled');
  notified=false;await runtime.run('Continue again.',()=>{});
  expect(outcomes.at(-1)).toMatchObject({status:'skipped',attempted:false,reason:'summary_budget_exhausted'});
  expect(network.bodies).toHaveLength(1);expect(requests).toHaveLength(2);
  expect((await store.load('semantic-runtime'))!.semanticCompaction).toEqual(charged);
 }
 if(scenario==='success'){
  notified=false;await runtime.run('Continue again.',()=>{});
  expect(outcomes.at(-1)).toMatchObject({status:'skipped',attempted:false,reason:'summary_budget_exhausted'});
  expect(network.bodies).toHaveLength(1);expect(requests).toHaveLength(2);
 }

},120000);
