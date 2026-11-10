import {describe,it,expect} from 'vitest';
import {LoopStore} from '../../electron/loop-store.js';
import {AssistantActionService} from '../../electron/assistant-action-service.js';
const profileId='default-personal-assistant' as const;
const recommendation={title:'Review task result',reasonCode:'result',evidenceRefs:[{kind:'task_snapshot',id:'actual-task'}],action:{kind:'review' as const,reason:'A result needs review',nextStep:'Read evidence',instruction:'Review the result without changing the task.'}};
function fixture(){
 let now=1000,current=true,vector='a'.repeat(64);
 const store=new LoopStore(':memory:');
 const source=()=>({profileId,runId:'morning-run',sourceVector:vector,recommendations:[recommendation],publishedAt:1000,isCurrent:()=>current});
 const service=new AssistantActionService({store,readSource:async()=>source(),profileId,now:()=>now});
 return {store,service,setNow:(value:number)=>{now=value;},setCurrent:(value:boolean)=>{current=value;},changeSource:()=>{vector='b'.repeat(64);},close:()=>store.close()};
}
describe('main AssistantActionService',()=>{
 it('projects stable fact identity and does not provide execution authority',async()=>{const f=fixture();try{
  const first=await f.service.list({requestSource:'user'}),second=await f.service.list({requestSource:'user'});
  expect(first.proposals).toHaveLength(1);expect(second.proposals[0]).toEqual(first.proposals[0]);
  expect(first.proposals[0]).toMatchObject({schemaVersion:2,revision:1,startAvailability:'unavailable',decision:'open'});
 }finally{f.close();}});
 it('uses revision CAS across two windows and retains a dismissed fact across model/source refresh',async()=>{const f=fixture();try{
  const p=(await f.service.list({requestSource:'user'})).proposals[0]!;
  const result=await f.service.dismiss({proposalId:p.id,expectedRevision:p.revision,requestSource:'user'});
  expect(result.status).toBe('updated');
  expect((await f.service.dismiss({proposalId:p.id,expectedRevision:p.revision,requestSource:'user'})).status).toBe('conflict');
  f.changeSource();expect((await f.service.list({requestSource:'user'})).proposals[0]?.decision).toBe('dismissed');
 }finally{f.close();}});
 it.each(['agent','scheduler'] as const)('rejects %s disposition before changing SQLite',async requestSource=>{const f=fixture();try{
  const p=(await f.service.list({requestSource:'user'})).proposals[0]!;
  await expect(f.service.dismiss({proposalId:p.id,expectedRevision:p.revision,requestSource})).rejects.toThrow('user_only');
  expect((await f.service.list({requestSource:'user'})).proposals[0]).toEqual(p);
 }finally{f.close();}});
 it('requires current source again at disposition rather than trusting the copied row',async()=>{const f=fixture();try{
  const p=(await f.service.list({requestSource:'user'})).proposals[0]!;f.setCurrent(false);
  await expect(f.service.dismiss({proposalId:p.id,expectedRevision:p.revision,requestSource:'user'})).rejects.toThrow('source_unavailable');
  f.setCurrent(true);expect((await f.service.list({requestSource:'user'})).proposals[0]?.decision).toBe('open');
 }finally{f.close();}});
 it('snoozes a fact without changing or executing its underlying task',async()=>{const f=fixture();try{
  const p=(await f.service.list({requestSource:'user'})).proposals[0]!;
  expect((await f.service.snooze({proposalId:p.id,expectedRevision:p.revision,snoozeUntil:2000,requestSource:'user'})).status).toBe('updated');
  expect((await f.service.list({requestSource:'user'})).proposals[0]?.decision).toBe('snoozed');
  f.setNow(2001);expect((await f.service.list({requestSource:'user'})).proposals[0]?.decision).toBe('open');
 }finally{f.close();}});
});

