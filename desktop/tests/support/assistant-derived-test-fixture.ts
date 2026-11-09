import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLoopDatabaseOwnerGroup,openLoopDatabase} from '../../electron/loop-database-owner.js';
import {LoopStore} from '../../electron/loop-store.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {AssistantCalendarSource} from '../../electron/assistant-calendar-source.js';
import {AssistantYzjClient} from '../../electron/assistant-yzj-cli.js';
import {createAssistantDerivedMainPorts} from '../../electron/assistant-derived-main.js';
import {createAssistantRuntime} from '../../electron/assistant-runtime.js';
import {createAssistantCandidatePromotionTargets} from '../../electron/assistant-controller.js';
import {createLoopBusinessPublicationHost} from '../../electron/loop-business-publication-host.js';
import {ASSISTANT_MORNING_LOOP_ID,ASSISTANT_EVENING_LOOP_ID,DEFAULT_PERSONAL_ASSISTANT_ID} from '../../electron/assistant-types.js';
import type {MemoryRecord,MemoryStore} from '../../../src/ai/memory/store.js';
/** SDK data port, not a Native/physical-known fixture. All Store, evidence,
 * user-promotion, Source, Runtime and publication reads use production code. */
export function assistantDerivedFixture(){
 const root=mkdtempSync(join(tmpdir(),'assistant-derived-')),path=join(root,'loop.sqlite'),group=createLoopDatabaseOwnerGroup([path]),source=group.sources[0]!,lease=openLoopDatabase(source),store=new LoopStore(source),evidence=new CompletionEvidenceStore(source),now=Date.parse('2026-11-09T00:00:00Z');
 store.ensureBuiltInLoops(now);for(const id of [ASSISTANT_MORNING_LOOP_ID,ASSISTANT_EVENING_LOOP_ID])store.setLoopStatus(id,'active',now);
 const profile=store.ensureAssistantProfile({id:DEFAULT_PERSONAL_ASSISTANT_ID,status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks'],createdAt:now,updatedAt:now});
 const records=new Map<string,MemoryRecord>();let recalls=0,beforeRecall:(()=>Promise<void>)|undefined;
 const memory:MemoryStore={async save(record){records.set(record.id,structuredClone(record));},getById:id=>records.has(id)?structuredClone(records.get(id)!):undefined,async listRelevant(){recalls++;await beforeRecall?.();return [...records.values()].map(record=>structuredClone(record));}};
 let title='Design review',projectPath:string|undefined=root;
 const calendar=new AssistantCalendarSource({store,cloud:new AssistantYzjClient({run:async args=>args[0]==='whoami'?{success:true,data:{orgId:'test-org',openId:'test-self'}}:{success:true,data:{list:[{id:'calendar-one',title,startDate:now+3600000,endDate:now+7200000,timeZone:'UTC'}],count:1,more:false}}})});
 const ports=createAssistantDerivedMainPorts({store,evidenceStore:evidence,publication:{} as never,calendarSource:calendar,memoryStore:()=>memory,dataRoot:root,cwd:()=>root,projectCwd:id=>id==='owned-project'?projectPath:undefined});
 const targets=createAssistantCandidatePromotionTargets({memoryStore:memory,memoryBackend:'layered',kbStore:{} as never,now:()=>now});
 const host=createLoopBusinessPublicationHost({store,assertAdmission(){},now:()=>now,assistantTargets:targets,assistantProjectCwd:id=>id==='owned-project'?projectPath:undefined});
 async function seedAccepted(project=false){
  const begin=store.beginLoopRun(ASSISTANT_EVENING_LOOP_ID,{kind:'manual'},now-1000,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('test_begin');
  const [candidate]=store.stageAssistantCandidates(begin.run.id,[{kind:'memory',title:'Preferred preparation',content:'Use concise notes',scope:project?'project':'global',...(project?{projectId:'owned-project'}:{}),confidence:1,evidenceRefs:[{kind:'task',id:'task-evidence'}],dedupeKey:'notes'}],now-999);
  evidence.upsertExpectation({ownerKind:'loop_run',ownerId:begin.run.id,expectedKinds:['log_diagnostic'],source:'scheduler_executor_contract',confidence:'explicit',now:now-998});
  evidence.insertEvidence({ownerKind:'loop_run',ownerId:begin.run.id,kind:'log_diagnostic',summary:'Completed preference source',metadata:{findings:['completed'],assistantKind:'evening',output:{summary:'Completed preference source',candidates:[]}},now:now-997});
  const completion=evidence.completeOwnerWithEvidence({ownerKind:'loop_run',ownerId:begin.run.id,now:now-996});store.finishAssistantLoopRunSuccess(begin.run.id,completion.evidenceIds,now-995,'Completed preference source');
  const accepted=await host.acceptAssistantCandidate({candidateId:candidate!.id,requestSource:'user'});if(!accepted.targetId)throw Error('test_memory_target');return {candidateId:accepted.id,record:records.get(accepted.targetId)!,runId:begin.run.id,evidenceIds:completion.evidenceIds};
 }
 async function connect(){await calendar.enable({requestSource:'user'});await calendar.collect({now,requestSource:'user'});}
 async function run(inspect?:(snapshot:any)=>void|Promise<void>){
  return createAssistantRuntime({loopStore:store,evidenceStore:evidence,derived:ports.derived,now:()=>now,collect:async()=>ports.contextReader.buildMorningContext({snapshot:{items:[]},pinnedThreadIds:[]}),llmPort:{complete:async input=>{const value=JSON.parse(input.userMessage);await inspect?.(value);return {text:JSON.stringify({recommendations:[{title:'Read the notes',reasonCode:'preparation',evidenceRefs:[{kind:'task',id:'task-evidence'}]}]})};}}}).runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'});
 }
 return {root,path,group,lease,store,evidence,calendar,memory,records,ports,profile,now,seedAccepted,connect,run,get recalls(){return recalls;},holdRecall(fn:()=>Promise<void>){beforeRecall=fn;},changeTitle(value:string){title=value;},moveProject(value:string|undefined){projectPath=value;},async close(){const errors:unknown[]=[];for(const close of [()=>host.close(),()=>calendar.close(),()=>evidence.close(),()=>store.close(),()=>lease.close(),()=>group.close()])try{await close();}catch(raw){errors.push(raw);}if(errors.length)throw new AggregateError(errors,'test_close',{cause:errors[0]});rmSync(root,{recursive:true,force:true});}};
}
