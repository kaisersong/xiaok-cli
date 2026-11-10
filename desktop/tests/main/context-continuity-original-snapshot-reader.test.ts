// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as module from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const capture=(store:unknown,root:string)=>(module as unknown as Record<string,Function>).captureOriginalTaskSnapshotSourceReader(store,root);
async function fixture(){const root=mkdtempSync(join(tmpdir(),'xiaok-original-source-reader-'));roots.push(root);const store=new module.FileTaskSnapshotStore(root),snapshot={taskId:'real_file_source',sessionId:'source_epoch',status:'completed',prompt:'source',events:[],createdAt:1,updatedAt:2}as unknown as TaskSnapshot;await store.save(snapshot);return{root,store,snapshot,path:join(root,'snapshots',snapshot.taskId+'.json')};}
it('reads actual persisted files instead of the original execution cache',async()=>{
 const f=await fixture(),reader=capture(f.store,f.root);expect(Object.isFrozen(reader)).toBe(true);expect(reader.inspectSync(f.snapshot.taskId).prompt).toBe('source');await f.store.recoverTask(f.snapshot.taskId);
 const actual=JSON.parse(readFileSync(f.path,'utf8'));actual.prompt='changed durable source';writeFileSync(f.path,JSON.stringify(actual));expect(reader.inspectSync(f.snapshot.taskId).prompt).toBe('changed durable source');
});
it('rejects forged/copy/proxy owner and a different root without invoking caller methods',async()=>{
 const f=await fixture(),fake=vi.fn();for(const store of [{...f.store},new Proxy(f.store,{}),{inspectPersistedTaskSync:fake}])expect(()=>capture(store,f.root)).toThrow();expect(fake).not.toHaveBeenCalled();expect(()=>capture(f.store,join(f.root,'different'))).toThrow();
});
it('retains fixed original root/method and rejects an actual pending source write',async()=>{
 const f=await fixture(),reader=capture(f.store,f.root);Object.assign(f.store,{rootDir:join(f.root,'forged'),snapshotDir:()=>join(f.root,'forged'),inspectPersistedTaskSync:()=>({taskId:'forged'})});expect(reader.inspectSync(f.snapshot.taskId).taskId).toBe(f.snapshot.taskId);
 delete (f.store as unknown as Record<string,unknown>).snapshotDir;
 Object.assign(f.store,{taskWriteQueues:new Map()});
 const pending=f.store.save({...f.snapshot,prompt:'actual queued write'});expect(()=>reader.inspectSync(f.snapshot.taskId)).toThrow(/blocked_unsettled/);await pending;expect(reader.inspectSync(f.snapshot.taskId).prompt).toBe('actual queued write');
});
it('rejects malformed source and a symlink to another actual file',async()=>{
 const f=await fixture(),reader=capture(f.store,f.root),before=readFileSync(f.path);writeFileSync(f.path,'{');expect(()=>reader.inspectSync(f.snapshot.taskId)).toThrow();writeFileSync(f.path,before);const other=join(f.root,'other.json');writeFileSync(other,before);unlinkSync(f.path);symlinkSync(other,f.path);expect(()=>reader.inspectSync(f.snapshot.taskId)).toThrow(/blocked_unsettled/);
});
