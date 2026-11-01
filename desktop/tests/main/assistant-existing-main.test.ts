import fs from 'node:fs';
// @vitest-environment node
import {SqliteGoalStore} from '../../electron/goal-store-sqlite.js';
import {createGoalState} from '../../../src/runtime/goal/reducer.js';
// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';import type {AddressInfo} from 'node:net';
import {createDesktopServices} from '../../electron/desktop-services.js';
import type {KSwarmService} from '../../electron/kswarm-service.js';
it('actual default foreground services preserve assistant Goal authority and reserved Goal scope',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'assistant-existing-main-')));const workspace=join(root,'workspace');mkdirSync(workspace);
 vi.stubEnv('XIAOK_CONFIG_DIR',join(root,'config'));vi.stubEnv('XIAOK_CONVERSATION_ACTIVITY','0');vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS','1');
 let requests=0;
 const server=createServer((req,res)=>{let body='';req.setEncoding('utf8');req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{requests++;const input=JSON.parse(body);const message='Fixture evidence reviewed.';
 if(input.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:input.model,choices:[{index:0,delta:{content:message},finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:input.model,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}})}\n\ndata: [DONE]\n\n`);}else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'fixture',object:'chat.completion',model:input.model,choices:[{index:0,message:{role:'assistant',content:message},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}}));}});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const kswarm={getStatus:()=>({running:false,port:0,pid:null,restartCount:0,lastError:null}),onStatusChange:()=>()=>{},request:async()=>new Response('{}',{status:501}),getDesktopMutationToken:()=> 'fixture'} as unknown as KSwarmService;
 const services=createDesktopServices({dataRoot:join(root,'data'),workspaceRoot:workspace,kswarmService:kswarm});
 let taskId:string|undefined;
 try{
 expect(services.multiAgent).not.toBeNull();await services.multiAgent!.ready;
 await services.saveModelConfig({providerId:'openai',apiKey:'fixture-key',modelName:'gpt-4o-mini',baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`},undefined,'user');
 const threadId=randomUUID();const created=await services.createGoal({threadId,objective:'Review real evidence',completionCriterion:'Read and explain evidence',expectedEvidenceKinds:['answer'],turnLimit:3});
 await services.setGoalUserQueuePending({threadId,pending:true});await services.setGoalUserQueuePending({threadId,pending:false});
 const domain=await services.assistantTaskAdmission.domain();
 const target=await services.assistantThreadTargets.prepare(threadId,domain);expect(target.goalBinding?.state.goalId).toBe(created.goal.state.goalId);
 const binding={operationId:randomUUID(),requestDigest:'a'.repeat(64),threadId},instruction='Review the existing evidence and summarize it.';
 await services.assistantThreadTargets.confirmGoalConsent!(target,{instruction,requestDigest:binding.requestDigest,checked:true});
 const allocation=services.assistantTaskAdmission.allocate(binding);taskId=allocation.taskId;let commits=0;
 await services.assistantTaskAdmission.ensure({...binding,taskId,instruction,domain,allocation,goalConsent:target.goalBinding!},()=>{commits++;},()=>services.assistantThreadTargets.assertCurrent(target));
 await vi.waitFor(()=>expect(commits).toBe(1),{timeout:10000});
 const snapshot=await services.assistantTaskAdmission.lookup(taskId);expect(snapshot?.assistantBinding).toEqual(binding);expect(snapshot?.executionScope).toMatchObject({kind:'goal_turn',goalId:created.goal.state.goalId,epoch:created.goal.state.epoch,origin:'user'});expect(snapshot?.multiAgentPreparation).toBeTruthy();
 await vi.waitFor(()=>expect(requests).toBeGreaterThan(0),{timeout:10000});
 for await(const event of services.subscribeTask(taskId)){if(event.type==='task_terminal')break;}
 await vi.waitFor(async()=>expect((await services.getGoal(threadId))?.state.turnsUsed).toBe(1),{timeout:10000});
 await services.setGoalUserQueuePending({threadId,pending:true});
 }finally{
 if(taskId)try{await services.assistantTaskAdmission.cancel?.(taskId);}catch{}
 try{await services.disposeMultiAgent();await services.closeTaskSourceWritersForMigration();}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}
 }
},30000);
it('actual existing no-Goal first-group preparation must not invalidate its own final guard',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'assistant-existing-main-no-goal-')));const workspace=join(root,'workspace');mkdirSync(workspace);
 vi.stubEnv('XIAOK_CONFIG_DIR',join(root,'config'));vi.stubEnv('XIAOK_CONVERSATION_ACTIVITY','0');vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS','1');
 const kswarm={getStatus:()=>({running:false,port:0,pid:null,restartCount:0,lastError:null}),onStatusChange:()=>()=>{},request:async()=>new Response('{}',{status:501}),getDesktopMutationToken:()=> 'fixture'} as unknown as KSwarmService;
 const services=createDesktopServices({dataRoot:join(root,'data'),workspaceRoot:workspace,kswarmService:kswarm});let taskId:string|undefined;
 try{
 await services.multiAgent!.ready;const owner=services.multiAgent!;const threadId=randomUUID();
 await owner.service.registerThreadWithOwnership({threadId,profileId:owner.profileId,workspaceId:owner.workspaceId,cwd:owner.cwd},'user');
 const port=services.assistantTaskAdmission,domain=await port.domain(),target=await services.assistantThreadTargets.prepare(threadId,domain);expect(target.noGoalGuard).toBeTruthy();
 const binding={operationId:randomUUID(),requestDigest:'b'.repeat(64),threadId},allocation=port.allocate(binding);taskId=allocation.taskId;let commits=0;
 await port.ensure({...binding,taskId,instruction:'Read existing evidence.',domain,allocation},()=>{commits++;},()=>services.assistantThreadTargets.assertCurrent(target));
 const finalGuard=(()=>{try{services.assistantThreadTargets.assertCurrent(target);return null;}catch(error){return error instanceof Error?error.message:String(error);}})();
 console.info('actual-main-no-goal-final-guard',JSON.stringify({initialThreadRevision:target.revision,finalGuard,commits}));
 expect(finalGuard).toBeNull();
 await vi.waitFor(()=>expect(commits).toBe(1),{timeout:1000});
 for await(const event of services.subscribeTask(taskId)){if(event.type==='task_terminal')break;}
 }finally{
 if(taskId)try{await services.assistantTaskAdmission.cancel?.(taskId);}catch{}
 try{await services.disposeMultiAgent();try{await services.closeTaskSourceWritersForMigration();}catch(error){console.warn('no-goal-source-close',error);}}finally{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}
 }
},10000);

