// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance,type KSwarmService} from '../../electron/kswarm-service.js';
const subject={projectId:'p',sourceDataEpoch:'11111111-1111-4111-8111-111111111111',after:0};
const echo={'x-kswarm-source-instance':subject.sourceDataEpoch};
const wire=()=>({ok:true,sourceDataEpoch:subject.sourceDataEpoch,retainedFromSeq:1,headSeq:1,gap:false,gapRanges:[],coveredThrough:1,nextCursor:1,snapshotRevision:'1',
  snapshot:{id:'p',name:'Project',status:'created',projectRevision:1,primaryRoomId:null,deliveredAt:null,preparation:null,mapping:null,tasks:[]},
  events:[{schemaVersion:1,eventId:'p#1',source:'kswarm',workId:'p',sourceSequence:1,sourceDataEpoch:subject.sourceDataEpoch,sourceRevision:'1',kind:'accepted',occurredAt:1,sourceType:'project.created',evidenceRefs:[]}],
  delivery:{status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'}});
const closes:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of closes.splice(0))await close();vi.unstubAllGlobals();vi.unstubAllEnvs();});
function deferred<T=void>(){let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function fixture(transport:(init?:RequestInit)=>Promise<Response>){
  const root=mkdtempSync(join(tmpdir(),'original-project-metadata-read-')),entry=join(root,'server.js');writeFileSync(entry,'// controlled adoption fixture');vi.stubEnv('XIAOK_CONFIG_DIR',root);vi.stubEnv('KSWARM_SERVER_PATH',entry);
  let healthInstance:string|undefined=subject.sourceDataEpoch;
  const calls:Array<{url:string;init?:RequestInit}>=[],spawn=vi.fn(()=>{throw Error('No model or child process may be started');});
  vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(String(input));if(url.pathname==='/projects/p/activity'){calls.push({url:String(url),init});return transport(init);}if(url.pathname==='/health')return Response.json({ok:true,features:['dynamic_workflows'],service:{entryPath:entry,instanceId:healthInstance}});if(url.pathname.includes('execution-start'))throw Error('Activity reading must not borrow execution admission');return Response.json({ok:true,agents:[]});}));
  const service=createKSwarmService({desktopProjectScope:{profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},spawnProcess:spawn as never,findPortOwner:async()=>null});
  closes.push(async()=>{await sealAndDrainKSwarmServiceInstance(service).catch(()=>{});rmSync(root,{recursive:true,force:true});});await service.start();return{service,calls,spawn,setHealthInstance:(value:string|undefined)=>{healthInstance=value;}};
}
function read(service:KSwarmService,context:Record<string,unknown>={requestSource:'scheduler',signal:new AbortController().signal}){
  const method=Reflect.get(service,'readProjectActivity');expect(typeof method).toBe('function');
  return Reflect.apply(method,service,[subject,context]) as Promise<{page:ReturnType<typeof wire>}>;
}
function current(service:KSwarmService,receipt:unknown,input:unknown=subject){
  const method=Reflect.get(service,'assertProjectActivityRead');expect(typeof method).toBe('function');Reflect.apply(method,service,[input,receipt]);
}
it('the original service issues only a current immutable metadata-read frame after the actual body, without execution admission',async()=>{
  const f=await fixture(async()=>Response.json(wire(),{headers:echo})),receipt=await read(f.service);expect(receipt.page.delivery.status).toBe('unavailable');expect(f.calls).toHaveLength(1);
  expect(f.calls[0].init?.method).toBe('GET');expect(f.calls[0].init?.redirect).toBe('error');expect(new URL(f.calls[0].url).searchParams.get('limit')).toBe('200');expect(new Headers(f.calls[0].init?.headers).get('x-kswarm-mutation-token')).toBe(f.service.getDesktopMutationToken());
  expect(()=>current(f.service,receipt)).not.toThrow();expect(()=>current(f.service,structuredClone(receipt))).toThrow();expect(()=>current(f.service,receipt,{...subject,after:1})).toThrow();expect(Reflect.set(receipt.page.snapshot,'status','delivered')).toBe(false);expect(f.spawn).not.toHaveBeenCalled();
});
it('agent and missing source contexts cannot call the private observation transport',async()=>{
  const f=await fixture(async()=>Response.json(wire(),{headers:echo}));for(const requestSource of [undefined,'agent'])await expect(read(f.service,{requestSource,signal:new AbortController().signal})).rejects.toThrow(/activity_read_forbidden/);expect(f.calls).toHaveLength(0);
});
it('an adopted service restart invalidates an already delivered frame even when PID and restart count repeat',async()=>{
  const f=await fixture(async()=>Response.json(wire(),{headers:echo})),receipt=await read(f.service),before=f.service.getStatus();await f.service.restart();expect(f.service.getStatus()).toMatchObject({pid:before.pid,restartCount:before.restartCount});expect(()=>current(f.service,receipt)).toThrow(/activity_read_not_current/);
});
it('an old body crossing issuer restart cannot mint a fresh frame',async()=>{
  let controller!:ReadableStreamDefaultController<Uint8Array>;const body=new ReadableStream<Uint8Array>({start(value){controller=value;}}),f=await fixture(async()=>new Response(body,{headers:echo}));
  const pending=read(f.service),outcome=pending.then(value=>({value}),error=>({error}));try{await vi.waitFor(()=>expect(body.locked).toBe(true));await f.service.restart();controller.enqueue(new TextEncoder().encode(JSON.stringify(wire())));controller.close();const result=await outcome;expect('error'in result).toBe(true);}finally{try{controller.close();}catch{}await pending.catch(()=>{});}
});
it('close joins the original held body and actual cancellation cleanup before settling, preserving the read abort',async()=>{
  const cancelled=deferred(),cleanup=deferred(),body=new ReadableStream<Uint8Array>({cancel(){cancelled.resolve();return cleanup.promise;}}),f=await fixture(async()=>new Response(body,{headers:echo}));let closing:Promise<void>|undefined;
  const pending=read(f.service),outcome=pending.catch(error=>error);try{await vi.waitFor(()=>expect(body.locked).toBe(true));let settled=false;closing=sealAndDrainKSwarmServiceInstance(f.service);void closing.then(()=>{settled=true;},()=>{settled=true;});await cancelled.promise;await new Promise<void>(yes=>setImmediate(yes));expect(settled).toBe(false);cleanup.resolve();const primary=await outcome;expect(primary).toBeInstanceOf(Error);const error=await closing.catch(error=>error);expect(error).toBeInstanceOf(AggregateError);const contains=(value:unknown):boolean=>value===primary||value instanceof AggregateError&&value.errors.some(contains)||value instanceof Error&&contains(value.cause);expect(contains(error)).toBe(true);}finally{cleanup.resolve();await pending.catch(()=>{});await closing?.catch(()=>{});}
});
it('invalid UTF-8 and oversized actual body bytes never become a metadata frame',async()=>{
  let response=()=>new Response(new Uint8Array([0xff]),{headers:echo});const f=await fixture(async()=>response());await expect(read(f.service)).rejects.toThrow();response=()=>new Response('x'.repeat(2*1024*1024+1),{headers:echo});await expect(read(f.service)).rejects.toThrow(/activity_read_body_too_large/);
});
it('a caller abort joins late original headers and preserves the physical error as well as revocation',async()=>{
  const headers=deferred<Response>(),entered=deferred(),abort=new AbortController(),physical=Error('Original activity GET socket failed'),control=Error('Actual source stopped');let signal:AbortSignal|undefined;
  const f=await fixture(async init=>{signal=init?.signal??undefined;entered.resolve();return headers.promise;});const pending=read(f.service,{requestSource:'scheduler',signal:abort.signal}),outcome=pending.catch(error=>error);let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});
  try{await entered.promise;abort.abort(control);expect(signal?.aborted).toBe(true);await new Promise<void>(yes=>setImmediate(yes));expect(settled).toBe(false);headers.reject(physical);const result=await outcome;const contains=(value:unknown,target:unknown):boolean=>value===target||value instanceof Error&&contains(value.cause,target)||value instanceof AggregateError&&value.errors.some(item=>contains(item,target));expect(contains(result,physical)).toBe(true);expect(contains(result,control)).toBe(true);expect(f.calls).toHaveLength(1);}finally{headers.reject(physical);await pending.catch(()=>{});}
});
it('a synchronous reader-method getter cannot start a new read after reentering service close',async()=>{
  const body=new ReadableStream<Uint8Array>(),original=body.getReader;let closing:Promise<void>|undefined,gets=0,f:Awaited<ReturnType<typeof fixture>>;
  Object.defineProperty(body,'getReader',{get(){closing=sealAndDrainKSwarmServiceInstance(f.service);void closing.catch(()=>{});return function(this:ReadableStream<Uint8Array>){gets++;return original.call(this);};}});
  f=await fixture(async()=>new Response(body,{headers:echo}));await expect(read(f.service)).rejects.toThrow();expect(gets).toBe(0);await closing?.catch(()=>{});
});
it('an unknown cancellation failure stays sticky on the original service and preserves primary and cleanup errors',async()=>{
  const primary=Error('Original source permission withdrawn'),physical=Error('Actual metadata body cancellation failed');let admitted=true;
  const body=new ReadableStream<Uint8Array>({cancel(){throw physical;}}),f=await fixture(async()=>{admitted=false;return new Response(body,{headers:echo});});
  const error=await read(f.service,{requestSource:'scheduler',signal:new AbortController().signal,beforeEffects:()=>{if(!admitted)throw primary;}}).catch(error=>error);
  const contains=(value:unknown,target:unknown):boolean=>value===target||value instanceof AggregateError&&value.errors.some(item=>contains(item,target))||value instanceof Error&&contains(value.cause,target);
  expect(contains(error,primary)).toBe(true);expect(contains(error,physical)).toBe(true);
  await expect(f.service.request('/projects/p/tasks',{method:'POST'})).rejects.toThrow('kswarm_metadata_cleanup_unconfirmed');expect(()=>f.service.getDesktopMutationToken()).toThrow('kswarm_metadata_cleanup_unconfirmed');
  const closing=await sealAndDrainKSwarmServiceInstance(f.service).catch(error=>error);expect(contains(closing,physical)).toBe(true);expect(f.calls).toHaveLength(1);
});
it('the final private current check rejects a subject accessor without executing it',async()=>{
  const f=await fixture(async()=>Response.json(wire(),{headers:echo})),receipt=await read(f.service);let calls=0,stopping:Promise<void>|undefined;
  const input={...subject};Object.defineProperty(input,'projectId',{enumerable:true,get(){calls++;stopping=f.service.stop();return'p';}});
  try{expect(()=>current(f.service,receipt,input)).toThrow();expect(calls).toBe(0);}finally{await stopping?.catch(()=>{});}
});
it('the final private current check revalidates the issuer after its actual synchronous guard returns',async()=>{
  const f=await fixture(async()=>Response.json(wire(),{headers:echo}));let seal=false,closing:Promise<void>|undefined;
  const receipt=await read(f.service,{requestSource:'scheduler',signal:new AbortController().signal,beforeEffects:()=>{if(seal){seal=false;closing=sealAndDrainKSwarmServiceInstance(f.service);void closing.catch(()=>{});}}});
  try{seal=true;expect(()=>current(f.service,receipt)).toThrow();}finally{await closing?.catch(()=>{});}
});

