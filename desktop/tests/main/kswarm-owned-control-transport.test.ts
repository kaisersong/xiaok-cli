import {afterEach,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {createKSwarmOwnedControl} from '../../electron/kswarm-owned-control.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(verify?:()=>void){
 const root=mkdtempSync(join(tmpdir(),'owned-control-physical-')),entry=resolve('../../kswarm/test/fixtures/owned-desktop-control/entry.js');
 const child=spawn(process.execPath,[entry],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CONTROL_TEST_ROOT:root}});
 const closed=new Promise<void>((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{console.log(JSON.stringify({test:'owned-control-physical-child',pid:child.pid,code,signal,reaped:true}));yes();});});
 const owner=Object.freeze({}),proof=Object.freeze({}),abort=new AbortController();
 const control=createKSwarmOwnedControl({child,scope,serviceOwner:owner,isCurrent:()=>child.connected===true,admit(candidate,audience){if(candidate!==proof||audience.serviceOwner!==owner)throw Error('foreign transport fixture');verify?.();}}) as ReturnType<typeof createKSwarmOwnedControl>&{sealAndDrainTransport():Promise<void>};
 const context={requestSource:'user' as const,admission:proof,signal:abort.signal};
 cleanups.push(async()=>{control.seal();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await closed;await control.drainGuardTails();rmSync(root,{recursive:true,force:true});});
 const firstReply=actualResponse(child);await control.call('inspect_writer',context);const initialResponse=await firstReply;
 return {initialResponse,root,child,control,context,abort,closed,call:()=>control.call('prepare_initial_plan_writer',context),floor(){const db=new DatabaseSync(join(root,'state.sqlite'),{readOnly:true});try{return db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n;}finally{db.close();}}};
}
function actualResponse(child:ChildProcess){return new Promise<Record<string,unknown>>(yes=>{const receive=(frame:unknown)=>{if((frame as {type?:string}).type==='response'){child.off('message',receive);yes(frame as Record<string,unknown>);}};child.on('message',receive);});}

it('an actual committed ACK cannot turn a Promise-returning SDK send into success or drop its held raw',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});let hooks=0;
 Object.defineProperty(raw,'then',{get(){hooks++;return (yes:()=>void)=>yes();}});
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{send(frame as never,callback);return raw;}) as unknown as typeof f.child.send;
 const ack=actualResponse(f.child);let draining:Promise<void>|undefined,done=false;
 try{
  await expect(f.call()).rejects.toThrow('OWNED_CONTROL_SEND_RETURN_UNKNOWN');expect(await ack).toMatchObject({result:{ok:true}});expect(f.floor()).toBe(1);
  draining=f.control.sealAndDrainTransport().then(()=>{done=true;});await delay(20);expect(done).toBe(false);expect(hooks).toBe(0);
 }finally{release();}
 await draining;expect(done).toBe(true);expect(hooks).toBe(0);
});

it('a controlled synchronous SDK callback and response cannot preempt return classification',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});
 // This is a transport ordering counterexample, not a second Native admission:
 // the synthetic early result is the actual earlier read-only response.
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{send(frame as never,()=>{});callback(null);f.child.emit('message',{...(frame as Record<string,unknown>),type:'response',result:f.initialResponse.result});return raw;}) as unknown as typeof f.child.send;
 let draining:Promise<void>|undefined,done=false;
 try{await expect(f.call()).rejects.toThrow('OWNED_CONTROL_SEND_RETURN_UNKNOWN');draining=f.control.sealAndDrainTransport().then(()=>{done=true;});await delay(20);expect(done).toBe(false);}finally{release();}
 await draining;
});

it('a fresh read cannot start a second packet before the original SDK raw really settles',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let release!:()=>void;const raw=new Promise<void>(yes=>{release=yes;});
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{send(frame as never,callback);return raw;}) as unknown as typeof f.child.send;
 const ack=actualResponse(f.child);await expect(f.call()).rejects.toThrow('OWNED_CONTROL_SEND_RETURN_UNKNOWN');await ack;let reads=0;
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{reads++;return send(frame as never,callback);}) as typeof f.child.send;
 try{await expect(f.control.call('inspect_writer',f.context)).rejects.toThrow('OWNED_CONTROL_BUSY');expect(reads).toBe(0);}finally{release();}
 await delay(0);expect(await f.control.call('inspect_writer',f.context)).toMatchObject({ok:true,profile:{floor:{schemaVersion:2}}});expect(reads).toBe(1);await f.control.sealAndDrainTransport();
});