it('actual main final guard rejects a sibling Goal writer without any threadRevision change',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'assistant-existing-main-peer-'))),workspace=join(root,'workspace');mkdirSync(workspace);
 vi.stubEnv('XIAOK_CONFIG_DIR',join(root,'config'));vi.stubEnv('XIAOK_CONVERSATION_ACTIVITY','0');vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS','1');
 const kswarm={getStatus:()=>({running:false,port:0,pid:null,restartCount:0,lastError:null}),onStatusChange:()=>()=>{},request:async()=>new Response('{}',{status:501}),getDesktopMutationToken:()=> 'fixture'} as unknown as KSwarmService;
 const dataRoot=join(root,'data'),services=createDesktopServices({dataRoot,workspaceRoot:workspace,kswarmService:kswarm});let peer:SqliteGoalStore|undefined;
 try{
 await services.multiAgent!.ready;const owner=services.multiAgent!,threadId=randomUUID();
 await owner.service.registerThreadWithOwnership({threadId,profileId:owner.profileId,workspaceId:owner.workspaceId,cwd:owner.cwd},'user');
 const domain=await services.assistantTaskAdmission.domain(),target=await services.assistantThreadTargets.prepare(threadId,domain);
 expect(()=>services.assistantThreadTargets.assertCurrent(target)).not.toThrow();
 peer=new SqliteGoalStore(join(dataRoot,'goals','goals.sqlite'));
 const next=createGoalState({sessionId:threadId,objective:'Sibling actual Goal',expectedEvidenceKinds:['answer'],turnLimit:3,now:Date.now()});
 await peer.commit({sessionId:threadId,expectedRevision:null,next,events:[],turns:[],evidence:[]});
 expect(()=>services.assistantThreadTargets.assertCurrent(target)).toThrow('goal_consent_stale');
 }finally{peer?.close();try{await services.disposeMultiAgent();await services.closeTaskSourceWritersForMigration();}finally{vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}}
},10000);
