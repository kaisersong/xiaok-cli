// @vitest-environment node
// Original Host/Store only. Persistent UUID is data, never Native permission.
import {afterEach,expect,it,vi} from 'vitest';
import {setTimeout as delay} from 'node:timers/promises';
const control=vi.hoisted(()=>{vi.resetModules();return{hook:undefined as undefined|((name:string,original:Function,args:unknown[])=>unknown)};});
vi.mock('node:fs',async load=>{const original=await load<typeof import('node:fs')>(),out:Record<string,Function>={};for(const name of ['readFileSync','fsyncSync','lstatSync']){const fn=(original as any)[name];out[name]=(...args:unknown[])=>control.hook?control.hook(name,fn,args):Reflect.apply(fn,undefined,args);}return{...original,...out};});
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as stores from '../../../src/runtime/task-host/snapshot-store.js';
import * as hosts from '../../../src/runtime/task-host/task-runtime-host.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{control.hook=undefined;for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'d20-host-id-')),path=join(root,'tasks'),store=new stores.FileTaskSnapshotStore(path),population=hosts.createTaskSourceWriterPopulation(store);
 const host=population.createHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),runner:async()=>{throw Error('identity must not execute');}});
 cleanups.push(async()=>{await population.close().catch(()=>{});rmSync(root,{recursive:true,force:true});});
 function io(){const read=(hosts as any).readOriginalTaskHostIdentityIO;expect(read).toBeTypeOf('function');return read(host,store);}
 function storeIO(other=store){const read=(stores as any).readOriginalTaskStoreHostIdentityIO;expect(read).toBeTypeOf('function');return read(other);}
 return{root,path,store,population,host,io,storeIO,record:join(path,'.host-identity','record.json')};
}
it('exposes fixed original Host/Store identity IO with membership before properties',()=>{
 const f=fixture(),io=f.io();expect(io).toBe(f.io());expect(Object.isFrozen(io)).toBe(true);let gets=0;const fake=new Proxy({},{get(){gets++;throw Error('forbidden');}});
 expect(()=>(hosts as any).readOriginalTaskHostIdentityIO(fake,f.store)).toThrow();expect(()=>(hosts as any).readOriginalTaskHostIdentityIO(f.host,fake)).toThrow();expect(()=>(stores as any).readOriginalTaskStoreHostIdentityIO(fake)).toThrow();expect(gets).toBe(0);expect(existsSync(f.path)).toBe(false);
});
it('strict absence does not create; explicit first initialization is stable and reopened',async()=>{
 const f=fixture(),io=f.io();expect(await io.read()).toBeNull();expect(existsSync(f.path)).toBe(false);const first=await io.initialize();expect(first.version).toBe(1);expect(first.hostId).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);expect(Object.isFrozen(first)).toBe(true);expect(Object.getPrototypeOf(first)).toBeNull();expect(await io.read()).toEqual(first);expect(await io.initialize()).toEqual(first);
 const reopened=new stores.FileTaskSnapshotStore(f.path);cleanups.push(()=>reopened.closeAndDrain());expect(await f.storeIO(reopened).read()).toEqual(first);expect(readFileSync(f.record,'utf8')).toBe(`{"version":1,"hostId":"${first.hostId}"}\n`);
});
it('two original Hosts sharing the original queue initialize one identity',async()=>{
 const f=fixture(),other=f.population.createHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(f.root,'other'),maxBytes:1024}),runner:async()=>{}}),otherIO=(hosts as any).readOriginalTaskHostIdentityIO;
 expect(otherIO).toBeTypeOf('function');const [a,b]=await Promise.all([f.io().initialize(),otherIO(other,f.store).initialize()]);expect(a).toEqual(b);
});
for(const mode of ['missing','corrupt','replacement'] as const)it(`does not regenerate an observed ${mode} identity`,async()=>{
 const f=fixture(),io=f.io();await io.initialize();if(mode==='missing')rmSync(f.record);else if(mode==='corrupt')writeFileSync(f.record,'{"version":1,"hostId":"bad"}');else{const bytes=readFileSync(f.record);renameSync(f.record,f.record+'.old');writeFileSync(f.record,bytes);}
 await expect(io.read()).rejects.toThrow();await expect(io.initialize()).rejects.toThrow();
});
it('a reopened anchor without record is unconfirmed rather than a fresh birth',async()=>{
 const f=fixture();await f.io().initialize();rmSync(f.record);const reopened=new stores.FileTaskSnapshotStore(f.path);cleanups.push(()=>reopened.closeAndDrain());await expect(f.storeIO(reopened).read()).rejects.toThrow();await expect(f.storeIO(reopened).initialize()).rejects.toThrow();expect(existsSync(f.record)).toBe(false);
});
it('rejects a preexisting namespace or symlink without adopting or rewriting it',async()=>{
 const f=fixture();mkdirSync(join(f.path,'.host-identity'),{recursive:true});writeFileSync(f.record,'{}');await expect(f.io().initialize()).rejects.toThrow();expect(readFileSync(f.record,'utf8')).toBe('{}');
 const g=fixture();mkdirSync(g.path);symlinkSync(f.path,join(g.path,'.host-identity'));await expect(g.io().initialize()).rejects.toThrow();
});
it('enters private bodies despite public shadows and denies fresh IO after stop',async()=>{
 const f=fixture(),io=f.io();let hits=0;for(const name of ['initializeHostIdentity','readHostIdentity'])Object.defineProperty(f.store,name,{get(){hits++;throw Error('shadow');}});const first=await io.initialize();expect(await io.read()).toEqual(first);expect(hits).toBe(0);f.host.stopAccepting();await expect(io.initialize()).rejects.toThrow();await expect(io.read()).rejects.toThrow();
});

