import {afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';import {homedir,tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
const route=vi.hoisted(()=>({protected:false}));
const controller=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>({completionTransport:{call:controller.call},publicationTransport:{call:controller.call},applicationTransport:{call:controller.call},dispose(){}})}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:any)=>route.protected?{kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...owner}}:{kind:'ordinary'}}));
// Explicit tokenizer/capacity qualification leaf for bounded HTTP evidence.
// Product owner, original counter/Store, issuer, body binding and transport remain real.
vi.mock('../../../src/runtime/sol-pi/capacity-admission.js',async original=>{const actual=await original<typeof import('../../../src/runtime/sol-pi/capacity-admission.js')>();return {...actual,resolveProductionCapacityProfile:(input:any)=>actual.createTestOnlyCapacityProfile({destination:input.destination,model:input.model,windowTokens:10000000,outputLimitField:'max_tokens',defaultOutputTokens:8192,safetyMarginTokens:1024,countSerializedInput:serialized=>Buffer.byteLength(serialized,'utf8')})};});
import {parseObservationPolicyFile,createProductObservationOwner} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {installProductCompoundCoordinator} from '../../../src/runtime/sol-pi/product-compound-coordinator.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';import {PermissionManager} from '../../../src/ai/permissions/manager.js';
import {createIntentDelegationTools} from '../../../src/ai/tools/intent-delegation.js';
import {createIntentPlan} from '../../../src/ai/intent-delegation/planner.js';
import {SessionIntentDelegationStore,createEmptySessionIntentLedger,appendIntentToLedger} from '../../../src/runtime/intent-delegation/store.js';
const cleanup:Array<()=>unknown>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();route.protected=false;controller.call.mockReset();});
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
const qualified=process.platform==='darwin'&&process.arch==='arm64'&&existsSync(join(environmentRoot,'manifest.json'));
async function fixture(children=false){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'product-intent-registry-')));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'source'),policyFile=join(root,'policy.json');writeFileSync(file,'original');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:file,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'},...(children?{ordinaryChildren:{enabled:true,maxDepth:1,maxChildren:1,expiresAt:Date.now()+60000,nativeTools:['read']}}:{})}));
 const storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),ledgerStore=new SessionIntentDelegationStore(store),session=new AgentSessionState(),sessionId=randomUUID();
 const planned=createIntentPlan({sessionId,instanceId:'actual-host',input:'写一份报告',skills:[]});if(planned.kind!=='plan')throw Error('fixture_plan');
 const ledger=appendIntentToLedger(createEmptySessionIntentLedger(sessionId,1),planned.plan,1);ledger.instanceId='actual-host';ledger.ownership={state:'owned',ownerInstanceId:'actual-host',updatedAt:1};
 session.restoreSnapshot({...session.exportSnapshot(),sessionId,cwd:root,intentDelegation:ledger});await store.save(session.exportSnapshot());
 const permission=new PermissionManager({mode:'auto'});
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save({...s,intentDelegation:store.getIntentNativeLedgerSync(sessionId)}),permissionManager:permission,executionPersistence:{store,root:storeRoot}});cleanup.push(()=>product.dispose());
 const tools=createIntentDelegationTools({ledgerStore,sessionId,instanceId:'actual-host'}).filter(t=>['intent_step_update','intent_stage_artifact'].includes(t.definition.name));
 const base=new ToolRegistry({permissionManager:permission},[]);cleanup.push(()=>base.dispose());
 return {root,storeRoot,store,ledgerStore,session,sessionId,product,permission,tools,base};
}

