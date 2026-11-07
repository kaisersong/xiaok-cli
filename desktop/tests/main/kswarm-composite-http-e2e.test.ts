// @vitest-environment node
// Original Main store/service/Task source -> real original B server/SQLite.
// The actor role port and broker health are controlled; no Native/M qualification.
import {it,expect,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
import net from 'node:net';
import {spawn,type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createOriginalCompositeFixture} from '../support/original-composite-fixture.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
import {createInitialPlanOwnerClient} from '../../electron/kswarm-initial-plan-owner-client.js';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance,type KSwarmService} from '../../electron/kswarm-service.js';
import {ActivityProjectHttpTransport} from '../../../src/runtime/conversation-activity/project-http-transport.js';
async function freePort(){const server=net.createServer();await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(yes=>server.close(()=>yes()));return port;}
it.each(['original_journal','planning_action']as const)('a real socket ACK loss after original B commit is reconciled by %s without a second wire POST',async mode=>{
 resetIpcSchemaRegistryForTests();const closes:Array<()=>Promise<void>>=[],nativeFetch=globalThis.fetch;let service:KSwarmService|undefined,child:ChildProcess|undefined,exited:Promise<void>|undefined,proxy:Server|undefined;const forwarding=new Set<Promise<void>>();let posts=0,activityGets=0,lost=false,lastCommit:any;
 try{
  const f=await createOriginalCompositeFixture(closes,{databaseFileName:'state.sqlite',poAgent:'xiaok-po'}),entry=fileURLToPath(new URL('../../../../kswarm/src/server/index.js',import.meta.url)),ksRoot=fileURLToPath(new URL('../../../../kswarm',import.meta.url));
  await f.hub.createProject({id:'legacy',name:'Legacy Source',goal:'Keep ordinary compatibility',poAgent:'xiaok-po',autoAssignPo:false});f.hub.closePersistence();
  vi.stubEnv('XIAOK_CONFIG_DIR',f.root);vi.stubEnv('KSWARM_SERVER_PATH',entry);
  const serverPort=await freePort(),backend='http://127.0.0.1:'+serverPort;let proxyBase='';
  const spawnGuard=vi.fn(()=>{throw Error('Main must adopt only this test server');});
  vi.stubGlobal('fetch',async(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(String(input));if(url.port==='4318')return Response.json({ok:true,rooms:[]});if(url.port!=='4400')throw Error('unexpected service network audience');return nativeFetch(proxyBase+url.pathname+url.search,init);});
  service=createKSwarmService({desktopProjectScope:{profileId:f.payload.ownerBinding.profileId,workspaceId:f.payload.ownerBinding.workspaceId},spawnProcess:spawnGuard as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('must not kill an existing listener');}});
  child=spawn(process.execPath,[entry],{cwd:ksRoot,env:{...process.env,HOME:f.root,USERPROFILE:f.root,KSWARM_DATA_ROOT:f.root,KSWARM_PORT:String(serverPort),BROKER_URL:'http://127.0.0.1:1',KSWARM_DESKTOP_MUTATION_TOKEN:service.getDesktopMutationToken(),KSWARM_DESKTOP_PROFILE_ID:f.payload.ownerBinding.profileId,KSWARM_DESKTOP_WORKSPACE_ID:f.payload.ownerBinding.workspaceId},stdio:'ignore'});
  exited=new Promise<void>((yes,no)=>{child!.once('error',no);child!.once('exit',(code,signal)=>{console.log(JSON.stringify({test:'composite-real-http-own-B-child',pid:child!.pid,code,signal,reaped:true}));yes();});});
  const deadline=Date.now()+10000;for(;;){try{if((await nativeFetch(backend+'/health',{signal:AbortSignal.timeout(500)})).ok)break;}catch{}if(child.exitCode!==null||child.signalCode!==null||Date.now()>deadline)throw Error('isolated real B startup failed');await new Promise<void>(yes=>setTimeout(yes,25));}
  proxy=createServer((req,res)=>{const work=(async()=>{const chunks:Buffer[]=[];for await(const part of req)chunks.push(Buffer.from(part));const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined&&!['host','connection'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);const target=req.url??'/',isSubmission=req.method==='POST'&&target.endsWith('/task-metadata-inputs');if(isSubmission)posts++;if(req.method==='GET'&&/^\/projects\/[^/]+\/activity\?/.test(target))activityGets++;
    const response=await nativeFetch(backend+target,{method:req.method,headers,...(req.method==='GET'||req.method==='HEAD'?{}:{body:Buffer.concat(chunks)}),signal:AbortSignal.timeout(10000)}),bytes=Buffer.from(await response.arrayBuffer());
    if(isSubmission&&!lost){lastCommit=JSON.parse(bytes.toString());console.log(JSON.stringify({test:'composite-upstream-result',status:response.status,ok:lastCommit.ok,error:lastCommit.error}));expect(lastCommit.ok).toBe(true);lost=true;req.socket.destroy();return;}
    const issuer=response.headers.get('x-kswarm-source-instance'),profile=response.headers.get('x-kswarm-activity-profile');res.writeHead(response.status,{'content-type':'application/json',...(issuer?{'x-kswarm-source-instance':issuer}:{}),...(profile?{'x-kswarm-activity-profile':profile}:{})});res.end(bytes);
   })().catch(error=>{console.log(JSON.stringify({test:'composite-forwarding-error',message:error instanceof Error?error.message:String(error),cause:error instanceof Error&&error.cause instanceof Error?error.cause.message:undefined}));if(!res.destroyed){res.writeHead(500);res.end(JSON.stringify({error:'test_forwarding_failed'}));}throw error;});forwarding.add(work);void work.then(()=>forwarding.delete(work),()=>forwarding.delete(work));});
  await new Promise<void>(yes=>proxy!.listen(0,'127.0.0.1',yes));proxyBase='http://127.0.0.1:'+(proxy.address() as net.AddressInfo).port;
  await service.start();expect(service.getStatus().running).toBe(true);expect(spawnGuard).not.toHaveBeenCalled();
  f.gateway.request=(path:string,init?:RequestInit,beforeEffects?:()=>void)=>service!.request(path,init,beforeEffects);
  f.gateway.getDesktopMutationToken=()=>service!.getDesktopMutationToken();
  f.gateway.submitTaskMetadataOnce=(projectId:string,envelope:any,context:any)=>service!.submitTaskMetadataOnce!(projectId,envelope,context) as any;
  expect(f.store.list()).toEqual([]);const fresh=await createInitialPlanOwnerClient(f.gateway,f.payload.ownerBinding,new AbortController().signal).read();expect(fresh.state.poAgent).toBe(f.payload.poAgent);expect(fresh.unclaimedProof).toBeDefined();Object.assign(f.read,fresh);

  if(mode==='planning_action'){
    const {executeTaskMetadataPlanning}=await import('../../electron/kswarm-task-planning-action.js'),source=f.projects.inspectOriginalTaskSource(f.sourceProof),input={action:'add_task_and_plan',projectId:'p',sourceTaskId:source.sourceTaskId,proposal:{title:'Real HTTP user item'}};
    const action=(proof:any)=>executeTaskMetadataPlanning({store:f.store,gateway:f.gateway,projects:f.projects,scope:{profileId:f.payload.ownerBinding.profileId,workspaceId:f.payload.ownerBinding.workspaceId},now:()=>10,authorizeSource:async()=>()=>{}},input,{requestSource:'user',triggerProof:proof,current:()=>{}});
    const result=await f.withActionTrigger(input,action);expect(result.status).toBe('metadata_applied');expect(result.execution.state).toBe('blocked');expect(result.operationId).toBe(lastCommit.operation.operationId);expect(result.planRunId).toBe(f.store.list()[0].planRunId);expect(await f.withActionTrigger(input,action)).toEqual(result);expect(posts).toBe(1);expect(f.store.claimDue(100,1)).toEqual([]);
  }else await f.withTrigger(async triggerProof=>{const prepared=await f.prepare(triggerProof),result=await f.store.submitTaskComposite('p',{requestSource:'user',triggerProof},prepared.submission.input,new AbortController().signal);expect(result.outcome).toBe('metadata_applied');expect(Object.hasOwn(result,'transportError')).toBe(true);expect(result.transportError).toBeInstanceOf(Error);expect(posts).toBe(1);expect(lastCommit.operation.operationId).toBe(prepared.preparation.operationId);expect(lastCommit.operation.envelopeDigest).toBe(prepared.preparation.envelopeDigest);expect(f.store.list()[0].planRunId).toBe(prepared.job.planRunId);expect(f.store.claimDue(100,1)).toEqual([]);});
  const response=await service.request('/projects/p'),view=await response.json();expect(view.tasks).toHaveLength(1);expect(posts).toBe(1);expect(lost).toBe(true);console.log(JSON.stringify({test:'composite-real-http-one-wire-post',posts,realSocketDestroyedAfterBCommit:lost,taskCount:view.tasks.length}));
  const identityResponse=await service.request('/projects/p/activity-identity',{headers:{'x-kswarm-mutation-token':service.getDesktopMutationToken()}}),identity=await identityResponse.json();
  expect(identityResponse.ok).toBe(true);const activitySubject={projectId:'p',sourceDataEpoch:identity.sourceDataEpoch,after:0};
  if(!service.readProjectActivity||!service.assertProjectActivityRead)throw Error('Original activity read transport missing');
  const activityRead=await service.readProjectActivity(activitySubject,{requestSource:'scheduler',signal:new AbortController().signal});service.assertProjectActivityRead(activitySubject,activityRead);
  expect(activityRead.page.delivery.status).toBe('current');if(activityRead.page.delivery.status!=='current')throw Error('Original committed B delivery metadata unavailable');
  expect(activityRead.page.delivery.head.projectId).toBe('p');expect(activityRead.page.delivery.head.core.stage).toBe('none');expect(posts).toBe(1);
  console.log(JSON.stringify({test:'original-B-activity-real-HTTP-main-read',projectId:'p',deliveryStage:activityRead.page.delivery.head.core.stage,originalPosts:posts,coreWitnessIssued:false}));
  if(!service.readScopedProjectActivity||!service.assertScopedProjectActivityRead)throw Error('Original scoped Main read missing');
  const scopedRead=await service.readScopedProjectActivity(activitySubject,{requestSource:'scheduler',signal:new AbortController().signal});service.assertScopedProjectActivityRead(activitySubject,scopedRead);
  expect(scopedRead.scope).toEqual({profileId:f.payload.ownerBinding.profileId,workspaceId:f.payload.ownerBinding.workspaceId});expect(scopedRead.protocol).toBe('scoped_project_activity_v1');expect(scopedRead.projectId).toBe('p');expect(posts).toBe(1);
  console.log(JSON.stringify({test:'original-B-scoped-activity-real-HTTP-main-read',projectId:'p',scopeMatched:true,originalPosts:posts,coreWitnessIssued:false}));
  if(!service.readProjectSourceActivity||!service.assertProjectSourceActivityRead)throw Error('Original Source Main read missing');
  const beforeSourceGets=activityGets,sourceRead=await service.readProjectSourceActivity(activitySubject,{requestSource:'scheduler',signal:new AbortController().signal});service.assertProjectSourceActivityRead(activitySubject,sourceRead);
  expect(sourceRead.page.delivery.status).toBe('unavailable');expect(sourceRead.scoped).toBeDefined();service.assertScopedProjectActivityRead(activitySubject,sourceRead.scoped!);expect(activityGets-beforeSourceGets).toBe(1);
  console.log(JSON.stringify({test:'original-B-source-real-HTTP-main-read',ordinaryOnly:true,nestedScoped:true,actualActivityGets:activityGets-beforeSourceGets,coreWitnessIssued:false}));
  const legacyIdentity=await(await service.request('/projects/legacy/activity-identity',{headers:{'x-kswarm-mutation-token':service.getDesktopMutationToken()}})).json(),legacySubject={projectId:'legacy',sourceDataEpoch:legacyIdentity.sourceDataEpoch,after:0};
  const beforeLegacy=activityGets,legacyRead=await service.readProjectSourceActivity(legacySubject,{requestSource:'scheduler',signal:new AbortController().signal});service.assertProjectSourceActivityRead(legacySubject,legacyRead);expect(legacyRead.scoped).toBeUndefined();expect(legacyRead.page.delivery.status).toBe('unavailable');expect(activityGets-beforeLegacy).toBe(1);service.assertScopedProjectActivityRead(activitySubject,sourceRead.scoped!);
  console.log(JSON.stringify({test:'original-B-legacy-source-real-HTTP-main-read',ordinaryCurrent:true,nestedScoped:false,actualActivityGets:activityGets-beforeLegacy,otherProjectScopedStillCurrent:true,coreWitnessIssued:false}));
  let daemonActivityGets=0;const daemonRead=new ActivityProjectHttpTransport({ownerEpoch:'test-daemon',kswarm:{url:backend,mutationToken:service.getDesktopMutationToken(),brokerUrl:backend,roomToken:'unused'},fetch:(async(input:string|URL|Request,init?:RequestInit)=>{if(new URL(String(input)).pathname==='/projects/p/activity')daemonActivityGets++;return nativeFetch(input,init);}) as typeof fetch});
  try{
   const frame=await daemonRead.readProject(activitySubject);daemonRead.assertProjectRead(activitySubject,frame);expect(frame.page.delivery.status).toBe('current');expect(frame.page.snapshot.id).toBe('p');
   const audience={...activitySubject,profileId:f.payload.ownerBinding.profileId,workspaceId:f.payload.ownerBinding.workspaceId},scoped=await daemonRead.readScopedProject(audience);daemonRead.assertScopedProjectRead(audience,scoped);
   expect(scoped.protocol).toBe('scoped_project_activity_v1');expect(scoped.scope).toEqual(scopedRead.scope);expect(posts).toBe(1);
   console.log(JSON.stringify({test:'original-B-scoped-activity-real-HTTP-daemon-read',projectId:'p',scopeMatched:true,originalPosts:posts,coreWitnessIssued:false}));
   const before=daemonActivityGets,source=await daemonRead.readProjectSource(audience);daemonRead.assertProjectSourceRead(audience,source);expect(source.page.delivery.status).toBe('unavailable');expect(source.scoped).toBeDefined();daemonRead.assertScopedProjectRead(audience,source.scoped!);expect(daemonActivityGets-before).toBe(1);
   console.log(JSON.stringify({test:'original-B-source-real-HTTP-daemon-read',ordinaryOnly:true,nestedScoped:true,actualActivityGets:daemonActivityGets-before,coreWitnessIssued:false}));
   const legacy=await daemonRead.readProjectSource({...legacySubject,profileId:audience.profileId,workspaceId:audience.workspaceId});daemonRead.assertProjectSourceRead({...legacySubject,profileId:audience.profileId,workspaceId:audience.workspaceId},legacy);expect(legacy.scoped).toBeUndefined();expect(legacy.page.delivery.status).toBe('unavailable');daemonRead.assertScopedProjectRead(audience,source.scoped!);
   console.log(JSON.stringify({test:'original-B-legacy-source-real-HTTP-daemon-read',ordinaryCurrent:true,nestedScoped:false,otherProjectScopedStillCurrent:true,coreWitnessIssued:false}));
  }
  finally{await daemonRead.close();}
  console.log(JSON.stringify({test:'original-B-activity-real-HTTP-daemon-read',projectId:'p',bootEchoValidated:true,originalPosts:posts,coreWitnessIssued:false}));

 }finally{
  if(service)await sealAndDrainKSwarmServiceInstance(service).catch(()=>{});
  await Promise.allSettled([...forwarding]);if(proxy){proxy.closeAllConnections();await new Promise<void>(yes=>proxy!.close(()=>yes()));}
  if(child){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');const watchdog=setTimeout(()=>{if(child!.exitCode===null&&child!.signalCode===null)child!.kill('SIGKILL');},2000);try{await exited;}finally{clearTimeout(watchdog);}}
  for(const close of closes)await close();vi.unstubAllGlobals();vi.unstubAllEnvs();
 }
},30000);
