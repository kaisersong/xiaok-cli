import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve,join} from 'node:path';
import {createKSwarmService,computeKSwarmServiceSourceHash,prepareKSwarmInitialPlanWriter,inspectKSwarmWriter,migrateKSwarmDefaultDispatchWriter,sealAndDrainKSwarmServiceInstance,type KSwarmOwnedControlContext} from '../../electron/kswarm-service.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{vi.useRealTimers();for(const cleanup of cleanups.splice(0).reverse())await cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function fixture({admission=true,attached=false,verify,fault=false,afterCommitFault=false,holdReplyCallback=false,admitDirect}:{admission?:boolean;attached?:boolean;verify?:()=>unknown;fault?:boolean;afterCommitFault?:boolean;holdReplyCallback?:boolean;admitDirect?:()=>unknown}={}){
 let expectedCloseReason:unknown;const root=mkdtempSync(join(tmpdir(),'main-owned-control-')),entry=resolve('../../kswarm/test/fixtures/owned-desktop-control/entry.js');
 vi.stubEnv('KSWARM_SERVER_PATH',entry);let healthy=attached;const children:ChildProcess[]=[],spawns:unknown[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request)=>{const url=String(input);if(url.includes(':4400/health'))return new Response(JSON.stringify({ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:computeKSwarmServiceSourceHash(entry)}}),{status:healthy?200:503});if(url.endsWith('/agents'))return new Response(JSON.stringify({agents:[]}));return new Response(JSON.stringify({ok:true}));}));
 const proof=Object.freeze({}),signal=new AbortController(),context:KSwarmOwnedControlContext={requestSource:'user',admission:proof,signal:signal.signal};
 const service=createKSwarmService({desktopProjectScope:scope,findPortOwner:async()=>null,...(admission?{ownedControlAdmission:admitDirect??((candidate:object)=>{if(candidate!==proof)throw Error('test_admission_foreign');if(verify)return verify();})}:{}),spawnProcess:((command,args,options)=>{spawns.push(options);const child=spawn(process.execPath,[entry],{...options,env:{...process.env,CONTROL_TEST_ROOT:root,...(fault?{CONTROL_TEST_COMMIT_FAULT:'1'}:{}),...(afterCommitFault?{CONTROL_TEST_AFTER_COMMIT_FAULT:'1'}:{}),...(holdReplyCallback?{CONTROL_TEST_HOLD_ACK_CALLBACK:'1'}:{})}});children.push(child);child.once('exit',(code,signal)=>{healthy=false;console.log(JSON.stringify({test:'Main-owned-control',pid:child.pid,code,signal,reaped:true}));});healthy=true;return child;}) as typeof spawn});
 cleanups.push(async()=>{try{await sealAndDrainKSwarmServiceInstance(service);}catch(error){if(!expectedCloseReason)throw error;expect((error as AggregateError).errors).toContain(expectedCloseReason);}for(const child of children)expect(child.exitCode!==null||child.signalCode!==null).toBe(true);rmSync(root,{recursive:true,force:true,maxRetries:5});});
 await service.start();return{service,context,proof,signal,children,spawns,root,allowCloseFailure:(reason:unknown)=>{expectedCloseReason=reason;}};
}
describe('original Main service owned configuration channel',()=>{
 it('spawns only its owned KSwarm server with IPC and calls the actual independent Hub/native writer',async()=>{const f=await fixture();expect(f.spawns[0]).toMatchObject({stdio:['ignore','pipe','pipe','ipc']});expect(await prepareKSwarmInitialPlanWriter(f.service,f.context)).toMatchObject({ok:true,profile:{schemaVersion:2}});expect(await inspectKSwarmWriter(f.service,f.context)).toMatchObject({ok:true,profile:{floor:{schemaVersion:2}}});expect(await migrateKSwarmDefaultDispatchWriter(f.service,f.context)).toMatchObject({ok:true,transition:{toFloor:{schemaVersion:4}}});});
 it('is default deny and denies agent/scheduler even with the same original proof',async()=>{const f=await fixture({admission:false});await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow(/AUTHORITY_REQUIRED/);const installed=await fixture();for(const requestSource of ['agent','scheduler'] as const)await expect(prepareKSwarmInitialPlanWriter(installed.service,{...installed.context,requestSource})).rejects.toThrow(/AUTHORITY_REQUIRED/);});
 it('does not promote an attached healthy HTTP service into an owned configuration channel',async()=>{const f=await fixture({attached:true});expect(f.children).toHaveLength(0);expect(f.service.getStatus().running).toBe(true);await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow(/OWNED_CONTROL_UNAVAILABLE/);});
 it('withdrawal before a call and a foreign copied proof produce no configuration effect',async()=>{const f=await fixture();await expect(prepareKSwarmInitialPlanWriter(f.service,{...f.context,admission:{...f.proof}})).rejects.toThrow('test_admission_foreign');f.signal.abort(Error('actual Main withdrew'));await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('actual Main withdrew');});
 it('synchronous lifecycle reentry during admission cannot send a command',async()=>{let armed=false,work:Promise<void>|undefined;let f:Awaited<ReturnType<typeof fixture>>;f=await fixture({verify:()=>{if(armed){armed=false;work=f.service.stop();}}});armed=true;await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow(/OWNED_CONTROL_CLOSED|OWNED_CONTROL_UNAVAILABLE/);await work;});
});

