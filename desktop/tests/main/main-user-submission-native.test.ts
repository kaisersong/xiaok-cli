// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
vi.mock('node:worker_threads',async load=>{const native=await load<typeof import('node:worker_threads')>();return {...native,Worker:class extends native.Worker{constructor(path:string|URL,options?:import('node:worker_threads').WorkerOptions){super(String(path).endsWith('/delivery-verifier-worker.js')?new URL('../../../dist/runtime/task-host/delivery-verifier-worker.js',import.meta.url):path,options);}}};});
it.each(['materials','files'] as const)('the actual Main %s submission prepares and starts one original native task across concurrent retries and reopen',async kind=>{
 const root=mkdtempSync(join(tmpdir(),'main-native-submission-')),config=join(root,'config'),dataRoot=join(root,'data'),workspace=join(root,'workspace');mkdirSync(config);mkdirSync(workspace);
 const previous={config:process.env.XIAOK_CONFIG_DIR,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS,activity:process.env.XIAOK_CONVERSATION_ACTIVITY};process.env.XIAOK_CONFIG_DIR=config;process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';process.env.XIAOK_CONVERSATION_ACTIVITY='0';
 writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture-only',model:'fixture'}},defaultMode:'interactive',channels:{}}));
 const file=join(workspace,'input.txt');writeFileSync(file,'Original user material.');let modelCalls=0;
 const stream=vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){modelCalls++;const dir=join(dataRoot,'conversation-projects','user-submissions'),records=readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(join(dir,n),'utf8')));expect(records).toHaveLength(1);expect(['prepared','accepted']).toContain(records[0].phase);expect(records[0].prepared.taskId).toBe(records[0].taskId);yield {type:'text',delta:'The original task has finished.'};yield {type:'done'};});
 const options={dataRoot,workspaceRoot:workspace,knowledgeDbPath:join(root,'knowledge.db'),kswarmService:{request:vi.fn(async()=>Response.json({agents:[],projects:[]})),getDesktopMutationToken:()=> 'fixture-only',getStatus:()=>({running:false}),onStatusChange:()=>()=>{}} as never};
 let services:ReturnType<typeof createDesktopServices>|undefined;
 try {
  services=createDesktopServices(options);const actor={requestSource:'user' as const,actorId:`desktop-user:${services.multiAgent!.profileId}`};
  const input=kind==='files'?{kind,prompt:'Summarize the material.',filePaths:[file],context:{threadId:'user-thread'}}:{kind,prompt:'Say hello.',materials:[],context:{threadId:'user-thread'}};
  const wire={action:'submit_new' as const,gestureId:randomUUID(),input};const values=await Promise.all(Array.from({length:100},()=>services!.submitUserTask(wire,actor)));
  expect(new Set(values.map(v=>v.taskId)).size).toBe(1);expect(new Set(values.map(v=>v.submissionId)).size).toBe(1);
  const factDir=join(dataRoot,'conversation-projects','user-inputs');const facts=readdirSync(factDir).filter(n=>n.endsWith('.json')&&!n.startsWith('canonical-')).map(n=>JSON.parse(readFileSync(join(factDir,n),'utf8')));
  expect(facts).toHaveLength(1);expect(facts[0]).toMatchObject({schemaVersion:3,sourceFamily:'main_user_submission',submissionId:values[0].submissionId,taskId:values[0].taskId});expect(facts[0]).not.toHaveProperty('sourceGoalId');
  const deadline=Date.now()+10000;let snapshot;for(;;){snapshot=(await services.recoverTask(values[0].taskId)).snapshot;if(['completed','failed','cancelled'].includes(snapshot.status))break;if(Date.now()>deadline)throw Error('original_task_not_settled');await new Promise(r=>setTimeout(r,10));}
  expect(snapshot.status).toBe('completed');expect(modelCalls).toBe(1);if(kind==='files')expect(snapshot.materials).toHaveLength(1);
  if(kind==='files'){
    const recheck=vi.fn(()=>{throw Error('sender_revoked_after_file_selection');});
    await expect(services.submitUserTask({...wire,gestureId:randomUUID()},actor,recheck)).rejects.toThrow('sender_revoked_after_file_selection');
    expect(recheck).toHaveBeenCalledOnce();expect(modelCalls).toBe(1);
  }
  const taskId=values[0].taskId;services.goalShutdown.ingress.stopAccepting();expect(await services.goalShutdown.ingress.drain(3000)).toBe(true);await services.closeTaskSourceWritersForMigration();await services.disposeMultiAgent();services=undefined;
  services=createDesktopServices(options);await services.multiAgent!.ready;expect(await services.submitUserTask({action:'retry_existing',submissionId:values[0].submissionId},actor)).toEqual({taskId,submissionId:values[0].submissionId});expect(modelCalls).toBe(1);
  await expect(services.submitUserTask({...wire,input:{...input,prompt:'changed'}},actor)).rejects.toThrow('user_submission_conflict');expect(modelCalls).toBe(1);
 }finally{
  if(services){services.goalShutdown.ingress.stopAccepting();await services.goalShutdown.ingress.drain(3000);await services.closeTaskSourceWritersForMigration();await services.disposeMultiAgent();}stream.mockRestore();
  for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins],['XIAOK_CONVERSATION_ACTIVITY',previous.activity]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(root,{recursive:true,force:true});
 }
},20000);