it('keeps the original rejected SDK raw cause after the original native commit',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let reject!:(error:unknown)=>void;const raw=new Promise<void>((_,no)=>{reject=no;}),cause=Error('original SDK raw rejected');
 // Prevent a baseline runner unhandled rejection without changing the raw's identity.
 void Promise.prototype.then.call(raw,undefined,()=>{});
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{send(frame as never,callback);return raw;}) as unknown as typeof f.child.send;
 const ack=actualResponse(f.child);let draining:Promise<void>|undefined;
 try{await expect(f.call()).rejects.toThrow('OWNED_CONTROL_SEND_RETURN_UNKNOWN');await ack;expect(f.floor()).toBe(1);draining=f.control.sealAndDrainTransport();const failed=expect(draining).rejects.toBe(cause);reject(cause);await failed;}finally{reject(cause);}
});

it('does not invoke an unknown SDK then getter or qualify its transport drain',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let hooks=0;const raw={get then(){hooks++;throw Error('SDK then getter');}};
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{send(frame as never,callback);return raw;}) as unknown as typeof f.child.send;
 const ack=actualResponse(f.child);await expect(f.call()).rejects.toThrow('OWNED_CONTROL_SEND_RETURN_UNKNOWN');await ack;
 await expect(f.control.sealAndDrainTransport()).rejects.toThrow('OWNED_CONTROL_TRANSPORT_TAIL_UNKNOWN');expect(hooks).toBe(0);expect(f.floor()).toBe(1);
});

it.each(['async','bound async','proxy'] as const)('pre-rejects an explicit %s SDK send with zero body or trap calls',async kind=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let calls=0;
 const asyncSend=async(frame:unknown,callback:(error:Error|null)=>void)=>{calls++;return send(frame as never,callback);};
 f.child.send=(kind==='async'?asyncSend:kind==='bound async'?asyncSend.bind(null):new Proxy(send,{apply(target,self,args){calls++;return Reflect.apply(target,self,args);},getPrototypeOf(){calls++;throw Error('proxy prototype trap');}})) as typeof f.child.send;
 await expect(f.call()).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_SEND_REQUIRED');expect(calls).toBe(0);expect(f.floor()).toBe(0);await f.control.sealAndDrainTransport();
});

it('sealed admission still settles only its original real late ACK and held SDK callback',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child),emit=f.child.emit.bind(f.child);let releaseCallback:(()=>void)|undefined,releaseAck:(()=>void)|undefined,seenAck!:()=>void;
 const ack=new Promise<void>(yes=>{seenAck=yes;});
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{send(frame as never,error=>{releaseCallback=()=>callback(error);});return false;}) as typeof f.child.send;
 f.child.emit=((event:string|symbol,...args:unknown[])=>{if(event==='message'&&(args[0] as {type?:string})?.type==='response'){releaseAck=()=>{emit(event,...args);};seenAck();return true;}return emit(event,...args);}) as typeof f.child.emit;
 const cause=Error('original configuration admission sealed'),work=f.call(),failed=expect(work).rejects.toBe(cause);let done=false,draining:Promise<void>|undefined;
 try{
  await ack;expect(f.floor()).toBe(1);f.control.seal(cause);await failed;draining=f.control.sealAndDrainTransport().then(()=>{done=true;});releaseAck!();await delay(20);expect(done).toBe(false);releaseCallback!();
  for(let n=0;n<100&&!done;n++)await delay(5);expect(done).toBe(true);await draining;
 }finally{releaseAck?.();releaseCallback?.();f.child.emit=emit;}
});

