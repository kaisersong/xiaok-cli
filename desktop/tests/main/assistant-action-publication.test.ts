import {it,expect,vi} from 'vitest';
import {LoopStore} from '../../electron/loop-store.js';
import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {createAssistantRuntime} from '../../electron/assistant-runtime.js';
import {ASSISTANT_MORNING_LOOP_ID,DEFAULT_PERSONAL_ASSISTANT_ID} from '../../electron/assistant-types.js';

it('stages the actual validated v2 model output through the formal protected producer without losing action text',async()=>{
 const store=new LoopStore(':memory:'),evidence=new CompletionEvidenceStore(':memory:');
 try{
  const now=Date.parse('2026-11-01T12:00:00Z');store.ensureBuiltInLoops(now);
  store.ensureAssistantProfile({id:DEFAULT_PERSONAL_ASSISTANT_ID,status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1,2,3,4,5],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks'],createdAt:now,updatedAt:now});
  store.setLoopStatus(ASSISTANT_MORNING_LOOP_ID,'active',now);
  store.saveLoopPublicationConfiguration({loopId:ASSISTANT_MORNING_LOOP_ID,expectedRevision:null,requestSource:'user',now,configuration:{version:1,contract:{kind:'assistant',assistantKind:'morning',objective:'Prepare source-backed suggestions',completionCriterion:'Valid current publication'},verificationDefinitions:{run:{version:1,obligations:[{obligationId:'result',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]},stages:{}}}});
  const output={schemaVersion:2,recommendations:[{title:'Review the task',reasonCode:'result',evidenceRefs:[{kind:'task_snapshot',id:'real'}],action:{kind:'review',reason:'There is a result',nextStep:'Inspect evidence',instruction:'Review the task evidence. Do not change the task.'}}]};
  const complete=vi.fn().mockResolvedValue({text:JSON.stringify(output)});
  const runtime=createAssistantRuntime({loopStore:store,evidenceStore:evidence,llmPort:{complete},now:()=>now,collect:()=>({current:{items:[{reference:{kind:'task_snapshot',id:'real'}}]}})});
  const result=await runtime.runLoopNow(ASSISTANT_MORNING_LOOP_ID,undefined,undefined,{requestSource:'user'});
  expect(result.status).toBe('publication_pending');
  const runId=store.listLoopRuns(ASSISTANT_MORNING_LOOP_ID,1)[0]!.id;
  const candidates=store.recoverLoopPublicationCandidates({runId,requestSource:'user'});
  expect(candidates).toHaveLength(1);
  expect(candidates[0]!.binding.body).toMatchObject({kind:'assistant-morning',...output});
  // A staged body is not approved/current business publication or task execution.
  expect(evidence.listEvidenceForOwner('loop_run',runId)).toEqual([]);
  expect(complete).toHaveBeenCalledOnce();
 }finally{evidence.close();store.close();}
});
