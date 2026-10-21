import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {FileTaskSnapshotStore,readCapturedTaskSessions} from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function snapshot(sessionId='s0'):TaskSnapshot{return {taskId:'task',sessionId,status:'running',prompt:'original',materials:[],events:[],createdAt:1,updatedAt:1};}
async function source(){
 const root=mkdtempSync(join(tmpdir(),'solpi-task-captured-'));roots.push(root);const store=new FileTaskSnapshotStore(root),initial=snapshot();
 await store.save(initial);const checkpoint=readFileSync(join(root,'snapshots/task.json'),'utf8');
 await store.save({...initial,sessionId:'s1',updatedAt:2});await store.save({...initial,sessionId:'s2',updatedAt:3});
 const journal=readFileSync(join(root,'snapshots/task.journal.jsonl'),'utf8');return {root,store,initial,checkpoint,journal};
}
it('uses original production journal replay and retains checkpoint and every committed session',async()=>{
 const s=await source();const value=readCapturedTaskSessions(s.checkpoint,s.journal,'task');expect(value).toEqual({taskId:'task',sessionIdentities:['s0','s1','s2']});
 expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(value.sessionIdentities)).toBe(true);
 expect(readFileSync(join(s.root,'snapshots/task.json'),'utf8')).toBe(s.checkpoint);expect(readFileSync(join(s.root,'snapshots/task.journal.jsonl'),'utf8')).toBe(s.journal);
});
it('retains valid checkpointed old frames and verifies the session anchor',async()=>{
 const s=await source();await s.store.save({...s.initial,sessionId:'s2',status:'completed',updatedAt:4});
 const checkpoint=readFileSync(join(s.root,'snapshots/task.json'),'utf8');
 // The terminal checkpoint advances by one; the original writer's complete
 // terminal frame is materialized, so use the preceding sealed checkpoint's
 // sequence for this deliberately retained original journal fixture.
 const value=JSON.parse(checkpoint),records=s.journal.trimEnd().split('\n');value.__xiaokJournal.lastSequence=JSON.parse(records.at(-1)!).sequence;
 expect(readCapturedTaskSessions(JSON.stringify(value),s.journal,'task').sessionIdentities).toEqual(['s1','s2']);
 value.sessionId='mismatched';expect(()=>readCapturedTaskSessions(JSON.stringify(value),s.journal,'task')).toThrow(/captured_task_anchor/);
 const truncated=records[0]+'\n';expect(()=>readCapturedTaskSessions(JSON.stringify({...value,sessionId:'s2'}),truncated,'task')).toThrow(/captured_task_anchor/);
});
it('accepts only genuinely absent legacy metadata and a complete sealed empty journal',async()=>{
 const s=await source();expect(readCapturedTaskSessions(s.checkpoint,'','task').sessionIdentities).toEqual(['s0']);
 expect(readCapturedTaskSessions(JSON.stringify(s.initial),'','task').sessionIdentities).toEqual(['s0']);
 for(const metadata of [null,{}, {version:1,lastSequence:'0',checkpointEventCount:0},{version:1,lastSequence:0,checkpointEventCount:1},{version:1,lastSequence:0,checkpointEventCount:0,extra:true}]){
  expect(()=>readCapturedTaskSessions(JSON.stringify({...s.initial,__xiaokJournal:metadata}),'','task')).toThrow(/captured_task_checkpoint/);
 }
});
it('rejects duplicate JSON keys including escaped nested keys before returning any attribution',async()=>{
 const s=await source();const duplicate=s.checkpoint.replace('"sessionId": "s0"','"sessionId":"hidden", "sessionId": "s0"');expect(duplicate).not.toBe(s.checkpoint);
 expect(()=>readCapturedTaskSessions(duplicate,'','task')).toThrow(/captured_task_duplicate/);
 const nested=JSON.stringify(s.initial).replace('"materials":[]','"materials":[{"id":1,"\\u0069d":2}]');
 expect(()=>readCapturedTaskSessions(nested,'','task')).toThrow(/captured_task_duplicate/);
 const journal=s.journal.replace('"sessionId":"s1"','"sessionId":"hidden","sessionId":"s1"');expect(journal).not.toBe(s.journal);
 expect(()=>readCapturedTaskSessions(s.checkpoint,journal,'task')).toThrow(/captured_task_duplicate/);
});
it('refuses crash tails, blank frames, corrupt checksums, gaps and a foreign selection without changing source',async()=>{
 const s=await source();for(const journal of [s.journal.slice(0,-1),s.journal+'{',s.journal+'\n','\n'])expect(()=>readCapturedTaskSessions(s.checkpoint,journal,'task')).toThrow();
 expect(()=>readCapturedTaskSessions(s.checkpoint,s.journal.replace('s1','tampered'),'task')).toThrow();
 expect(()=>readCapturedTaskSessions(s.checkpoint,s.journal.trimEnd().split('\n').at(-1)!+'\n','task')).toThrow();
 expect(()=>readCapturedTaskSessions(s.checkpoint,s.journal,'foreign')).toThrow();
 expect(readFileSync(join(s.root,'snapshots/task.journal.jsonl'),'utf8')).toBe(s.journal);
});
it('rejects core corruption and unknown source fields instead of asserting a full TaskSnapshot',()=>{
 for(const patch of [{status:'fake'},{events:null},{materials:{}},{prompt:1},{createdAt:-1},{updatedAt:0},{sessionId:''},{taskId:'other'},{ownershipExtension:{sessionId:'hidden'}}]){
  expect(()=>readCapturedTaskSessions(JSON.stringify({...snapshot(),...patch}),'','task')).toThrow();
 }
 expect(()=>readCapturedTaskSessions('{"taskId":"task","sessionId":"s0","events":[]}','','task')).toThrow();
});
it('preserves original C1 identity bytes rather than narrowing the existing ASCII control rule',async()=>{
 const id='s\u0085original';
 expect(readCapturedTaskSessions(JSON.stringify({...snapshot(id),taskId:id}),'',id)).toEqual({taskId:id,sessionIdentities:[id]});
 const s=await source();await s.store.save({...s.initial,sessionId:id,updatedAt:4});
 expect(readCapturedTaskSessions(s.checkpoint,readFileSync(join(s.root,'snapshots/task.journal.jsonl'),'utf8'),'task').sessionIdentities).toContain(id);
});
it('rejects actual writer-produced unknown patch fields and removed session identity',async()=>{
 const s=await source();await s.store.save({...s.initial,sessionId:'s2',ownershipExtension:{sessionId:'hidden'},updatedAt:4} as TaskSnapshot);
 expect(()=>readCapturedTaskSessions(s.checkpoint,readFileSync(join(s.root,'snapshots/task.journal.jsonl'),'utf8'),'task')).toThrow(/captured_task_schema/);
 const second=await source(),without={...second.initial,updatedAt:4} as Partial<TaskSnapshot>;delete without.sessionId;
 await second.store.save(without as TaskSnapshot);
 expect(()=>readCapturedTaskSessions(second.checkpoint,readFileSync(join(second.root,'snapshots/task.journal.jsonl'),'utf8'),'task')).toThrow(/captured_task_session/);
});
