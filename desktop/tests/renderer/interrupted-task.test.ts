import{expect,it}from'vitest';
import{readTaskInterruption}from'../../renderer/src/lib/interrupted-task';
import type{TaskSnapshot,DesktopTaskEvent}from'../../shared/task-types';
const q:Extract<DesktopTaskEvent,{type:'needs_user'}>={type:'needs_user',question:{taskId:'A',questionId:'qa',kind:'freeform',prompt:'Synthetic',choices:[{id:'one',label:'One'}]}};
const scope={threadId:'thread',taskId:'A'};
function s(events:DesktopTaskEvent[]=[q,{type:'error',message:'app_shutdown'},{type:'task_terminal',status:'failed'}]):TaskSnapshot{return{taskId:'A',sessionId:'s',status:'failed',prompt:'QA',materials:[],events,createdAt:1,updatedAt:1,context:{threadId:'thread'}};}
it('derives only presentation metadata from the exact failed task and thread',()=>{expect(readTaskInterruption(s(),scope)).toEqual({taskId:'A',choices:q.question.choices});expect(readTaskInterruption(s(),{...scope,taskId:'B'})).toBeNull();expect(readTaskInterruption(s(),{...scope,threadId:'foreign'})).toBeNull();expect(readTaskInterruption({...s(),context:undefined},scope)).toBeNull();});
it.each(['running','waiting_user','completed','cancelled']as const)('ignores %s state',status=>expect(readTaskInterruption({...s(),status},scope)).toBeNull());
it('compares the last error message exactly, without substring matching',()=>{for(const message of ['app_shutdown extra','other','provider_failed'])expect(readTaskInterruption(s([q,{type:'error',message:'app_shutdown'},{type:'error',message}]),scope)).toBeNull();});
it('does not offer an answered, foreign or approval question as continuation choices',()=>{for(const e of [[q,{type:'question_resolved',questionId:'qa',answerText:'One'}],[{...q,question:{...q.question,taskId:'foreign'}}],[{...q,question:{...q.question,kind:'confirm_understanding'}}]] as DesktopTaskEvent[][])expect(readTaskInterruption(s([...e,{type:'error',message:'app_shutdown'}]),scope)).toEqual({taskId:'A'});});
it('never falls back to an older question after the latest one is answered',()=>{expect(readTaskInterruption(s([q,{...q,question:{...q.question,questionId:'new'}},{type:'question_resolved',questionId:'new',answerText:'done'},{type:'error',message:'app_shutdown'}]),scope)).toEqual({taskId:'A'});});

it('restores draft choices for the exact prior-boot recovery reason',()=>{expect(readTaskInterruption(s([q,{type:'error',message:'multi_agent_prepare_interrupted'},{type:'task_terminal',status:'failed'}]),scope)).toEqual({taskId:'A',choices:q.question.choices});expect(readTaskInterruption(s([q,{type:'error',message:'multi_agent_prepare_interrupted extra'}]),scope)).toBeNull();});
