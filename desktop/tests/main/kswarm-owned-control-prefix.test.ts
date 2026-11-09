import {afterEach,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import * as moduleUnderTest from '../../../src/runtime/conversation-activity/owned-kswarm-control.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
type PrefixClient={inspectWriter():Promise<unknown>;prepareInitialPlanWriter():Promise<unknown>;sealAndDrainPrefix():Promise<void>};
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(env:Record<string,string>={},extra:Record<string,unknown>={}){
 const root=mkdtempSync(join(tmpdir(),'owned-prefix-parent-')),child=spawn(process.execPath,[resolve('../../kswarm/test/fixtures/owned-control-prefix/entry.js')],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CONTROL_TEST_ROOT:root,...env}});
 const frames:Record<string,unknown>[]=[];let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});child.on('message',frame=>frames.push(frame as Record<string,unknown>));
 const closed=new Promise<void>(yes=>child.once('close',(code,signal)=>{console.log(JSON.stringify({test:'owned-prefix-parent',pid:child.pid,code,signal,reaped:true,cleanupIsNotWholeServerDrain:true}));yes();}));
 cleanups.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await closed;rmSync(root,{recursive:true,force:true,maxRetries:3});});
 const factory=(moduleUnderTest as unknown as {createOwnedKSwarmPrefixV2Client:(options:unknown)=>PrefixClient}).createOwnedKSwarmPrefixV2Client;
 const control=factory({child,scope,...extra});
 async function wait<T>(find:()=>T|false|undefined){for(let n=0;n<800;n++){const result=find();if(result!==false&&result!==undefined)return result;if(child.exitCode!==null||child.signalCode!==null)throw Error('prefix parent child exited '+stderr);await delay(5);}throw Error('prefix parent fixture timeout '+stderr);}
 const frame=(type:string,id?:number)=>wait(()=>frames.find(row=>row.type===type&&(id===undefined||row.id===id)));
 const file=(name:string)=>wait(()=>existsSync(join(root,name))&&JSON.parse(readFileSync(join(root,name),'utf8')));
 const release=(name:string)=>writeFileSync(join(root,'release-'+name),'1');
 const floor=()=>{const db=new DatabaseSync(join(root,'state.sqlite'),{readOnly:true});try{return db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n;}finally{db.close();}};
 return {child,control,closed,frames,frame,file,release,floor,wait};
}
it('fixed v2 facade has only inspect/prepare/prefix close and ignores caller configuration overrides',async()=>{
 let calls=0;const f=await fixture({}, {admit(){calls++;throw Error('foreign injected admit');},isCurrent(){calls++;return false;},protocol:'foreign'});
 expect(Object.keys(f.control).sort()).toEqual(['inspectWriter','prepareInitialPlanWriter','sealAndDrainPrefix']);expect(await f.control.prepareInitialPlanWriter()).toMatchObject({ok:true,profile:{schemaVersion:2}});expect(await f.control.inspectWriter()).toMatchObject({ok:true,profile:{floor:{schemaVersion:2}}});expect(calls).toBe(0);expect(f.floor()).toBe(1);await f.control.sealAndDrainPrefix();
});
it('zero business prefix closes a real v2 session without installing a Native floor',async()=>{
 const f=await fixture();await f.control.sealAndDrainPrefix();expect((await f.frame('prefix_drained')).throughId).toBe(0);expect(f.floor()).toBe(0);await expect(f.control.prepareInitialPlanWriter()).rejects.toThrow('OWNED_CONTROL_CLOSED');
});
it('remote response receipt does not close its KS-owned held SDK callback',async()=>{
 const f=await fixture({CONTROL_PREFIX_HOLD_TYPES:'response'});expect(await f.control.prepareInitialPlanWriter()).toMatchObject({ok:true});await f.file('held-response-1.json');let done=false;const work=f.control.sealAndDrainPrefix().then(()=>{done=true;});await delay(25);expect(done).toBe(false);expect(f.frames.some(row=>row.type==='prefix_drained')).toBe(false);f.release('response-1');await work;expect(done).toBe(true);expect(f.floor()).toBe(1);
});
it('a close invoked during the original hello joins private physical handshake, not its withdrawn caller',async()=>{
 const f=await fixture({CONTROL_PREFIX_HOLD_TYPES:'hello_ack'}),send=f.child.send!.bind(f.child);let releaseParent:(()=>void)|undefined;
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{if((frame as {type?:string}).type==='hello')return send(frame as never,error=>{releaseParent=()=>callback(error);});return send(frame as never,callback);}) as typeof f.child.send;
 const caller=f.control.prepareInitialPlanWriter().catch(error=>error);await f.file('held-hello_ack-0.json');await f.wait(()=>releaseParent);let done=false;const work=f.control.sealAndDrainPrefix().then(()=>{done=true;});const observed=work.catch(error=>error);
 try{expect(await caller).toBeInstanceOf(Error);await delay(20);expect(done).toBe(false);f.release('hello_ack-0');releaseParent!();await work;expect((await f.frame('prefix_drained')).throughId).toBe(0);expect(f.floor()).toBe(0);}finally{f.release('hello_ack-0');releaseParent?.();void observed;}
});
it('lastissued prefix can be sent while its original business ACK is held and cannot fill that ACK',async()=>{
 const f=await fixture();await f.control.inspectWriter();const emit=f.child.emit.bind(f.child);let release:(()=>void)|undefined,seen!:()=>void;const held=new Promise<void>(yes=>{seen=yes;});
 f.child.emit=((event:string|symbol,...args:unknown[])=>{if(event==='message'&&(args[0] as {type?:string,id?:number})?.type==='response'&&(args[0] as {id?:number}).id===2){release=()=>{emit(event,...args);};seen();return true;}return emit(event,...args);}) as typeof f.child.emit;
 const caller=f.control.prepareInitialPlanWriter().catch(error=>error);await held;let done=false;const work=f.control.sealAndDrainPrefix().then(()=>{done=true;});await f.frame('prefix_drained');expect((await f.frame('prefix_drained')).throughId).toBe(2);expect(await caller).toBeInstanceOf(Error);await delay(20);expect(done).toBe(false);release!();await work;f.child.emit=emit;expect(f.floor()).toBe(1);
});
it('remote marker cannot replace the parent SDK callback, including valid false backpressure',async()=>{
 const f=await fixture();await f.control.inspectWriter();const send=f.child.send!.bind(f.child);let release:(()=>void)|undefined;
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{if((frame as {type?:string}).type==='request'){send(frame as never,error=>{release=()=>callback(error);});return false;}return send(frame as never,callback);}) as typeof f.child.send;
 const caller=f.control.prepareInitialPlanWriter().catch(error=>error);await f.frame('response',2);let done=false;const work=f.control.sealAndDrainPrefix().then(()=>{done=true;});await f.frame('prefix_drained');await delay(20);expect(done).toBe(false);release!();await work;expect(await caller).toBeInstanceOf(Error);
});
it('repeated and reentrant close returns the same original promise and sends only one seal',async()=>{
 const f=await fixture();await f.control.inspectWriter();const send=f.child.send!.bind(f.child);let seals=0,reentered:Promise<void>|undefined;
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{if((frame as {type?:string}).type==='seal_prefix'){seals++;reentered=f.control.sealAndDrainPrefix();}return send(frame as never,callback);}) as typeof f.child.send;
 const first=f.control.sealAndDrainPrefix(),second=f.control.sealAndDrainPrefix();expect(first).toBe(second);await first;expect(reentered).toBe(first);expect(seals).toBe(1);
});
it('actual child close without an exact remote prefix marker is unconfirmed',async()=>{
 const f=await fixture({CONTROL_PREFIX_HOLD_TYPES:'response'});await f.control.prepareInitialPlanWriter();await f.file('held-response-1.json');const work=f.control.sealAndDrainPrefix(),failed=expect(work).rejects.toThrow();await delay(10);f.child.kill('SIGTERM');await f.closed;await failed;expect(f.frames.some(row=>row.type==='prefix_drained')).toBe(false);
});

