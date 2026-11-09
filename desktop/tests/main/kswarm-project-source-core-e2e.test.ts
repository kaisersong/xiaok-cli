// @vitest-environment node
// Real B/SQLite + original HTTP brands + actual Sources/Service/Store/WorkReader.
// The caller/thread/Room authorization port is controlled, not a Room admission proof.
import {it,expect,vi} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import net from 'node:net';
import {resolve,join,dirname} from 'node:path';
import {mkdtempSync,rmSync,writeFileSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {originalProjectDeliveryFixture} from '../../../tests/support/original-project-delivery-fixture.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {ConversationActivityOwnerHost} from '../../../src/runtime/conversation-activity/owner-host.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {ConversationActivityAttachedService} from '../../../src/runtime/conversation-activity/owner-service.js';
import {ConversationActivityService} from '../../../src/runtime/conversation-activity/service.js';
import {ConversationActivitySources} from '../../../src/runtime/conversation-activity/sources.js';
import {ActivityProjectHttpTransport,type ActivityProjectSourceHttpRead,type ActivityScopedProjectHttpRead} from '../../../src/runtime/conversation-activity/project-http-transport.js';
import type {ProjectSourcePort} from '../../../src/runtime/conversation-activity/project-source-port.js';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance,type KSwarmService,type KSwarmProjectSourceActivityRead,type KSwarmScopedProjectActivityRead} from '../../electron/kswarm-service.js';
import {registerConversationActivityIpc} from '../../electron/conversation-activity-ipc.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
async function freePort(){const server=net.createServer();await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));const port=(server.address() as net.AddressInfo).port;await new Promise<void>(yes=>server.close(()=>yes()));return port;}
it.each(['main','daemon','attached'] as const)('reads actual B ready through the original %s HTTP owner into fixed Core and dismisses a same-cursor reread',async mode=>{
 resetIpcSchemaRegistryForTests();const ksRoot=resolve('..','..','kswarm'),entry=join(ksRoot,'src','server','index.js'),f=originalProjectDeliveryFixture(ksRoot),nativeFetch=globalThis.fetch;
 const activityRoot=mkdtempSync(join(tmpdir(),'source-core-http-'));let child:ChildProcess|undefined,exited:Promise<void>|undefined,main:KSwarmService|undefined,daemon:ActivityProjectHttpTransport|undefined,store:ConversationActivityStore|undefined,service:ConversationActivityService|undefined,sources:ConversationActivitySources|undefined,gets=0;let owner:ConversationActivityOwnerHost|undefined,client:ConversationActivityOwnerClient|undefined,reader:ConversationActivityStore|undefined,attached:ConversationActivityAttachedService|undefined;
 try{
  let holdActivity:Promise<void>|undefined;const port=await freePort(),base='http://127.0.0.1:'+port,scope=f.pages.first.scope,token='isolated-source-test-token';let mutationToken=token;
  const fetchCount=(async(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(String(input));if(/\/projects\/p\/activity$/.test(url.pathname)){gets++;if(holdActivity)await holdActivity;}return nativeFetch(input,init);}) as typeof fetch;
  if(mode==='main'){
   vi.stubEnv('XIAOK_CONFIG_DIR',f.root);vi.stubEnv('KSWARM_SERVER_PATH',entry);
   vi.stubGlobal('fetch',async(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(String(input));if(url.port==='4318')return Response.json({ok:true,rooms:[]});if(url.port!=='4400')throw Error('unexpected Main network');return fetchCount(base+url.pathname+url.search,init);});
   main=createKSwarmService({desktopProjectScope:scope,spawnProcess:()=>{throw Error('must adopt this own B only');},findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('must not kill a listener');}});mutationToken=main.getDesktopMutationToken();
  }
  child=spawn(process.execPath,[entry],{cwd:ksRoot,env:{...process.env,HOME:f.root,USERPROFILE:f.root,KSWARM_DATA_ROOT:f.root,KSWARM_PORT:String(port),BROKER_URL:'http://127.0.0.1:1',KSWARM_DESKTOP_MUTATION_TOKEN:mutationToken,KSWARM_DESKTOP_PROFILE_ID:scope.profileId,KSWARM_DESKTOP_WORKSPACE_ID:scope.workspaceId},stdio:'ignore'});
  exited=new Promise<void>((yes,no)=>{child!.once('error',no);child!.once('exit',(code,signal)=>{console.log(JSON.stringify({test:'source-core-http-own-B-child',mode,pid:child!.pid,code,signal,reaped:true}));yes();});});
  const deadline=Date.now()+10000;for(;;){try{if((await nativeFetch(base+'/health',{signal:AbortSignal.timeout(500)})).ok)break;}catch{}if(child.exitCode!==null||child.signalCode!==null||Date.now()>deadline)throw Error('own B startup failed');await new Promise<void>(yes=>setTimeout(yes,25));}
  if(main)await main.start();else daemon=new ActivityProjectHttpTransport({ownerEpoch:'own-source-core-test',kswarm:{url:base,mutationToken,brokerUrl:base,roomToken:'unused'},fetch:fetchCount});
  const subject=(audience:{projectId:string;sourceDataEpoch:string;after:number})=>({projectId:audience.projectId,sourceDataEpoch:audience.sourceDataEpoch,after:audience.after});
  const projectSource:ProjectSourcePort={assertOwner(owner){if(owner!==sources)throw Error('foreign Sources');},ensureRound:id=>sources!.ensureProjectRound(id),admitHint:id=>sources!.admitProjectHint(id),
   read:(audience,signal,beforeEffects)=>main?main.readProjectSourceActivity!(subject(audience),{requestSource:'scheduler',signal,beforeEffects}):daemon!.readProjectSource(audience,signal,beforeEffects),
   assertRead:(audience,frame)=>{if(main)main.assertProjectSourceActivityRead!(subject(audience),frame as KSwarmProjectSourceActivityRead);else daemon!.assertProjectSourceRead(audience,frame as ActivityProjectSourceHttpRead);},
   assertScoped:(audience,frame)=>{if(main)main.assertScopedProjectActivityRead!(subject(audience),frame as KSwarmScopedProjectActivityRead);else daemon!.assertScopedProjectRead(audience,frame as ActivityScopedProjectHttpRead);}};
  if(mode==='attached'){owner=new ConversationActivityOwnerHost({dataRoot:activityRoot,profileId:scope.profileId,actorId:'user',getThread:threadId=>({...scope,threadId,deleteState:'none'}),canObserveWork:()=>true,authorizeProducer:()=>true,projectSource});store=owner.store;service=owner.service;}
  else store=new ConversationActivityStore(join(activityRoot,'activity.sqlite'),{projectOrdinarySource:frame=>service!.resolveProjectOrdinarySource(frame),projectDeliverySource:frame=>service!.resolveProjectDeliverySource(frame)});
  store.prepareAssociation({operationId:'op',creationIdempotencyKey:'op',origin:{...scope,threadId:'thread',actorId:'user'}});store.bindWork({operationId:'op',watchId:'watch',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:f.pages.first.page.sourceDataEpoch,workId:'p'});
  const errors:unknown[]=[];if(!service)service=new ConversationActivityService({store,profileId:scope.profileId,actorId:'user',getThread:threadId=>({...scope,threadId,deleteState:'none'}),canObserveWork:()=>true,projectSource,onError:error=>errors.push(error)});
  sources=new ConversationActivitySources({store,service,fixedProjectSource:true,taskHost:()=>{throw Error('unexpected task host');},onError:error=>errors.push(error)});
  if(owner){await owner.start();client=new ConversationActivityOwnerClient(activityRoot,'producer');reader=new ConversationActivityStore(owner.store.file,{readOnly:true});attached=new ConversationActivityAttachedService(client,'user',undefined,{store:reader,assertUserRead(){}});}
  const api=attached??service;
  const actor={actorId:'user',requestSource:'user' as const},view=await api.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('ready_for_acceptance');expect(gets).toBe(1);expect(view.attentionState?.dismissed).toBe(false);expect(view.presentation?.primaryReason).toBe('review_required');
  if(process.env.XIAOK_DSH_READY_EVIDENCE_DIR)writeFileSync(join(process.env.XIAOK_DSH_READY_EVIDENCE_DIR,mode+'-view.json'),JSON.stringify(view),{mode:0o600});
  const dismissed=await api.dismissAttention('watch',{expectedProjectionVersion:view.presentation!.projectionVersion,expectedPresentationIncarnation:view.attentionState!.presentationIncarnation},actor);expect(dismissed.attentionState?.dismissed).toBe(true);expect(dismissed.presentation?.projectionVersion).toBe(view.presentation!.projectionVersion);expect(gets).toBe(2);expect(errors).toEqual([]);
  // Actual registered typed IPC: invalidate after Core's own return, while
  // the next original HTTP read remains held. The outer check must reject it.
  const handlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>();let release!:()=>void,pending:Promise<void>|undefined;
  const held=new Promise<void>(yes=>{release=yes;}),facade={async getWork(id:string,currentActor:Parameters<ConversationActivityService['getWork']>[1]){const raw=await api.getWork(id,currentActor);queueMicrotask(()=>{holdActivity=held;pending=client?client.hintProject('p'):sources!.refreshProject('p',true);});return raw;},assertReadResultCurrent:(raw:unknown,currentActor:Parameters<ConversationActivityService['getWork']>[1])=>api.assertProjectWorkReadCurrent(raw,currentActor)};
  const cleanup=registerConversationActivityIpc({handle(channel,handler){handlers.set(channel,handler as never);}},facade as never,()=>({actorId:'user'}));
  try{await expect(handlers.get('desktop:activity:work')!({sender:{id:1,isDestroyed:()=>false,once:vi.fn(),removeListener:vi.fn(),send:vi.fn()}},{watchId:'watch'})).rejects.toThrow(/superseded|unverified/);await vi.waitFor(()=>expect(gets).toBe(4));}
  finally{release();await pending;cleanup();}
  console.log(JSON.stringify({test:'original-B-source-core-fixed-public-return',mode,actualActivityGets:gets,ready:true,sameCursorDismissed:true,outerIpcRejected:true,scope:'controlled Room authorization, real HTTP/Core; attached additionally actual owner socket/readonly Store/typed IPC'}));
 }finally{
  await sources?.close();await attached?.close();reader?.close();if(owner){await owner.stop();if(process.platform!=='win32'){const own=join(tmpdir(),`xa-${process.getuid?.()??'windows-user'}-${owner.address.rootHash.slice(0,12)}`);if(dirname(owner.address.socketPath)!==own)throw Error('own_socket_directory_mismatch');rmdirSync(own);}}else{await service?.close();store?.close();}await daemon?.close();if(main)await sealAndDrainKSwarmServiceInstance(main);
  if(child){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');const watchdog=setTimeout(()=>{if(child!.exitCode===null&&child!.signalCode===null)child!.kill('SIGKILL');},2000);try{await exited;}finally{clearTimeout(watchdog);}}
  f.close();rmSync(activityRoot,{recursive:true,force:true});vi.unstubAllGlobals();vi.unstubAllEnvs();
 }
},30000);