import * as admissions from '../../../src/runtime/sol-pi/compound-provider-admission.js';
it.skipIf(!qualified)('actual product provider issuer refuses a protected active Intent without original native contract',async()=>{
 const f=await fixture(),registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 // Diagnostic capture of the actual issuer installed by the product factory.
 // No callback, response DTO or reconstructed capability is substituted.
 const original=admissions.getProviderAncestorAdmissionBinding;let binding:admissions.ProviderAncestorAdmissionBinding|undefined;
 const spy=vi.spyOn(admissions,'getProviderAncestorAdmissionBinding').mockImplementation(cap=>{const actual=original(cap);binding=actual;return actual;});
 try{const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());}finally{spy.mockRestore();}
 route.protected=true;expect(binding).toBeDefined();
 const facts={logicalInvocationId:'actual-protected-provider',attemptIndex:0,serializedBodySha256:'a'.repeat(64),destination:{provider:'deepseek',model:'deepseek-flash',url:'https://api.deepseek.com/chat/completions'},closureDigest:'b'.repeat(64)};
 const result=await binding!.reserve(facts).then(async ticket=>{await binding!.settle(ticket,'cancelled_before_send');return {issued:true};},error=>({error:String(error)}));
 expect(result).toMatchObject({error:expect.stringMatching(/intent_/)});
},30000);

import {createProviderDisclosureFetch} from '../../../src/runtime/sol-pi/provider-disclosure.js';
it.skipIf(!qualified)('actual product disclosure reaches no HTTP for an unregistered protected Intent',async()=>{
 const f=await fixture(),registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());route.protected=true;
 const prepared=await f.product.owner.prepareRequest({logicalInvocationId:'actual-protected-http',messages:[],tools:[],systemPrompt:''}),raw=vi.fn(async()=>new Response('actual fixture HTTP reply'));
 const result=await createProviderDisclosureFetch(prepared.providerDisclosure!,raw)('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',messages:[]})}).then(async response=>({sent:await response.text()}),error=>({error:String(error)}));
 expect(result).toEqual({error:'Error: SOL_PI_TRANSPORT_AUTHORIZATION_REJECTED'});expect(raw).not.toHaveBeenCalled();
},30000);

import {registerProductIntentNativeFixture} from '../../support/product-intent-native-fixture.js';
const registerNative=(f:Awaited<ReturnType<typeof fixture>>)=>registerProductIntentNativeFixture(f,controller,()=>{route.protected=true;},cleanup);
it.skipIf(!qualified)('actual product first-stage sends with all native subjects enrolled and no future publication',async()=>{
 const f=await fixture();const native=await registerNative(f),registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const prepared=await f.product.owner.prepareRequest({logicalInvocationId:'native-first-http',messages:[],tools:[],systemPrompt:''}),raw=vi.fn(async()=>new Response('actual original HTTP response'));
 const response=await createProviderDisclosureFetch(prepared.providerDisclosure!,raw)('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',messages:[]})});expect(await response.text()).toBe('actual original HTTP response');expect(raw).toHaveBeenCalledOnce();
 expect(controller.call.mock.calls.filter(([method])=>method==='publication.observeIntentDependencies')).toHaveLength(1);expect(native.host.get(native.row.intentId).subjects.every(subject=>subject.attempts.at(-1)?.phase==='enrolled')).toBe(true);
},30000);

it.skipIf(!qualified)('actual protected model report can advance a nonterminal step before the next HTTP request',async()=>{
 const f=await fixture(),native=await registerNative(f),registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const raw=vi.fn(async()=>new Response('model response'));
 async function send(id:string){const prepared=await f.product.owner.prepareRequest({logicalInvocationId:id,messages:[],tools:[],systemPrompt:''});const response=await createProviderDisclosureFetch(prepared.providerDisclosure!,raw)('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',messages:[]})});expect(await response.text()).toBe('model response');}
 await send('model-before-report');const before=(await f.ledgerStore.load(f.sessionId))!.intents.find(row=>row.intentId===native.row.intentId)!;expect(before.stages[0].steps.length).toBeGreaterThan(1);
 const result=await registry.executeTool('intent_step_update',{instance_id:'actual-host',session_id:f.sessionId,intent_id:before.intentId,active_step_id:before.activeStepId,step_status:'completed',breadcrumb:'actual nonterminal execution report'},{taskId:'actual-task',session:f.session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'model-before-report',toolInvocationId:'actual-report'});
 expect(result).not.toMatch(/^Error:/);const after=(await f.ledgerStore.load(f.sessionId))!.intents.find(row=>row.intentId===before.intentId)!;expect(after.activeStepId).not.toBe(before.activeStepId);expect(after.overallStatus).not.toBe('completed');
 await send('model-after-report');expect(raw).toHaveBeenCalledTimes(2);
},30000);