it('joins actual synchronous FS raw tails before accepted identity work and population close settle',async()=>{
 const f=fixture(),io=f.io();let release!:()=>void,hits=0;const held=new Promise<void>(yes=>{release=yes;});
 control.hook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='fsyncSync'&&hits++===0)return held;return value;};
 let initialized=false,closed=false;const initializing=io.initialize().then(()=>{initialized=true;},()=>{initialized=true;});
 try{for(let i=0;i<50&&hits===0;i++)await delay(2);expect(hits).toBeGreaterThan(0);const closing=f.population.close().then(()=>{closed=true;},()=>{closed=true;});await delay(20);expect(initialized).toBe(false);expect(closed).toBe(false);release();await initializing;await closing;}finally{control.hook=undefined;release();await initializing;}
});
it('strict reads retain an actual readFileSync returned Promise and its symbol sibling',async()=>{
 const f=fixture(),io=f.io();await io.initialize();let release!:()=>void,sideRelease!:()=>void,hits=0;const raw=new Promise<void>(yes=>{release=yes;}),side=new Promise<void>(yes=>{sideRelease=yes;});Object.defineProperty(raw,Symbol('original-sidecar'),{value:side});
 control.hook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='readFileSync'&&args[0]===f.record){hits++;return raw;}return value;};
 let finished=false;const reading=io.read().then(()=>{finished=true;},()=>{finished=true;});try{await delay(15);expect(hits).toBe(1);expect(finished).toBe(false);release();await delay(15);expect(finished).toBe(false);sideRelease();await reading;}finally{control.hook=undefined;release();sideRelease();await reading;}
});
it('preserves actual SDK throw undefined instead of returning a null absence or new identity',async()=>{
 const f=fixture(),io=f.io();await io.initialize();let hits=0;control.hook=(name,original,args)=>{if(name==='readFileSync'&&args[0]===f.record){hits++;throw undefined;}return Reflect.apply(original,undefined,args);};let rejected=false,reason:unknown=Error('not thrown');try{await io.read();}catch(error){rejected=true;reason=error;}expect(hits).toBe(1);expect(rejected).toBe(true);expect(reason).toBeUndefined();control.hook=undefined;await expect(io.initialize()).rejects.toBeUndefined();
});
it('treats an actual live original save lock as retryable BUSY without rebirth or poison',async()=>{
 const f=fixture(),io=f.io(),first=await io.initialize();const {acquireSaveLock}=await import('../../../src/ai/runtime/session-store/mutation-lock.js'),release=acquireSaveLock(join(f.path,'.task-store.save.lock'));
 try{await expect(io.read()).rejects.toThrow('TASK_HOST_IDENTITY_BUSY');}finally{release();}
 expect(await io.read()).toEqual(first);expect(await io.initialize()).toEqual(first);
});
it('supports an existing ordinary Store only by explicit first initialization without rewriting tasks',async()=>{
 const f=fixture();await f.store.save({taskId:'ordinary',sessionId:'ordinary-session',status:'understanding',prompt:'Existing task',materials:[],events:[],createdAt:1,updatedAt:1});const path=join(f.path,'snapshots','ordinary.json'),bytes=readFileSync(path,'utf8');expect(await f.io().read()).toBeNull();await f.io().initialize();expect(readFileSync(path,'utf8')).toBe(bytes);
});
it('rejects duplicate fields and a foreign UUID anchor after reopening without repair',async()=>{
 for(const mode of ['duplicate','foreign-anchor']){
  const f=fixture(),first=await f.io().initialize();if(mode==='duplicate')writeFileSync(f.record,`{"version":1,"hostId":"${first.hostId}","hostId":"${first.hostId}"}\n`);else rmSync(join(f.path,'.host-identity',`id-${first.hostId}`),{recursive:true});const bytes=readFileSync(f.record,'utf8'),reopened=new stores.FileTaskSnapshotStore(f.path);cleanups.push(()=>reopened.closeAndDrain().catch(()=>{}));await expect(f.storeIO(reopened).read()).rejects.toThrow();await expect(f.storeIO(reopened).initialize()).rejects.toThrow();expect(readFileSync(f.record,'utf8')).toBe(bytes);
 }
});
it('original Store close rejects fresh identity IO while leaving the persistent record intact',async()=>{
 const f=fixture(),io=f.io();await io.initialize();const bytes=readFileSync(f.record,'utf8');await f.store.closeAndDrain();await expect(io.initialize()).rejects.toThrow();await expect(io.read()).rejects.toThrow();expect(readFileSync(f.record,'utf8')).toBe(bytes);
});
it('rechecks the actual save lock after reading bytes before delivering an identity cut',async()=>{
 const f=fixture(),io=f.io(),first=await io.initialize();const {acquireSaveLock}=await import('../../../src/ai/runtime/session-store/mutation-lock.js');let release:(()=>void)|undefined,hits=0;
 control.hook=(name,original,args)=>{const value=Reflect.apply(original,undefined,args);if(name==='readFileSync'&&args[0]===f.record&&!release){hits++;release=acquireSaveLock(join(f.path,'.task-store.save.lock'));}return value;};
 try{await expect(io.read()).rejects.toThrow('TASK_HOST_IDENTITY_BUSY');expect(hits).toBe(1);expect(existsSync(join(f.path,'.task-store.save.lock'))).toBe(true);}finally{control.hook=undefined;release?.();}expect(await io.read()).toEqual(first);
});
it('two actual Stores contend on the original lock without birthing two identities',async()=>{
 const f=fixture(),second=new stores.FileTaskSnapshotStore(f.path);cleanups.push(()=>second.closeAndDrain().catch(()=>{}));const left=f.io(),right=f.storeIO(second),results=await Promise.allSettled([left.initialize(),right.initialize()]);
 const good=results.filter((row):row is PromiseFulfilledResult<any>=>row.status==='fulfilled');expect(good.length).toBeGreaterThan(0);for(const row of good)expect(row.value).toEqual(good[0]!.value);
 for(const row of results)if(row.status==='rejected')expect(String(row.reason)).toContain('session_save_locked');
 // A failed original SDK attempt may remain unconfirmed; do not reset it.
 // A new actual reader verifies the original durable identity, not a new birth.
 const reopened=new stores.FileTaskSnapshotStore(f.path);cleanups.push(()=>reopened.closeAndDrain().catch(()=>{}));const io=f.storeIO(reopened);expect(await io.read()).toEqual(good[0]!.value);expect(await io.initialize()).toEqual(good[0]!.value);
 console.log(JSON.stringify({fixture:'two-original-host-identity-stores',fulfilled:good.length,rejected:results.length-good.length,sameDurableIdentity:true}));
});

it('retains known Error stack data even when a sibling name accessor makes the actual SDK result unknown',async()=>{
 const f=fixture(),io=f.io();await io.initialize();let release!:()=>void,hits=0,getters=0;const held=new Promise<void>(yes=>{release=yes;}),error=Error('actual-store-sdk-error');Object.defineProperty(error,'name',{get(){getters++;return 'unread';}});Object.defineProperty(error,'stack',{value:held});
 control.hook=(name,original,args)=>{const result=Reflect.apply(original,undefined,args);if(name==='readFileSync'&&args[0]===f.record){hits++;throw error;}return result;};let finished=false;const reading=io.read().then(()=>{finished=true;},()=>{finished=true;});
 try{await delay(20);expect(hits).toBe(1);expect(getters).toBe(0);expect(finished).toBe(false);release();await reading;expect(getters).toBe(0);}finally{control.hook=undefined;release();await reading;}
});
