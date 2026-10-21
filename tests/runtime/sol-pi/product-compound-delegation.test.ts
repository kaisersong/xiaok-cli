import {advanceDirectOperation} from '../../../src/runtime/sol-pi/compound-direct-operation.js';
import {afterEach,it,expect,vi} from 'vitest';
import {setImmediate as yieldEventLoop} from 'node:timers/promises';
// Let the real worker process pending IPC between synchronous product cases.
afterEach(async()=>{await yieldEventLoop();await yieldEventLoop();});
import {mkdtempSync,rmSync,writeFileSync,realpathSync,existsSync,readdirSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir,homedir} from 'node:os';import {randomUUID} from 'node:crypto';
import {createProductObservationOwner,parseObservationPolicyFile} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {createProductObservationSubagentTool,getProductObservationDelegationAdapter} from '../../../src/runtime/sol-pi/product-subagent-tool.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';import {ToolRegistry} from '../../../src/ai/tools/index.js';import {PermissionManager} from '../../../src/ai/permissions/manager.js';
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))('actual compound product allocates a child identity without creating a plan or allowing an unarmed runtime',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'compound-delegation-'))),storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:randomUUID(),cwd:root});
 const policyFile=join(root,'policy.json'),expiresAt=Date.now()+60000,source=join(root,'source.txt');writeFileSync(source,'explicit selected material');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'},ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:1,expiresAt,nativeTools:['read']}}));
 const permission=new PermissionManager({mode:'auto'}),registry=new ToolRegistry({permissionManager:permission},[]);
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save(s),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 const adapter=vi.fn(()=>{throw Error('runtime must not start');});
 try{
  const tool=createProductObservationSubagentTool({product,parentOwner:product.owner,sourceRegistry:registry,adapter,cwd:root,persist:s=>store.save(s),buildSystemPrompt:async()=>''});
  const port=getProductObservationDelegationAdapter(tool);expect(port).toBeDefined();
  expect(getProductObservationDelegationAdapter({...tool})).toBeUndefined();
  const allocation=port!.allocate({prompt:'child exact intent'}),child=port!.getSession(allocation);
  expect(child.exportSnapshot().sessionId).not.toBe(session.exportSnapshot().sessionId);
  expect((await store.load(child.exportSnapshot().sessionId))).toBeNull();
  expect(()=>port!.getSession({...allocation})).toThrow();
  await expect(tool.execute({prompt:'child exact intent'},{taskId:'task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'request',toolInvocationId:'tool'})).rejects.toThrow('compound_child_admission_required');
  expect(adapter).not.toHaveBeenCalled();
  port!.discard(allocation);expect(()=>port!.getSession(allocation)).toThrow();
  tool.definition.description+=' mutated';expect(getProductObservationDelegationAdapter(tool)).toBeUndefined();
 }finally{product.dispose();registry.dispose();rmSync(root,{recursive:true,force:true});}
},30000);

it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json'))).each(['success','failure','nested','write','orphan','late-orphan','late-write-orphan','late-parent-unknown','late-write-parent-unknown'] as const)('actual product parent delegation installs independent child journal before SDK and settles only after child drain (%s)',async(scenario)=>{
 const failedSDK=scenario==='failure',depth=scenario==='nested'?2:1;
 const root=realpathSync(mkdtempSync(join(tmpdir(),'compound-delegation-'))),storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:randomUUID(),cwd:root});
 const policyFile=join(root,'policy.json'),expiresAt=Date.now()+60000,source=join(root,'source.txt');writeFileSync(source,'explicit selected material');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'},ordinaryChildren:{enabled:true,maxDepth:depth,maxChildren:depth,expiresAt,nativeTools:['write','orphan','late-write-orphan','late-write-parent-unknown'].includes(scenario)?['read','write']:['read']}}));
 const permission=new PermissionManager({mode:'auto'}),registry=new ToolRegistry({permissionManager:permission},[]);
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save(s),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 const {OpenAIAdapter}=await import('../../../src/ai/adapters/openai.js');
 const {buildOpenAIHarnessContext,resolveKimiHarnessFeatureFlags}=await import('../../../src/ai/providers/model-harness-profile.js');
 const {withObservationExecutionOwner}=await import('../../../src/runtime/sol-pi/observation-execution-scope.js');
 const {installProductCompoundCoordinator}=await import('../../../src/runtime/sol-pi/product-compound-coordinator.js');
 const {buildToolList}=await import('../../../src/ai/tools/index.js');for(const tool of buildToolList(undefined,{cwd:root}).filter(t=>['read','write'].includes(t.definition.name)))registry.registerTool(tool);const target=join(root,'child-write.txt');
 const adapter=new OpenAIAdapter({apiKey:'test-only',kimiCodingHeadersApplied:false,harnessContext:buildOpenAIHarnessContext({identity:{providerId:'deepseek',providerType:'custom',protocol:'openai_legacy',canonicalBaseUrl:'https://api.deepseek.com',wireModel:'deepseek-flash',capabilities:['tools']},flags:resolveKimiHarnessFeatureFlags({})})});
 const requestBodies:unknown[]=[];let calls=0;const raw=vi.fn(async(_url,init)=>{requestBodies.push(JSON.parse(init.body));
  const snapshots=readdirSync(storeRoot).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(join(storeRoot,n),'utf8')));
  const parent=snapshots.find(s=>s.sessionId===session.exportSnapshot().sessionId),child=snapshots.find(s=>s.sessionId!==parent.sessionId&&s.compoundOperations?.providerAttempts?.some((r:any)=>r.transportState==='reserved'));
  expect(parent.compoundOperations.directOperations[0]).toMatchObject({stage:'started',delegation:{childPhase:'running'}});
  expect(snapshots.filter(s=>s.compoundOperations?.directOperations?.some((r:any)=>r.delegation?.childSessionIdentity===child.sessionId&&r.stage==='started'))).toHaveLength(1);
  expect(child.compoundOperations.providerAttempts.filter((r:any)=>r.transportState==='reserved')).toHaveLength(1);
  if(failedSDK){calls++;return new Response(JSON.stringify({error:{message:'explicit fixture API failure'}}),{status:400,headers:{'content-type':'application/json'}});}
  calls++;
  if(scenario==='orphan'&&calls===1)await store.save({...session.exportSnapshot(),sessionId:'unregistered-prior-domain',compoundOperations:undefined,executionProtected:undefined});
  const delta=scenario==='nested'&&calls===1?{tool_calls:[{index:0,id:'nested-child',type:'function',function:{name:'subagent',arguments:JSON.stringify({prompt:'read explicit material in a nested child'})}}]}:
   calls===(scenario==='nested'?2:1)?{tool_calls:[{index:0,id:'child-native',type:'function',function:['write','orphan','late-write-orphan','late-write-parent-unknown'].includes(scenario)?{name:'write',arguments:JSON.stringify({file_path:target,content:'real child mutation'})}:{name:'read',arguments:JSON.stringify({file_path:source})}}]}:{content:'child completed'};
  return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:'tool_calls'in delta?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 });vi.stubGlobal('fetch',raw);let coordinator:Awaited<ReturnType<typeof installProductCompoundCoordinator>>;
 try{
  const tool=createProductObservationSubagentTool({product,parentOwner:product.owner,sourceRegistry:registry,adapter:()=>adapter,cwd:root,persist:s=>store.save(s),buildSystemPrompt:async()=>'Use the read tool once then finish.'});registry.registerTool(tool);
  coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry});
  if(scenario==='late-write-orphan'){const original=store.compareAndSave.bind(store);let injected=false;vi.spyOn(store,'compareAndSave').mockImplementation(async request=>{const result=await original(request);if(!injected&&request.nextSnapshot.sessionId!==session.exportSnapshot().sessionId&&request.nextSnapshot.compoundOperations?.directOperations?.some(row=>row.stage==='started'&&row.fileFacts)){injected=true;await store.save({...session.exportSnapshot(),sessionId:'late-write-domain',compoundOperations:undefined,executionProtected:undefined});}return result;});}
  if(scenario==='late-orphan'){const original=store.compareAndSave.bind(store);let injected=false;vi.spyOn(store,'compareAndSave').mockImplementation(async request=>{const result=await original(request);if(!injected&&request.nextSnapshot.sessionId===session.exportSnapshot().sessionId&&request.nextSnapshot.compoundOperations?.treeBudget?.allocations.some(row=>row.recordKind==='provider')){injected=true;await store.save({...session.exportSnapshot(),sessionId:'late-unregistered-domain',compoundOperations:undefined,executionProtected:undefined});}return result;});}
  if(scenario==='late-parent-unknown'||scenario==='late-write-parent-unknown'){
   const original=store.compareAndSave.bind(store);let injected=false;
   vi.spyOn(store,'compareAndSave').mockImplementation(async request=>{
    const result=await original(request),isRoot=request.nextSnapshot.sessionId===session.exportSnapshot().sessionId;
    const ready=scenario==='late-parent-unknown'?isRoot&&request.nextSnapshot.compoundOperations?.treeBudget?.allocations.some(row=>row.recordKind==='provider'):!isRoot&&request.nextSnapshot.compoundOperations?.directOperations?.some(row=>row.stage==='started'&&row.fileFacts);
    if(!injected&&ready){injected=true;const path=join(storeRoot,`${session.exportSnapshot().sessionId}.json`),snapshot=JSON.parse(readFileSync(path,'utf8'));
     snapshot.compoundOperations=advanceDirectOperation(snapshot.compoundOperations,snapshot.compoundOperations.directOperations[0].id,{stage:'outcome_unknown',outcome:'unknown'});
     // A previously captured view of the same existing pathname is insufficient.
     // Model an old cooperative writer's durable bytes, without adding a file.
     writeFileSync(path,JSON.stringify(snapshot));
    }return result;
   });
  }
  const result=await withObservationExecutionOwner(product.owner,()=>registry.executeTool('subagent',{prompt:'read explicit material'},{taskId:'task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'parent-request',toolInvocationId:'parent-call'})).catch(error=>{if(scenario==='late-parent-unknown'||scenario==='late-write-parent-unknown')return String(error);throw error;});
  if(scenario==='late-parent-unknown'||scenario==='late-write-parent-unknown'){
   expect(existsSync(target)).toBe(false);expect(calls).toBe(scenario==='late-parent-unknown'?0:1);expect(result).toContain('Error:');
   expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0].stage).toBe('outcome_unknown');return;
  }
  if(scenario==='orphan'||scenario==='late-orphan'||scenario==='late-write-orphan'){expect(existsSync(target),'existing child must not mutate after an unregistered canonical session appears').toBe(false);expect(calls).toBe(scenario==='late-orphan'?0:1);expect(result).toContain('Error:');session.appendUserToolResults([{type:'tool_result',tool_use_id:'parent-call',content:result}]);await coordinator!.publishCurrentHistory();return;}
  expect(result).toContain(failedSDK?'Error:':'child completed');expect(calls).toBe(failedSDK?1:depth*2);
  if(scenario==='write'){expect(existsSync(target),JSON.stringify(requestBodies)).toBe(true);expect(readFileSync(target,'utf8')).toBe('real child mutation');}
  expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0]).toMatchObject({stage:'started',delegation:{state:'closed',childPhase:'drained'}});
  await expect(coordinator!.publishCurrentHistory()).rejects.toThrow('compound_batch_not_published');
  const sibling=join(root,'forbidden-sibling.txt');
  expect(await registry.executeTool('write',{file_path:sibling,content:'must not run'},{taskId:'task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'other-request',toolInvocationId:'other-call'}).catch(error=>String(error))).toMatch(/unknown|unpublished/);expect(existsSync(sibling)).toBe(false);
  session.appendUserToolResults([{type:'tool_result',tool_use_id:'parent-call',content:result}]);await coordinator!.publishCurrentHistory();
  const record=(await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0];
  expect(record).toMatchObject({stage:'settled',outcome:failedSDK?'failed':'completed',quiescence:'delegated_tree',delegation:{state:'closed',childPhase:'drained'}});
  const child=(await store.load(record.delegation!.childSessionIdentity))!;
  expect(child.compoundOperations!.providerAttempts).toHaveLength(failedSDK?1:2);
  if(scenario==='nested')expect(child.compoundOperations!.directOperations![0]).toMatchObject({stage:'settled',quiescence:'delegated_tree'});
  if(!failedSDK&&scenario!=='write')expect((await store.load(session.exportSnapshot().sessionId))!.protectedObservationClosure?.observations).toHaveLength(1);
  if(scenario==='write')expect(child.compoundOperations!.directOperations![0]).toMatchObject({stage:'settled',quiescence:'synchronous_file'});expect(child.compoundOperations!.providerAttempts!.every(r=>r.transportState==='drained')).toBe(true);
  await coordinator!.dispose();
 }finally{vi.unstubAllGlobals();await coordinator?.dispose();product.dispose();registry.dispose();rmSync(root,{recursive:true,force:true});}
},30000);