describe('actual send callback and business response have distinct ownership',()=>{
 it('treats false as backpressure and waits for the real send callback after receiving the actual native ACK',async()=>{
  const f=await fixture();await inspectKSwarmWriter(f.service,f.context);const child=f.children[0]!,send=child.send.bind(child);let release:(()=>void)|undefined;
  child.send=((message:unknown,callback:(error:Error|null)=>void)=>{send(message as never,error=>{release=()=>callback(error);});return false;}) as typeof child.send;
  let settled=false;const work=prepareKSwarmInitialPlanWriter(f.service,f.context).then(value=>{settled=true;return value;});
  for(let n=0;n<100&&!release;n++)await delay(5);expect(release).toBeTypeOf('function');await delay(20);expect(settled).toBe(false);release!();expect(await work).toMatchObject({ok:true,profile:{schemaVersion:2}});
 });
 it('keeps a withdrawn sent command unknown after its real late ACK and permits only fresh-admitted observation',async()=>{
  const f=await fixture();await inspectKSwarmWriter(f.service,f.context);const child=f.children[0]!,send=child.send.bind(child);let release:(()=>void)|undefined;
  child.send=((message:unknown,callback:(error:Error|null)=>void)=>{send(message as never,error=>{release=()=>callback(error);});return true;}) as typeof child.send;
  const cause=Error('original Main withdrawal after send'),work=prepareKSwarmInitialPlanWriter(f.service,f.context);const rejected=expect(work).rejects.toBe(cause);
  for(let n=0;n<100&&!release;n++)await delay(5);await delay(20);f.signal.abort(cause);await rejected;release!();await delay(10);child.send=send;
  const fresh={...f.context,signal:new AbortController().signal};await expect(prepareKSwarmInitialPlanWriter(f.service,fresh)).rejects.toThrow('OWNED_CONTROL_OUTCOME_UNKNOWN');expect(await inspectKSwarmWriter(f.service,fresh)).toMatchObject({ok:true,profile:{floor:{schemaVersion:2}}});
 });
 it('rejects a Promise-returning admission and strongly observes its actual late rejection',async()=>{
  let reject!:(error:unknown)=>void;const tail=new Promise<void>((_,no)=>{reject=no;});const f=await fixture({verify:()=>tail});await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');const cause=Error('actual asynchronous guard failed');f.allowCloseFailure(cause);reject(cause);await delay(0);
 });
});
it('a real committed ACK plus a failed settled send callback permits inspect-only and preserves the original transport error',async()=>{
 const f=await fixture();await inspectKSwarmWriter(f.service,f.context);const child=f.children[0]!,send=child.send.bind(child);let release:(()=>void)|undefined;
 const cause=Error('original send callback uncertainty');
 child.send=((message:unknown,callback:(error:Error|null)=>void)=>{send(message as never,()=>{release=()=>callback(cause);});return false;}) as typeof child.send;
 const work=prepareKSwarmInitialPlanWriter(f.service,f.context),rejected=expect(work).rejects.toBe(cause);
 for(let n=0;n<100&&!release;n++)await delay(5);await delay(20);release!();await rejected;child.send=send;
 await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_OUTCOME_UNKNOWN');
 expect(await inspectKSwarmWriter(f.service,f.context)).toMatchObject({ok:true,profile:{floor:{schemaVersion:2}}});
});
it('service close cannot report success while the original rejected asynchronous guard tail still runs',async()=>{
 let release!:()=>void;const tail=new Promise<void>(resolve=>{release=resolve;});const f=await fixture({verify:()=>tail});await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');
 let done=false;const closing=sealAndDrainKSwarmServiceInstance(f.service).then(()=>{done=true;});await delay(30);const premature=done;release();await closing;expect(premature).toBe(false);
});

