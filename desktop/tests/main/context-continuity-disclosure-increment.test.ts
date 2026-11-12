// @vitest-environment node
import {expect,it} from 'vitest';
import {desktopActivityProfileId} from '../../../src/runtime/conversation-activity/owner-profile-id.js';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMobileGateway} from '../../electron/mobile-gateway.js';
import {ConversationActivityOwnerHost} from '../../../src/runtime/conversation-activity/owner-host.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {activityOwnerConfigDigest,type ActivityOwnerConfig} from '../../../src/runtime/conversation-activity/owner-runtime.js';

it.each(['matching','wrong-profile','wrong-digest'] as const)('checks %s on the real authenticated owner hello',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-owner-routing-')),profileId=randomUUID(),scopeId=desktopActivityProfileId(root),info=userInfo();
 writeFileSync(join(root,'continuity-profile.json'),JSON.stringify({version:1,profileId,osOwner:process.platform==='win32'?info.username:String(info.uid)}),{mode:0o600});
 const config:ActivityOwnerConfig={schemaVersion:1,dataRoot:root,profileId:scopeId,actorId:`desktop-user:${scopeId}`,identity:{kind:'desktop',path:join(root,'multi-agent','groups.sqlite')}};
 writeFileSync(join(root,'activity-owner.config.json'),JSON.stringify(config),{mode:0o600});
 const host=new ConversationActivityOwnerHost({dataRoot:root,profileId:mode==='wrong-profile'?desktopActivityProfileId(join(root,'foreign')):scopeId,actorId:config.actorId,configDigest:mode==='wrong-digest'?'0'.repeat(64):activityOwnerConfigDigest(config),getThread:()=>null,authorizeProducer:()=>false,canObserveWork:()=>false});
 let client:ConversationActivityOwnerClient|undefined;
 try{await host.start();client=new ConversationActivityOwnerClient(root,'user');if(mode==='matching')expect(await client.request('status')).toMatchObject({profileId:scopeId,configDigest:activityOwnerConfigDigest(config)});else await expect(client.request('status')).rejects.toThrow('activity_owner_qualification_mismatch');}
 finally{const closes=await Promise.allSettled([client?.close(),host.stop()]);const errors=closes.filter((row):row is PromiseRejectedResult=>row.status==='rejected');if(mode==='matching'){if(errors.length)throw new AggregateError(errors.map(row=>row.reason),'routing_fixture_close_failed');rmSync(root,{recursive:true,force:true});}else{if(closes[1].status==='rejected')throw closes[1].reason;console.info('retained negative routing fixture',root);}}
});

it('returns only a neutral closed activity projection after access is lost',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-owner-neutral-'));let allowed=true;
 const actor={requestSource:'user' as const,actorId:'desktop-user:profile'};
 const host=new ConversationActivityOwnerHost({dataRoot:root,profileId:'profile',actorId:actor.actorId,getThread:threadId=>({threadId,profileId:'profile',workspaceId:'workspace',deleteState:'none'}),authorizeProducer:()=>true,canObserveWork:()=>allowed});
 let producer:ConversationActivityOwnerClient|undefined,user:ConversationActivityOwnerClient|undefined;
 try{
  await host.start();producer=new ConversationActivityOwnerClient(root,'producer');user=new ConversationActivityOwnerClient(root,'user');
  await producer.request('prepare',{threadId:'thread',operationId:'neutral',creationIdempotencyKey:'neutral'});
  await producer.request('bind',{operationId:'neutral',watchId:'watch',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'epoch',workId:'task'});
  await producer.request('ingest',{watchId:'watch',event:{schemaVersion:1,eventId:'progress',source:'task_host',logicalSourceId:'host',sourceDataEpoch:'epoch',workId:'task',runId:'',sourceSequence:1,transportGeneration:0,kind:'progress',receivedAt:Date.now(),summary:'PRIVATE_ACTIVITY_CANARY',evidenceRefs:[]}});
  expect(JSON.stringify(await user.request('work',{watchId:'watch'}))).toContain('PRIVATE_ACTIVITY_CANARY');
  allowed=false;const view=await user.request<any>('work',{watchId:'watch'});expect(view.projection.revision).toBe(0);expect(Object.keys(view.projection).sort()).toEqual(['watchId','executionState','businessOutcome','freshness','sourceSequence','revision','lastProgressAt','lastHeartbeatAt','lastReportAt','errorCode','evidenceRefs'].sort());expect(JSON.stringify(view)).not.toContain('PRIVATE_ACTIVITY_CANARY');
 }finally{if(user)await user.close();if(producer)await producer.close();await host.stop();rmSync(root,{recursive:true,force:true});}
});

