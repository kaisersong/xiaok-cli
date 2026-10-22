// @vitest-environment node
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repositoryRoot=process.env.XIAOK_WORKFLOW_TEST_REPO_ROOT||fileURLToPath(new URL('../../../',import.meta.url));
import {it,expect,vi} from 'vitest';
import {writeFileSync,readFileSync,mkdirSync,realpathSync} from 'node:fs';import {join} from 'node:path';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';
vi.mock('electron',()=>({app:{isPackaged:false}}));
const cases=[{permissions:null,desiredReadonly:false},{permissions:{toolCategories:['read_project_state','write_artifact']},desiredReadonly:false},{permissions:{toolCategories:['read_project_state']},desiredReadonly:true},{permissions:null,desiredReadonly:true,issuer:'builtin-smoke'}];
it.each(cases)('actual issuer/network/main/native effects permissions=$permissions desiredReadonly=$desiredReadonly',async({permissions,desiredReadonly,issuer})=>{
 const fixture=await createOwnedWorkflowNetworkFixture(permissions,{issuer});let ks,desktop;const restore=[];let calls=0,actualRead='';
 const previous={config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};
 try{
 expect(new URL(fixture.base).hostname).toBe('127.0.0.1');expect(new URL(fixture.base).port).not.toBe('4400');
 const config=join(fixture.root,'config');mkdirSync(config,{recursive:true});writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));
 process.env.XIAOK_CONFIG_DIR=config;process.env.KSWARM_SERVER_PATH=realpathSync(resolve(repositoryRoot,'..','kswarm','src/server/index.js'));process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';globalThis.fetch=fixture.forwardedFetch;
 const ksModule=await import('../../electron/kswarm-service.ts');ks=ksModule.createKSwarmService({spawnProcess:(()=>{throw Error('fixture_foreign_spawn_denied');}) as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_foreign_kill_denied');}});
 const {createDesktopServices}=await import('../../electron/desktop-services.ts');const {OpenAIAdapter}=await import('../../../src/ai/adapters/openai.ts');
 const file=join(fixture.workspace.artifacts,'reference.txt');writeFileSync(file,'ORIGINAL');
 const mock=vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(messages){if(calls===1){const read=messages.flatMap(m=>m.content).find(c=>c.type==='tool_result');actualRead=read?.type==='tool_result'?read.content:'';}if(++calls===1)yield {type:'tool_use',id:'read',name:'read',input:{file_path:file}};else if(calls===2)yield {type:'tool_use',id:'writing',name:'write',input:{file_path:file,content:'UPDATED'}};else yield {type:'text',delta:JSON.stringify({output:{summary:'ordinary worker wrote local artifact',artifacts:[{path:file,kind:'text'}]}})};yield {type:'done'};});restore.push(()=>mock.mockRestore());
 desktop=createDesktopServices({dataRoot:join(fixture.root,'desktop-data'),kswarmService:ks});
 const result=await desktop.runKSwarmWorkflowNode({handoff:{...fixture.issued.dispatches[0],project:{id:fixture.project.id,name:fixture.project.name,goal:fixture.project.goal,workFolder:fixture.workspace.path}},targetParticipantId:'xiaok-worker'});
 expect(calls).toBe(3);expect(actualRead).toContain('ORIGINAL');expect(result.output?.summary).toContain('ordinary worker wrote');
 expect(readFileSync(file,'utf8')).toBe(desiredReadonly?'ORIGINAL':'UPDATED');
 expect(fixture.requestLog.every(row=>row.ownedTarget===fixture.base||row.ownedTarget===fixture.brokerBase)).toBe(true);
 expect(fixture.requestLog.filter(row=>new URL(row.originalOrigin).port==='4400').every(row=>row.ownedTarget===fixture.base)).toBe(true);
 console.log(JSON.stringify({privateBase:fixture.base,requestLog:fixture.requestLog,actualRegisteredService:true,actualHubIssuer:true,actualHTTP:true,permissions,desiredReadonly,providerCalls:calls,fileEffect:readFileSync(file,'utf8')}));
 }finally{
 for(const fn of restore)fn();if(desktop){await desktop.closeTaskSourceWritersForMigration();await desktop.disposeMultiAgent();}if(ks){const module=await import('../../electron/kswarm-service.ts');await module.sealAndDrainKSwarmServiceInstance(ks);}
 globalThis.fetch=fixture.nativeFetch;for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fixture.close();
 }
},8000);