it('v2 closing nonce conversion cannot execute a mutable Buffer serializer',async()=>{
 const f=await fixture();await f.control.inspectWriter();const original=Buffer.prototype.toString;let hooks=0;Buffer.prototype.toString=function(...args:Parameters<Buffer['toString']>){if(args[0]==='hex'&&this.length===32)hooks++;return Reflect.apply(original,this,args);};let work:Promise<void>;
 try{work=f.control.sealAndDrainPrefix();}finally{Buffer.prototype.toString=original;}await work!;expect(hooks).toBe(0);
});
for(const [name,change] of [
 ['nonce',(frame:Record<string,unknown>)=>({...frame,nonce:'e'.repeat(64)})],
 ['scope',(frame:Record<string,unknown>)=>({...frame,scope:{...scope,workspaceId:'e'.repeat(64)}})],
 ['boot',(frame:Record<string,unknown>)=>({...frame,instance:'e'.repeat(64)})],
 ['frontier',(frame:Record<string,unknown>)=>({...frame,throughId:999})],
 ['seal nonce',(frame:Record<string,unknown>)=>({...frame,sealNonce:'e'.repeat(64)})],
 ['extra authority',(frame:Record<string,unknown>)=>({...frame,requestSource:'user'})],
] as const)it('foreign prefix '+name+' cannot qualify its original closing wire',async()=>{
 const f=await fixture();await f.control.inspectWriter();const emit=f.child.emit.bind(f.child);
 f.child.emit=((event:string|symbol,...args:unknown[])=>{if(event==='message'&&(args[0] as {type?:string}).type==='prefix_drained')return emit(event,change(args[0] as Record<string,unknown>),...args.slice(1));return emit(event,...args);}) as typeof f.child.emit;
 await expect(f.control.sealAndDrainPrefix()).rejects.toThrow('OWNED_CONTROL_PROTOCOL_INVALID');await expect(f.control.prepareInitialPlanWriter()).rejects.toThrow('OWNED_CONTROL_CLOSED');expect(f.floor()).toBe(0);
});
it('v1 or extra capability ACK cannot be downgraded into a v2 hello',async()=>{
 const f=await fixture(),emit=f.child.emit.bind(f.child);f.child.emit=((event:string|symbol,...args:unknown[])=>{if(event==='message'&&(args[0] as {type?:string}).type==='hello_ack')return emit(event,{...(args[0] as object),capabilities:['prefix_seal_v1','other']},...args.slice(1));return emit(event,...args);}) as typeof f.child.emit;
 await expect(f.control.prepareInitialPlanWriter()).rejects.toThrow('OWNED_CONTROL_PROTOCOL_INVALID');expect(f.floor()).toBe(0);
});
it('closing from a business SDK getter cannot count or invoke a not-yet-issued business packet',async()=>{
 const f=await fixture();await f.control.inspectWriter();const send=f.child.send!.bind(f.child);let draining:Promise<void>|undefined;
 Object.defineProperty(f.child,'send',{configurable:true,get(){Object.defineProperty(f.child,'send',{configurable:true,writable:true,value:send});draining=f.control.sealAndDrainPrefix();return send;}});
 await expect(f.control.prepareInitialPlanWriter()).rejects.toThrow('OWNED_CONTROL_CLOSED');await draining;expect((await f.frame('prefix_drained')).throughId).toBe(1);expect(f.frames.some(row=>row.type==='response'&&row.id===2)).toBe(false);expect(f.floor()).toBe(0);
});
it('the independent seal SDK wire retains an unknown returned object without calling its then getter',async()=>{
 const f=await fixture();await f.control.inspectWriter();const send=f.child.send!.bind(f.child);let hooks=0;const raw={get then(){hooks++;throw Error('seal SDK then getter');}};
 f.child.send=((frame:unknown,callback:(error:Error|null)=>void)=>{const value=send(frame as never,callback);return (frame as {type?:string}).type==='seal_prefix'?raw:value;}) as typeof f.child.send;
 await expect(f.control.sealAndDrainPrefix()).rejects.toThrow('OWNED_CONTROL_SEND_RETURN_UNKNOWN');await f.frame('prefix_drained');expect(hooks).toBe(0);expect(f.floor()).toBe(0);
});
it('an unsolicited reply while the SDK getter runs cannot qualify a not-invoked business record',async()=>{
 const f=await fixture();await f.control.inspectWriter();const hello=await f.frame('hello_ack'),prior=await f.frame('response',1),send=f.child.send!.bind(f.child);
 // A controlled dispatch-order counterexample using an earlier real read DTO;
 // it is not evidence of a new Native grant or a second actual child response.
 Object.defineProperty(f.child,'send',{configurable:true,get(){Object.defineProperty(f.child,'send',{configurable:true,writable:true,value:send});f.child.emit('message',{protocol:hello.protocol,type:'response',nonce:hello.nonce,scope,instance:hello.instance,id:2,op:'prepare_initial_plan_writer',result:prior.result});return send;}});
 const result=await f.control.prepareInitialPlanWriter().then(value=>({status:'fulfilled',value}),error=>({status:'rejected',error}));await delay(20);console.log(JSON.stringify({test:'not-invoked-reply-original-Native',status:result.status,floor:f.floor()}));expect(result).toMatchObject({status:'rejected',error:{message:'OWNED_CONTROL_PROTOCOL_INVALID'}});expect(f.floor()).toBe(0);
});
it('v2 sibling delivers the actual native result as inert data without inherited then execution',async()=>{
 const f=await fixture(),emit=f.child.emit.bind(f.child),original=Object.getOwnPropertyDescriptor(Object.prototype,'then');let hooks=0;
 const restore=()=>{if(original)Object.defineProperty(Object.prototype,'then',original);else delete (Object.prototype as {then?:unknown}).then;};
 f.child.emit=((event:string|symbol,...args:unknown[])=>{if(event==='message'&&(args[0] as {type?:string;op?:string}).type==='response'&&(args[0] as {op?:string}).op==='prepare_initial_plan_writer'){Object.defineProperty(Object.prototype,'then',{configurable:true,get(){if(Object.hasOwn(this,'ok')&&Object.hasOwn(this,'profile')){hooks++;throw Error('v2 result inherited then');}return undefined;}});try{return emit(event,...args);}finally{queueMicrotask(restore);}}return emit(event,...args);}) as typeof f.child.emit;
 const outcome=await f.control.prepareInitialPlanWriter().then(value=>({status:'fulfilled',value}),error=>({status:'rejected',error}));restore();f.child.emit=emit;console.log(JSON.stringify({test:'v2-inert-result-delivery',status:outcome.status,hooks,floor:f.floor()}));expect(outcome).toMatchObject({status:'fulfilled',value:{ok:true,profile:{schemaVersion:2}}});expect(hooks).toBe(0);expect(f.floor()).toBe(1);await f.control.sealAndDrainPrefix();
});
