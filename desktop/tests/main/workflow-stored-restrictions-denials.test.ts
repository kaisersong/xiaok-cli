// @vitest-environment node
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
import {it,expect,vi} from 'vitest';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron',()=>({app:{isPackaged:false}}));
const cases=['unknown_category','wrong_kind','wrong_attempt','wrong_handoff','wrong_participant','wrong_run','wrong_node','wrong_root','cancelled'] as const;
it.each(cases)('actual fresh restrictions deny $0 before allocating a provider',async(reason)=>{
 const fixture=await createOwnedWorkflowNetworkFixture(reason==='unknown_category'?{toolCategories:['future_tool']}:null);let ks,desktop;const restore=[];let calls=0;
 const previous={config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 try{
 const config=join(fixture.root,'config');mkdirSync(config,{recursive:true});writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));
 process.env.XIAOK_CONFIG_DIR=config;process.env.KSWARM_SERVER_PATH=resolve(repositoryRoot,'..','kswarm','src/server/index.js');process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';globalThis.fetch=fixture.forwardedFetch;
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
 console.log(JSON.stringify({reason,actualHTTP:true,actualIssuer:true,providerCalls:calls,fileEffect:'ORIGINAL'}));
 }finally{
 for(const fn of restore)fn();if(desktop){await desktop.closeTaskSourceWritersForMigration();await desktop.disposeMultiAgent();}if(ks){const module=await import('../../electron/kswarm-service.ts');await module.sealAndDrainKSwarmServiceInstance(ks);}
 globalThis.fetch=fixture.nativeFetch;for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fixture.close();
 }
},8000);
