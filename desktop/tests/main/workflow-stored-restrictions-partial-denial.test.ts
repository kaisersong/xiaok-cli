// @vitest-environment node
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
import {it,expect,vi} from 'vitest';
import {writeFileSync,readFileSync,mkdirSync,realpathSync} from 'node:fs';import {join} from 'node:path';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron',()=>({app:{isPackaged:false}}));
const cases=[null,{toolCategories:['read_project_state','write_artifact']}];
it.each(cases)('real existing aggregate partial write denial wins over node permissions $0',async(permissions)=>{
 const fixture=await createOwnedWorkflowNetworkFixture(permissions,{partialRunWriteDeny:true});let ks,desktop;const restore=[];let calls=0;
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
 const fresh=await (await fixture.nativeFetch(fixture.base+'/projects/'+fixture.project.id+'/workflows/'+handoff.workflowRunId)).json();expect(fresh.workflowRun.permissions).toEqual({allowWrite:false});
 await expect(desktop.runKSwarmWorkflowNode({handoff,targetParticipantId:'xiaok-worker'})).rejects.toThrow('workflow_stored_restrictions_denied');
 expect(calls).toBe(0);expect(readFileSync(file,'utf8')).toBe('ORIGINAL');
 expect(fixture.requestLog.every(row=>row.ownedTarget===fixture.base||row.ownedTarget===fixture.brokerBase)).toBe(true);
 expect(fixture.requestLog.filter(row=>new URL(row.originalOrigin).port==='4400').every(row=>row.ownedTarget===fixture.base)).toBe(true);
 console.log(JSON.stringify({privateBase:fixture.base,requestLog:fixture.requestLog,permissions,aggregate:{allowWrite:false},actualHTTP:true,actualIssuer:true,providerCalls:calls,fileEffect:'ORIGINAL'}));
 }finally{
 for(const fn of restore)fn();if(desktop){await desktop.closeTaskSourceWritersForMigration();await desktop.disposeMultiAgent();}if(ks){const module=await import('../../electron/kswarm-service.ts');await module.sealAndDrainKSwarmServiceInstance(ks);}
 globalThis.fetch=fixture.nativeFetch;for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fixture.close();
 }
},8000);