it('a real SQLite COMMIT failure transports a bounded original remote cause chain instead of a protocol fault',async()=>{
 const f=await fixture({fault:true});let caught:unknown;try{await prepareKSwarmInitialPlanWriter(f.service,f.context);}catch(error){caught=error;}
 expect(caught).toMatchObject({message:'OWNED_CONTROL_REMOTE_ERROR',remoteError:{name:'PersistenceCommitError',durableCommitted:false}});
 let count=0;for(let row=(caught as {remoteError?:{cause?:unknown}}).remoteError;row;row=row.cause as typeof row)count++;expect(count).toBeLessThanOrEqual(5);
});

it('a nonstandard real Promise guard cannot execute a species getter and start a second native mutation',async()=>{
 let armed=false,speciesReads=0,nested:Promise<unknown>|undefined;let f:Awaited<ReturnType<typeof fixture>>;
 class UnexpectedPromise extends Promise<void>{static get [Symbol.species](){speciesReads++;nested=prepareKSwarmInitialPlanWriter(f.service,f.context);void nested.catch(()=>{});return Promise;}}
 f=await fixture({verify:()=>{if(armed){armed=false;return new UnexpectedPromise(resolve=>resolve());}}});await inspectKSwarmWriter(f.service,f.context);armed=true;
 let caught:unknown;try{await prepareKSwarmInitialPlanWriter(f.service,f.context);}catch(error){caught=error;}f.allowCloseFailure(caught);
 await nested?.catch(()=>{});await delay(20);const db=new DatabaseSync(join(f.root,'state.sqlite'),{readOnly:true});try{expect(db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n).toBe(0);expect(speciesReads).toBe(0);}finally{db.close();}
});
it('a withdrawn first handshake can settle transport identity solely for a fresh inspect and never replays hello or a mutation',async()=>{
 const f=await fixture(),child=f.children[0]!,send=child.send.bind(child);let release:(()=>void)|undefined;
 child.send=((message:unknown,callback:(error:Error|null)=>void)=>{send(message as never,error=>{release=()=>callback(error);});return false;}) as typeof child.send;
 const ack=new Promise(resolve=>child.once('message',resolve));const cause=Error('withdrawn during actual first hello'),work=prepareKSwarmInitialPlanWriter(f.service,f.context),rejected=expect(work).rejects.toBe(cause);
 expect(await ack).toMatchObject({type:'hello_ack'});for(let n=0;n<100&&!release;n++)await delay(5);f.signal.abort(cause);await rejected;release!();await delay(5);child.send=send;
 const fresh={...f.context,signal:new AbortController().signal};await expect(prepareKSwarmInitialPlanWriter(f.service,fresh)).rejects.toThrow('OWNED_CONTROL_OUTCOME_UNKNOWN');expect(await inspectKSwarmWriter(f.service,fresh)).toMatchObject({ok:true,profile:{floor:null}});
});

