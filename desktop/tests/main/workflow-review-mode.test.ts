// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import {createOwnedWorkflowNetworkFixture} from '../support/owned-workflow-network-fixture.mjs';

it.each([{role:'review',operation:'write'},{role:'review',operation:'edit'},{role:'agent_task',operation:'write'}])('actual workflow $role reads reference and preserves its intended $operation behavior',async({role,operation})=>{
 const fixture=await createOwnedWorkflowNetworkFixture(null,{issuer:role==='review'?'builtin-review':undefined});
 const previous={config:process.env.XIAOK_CONFIG_DIR,entry:process.env.KSWARM_SERVER_PATH,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS,fetch:globalThis.fetch};
 let service:ReturnType<typeof createDesktopServices>|undefined,ks:ReturnType<typeof createKSwarmService>|undefined;
 try{
  const config=join(fixture.root,'config');mkdirSync(config,{recursive:true});
  process.env.XIAOK_CONFIG_DIR=config;process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';
  process.env.KSWARM_SERVER_PATH=resolve(fileURLToPath(new URL('../../../',import.meta.url)),'..','kswarm','src/server/index.js');
  globalThis.fetch=fixture.forwardedFetch;
  writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture',model:'fixture-model'}},channels:{}}));
  const file=join(fixture.workspace.artifacts,'reference.txt');writeFileSync(file,'ORIGINAL');
  let calls=0,actualRead='';vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(messages){
   if(calls===1){const read=messages.flatMap(m=>m.content).find(c=>c.type==='tool_result');actualRead=read?.type==='tool_result'?read.content:'';}
   if(++calls===1)yield {type:'tool_use',id:'read',name:'read',input:{file_path:file}};
   else if(calls===2)yield {type:'tool_use',id:'writing',name:operation,input:operation==='write'?{file_path:file,content:'UPDATED'}:{file_path:file,old_string:'ORIGINAL',new_string:'UPDATED'}};
   else yield {type:'text',delta:JSON.stringify(role==='review'?{reviewDecision:{status:'passed',reason:'reference read',evidenceRefs:[file]},output:{summary:'reference checked'}}:{output:{summary:'ordinary worker wrote its deliverable',artifacts:[{path:file,kind:'text'}]}})};
   yield {type:'done'};
  });
  ks=createKSwarmService({spawnProcess:(()=>{throw Error('fixture_foreign_spawn_denied');}) as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_foreign_kill_denied');}});
  service=createDesktopServices({dataRoot:join(fixture.root,'desktop-data'),kswarmService:ks});
  const dispatch=fixture.issued.dispatches[0];expect(dispatch.nodeKind).toBe(role);
  const result=await service.runKSwarmWorkflowNode({handoff:{...dispatch,project:{...fixture.project,workFolder:fixture.workspace.path}},targetParticipantId:dispatch.targetParticipantId??'xiaok-worker'});
  expect(calls).toBe(3);expect(actualRead).toContain('ORIGINAL');expect(readFileSync(file,'utf8')).toBe(role==='review'?'ORIGINAL':'UPDATED');
  if(role==='review')expect(result.reviewDecision).toMatchObject({status:'passed',reason:'reference read'});else expect(result.output?.summary).toContain('ordinary worker');
 }finally{
  try{if(service){await service.closeTaskSourceWritersForMigration();await service.disposeMultiAgent();}if(ks)await sealAndDrainKSwarmServiceInstance(ks);}
  finally{vi.restoreAllMocks();globalThis.fetch=previous.fetch;for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['KSWARM_SERVER_PATH',previous.entry],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fixture.close();}
 }
},10000);