it.skipIf(!qualified).each(['permission','registry','tools','filter'] as const)('held actual dependency read rejects late %s revocation before HTTP',async(kind)=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const original=controller.call.getMockImplementation()!;let release!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>entered=resolve);
 controller.call.mockImplementation(async(method:string,payload:any)=>{const result=await original(method,payload);if(method==='publication.observeIntentDependencies'){entered();await held;}return result;});
 const prepared=await f.product.owner.prepareRequest({logicalInvocationId:'held-'+kind,messages:[],tools:[],systemPrompt:''}),raw=vi.fn(async()=>new Response('unexpected HTTP'));
 const pending=createProviderDisclosureFetch(prepared.providerDisclosure!,raw)('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',messages:[]})}).then(()=>null,error=>error);
 await ready;try{if(kind==='permission')f.permission.setMode('plan');else if(kind==='registry')registry.dispose();else if(kind==='filter')registry.setAllowedTools([]);else registry.registerTool({definition:{name:'late_tool',description:'late generation',inputSchema:{type:'object',properties:{}}},permission:'safe',async execute(){return 'late';}});}finally{release();}
 expect(await pending).toBeInstanceOf(Error);expect(raw).not.toHaveBeenCalled();
},30000);

import {createProductObservationSubagentTool} from '../../../src/runtime/sol-pi/product-subagent-tool.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import {buildOpenAIHarnessContext,resolveKimiHarnessFeatureFlags} from '../../../src/ai/providers/model-harness-profile.js';
import {withObservationExecutionOwner} from '../../../src/runtime/sol-pi/observation-execution-scope.js';
import {buildToolList} from '../../../src/ai/tools/index.js';
it.skipIf(!qualified)('actual protected root delegates an original child model/tool/model chain under the same native contract',async()=>{
 const f=await fixture(true);await registerNative(f);const registry=f.base;for(const tool of f.tools)registry.registerTool(tool);
 for(const tool of buildToolList(undefined,{cwd:f.root}).filter(t=>t.definition.name==='read'))registry.registerTool(tool);
 const adapter=new OpenAIAdapter({apiKey:'test-only',kimiCodingHeadersApplied:false,harnessContext:buildOpenAIHarnessContext({identity:{providerId:'deepseek',providerType:'custom',protocol:'openai_legacy',canonicalBaseUrl:'https://api.deepseek.com',wireModel:'deepseek-flash',capabilities:['tools']},flags:resolveKimiHarnessFeatureFlags({})})});
 let calls=0;const raw=vi.fn(async()=>{calls++;const delta=calls===1?{tool_calls:[{index:0,id:'child-read',type:'function',function:{name:'read',arguments:JSON.stringify({file_path:join(f.root,'source')})}}]}:{content:'actual child completed'};return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:'tool_calls' in delta?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});});
 vi.stubGlobal('fetch',raw);cleanup.push(()=>vi.unstubAllGlobals());
 const tool=createProductObservationSubagentTool({product:f.product,parentOwner:f.product.owner,sourceRegistry:registry,adapter:()=>adapter,cwd:f.root,persist:s=>f.store.save({...s,intentDelegation:f.store.getIntentNativeLedgerSync(s.sessionId)}),buildSystemPrompt:async()=>'Read the explicitly selected source once then finish.'});registry.registerTool(tool);
 const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const result=await withObservationExecutionOwner(f.product.owner,()=>registry.executeTool('subagent',{prompt:'read the explicit source'},{taskId:'actual-task',session:f.session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'protected-parent',toolInvocationId:'protected-child'}));
 expect(result).toContain('actual child completed');expect(calls).toBe(2);expect(controller.call.mock.calls.filter(([method])=>method==='publication.observeIntentDependencies')).toHaveLength(2);
 f.session.appendUserToolResults([{type:'tool_result',tool_use_id:'protected-child',content:result}]);await coordinator!.publishCurrentHistory();
 const parent=(await f.store.load(f.sessionId))!,edge=parent.compoundOperations!.directOperations!.find(row=>row.delegation)!;expect(edge).toMatchObject({stage:'settled',delegation:{state:'closed',childPhase:'drained'}});const child=(await f.store.load(edge.delegation!.childSessionIdentity))!;expect(child.compoundOperations!.providerAttempts).toHaveLength(2);expect(child.compoundOperations!.providerAttempts!.every(row=>row.transportState==='drained')).toBe(true);
},30000);

