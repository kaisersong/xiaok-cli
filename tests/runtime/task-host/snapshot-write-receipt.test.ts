import {afterEach,expect,it,vi} from 'vitest';
const failure=vi.hoisted(()=>({sync:false}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,async open(...args:Parameters<typeof actual.open>){
  const handle=await actual.open(...args);
  if(failure.sync&&String(args[0]).endsWith('active-task.json'))handle.sync=async()=>{throw Object.assign(Error('injected actual file sync failure'),{code:'EIO'});};
  return handle;
 }};
});
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileTaskSnapshotStore,getTaskSnapshotWriteReceipt} from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
const roots:string[]=[];
function setup(){const root=mkdtempSync(join(tmpdir(),'task-write-receipt-'));roots.push(root);return{root,store:new FileTaskSnapshotStore(root)};}
function snapshot(status:TaskSnapshot['status']='running'):TaskSnapshot{return{taskId:'task',sessionId:'ui-session',status,prompt:'test',materials:[],events:[],createdAt:1,updatedAt:2};}
afterEach(()=>{failure.sync=false;for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('returns each original queued write sequence and digest, never a later write observation',async()=>{
 const {store}=setup(),first=snapshot(),second={...snapshot('completed'),updatedAt:3};
 const a=store.saveWithReceipt(first),b=store.saveWithReceipt(second);
 first.prompt='changed after call';
 const ra=getTaskSnapshotWriteReceipt(await a,store),rb=getTaskSnapshotWriteReceipt(await b,store);
 expect(ra).toMatchObject({taskId:'task',sessionId:'ui-session',status:'running',sequence:0});
 expect(rb).toMatchObject({taskId:'task',status:'completed',sequence:1});
 expect(ra.snapshotDigest).not.toBe(rb.snapshotDigest);expect(Object.isFrozen(ra)).toBe(true);
 expect((await store.recoverTask('task'))?.prompt).toBe('test');
 const noChange=getTaskSnapshotWriteReceipt(await store.saveWithReceipt(second),store);
 expect(noChange).toEqual(rb);
});
it('rejects copied receipts and another store even when its root matches',async()=>{
 const {root,store}=setup(),receipt=await store.saveWithReceipt(snapshot());
 expect(()=>getTaskSnapshotWriteReceipt(JSON.parse(JSON.stringify(receipt)),store)).toThrow('task_snapshot_write_receipt');
 expect(()=>getTaskSnapshotWriteReceipt(receipt,new FileTaskSnapshotStore(root))).toThrow('task_snapshot_write_receipt');
});
it('issues no receipt on index failure and repairs the index before an unchanged retry succeeds',async()=>{
 const {root,store}=setup();mkdirSync(join(root,'active-task.json'));
 await expect(store.saveWithReceipt(snapshot())).rejects.toThrow();
 rmSync(join(root,'active-task.json'),{recursive:true});
 const receipt=await store.saveWithReceipt(snapshot());
 expect(getTaskSnapshotWriteReceipt(receipt,store).sequence).toBe(0);
 expect(JSON.parse(readFileSync(join(root,'active-task.json'),'utf8')).activeTaskIds).toEqual(['task']);
});
it('does not issue a durable receipt when the actual saved file cannot be synced',async()=>{
 const {store}=setup();failure.sync=true;
 await expect(store.saveWithReceipt(snapshot('completed'))).rejects.toThrow('file sync failure');
 failure.sync=false;
 expect(getTaskSnapshotWriteReceipt(await store.saveWithReceipt(snapshot('completed')),store)).toMatchObject({status:'completed',sequence:0});
});
