// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {createKSwarmService,computeKSwarmServiceSourceHash,sealAndDrainKSwarmServiceInstance,type KSwarmService} from '../../electron/kswarm-service.js';
const roots:string[]=[];const prior=process.env.XIAOK_CONFIG_DIR;
const registeredServices:Array<{service:KSwarmService;requests:Array<{port:string;path:string}>}>=[];
// Ordinary transport/file leaves only. The service and its opaque read port are
// created by the real factory; no service copy, request replacement or issuer.
function fixtureKSwarm(root:string):KSwarmService {
 const workFolder=join(root,'project');mkdirSync(workFolder,{recursive:true});
 const serverDir=join(root,'kswarm','src','server');mkdirSync(serverDir,{recursive:true});
 const entryPath=join(serverDir,'index.js');writeFileSync(entryPath,'// Test file leaf; never spawned.\n');
 writeFileSync(join(serverDir,'room-workspace-protocol.json'),JSON.stringify({component:'kswarm',protocols:{room_workspace_v1:{contextVersion:1,resultVersion:1,releaseVersion:1}}}));
 vi.stubEnv('KSWARM_SERVER_PATH',entryPath);
 const sourceHash=computeKSwarmServiceSourceHash(entryPath),requests:Array<{port:string;path:string}>=[];
 const scriptSource="export const meta = { name: 'workflow' };\nphase('Original');",scriptHash=createHash('sha256').update(scriptSource).digest('hex');
 vi.stubGlobal('fetch',async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||!['4400','4318'].includes(url.port)||url.search||url.hash||(init?.method??(typeof input==='object'&&'method' in input?input.method:'GET')).toUpperCase()!=='GET')throw Error('fixture_unowned_fetch_denied');
  requests.push({port:url.port,path:url.pathname});
  if(url.pathname==='/health')return Response.json(url.port==='4400'?{ok:true,features:['dynamic_workflows'],service:{entryPath,sourceHash}}:{ok:true});
  // Seed reconciliation is outside TaskHost tests; an unavailable read does not
  // fabricate agents or permit a POST. Every other unlisted request is denied.
  if(url.port==='4400'&&url.pathname==='/agents')return new Response('{}',{status:503});
  if(url.port==='4400'&&url.pathname==='/projects/project')return Response.json({project:{id:'project',workFolder:realpathSync(workFolder)},workspace:{path:realpathSync(workFolder)}});
  const match=url.port==='4400'?/^\/projects\/project\/workflows\/(run(?:-[0-4])?)$/.exec(url.pathname):null;
  if(match){const runId=match[1];return Response.json({workflowRun:{id:runId,projectId:'project',workflowId:'workflow',status:'running',source:'script_generated',spec:null,scriptSource,scriptHash,scriptMeta:{name:'workflow'},permissions:null,nodes:[{id:'node',kind:'agent_task',status:'running',attempt:1,assignedAgent:'xiaok-worker',runtime:{runId,handoffId:'handoff'+runId.slice(3),participantId:'xiaok-worker'},input:{script:{workflowId:'workflow',workflowRunId:runId,scriptHash,nodeId:'node'}}}]}});}
  throw Error('fixture_unlisted_fetch_denied');
 });
 const service=createKSwarmService({spawnProcess:()=>{throw Error('fixture_external_spawn_denied');},findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_external_kill_denied');}});
 registeredServices.push({service,requests});return service;
}
afterEach(async()=>{
 const errors:unknown[]=[],ownedRoots=roots.splice(0);
 // Drain the actual registered instance/read-port/timer owner before restoring
 // its transport or removing files. Original body errors remain Vitest errors.
 for(const {service,requests} of registeredServices.splice(0).reverse())try{await sealAndDrainKSwarmServiceInstance(service);console.info('task-source-fixture '+JSON.stringify({registeredFactory:true,simulatedTransport:true,nativeOSQualification:false,closed:true,requests}));}catch(error){errors.push(error);}
 for(const restore of [()=>vi.restoreAllMocks(),()=>vi.unstubAllGlobals(),()=>vi.unstubAllEnvs(),()=>{if(prior===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=prior;}])try{restore();}catch(error){errors.push(error);}
 if(!errors.length)for(const root of ownedRoots)try{rmSync(root,{recursive:true,force:true});}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'task_source_fixture_cleanup_unknown; retainedRoots='+JSON.stringify(ownedRoots));
});
it('closes the actual standard and dynamic KSwarm Host population after the original workflow tail',async()=>{
 const root=mkdtempSync(join(tmpdir(),'main-task-population-'));roots.push(root);process.env.XIAOK_CONFIG_DIR=join(root,'config');
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const service=createDesktopServices({dataRoot:join(root,'data'),kswarmService:fixtureKSwarm(root),
 runner:async input=>{entered();await wait;await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:'turn',intentId:'intent',stepId:'step',note:JSON.stringify({output:{summary:'original completed',artifacts:[]}})});}});
 const handoff={projectId:'project',workflowRunId:'run',workflowId:'workflow',nodeId:'node',nodeKind:'agent_task' as const,nodeTitle:'normal node',attempt:1,handoffId:'handoff',project:{id:'project',name:'project',goal:'normal workflow',status:'active',workFolder:join(root,'project')},input:{prompt:'complete normal workflow'}};
 const running=service.runKSwarmWorkflowNode({handoff});await ready;
 const closeStore=vi.spyOn(FileTaskSnapshotStore.prototype,'closeAndDrain');const closing=service.closeTaskSourceWritersForMigration();expect(service.closeTaskSourceWritersForMigration()).toBe(closing);
 try{await Promise.resolve();expect(closeStore).not.toHaveBeenCalled();await expect(service.runKSwarmWorkflowNode({handoff})).rejects.toThrow('task_source_population_closing');await expect(service.createTask({prompt:'new standard task',materials:[]})).rejects.toThrow('task_source_closing');}
 finally{release();}
 await running;await closing;expect(closeStore).toHaveBeenCalledTimes(1);await service.disposeMultiAgent();
},30_000);
for(const entry of ['workflow','handoff'] as const)for(const failure of ['missing','read-failure'] as const)it(`reports original ${entry} ${failure} instead of repairing or accepting a missing snapshot`,async()=>{
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 const root=mkdtempSync(join(tmpdir(),'main-task-read-'));roots.push(root);process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const service=createDesktopServices({dataRoot:join(root,'data'),kswarmService:fixtureKSwarm(root),runner:async()=>{}});
 const inspect=vi.spyOn(InProcessTaskRuntimeHost.prototype,'inspectTask');if(failure==='missing')inspect.mockResolvedValue(null);else inspect.mockRejectedValue(Error('original_snapshot_read_failed'));
 const run=entry==='workflow'?service.runKSwarmWorkflowNode({handoff:{projectId:'project',workflowRunId:'run',workflowId:'workflow',nodeId:'node',nodeKind:'agent_task',nodeTitle:'normal',attempt:1,handoffId:'handoff',project:{id:'project',name:'project',goal:'normal',status:'active',workFolder:join(root,'project')},input:{prompt:'normal'}}}):service.runKSwarmHandoffTask({handoff:{kind:'kswarm_task_handoff_v1',runId:'run',project:{id:'project',name:'project',goal:'normal',requirements:''},task:{id:'task',title:'normal'}}});
 try{await expect(run).rejects.toThrow(failure==='missing'?'desktop_task_snapshot_missing':'original_snapshot_read_failed');}finally{inspect.mockRestore();await service.closeTaskSourceWritersForMigration();await service.disposeMultiAgent();}
});
it('returns to the original standard and Codex Hosts after five actual KSwarm workflow calls',async()=>{
 const hostModule=await import('../../../src/runtime/task-host/task-runtime-host.js');const create=hostModule.createTaskSourceWriterPopulation;let population:ReturnType<typeof create>|undefined;
 vi.spyOn(hostModule,'createTaskSourceWriterPopulation').mockImplementation(store=>{population=create(store);return population;});
 const root=mkdtempSync(join(tmpdir(),'main-task-retirement-'));roots.push(root);process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const service=createDesktopServices({dataRoot:join(root,'data'),kswarmService:fixtureKSwarm(root),runner:async input=>{await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:'turn',intentId:'intent',stepId:'step',note:JSON.stringify({output:{summary:'original completed',artifacts:[]}})});}});
 expect(population?.retainedHostCount).toBe(2);
 for(let i=0;i<5;i++){await service.runKSwarmWorkflowNode({handoff:{projectId:'project',workflowRunId:`run-${i}`,workflowId:'workflow',nodeId:'node',nodeKind:'agent_task',nodeTitle:'normal',attempt:1,handoffId:`handoff-${i}`,project:{id:'project',name:'project',goal:'normal',status:'active',workFolder:join(root,'project')},input:{prompt:'normal'}}});expect(population?.retainedHostCount).toBe(2);}
 await service.closeTaskSourceWritersForMigration();await service.disposeMultiAgent();
},30_000);
it('preserves the original workflow read error together with an actual retirement IO failure',async()=>{
 const {InProcessTaskRuntimeHost}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 const root=mkdtempSync(join(tmpdir(),'main-task-retire-failure-'));roots.push(root);process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const service=createDesktopServices({dataRoot:join(root,'data'),kswarmService:fixtureKSwarm(root),runner:async()=>{}});
 vi.spyOn(InProcessTaskRuntimeHost.prototype,'inspectTask').mockRejectedValue(Error('original_workflow_read_failed'));
 const save=FileTaskSnapshotStore.prototype.save;vi.spyOn(FileTaskSnapshotStore.prototype,'save').mockImplementation(function(this:FileTaskSnapshotStore,...args){if(args[0].status==='completed'||args[0].status==='failed')return Promise.reject(Error('actual_terminal_io_failed'));return save.apply(this,args);});
 const result=await service.runKSwarmWorkflowNode({handoff:{projectId:'project',workflowRunId:'run',workflowId:'workflow',nodeId:'node',nodeKind:'agent_task',nodeTitle:'normal',attempt:1,handoffId:'handoff',project:{id:'project',name:'project',goal:'normal',status:'active',workFolder:join(root,'project')},input:{prompt:'normal'}}}).catch(error=>error);
 expect(result).toBeInstanceOf(AggregateError);expect(result.errors[0].message).toBe('original_workflow_read_failed');expect(result.errors[1].message).toBe('task_source_close_unconfirmed');
 await expect(service.closeTaskSourceWritersForMigration()).rejects.toThrow('task_source_close_unconfirmed');await service.disposeMultiAgent();
});
it('waits the actual Codex Host preparation before the shared store closes',async()=>{
 const {CodexTaskBridge}=await import('../../electron/codex-task-bridge.js');const {createTaskSourceWriterPopulation}=await import('../../../src/runtime/task-host/task-runtime-host.js');
 const root=mkdtempSync(join(tmpdir(),'codex-source-population-'));roots.push(root);process.env.XIAOK_CONFIG_DIR=join(root,'config');const store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store),materials=new (await import('../../../src/runtime/task-host/material-registry.js')).MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024});
 population.createHost({materialRegistry:materials,runner:async()=>{}});
 const bridge=new CodexTaskBridge({dataRoot:root,profileId:'actual-user',cwd:root,materialRegistry:materials,snapshotStore:store,sourcePopulation:population});
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);const save=store.save.bind(store);let first=true;vi.spyOn(store,'save').mockImplementation(async(...args)=>{if(first){first=false;entered();await wait;}return save(...args);});
 const preparing=bridge.host.prepareTask({prompt:'actual Codex writer',materials:[]});await ready;const close=vi.spyOn(store,'closeAndDrain');const closing=population.close();await Promise.resolve();const prematurelyClosed=close.mock.calls.length>0;release();
 try{const task=await preparing;await closing;expect(prematurelyClosed).toBe(false);expect(population.retainedHostCount).toBe(2);expect((await store.recoverTask(task.taskId))?.events.map(event=>event.type)).toEqual(['task_started','understanding_updated']);}finally{await bridge.dispose();}
});