it.skipIf(!qualified)('original provider ticket cannot cross a later actual permission revision',async()=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 const original=admissions.getProviderAncestorAdmissionBinding;let binding:admissions.ProviderAncestorAdmissionBinding|undefined;const spy=vi.spyOn(admissions,'getProviderAncestorAdmissionBinding').mockImplementation(cap=>{const actual=original(cap);binding=actual;return actual;});
 try{const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());}finally{spy.mockRestore();}
 const facts={logicalInvocationId:'late-consume',attemptIndex:0,serializedBodySha256:'a'.repeat(64),destination:{provider:'deepseek',model:'deepseek-flash',url:'https://api.deepseek.com/chat/completions'},closureDigest:'b'.repeat(64)},ticket=await binding!.reserve(facts);
 f.permission.addSessionDenyRule('Bash(*)');expect(()=>binding!.consume(ticket,facts)).toThrow(/permission|revoked|changed/);await binding!.settle(ticket,'cancelled_before_send');expect((await f.store.load(f.sessionId))!.compoundOperations!.providerAttempts!.at(-1)?.transportState).toBe('cancelled_before_send');
},30000);

it.skipIf(!qualified)('execution-terminal first stage remains pending and cannot send a future model without publication',async()=>{
 const f=await fixture(),native=await registerNative(f),registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const count=native.planned.plan.stages[0].steps.length;
 for(let index=0;index<count;index++){const row=f.store.getIntentNativeLedgerSync(f.sessionId)!.intents.find(row=>row.intentId===native.row.intentId)!;const result=await registry.executeTool('intent_step_update',{instance_id:'actual-host',session_id:f.sessionId,intent_id:row.intentId,active_step_id:row.activeStepId,step_status:'completed',breadcrumb:'execution fact'},{taskId:'actual-task',session:f.session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'actual-provider',toolInvocationId:'terminal-'+index});expect(result).not.toMatch(/^Error:/);}
 expect(f.store.getIntentNativeLedgerSync(f.sessionId)!.intents.find(row=>row.intentId===native.row.intentId)!.overallStatus).toBe('publication_pending');
 const prepared=await f.product.owner.prepareRequest({logicalInvocationId:'after-terminal',messages:[],tools:[],systemPrompt:''}),raw=vi.fn(async()=>new Response('unexpected'));
 await expect(createProviderDisclosureFetch(prepared.providerDisclosure!,raw)('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',messages:[]})})).rejects.toThrow('SOL_PI_TRANSPORT_AUTHORIZATION_REJECTED');expect(raw).not.toHaveBeenCalled();
},30000);

import {intentNativeLedgerHash} from '../../../src/runtime/intent-delegation/native-contract-journal.js';
it.skipIf(!qualified)('held dependency read cannot send after original durable session ownership is released',async()=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const original=controller.call.getMockImplementation()!;let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>entered=resolve);controller.call.mockImplementation(async(method:string,payload:any)=>{const result=await original(method,payload);if(method==='publication.observeIntentDependencies'){entered();await hold;}return result;});
 const prepared=await f.product.owner.prepareRequest({logicalInvocationId:'ownership-await',messages:[],tools:[],systemPrompt:''}),raw=vi.fn(async()=>new Response('unexpected'));
 const pending=createProviderDisclosureFetch(prepared.providerDisclosure!,raw)('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',messages:[]})}).then(()=>null,error=>error);
 await ready;const lease=await f.product.executionAuthority!.acquire({invocationId:'explicit-release',kind:'direct-mutation'});try{await f.store.transitionIntentSessionOwnership({sessionId:f.sessionId,instanceId:'actual-host',expectedLedgerHash:intentNativeLedgerHash(f.store.getIntentNativeLedgerSync(f.sessionId)),action:'release',confirmHighRisk:false,requestSource:'user',now:Date.now(),lease});}finally{await lease.releaseAfterDrain();release();}
 expect(await pending).toBeInstanceOf(Error);expect(raw).not.toHaveBeenCalled();expect(f.store.getIntentNativeLedgerSync(f.sessionId)!.ownership.state).toBe('released');
},30000);