it.each(['missing','foreign'])('a %s actual B page instance echo cannot mint or preserve a protected read frame',async kind=>{
 let issuer:string|undefined=subject.sourceDataEpoch;const f=await fixture(async()=>Response.json(wire(),{headers:issuer===undefined?{}:{'x-kswarm-source-instance':issuer}}));
 const first=await read(f.service);issuer=kind==='missing'?undefined:'22222222-2222-4222-8222-222222222222';
 const failure=await read(f.service).catch(error=>error);expect(failure).toBeInstanceOf(AggregateError);expect(failure.cause?.message).toBe('kswarm_activity_read_instance_changed');expect(()=>current(f.service,first)).toThrow();
});
it.each(['missing','aba'])('the original health owner %s observation revokes already issued private frames',async kind=>{
 const f=await fixture(async()=>Response.json(wire(),{headers:echo})),receipt=await read(f.service);
 f.setHealthInstance(kind==='missing'?undefined:'22222222-2222-4222-8222-222222222222');await f.service.getServiceStatus();
 if(kind==='aba'){f.setHealthInstance(subject.sourceDataEpoch);await f.service.getHealthDiagnosticInput();}
 expect(()=>current(f.service,receipt)).toThrow();
});
it('an original body cannot cross an actual health UUID change even while Main child identity stays the same',async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>;const body=new ReadableStream<Uint8Array>({start(value){controller=value;}}),f=await fixture(async()=>new Response(body,{headers:echo}));
 const pending=read(f.service),result=pending.catch(error=>error);await vi.waitFor(()=>expect(body.locked).toBe(true));
 f.setHealthInstance('22222222-2222-4222-8222-222222222222');await f.service.getServiceStatus();controller.enqueue(new TextEncoder().encode(JSON.stringify(wire())));controller.close();
 expect(await result).toBeInstanceOf(Error);
});
it('a late old health response cannot repin a new read to the issuer superseded by a newer health observation',async()=>{
 const f=await fixture(async()=>Response.json(wire(),{headers:echo}));await read(f.service);
 const actualFetch=globalThis.fetch,headers=deferred<Response>(),entered=deferred();let hold=true;
 vi.stubGlobal('fetch',async(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(String(input));if(hold&&url.port==='4400'&&url.pathname==='/health'){hold=false;entered.resolve();return headers.promise;}return actualFetch(input,init);});
 const older=f.service.getServiceStatus();await entered.promise;f.setHealthInstance('22222222-2222-4222-8222-222222222222');await f.service.getServiceStatus();
 headers.resolve(Response.json({ok:true,service:{instanceId:subject.sourceDataEpoch}}));await older;
 await expect(read(f.service)).rejects.toThrow();
});
it('looking up the actual instance header method cannot acquire a reader after synchronously sealing the original ingress',async()=>{
 let closing:Promise<void>|undefined,reads=0,f:Awaited<ReturnType<typeof fixture>>;
 const stream=new ReadableStream<Uint8Array>(),getReader=stream.getReader;
 Object.defineProperty(stream,'getReader',{value:function(this:ReadableStream<Uint8Array>){reads++;return getReader.call(this);}});
 const response=new Response(stream,{headers:echo}),headers=response.headers,get=headers.get;
 Object.defineProperty(headers,'get',{get(){closing=sealAndDrainKSwarmServiceInstance(f.service);void closing.catch(()=>{});return get;}});
 f=await fixture(async()=>response);await expect(read(f.service)).rejects.toThrow();expect(reads).toBe(0);await closing?.catch(()=>{});
});
