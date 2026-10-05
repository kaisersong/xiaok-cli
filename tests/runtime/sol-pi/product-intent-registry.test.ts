import {afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';import {homedir,tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
const route=vi.hoisted(()=>({protected:false}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:any)=>route.protected?{kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...owner}}:{kind:'ordinary'}}));
import {parseObservationPolicyFile,createProductObservationOwner} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {installProductCompoundCoordinator} from '../../../src/runtime/sol-pi/product-compound-coordinator.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';import {PermissionManager} from '../../../src/ai/permissions/manager.js';
import {createIntentDelegationTools} from '../../../src/ai/tools/intent-delegation.js';
import {createIntentPlan} from '../../../src/ai/intent-delegation/planner.js';
import {SessionIntentDelegationStore,createEmptySessionIntentLedger,appendIntentToLedger} from '../../../src/runtime/intent-delegation/store.js';
const cleanup:Array<()=>unknown>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();route.protected=false;});
const environmentRoot=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1');
const qualified=process.platform==='darwin'&&process.arch==='arm64'&&existsSync(join(environmentRoot,'manifest.json'));
async function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'product-intent-registry-')));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,'source'),policyFile=join(root,'policy.json');writeFileSync(file,'original');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:file,startLine:1}],bashSources:[],compoundExecution:{version:1,mode:'mechanism-experiment'}}));
 const storeRoot=join(root,'sessions'),store=new FileSessionStore(storeRoot),ledgerStore=new SessionIntentDelegationStore(store),session=new AgentSessionState(),sessionId=randomUUID();
 const planned=createIntentPlan({sessionId,instanceId:'actual-host',input:'写一份报告',skills:[]});if(planned.kind!=='plan')throw Error('fixture_plan');
 const ledger=appendIntentToLedger(createEmptySessionIntentLedger(sessionId,1),planned.plan,1);ledger.instanceId='actual-host';ledger.ownership={state:'owned',ownerInstanceId:'actual-host',updatedAt:1};
 session.restoreSnapshot({...session.exportSnapshot(),sessionId,cwd:root,intentDelegation:ledger});await store.save(session.exportSnapshot());
 const permission=new PermissionManager({mode:'auto'});
 const product=await createProductObservationOwner({policy:parseObservationPolicyFile(policyFile),session,profileRoot:join(root,'profile'),environmentRoot,credentialSecrets:[],persist:s=>store.save(s),permissionManager:permission,executionPersistence:{store,root:storeRoot}});cleanup.push(()=>product.dispose());
 const tools=createIntentDelegationTools({ledgerStore,sessionId,instanceId:'actual-host'}).filter(t=>['intent_step_update','intent_stage_artifact'].includes(t.definition.name));
 const base=new ToolRegistry({permissionManager:permission},[]);cleanup.push(()=>base.dispose());
 return {root,storeRoot,store,ledgerStore,session,sessionId,product,permission,tools,base};
}
it.skipIf(!qualified)('actual product installer admits original report pair and persists protected execution facts without business completion',async()=>{
 const f=await fixture(),registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 const context={taskId:'actual-task',session:f.session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'actual-provider',toolInvocationId:'actual-tool'};
 await expect(registry.executeTool('intent_step_update',{},context)).rejects.toThrow('compound_child_installation_required');
 const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());route.protected=true;
 const count=(await f.ledgerStore.load(f.sessionId))!.intents[0].stages[0].steps.length;
 for(let i=0;i<count;i++){const row=(await f.ledgerStore.load(f.sessionId))!.intents[0];const result=await registry.executeTool('intent_step_update',{instance_id:'actual-host',session_id:f.sessionId,intent_id:row.intentId,active_step_id:row.activeStepId,step_status:'completed',breadcrumb:'actual product report'},{...context,toolInvocationId:`tool-${i}`});expect(result).not.toMatch(/^Error:/);}
 const row=(await f.ledgerStore.load(f.sessionId))!.intents[0];expect(row.overallStatus).toBe('publication_pending');expect(row.stages[0].semanticValidation).toBe('pending');expect(row.producerReports).toHaveLength(count);expect(row.producerReports![0]).toMatchObject({requestSource:'user',action:{origin:{kind:'model-report',providerInvocationId:'actual-provider',toolInvocationId:'tool-0'}}});
},30000);
it.skipIf(!qualified)('ordinary observation fork and copied report tools cannot enter compound product',async()=>{
 const f=await fixture();expect(()=>f.base.forkForObservation(f.tools,[])).toThrow('not admitted');expect(()=>f.base.forkForCompoundObservation(f.tools.map(t=>({...t})),[])).toThrow('not admitted');
});

