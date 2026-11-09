import {it,expect,vi} from 'vitest';
import {ActivityProjectHttpTransport} from '../../../src/runtime/conversation-activity/project-http-transport.js';
const instance='11111111-1111-4111-8111-111111111111',scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},subject={projectId:'p',sourceDataEpoch:instance,after:0},audience={...subject,...scope};
const page=(id='p')=>({ok:true,sourceDataEpoch:instance,retainedFromSeq:1,headSeq:0,gap:false,gapRanges:[],coveredThrough:0,nextCursor:0,snapshotRevision:'0',snapshot:{id,name:'P',status:'active',projectRevision:1,primaryRoomId:null,deliveredAt:null,preparation:null,mapping:null,tasks:[]},events:[]});
const body=()=>({ok:true,protocol:'scoped_project_activity_v1',projectId:'p',scope:{...scope},bindingDigest:'c'.repeat(64),page:page()});
const headers={'x-kswarm-source-instance':instance,'x-kswarm-activity-profile':'project_delivery_v1'};
function fixture(reply:()=>Response=()=>Response.json(body(),{headers})){
 const fetch=vi.fn(async(url:string,init?:RequestInit)=>url.endsWith('/health')?Response.json({ok:true,service:{instanceId:instance}}):new Headers(init?.headers).has('x-kswarm-activity-profile')?reply():Response.json(page(url.includes('/projects/q/')?'q':'p'),{headers}));
 const transport=new ActivityProjectHttpTransport({ownerEpoch:'owner',kswarm:{url:'http://127.0.0.1:1234',mutationToken:'private',brokerUrl:'http://127.0.0.1:5678',roomToken:'room'},fetch});return{transport,fetch};
}
const read=(transport:ActivityProjectHttpTransport,input:unknown=audience,beforeEffects?:()=>void)=>{
 const fn=Reflect.get(transport,'readScopedProject');expect(fn).toBeTypeOf('function');return Reflect.apply(fn,transport,[input,undefined,beforeEffects]) as Promise<any>;
};
const current=(transport:ActivityProjectHttpTransport,frame:unknown,input:unknown=audience)=>{const fn=Reflect.get(transport,'assertScopedProjectRead');expect(fn).toBeTypeOf('function');return Reflect.apply(fn,transport,[input,frame]);};
it('reads one negotiated scoped page and retains the exact parsed binding in a private immutable frame',async()=>{
 const{transport,fetch}=fixture();try{const frame=await read(transport);expect(frame).toMatchObject({kind:'activity_scoped_project_http_read_v1',protocol:'scoped_project_activity_v1',projectId:'p',scope,bindingDigest:'c'.repeat(64),subject});expect(Object.isFrozen(frame.scope)).toBe(true);current(transport,frame);expect(()=>current(transport,structuredClone(frame))).toThrow();expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('x-kswarm-activity-profile')).toBe('project_delivery_v1');}
 finally{await transport.close();}
});
it('does not upgrade an old metadata frame or accept another original transport owner',async()=>{
 const a=fixture(),b=fixture();try{const old=await a.transport.readProject(subject);expect(()=>current(a.transport,old)).toThrow();const frame=await read(a.transport);expect(()=>current(b.transport,frame)).toThrow();}
 finally{await Promise.all([a.transport.close(),b.transport.close()]);}
});
it.each([403,409,503])('keeps old metadata current when the scoped endpoint refuses with HTTP %s',async status=>{
 const{transport}=fixture(()=>Response.json({ok:false,error:'PROJECT_SCOPE_MISMATCH'},{status}));try{const old=await transport.readProject(subject);await expect(read(transport)).rejects.toThrow('activity_source_http_'+status);transport.assertProjectRead(subject,old);}finally{await transport.close();}
});
it.each(['missing','future','scope','protocol'])('a %s scoped capability cannot cancel a legal sibling legacy request or revoke its old metadata',async kind=>{
 const{transport}=fixture(()=>{const raw=body();if(kind==='scope')raw.scope.workspaceId='d'.repeat(64);if(kind==='protocol')raw.protocol='scoped_project_activity_v999';return Response.json(raw,{headers:{'x-kswarm-source-instance':instance,...(kind==='missing'?{}:{'x-kswarm-activity-profile':kind==='future'?'future':'project_delivery_v1'})}});});
 try{const old=await transport.readProject(subject),results=await Promise.allSettled([read(transport),transport.readCompatibleProject({...subject,projectId:'q'})]);expect(results[0]!.status).toBe('rejected');expect(results[1]!.status).toBe('fulfilled');transport.assertProjectRead(subject,old);}finally{await transport.close();}
});
it('refuses audience accessors and changed scope without invoking a getter',async()=>{
 const{transport}=fixture();let calls=0;try{const frame=await read(transport),input={...audience};Object.defineProperty(input,'profileId',{enumerable:true,get(){calls++;return scope.profileId;}});await expect(read(transport,input)).rejects.toThrow();expect(()=>current(transport,frame,input)).toThrow();expect(()=>current(transport,frame,{...audience,workspaceId:'d'.repeat(64)})).toThrow();expect(calls).toBe(0);}finally{await transport.close();}
});
it('rechecks generation after the actual synchronous final guard returns',async()=>{
 const{transport}=fixture();let revoke=false;try{const frame=await read(transport,audience,()=>{if(revoke)transport.invalidate();});revoke=true;expect(()=>current(transport,frame)).toThrow();}finally{await transport.close();}
});
it('still revokes all original metadata on a nonempty foreign actual B issuer',async()=>{
 const{transport}=fixture(()=>Response.json(body(),{headers:{...headers,'x-kswarm-source-instance':'22222222-2222-4222-8222-222222222222'}}));
 try{const old=await transport.readProject(subject);await expect(read(transport)).rejects.toThrow(/instance/);expect(()=>transport.assertProjectRead(subject,old)).toThrow();}finally{await transport.close();}
});
it('owns a scoped held body through the actual cancel tail before closing',async()=>{
 let resolve!:()=>void,cancels=0;const tail=new Promise<void>(yes=>{resolve=yes;}),stream=new ReadableStream<Uint8Array>({cancel(){cancels++;return tail;}}),{transport}=fixture(()=>new Response(stream,{headers}));
 const pending=read(transport),result=pending.catch(error=>error);await vi.waitFor(()=>expect(stream.locked).toBe(true));let stopped=false;const closing=transport.close().then(()=>{stopped=true;});
 try{await vi.waitFor(()=>expect(cancels).toBe(1));expect(stopped).toBe(false);}finally{resolve();await closing;}
 expect(await result).toBeInstanceOf(Error);expect(cancels).toBe(1);
});
it('refuses nested scalar getters through both actual public scoped read and final assert',async()=>{
 const{transport}=fixture();let calls=0;try{const frame=await read(transport),input={...audience,profileId:{get then(){calls++;return undefined;}}};
  await expect(read(transport,input)).rejects.toThrow();expect(()=>current(transport,frame,input)).toThrow();expect(calls).toBe(0);
 }finally{await transport.close();}
});
