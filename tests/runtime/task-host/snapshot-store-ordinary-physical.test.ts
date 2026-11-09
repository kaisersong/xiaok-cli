import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const controls=vi.hoisted(()=>({armed:false,attached:false,closeCalls:0,tail:undefined as Promise<void>|undefined,ready:()=>{},readArmed:false,readAttached:false,readReady:()=>{},readTail:undefined as Promise<void>|undefined,fsyncs:new Map<string,{tail:Promise<void>;ready():void}>()}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,readFile:(...args:unknown[])=>{const raw=Reflect.apply(actual.readFile,undefined,args);if(controls.readArmed&&!controls.readAttached&&String(args[0]).endsWith('physical.json')){controls.readAttached=true;Object.defineProperty(raw,Symbol('actual-read-child'),{value:controls.readTail});void raw.then(()=>controls.readReady());}return raw;},open:async(...args:unknown[])=>{
  const handle=await Reflect.apply(actual.open,undefined,args);
  const cut=[...controls.fsyncs].find(([name])=>String(args[0]).includes(name+'.json'))?.[1];
  if(cut){const sync=handle.sync;Object.defineProperty(handle,'sync',{value:function(){const raw=Reflect.apply(sync,handle,[]);Object.defineProperty(raw,Symbol('cut-fsync-child'),{value:cut.tail});void raw.then(()=>cut.ready());return raw;}});}

  if(controls.armed&&!controls.attached){controls.attached=true;const sync=handle.sync,close=handle.close;
   Object.defineProperty(handle,'sync',{value:function(){const raw=Reflect.apply(sync,handle,[]);Object.defineProperty(raw,Symbol('actual-fsync-child'),{value:controls.tail});void raw.then(()=>controls.ready());return raw;}});
   Object.defineProperty(handle,'close',{value:function(){controls.closeCalls++;return Reflect.apply(close,handle,[]);}});
  }
  return handle;
 }};
});
import {FileTaskSnapshotStore,readOriginalTaskStorePhysicalIO} from '../../../src/runtime/task-host/snapshot-store.js';
it('ordinary saveWithReceipt retains actual fsync own-symbol work before its following close and receipt',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ordinary-store-physical-')),store=new FileTaskSnapshotStore(root);
 const snapshot={taskId:'physical',sessionId:'session',status:'running' as const,prompt:'Actual file fsync resource tail',materials:[],events:[],createdAt:1,updatedAt:2};
 let release!:()=>void;controls.tail=new Promise<void>(yes=>{release=yes;});const ready=new Promise<void>(yes=>{controls.ready=yes;});let write:Promise<unknown>|undefined;
 try{
  await store.save(snapshot);controls.armed=true;controls.attached=false;controls.closeCalls=0;
  let finished=false;write=store.saveWithReceipt(snapshot).then(value=>{finished=true;return value;});await ready;await new Promise<void>(yes=>setImmediate(yes));
  expect(controls.attached).toBe(true);expect(controls.closeCalls).toBe(0);expect(finished).toBe(false);
  release();await write;expect(controls.closeCalls).toBe(1);
 }finally{controls.armed=false;release();await write?.catch(()=>{});await store.closeAndDrain();rmSync(root,{recursive:true,force:true,maxRetries:5});}
});

it('uncached original input read retains its actual readFile own-symbol work',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ordinary-store-read-')),writer=new FileTaskSnapshotStore(root),reader=new FileTaskSnapshotStore(root);
 const snapshot={taskId:'physical',sessionId:'session',status:'running' as const,prompt:'Original uncached input',materials:[],events:[],createdAt:1,updatedAt:2};
 let release!:()=>void;controls.readTail=new Promise<void>(yes=>{release=yes;});const ready=new Promise<void>(yes=>{controls.readReady=yes;});let read:Promise<unknown>|undefined;
 try{
  await writer.save(snapshot);controls.readArmed=true;controls.readAttached=false;
  let finished=false;read=reader.readOriginalUserInput('physical').then(value=>{finished=true;return value;});await ready;await new Promise<void>(yes=>setImmediate(yes));
  let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([read,new Promise<void>(yes=>{timer=setTimeout(yes,1500);})]);clearTimeout(timer);expect(controls.readAttached).toBe(true);expect(finished).toBe(false);release();expect(await read).toMatchObject({prompt:snapshot.prompt});
 }finally{controls.readArmed=false;release();await read?.catch(()=>{});await writer.closeAndDrain();await reader.closeAndDrain();rmSync(root,{recursive:true,force:true,maxRetries:5});}
});

it('physical Store cut includes accepted queued jobs and excludes subsequent unrelated work',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ordinary-store-cut-')),store=new FileTaskSnapshotStore(root);
 const snapshot=(taskId:string)=>({taskId,sessionId:'session',status:'running' as const,prompt:'Accepted original writer prefix',materials:[],events:[],createdAt:1,updatedAt:2});
 const releases:Array<()=>void>=[],writes:Array<Promise<unknown>>=[];
 function held(name:string){let release!:()=>void,started!:()=>void;const tail=new Promise<void>(yes=>{release=yes;}),ready=new Promise<void>(yes=>{started=yes;});releases.push(release);controls.fsyncs.set(name,{tail,ready:started});return {release,ready};}
 try{
  const a=held('cut-a'),b=held('cut-b');writes.push(store.saveWithReceipt(snapshot('cut-a')));await a.ready;writes.push(store.saveWithReceipt(snapshot('cut-b')));
  const cut=readOriginalTaskStorePhysicalIO(store).capture();let finished=false;const wait=cut.waitKnown().then(()=>{finished=true;});expect(()=>cut.assertKnown()).toThrow('TASK_STORE_PHYSICAL_PENDING');
  a.release();await b.ready;await new Promise<void>(yes=>setImmediate(yes));expect(finished).toBe(false);b.release();await wait;cut.assertKnown();
  const c=held('cut-c');writes.push(store.saveWithReceipt(snapshot('cut-c')));await c.ready;cut.assertKnown();expect(finished).toBe(true);c.release();
  let traps=0;const fake=new Proxy({},{get(){traps++;throw Error('get');}});expect(()=>readOriginalTaskStorePhysicalIO(fake)).toThrow('TASK_STORE_ORIGINAL_PHYSICAL_IO_REQUIRED');expect(traps).toBe(0);
 }finally{for(const release of releases)release();await Promise.allSettled(writes);controls.fsyncs.clear();await store.closeAndDrain();rmSync(root,{recursive:true,force:true,maxRetries:5});}
});