it.skipIf(!qualified).each(['partial','mixed','foreign-store','foreign-session'] as const)('actual installer rejects %s original producer identity',async(kind)=>{
 const f=await fixture();let tools=f.tools;
 if(kind==='partial')tools=tools.slice(0,1);
 if(kind==='mixed')tools=[tools[0],createIntentDelegationTools({ledgerStore:f.ledgerStore,sessionId:f.sessionId,instanceId:'actual-host'}).find(t=>t.definition.name===tools[1].definition.name)!];
 if(kind==='foreign-store'||kind==='foreign-session')tools=createIntentDelegationTools({ledgerStore:kind==='foreign-store'?new SessionIntentDelegationStore(new FileSessionStore(f.storeRoot)):f.ledgerStore,sessionId:kind==='foreign-session'?'foreign':f.sessionId,instanceId:'actual-host'}).filter(t=>['intent_step_update','intent_stage_artifact'].includes(t.definition.name));
 const registry=f.base.forkForCompoundObservation(tools,[]);cleanup.push(()=>registry.dispose());
 const before=(await f.store.load(f.sessionId))!.intentDelegation;
 await expect(installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry})).rejects.toThrow(/intent_producer_/);
 expect((await f.store.load(f.sessionId))!.intentDelegation).toEqual(before);
},30000);
it.skipIf(!qualified)('actual product rebind retains source and closes the old report registry; late tool mutation cannot write',async()=>{
 const f=await fixture(),registry=f.base.forkForCompoundObservation(f.tools,[]);cleanup.push(()=>registry.dispose());
 const coordinator=await installProductCompoundCoordinator({product:f.product,session:f.session,store:f.store,root:f.storeRoot,registry});cleanup.push(()=>coordinator?.dispose());route.protected=true;
 const nextTools=createIntentDelegationTools({ledgerStore:f.ledgerStore,sessionId:f.sessionId,instanceId:'actual-host'}).filter(t=>['intent_step_update','intent_stage_artifact'].includes(t.definition.name)),next=f.base.forkForCompoundObservation(nextTools,[]);cleanup.push(()=>next.dispose());
 await coordinator!.rebindRegistry(next);
 const row=(await f.ledgerStore.load(f.sessionId))!.intents[0],input={instance_id:'actual-host',session_id:f.sessionId,intent_id:row.intentId,active_step_id:row.activeStepId,step_status:'completed',breadcrumb:'rebound'},context={taskId:'task',session:f.session.exportSnapshot(),messages:[],systemPrompt:'',toolDefinitions:[],hostProviderInvocationId:'provider',toolInvocationId:'rebound'};
 await expect(registry.executeTool('intent_step_update',input,context)).rejects.toThrow();expect(await next.executeTool('intent_step_update',input,context)).not.toMatch(/^Error:/);
 const before=(await f.store.load(f.sessionId))!.intentDelegation;nextTools[0].definition.description+=' mutated';
 const result=await next.executeTool('intent_step_update',input,{...context,toolInvocationId:'late'}).catch(e=>`Error: ${e}`);expect(result).toMatch(/^Error:/);expect((await f.store.load(f.sessionId))!.intentDelegation).toEqual(before);
},30000);
