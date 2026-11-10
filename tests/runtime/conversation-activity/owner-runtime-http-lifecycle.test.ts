import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({hostOptions:null as any,sourceOptions:null as any,actualSources:null as any,actualSourceInstance:null as any,sockets:[] as any[],calls:[] as string[],store:{listWatches:()=>[]} as any,service:{close:vi.fn(async()=>{})} as any}));
vi.mock('../../../src/runtime/conversation-activity/storage-permissions.js',async original=>({...await original<object>(),createPrivateActivityDirectory:()=>{}}));
vi.mock('../../../src/runtime/conversation-activity/native-identity.js',()=>({ActivityNativeIdentityRepository:class{getThread=()=>null;authorizeProducer=()=>false;close=()=>{state.calls.push('identity.close');};}}));
vi.mock('../../../src/runtime/conversation-activity/owner-sources.js',()=>({ActivityTaskSnapshotReader:class{host=()=>({});snapshot=async()=>null;close=()=>{state.calls.push('tasks.close');};},ActivityNativeGroupReader:class{}}));
vi.mock('../../../src/runtime/conversation-activity/owner-host.js',()=>({ConversationActivityOwnerHost:class{ownerEpoch='owner';store=state.store;service=state.service;constructor(options:any){state.hostOptions=options;}start=async()=>{};invalidateProjectReads=()=>{state.calls.push('project.invalidate');};sealAndDrain=async()=>{state.calls.push('host.seal');};stop=async()=>{state.calls.push('host.stop');};}}));
vi.mock('../../../src/runtime/conversation-activity/sources.js',()=>({ConversationActivitySources:class{constructor(options:any){state.sourceOptions=options;if(state.actualSources){state.actualSourceInstance=new state.actualSources(options);return state.actualSourceInstance;}}startWatch=async()=>{};refreshProject=async(id:string)=>{state.calls.push('refresh:'+id);};projectConnectionChanged=async(status:string)=>{state.calls.push('connection:'+status);};close=async()=>{state.calls.push('sources.close');};}}));
vi.mock('../../../src/runtime/conversation-activity/owner-mcp.js',()=>({ActivityOwnerMcp:class{restore=async()=>{};close=async()=>{state.calls.push('mcp.close');};}}));
vi.mock('../../../src/runtime/conversation-activity/source-supervisor.js',()=>({revokeSupervisedKSwarmConfigTarget:()=>{state.calls.push('source.config.revoke');},ActivitySourceSupervisor:class{ensure=async()=>{state.calls.push('source.ensure');return{ok:true};};stopOwned=async()=>{state.calls.push('source.stop');};}}));
vi.mock('ws',()=>({WebSocket:class extends EventEmitter{readyState=1;constructor(){super();state.sockets.push(this);}close(){state.calls.push('socket.close:'+state.sockets.indexOf(this));}}}));
import {startConversationActivityOwner} from '../../../src/runtime/conversation-activity/owner-runtime.js';
const config={schemaVersion:1 as const,dataRoot:'/private-test',profileId:'a'.repeat(64),actorId:'user',identity:{kind:'cli' as const,path:'/identity'},managedSources:[{name:'kswarm'} as any],kswarm:{url:'http://127.0.0.1:1234',mutationToken:'token',brokerUrl:'http://127.0.0.1:5678',roomToken:'room'}};
const instance='11111111-1111-4111-8111-111111111111';
const response=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'x-kswarm-source-instance':instance}});
const page={ok:true,sourceDataEpoch:instance,retainedFromSeq:1,headSeq:0,gap:false,gapRanges:[],coveredThrough:0,nextCursor:0,snapshotRevision:'0',snapshot:{id:'p',name:'Project',status:'active',projectRevision:0,primaryRoomId:null,deliveredAt:null,preparation:null,mapping:null,tasks:[]},events:[]};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();state.sockets.length=0;state.calls.length=0;state.service.close.mockClear();});
describe('original daemon HTTP and websocket lifetime integration',()=>{
 it.each(['header','health'])('keeps two parallel legacy projects fresh through actual Sources/service/SQLite when %s support is missing',async missing=>{
  const{ConversationActivitySources}=await vi.importActual<typeof import('../../../src/runtime/conversation-activity/sources.js')>('../../../src/runtime/conversation-activity/sources.js');
  const{ConversationActivityStore}=await import('../../../src/runtime/conversation-activity/store.js');const{ConversationActivityService}=await import('../../../src/runtime/conversation-activity/service.js');
  let service:InstanceType<typeof ConversationActivityService>;const root=mkdtempSync(join(tmpdir(),'legacy-project-runtime-')),store=new ConversationActivityStore(join(root,'activity.sqlite'),{projectOrdinarySource:frame=>service.resolveProjectOrdinarySource(frame),projectDeliverySource:frame=>service.resolveProjectDeliverySource(frame)});
  store.prepareAssociation({operationId:'op',creationIdempotencyKey:'op',origin:{profileId:'a'.repeat(64),workspaceId:'b'.repeat(64),threadId:'thread',actorId:'user'}});
  store.bindWork({operationId:'op',watchId:'watch',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:instance,workId:'p'});
  store.prepareAssociation({operationId:'op-q',creationIdempotencyKey:'op-q',origin:{profileId:'a'.repeat(64),workspaceId:'b'.repeat(64),threadId:'thread',actorId:'user'}});
  store.bindWork({operationId:'op-q',watchId:'watch-q',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:instance,workId:'q'});
  service=new ConversationActivityService({store,projectSource:{assertOwner:owner=>state.hostOptions.projectSource.assertOwner(owner),read:(...args)=>state.hostOptions.projectSource.read(...args),assertRead:(...args)=>state.hostOptions.projectSource.assertRead(...args),assertScoped:(...args)=>state.hostOptions.projectSource.assertScoped(...args),ensureRound:id=>state.hostOptions.projectSource.ensureRound(id)},profileId:'a'.repeat(64),actorId:'user',getThread:()=>({profileId:'a'.repeat(64),workspaceId:'b'.repeat(64),threadId:'thread',deleteState:'none'}),canObserveWork:()=>true});
  const oldStore=state.store,oldService=state.service;state.store=store;state.service=service;state.actualSources=ConversationActivitySources;
  const feed={...page,headSeq:1,nextCursor:1,coveredThrough:1,snapshotRevision:'1',events:[{schemaVersion:1,eventId:'p#1',source:'kswarm',workId:'p',sourceSequence:1,sourceDataEpoch:instance,sourceRevision:'1',kind:'accepted',occurredAt:1,sourceType:'project.created',evidenceRefs:[]}]};
  vi.stubGlobal('fetch',vi.fn((address:string)=>{
   const url=new URL(address);if(url.pathname==='/health')return Promise.resolve(response({ok:true,service:missing==='health'?{}:{instanceId:instance}}));
   const projectId=url.pathname.includes('/projects/q/')?'q':'p',after=Number(url.searchParams.get('after')??0);
   const value={...feed,snapshot:{...feed.snapshot,id:projectId},events:after>=1?[]:feed.events.map(event=>({...event,workId:projectId,eventId:projectId+'#1'}))};
   return Promise.resolve(Response.json(value,{headers:missing==='header'?{}:{'x-kswarm-source-instance':instance}}));
  }));
  let runtime:Awaited<ReturnType<typeof startConversationActivityOwner>>|undefined;
  try{runtime=await startConversationActivityOwner(config);await Promise.all([state.actualSourceInstance.refreshProject('p',true),state.actualSourceInstance.refreshProject('q',true)]);for(const watchId of ['watch','watch-q'])expect(store.getProjection(watchId)).toMatchObject({sourceSequence:1,freshness:'fresh',executionState:'accepted'});}
  finally{await runtime?.stop();await service.close();store.close();state.store=oldStore;state.service=oldService;state.actualSources=null;state.actualSourceInstance=null;rmSync(root,{recursive:true,force:true});}
 });
 it('keeps an original legacy activity page available while withholding its new delivery qualification',async()=>{
  vi.stubGlobal('fetch',vi.fn((url:string)=>Promise.resolve(Response.json(url.endsWith('/health')?{ok:true,service:{}}:page))));
  const runtime=await startConversationActivityOwner(config);
  try{const result=await state.hostOptions.projectSource.read({projectId:'p',after:0,sourceDataEpoch:instance,profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},new AbortController().signal,()=>{});expect(result.page.snapshot.id).toBe('p');expect(result.page.delivery.status).toBe('unavailable');}
  finally{await runtime.stop();}
 });
 it('does not close service or readers while its original HTTP request still owns late headers or cancellation',async()=>{
  let headers!:(response:Response)=>void,cancel!:(value:void)=>void,cancels=0;
  vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('/health')?Promise.resolve(response({ok:true,service:{instanceId:instance}})):new Promise<Response>(resolve=>{headers=resolve;})));
  const runtime=await startConversationActivityOwner(config);const read=state.hostOptions.projectSource.read({projectId:'p',after:0,sourceDataEpoch:instance,profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},new AbortController().signal,()=>{});const result=read.catch((error:unknown)=>error);
  await vi.waitFor(()=>expect(headers).toBeTypeOf('function'));let stopped=false;const stop=runtime.stop().then(()=>{stopped=true;});
  await Promise.resolve();expect(state.service.close).not.toHaveBeenCalled();expect(stopped).toBe(false);
  headers({ok:true,body:{cancel(){cancels++;return new Promise<void>(resolve=>{cancel=resolve;});}}} as unknown as Response);
  await vi.waitFor(()=>expect(cancels).toBe(1));expect(state.service.close).not.toHaveBeenCalled();cancel();await stop;
  expect(await result).toBeInstanceOf(Error);expect(state.service.close).toHaveBeenCalledTimes(1);expect(state.calls).toContain('host.stop');
 });
 it('rejects a held page after source control begins even when the supervisor returns a successful receipt',async()=>{
  let headers!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('/health')?Promise.resolve(response({ok:true,service:{instanceId:instance}})):new Promise<Response>(resolve=>{headers=resolve;})));
  const runtime=await startConversationActivityOwner(config);const read=state.hostOptions.projectSource.read({projectId:'p',after:0,sourceDataEpoch:instance,profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},new AbortController().signal,()=>{});const result=read.catch((error:unknown)=>error);
  await vi.waitFor(()=>expect(headers).toBeTypeOf('function'));await state.hostOptions.sourceControl('sourceRestart',{name:'kswarm',ownerEpoch:'owner'});expect(state.calls.indexOf('source.config.revoke')).toBeGreaterThanOrEqual(0);expect(state.calls.indexOf('source.config.revoke')).toBeLessThan(state.calls.indexOf('connection:reconnecting'));expect(state.calls.indexOf('source.config.revoke')).toBeLessThan(state.calls.indexOf('source.stop'));headers(response(page));
  expect(await result).toBeInstanceOf(Error);await runtime.stop();
 });
 it('ignores every stale socket callback and closes only the socket which emitted an error',async()=>{
  vi.useFakeTimers();const runtime=await startConversationActivityOwner(config),old=state.sockets[0];old.emit('close');await vi.advanceTimersByTimeAsync(1000);
  expect(state.sockets).toHaveLength(2);const current=state.sockets[1];current.emit('open');await Promise.resolve();state.calls.length=0;
  old.emit('message',Buffer.from(JSON.stringify({type:'project_activity',projectId:'foreign-old'})));old.emit('close');old.emit('open');old.emit('error',Error('old socket'));
  await Promise.resolve();expect(state.calls).not.toContain('refresh:foreign-old');expect(state.calls).not.toContain('connection:disconnected');expect(state.calls).not.toContain('connection:connected');expect(state.calls).not.toContain('socket.close:1');
  current.emit('message',Buffer.from(JSON.stringify({type:'project_activity',projectId:'p'})));await Promise.resolve();expect(state.calls).toContain('refresh:p');await runtime.stop();
 });
});