it('uses the actual Main history owner for mobile current reads and rejects copied/mutated output',async()=>{
 const {createDesktopServices,readOriginalDesktopContinuityMain}=await import('../../electron/desktop-services.js');
 const {createOriginalMobileDisclosureOwner}=await import('../../electron/mobile-disclosure-owner.js');
 const {mockKSwarmService}=await import('../support/desktop-services-fixtures.js');
 expect(()=>createOriginalMobileDisclosureOwner({})).toThrow('canonical_runtime_source_unavailable');
 const root=mkdtempSync(join(tmpdir(),'continuity-mobile-real-owner-'));
 const services=createDesktopServices({dataRoot:root,knowledgeDbPath:join(root,'knowledge.test.sqlite'),kswarmService:mockKSwarmService()});let mobile:ReturnType<typeof createOriginalMobileDisclosureOwner>|undefined;
 try{
  await services.multiAgent?.ready;const source=readOriginalDesktopContinuityMain(services),port=services.continuity.port();
  const conversation=port.service.createConversation(port.actor,{operationId:'mobile-real-owner'});
  if(services.multiAgent)await services.multiAgent.service.registerThreadWithOwnership({threadId:conversation.id,profileId:services.multiAgent.profileId,workspaceId:services.multiAgent.workspaceId,cwd:services.multiAgent.cwd},'user');
  const prepared=await source.host.prepareTask({prompt:'unproven internal input',materials:[],context:{threadId:conversation.id}});
  port.service.bindTask(port.actor,{conversationId:conversation.id,taskId:prepared.taskId});
  mobile=createOriginalMobileDisclosureOwner(services);expect(()=>mobile!.bind('snapshot',{text:'foreign'},mobile!.emptyCut())).toThrow();const read=await mobile.task(prepared.taskId),value=mobile.bind('snapshot',{text:'MOBILE_CURRENT_CANARY'},read.cut);
  mobile.assertOutputCurrent('snapshot',value);expect(()=>mobile!.assertOutputCurrent('snapshot',{...value})).toThrow();
  let traps=0;expect(()=>mobile!.bind('snapshot',new Proxy({text:'unexpected'},{get(){traps++;return undefined;}}),read.cut)).toThrow();expect(traps).toBe(0);
  value.text='changed';expect(()=>mobile!.assertOutputCurrent('snapshot',value)).toThrow();
  const stable=mobile.bind('snapshot',{text:'MOBILE_CURRENT_CANARY'},read.cut);
  port.service.tombstoneConversation(port.actor,conversation.id);
  expect(()=>mobile!.assertOutputCurrent('snapshot',stable)).toThrow();
 }finally{if(mobile)await mobile.close();const stopped=await services.disposeMultiAgent();if(!stopped.drained)throw Error('mobile_actual_owner_not_drained '+root);rmSync(root,{recursive:true,force:true});}
});

it('keeps token authentication and strict synchronous output policy as AND gates on the real HTTP transport',async()=>{
 let allowed=true;
 const gateway=createMobileGateway({host:'127.0.0.1',port:0,desktopName:'fixture',mobileAccessToken:'token',requireDisclosurePolicy:true,assertOutputCurrent(){if(!allowed)throw Error('revoked');},getSnapshot:async()=>({desktopName:'fixture',health:'online',lastSyncSequence:1,runningTurn:null,messages:[],conversations:[],projects:[],approvals:[],loops:[],artifacts:[]})});
 try{await gateway.start();const url=gateway.getStatus().baseURL+'/v0/mobile/snapshot';expect((await fetch(url)).status).toBe(401);expect((await fetch(url,{headers:{authorization:'Bearer token'}})).status).toBe(200);allowed=false;expect((await fetch(url,{headers:{authorization:'Bearer token'}})).status).toBe(403);}
 finally{await gateway.stop();}
});

it.each(['getter','toJSON','proxy'] as const)('rejects %s without executing it on the real HTTP output',async kind=>{
 let calls=0;const trap=()=>{calls++;return 'SECRET_TRAP';};
 const safe={desktopName:'fixture',health:'online',lastSyncSequence:1,runningTurn:null,messages:[],conversations:[],projects:[],approvals:[],loops:[],artifacts:[]};
 const value=kind==='proxy'?new Proxy(safe,{getPrototypeOf:trap}):Object.defineProperty(safe,kind==='getter'?'messages':'toJSON',kind==='getter'?{get:trap,configurable:true,enumerable:true}:{value:trap,configurable:true,enumerable:true});
 const gateway=createMobileGateway({host:'127.0.0.1',port:0,desktopName:'fixture',mobileAccessToken:'token',requireDisclosurePolicy:true,assertOutputCurrent(){},getSnapshot:async()=>value as any});
 try{await gateway.start();const response=await fetch(gateway.getStatus().baseURL+'/v0/mobile/snapshot',{headers:{authorization:'Bearer token'}});expect(response.status).toBe(403);expect(await response.text()).not.toContain('SECRET_TRAP');expect(calls).toBe(0);}finally{await gateway.stop();}
});

it.each(['multi-agent/groups.sqlite','codex-native.sqlite'])('never treats existing %s with missing profile/config as ordinary',async marker=>{
 const {readProtectedOwnerQualification}=await import('../../../src/runtime/conversation-activity/owner-qualification.js');
 const root=mkdtempSync(join(tmpdir(),'continuity-marker-deny-'));
 try{expect(readProtectedOwnerQualification(root)).toBeUndefined();const file=join(root,marker);mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,'',{mode:0o600});expect(()=>readProtectedOwnerQualification(root)).toThrow('activity_owner_qualification_unavailable');}
 finally{rmSync(root,{recursive:true,force:true});}
});