it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json')))('compound product cancels pending child permission evaluation before it resolves, without creating a child runtime',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'compound-delegation-'))),storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:randomUUID(),cwd:root});
 const policyFile=join(root,'policy.json'),expiresAt=Date.now()+60000,source=join(root,'source.txt');writeFileSync(source,'explicit selected material');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'},ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:1,expiresAt,nativeTools:['read']}}));
 let answer!:(v:boolean)=>void,entered!:()=>void;const asked=new Promise<void>(r=>entered=r);
 const permission=new PermissionManager({mode:'default'}),registry=new ToolRegistry({permissionManager:permission},[]);
 const check=permission.check.bind(permission);let firstCheck=true;vi.spyOn(permission,'check').mockImplementation(async(...args)=>{if(firstCheck){firstCheck=false;entered();await new Promise<boolean>(r=>answer=r);}return check(...args);});
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save(s),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 const adapter=vi.fn(()=>{throw Error('runtime must not start');});
 const {installProductCompoundCoordinator}=await import('../../../src/runtime/sol-pi/product-compound-coordinator.js');let coordinator:Awaited<ReturnType<typeof installProductCompoundCoordinator>>;
 try{
  const tool=createProductObservationSubagentTool({product,parentOwner:product.owner,sourceRegistry:registry,adapter,cwd:root,persist:s=>store.save(s),buildSystemPrompt:async()=>''});registry.registerTool(tool);
  coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry});
  const pending=registry.executeTool('subagent',{prompt:'must never start'},{taskId:'task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'request',toolInvocationId:'tool'}).catch(error=>String(error));await asked;
  let disposed=false;const draining=coordinator!.dispose().then(()=>{disposed=true;});
  await new Promise(r=>setTimeout(r,40));const beforeAnswer=disposed;answer(true);await draining;await pending;
  expect(beforeAnswer).toBe(true);expect(adapter).not.toHaveBeenCalled();
  expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0]).toMatchObject({stage:'settled',outcome:'cancelled'});
 }finally{await coordinator?.dispose();product.dispose();registry.dispose();rmSync(root,{recursive:true,force:true});}
},30000);