it('a legitimate next command waits for the previous actual Server ACK send tail instead of being treated as a foreign frame',async()=>{
 const f=await fixture({holdReplyCallback:true});expect(await prepareKSwarmInitialPlanWriter(f.service,f.context)).toMatchObject({ok:true});expect(await inspectKSwarmWriter(f.service,f.context)).toMatchObject({ok:true,profile:{floor:{schemaVersion:2}}});
});
it('guard tails from the previous actual child remain in service drain after a restart',async()=>{
 let armed=true,release!:()=>void;const tail=new Promise<void>(resolve=>{release=resolve;});const f=await fixture({verify:()=>{if(armed){armed=false;return tail;}}});await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');await f.service.restart();expect(f.children).toHaveLength(2);
 let done=false;const closing=sealAndDrainKSwarmServiceInstance(f.service).then(()=>{done=true;});await delay(30);const premature=done;release();await closing;expect(premature).toBe(false);
});
it('the actual Server-only spawn options preserve Windows hiding and never add IPC to the ordinary background default',async()=>{
 const {buildKSwarmServerSpawnOptions,buildBackgroundNodeSpawnOptions}=await import('../../electron/kswarm-service.js');
 expect(buildKSwarmServerSpawnOptions({platform:'win32',env:{ELECTRON_RUN_AS_NODE:'1'}})).toMatchObject({windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{ELECTRON_RUN_AS_NODE:'1'}});expect(buildBackgroundNodeSpawnOptions({platform:'win32'}).stdio).toEqual(['ignore','pipe','pipe']);
});

it('withdrawal at the actual response boundary withholds Main delivery while preserving the already committed writer for observation',async()=>{
 const cause=Error('original config owner withdrawn at reply');let withdrawn=false;const f=await fixture({verify:()=>{if(withdrawn)throw cause;}});await inspectKSwarmWriter(f.service,f.context);
 f.children[0]!.prependOnceListener('message',()=>{withdrawn=true;});await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toBe(cause);withdrawn=false;
 await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_OUTCOME_UNKNOWN');expect(await inspectKSwarmWriter(f.service,f.context)).toMatchObject({ok:true,profile:{floor:{schemaVersion:2}}});
});
it('a duplicate actual child response cannot satisfy a future pending or restore channel qualification',async()=>{
 const f=await fixture();let response:unknown;f.children[0]!.on('message',frame=>{if((frame as {type?:string}).type==='response')response=frame;});await inspectKSwarmWriter(f.service,f.context);expect(response).toBeDefined();f.children[0]!.emit('message',response);await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_CLOSED');
});

it('a real sent command timeout remains sticky after its late native ACK and send callback both settle',async()=>{
 const f=await fixture();await inspectKSwarmWriter(f.service,f.context);const child=f.children[0]!,send=child.send.bind(child);let release:(()=>void)|undefined;
 child.send=((message:unknown,callback:(error:Error|null)=>void)=>{send(message as never,error=>{release=()=>callback(error);});return false;}) as typeof child.send;
 const ack=new Promise(resolve=>child.once('message',resolve));vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const work=prepareKSwarmInitialPlanWriter(f.service,f.context),rejected=expect(work).rejects.toThrow('OWNED_CONTROL_OUTCOME_UNKNOWN');expect(await ack).toMatchObject({type:'response',result:{ok:true}});expect(release).toBeTypeOf('function');await vi.advanceTimersByTimeAsync(30001);await rejected;release!();child.send=send;vi.useRealTimers();
 await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_OUTCOME_UNKNOWN');expect(await inspectKSwarmWriter(f.service,f.context)).toMatchObject({ok:true,profile:{floor:{schemaVersion:2}}});
});
it('a forged own then on the actual standard guard Promise cannot make service drain forget its original held work',async()=>{
 let release!:()=>void;const tail=new Promise<void>(resolve=>{release=resolve;});Object.defineProperty(tail,'then',{value:(resolve:()=>void)=>{resolve();},configurable:true});
 const f=await fixture({verify:()=>tail});await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');let done=false;const closing=sealAndDrainKSwarmServiceInstance(f.service).then(()=>{done=true;});await delay(30);const premature=done;release();await closing;expect(premature).toBe(false);
});

it('an actual known COMMIT followed by swallowed native reentry preserves durable truth across the remote error',async()=>{
 const f=await fixture({afterCommitFault:true});let caught:unknown;try{await prepareKSwarmInitialPlanWriter(f.service,f.context);}catch(error){caught=error;}
 expect(caught).toMatchObject({message:'OWNED_CONTROL_REMOTE_ERROR',remoteError:{name:'PersistenceCommitError',durableCommitted:true}});const db=new DatabaseSync(join(f.root,'state.sqlite'),{readOnly:true});try{expect(db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n).toBe(1);}finally{db.close();}await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_OUTCOME_UNKNOWN');
});

