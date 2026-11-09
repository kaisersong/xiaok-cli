// @vitest-environment node
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import * as transport from '../../../src/platform/mcp/transport.js';
import * as kb from '../../electron/kb-store-sqlite.js';
import {isOriginalDesktopManagedAgentSession,disposeOriginalDesktopManagedAgentSession,DesktopManagedAgentSession} from '../../electron/desktop-managed-agent-session.js';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {PluginProviderRuntimeFacade} from '../../electron/plugin-provider-runtime-facade.js';
import type {KSwarmService} from '../../electron/kswarm-service.js';
import {writeFileSync} from 'node:fs';
import {compileVerifierEntry} from '../fixtures/desktop-post-seal-verifier-contract.js';
const worker=vi.hoisted(()=>({root:'',output:'',starts:0,exits:0}));
vi.mock('node:worker_threads',async original=>{
 const actual=await original<typeof import('node:worker_threads')>();const {preserveNativeWorkerGetters}=await import('../support/native-worker-fixture.js');
 const source=new URL('../../../src/runtime/task-host/delivery-verifier-worker.js',import.meta.url).href;
 return {...actual,Worker:preserveNativeWorkerGetters(actual.Worker,class extends actual.Worker{
  constructor(file:ConstructorParameters<typeof actual.Worker>[0],options?:ConstructorParameters<typeof actual.Worker>[1]){
   const mapped=String(file)===source;if(mapped&&!worker.output)throw Error('fixture_worker_not_ready');super(mapped?worker.output:file,options);
   if(mapped){worker.starts++;this.once('exit',()=>{worker.exits++;});}
  }
 })};
});
beforeAll(async()=>{Object.assign(worker,await compileVerifierEntry('delivery-verifier-worker.ts'));});
afterAll(()=>{expect(worker.exits).toBe(worker.starts);if(worker.root)rmSync(worker.root,{recursive:true,force:true,maxRetries:3});});
const cleanup:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{
 const failures:unknown[]=[];for(const action of cleanup.splice(0).reverse()){try{await action();}catch(error){failures.push(error);}}
 vi.restoreAllMocks();vi.unstubAllEnvs();if(failures.length)throw new AggregateError(failures,'fixture_cleanup_unconfirmed',{cause:failures[0]});
});
function setup(){
 const root=mkdtempSync(join(tmpdir(),'managed-resource-service-'));let physicallyClosed=false;
 cleanup.push(()=>{if(physicallyClosed)rmSync(root,{recursive:true,force:true,maxRetries:3});});
 const config=join(root,'config');mkdirSync(config,{mode:0o700});vi.stubEnv('XIAOK_CONFIG_DIR',config);vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS','1');
 const originalKb=kb.createKbStoreSqlite;vi.spyOn(kb,'createKbStoreSqlite').mockImplementation(()=>originalKb(join(root,'knowledge.sqlite')));
 const calls:string[]=[];vi.spyOn(transport,'createMcpClientConnection').mockImplementation(async()=>({protocolEra:'modern',close:async()=>{},dispose:()=>{},getStderrTail:()=>'',getChildPid:()=>null,
  client:{getServerCapabilities:()=>({tools:{}}),listTools:async()=>({tools:[{name:'probe',inputSchema:{type:'object'}}]}),setNotificationHandler:()=>{},callTool:async(input:unknown)=>{calls.push(JSON.stringify(input));return {content:[{type:'text',text:'MCP_OK'}]};}}
 } as unknown as transport.McpClientConnection));
 const plugin=join(root,'plugins','fixture');mkdirSync(plugin,{recursive:true});writeFileSync(join(plugin,'plugin.json'),JSON.stringify({name:'fixture',version:'1',mcpServers:[{name:'generic',type:'stdio',command:process.execPath,args:[],protocol:{mode:'modern',version:'2026-07-28'}}]}));
 const provider=new PluginProviderRuntimeFacade();cleanup.push(()=>provider.dispose());
 const kswarmService={start:async()=>{},stop:async()=>{},restart:async()=>{},getStatus:()=>({running:false,port:0,pid:null,restartCount:0,lastError:null}),onStatusChange:()=>()=>{},getDesktopMutationToken:()=> 'fixture',request:async()=>new Response('{}',{status:503})} as unknown as KSwarmService;
 const services=createDesktopServices({dataRoot:join(root,'data'),knowledgeDbPath:join(root,'knowledge.sqlite'),workspaceRoot:root,pluginRootDir:join(root,'plugins'),pluginDependencies:[],kswarmService,pluginProviderRuntime:provider});
 cleanup.push(async()=>{const result=await services.disposeMultiAgent();if(!result.drained){console.log(JSON.stringify({kind:'retained-unconfirmed-service-fixture',root,drained:result.drained}));throw Error('fixture_service_close_unconfirmed');}physicallyClosed=true;});
 return {root,services,calls};
}
it('actual resident child accepts a user followup after Root completion, then full migration closes both populations',async()=>{
 const f=setup(),registration=await f.services.registerMcpTools();cleanup.push(()=>registration.dispose());await f.services.saveModelConfig({providerId:'kimi',apiKey:'fixture'},undefined,'user');
 let rootTurns=0,childTurns=0,childId='';
 vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(messages,_defs,system){
  yield {type:'thinking',delta:'',reasoningProvenance:{captureVersion:1,source:'reasoning_content',fieldPresence:'present'}};
  if(system?.includes('Assigned Desktop agent:')){if(++childTurns%2)yield {type:'tool_use',id:'child-'+childTurns,name:'mcp__generic__probe',input:{turn:childTurns}};else yield {type:'text',delta:'child completed'};}
  else if(++rootTurns===1)yield {type:'tool_use',id:'spawn',name:'spawn_agent',input:{task_name:'fixture',message:'independent child',fork_context:false}};
  else if(rootTurns===2){const result=messages.flatMap(row=>row.content).find(row=>row.type==='tool_result'&&row.tool_use_id==='spawn');if(result?.type!=='tool_result')throw Error('missing_spawn');childId=JSON.parse(String(result.content)).targetAgentId;yield {type:'tool_use',id:'wait',name:'wait_agent',input:{targets:[childId],timeout_ms:1000}};}
  else yield {type:'text',delta:'root completed'};
 });
 const task=await f.services.createTask({prompt:'Delegate and finish.',materials:[],context:{threadId:'resident-followup'}});
 await vi.waitFor(async()=>expect((await f.services.recoverTask(task.taskId)).snapshot.status).toBe('completed'),{timeout:5000});
 const boundary=f.services.multiAgent!,service=boundary.service;
 const access=service.createUserAccess({requestSource:'user',actorId:'user',threadId:'resident-followup',profileId:boundary.profileId,workspaceId:boundary.workspaceId});
 const snapshot=service.getSnapshot({access}),child=snapshot.agents.find(row=>row.id===childId)!;
 expect(child.status).toBe('completed');expect(child.turn).toBe(1);expect(f.calls).toHaveLength(1);
 const result=await service.userFollowup({access,requestSource:'user',groupId:snapshot.group!.groupId,agentId:childId,expectedTurn:1,operationId:'post-root-user',message:'Run a fresh independent probe.'});expect(result.state).toBe('queued_next_admission');
 await vi.waitFor(()=>{const next=service.getSnapshot({access}).agents.find(row=>row.id===childId)!;expect(next.turn).toBe(2);expect(next.status).toBe('completed');},{timeout:5000});
 expect(f.calls).toHaveLength(2);expect(childTurns).toBe(4);
 await f.services.closeTaskSourceWritersForMigration();
 await expect(service.userFollowup({access,requestSource:'user',groupId:snapshot.group!.groupId,agentId:childId,expectedTurn:2,operationId:'after-close',message:'must not run'})).rejects.toThrow();
 expect(f.calls).toHaveLength(2);
});

it('fixed Session consumer rejects a copied prototype and Proxy before any private receiver property is read',()=>{
 const fake=Object.create(DesktopManagedAgentSession.prototype);expect(isOriginalDesktopManagedAgentSession(fake)).toBe(false);expect(()=>disposeOriginalDesktopManagedAgentSession.call(fake)).toThrow('TASK_MANAGED_SESSION_REQUIRED');
 let traps=0;const proxy=new Proxy({},{get(){traps++;throw Error('unexpected_session_property_read');}});expect(isOriginalDesktopManagedAgentSession(proxy)).toBe(false);expect(()=>disposeOriginalDesktopManagedAgentSession.call(proxy)).toThrow('TASK_MANAGED_SESSION_REQUIRED');expect(traps).toBe(0);
});