it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(environmentRoot,'manifest.json'))).each(['before','after'] as const)('compound child final admission failure settles only the original never-started prepared row (%s commit)',async faultPoint=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'compound-delegation-'))),storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:randomUUID(),cwd:root});
 const policyFile=join(root,'policy.json'),expiresAt=Date.now()+60000,source=join(root,'source.txt');writeFileSync(source,'explicit selected material');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt,readFileScopes:[{filePath:source,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'},ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:1,expiresAt,nativeTools:['read']}}));
 const permission=new PermissionManager({mode:'auto'}),registry=new ToolRegistry({permissionManager:permission},[]);
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save(s),permissionManager:permission,executionPersistence:{store,root:storeRoot}});
 const adapter=vi.fn(()=>{throw Error('runtime must not start');});
 const {installProductCompoundCoordinator}=await import('../../../src/runtime/sol-pi/product-compound-coordinator.js');let coordinator:Awaited<ReturnType<typeof installProductCompoundCoordinator>>;
 try{
  const tool=createProductObservationSubagentTool({product,parentOwner:product.owner,sourceRegistry:registry,adapter,cwd:root,persist:s=>store.save(s),buildSystemPrompt:async()=>''});registry.registerTool(tool);
  coordinator=await installProductCompoundCoordinator({product,session,store,root:storeRoot,registry});
  const original=store.compareAndSave.bind(store);let fault=true;
  vi.spyOn(store,'compareAndSave').mockImplementation(async input=>{
   if(fault&&input.nextSnapshot.compoundOperations?.directOperations?.some(row=>row.stage==='started')){fault=false;if(faultPoint==='after')await original(input);throw Error('injected final admission unavailable');}
   return original(input);
  });
  await registry.executeTool('subagent',{prompt:'must never start'},{taskId:'task',session:session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'request',toolInvocationId:'tool'}).catch(()=>{});
  expect(fault).toBe(false);expect(adapter).not.toHaveBeenCalled();
  expect((await store.load(session.exportSnapshot().sessionId))!.compoundOperations!.directOperations![0]).toMatchObject(faultPoint==='before'?{stage:'settled',outcome:'invalid'}:{stage:'started',outcome:null,delegation:{childPhase:'not_started'}});
 }finally{await coordinator?.dispose();product.dispose();registry.dispose();rmSync(root,{recursive:true,force:true});}
},30000);
