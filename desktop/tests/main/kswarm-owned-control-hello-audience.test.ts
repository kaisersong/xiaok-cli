import {afterEach,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import * as api from '../../../src/runtime/conversation-activity/owned-kswarm-control.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
type Audience={readonly scope:typeof scope;readonly boot:string};
const prepare=(client:object):Promise<Audience>=>(api as unknown as {prepareOwnedKSwarmPrefixV2Hello(client:object):Promise<Audience>}).prepareOwnedKSwarmPrefixV2Hello(client);
const assertCurrent=(client:object,audience:object):void=>(api as unknown as {assertOwnedKSwarmPrefixV2HelloCurrent(client:object,audience:object):void}).assertOwnedKSwarmPrefixV2HelloCurrent(client,audience);
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'owned-hello-audience-')),child=spawn(process.execPath,[resolve('../../kswarm/test/fixtures/owned-control-prefix/entry.js')],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CONTROL_TEST_ROOT:root}});
 const frames:Record<string,unknown>[]=[];child.on('message',frame=>frames.push(frame as Record<string,unknown>));const closed=new Promise<void>(yes=>child.once('close',(code,signal)=>{console.log(JSON.stringify({test:'owned-hello-audience',pid:child.pid,code,signal,reaped:true,cleanupIsNotWholeServerDrain:true}));yes();}));
 cleanups.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await closed;rmSync(root,{recursive:true,force:true,maxRetries:3});});
 const client=api.createOwnedKSwarmPrefixV2Client({child,scope});
 async function wait<T>(find:()=>T|undefined){for(let n=0;n<800;n++){const row=find();if(row!==undefined)return row;await delay(5);}throw Error('hello audience fixture timeout');}
 const floor=()=>{const db=new DatabaseSync(join(root,'state.sqlite'),{readOnly:true});try{return db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n;}finally{db.close();}};
 return {child,client,closed,frames,wait,floor};
}
it('original hello audience reads actual boot with zero business packets and zero Native floor',async()=>{
 const f=await fixture(),audience=await prepare(f.client);expect(Object.keys(audience).sort()).toEqual(['boot','scope']);expect(audience.scope).toEqual(scope);expect(audience.boot).toBe(f.frames.find(row=>row.type==='hello_ack')?.instance);expect(Object.isFrozen(audience)).toBe(true);expect(Object.isFrozen(audience.scope)).toBe(true);expect(assertCurrent(f.client,audience)).toBeUndefined();expect(f.frames.some(row=>row.type==='response')).toBe(false);expect(f.floor()).toBe(0);await f.client.sealAndDrainPrefix();
});
it('concurrent hello reads reuse the single original handshake and the same opaque audience',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let hellos=0,requests=0;f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{if((frame as {type?:string}).type==='hello')hellos++;if((frame as {type?:string}).type==='request')requests++;return send(frame as never,callback);}) as typeof f.child.send;
 const [a,b]=await Promise.all([prepare(f.client),prepare(f.client)]);expect(a).toBe(b);expect(await prepare(f.client)).toBe(a);expect(hellos).toBe(1);expect(requests).toBe(0);expect(f.floor()).toBe(0);await f.client.sealAndDrainPrefix();
});
it('copied audience and another original same-scope client cannot replace original identity',async()=>{
 const first=await fixture(),second=await fixture(),a=await prepare(first.client),b=await prepare(second.client);expect(()=>assertCurrent(first.client,{...a})).toThrow('OWNED_CONTROL_HELLO_AUDIENCE_REQUIRED');expect(()=>assertCurrent(first.client,b)).toThrow('OWNED_CONTROL_HELLO_AUDIENCE_REQUIRED');expect(()=>assertCurrent(second.client,a)).toThrow('OWNED_CONTROL_HELLO_AUDIENCE_REQUIRED');expect(assertCurrent(first.client,a)).toBeUndefined();expect(assertCurrent(second.client,b)).toBeUndefined();await first.client.sealAndDrainPrefix();await second.client.sealAndDrainPrefix();
});
it('fake or Proxy-wrapped clients are rejected before reading any supplied method or property',async()=>{
 const f=await fixture();let hooks=0;const fake={get inspectWriter(){hooks++;throw Error('fake client getter');}},wrapped=new Proxy(f.client,{get(){hooks++;throw Error('client proxy getter');},getPrototypeOf(){hooks++;throw Error('client proxy prototype');}});
 for(const client of [fake,wrapped]){expect(()=>prepare(client)).toThrow('OWNED_CONTROL_HELLO_CLIENT_REQUIRED');expect(()=>assertCurrent(client,{})).toThrow('OWNED_CONTROL_HELLO_CLIENT_REQUIRED');}expect(hooks).toBe(0);expect(f.frames).toEqual([]);await f.client.sealAndDrainPrefix();
});
it('seal during an original held handshake rejects audience delivery and still joins that physical hello',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let release:(()=>void)|undefined;f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{if((frame as {type?:string}).type==='hello')return send(frame as never,error=>{release=()=>callback(error);});return send(frame as never,callback);}) as typeof f.child.send;
 const offer=prepare(f.client).catch(error=>error);await f.wait(()=>release);await f.wait(()=>f.frames.find(row=>row.type==='hello_ack'));let done=false;const drain=f.client.sealAndDrainPrefix().then(()=>{done=true;}),observed=drain.catch(error=>error);
 try{expect(await offer).toBeInstanceOf(Error);await delay(20);expect(done).toBe(false);release!();await drain;expect(f.floor()).toBe(0);expect(f.frames.some(row=>row.type==='response')).toBe(false);}finally{release?.();void observed;}
});
it('a sealed client cannot reuse its audience or issue a new hello to restore it',async()=>{
 const f=await fixture(),audience=await prepare(f.client);await f.client.sealAndDrainPrefix();const count=f.frames.length;expect(()=>assertCurrent(f.client,audience)).toThrow('OWNED_CONTROL_CLOSED');await expect(prepare(f.client)).rejects.toThrow('OWNED_CONTROL_CLOSED');expect(f.frames.length).toBe(count);expect(f.floor()).toBe(0);
});
it('a real hello ACK plus a held SDK raw cannot mint an audience or wash its unknown on release',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let release!:()=>void,hooks=0;const raw=new Promise<void>(yes=>{release=yes;});Object.defineProperty(raw,'then',{get(){hooks++;throw Error('hello SDK own then');}});
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{const backpressure=send(frame as never,callback);return (frame as {type?:string}).type==='hello'?raw:backpressure;}) as typeof f.child.send;
 const offer=prepare(f.client).catch(error=>error);await f.wait(()=>f.frames.find(row=>row.type==='hello_ack'));expect((await offer).message).toBe('OWNED_CONTROL_SEND_RETURN_UNKNOWN');let finished=false;const closing=f.client.sealAndDrainPrefix().then(()=>{finished=true;},error=>{finished=true;return error;});await delay(20);expect(finished).toBe(false);expect(hooks).toBe(0);release();expect(await closing).toBeInstanceOf(Error);expect(hooks).toBe(0);expect(()=>assertCurrent(f.client,{scope,boot:f.frames.find(row=>row.type==='hello_ack')?.instance})).toThrow('OWNED_CONTROL_HELLO_AUDIENCE_REQUIRED');expect(f.floor()).toBe(0);
});
it('an unknown SDK thenable is never executed and cannot create a hello audience from the actual ACK',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let hooks=0;const raw={get then(){hooks++;throw Error('unknown hello SDK then');}};
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{const backpressure=send(frame as never,callback);return (frame as {type?:string}).type==='hello'?raw:backpressure;}) as typeof f.child.send;
 await expect(prepare(f.client)).rejects.toThrow('OWNED_CONTROL_SEND_RETURN_UNKNOWN');await f.wait(()=>f.frames.find(row=>row.type==='hello_ack'));expect(()=>assertCurrent(f.client,{scope,boot:f.frames.find(row=>row.type==='hello_ack')?.instance})).toThrow('OWNED_CONTROL_HELLO_AUDIENCE_REQUIRED');expect(hooks).toBe(0);expect(f.floor()).toBe(0);
});
it('hello audience promise delivery never executes an inherited then getter installed by the original dispatcher',async()=>{
 const f=await fixture(),emit=f.child.emit.bind(f.child),send=f.child.send!.bind(f.child),original=Object.getOwnPropertyDescriptor(Object.prototype,'then');let hooks=0;
 // Controlled SDK callback ordering only; the boot ACK still comes from the
 // actual original child. No business request or Native grant is fabricated.
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{const result=send(frame as never,()=>{});callback(null);return result;}) as typeof f.child.send;
 const restore=()=>{if(original)Object.defineProperty(Object.prototype,'then',original);else delete (Object.prototype as {then?:unknown}).then;};
 f.child.emit=((event:string|symbol,...args:unknown[])=>{if(event==='message'&&(args[0] as {type?:string}).type==='hello_ack'){Object.defineProperty(Object.prototype,'then',{configurable:true,get(){hooks++;throw Error('inherited audience then getter executed');}});try{return emit(event,...args);}finally{queueMicrotask(restore);}}return emit(event,...args);}) as typeof f.child.emit;
 let audience:Audience|undefined,error:unknown;try{audience=await prepare(f.client);}catch(cause){error=cause;}finally{restore();f.child.emit=emit;}expect(error).toBeUndefined();expect(hooks).toBe(0);expect(audience?.boot).toBe(f.frames.find(row=>row.type==='hello_ack')?.instance);expect(f.floor()).toBe(0);await f.client.sealAndDrainPrefix();
});
it('sealing in the microtask before the success observer cannot deliver an ordinary hello audience',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{const result=send(frame as never,()=>{});callback(null);return result;}) as typeof f.child.send;
 let closing:Promise<void>|undefined;f.child.on('message',frame=>{if((frame as {type?:string}).type==='hello_ack')queueMicrotask(()=>{closing=f.client.sealAndDrainPrefix();void closing.catch(()=>{});});});
 const result=await prepare(f.client).then(value=>({status:'fulfilled',value}),error=>({status:'rejected',error}));await closing;console.log(JSON.stringify({test:'hello-audience-delivery-after-seal',status:result.status,floor:f.floor()}));expect(result).toMatchObject({status:'rejected',error:{message:'OWNED_CONTROL_CLOSED'}});expect(f.floor()).toBe(0);
});
it('an inherited second-stage thenable cannot create a new delivery tail outside the original hello owner',async()=>{
 const f=await fixture(),emit=f.child.emit.bind(f.child),original=Object.getOwnPropertyDescriptor(Object.prototype,'then');let hooks=0,release:(()=>void)|undefined;
 const restore=()=>{if(original)Object.defineProperty(Object.prototype,'then',original);else delete (Object.prototype as {then?:unknown}).then;};
 f.child.emit=((event:string|symbol,...args:unknown[])=>{if(event==='message'&&(args[0] as {type?:string}).type==='hello_ack')Object.defineProperty(Object.prototype,'then',{configurable:true,get(){if(!Object.hasOwn(this,'boot'))return undefined;hooks++;if(hooks!==2)return undefined;return (yes:(value?:unknown)=>void)=>{release=()=>yes();};}});return emit(event,...args);}) as typeof f.child.emit;
 let delivered=false;const offer=prepare(f.client);void offer.then(()=>{delivered=true;},()=>{delivered=true;});
 try{await f.wait(()=>f.frames.find(row=>row.type==='hello_ack'));await delay(10);await f.client.sealAndDrainPrefix();expect(hooks).toBe(0);expect(delivered).toBe(true);expect((await offer).boot).toBe(f.frames.find(row=>row.type==='hello_ack')?.instance);expect(f.floor()).toBe(0);}finally{restore();f.child.emit=emit;release?.();}
});
