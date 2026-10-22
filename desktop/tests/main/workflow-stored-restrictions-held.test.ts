// @vitest-environment node
import type {ToolRegistry as ToolRegistryType} from '../../../src/ai/tools/index.js';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
import {it,expect,vi} from 'vitest';
import {writeFileSync,readFileSync,mkdirSync,realpathSync} from 'node:fs';import {join} from 'node:path';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron',()=>({app:{isPackaged:false}}));
const cases=['prepared_effect','actual_dispatch','next_model_turn','queued_admission'];
it.each(cases)('actual issued writable policy tightens at $0 before its effect',async(stage)=>{
 const fixture=await createOwnedWorkflowNetworkFixture(null);let ks,desktop,lease;const restore=[];let calls=0;
 const previous={config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 try{
 expect(new URL(fixture.base).hostname).toBe('127.0.0.1');expect(new URL(fixture.base).port).not.toBe('4400');
 const config=join(fixture.root,'config');mkdirSync(config,{recursive:true});writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));
 process.env.XIAOK_CONFIG_DIR=config;process.env.KSWARM_SERVER_PATH=realpathSync(resolve(repositoryRoot,'..','kswarm','src/server/index.js'));process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';globalThis.fetch=fixture.forwardedFetch;
 const ksModule=await import('../../electron/kswarm-service.ts');ks=ksModule.createKSwarmService({spawnProcess:(()=>{throw Error('fixture_foreign_spawn_denied');}) as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_foreign_kill_denied');}});
 const {createDesktopServices}=await import('../../electron/desktop-services.ts');const {OpenAIAdapter}=await import('../../../src/ai/adapters/openai.ts');
 const {ToolRegistry}=await import('../../../src/ai/tools/index.ts');
 const {DesktopExecutionCoordinator}=await import('../../electron/desktop-execution-coordinator.ts');
 const coordinator=new DesktopExecutionCoordinator({backgroundCapacity:1});
 const file=join(fixture.workspace.artifacts,'reference.txt');writeFileSync(file,'ORIGINAL');
 if(stage==='prepared_effect'){
  const original=ToolRegistry.prototype.prepareToolInvocationDetailed;
  const spy=vi.spyOn(ToolRegistry.prototype,'prepareToolInvocationDetailed').mockImplementation(async function(this:ToolRegistryType,name,input,context){const result=await original.call(this,name,input,context);if(name==='write'&&result.kind==='prepared')await fixture.tightenToReadonly();return result;});restore.push(()=>spy.mockRestore());
 }
 if(stage==='actual_dispatch'){
  const monitor=await import('../../../src/runtime/tool-execution-health.ts');const original=monitor.runMonitoredTool;
  const spy=vi.spyOn(monitor,'runMonitoredTool').mockImplementation(async options=>{if(options.name==='write')await fixture.tightenToReadonly();return original(options);});restore.push(()=>spy.mockRestore());
 }
 if(stage==='next_model_turn'){
  const original=ToolRegistry.prototype.executeTool;
  const spy=vi.spyOn(ToolRegistry.prototype,'executeTool').mockImplementation(async function(this:ToolRegistryType,name,input,context){const result=await original.call(this,name,input,context);if(name==='read'){expect(result).toContain('ORIGINAL');await fixture.tightenToReadonly();}return result;});restore.push(()=>spy.mockRestore());
 }
 const mock=vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){
  calls++;
  if(stage==='next_model_turn'&&calls===1){yield {type:'tool_use',id:'read',name:'read',input:{file_path:file}};yield {type:'done'};return;}
  if(calls===(stage==='next_model_turn'?2:1))yield {type:'tool_use',id:'writing',name:'write',input:{file_path:file,content:'UPDATED'}};
  else yield {type:'text',delta:JSON.stringify({output:{summary:'temporary workflow finished',artifacts:[]}})};
  yield {type:'done'};
 });restore.push(()=>mock.mockRestore());
 desktop=createDesktopServices({dataRoot:join(fixture.root,'desktop-data'),kswarmService:ks,executionCoordinator:coordinator});
 if(stage==='queued_admission')lease=await coordinator.acquireLease({lane:'background',policy:'ordinary'});
 const run=desktop.runKSwarmWorkflowNode({handoff:{...fixture.issued.dispatches[0],project:{id:fixture.project.id,name:fixture.project.name,goal:fixture.project.goal,workFolder:fixture.workspace.path}},targetParticipantId:'xiaok-worker'});
 // Attach rejection immediately; a queued refusal must not become an unhandled rejection.
 const outcome=run.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
 if(stage==='queued_admission'){
  const until=Date.now()+2000;while(coordinator.snapshot().waiting===0&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
  expect(coordinator.snapshot().waiting).toBe(1);await fixture.tightenToReadonly();lease!.release();lease=undefined;
 }
 const result=await outcome;expect(readFileSync(file,'utf8')).toBe('ORIGINAL');
 expect(fixture.durableMutations).toHaveLength(1);
 if(stage==='queued_admission')expect(calls).toBe(0);else expect(calls).toBe(1);
 expect(result.ok).toBe(false);if(!result.ok)expect(String(result.error)).toContain("workflow_stored_restrictions_denied");
 expect(fixture.requestLog.every(row=>row.ownedTarget===fixture.base||row.ownedTarget===fixture.brokerBase)).toBe(true);
 expect(fixture.requestLog.filter(row=>new URL(row.originalOrigin).port==='4400').every(row=>row.ownedTarget===fixture.base)).toBe(true);
 console.log(JSON.stringify({privateBase:fixture.base,requestLog:fixture.requestLog,stage,providerCalls:calls,effect:readFileSync(file,'utf8'),durableMutations:fixture.durableMutations,error:result.ok?null:String(result.error)}));
 }finally{
 lease?.release();for(const fn of restore)fn();if(desktop){await desktop.closeTaskSourceWritersForMigration();await desktop.disposeMultiAgent();}if(ks){const module=await import('../../electron/kswarm-service.ts');await module.sealAndDrainKSwarmServiceInstance(ks);}
 globalThis.fetch=fixture.nativeFetch;for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fixture.close();
 }
},8000);