it.skipIf(!qualified)('original step execution terminal cannot be replayed while the old business stage is pending',async()=>{
 const f=await fixture(),native=await registerNative(f),registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const row=f.store.getIntentNativeLedgerSync(f.sessionId)!.intents.find(row=>row.intentId===native.row.intentId)!;const lease=await f.product.executionAuthority!.acquire({kind:'direct-mutation',invocationId:'actual-terminal'});try{await f.store.recordIntentExecutionTerminal({sessionId:f.sessionId,intentId:row.intentId,kind:'step',identity:row.activeStepId,status:'completed',requestSource:'user',recordedAt:Date.now(),lease});}finally{await lease.releaseAfterDrain();}
 const after=f.store.getIntentNativeLedgerSync(f.sessionId)!.intents.find(value=>value.intentId===row.intentId)!;expect(after.stages[0].status).toBe(row.stages[0].status);
 const prepared=await f.product.owner.prepareRequest({logicalInvocationId:'after-step-terminal',messages:[],tools:[],systemPrompt:''}),raw=vi.fn(async()=>new Response('unexpected replay'));
 await expect(createProviderDisclosureFetch(prepared.providerDisclosure!,raw)('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify({model:'deepseek-flash',messages:[]})})).rejects.toThrow('SOL_PI_TRANSPORT_AUTHORIZATION_REJECTED');expect(raw).not.toHaveBeenCalled();
},30000);

import * as childInstallationModule from '../../../src/runtime/sol-pi/compound-child-installation.js';
it.skipIf(!qualified)('actual child rebind burns its old provider generation and admits a fresh original ticket',async()=>{
 const f=await fixture(true);await registerNative(f);const registry=f.base;for(const tool of f.tools)registry.registerTool(tool);for(const tool of buildToolList(undefined,{cwd:f.root}).filter(t=>t.definition.name==='read'))registry.registerTool(tool);
 let childCoordinator:Awaited<ReturnType<typeof installProductCompoundCoordinator>>,childCap:admissions.ProviderAncestorAdmission|undefined,childRegistry:ToolRegistry|undefined;
 const originalFactory=childInstallationModule.createCompoundChildInstallation,originalAdmission=admissions.createCompoundProviderAdmission;
 const a=vi.spyOn(childInstallationModule,'createCompoundChildInstallation').mockImplementation(input=>originalFactory({...input,installCoordinator:args=>{const value=input.installCoordinator(args);childCoordinator=value;childRegistry=args.registry;return value;}}));
 const b=vi.spyOn(admissions,'createCompoundProviderAdmission').mockImplementation(async input=>{const value=await originalAdmission(input);childCap=value;return value;});cleanup.push(()=>{a.mockRestore();b.mockRestore();});
 const adapter=new OpenAIAdapter({apiKey:'test-only',kimiCodingHeadersApplied:false,harnessContext:buildOpenAIHarnessContext({identity:{providerId:'deepseek',providerType:'custom',protocol:'openai_legacy',canonicalBaseUrl:'https://api.deepseek.com',wireModel:'deepseek-flash',capabilities:['tools']},flags:resolveKimiHarnessFeatureFlags({})})});const originalStream=adapter.stream.bind(adapter);let exercised=false;
 adapter.stream=async function*(...args){expect(childCap).toBeDefined();expect(childCoordinator).toBeDefined();const binding=admissions.getProviderAncestorAdmissionBinding(childCap!),facts={logicalInvocationId:'child-rebind-old',attemptIndex:0,serializedBodySha256:'a'.repeat(64),destination:{provider:'deepseek',model:'deepseek-flash',url:'https://api.deepseek.com/chat/completions'},closureDigest:'b'.repeat(64)},old=await binding.reserve(facts);
  const next=new ToolRegistry({permissionManager:f.permission},[]);cleanup.push(()=>next.dispose());await childCoordinator!.rebindRegistry(next);childRegistry!.dispose();expect(()=>binding.consume(old,facts)).toThrow(/changed/);await binding.settle(old,'cancelled_before_send');const nextFacts={...facts,logicalInvocationId:'child-rebind-new'},fresh=await binding.reserve(nextFacts);await binding.settle(fresh,'cancelled_before_send');exercised=true;yield* originalStream(...args);
 };
 const raw=vi.fn(async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'rebound child completed'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));vi.stubGlobal('fetch',raw);cleanup.push(()=>vi.unstubAllGlobals());
 registry.registerTool(createProductObservationSubagentTool({product:f.product,parentOwner:f.product.owner,sourceRegistry:registry,adapter:()=>adapter,cwd:f.root,persist:s=>f.store.save({...s,intentDelegation:f.store.getIntentNativeLedgerSync(s.sessionId)}),buildSystemPrompt:async()=>''}));const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const result=await withObservationExecutionOwner(f.product.owner,()=>registry.executeTool('subagent',{prompt:'finish once'},{taskId:'actual-task',session:f.session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'parent-rebind',toolInvocationId:'child-rebind'}));expect(exercised).toBe(true);expect(result).toContain('rebound child completed');expect(raw).toHaveBeenCalledOnce();f.session.appendUserToolResults([{type:'tool_result',tool_use_id:'child-rebind',content:result}]);await coordinator!.publishCurrentHistory();
},30000);

import * as productCoordinators from '../../../src/runtime/sol-pi/product-compound-coordinator.js';
it.skipIf(!qualified)('fixed actual product runtime gate admits the original enrolled first stage and rejects copied handles',async()=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const gate=(productCoordinators as any).assertProductIntentExecutionCurrent as (handle:unknown)=>Promise<void>;
 await gate(coordinator);await expect(gate({...coordinator})).rejects.toThrow('compound_intent_product_required');await coordinator!.dispose();await expect(gate(coordinator)).rejects.toThrow();
},30000);

