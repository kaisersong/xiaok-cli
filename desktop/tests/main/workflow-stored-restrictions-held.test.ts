// @vitest-environment node
import type {ToolRegistry as ToolRegistryType} from '../../../src/ai/tools/index.js';
import {it,expect,vi} from 'vitest';
import {writeFileSync,readFileSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openOwnedWorkflowServiceCase,finishOwnedWorkflowServiceCase} from '../support/owned-workflow-normal-case.js';
vi.mock('electron',()=>({app:{isPackaged:false},BrowserWindow:undefined,webContents:undefined}));
const cases=['prepared_effect','actual_dispatch','next_model_turn','queued_admission'];
it.each(cases)('actual issued writable policy tightens at $0 before its effect',async(stage)=>{
 const owned=await openOwnedWorkflowServiceCase(null);const {fixture,kswarmService:ks}=owned;let desktop,lease;const restore=[];let calls=0;
 let first:{error:unknown}|undefined;
 const previous={config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 try{await (async()=>{
 const config=join(fixture.root,'config');mkdirSync(config,{recursive:true});writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));
 process.env.XIAOK_CONFIG_DIR=config;
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
 console.log(JSON.stringify({stage,providerCalls:calls,effect:readFileSync(file,'utf8'),durableMutations:fixture.durableMutations,error:result.ok?null:String(result.error)}));
 })();}catch(error){first={error};}
 await finishOwnedWorkflowServiceCase(owned,desktop,first,[
 ()=>lease?.release(),
 ...restore,
 ()=>{for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 ]);
},8000);

it.each(['script_generated','po_generated'] as const)('owned workflow cleanup preserves undefined first cause and still drains/restores: $0',async issuer=>{
 const previous={fetch:globalThis.fetch,config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 const support=await import('../support/owned-workflow-normal-case.js');
 const owned=await support.openOwnedWorkflowServiceCase(null,issuer==='po_generated'?{issuer,tasks:[{title:'Original cleanup task',assignedAgent:'xiaok-worker',requiredOutputs:['markdown']}]}:{});
 const {createDesktopServices}=await import('../../electron/desktop-services.ts');
 const desktop=createDesktopServices({dataRoot:join(owned.fixture.root,'cleanup-desktop-data'),kswarmService:owned.kswarmService});
 const original=desktop.closeTaskSourceWritersForMigration.bind(desktop);
 let reentered:Promise<void>|undefined,entered=false,closeCalls=0;
 const close=vi.spyOn(desktop,'closeTaskSourceWritersForMigration').mockImplementation(async()=>{closeCalls++;if(!entered){entered=true;reentered=owned.close(desktop);void reentered.catch(()=>{});}await original();throw undefined;});
 const dispose=vi.spyOn(desktop,'disposeMultiAgent');
 let failure:{error:unknown}|undefined;
 let originalFailure:{error:unknown}|undefined;try{throw undefined;}catch(error){originalFailure={error};}
 try{await support.finishOwnedWorkflowServiceCase(owned,desktop,originalFailure);}catch(error){failure={error};}
 const disposed=dispose.mock.calls.length;close.mockRestore();dispose.mockRestore();
 expect(failure).toBeDefined();expect(failure!.error).toBeInstanceOf(AggregateError);
 const error=failure!.error as AggregateError;expect(Object.hasOwn(error,'cause')).toBe(true);expect(error.cause).toBeUndefined();expect(error.errors[0]).toBeUndefined();expect(error.errors[1]).toBeInstanceOf(AggregateError);
 const repeated=owned.close();await expect(repeated).rejects.toBe(error.errors[1]);
 expect(reentered).toBe(repeated);expect(closeCalls).toBe(1);
 expect(disposed).toBe(1);expect(globalThis.fetch).toBe(previous.fetch);
 expect(process.env.XIAOK_CONFIG_DIR).toBe(previous.config);expect(process.env.KSWARM_SERVER_PATH).toBe(previous.entry);expect(process.env.XIAOK_DISABLE_GLOBAL_PLUGINS).toBe(previous.plugins);
 expect(owned.fixture.getOwnedServerState()).toMatchObject({protectionTriggered:false,exitCode:0,signalCode:null});
 expect(existsSync(owned.fixture.root)).toBe(true);
},8000);

it('normal workflow helper preserves an existing private caller configuration',async()=>{
 const prior=process.env.XIAOK_CONFIG_DIR,root=mkdtempSync(join(tmpdir(),'workflow-caller-config-')),config=join(root,'config');
 mkdirSync(config,{mode:0o700});const original=JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}});writeFileSync(join(config,'config.json'),original);
 const support=await import('../support/owned-workflow-normal-case.js');let owned:Awaited<ReturnType<typeof support.openOwnedWorkflowNormalCase>>|undefined,first:{error:unknown}|undefined;
 try{process.env.XIAOK_CONFIG_DIR=config;owned=await support.openOwnedWorkflowNormalCase({project:{id:'caller-config',name:'Caller config',goal:'Read'},workflowName:'caller_config_fixture',phaseTitle:'Read',prompt:'Read',label:'Read'});expect(process.env.XIAOK_CONFIG_DIR).toBe(config);expect(readFileSync(join(config,'config.json'),'utf8')).toBe(original);}catch(error){first={error};}
 const restore=()=>{if(prior===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=prior;rmSync(root,{recursive:true,force:true});};
 if(owned)await support.finishOwnedWorkflowServiceCase(owned,undefined,first,[],[restore]);
 else{restore();if(first)throw first.error;}
},8000);
