import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance,type KSwarmService} from '../../electron/kswarm-service.js';
const domain={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
const wire=()=>({ok:true,protocol:'ordinary_project_execution_start_read_v1',projectId:'p',classification:'ordinary',bindingDigest:'d'.repeat(64),scope:{...domain}});
function deferred<T=void>(){let resolve!:(value:T|PromiseLike<T>)=>void;let reject!:(cause:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function fixture(body:()=>Response|Promise<Response>=()=>Response.json(wire()),scope:{profileId:string;workspaceId:string}|null={...domain}){
 const root=mkdtempSync(join(tmpdir(),'kswarm-execution-read-')),entry=join(root,'server.js');writeFileSync(entry,'// isolated original-service reader fixture');
 vi.stubEnv('XIAOK_CONFIG_DIR',root);vi.stubEnv('KSWARM_SERVER_PATH',entry);
 const spawn=vi.fn(()=>{throw Error('unexpected physical spawn');}),calls:Array<{url:string;init:RequestInit|undefined}>=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(String(input));calls.push({url:String(url),init});
  if(url.pathname.endsWith('/execution-start-admission'))return body();
  if(url.pathname==='/health')return Response.json({ok:true,features:['dynamic_workflows'],service:{entryPath:entry}});
  return Response.json({ok:true,agents:[]});
 }));
 const service=createKSwarmService({desktopProjectScope:scope??undefined,spawnProcess:spawn as never,findPortOwner:async()=>null});
 try{await service.start();}catch(error){await sealAndDrainKSwarmServiceInstance(service).catch(()=>{});rmSync(root,{recursive:true,force:true});throw error;}
 return{service,calls,spawn,async close(){await sealAndDrainKSwarmServiceInstance(service).catch(()=>{});rmSync(root,{recursive:true,force:true});}};
}
function read(service:KSwarmService){expect(typeof (service as any).readProjectExecutionStart).toBe('function');return (service as any).readProjectExecutionStart('p') as Promise<unknown>;}
it('consuming an original execution-read cancellation error cannot erase shared cleanup custody or reopen sibling writes',async()=>{
 const physical=Error('Actual execution-read body cancellation failed'),body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(8193));},cancel(){throw physical;}}),f=await fixture(()=>new Response(body));
 try{const error=await read(f.service).catch(error=>error);const contains=(value:unknown):boolean=>value===physical||value instanceof AggregateError&&value.errors.some(contains)||value instanceof Error&&contains(value.cause);expect(contains(error)).toBe(true);await expect(f.service.request('/projects/p/tasks',{method:'POST'})).rejects.toThrow('kswarm_metadata_cleanup_unconfirmed');expect(()=>f.service.getDesktopMutationToken()).toThrow('kswarm_metadata_cleanup_unconfirmed');const closing=await sealAndDrainKSwarmServiceInstance(f.service).catch(error=>error);expect(contains(closing)).toBe(true);}finally{await f.close();}
});
it('the original execution reader does not acquire a new body reader after a synchronous method getter seals the service',async()=>{
 const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify(wire())));controller.close();}}),acquire=body.getReader;let f:Awaited<ReturnType<typeof fixture>>,closing:Promise<void>|undefined,calls=0;
 Object.defineProperty(body,'getReader',{get(){closing=sealAndDrainKSwarmServiceInstance(f.service);void closing.catch(()=>{});return function(this:ReadableStream<Uint8Array>){calls++;return acquire.call(this);};}});
 f=await fixture(()=>new Response(body));try{await expect(read(f.service)).rejects.toThrow();expect(calls).toBe(0);}finally{await closing?.catch(()=>{});await f.close();}
});
it('looking up the actual fetch function cannot dispatch the original execution read after seal reenters',async()=>{
 const f=await fixture(),dispatch=globalThis.fetch;let closing:Promise<void>|undefined;
 Object.defineProperty(globalThis,'fetch',{configurable:true,get(){closing=sealAndDrainKSwarmServiceInstance(f.service);void closing.catch(()=>{});return dispatch;}});
 try{await expect(read(f.service)).rejects.toThrow();expect(f.calls.filter(call=>call.url.endsWith('/execution-start-admission'))).toHaveLength(0);}finally{await closing?.catch(()=>{});await f.close();}
});
it('original service reads a fixed authenticated closed response against its frozen launch audience',async()=>{
 const mutable={...domain},f=await fixture(()=>Response.json(wire()),mutable);mutable.workspaceId='c'.repeat(64);
 try{await expect(read(f.service)).resolves.toEqual(wire());const request=f.calls.find(call=>call.url.endsWith('/execution-start-admission'))!;expect(request.init?.redirect).toBe('error');expect(new Headers(request.init?.headers).get('x-kswarm-mutation-token')).toBe(f.service.getDesktopMutationToken());expect(f.spawn).not.toHaveBeenCalled();}
 finally{await f.close();}
});
it('same credential cannot turn a foreign launch scope or unknown wire into legacy permission',async()=>{
 let response=()=>Response.json(wire());const f=await fixture(()=>response());
 try{for(const value of [{...wire(),scope:{...domain,workspaceId:'c'.repeat(64)}},{...wire(),protocol:'future'},{...wire(),classification:'candidate'},{...wire(),classification:['ordinary']},{...wire(),projectId:'other'},{...wire(),extra:true},{...wire(),scope:null}]){response=()=>Response.json(value);await expect(read(f.service)).rejects.toThrow();}
  response=()=>Response.json({error:'not_found'},{status:404});await expect(read(f.service)).rejects.toThrow();response=()=>new Response('x'.repeat(8193));await expect(read(f.service)).rejects.toThrow();response=()=>new Response('界'.repeat(2731));await expect(read(f.service)).rejects.toThrow();expect(f.spawn).not.toHaveBeenCalled();}
 finally{await f.close();}
});
it('missing fixed launch audience rejects before the semantic HTTP request',async()=>{
 const f=await fixture(()=>Response.json(wire()),null);try{await expect(read(f.service)).rejects.toThrow();expect(f.calls.filter(call=>call.url.endsWith('/execution-start-admission'))).toHaveLength(0);}finally{await f.close();}
});
it('original close holds headers raw tail until it really returns and never delivers its late response',async()=>{
 const headers=deferred<Response>(),entered=deferred(),f=await fixture(()=>{entered.resolve();return headers.promise;});let reading:Promise<unknown>|undefined,closing:Promise<void>|undefined;
 try{reading=read(f.service);const failure=reading.catch(error=>error);await entered.promise;let closed=false;closing=sealAndDrainKSwarmServiceInstance(f.service);void closing.then(()=>{closed=true;},()=>{closed=true;});await new Promise(resolve=>setTimeout(resolve,15));expect(closed).toBe(false);headers.resolve(Response.json(wire()));expect(await failure).toBeInstanceOf(Error);await expect(closing).rejects.toThrow();}
 finally{headers.resolve(Response.json(wire()));await reading?.catch(()=>{});await closing?.catch(()=>{});await f.close();}
});
it('original close owns held body cancellation until actual cleanup settles and keeps its error',async()=>{
 const cancelled=deferred(),cleanup=deferred(),body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"ok":'));},cancel(){cancelled.resolve();return cleanup.promise;}}),f=await fixture(()=>new Response(body));let reading:Promise<unknown>|undefined,closing:Promise<void>|undefined;const fault=Error('original body cancellation failed');
 try{reading=read(f.service);const failure=reading.catch(error=>error);await vi.waitFor(()=>expect(body.locked).toBe(true));let closed=false;closing=sealAndDrainKSwarmServiceInstance(f.service);void closing.then(()=>{closed=true;},()=>{closed=true;});await cancelled.promise;await new Promise(resolve=>setTimeout(resolve,15));expect(closed).toBe(false);cleanup.reject(fault);const error=await failure;expect(error).toBeInstanceOf(Error);const includes=(value:any):boolean=>value===fault||Boolean(value?.cause&&includes(value.cause))||Boolean(Array.isArray(value?.errors)&&value.errors.some(includes));expect(includes(error)).toBe(true);const closeError=await closing.catch(cause=>cause);expect(includes(closeError)).toBe(true);}
 finally{cleanup.resolve();await reading?.catch(()=>{});await closing?.catch(()=>{});await f.close();}
});