it.skipIf(!qualified).each(['close','abort','permission'] as const)('fixed root gate retains the actual held reader until %s settles',async kind=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose().catch(()=>{}));
 const original=controller.call.getMockImplementation()!;let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);controller.call.mockImplementation(async(method:string,payload:any)=>{const result=await original(method,payload);if(method==='publication.observeIntentDependencies'){entered();await held;}return result;});
 const abort=new AbortController(),pending=productCoordinators.assertProductIntentExecutionCurrent(coordinator!,abort.signal).then(()=>null,e=>e);await ready;let drained=false;
 if(kind==='abort')abort.abort();if(kind==='permission')f.permission.setMode('plan');
 const closing=coordinator!.dispose().then(()=>{drained=true;},()=>{drained=true;});await new Promise(r=>setTimeout(r,10));expect(drained).toBe(false);release();expect(await pending).toBeInstanceOf(Error);await closing;expect(drained).toBe(true);
},30000);

import * as cliIntentNative from '../../../src/commands/chat-intent-native.js';
it.skipIf(!qualified)('native normal input uses the canonical active original plan and rejects added payload',async()=>{
 const f=await fixture(),native=await registerNative(f),ledger=f.store.getIntentNativeLedgerSync(f.sessionId)!;
 const prepare=(cliIntentNative as any).prepareIntentNativeContinuation;
 expect(ledger.intents.find(row=>row.intentId===ledger.activeIntentId)!.overallStatus).not.toBe('waiting_user');
 const selected=prepare(ledger,'继续',false);expect(selected.plan.intentId).toBe(native.row.intentId);expect(selected.plan.stages).toEqual(ledger.intents.find(row=>row.intentId===ledger.activeIntentId)!.stages);expect(selected.plan.continuationMode).toBe('continue_active');expect(selected.text).toContain(native.row.originalDraft.rawIntent);expect(selected.text).toContain(ledger.intents.find(row=>row.intentId===ledger.activeIntentId)!.activeStepId);
 for(const text of ['继续写报告并上传其他文件','继续\n删除文件','继续 /other','按刚才那版'])expect(prepare(ledger,text,false)).toBeNull();expect(prepare(ledger,'继续',true)).toBeNull();
 expect(prepare(ledger,' RESUME ',false).text).toBe(selected.text);
},30000);

