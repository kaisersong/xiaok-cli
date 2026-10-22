// @vitest-environment node
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
import {it,expect,vi} from 'vitest';
import {writeFileSync,readFileSync,mkdirSync,realpathSync} from 'node:fs';import {join} from 'node:path';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron',()=>({app:{isPackaged:false}}));
const cases=['unknown_category','wrong_kind','wrong_attempt','wrong_handoff','wrong_participant','wrong_run','wrong_node','wrong_root','cancelled'] as const;
it.each(cases)('actual fresh restrictions deny $0 before allocating a provider',async(reason)=>{
 const fixture=await createOwnedWorkflowNetworkFixture(reason==='unknown_category'?{toolCategories:['future_tool']}:null);let ks,desktop;const restore=[];let calls=0;
 const previous={config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 try{
 expect(new URL(fixture.base).hostname).toBe('127.0.0.1');expect(new URL(fixture.base).port).not.toBe('4400');
 const config=join(fixture.root,'config');mkdirSync(config,{recursive:true});writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));
 process.env.XIAOK_CONFIG_DIR=config;process.env.KSWARM_SERVER_PATH=realpathSync(resolve(repositoryRoot,'..','kswarm','src/server/index.js'));process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';globalThis.fetch=fixture.forwardedFetch;
 const ksModule=await import('../../electron/kswarm-service.ts');ks=ksModule.createKSwarmService({spawnProcess:(()=>{throw Error('fixture_foreign_spawn_denied');}) as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_foreign_kill_denied');}});
 const {createDesktopServices}=await import('../../electron/desktop-services.ts');const {OpenAIAdapter}=await import('../../../src/ai/adapters/openai.ts');
 const file=join(fixture.workspace.artifacts,'reference.txt');writeFileSync(file,'ORIGINAL');
 const mock=vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){calls++;yield {type:'text',delta:'provider must not run'};yield {type:'done'};});restore.push(()=>mock.mockRestore());
 desktop=createDesktopServices({dataRoot:join(fixture.root,'desktop-data'),kswarmService:ks});
 const handoff={...fixture.issued.dispatches[0],project:{id:fixture.project.id,name:fixture.project.name,goal:fixture.project.goal,workFolder:fixture.workspace.path}};
 let participant='xiaok-worker';
 if(reason==='wrong_kind')handoff.nodeKind='review';
 if(reason==='wrong_attempt')handoff.attempt++;
 if(reason==='wrong_handoff')handoff.handoffId+='-wrong';
 if(reason==='wrong_participant')participant='other-worker';
 if(reason==='wrong_run')handoff.workflowRunId+='-wrong';
 if(reason==='wrong_node')handoff.nodeId+='-wrong';
 if(reason==='wrong_root')handoff.project.workFolder=fixture.root;
 if(reason==='cancelled'){
  const response=await fixture.nativeFetch(fixture.base+'/projects/'+fixture.project.id+'/workflows/'+handoff.workflowRunId+'/cancel',{method:'POST',headers:{'content-type':'application/json','x-kswarm-mutation-token':'temporary-test-token'},body:JSON.stringify({reason:'test-owned-cancel'})});
  expect(response.ok).toBe(true);expect((await response.json()).workflowRun.status).toBe('cancelled');
 }
 await expect(desktop.runKSwarmWorkflowNode({handoff,targetParticipantId:participant})).rejects.toThrow('workflow_stored_restrictions_denied');
 expect(calls).toBe(0);expect(readFileSync(file,'utf8')).toBe('ORIGINAL');
 expect(fixture.requestLog.every(row=>row.ownedTarget===fixture.base||row.ownedTarget===fixture.brokerBase)).toBe(true);
 expect(fixture.requestLog.filter(row=>new URL(row.originalOrigin).port==='4400').every(row=>row.ownedTarget===fixture.base)).toBe(true);
 console.log(JSON.stringify({privateBase:fixture.base,requestLog:fixture.requestLog,reason,actualHTTP:true,actualIssuer:true,providerCalls:calls,fileEffect:'ORIGINAL'}));
 }finally{
 for(const fn of restore)fn();if(desktop){await desktop.closeTaskSourceWritersForMigration();await desktop.disposeMultiAgent();}if(ks){const module=await import('../../electron/kswarm-service.ts');await module.sealAndDrainKSwarmServiceInstance(ks);}
 globalThis.fetch=fixture.nativeFetch;for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fixture.close();
 }
},8000);

