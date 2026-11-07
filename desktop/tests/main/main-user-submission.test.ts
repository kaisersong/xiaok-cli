// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {MainUserSubmissionOwner} from '../../electron/main-user-submission.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const dataRoot=mkdtempSync(join(tmpdir(),'main-submission-'));roots.push(dataRoot);const options={dataRoot,profileId:'profile',workspaceId:'workspace'};return {options,owner:new MainUserSubmissionOwner(options),actor:{requestSource:'user' as const,actorId:'desktop-user:profile'},wire:{action:'submit_new' as const,gestureId:randomUUID(),input:{kind:'materials' as const,prompt:'create project',materials:[],context:{threadId:'thread'}}}};}
it('merges 100 concurrent technical retries and observes the same task after ACK loss and owner reopen',async()=>{
 const f=fixture();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 const produce=vi.fn(async()=>{f.owner.beginEffects();await gate;return {taskId:'actual-native-task'};});
 const pending=Array.from({length:100},()=>f.owner.submit(f.wire,f.actor,produce));release();const values=await Promise.all(pending);
 expect(produce).toHaveBeenCalledOnce();expect(new Set(values.map(v=>v.submissionId)).size).toBe(1);
 const reopened=new MainUserSubmissionOwner(f.options);const replay=await reopened.submit({action:'retry_existing',submissionId:values[0].submissionId},f.actor,produce);
 expect(replay).toEqual(values[0]);expect(produce).toHaveBeenCalledOnce();
 await reopened.submit({...f.wire,gestureId:randomUUID()},f.actor,produce);expect(produce).toHaveBeenCalledTimes(2);
 const records=readdirSync(join(f.options.dataRoot,'conversation-projects','user-submissions')).filter(name=>name.endsWith('.json'));
 expect(records).toHaveLength(2);expect(records.map(name=>readFileSync(join(f.options.dataRoot,'conversation-projects','user-submissions',name),'utf8')).join('')).not.toContain('create project');
});
it.each([
 {prompt:'different'}, {context:{threadId:'other'}}, {permissionMode:'plan'}, {materials:[{materialId:'other'}]},
])('rejects changed same-gesture input before consuming a second task: %j',async change=>{
 const f=fixture();const produce=vi.fn(async()=>({taskId:'actual-task'}));await f.owner.submit(f.wire,f.actor,produce);
 await expect(f.owner.submit({...f.wire,input:{...f.wire.input,...change}},f.actor,produce)).rejects.toThrow('user_submission_conflict');expect(produce).toHaveBeenCalledOnce();
});
it('validates user source and current profile before reading any input property',()=>{
 const f=fixture();let reads=0;const raw={get action(){reads++;throw Error('getter');}};const produce=vi.fn();
 for(const actor of [undefined,{requestSource:'agent',actorId:f.actor.actorId},{requestSource:'scheduler',actorId:f.actor.actorId},{requestSource:'user',actorId:'desktop-user:other'}])expect(()=>f.owner.submit(raw,actor as never,produce)).toThrow('user_submission_actor_forbidden');
 expect(reads).toBe(0);expect(produce).not.toHaveBeenCalled();
});
it('retries a settled preemption only when no native/file effect started',async()=>{
 const f=fixture();const first=vi.fn(async()=>{throw Error('goal_user_turn_waiting_for_preemption');});
 await expect(f.owner.submit(f.wire,f.actor,first)).rejects.toThrow('goal_user_turn_waiting_for_preemption');
 await expect(f.owner.submit(f.wire,f.actor,async()=>({taskId:'original'}))).resolves.toMatchObject({taskId:'original'});
});
it('does not turn post-effect failures or cross-instance preparing into a second task',async()=>{
 const f=fixture();await expect(f.owner.submit(f.wire,f.actor,async()=>{f.owner.beginEffects();throw Error('goal_user_turn_waiting_for_preemption');})).rejects.toThrow('goal_user_turn_waiting_for_preemption');
 const produce=vi.fn();await expect(f.owner.submit(f.wire,f.actor,produce)).rejects.toThrow('user_submission_reconciliation_required');
 const reopened=new MainUserSubmissionOwner(f.options);await expect(reopened.submit(f.wire,f.actor,produce)).rejects.toThrow('user_submission_reconciliation_required');expect(produce).not.toHaveBeenCalled();
});
it('cannot retry a captured but unprepared submission without its original input',async()=>{
 const f=fixture();let submissionId='';await expect(f.owner.submit(f.wire,f.actor,async()=>{submissionId=f.owner.currentIdentity()!.submissionId;throw Error('preemption');})).rejects.toThrow('preemption');
 const produce=vi.fn();await expect(f.owner.submit({action:'retry_existing',submissionId},f.actor,produce)).rejects.toThrow('user_submission_not_prepared');expect(produce).not.toHaveBeenCalled();
});
it('uses canonical object ordering while preserving array boundaries and exact path spelling',async()=>{
 const f=fixture();const produce=vi.fn(async()=>({taskId:'task'}));await f.owner.submit(f.wire,f.actor,produce);
 await f.owner.submit({input:{context:{threadId:'thread'},materials:[],prompt:'create project',kind:'materials'},gestureId:f.wire.gestureId,action:'submit_new'},f.actor,produce);expect(produce).toHaveBeenCalledOnce();
 const files={action:'submit_new' as const,gestureId:randomUUID(),input:{kind:'files' as const,prompt:'x',filePaths:['a','b']}};
 await f.owner.submit(files,f.actor,produce);
 await expect(f.owner.submit({...files,input:{...files.input,filePaths:['ab']}},f.actor,produce)).rejects.toThrow('user_submission_conflict');
 const windows={...files,gestureId:randomUUID(),input:{...files.input,filePaths:['C:\\a\\b']}};await f.owner.submit(windows,f.actor,produce);
 await expect(f.owner.submit({...windows,input:{...windows.input,filePaths:['C:/a/b']}},f.actor,produce)).rejects.toThrow('user_submission_conflict');
});
it('strict retry wire cannot supply replacement body, permissions, source or target',async()=>{
 const f=fixture();const value=await f.owner.submit(f.wire,f.actor,async()=>({taskId:'task'}));
 for(const extra of [{prompt:'new'},{permissionMode:'auto'},{requestSource:'user'},{targetProjectId:'other'}])await expect(f.owner.submit({action:'retry_existing',submissionId:value.submissionId,...extra},f.actor,vi.fn())).rejects.toThrow('user_submission_input_invalid');
});
it('a corrupt existing record remains an explicit fault and is never replaced',async()=>{
 const f=fixture();await f.owner.submit(f.wire,f.actor,async()=>({taskId:'task'}));const dir=join(f.options.dataRoot,'conversation-projects','user-submissions'),file=join(dir,readdirSync(dir).find(n=>n.endsWith('.json'))!);writeFileSync(file,'{"broken":');
 const reopened=new MainUserSubmissionOwner(f.options);const produce=vi.fn();await expect(reopened.submit(f.wire,f.actor,produce)).rejects.toThrow('user_submission_record_invalid');expect(readFileSync(file,'utf8')).toBe('{"broken":');expect(produce).not.toHaveBeenCalled();
});