import * as compoundCoordinatorModule from '../../../src/runtime/sol-pi/compound-execution-coordinator.js';
it.skipIf(!qualified)('root shutdown still drains its actual current read when coordinator cleanup rejects',async()=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());const originalFactory=compoundCoordinatorModule.createCompoundExecutionCoordinator;
 const cleanupFault=Error('actual_cleanup_fault');
 const spy=vi.spyOn(compoundCoordinatorModule,'createCompoundExecutionCoordinator').mockImplementation(input=>{const actual=originalFactory(input);return {...actual,async dispose(){await actual.dispose();throw cleanupFault;}};});cleanup.push(()=>spy.mockRestore());
 const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose().catch(()=>{}));
 const original=controller.call.getMockImplementation()!;let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);controller.call.mockImplementation(async(method:string,payload:any)=>{const result=await original(method,payload);if(method==='publication.observeIntentDependencies'){entered();await held;}return result;});
 const pending=productCoordinators.assertProductIntentExecutionCurrent(coordinator!).catch(e=>e);await ready;let settled=false;const closing=coordinator!.dispose().then(()=>{settled=true;return null;},error=>{settled=true;return error;});await new Promise(r=>setTimeout(r,10));const early=settled;release();const readFailure=await pending;const failure=await closing;expect(failure).toBeInstanceOf(AggregateError);expect(failure.message).toBe('compound_product_drain_unconfirmed');expect(failure.errors).toEqual([cleanupFault,readFailure,readFailure]);expect(failure.errors[0]).toBe(cleanupFault);expect(failure.errors[1]).toBe(readFailure);expect(failure.errors[2]).toBe(readFailure);expect(early).toBe(false);
},30000);

it.skipIf(!qualified).each(['drain','rebind'] as const)('root %s does not finish while its old fixed read is held',async kind=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose().catch(()=>{}));
 const original=controller.call.getMockImplementation()!;let release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);controller.call.mockImplementation(async(method:string,payload:any)=>{const result=await original(method,payload);if(method==='publication.observeIntentDependencies'){entered();await held;}return result;});
 const pending=productCoordinators.assertProductIntentExecutionCurrent(coordinator!).catch(e=>e);await ready;let settled=false;const next=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>next.dispose());const closing=(kind==='drain'?coordinator!.drainCurrentTurn():coordinator!.rebindRegistry(next)).then(()=>{settled=true;return null;},e=>{settled=true;return e;});await new Promise(r=>setTimeout(r,10));const early=settled;release();expect(await pending).toBeInstanceOf(Error);await closing;expect(early).toBe(false);
},30000);

it.skipIf(!qualified).each(['explicit','coordinator'] as const)('history-only %s publisher preserves the current native journal and durable sibling fields after native CAS',async kind=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());
 const lease=await f.product.executionAuthority!.acquire({kind:'direct-mutation',invocationId:'actual-sibling'});try{const previous=(await f.store.load(f.sessionId))!;await f.store.compareAndSave({expectedStoreRevision:previous.storeRevision!,expectedHistoryDigest:previous.historyDigest!,nextSnapshot:{...previous,memoryRefs:['original-new-memory'],backgroundJobRefs:['actual-job']},lease});}finally{await lease.releaseAfterDrain();}
 const before=(await f.store.load(f.sessionId))!;f.session.appendUserText('actual original continuation');if(kind==='explicit')await productCoordinators.persistCompoundPublicationSnapshot(f.session,f.session.exportSnapshot());else await coordinator!.publishCurrentHistory();const after=(await f.store.load(f.sessionId))!;expect(after.intentDelegation).toEqual(before.intentDelegation);expect(after.memoryRefs).toEqual(before.memoryRefs);expect(after.backgroundJobRefs).toEqual(before.backgroundJobRefs);expect(after.messages).toEqual(f.session.exportSnapshot().messages);
},30000);


