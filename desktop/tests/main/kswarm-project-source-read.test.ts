// @vitest-environment node
import {afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance,type KSwarmService} from '../../electron/kswarm-service.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},instance='11111111-1111-4111-8111-111111111111',subject={projectId:'p',sourceDataEpoch:instance,after:0};
const page=(id='p')=>({ok:true,sourceDataEpoch:instance,retainedFromSeq:1,headSeq:0,gap:false,gapRanges:[],coveredThrough:0,nextCursor:0,snapshotRevision:'0',snapshot:{id,name:'P',status:'active',projectRevision:1,primaryRoomId:null,deliveredAt:null,preparation:null,mapping:null,tasks:[]},events:[]});
const wire=(id='p')=>({ok:true,protocol:'scoped_project_activity_v1',projectId:id,scope:{...scope},bindingDigest:'c'.repeat(64),page:page(id)});
const echoes={'x-kswarm-source-instance':instance,'x-kswarm-activity-profile':'project_delivery_v1'},closes:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of closes.splice(0).reverse())await close();vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function fixture(reply:(id:string)=>Response=id=>Response.json(wire(id),{headers:echoes}),boot=true){
 const root=mkdtempSync(join(tmpdir(),'main-source-activity-')),entry=join(root,'server.js');writeFileSync(entry,'// adoption fixture');vi.stubEnv('XIAOK_CONFIG_DIR',root);vi.stubEnv('KSWARM_SERVER_PATH',entry);const calls:Array<{url:string;init?:RequestInit}>=[];let healthInstance:string|undefined=boot?instance:undefined;
 vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(String(input));if(url.pathname==='/health')return Response.json({ok:true,features:['dynamic_workflows'],service:{entryPath:entry,...(healthInstance?{instanceId:healthInstance}:{})}});if(/^\/projects\/[^/]+\/activity$/.test(url.pathname)){calls.push({url:String(input),init});return reply(url.pathname.includes('/q/')?'q':'p');}return Response.json({ok:true,agents:[]});}));
 const service=createKSwarmService({desktopProjectScope:scope,spawnProcess:(()=>{throw Error('No execution process');}) as never,findPortOwner:async()=>null});closes.push(async()=>{await sealAndDrainKSwarmServiceInstance(service).catch(()=>{});rmSync(root,{recursive:true,force:true});});await service.start();return{service,calls,setHealthInstance:(value:string|undefined)=>{healthInstance=value;}};
}
const read=(service:KSwarmService,input=subject,context:unknown={requestSource:'scheduler',signal:new AbortController().signal}):Promise<any>=>{const fn=Reflect.get(service,'readProjectSourceActivity');expect(fn).toBeTypeOf('function');return Reflect.apply(fn,service,[input,context]);};
const current=(service:KSwarmService,frame:unknown,input=subject)=>{const fn=Reflect.get(service,'assertProjectSourceActivityRead');expect(fn).toBeTypeOf('function');return Reflect.apply(fn,service,[input,frame]);};
it('issues ordinary provenance plus a separate actual scoped receipt using one activity GET',async()=>{
 const f=await fixture(),frame=await read(f.service);expect(frame.kind).toBe('kswarm_project_source_activity_read_v1');expect(frame.page.delivery.status).toBe('unavailable');expect(frame.scoped).toBeDefined();current(f.service,frame);f.service.assertScopedProjectActivityRead!(subject,frame.scoped);expect(f.calls).toHaveLength(1);const headers=new Headers(f.calls[0]!.init?.headers);expect(headers.get('x-kswarm-activity-profile')).toBe(null);expect(headers.get('x-kswarm-source-read')).toBe('project_source_v1');
});
it('accepts a legacy plain response as ordinary-only without a second activity GET',async()=>{
 const f=await fixture(id=>Response.json(page(id),{headers:{'x-kswarm-source-instance':instance}})),frame=await read(f.service);expect(frame.scoped).toBeUndefined();current(f.service,frame);expect(frame.page.delivery.status).toBe('unavailable');expect(f.calls).toHaveLength(1);expect(()=>f.service.assertScopedProjectActivityRead!(subject,frame)).toThrow();
});
it.each(['health','echo'])('keeps both ordinary source frames current when %s lacks boot support',async missing=>{
 const f=await fixture(id=>Response.json(page(id),{headers:missing==='echo'?{}:{'x-kswarm-source-instance':instance}}),missing!=='health'),q={...subject,projectId:'q'};
 const [p,other]=await Promise.all([read(f.service),read(f.service,q)]);current(f.service,p);current(f.service,other,q);expect(p.scoped).toBeUndefined();expect(other.scoped).toBeUndefined();expect(f.calls).toHaveLength(2);
});
it('keeps a correctly scoped response ordinary-only when health supplies no boot identity',async()=>{
 const f=await fixture(undefined,false),frame=await read(f.service);current(f.service,frame);expect(frame.scoped).toBeUndefined();expect(frame.page.delivery.status).toBe('unavailable');
});
it.each([401,403,503])('does not fall back after source HTTP %s',async status=>{
 const f=await fixture(()=>Response.json({ok:false},{status}));await expect(read(f.service)).rejects.toThrow('kswarm_activity_read_http_'+status);expect(f.calls).toHaveLength(1);
});
it.each(['profile','scope'])('rejects a nonempty foreign %s',async kind=>{
 const f=await fixture(id=>{const body=wire(id);if(kind==='scope')body.scope.workspaceId='d'.repeat(64);return Response.json(body,{headers:{...echoes,'x-kswarm-activity-profile':kind==='profile'?'future':'project_delivery_v1'}});});await expect(read(f.service)).rejects.toThrow();expect(f.calls).toHaveLength(1);
});
it('rejects clone, foreign Main issuer and ordinary frames used as scoped metadata',async()=>{
 const a=await fixture(),frame=await read(a.service),b=await fixture();expect(()=>current(a.service,structuredClone(frame))).toThrow();expect(()=>current(b.service,frame)).toThrow();expect(()=>a.service.assertScopedProjectActivityRead!(subject,frame)).toThrow();
});
it('keeps ordinary provenance but revokes nested scoped metadata after a missing boot echo',async()=>{
 let echo=true;const f=await fixture(id=>Response.json(wire(id),{headers:echo?echoes:{'x-kswarm-activity-profile':'project_delivery_v1'}})),first=await read(f.service);echo=false;const next=await read(f.service);current(f.service,first);current(f.service,next);expect(next.scoped).toBeUndefined();expect(()=>f.service.assertScopedProjectActivityRead!(subject,first.scoped)).toThrow();
});
it('revokes prior ordinary frames when a known foreign B boot arrives',async()=>{
 let foreign=false;const f=await fixture(id=>Response.json(wire(id),{headers:{...echoes,'x-kswarm-source-instance':foreign?'22222222-2222-4222-8222-222222222222':instance}})),first=await read(f.service);foreign=true;await expect(read(f.service)).rejects.toThrow(/instance/);expect(()=>current(f.service,first)).toThrow();
});
it('joins the source body actual cancellation tail before Main drain completes',async()=>{
 let release!:()=>void,cancels=0;const tail=new Promise<void>(resolve=>{release=resolve;}),stream=new ReadableStream<Uint8Array>({cancel(){cancels++;return tail;}}),f=await fixture(()=>new Response(stream,{headers:echoes}));
 const pending=read(f.service).catch(error=>error);await vi.waitFor(()=>expect(stream.locked).toBe(true));let drained=false;const closing=sealAndDrainKSwarmServiceInstance(f.service).then(()=>{drained=true;return undefined;},error=>{drained=true;return error;});
 try{await vi.waitFor(()=>expect(cancels).toBe(1));expect(drained).toBe(false);}finally{release();}
 const primary=await pending,error=await closing,contains=(value:unknown):boolean=>value===primary||value instanceof AggregateError&&value.errors.some(contains)||value instanceof Error&&value.cause!==undefined&&contains(value.cause);
 expect(primary).toBeInstanceOf(Error);expect(error).toBeInstanceOf(AggregateError);expect(contains(error)).toBe(true);
});
it('retains ordinary control across missing health and cancels a held body on the subsequent known B boot change',async()=>{
 let hold=false,release!:()=>void,cancels=0;const tail=new Promise<void>(resolve=>{release=resolve;}),stream=new ReadableStream<Uint8Array>({cancel(){cancels++;return tail;}}),f=await fixture(id=>hold?new Response(stream,{headers:echoes}):Response.json(wire(id),{headers:echoes}));
 const first=await read(f.service);f.setHealthInstance(undefined);await f.service.getServiceStatus();current(f.service,first);expect(()=>f.service.assertScopedProjectActivityRead!(subject,first.scoped)).toThrow();
 hold=true;const pending=read(f.service).catch(error=>error);await vi.waitFor(()=>expect(stream.locked).toBe(true));let settled=false;void pending.then(()=>{settled=true;});
 f.setHealthInstance('22222222-2222-4222-8222-222222222222');await f.service.getServiceStatus();try{await vi.waitFor(()=>expect(cancels).toBe(1));expect(settled).toBe(false);expect(()=>current(f.service,first)).toThrow();}finally{release();}expect(await pending).toBeInstanceOf(Error);
});
it('rechecks the original Source signal after its final synchronous guard returns',async()=>{
 const f=await fixture(),abort=new AbortController();let revoke=false;const frame=await read(f.service,subject,{requestSource:'scheduler',signal:abort.signal,beforeEffects:()=>{if(revoke)abort.abort(Error('actual_source_revoked'));}});revoke=true;expect(()=>current(f.service,frame)).toThrow();
});