it('normalizes the original thread/material identifiers before the first hash or native effect',async()=>{
 const f=fixture();const produce=vi.fn(async(input)=>{expect(input.context).toEqual({threadId:'thread',taskIds:['prior']});return {taskId:'task'};});
 await f.owner.submit({...f.wire,input:{...f.wire.input,context:{threadId:' thread ',taskIds:[' prior ']}}},f.actor,produce);
 await f.owner.submit({...f.wire,input:{...f.wire.input,context:{threadId:'thread',taskIds:['prior']}}},f.actor,produce);expect(produce).toHaveBeenCalledOnce();
});
it.each([{gestureId:'invalid'},{input:{kind:'materials',prompt:'x',materials:[],permissionMode:'bypassPermissions'}},{input:{kind:'files',prompt:'x',filePaths:[],materials:[]}}])('invalid wire never creates a captured record: %j',async change=>{
 const f=fixture(),produce=vi.fn();await expect(f.owner.submit({...f.wire,...change},f.actor,produce)).rejects.toThrow('user_submission_input_invalid');expect(produce).not.toHaveBeenCalled();expect(readdirSync(join(f.options.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
});
it('retry observation remains scoped to the current trusted workspace/profile',async()=>{
 const f=fixture();const result=await f.owner.submit(f.wire,f.actor,async()=>({taskId:'task'}));const produce=vi.fn();
 const otherWorkspace=new MainUserSubmissionOwner({...f.options,workspaceId:'other'});await expect(otherWorkspace.submit({action:'retry_existing',submissionId:result.submissionId},f.actor,produce)).rejects.toThrow('user_submission_not_found');
 const otherProfile=new MainUserSubmissionOwner({...f.options,profileId:'other'});await expect(otherProfile.submit({action:'retry_existing',submissionId:result.submissionId},{requestSource:'user',actorId:'desktop-user:other'},produce)).rejects.toThrow('user_submission_not_found');expect(produce).not.toHaveBeenCalled();
});