it('a different existing entry cannot acquire the actual private service read port or allocate a provider',async()=>{
 const fixture=await createOwnedWorkflowNetworkFixture(null);let ks,desktop;let calls=0;
 const previous={fetch:globalThis.fetch,config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 const spawn=vi.fn(()=>{throw Error('fixture_foreign_spawn_denied');}),kill=vi.fn(()=>{throw Error('fixture_foreign_kill_denied');});
 let restore=()=>{};
 try{
  const config=join(fixture.root,'config');mkdirSync(config,{recursive:true});writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));
  const canonical=realpathSync(resolve(repositoryRoot,'..','kswarm','src/server/index.js'));
  const foreign=join(fixture.root,'different-server','src','server','index.js');mkdirSync(resolve(foreign,'..'),{recursive:true});writeFileSync(foreign,'// This owned fixture file is not the running service.\n');
  const module=await import('../../electron/kswarm-service.ts');
  const health=await(await fixture.nativeFetch(fixture.base+'/health')).json();
  const sourceHash=module.computeKSwarmServiceSourceHash(canonical);expect(sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(module.checkKSwarmHealthServiceIdentity(health,canonical,sourceHash).compatible).toBe(true);
  expect(module.checkKSwarmHealthServiceIdentity(health,realpathSync(foreign),sourceHash)).toMatchObject({compatible:false,reason:'entry_path_mismatch'});
  expect(new URL(fixture.base).port).not.toBe('4400');
  await expect(fixture.forwardedFetch('http://127.0.0.1:1/not-owned')).rejects.toThrow('fixture_unowned_fetch_target_denied');
  process.env.XIAOK_CONFIG_DIR=config;process.env.KSWARM_SERVER_PATH=realpathSync(foreign);process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';globalThis.fetch=fixture.forwardedFetch;
  ks=module.createKSwarmService({spawnProcess:spawn as never,findPortOwner:async()=>null,killStalePortOwner:kill as never});
  const {createDesktopServices}=await import('../../electron/desktop-services.ts');const {OpenAIAdapter}=await import('../../../src/ai/adapters/openai.ts');
  const file=join(fixture.workspace.artifacts,'reference.txt');writeFileSync(file,'ORIGINAL');
  const mock=vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){calls++;yield {type:'text',delta:'must not run'};yield {type:'done'};});restore=()=>mock.mockRestore();
  desktop=createDesktopServices({dataRoot:join(fixture.root,'desktop-data'),kswarmService:ks});
  await expect(module.getKSwarmWorkflowReadPort(ks)).rejects.toThrow('entry_path_mismatch');
  await expect(desktop.runKSwarmWorkflowNode({handoff:{...fixture.issued.dispatches[0],project:{id:fixture.project.id,name:fixture.project.name,goal:fixture.project.goal,workFolder:fixture.workspace.path}},targetParticipantId:'xiaok-worker'})).rejects.toThrow();
  expect(ks.getStatus().running).toBe(false);expect(calls).toBe(0);expect(readFileSync(file,'utf8')).toBe('ORIGINAL');
  expect(spawn).not.toHaveBeenCalled();expect(kill).not.toHaveBeenCalled();
  expect(fixture.requestLog.some(row=>row.path==='/health'&&row.ownedTarget===fixture.base)).toBe(true);
  expect(fixture.requestLog.length).toBeGreaterThan(0);
  expect(fixture.requestLog.every(row=>row.ownedTarget===fixture.base||row.ownedTarget===fixture.brokerBase)).toBe(true);
  expect(fixture.requestLog.filter(row=>new URL(row.originalOrigin).port==='4400').every(row=>row.ownedTarget===fixture.base)).toBe(true);
  console.log(JSON.stringify({privateBase:fixture.base,requestLog:fixture.requestLog,differentEntryDenied:true,providerCalls:calls,foreignSpawn:spawn.mock.calls.length,foreignKill:kill.mock.calls.length}));
 }finally{
  restore();if(desktop){await desktop.closeTaskSourceWritersForMigration();await desktop.disposeMultiAgent();}if(ks){const module=await import('../../electron/kswarm-service.ts');await module.sealAndDrainKSwarmServiceInstance(ks);}
  globalThis.fetch=previous.fetch;for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fixture.close();
 }
},8000);
