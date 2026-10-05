import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const state=vi.hoisted(()=>({kind:'unavailable' as string,verification:'needs_revalidation' as string,calls:0}));
vi.mock('../../../src/runtime/verification/installed-completion-observation.js',()=>{const read=()=>{state.calls++;return state.kind==='protected'?{kind:'protected',state:{owner:{profileId:'profile',ownerKind:'task',ownerId:'task'},migrationEpoch:1,businessRevision:1,obligationSetRevision:1,obligationSetHash:'a'.repeat(64),obligationCount:1,currentVerification:state.verification}}:{kind:state.kind};};return {observeInstalledCompletion:async()=>read(),observeInstalledCompletionSync:read};});
import {FileTaskSnapshotStore,recoverTaskSnapshotSync} from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});state.kind='unavailable';state.verification='needs_revalidation';state.calls=0;});
function fixture(){const root=mkdtempSync(join(tmpdir(),'task-current-'));roots.push(root);const snapshot:TaskSnapshot={taskId:'task',sessionId:'session',status:'completed',prompt:'done',materials:[],events:[],createdAt:1,updatedAt:2};return {root,snapshot,store:new FileTaskSnapshotStore(root)};}
it('strips caller completion state from durable snapshots and refreshes both cached and reopened reads',async()=>{
 const f=fixture();await f.store.save({...f.snapshot,currentCompletion:{kind:'protected',state:{currentVerification:'valid'}}} as TaskSnapshot);
 expect(readFileSync(join(f.root,'snapshots/task.json'),'utf8')).not.toContain('currentCompletion');
 expect((await f.store.recoverTask('task'))?.currentCompletion).toEqual({kind:'unavailable'});
 state.kind='protected';const first=await f.store.recoverTask('task');expect(first?.status).toBe('completed');expect(first?.currentCompletion?.kind).toBe('protected');
 state.verification='valid';const second=await f.store.recoverTask('task');expect(second?.currentCompletion).toMatchObject({state:{currentVerification:'valid'}});
 state.kind='unavailable';expect(recoverTaskSnapshotSync(f.root,'task')?.currentCompletion).toEqual({kind:'unavailable'});expect((await new FileTaskSnapshotStore(f.root).recoverTask('task'))?.currentCompletion).toEqual({kind:'unavailable'});
 expect(state.calls).toBe(5);
});
it('keeps ordinary execution snapshots compatible without accepting a persisted verification field',async()=>{
 const f=fixture();state.kind='ordinary';await f.store.save(f.snapshot);expect(await f.store.recoverTask('task')).toEqual(f.snapshot);expect(recoverTaskSnapshotSync(f.root,'task')).toEqual(f.snapshot);
});

it('overrides legacy disk observations and rejects a mismatched task identity',async()=>{
 const f=fixture();mkdirSync(join(f.root,'snapshots'),{recursive:true});
 writeFileSync(join(f.root,'snapshots/task.json'),JSON.stringify({...f.snapshot,currentCompletion:{kind:'protected',state:{currentVerification:'valid'}}}));
 expect((await f.store.recoverTask('task'))?.currentCompletion).toEqual({kind:'unavailable'});
 state.kind='protected';const read=await f.store.recoverTask('task');
 expect(()=>{(read!.currentCompletion as any).state.currentVerification='valid';}).toThrow();
 expect((await f.store.recoverTask('task'))?.currentCompletion).toMatchObject({state:{currentVerification:'needs_revalidation'}});
 writeFileSync(join(f.root,'snapshots/task.json'),JSON.stringify({...f.snapshot,taskId:'other'}));
 expect(()=>recoverTaskSnapshotSync(f.root,'task')).toThrow('task_snapshot_completion_owner');
});