it('a stop and adoption restart cannot make a held old read current again when pid/restartCount return to the same values',async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>,cancelled=false;const body=new ReadableStream<Uint8Array>({start(value){controller=value;},cancel(){cancelled=true;}}),f=await fixture(()=>new Response(body));let reading:Promise<unknown>|undefined;
 try{reading=read(f.service);const failure=reading.catch(error=>error);await vi.waitFor(()=>expect(body.locked).toBe(true));const before=f.service.getStatus();await f.service.restart();expect(f.service.getStatus().pid).toBe(before.pid);expect(f.service.getStatus().restartCount).toBe(before.restartCount);if(!cancelled){controller.enqueue(new TextEncoder().encode(JSON.stringify(wire())));controller.close();}expect(await failure).toBeInstanceOf(Error);}
 finally{if(!cancelled)try{controller.close();}catch{}await reading?.catch(()=>{});await f.close();}
});
it('original synchronous read fence refuses JSON copies and reads from a previous source incarnation',async()=>{
 const f=await fixture();try{const receipt=await read(f.service);expect(typeof (f.service as any).assertProjectExecutionStartRead).toBe('function');expect(()=>(f.service as any).assertProjectExecutionStartRead('p',receipt)).not.toThrow();expect(()=>(f.service as any).assertProjectExecutionStartRead('p',JSON.parse(JSON.stringify(receipt)))).toThrow();expect(()=>(f.service as any).assertProjectExecutionStartRead('other',receipt)).toThrow();await f.service.restart();expect(()=>(f.service as any).assertProjectExecutionStartRead('p',receipt)).toThrow();}finally{await f.close();}
});