it('actual child close does not fabricate completion of a held SDK callback',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let release:(()=>void)|undefined;
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{send(frame as never,error=>{release=()=>callback(error);});return true;}) as typeof f.child.send;
 const ack=actualResponse(f.child),work=f.call(),observed=work.catch(error=>error);let done=false,draining:Promise<void>|undefined;
 try{await ack;f.child.kill('SIGTERM');await f.closed;expect(await observed).toBeInstanceOf(Error);draining=f.control.sealAndDrainTransport().then(()=>{done=true;});await delay(20);expect(done).toBe(false);}finally{release?.();}
 await draining;expect(done).toBe(true);expect(f.floor()).toBe(1);
});

it('a real send followed by a synchronous wrapper throw still owns its original callback after child close',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child);let release:(()=>void)|undefined;const cause=Error('original synchronous SDK throw after send');
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{send(frame as never,error=>{release=()=>callback(error);});throw cause;}) as typeof f.child.send;
 const ack=actualResponse(f.child);await expect(f.call()).rejects.toBe(cause);await ack;f.child.kill('SIGTERM');await f.closed;let done=false,draining:Promise<void>|undefined;
 try{draining=f.control.sealAndDrainTransport().then(()=>{done=true;});await delay(20);expect(done).toBe(false);}finally{release?.();}
 await draining;expect(done).toBe(true);expect(f.floor()).toBe(1);
});

it('a serializer installed by the last guard cannot execute in the original Node SDK send',async()=>{
 let last=false,hooks=0;const original=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');
 const f=await fixture(()=>{if(last)Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value:function(){hooks++;return this;}});});const send=f.child.send!.bind(f.child);
 Object.defineProperty(f.child,'send',{configurable:true,get(){last=true;return send;}});let work:Promise<unknown>;
 try{work=f.call();}finally{last=false;if(original)Object.defineProperty(Object.prototype,'toJSON',original);else delete (Object.prototype as Record<string,unknown>).toJSON;}
 expect(await work!).toMatchObject({ok:true,profile:{schemaVersion:2}});expect(hooks).toBe(0);expect(f.floor()).toBe(1);await f.control.sealAndDrainTransport();
});
it('v1 sibling rejects a not-invoked response reentered from its SDK getter before any Native mutation',async()=>{
 const f=await fixture(),send=f.child.send!.bind(f.child),prior=f.initialResponse;
 Object.defineProperty(f.child,'send',{configurable:true,get(){Object.defineProperty(f.child,'send',{configurable:true,writable:true,value:send});f.child.emit('message',{...prior,id:2,op:'prepare_initial_plan_writer'});return send;}});
 const result=await f.call().then(value=>({status:'fulfilled',value}),error=>({status:'rejected',error}));await delay(20);console.log(JSON.stringify({test:'v1-not-invoked-original-Native',status:result.status,floor:f.floor()}));expect(result).toMatchObject({status:'rejected',error:{message:'OWNED_CONTROL_PROTOCOL_INVALID'}});expect(f.floor()).toBe(0);
});
it('v1 result data cannot execute an inherited then getter during native Promise delivery',async()=>{
 const f=await fixture(),emit=f.child.emit.bind(f.child),original=Object.getOwnPropertyDescriptor(Object.prototype,'then');let hooks=0;const cause=Error('v1 result inherited then');
 const restore=()=>{if(original)Object.defineProperty(Object.prototype,'then',original);else delete (Object.prototype as {then?:unknown}).then;};
 f.child.emit=((event:string|symbol,...args:unknown[])=>{if(event==='message'&&(args[0] as {type?:string;op?:string}).type==='response'&&(args[0] as {op?:string}).op==='prepare_initial_plan_writer'){Object.defineProperty(Object.prototype,'then',{configurable:true,get(){if(Object.hasOwn(this,'ok')&&Object.hasOwn(this,'profile')){hooks++;throw cause;}return undefined;}});try{return emit(event,...args);}finally{queueMicrotask(restore);}}return emit(event,...args);}) as typeof f.child.emit;
 const outcome=await f.call().then(value=>({status:'fulfilled',value}),error=>({status:'rejected',error}));restore();f.child.emit=emit;console.log(JSON.stringify({test:'v1-inert-result-delivery',status:outcome.status,hooks,floor:f.floor()}));expect(outcome).toMatchObject({status:'fulfilled',value:{ok:true,profile:{schemaVersion:2}}});expect(hooks).toBe(0);expect(f.floor()).toBe(1);await f.control.sealAndDrainTransport();
});
