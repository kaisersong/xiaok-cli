import {afterEach,describe,expect,it,vi} from 'vitest';
import {ActivityProjectHttpTransport} from '../../../src/runtime/conversation-activity/project-http-transport.js';

const instance='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const subject={projectId:'p',sourceDataEpoch:instance,after:0};
const page=()=>({ok:true,sourceDataEpoch:instance,retainedFromSeq:1,headSeq:0,gap:false,gapRanges:[],coveredThrough:0,nextCursor:0,snapshotRevision:'0',snapshot:{id:'p',name:'Project',status:'active',projectRevision:0,primaryRoomId:null,deliveredAt:null,preparation:null,mapping:null,tasks:[]},events:[]});
const response=(value:unknown,issuer=instance)=>new Response(JSON.stringify(value),{headers:{'x-kswarm-source-instance':issuer}});
function setup(fetcher?:(...args:any[])=>any){
 const fetch=vi.fn(fetcher??((url:string)=>Promise.resolve(response(url.endsWith('/health')?{ok:true,service:{instanceId:instance}}:page()))));
 const realm={url:'http://127.0.0.1:1234',mutationToken:'private',brokerUrl:'http://127.0.0.1:5678',roomToken:'room'};
 const transport=new ActivityProjectHttpTransport({ownerEpoch:'owner',kswarm:realm,fetch});return{transport,fetch,realm};
}
const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
afterEach(()=>vi.unstubAllGlobals());
describe('daemon original project HTTP read owner',()=>{
 it.each(['beforeEffects','assertCurrent'])('requires a synchronous void %s guard instead of accepting an async rejection',async kind=>{
  const rejected=Promise.reject(Error('Guard actually rejected'));void rejected.catch(()=>{});const fetch=vi.fn();
  const transport=new ActivityProjectHttpTransport({ownerEpoch:'owner',kswarm:setup().realm,fetch,...(kind==='assertCurrent'?{assertCurrent:()=>rejected}: {})});
  await expect(transport.readProject(subject,undefined,kind==='beforeEffects'?()=>rejected:undefined)).rejects.toThrow(/before_effects_guard_invalid/);
  expect(fetch).not.toHaveBeenCalled();await transport.close();
 });
 it('drains the already admitted public read even when closed before the health microtask',async()=>{
  const{transport,fetch}=setup();let settled=false;const read=transport.readProject(subject);void read.then(()=>{settled=true;},()=>{settled=true;});
  await transport.close();expect(settled).toBe(true);expect(fetch).not.toHaveBeenCalled();await read.catch(()=>{});
 });
 it('publishes one stop promise before an actual fetch abort listener can reenter close',async()=>{
  const headers=deferred<Response>();let nested:Promise<void>|undefined;
  const{transport,fetch}=setup((_url:string,init:RequestInit)=>{init.signal!.addEventListener('abort',()=>{nested=transport.close();});return headers.promise;});
  const read=transport.readProject(subject),result=read.catch(error=>error);await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
  const stop=transport.close();expect(nested).toBe(stop);headers.resolve(response({ok:true,service:{instanceId:instance}}));await stop;expect(await result).toBeInstanceOf(Error);
 });
 it('pins actual health and page instance and retains only a private immutable data receipt',async()=>{
  const{transport,fetch,realm}=setup();const frame=await transport.readProject(subject);expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]?.[0]).toBe('http://127.0.0.1:1234/projects/p/activity?after=0&limit=200');
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({redirect:'error',headers:{'x-kswarm-mutation-token':'private'}});
  transport.assertProjectRead(subject,frame);expect(Object.isFrozen(frame.page.snapshot)).toBe(true);
  expect(frame.page.delivery.status).toBe('unavailable');expect(()=>transport.assertProjectRead(subject,structuredClone(frame))).toThrow();
  realm.url='http://foreign';realm.mutationToken='changed';await transport.readProject(subject);expect(fetch.mock.calls.at(-1)?.[0]).toContain('127.0.0.1:1234');
  await transport.close();expect(()=>transport.assertProjectRead(subject,frame)).toThrow();
 });
 it.each(['header','health'])('keeps the original legacy event read when the %s lacks instance support, without a positive delivery head',async missing=>{
  const{transport,fetch}=setup((url:string)=>Promise.resolve(url.endsWith('/health')?response({ok:true,service:missing==='health'?{}:{instanceId:instance}}):new Response(JSON.stringify(page()),{headers:missing==='header'?{}:{'x-kswarm-source-instance':instance}})));
  const compatible=await transport.readCompatibleProject(subject);expect(compatible.snapshot.id).toBe('p');expect(compatible.delivery.status).toBe('unavailable');
  expect(()=>transport.assertProjectRead(subject,compatible as any)).toThrow();expect(fetch).toHaveBeenCalledTimes(2);
  await expect(transport.readProject(subject)).rejects.toThrow(/instance/);await transport.close();
 });
 it.each(['header','health'])('does not abort a sibling legacy project read when %s instance support is missing',async missing=>{
  const{transport}=setup((url:string)=>{
   if(url.endsWith('/health'))return Promise.resolve(response({ok:true,service:missing==='health'?{}:{instanceId:instance}}));
   const data=page();if(url.includes('/projects/q/'))data.snapshot.id='q';
   return Promise.resolve(new Response(JSON.stringify(data),{headers:missing==='header'?{}:{'x-kswarm-source-instance':instance}}));
  });
  const results=await Promise.all([transport.readCompatibleProject(subject),transport.readCompatibleProject({...subject,projectId:'q'})]);
  expect(results.map(result=>result.snapshot.id)).toEqual(['p','q']);expect(results.every(result=>result.delivery.status==='unavailable')).toBe(true);await transport.close();
 });
 it('rejects foreign owner frames and changed subjects without invoking subject getters',async()=>{
  const a=setup(),b=setup(),frame=await a.transport.readProject(subject);let calls=0;
  expect(()=>b.transport.assertProjectRead(subject,frame)).toThrow();expect(()=>a.transport.assertProjectRead({...subject,after:1},frame)).toThrow();
  const bad={...subject};Object.defineProperty(bad,'projectId',{get(){calls++;return'p';}});
  expect(()=>a.transport.assertProjectRead(bad,frame)).toThrow();expect(calls).toBe(0);await Promise.all([a.transport.close(),b.transport.close()]);
 });
 it.each(['missing','changed'])('invalidates all old frames on a %s actual page issuer',async kind=>{
  let issuer=instance;const{transport}=setup((url:string)=>Promise.resolve(response(url.endsWith('/health')?{ok:true,service:{instanceId:instance}}:page(),issuer)));
  const first=await transport.readProject(subject);issuer=kind==='missing'?'':other;
  await expect(transport.readProject(subject)).rejects.toThrow(/instance/);expect(()=>transport.assertProjectRead(subject,first)).toThrow();
  issuer=instance;await transport.readProject(subject);await transport.close();
 });
 it('shares one health handshake but never restores a revoked generation after late headers',async()=>{
  const headers=deferred<Response>();const{transport,fetch}=setup((url:string)=>url.endsWith('/health')?headers.promise:Promise.resolve(response(page())));
  const a=transport.readProject(subject),b=transport.readProject(subject);const results=Promise.allSettled([a,b]);
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));transport.invalidate();headers.resolve(response({ok:true,service:{instanceId:instance}}));
  expect((await results).every(result=>result.status==='rejected')).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);await transport.close();
 });
 it('checks the fixed callback after it synchronously invalidates its own receipt',async()=>{
  const{transport}=setup();let invalidate=false;const frame=await transport.readProject(subject,undefined,()=>{if(invalidate)transport.invalidate();});
  invalidate=true;expect(()=>transport.assertProjectRead(subject,frame)).toThrow();await transport.close();
 });
 it('does not dispatch a captured global fetch getter after it seals the owner',async()=>{
  const t=new ActivityProjectHttpTransport({ownerEpoch:'owner',kswarm:setup().realm});let calls=0;
  vi.stubGlobal('fetch',undefined);Object.defineProperty(globalThis,'fetch',{configurable:true,get(){t.invalidate();return()=>{calls++;return Promise.resolve(response(page()));};}});
  await expect(t.readProject(subject)).rejects.toThrow();expect(calls).toBe(0);await t.close();
 });
 it('does not acquire a body reader from a getter which revoked the generation',async()=>{
  const{transport}=setup((url:string)=>{
   if(url.endsWith('/health'))return Promise.resolve(response({ok:true,service:{instanceId:instance}}));
   return Promise.resolve({ok:true,headers:new Headers({'x-kswarm-source-instance':instance}),body:{get getReader(){transport.invalidate();return()=>{acquired++;throw Error('must not acquire');};},cancel:async()=>{}}});
  });let acquired=0;await expect(transport.readProject(subject)).rejects.toThrow();expect(acquired).toBe(0);await transport.close();
 });
 it('keeps stop pending until real late headers and actual cancellation settle',async()=>{
  const headers=deferred<Response>(),cancel=deferred<void>();let cancelled=0;
  const{transport}=setup((url:string)=>url.endsWith('/health')?Promise.resolve(response({ok:true,service:{instanceId:instance}})):headers.promise);
  const read=transport.readProject(subject);const readResult=read.catch(error=>error);await new Promise(resolve=>setTimeout(resolve,5));
  let stopped=false;const stop=transport.close().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
  headers.resolve({ok:true,body:{cancel(){cancelled++;return cancel.promise;}}} as unknown as Response);
  await vi.waitFor(()=>expect(cancelled).toBe(1));expect(stopped).toBe(false);cancel.resolve();await stop;expect(await readResult).toBeInstanceOf(Error);
 });
 it('preserves an independent late socket error together with the actual private stop reason',async()=>{
  const headers=deferred<Response>(),physical=Error('actual late socket failure');let actualSignal:AbortSignal|undefined;
  const{transport,fetch}=setup((_url:string,init:RequestInit)=>{actualSignal=init.signal??undefined;return headers.promise;});
  const read=transport.readProject(subject),result=read.catch(error=>error);await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
  const stop=transport.close(),closed=stop.catch(error=>error);headers.reject(physical);const failure=await result;
  expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors).toEqual([physical,actualSignal!.reason]);expect(await closed).toBeInstanceOf(AggregateError);
 });
 it('actively cancels an already acquired held reader on seal and joins the actual cancel tail',async()=>{
  const tail=deferred<void>();let cancels=0;const body=new ReadableStream<Uint8Array>({cancel(){cancels++;return tail.promise;}});
  const{transport}=setup((url:string)=>Promise.resolve(url.endsWith('/health')?response({ok:true,service:{instanceId:instance}}):new Response(body,{headers:{'x-kswarm-source-instance':instance}})));
  const read=transport.readProject(subject),result=read.catch(error=>error);await vi.waitFor(()=>expect(body.locked).toBe(true));
  let stopped=false;const stop=transport.close().then(()=>{stopped=true;});await vi.waitFor(()=>expect(cancels).toBe(1));expect(stopped).toBe(false);
  tail.resolve();await stop;expect(await result).toBeInstanceOf(Error);expect(cancels).toBe(1);
 });
 it('retains primary IO and raw cancellation failures even after the caller caught them',async()=>{
  const io=Error('actual read failed'),cleanup=Error('actual cancel failed');let cancelCalls=0;
  const{transport}=setup((url:string)=>url.endsWith('/health')?Promise.resolve(response({ok:true,service:{instanceId:instance}})):Promise.resolve({ok:true,headers:new Headers({'x-kswarm-source-instance':instance}),body:{getReader(){return{read:async()=>{throw io;},cancel:async()=>{cancelCalls++;throw cleanup;},releaseLock(){}};}}}));
  let failure:unknown;try{await transport.readProject(subject);}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).errors).toEqual([io,cleanup]);
  await expect(transport.readProject(subject)).rejects.toThrow(/cleanup/);await expect(transport.close()).rejects.toThrow();expect(cancelCalls).toBe(1);
 });
 it.each(['size','utf8','redirect'])('rejects %s without certifying an activity page',async kind=>{
  const{transport}=setup((url:string,init:RequestInit)=>{
   if(url.endsWith('/health'))return Promise.resolve(response({ok:true,service:{instanceId:instance}}));
   expect(init.redirect).toBe('error');if(kind==='redirect')return Promise.reject(Error('actual redirect refused'));
   return Promise.resolve(new Response(kind==='size'?'x'.repeat(2*1024*1024+1):new Uint8Array([0xff]),{headers:{'x-kswarm-source-instance':instance}}));
  });await expect(transport.readProject(subject)).rejects.toThrow();await transport.close();
 });
 it('bounds the original permission reads and refuses paths outside the declared metadata routes',async()=>{
  const{transport,fetch}=setup(()=>Promise.resolve(response({ok:true,room:{id:'r'}})));
  await transport.readJson('broker','/rooms/r');expect(fetch.mock.calls[0]?.[1]).toMatchObject({headers:{'x-intent-broker-room-token':'room'}});
  await expect(transport.readJson('kswarm','/projects/p/delete')).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);await transport.close();
 });
 it('keeps the original routing and Room permission observation in one generation',async()=>{
  const room=deferred<Response>();const{transport,fetch}=setup((url:string)=>url.includes('/activity-identity')?Promise.resolve(response({ok:true,sourceDataEpoch:instance,roomId:'r'})):room.promise);
  const observation=transport.canObserveProject('p',instance),result=observation.catch(error=>error);
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));transport.invalidate();room.resolve(response({ok:true,room:{id:'r'}}));
  expect(await result).toBeInstanceOf(Error);await transport.close();
 });
});