it('does not read a mutable own call hook on the actual child send function',async()=>{
 const f=await fixture();await inspectKSwarmWriter(f.service,f.context);const child=f.children[0]!,send=child.send.bind(child);let reads=0;
 const wrapped=(message:unknown,callback:(error:Error|null)=>void)=>Reflect.apply(send,child,[message,callback]);
 Object.defineProperty(wrapped,'call',{get(){reads++;throw Error('unexpected send.call hook');}});child.send=wrapped as typeof child.send;
 expect(await prepareKSwarmInitialPlanWriter(f.service,f.context)).toMatchObject({ok:true,profile:{schemaVersion:2}});expect(reads).toBe(0);
});

it('a changed global Promise constructor cannot fabricate the actual native configuration result',async()=>{
 const NativePromise=Promise;let armed=false,sends=0;
 const fake=(function(){globalThis.Promise=NativePromise;return NativePromise.resolve({ok:true,profile:{schemaVersion:2}});}) as unknown as PromiseConstructor;
 const f=await fixture({verify:()=>{if(armed){armed=false;globalThis.Promise=fake;}}});await inspectKSwarmWriter(f.service,f.context);
 const child=f.children[0]!,send=child.send.bind(child);child.send=((...args:unknown[])=>{globalThis.Promise=NativePromise;sends++;return Reflect.apply(send,child,args);}) as typeof child.send;armed=true;
 let result:unknown;try{result=await prepareKSwarmInitialPlanWriter(f.service,f.context);}finally{globalThis.Promise=NativePromise;armed=false;}
 expect(result).toMatchObject({ok:true,profile:{schemaVersion:2}});expect(sends).toBe(1);
 const db=new DatabaseSync(join(f.root,'state.sqlite'),{readOnly:true});try{expect(db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n).toBe(1);}finally{db.close();}
});

it('retains the original asynchronous guard tail when the callback changes Set.add',async()=>{
 let armed=false,release!:()=>void;const tail=new Promise<void>(resolve=>{release=resolve;});const original=Set.prototype.add;
 const f=await fixture({verify:()=>{if(armed){Set.prototype.add=function(value:unknown){if(value&&typeof value==='object'&&Object.getOwnPropertyDescriptor(value,'raw')?.value===tail)return this;return Reflect.apply(original,this,[value]);};return tail;}}});await inspectKSwarmWriter(f.service,f.context);armed=true;
 let work:Promise<unknown>;try{work=prepareKSwarmInitialPlanWriter(f.service,f.context);}finally{Set.prototype.add=original;armed=false;}await expect(work!).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');
 let done=false;const closing=sealAndDrainKSwarmServiceInstance(f.service).then(()=>{done=true;});await delay(30);const premature=done;release();await closing;expect(premature).toBe(false);
});

it('service close preserves the actual late guard error under a changed Array.push',async()=>{
 let reject!:(error:unknown)=>void;const tail=new Promise<void>((_,no)=>{reject=no;}),cause=Error('original held guard rejection');const f=await fixture({verify:()=>tail});
 await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');const push=Array.prototype.push;
 Array.prototype.push=function(...values:unknown[]){if(values[0]===cause)return this.length;return Reflect.apply(push,this,values);};
 let caught:unknown;try{const closing=sealAndDrainKSwarmServiceInstance(f.service);const observed=closing.catch(error=>{caught=error;});reject(cause);await observed;}finally{Array.prototype.push=push;}
 f.allowCloseFailure(cause);expect(caught).toBeInstanceOf(AggregateError);expect((caught as AggregateError).errors).toContain(cause);
});

it('rejects explicit asynchronous admission before executing its body',async()=>{
 let calls=0;const f=await fixture({admitDirect:async()=>{calls++;}});
 await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');expect(calls).toBe(0);
});

it.each(['bound async','proxy'] as const)('pre-rejects %s admission with zero body and trap calls',async(kind)=>{
 let calls=0;const fn=async()=>{calls++;};const admitDirect=kind==='bound async'?fn.bind(null):new Proxy(()=>{calls++;},{apply(){calls++;},getPrototypeOf(){calls++;throw Error('proxy trap');}});
 const f=await fixture({admitDirect});await expect(prepareKSwarmInitialPlanWriter(f.service,f.context)).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');expect(calls).toBe(0);
});

