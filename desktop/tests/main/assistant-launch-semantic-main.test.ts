// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import {LoopStore} from '../../electron/loop-store.js';
import {AssistantLaunchService} from '../../electron/assistant-launch-service.js';
vi.mock('node:worker_threads',async load=>{const {preserveNativeWorkerGetters}=await import('../support/native-worker-fixture.js');const native=await load<typeof import('node:worker_threads')>();return {...native,Worker:preserveNativeWorkerGetters(native.Worker,class extends native.Worker{constructor(path:string|URL,options?:import('node:worker_threads').WorkerOptions){super(String(path).endsWith('/delivery-verifier-worker.js')?new URL('../../../dist/runtime/task-host/delivery-verifier-worker.js',import.meta.url):path,options);}})};});
it('confirmed assistant work enters the original Main semantic journal once and observes its actual prepared Source and terminal task',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'assistant-semantic-main-'))),config=join(root,'config'),dataRoot=join(root,'data'),workspace=join(root,'workspace');mkdirSync(config,{mode:0o700});mkdirSync(workspace,{mode:0o700});
 const previous=new Map(['XIAOK_CONFIG_DIR','XIAOK_DISABLE_GLOBAL_PLUGINS','XIAOK_CONVERSATION_ACTIVITY'].map(key=>[key,process.env[key]]));process.env.XIAOK_CONFIG_DIR=config;process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';process.env.XIAOK_CONVERSATION_ACTIVITY='0';
 writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture-only',model:'fixture'}},defaultMode:'interactive',channels:{}}));
 let calls=0;const stream=vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){calls++;const records=readdirSync(join(dataRoot,'conversation-projects','user-submissions')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(join(dataRoot,'conversation-projects','user-submissions',n),'utf8')));expect(records).toHaveLength(1);expect(records[0].prepared.taskId).toBe(records[0].taskId);yield {type:'text',delta:'Original assistant work complete.'};yield {type:'done'};});
 let services:ReturnType<typeof createDesktopServices>|undefined,loop:LoopStore|undefined,launch:AssistantLaunchService|undefined,first:{raw:unknown}|undefined;
 try{
  services=createDesktopServices({dataRoot,workspaceRoot:workspace,knowledgeDbPath:join(root,'knowledge.sqlite'),kswarmService:{request:vi.fn(async()=>Response.json({agents:[],projects:[]})),getDesktopMutationToken:()=> 'fixture-only',getStatus:()=>({running:false}),onStatusChange:()=>()=>{}} as never});
  loop=new LoopStore(join(root,'loop.sqlite'));const now=Date.now();
  const source=()=>({profileId:'default-personal-assistant' as const,runId:'ordinary-fixture-publication',publishedAt:now,sourceVector:'a'.repeat(64),recommendations:[{title:'Read evidence',reasonCode:'result',evidenceRefs:[{kind:'task_snapshot',id:'published-source-task'}],action:{kind:'review' as const,reason:'Read current evidence',nextStep:'Read',instruction:'Review this evidence without modifying the original data.'}}],isCurrent:()=>true});
  const proposal=loop.projectAssistantActions(source(),now)[0]!;launch=new AssistantLaunchService({store:loop,port:services.assistantTaskAdmission,threadTargets:services.assistantThreadTargets,readSource:async()=>source(),isSourceLaunchable:()=>true,now:()=>now});
  const draft=await launch.prepare({proposalId:proposal.id,expectedRevision:proposal.revision,requestSource:'user'}),input={draftId:draft.id,instruction:draft.instruction,requestSource:'user' as const};
  for(const requestSource of ['agent','scheduler'] as const)await expect(launch.confirm({...input,requestSource})).rejects.toThrow('user_only');
  const [a,b]=await Promise.all([launch.confirm(input),launch.confirm(input)]);expect(a.operationId).toBe(b.operationId);expect(a.taskId).toBeTruthy();expect(a.submissionId).toContain(a.operationId);// Original semantic submission may return while Host understanding is pending.

  expect(await services.assistantTaskAdmission.matches(a)).toBe(true);await expect(services.assistantTaskAdmission.matches({...a,submissionId:'forged:'+a.operationId})).rejects.toThrow();
  const deadline=Date.now()+10000;for(;;){const snapshot=await services.assistantTaskAdmission.lookup(a.taskId!);if(snapshot&&['completed','failed','cancelled'].includes(snapshot.status)){if(snapshot.status!=='completed')console.error('assistant_actual_terminal',JSON.stringify({status:snapshot.status,events:snapshot.events.slice(-5)}));expect(snapshot.status).toBe('completed');break;}if(Date.now()>deadline)throw Error('original_task_not_settled');await new Promise(resolve=>setTimeout(resolve,10));}
  const actual=(await launch.get({draftId:draft.id,requestSource:'user'})).operation!;expect(actual.state).toBe('attached');expect(actual.taskId).toBe(a.taskId);expect(actual.taskStatus).toBe('completed');expect(actual.resultDigest).toMatch(/^[a-f0-9]{64}$/);expect(calls).toBe(1);
  await launch.confirm(input);expect(calls).toBe(1);await expect(launch.confirm({...input,instruction:'different'})).rejects.toThrow('conflict');
  const factDir=join(dataRoot,'conversation-projects','user-inputs'),facts=readdirSync(factDir).filter(n=>n.endsWith('.json')&&!n.startsWith('canonical-')).map(n=>JSON.parse(readFileSync(join(factDir,n),'utf8')));expect(facts).toHaveLength(1);expect(facts[0]).toMatchObject({sourceFamily:'main_user_submission',taskId:a.taskId,submissionId:a.submissionId});
 }catch(raw){first={raw};throw raw;}finally{
  const failures:unknown[]=[];for(const close of [async()=>{await launch?.close();},async()=>{if(services){services.goalShutdown.ingress.stopAccepting();if(!await services.goalShutdown.ingress.drain(3000))throw Error('assistant_main_fixture_drain_unknown');}},async()=>{await services?.closeTaskSourceWritersForMigration();},async()=>{await services?.disposeMultiAgent();},async()=>{loop?.close();}])try{await close();}catch(raw){failures.push(raw);}
  stream.mockRestore();for(const [key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  if(!failures.length)rmSync(root,{recursive:true});if(first){if(failures.length)throw new AggregateError([first.raw,...failures],'assistant_main_fixture_unknown',{cause:first.raw});}else if(failures.length)throw new AggregateError(failures,'assistant_main_fixture_unknown',{cause:failures[0]});
 }
},20000);
