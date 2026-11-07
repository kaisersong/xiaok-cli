import {it,expect,vi} from 'vitest';
import {ActivityProjectHttpTransport} from '../../../src/runtime/conversation-activity/project-http-transport.js';
const instance='11111111-1111-4111-8111-111111111111',scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},audience={projectId:'p',sourceDataEpoch:instance,after:0,...scope};
const page=(id='p')=>({ok:true,sourceDataEpoch:instance,retainedFromSeq:1,headSeq:0,gap:false,gapRanges:[],coveredThrough:0,nextCursor:0,snapshotRevision:'0',snapshot:{id,name:'P',status:'active',projectRevision:1,primaryRoomId:null,deliveredAt:null,preparation:null,mapping:null,tasks:[]},events:[]});
const envelope=(id='p')=>({ok:true,protocol:'scoped_project_activity_v1',projectId:id,scope:{...scope},bindingDigest:'c'.repeat(64),page:page(id)});
const echoes={'x-kswarm-source-instance':instance,'x-kswarm-activity-profile':'project_delivery_v1'};
function fixture(reply:(id:string)=>Response=id=>Response.json(envelope(id),{headers:echoes}),boot=true,onInvalidated?:()=>void){
 const fetch=vi.fn(async(url:string,init?:RequestInit)=>url.endsWith('/health')?Response.json(boot?{ok:true,service:{instanceId:instance}}:{ok:true}):reply(url.includes('/projects/q/')?'q':'p'));
 const transport=new ActivityProjectHttpTransport({ownerEpoch:'owner',kswarm:{url:'http://127.0.0.1:1234',mutationToken:'private',brokerUrl:'http://127.0.0.1:5678',roomToken:'room'},fetch,onInvalidated});return{transport,fetch};
}
const read=(transport:ActivityProjectHttpTransport,input:unknown=audience,signal?:AbortSignal,guard?:()=>void):Promise<any>=>{const fn=Reflect.get(transport,'readProjectSource');expect(fn).toBeTypeOf('function');return Reflect.apply(fn,transport,[input,signal,guard]);};
const current=(transport:ActivityProjectHttpTransport,frame:unknown,input:unknown=audience)=>{const fn=Reflect.get(transport,'assertProjectSourceRead');expect(fn).toBeTypeOf('function');return Reflect.apply(fn,transport,[input,frame]);};
it('uses one actual activity GET for ordinary source and a separate original scoped qualification',async()=>{
 const f=fixture();try{const frame=await read(f.transport);expect(frame.kind).toBe('activity_project_source_http_read_v1');expect(frame.page.delivery.status).toBe('unavailable');expect(frame.scoped).toBeDefined();current(f.transport,frame);f.transport.assertScopedProjectRead(audience,frame.scoped);expect(f.fetch.mock.calls.filter(([url])=>url.includes('/activity?'))).toHaveLength(1);const request=new Headers(f.fetch.mock.calls[1]![1]?.headers);expect(request.get('x-kswarm-activity-profile')).toBe(null);expect(request.get('x-kswarm-source-read')).toBe('project_source_v1');}finally{await f.transport.close();}
});
it('keeps a legacy plain page ordinary-only without a second fallback activity GET',async()=>{
 const f=fixture(id=>Response.json(page(id),{headers:{'x-kswarm-source-instance':instance}}));try{const frame=await read(f.transport);expect(frame.scoped).toBeUndefined();expect(frame.page.delivery.status).toBe('unavailable');current(f.transport,frame);expect(()=>f.transport.assertScopedProjectRead(audience,frame)).toThrow();expect(f.fetch.mock.calls.filter(([url])=>url.includes('/activity?'))).toHaveLength(1);}finally{await f.transport.close();}
});
it.each(['health','echo'])('keeps both parallel legacy source frames current when %s lacks boot support',async missing=>{
 const f=fixture(id=>Response.json(page(id),{headers:missing==='echo'?{}:{'x-kswarm-source-instance':instance}}),missing!=='health');
 try{const a={...audience},b={...audience,projectId:'q'},[p,q]=await Promise.all([read(f.transport,a),read(f.transport,b)]);current(f.transport,p,a);current(f.transport,q,b);expect(p.scoped).toBeUndefined();expect(q.scoped).toBeUndefined();}finally{await f.transport.close();}
});
it('validates a correctly negotiated scoped body even when missing boot permits only ordinary qualification',async()=>{
 const f=fixture(undefined,false);try{const frame=await read(f.transport);current(f.transport,frame);expect(frame.scoped).toBeUndefined();expect(frame.page.delivery.status).toBe('unavailable');}finally{await f.transport.close();}
});
it.each([401,403,503])('never falls back after HTTP %s',async status=>{
 const f=fixture(()=>Response.json({ok:false},{status}));try{await expect(read(f.transport)).rejects.toThrow('activity_source_http_'+status);expect(f.fetch.mock.calls.filter(([url])=>url.includes('/activity?'))).toHaveLength(1);}finally{await f.transport.close();}
});
it.each(['profile','scope'])('rejects a nonempty foreign %s instead of treating it as a legacy page',async kind=>{
 const f=fixture(id=>{const body=envelope(id);if(kind==='scope')body.scope.workspaceId='d'.repeat(64);return Response.json(body,{headers:{...echoes,'x-kswarm-activity-profile':kind==='profile'?'future':'project_delivery_v1'}});});try{await expect(read(f.transport)).rejects.toThrow();expect(f.fetch.mock.calls.filter(([url])=>url.includes('/activity?'))).toHaveLength(1);}finally{await f.transport.close();}
});
it('rejects cloned, foreign-owner and changed-audience ordinary frames',async()=>{
 const a=fixture(),b=fixture();try{const frame=await read(a.transport);expect(()=>current(a.transport,structuredClone(frame))).toThrow();expect(()=>current(b.transport,frame)).toThrow();expect(()=>current(a.transport,frame,{...audience,workspaceId:'d'.repeat(64)})).toThrow();expect(()=>a.transport.assertScopedProjectRead(audience,frame)).toThrow();}finally{await Promise.all([a.transport.close(),b.transport.close()]);}
});
it('revokes ordinary frames on actual control invalidation, including synchronous guard reentry',async()=>{
 const f=fixture();let revoke=false;try{const frame=await read(f.transport,audience,undefined,()=>{if(revoke)f.transport.invalidate();});revoke=true;expect(()=>current(f.transport,frame)).toThrow();}finally{await f.transport.close();}
});
it('joins the actual source reader cancellation tail before acknowledging close',async()=>{
 let release!:()=>void,cancels=0;const tail=new Promise<void>(resolve=>{release=resolve;}),stream=new ReadableStream<Uint8Array>({cancel(){cancels++;return tail;}}),f=fixture(()=>new Response(stream,{headers:echoes}));
 const result=read(f.transport).catch(error=>error);await vi.waitFor(()=>expect(stream.locked).toBe(true));let closed=false;const closing=f.transport.close().then(()=>{closed=true;});try{await vi.waitFor(()=>expect(cancels).toBe(1));expect(closed).toBe(false);}finally{release();await closing;}expect(await result).toBeInstanceOf(Error);
});
it('keeps ordinary frames current while missing boot echo revokes the old nested scoped qualification',async()=>{
 let echo=true;const f=fixture(id=>Response.json(envelope(id),{headers:echo?echoes:{'x-kswarm-activity-profile':'project_delivery_v1'}}));
 try{const first=await read(f.transport);echo=false;const second=await read(f.transport);current(f.transport,first);current(f.transport,second);expect(second.scoped).toBeUndefined();expect(()=>f.transport.assertScopedProjectRead(audience,first.scoped)).toThrow();}finally{await f.transport.close();}
});
it('retains the actual late headers IO rejection in close after the source owner is sealed',async()=>{
 let reject!: (error:unknown)=>void,entered=false;const raw=Error('source_headers_actual_io'),headers=new Promise<Response>((_resolve,no)=>{reject=no;});
 const transport=new ActivityProjectHttpTransport({ownerEpoch:'owner',kswarm:{url:'http://127.0.0.1:1234',mutationToken:'private',brokerUrl:'http://127.0.0.1:5678',roomToken:'room'},fetch:(async(url:string)=>{if(url.endsWith('/health'))return Response.json({ok:true,service:{instanceId:instance}});entered=true;return headers;}) as typeof fetch});
 const pending=read(transport).catch(error=>error);await vi.waitFor(()=>expect(entered).toBe(true));let closed=false;const closing=transport.close().then(()=>{closed=true;return undefined;},error=>{closed=true;return error;});await Promise.resolve();expect(closed).toBe(false);reject(raw);
 const includes=(error:unknown):boolean=>error===raw||error instanceof AggregateError&&error.errors.some(includes);
 expect(includes(await pending)).toBe(true);expect(includes(await closing)).toBe(true);
});

it('publishes a synchronous negative control when known scoped qualification is revoked by missing echo',async()=>{
 let missing=false;const negative=vi.fn(),f=fixture(id=>Response.json(envelope(id),{headers:missing?{'x-kswarm-activity-profile':'project_delivery_v1'}:echoes}),true,negative);
 try{const first=await read(f.transport);f.transport.assertScopedProjectRead(audience,first.scoped);missing=true;await read(f.transport);expect(negative).toHaveBeenCalledTimes(1);expect(()=>f.transport.assertScopedProjectRead(audience,first.scoped)).toThrow();}finally{await f.transport.close();}
});