it.skipIf(!qualified).each(['restore','owner-retired','whole-close'] as const)('registry retirement drains the original port before %s',async kind=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
 const originalFactory=compoundCoordinatorModule.createCompoundExecutionCoordinator;
 const spy=vi.spyOn(compoundCoordinatorModule,'createCompoundExecutionCoordinator').mockImplementation(input=>{
  const actual=originalFactory(input);let disposal:Promise<void>|undefined;
  return {...actual,dispose(){return disposal??=(async()=>{await actual.dispose();entered();await held;})();}};
 });cleanup.push(()=>spy.mockRestore());
 const coordinator=(await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry}))!;cleanup.push(()=>coordinator.dispose().catch(()=>{}));
 const restore=vi.fn(()=>{if(kind==='owner-retired')return undefined;const next=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>next.dispose());return next;});
 let settled=false;const retiring=coordinator.retireCurrentRegistry(restore).then(value=>{settled=true;return value;});await ready;
 expect(settled).toBe(false);expect(restore).not.toHaveBeenCalled();
 await expect(coordinator.retireCurrentRegistry(restore)).rejects.toThrow('compound_registry_retirement_unavailable');
 let closed=false;const closing=kind==='whole-close'?coordinator.dispose().then(()=>{closed=true;}):undefined;
 expect(closed).toBe(false);release();expect(await retiring).toBe(kind==='restore');await closing;
 expect(restore).toHaveBeenCalledTimes(kind==='whole-close'?0:1);
 if(kind==='restore')await productCoordinators.assertProductIntentExecutionCurrent(coordinator);
 else await expect(productCoordinators.assertProductIntentExecutionCurrent(coordinator)).rejects.toThrow();
 if(kind==='whole-close'){expect(closed).toBe(true);expect(await coordinator.retireCurrentRegistry(restore)).toBe(false);expect(restore).not.toHaveBeenCalled();}
},30000);

it.skipIf(!qualified)('retirement and whole close preserve an original native cleanup failure',async()=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 const fault=Error('original_retirement_cleanup_unknown'),originalFactory=compoundCoordinatorModule.createCompoundExecutionCoordinator;
 const spy=vi.spyOn(compoundCoordinatorModule,'createCompoundExecutionCoordinator').mockImplementation(input=>{const actual=originalFactory(input);return {...actual,async dispose(){await actual.dispose();throw fault;}};});cleanup.push(()=>spy.mockRestore());
 const coordinator=(await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry}))!;cleanup.push(()=>coordinator.dispose().catch(()=>{}));
 const restore=vi.fn(()=>undefined),failure=await coordinator.retireCurrentRegistry(restore).catch(e=>e);
 expect(failure).toBeInstanceOf(AggregateError);expect(failure.message).toBe('compound_registry_drain_unconfirmed');expect(failure.errors).toContain(fault);expect(restore).not.toHaveBeenCalled();
 const closed=await coordinator.dispose().catch(e=>e);expect(closed).toBeInstanceOf(AggregateError);expect(closed.errors).toContain(failure);
 await expect(coordinator.retireCurrentRegistry(restore)).rejects.toBe(closed);expect(restore).not.toHaveBeenCalled();
},30000);

it.skipIf(!qualified)('retirement restore keeps the original permission authority guard',async()=>{
 const f=await fixture();await registerNative(f);const registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 const coordinator=(await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry}))!;cleanup.push(()=>coordinator.dispose().catch(()=>{}));
 const forged=new ToolRegistry({permissionManager:new PermissionManager({mode:'auto'})},[]);cleanup.push(()=>forged.dispose());
 await expect(coordinator.retireCurrentRegistry(()=>forged)).rejects.toThrow('compound_registry_permission_changed');
 await expect(productCoordinators.assertProductIntentExecutionCurrent(coordinator)).rejects.toThrow();
},30000);