it('projects a genuine ordinary runtime result via current source reader and persisted stores',async()=>{
 const {CompletionEvidenceStore}=await import('../../electron/completion-evidence-store.js');
 const {createAssistantRuntime}=await import('../../electron/assistant-runtime.js');
 const {createAssistantPublicationContextReader}=await import('../../electron/assistant-publication-context.js');
 const store=new LoopStore(':memory:'),evidence=new CompletionEvidenceStore(':memory:');
 try{
  const now=Date.parse('2026-11-01T12:00:00Z');store.ensureBuiltInLoops(now);store.setLoopStatus('personal-assistant-morning-briefing','active',now);
  store.ensureAssistantProfile({id:profileId,status:'active',locale:'en',timeZone:'UTC',eveningTime:'22:30',morningTime:'08:30',workdays:[1,2,3,4,5],quietHours:{start:'23:00',end:'07:00'},dataScopes:['tasks'],createdAt:now,updatedAt:now});
  const runtime=createAssistantRuntime({loopStore:store,evidenceStore:evidence,now:()=>now,collect:()=>({current:{items:[{reference:recommendation.evidenceRefs[0]}]}}),llmPort:{complete:async()=>({text:JSON.stringify({schemaVersion:2,recommendations:[recommendation]})})}});
  expect((await runtime.runLoopNow('personal-assistant-morning-briefing',undefined,undefined,{requestSource:'user'})).status).toBe('success');
  const reader=createAssistantPublicationContextReader({store,evidenceStore:evidence,publication:{readAssistantOutput:async()=>{throw Error('must stay ordinary');}} as never});
  const service=new AssistantActionService({store,profileId,now:()=>now,readSource:()=>reader.readMorningActionSource()});
  const first=(await service.list({requestSource:'user'})).proposals[0]!;
  expect(first.instruction).toBe(recommendation.action.instruction);
  expect((await service.dismiss({proposalId:first.id,expectedRevision:first.revision,requestSource:'user'})).status).toBe('updated');
 }finally{evidence.close();store.close();}
});

it('rolls back a projection when its current guard fails at the commit boundary',()=>{
 const store=new LoopStore(':memory:');
 try{
  let checks=0;
  const source={profileId,runId:'run',sourceVector:'a'.repeat(64),publishedAt:1000,recommendations:[recommendation],isCurrent:()=>++checks<2};
  expect(()=>store.projectAssistantActions(source,1000)).toThrow('source_unavailable');
  const good=store.projectAssistantActions({...source,isCurrent:()=>true},1000);
  expect(good[0]?.revision).toBe(1);
 }finally{store.close();}
});

it('does not promote an unbound late v2 evidence entry into a proposal for a legacy run',async()=>{
 const {CompletionEvidenceStore}=await import('../../electron/completion-evidence-store.js');
 const {createAssistantPublicationContextReader}=await import('../../electron/assistant-publication-context.js');
 const store=new LoopStore(':memory:'),evidence=new CompletionEvidenceStore(':memory:');
 try{
  store.ensureBuiltInLoops(1);store.setLoopStatus('personal-assistant-morning-briefing','active',1);
  const begin=store.beginLoopRun('personal-assistant-morning-briefing',{kind:'manual'},2,1000,{requestSource:'user'});
  if(begin.status!=='started')throw Error('fixture');
  store.finishAssistantLoopRunSuccess(begin.run.id,['original-evidence'],3,'Legacy result');
  evidence.insertEvidence({ownerKind:'loop_run',ownerId:begin.run.id,kind:'log_diagnostic',summary:'Late entry',metadata:{assistantKind:'morning',output:{schemaVersion:2,recommendations:[recommendation]}},now:4});
  const reader=createAssistantPublicationContextReader({store,evidenceStore:evidence,publication:{} as never});
  const service=new AssistantActionService({store,profileId,now:()=>5,readSource:source=>reader.readMorningActionSource(source)});
  expect((await service.list({requestSource:'user'})).proposals).toEqual([]);
 }finally{evidence.close();store.close();}
});
