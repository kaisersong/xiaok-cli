// @vitest-environment node
import {afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance,type KSwarmService} from '../../electron/kswarm-service.js';
const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},instance='11111111-1111-4111-8111-111111111111',subject={projectId:'p',sourceDataEpoch:instance,after:0};
const page=()=>({ok:true,sourceDataEpoch:instance,retainedFromSeq:1,headSeq:0,gap:false,gapRanges:[],coveredThrough:0,nextCursor:0,snapshotRevision:'0',snapshot:{id:'p',name:'P',status:'active',projectRevision:1,primaryRoomId:null,deliveredAt:null,preparation:null,mapping:null,tasks:[]},events:[]});
const wire=()=>({ok:true,protocol:'scoped_project_activity_v1',projectId:'p',scope:{...scope},bindingDigest:'c'.repeat(64),page:page()});
const headers={'x-kswarm-source-instance':instance,'x-kswarm-activity-profile':'project_delivery_v1'};
const closes:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of closes.splice(0).reverse())await close();vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function fixture(transport:()=>Response=()=>Response.json(wire(),{headers})){
 const root=mkdtempSync(join(tmpdir(),'main-scoped-activity-')),entry=join(root,'server.js');writeFileSync(entry,'// adoption fixture');vi.stubEnv('XIAOK_CONFIG_DIR',root);vi.stubEnv('KSWARM_SERVER_PATH',entry);
 const calls:Array<{url:string;init?:RequestInit}>=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(String(input));if(url.pathname==='/health')return Response.json({ok:true,features:['dynamic_workflows'],service:{entryPath:entry,instanceId:instance}});if(url.pathname==='/projects/p/activity'){calls.push({url:String(input),init});return transport();}return Response.json({ok:true,agents:[]});}));
 const service=createKSwarmService({desktopProjectScope:scope,spawnProcess:(()=>{throw Error('No execution process');}) as never,findPortOwner:async()=>null});
 closes.push(async()=>{await sealAndDrainKSwarmServiceInstance(service).catch(()=>{});rmSync(root,{recursive:true,force:true});});await service.start();return{service,calls};
}
function read(service:KSwarmService,context:unknown={requestSource:'scheduler',signal:new AbortController().signal}){
 const fn=Reflect.get(service,'readScopedProjectActivity');expect(fn).toBeTypeOf('function');return Reflect.apply(fn,service,[subject,context]) as Promise<any>;
}
function current(service:KSwarmService,frame:unknown){const fn=Reflect.get(service,'assertScopedProjectActivityRead');expect(fn).toBeTypeOf('function');return Reflect.apply(fn,service,[subject,frame]);}
it('issues a distinct immutable scoped frame only from the fixed launch domain and negotiated actual response',async()=>{
 const f=await fixture(),frame=await read(f.service);expect(frame).toMatchObject({kind:'kswarm_scoped_project_activity_read_v1',protocol:'scoped_project_activity_v1',projectId:'p',scope,bindingDigest:'c'.repeat(64),subject});expect(Object.isFrozen(frame.scope)).toBe(true);expect(()=>current(f.service,frame)).not.toThrow();expect(()=>current(f.service,structuredClone(frame))).toThrow();
 const request=f.calls[0]!.init!;expect(new Headers(request.headers).get('x-kswarm-activity-profile')).toBe('project_delivery_v1');expect(request.method).toBe('GET');expect(request.redirect).toBe('error');
});
it('never upgrades a valid old metadata frame or a third caller argument into the scoped private reader',async()=>{
 const f=await fixture(()=>Response.json(page(),{headers})),ordinary=await Reflect.apply(f.service.readProjectActivity!,f.service,[subject,{requestSource:'scheduler',signal:new AbortController().signal},true]);
 expect(ordinary.kind).toBe('kswarm_project_activity_read_v1');expect(new Headers(f.calls[0]!.init!.headers).get('x-kswarm-activity-profile')).toBe(null);expect(()=>current(f.service,ordinary)).toThrow();
});
it.each(['profile','workspace','project','protocol','binding'])('refuses a foreign or damaged %s source body',async kind=>{
 const raw=wire();if(kind==='profile')raw.scope.profileId='d'.repeat(64);if(kind==='workspace')raw.scope.workspaceId='d'.repeat(64);if(kind==='project')raw.projectId='q';if(kind==='protocol')raw.protocol='scoped_project_activity_v999';if(kind==='binding')raw.bindingDigest='bad';
 const f=await fixture(()=>Response.json(raw,{headers}));await expect(read(f.service)).rejects.toThrow();
});
it.each(['missing','future'])('refuses %s profile negotiation without minting a scoped frame',async kind=>{
 const responseHeaders={'x-kswarm-source-instance':instance,...(kind==='future'?{'x-kswarm-activity-profile':'future'}:{})},f=await fixture(()=>Response.json(wire(),{headers:responseHeaders}));await expect(read(f.service)).rejects.toThrow(/profile/);
});
it('does not accept an agent context even when its body requests the scoped protocol',async()=>{
 const f=await fixture();await expect(read(f.service,{requestSource:'agent',signal:new AbortController().signal,protocol:'scoped_project_activity_v1'})).rejects.toThrow(/forbidden/);expect(f.calls).toHaveLength(0);
});
it.each([403,409,503])('a scoped HTTP %s without success echoes preserves a legitimate old metadata frame and its source pin',async status=>{
 let denied=false;const f=await fixture(()=>denied?Response.json({ok:false,error:'PROJECT_SCOPE_MISMATCH'},{status}):Response.json(page(),{headers}));
 const ordinary=await f.service.readProjectActivity!(subject,{requestSource:'scheduler',signal:new AbortController().signal});denied=true;
 await expect(read(f.service)).rejects.toThrow('kswarm_activity_read_http_'+status);expect(()=>f.service.assertProjectActivityRead!(subject,ordinary)).not.toThrow();
});
it('rechecks the same issuer after the actual fixed synchronous final guard seals the service',async()=>{
 const f=await fixture();let seal=false,closing:Promise<void>|undefined;
 const frame=await read(f.service,{requestSource:'scheduler',signal:new AbortController().signal,beforeEffects:()=>{if(seal){seal=false;closing=sealAndDrainKSwarmServiceInstance(f.service);void closing.catch(()=>{});}}});
 try{seal=true;expect(()=>current(f.service,frame)).toThrow();}finally{await closing?.catch(()=>{});}
});