it('read completion does not authorize a producer after seal wins before the caller continuation',async()=>{
 const f=await fixture();let closing:Promise<void>|undefined;
 try{const receipt=await read(f.service);const continuation=Promise.resolve().then(()=>{expect(()=>(f.service as any).assertProjectExecutionStartRead('p',receipt)).toThrow();});closing=sealAndDrainKSwarmServiceInstance(f.service);await continuation;await closing;}finally{await closing?.catch(()=>{});await f.close();}
});

it('another original service instance cannot accept the first instance read receipt',async()=>{
 const first=await fixture();let second:Awaited<ReturnType<typeof fixture>>|undefined;try{const receipt=await read(first.service);second=await fixture();expect(()=>(second!.service as any).assertProjectExecutionStartRead('p',receipt)).toThrow();}finally{await second?.close();await first.close();}
});
it('a failed source restart invalidates the old read even when running, pid and restart count stay unchanged',async()=>{
 const f=await fixture(),fault=Error('owned restart request failed');try{f.service.bindActivityOwner!({ownerEpoch:'fixed-reader-fixture',request:vi.fn(async()=>{throw fault;})} as never);const receipt=await read(f.service),before=f.service.getStatus();await expect(f.service.restart()).rejects.toBe(fault);expect(f.service.getStatus()).toMatchObject({running:before.running,pid:before.pid,restartCount:before.restartCount});expect(()=>(f.service as any).assertProjectExecutionStartRead('p',receipt)).toThrow();}finally{await f.close();}
});
it('source replacement during a held first fetch prevents a second base URL request and preserves the original transport fault',async()=>{
 const headers=deferred<Response>(),f=await fixture(()=>headers.promise),fault=Error('actual first read transport failed');let reading:Promise<unknown>|undefined;
 try{reading=read(f.service);const failure=reading.catch(error=>error);await vi.waitFor(()=>expect(f.calls.filter(call=>call.url.endsWith('/execution-start-admission'))).toHaveLength(1));await f.service.restart();headers.reject(fault);const error=await failure;expect(f.calls.filter(call=>call.url.endsWith('/execution-start-admission'))).toHaveLength(1);const includes=(value:any):boolean=>value===fault||Boolean(value?.cause&&includes(value.cause))||Boolean(Array.isArray(value?.errors)&&value.errors.some(includes));expect(includes(error)).toBe(true);}
 finally{headers.reject(fault);await reading?.catch(()=>{});await f.close();}
});

it('the original thirty-second deadline aborts transport but retains the raw cancel tail until cleanup finishes',async()=>{
 vi.useFakeTimers();const cleanup=deferred();let cancelled=0;const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"ok":'));},cancel(){cancelled++;return cleanup.promise;}}),f=await fixture(()=>new Response(body));let reading:Promise<unknown>|undefined,closing:Promise<void>|undefined;
 try{reading=read(f.service);const failure=reading.catch(error=>error);await vi.waitFor(()=>expect(body.locked).toBe(true));let settled=false;void failure.then(()=>{settled=true;});await vi.advanceTimersByTimeAsync(30000);expect(cancelled).toBe(1);expect(settled).toBe(false);const requests=f.calls.filter(call=>call.url.endsWith('/execution-start-admission'));expect(requests).toHaveLength(1);expect(requests[0]!.init?.signal?.aborted).toBe(true);closing=sealAndDrainKSwarmServiceInstance(f.service);cleanup.resolve();expect(String(await failure)).toContain('kswarm_execution_read_timeout');await expect(closing).rejects.toThrow();}
 finally{cleanup.resolve();await reading?.catch(()=>{});await closing?.catch(()=>{});await f.close();}
});