it('holds the real guard after Set iterator replacement and never reads nativeThen.call',async()=>{
 let armed=false,reads=0,release!:()=>void;const tail=new Promise<void>(resolve=>{release=resolve;});
 const iterator=Set.prototype[Symbol.iterator],ownCall=Object.getOwnPropertyDescriptor(Promise.prototype.then,'call');
 const f=await fixture({verify:()=>{if(armed){Set.prototype[Symbol.iterator]=function(){const entries=Reflect.apply(iterator,this,[]);const row=entries.next();const value=row.value;const relevant=value&&typeof value==='object'&&(Object.getOwnPropertyDescriptor(value,'raw')?.value===tail||Object.getOwnPropertyDescriptor(value,'child')?.value===f.children[0]||typeof Object.getOwnPropertyDescriptor(value,'drainGuardTails')?.value==='function');return relevant?[][Symbol.iterator]():Reflect.apply(iterator,this,[]);};Object.defineProperty(Promise.prototype.then,'call',{configurable:true,get(){reads++;throw Error('nativeThen.call hook');}});return tail;}}});await inspectKSwarmWriter(f.service,f.context);armed=true;
 let work:Promise<unknown>;try{work=prepareKSwarmInitialPlanWriter(f.service,f.context);}finally{armed=false;if(ownCall)Object.defineProperty(Promise.prototype.then,'call',ownCall);else delete (Promise.prototype.then as unknown as Record<string,unknown>).call;}await expect(work!).rejects.toThrow('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');
 let done=false,premature=false;let closing:Promise<void>;try{closing=sealAndDrainKSwarmServiceInstance(f.service).then(()=>{done=true;});await delay(30);premature=done;}finally{Set.prototype[Symbol.iterator]=iterator;}
 release();await closing!;expect(premature).toBe(false);expect(reads).toBe(0);
});

async function wireReply(profile:unknown){
 const f=await fixture();await inspectKSwarmWriter(f.service,f.context);const child=f.children[0]!;let frame:Record<string,unknown>|undefined;
 child.send=((message:unknown,callback:(error:Error|null)=>void)=>{frame=message as Record<string,unknown>;callback(null);return true;}) as typeof child.send;
 const work=inspectKSwarmWriter(f.service,f.context);expect(frame).toBeDefined();
 child.emit('message',{...frame,type:'response',result:{ok:true,profile}},undefined);return work;
}

it('retains original wire JSON normalization for sparse/undefined/null and null-prototype objects',async()=>{
 const array=new Array(3);array[1]=undefined;array[2]=null;const profile=Object.create(null);profile.array=array;profile.omitted=undefined;Object.defineProperty(profile,'__proto__',{value:'data',enumerable:true});
 expect(await wireReply(profile)).toEqual({ok:true,profile:{array:[null,null,null],['__proto__']:'data'}});
 const result=await wireReply(profile) as {profile:Record<string,unknown>};expect(Object.hasOwn(result.profile,'omitted')).toBe(false);expect(Object.hasOwn(result.profile,'__proto__')).toBe(true);expect(result.profile.__proto__).toBe('data');
});

it.each(['accessor','nonenumerable','symbol','cycle','proxy','array property','depth','nodes','bytes','infinite'] as const)('wire capture rejects %s without invoking user hooks',async(kind)=>{
 let hooks=0;let profile:unknown={};
 if(kind==='accessor')Object.defineProperty(profile,'field',{enumerable:true,get(){hooks++;return 1;}});
 if(kind==='nonenumerable')Object.defineProperty(profile,'field',{value:1});
 if(kind==='symbol')(profile as Record<symbol,unknown>)[Symbol('field')]=1;
 if(kind==='cycle')(profile as Record<string,unknown>).self=profile;
 if(kind==='proxy')profile=new Proxy({},{ownKeys(){hooks++;return [];}});
 if(kind==='array property'){profile=[];(profile as unknown as Record<string,unknown>).field=1;}
 if(kind==='depth'){for(let i=0;i<34;i++)profile={child:profile};}
 if(kind==='nodes')profile=Array.from({length:10001},()=>null);
 if(kind==='bytes')profile={text:'é'.repeat(32768)};
 if(kind==='infinite')profile={field:Infinity};
 await expect(wireReply(profile)).rejects.toThrow('OWNED_CONTROL_PROTOCOL_INVALID');expect(hooks).toBe(0);
});
