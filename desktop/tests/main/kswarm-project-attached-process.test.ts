// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import net from 'node:net';
import {join,resolve,dirname} from 'node:path';
import {mkdtempSync,rmSync,writeFileSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {originalProjectDeliveryFixture} from '../../../tests/support/original-project-delivery-fixture.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {ConversationActivityAttachedService} from '../../../src/runtime/conversation-activity/owner-service.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {registerConversationActivityIpc} from '../../electron/conversation-activity-ipc.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
async function freePort(){const s=net.createServer();await new Promise<void>(yes=>s.listen(0,'127.0.0.1',yes));const port=(s.address() as net.AddressInfo).port;await new Promise<void>(yes=>s.close(()=>yes()));return port;}
function own(child:ChildProcess,name:string){const exited=new Promise<void>((yes,no)=>{child.once('error',no);child.once('exit',(code,signal)=>{console.log(JSON.stringify({test:'attached-process-owned-child',name,pid:child.pid,code,signal,reaped:true}));yes();});});return async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},2000);try{await exited;}finally{clearTimeout(timer);}};}
it('reads real B HTTP across an independent owner process and rejects q-only revocation at the receiving IPC boundary',async()=>{
 resetIpcSchemaRegistryForTests();const ksRoot=resolve('..','..','kswarm'),f=originalProjectDeliveryFixture(ksRoot),root=mkdtempSync(join(tmpdir(),'attached-process-')),dataRoot=join(root,'activity'),scope=f.pages.first.scope,port=await freePort(),base='http://127.0.0.1:'+port,token='own-process-source-test';
 let stopB:(()=>Promise<void>)|undefined,stopOwner:(()=>Promise<void>)|undefined,client:ConversationActivityOwnerClient|undefined,reader:ConversationActivityStore|undefined,attached:ConversationActivityAttachedService|undefined,ipcCleanup:(()=>void)|undefined,allowed=true;
 const messages:any[]=[],waiters=new Map<string,{resolve(value:any):void;reject(error:unknown):void;timer:ReturnType<typeof setTimeout>}>();let owner:ChildProcess|undefined;
 try{
  const b=spawn(process.execPath,[join(ksRoot,'src/server/index.js')],{cwd:ksRoot,env:{...process.env,HOME:f.root,USERPROFILE:f.root,KSWARM_DATA_ROOT:f.root,KSWARM_PORT:String(port),BROKER_URL:'http://127.0.0.1:1',KSWARM_DESKTOP_MUTATION_TOKEN:token,KSWARM_DESKTOP_PROFILE_ID:scope.profileId,KSWARM_DESKTOP_WORKSPACE_ID:scope.workspaceId},stdio:'ignore'});stopB=own(b,'B');
  const deadline=Date.now()+10000;for(;;){try{if((await fetch(base+'/health',{signal:AbortSignal.timeout(500)})).ok)break;}catch{}if(b.exitCode!==null||Date.now()>deadline)throw Error('own_B_start_failed');await new Promise<void>(yes=>setTimeout(yes,25));}
  const config=join(root,'owner.json');writeFileSync(config,JSON.stringify({dataRoot,...scope,epoch:f.pages.first.page.sourceDataEpoch,url:base,token}),{mode:0o600});
  owner=spawn(process.execPath,[resolve('..','.test-dist/tests/runtime/conversation-activity/fixtures/project-forward-owner-entry.js'),config],{cwd:resolve('..'),env:process.env,stdio:['ignore','ignore','pipe','ipc']});stopOwner=own(owner,'activity-owner');
  owner.on('message',(raw:any)=>{messages.push(raw);const waiter=waiters.get(raw?.id);if(waiter){clearTimeout(waiter.timer);waiters.delete(raw.id);waiter.resolve(raw);}});
  await vi.waitFor(()=>expect(messages.some(m=>m.type==='ready')).toBe(true),{timeout:10000});expect(messages.find(m=>m.type==='ready').pid).not.toBe(process.pid);
  const command=(type:string)=>new Promise<any>((yes,no)=>{const id=randomUUID(),timer=setTimeout(()=>{waiters.delete(id);no(Error('own_owner_control_timeout'));},3000);waiters.set(id,{resolve:yes,reject:no,timer});owner!.send({type,id},error=>{if(error){clearTimeout(timer);waiters.delete(id);no(error);}});});
  client=new ConversationActivityOwnerClient(dataRoot,'producer');reader=new ConversationActivityStore(join(dataRoot,'conversation-activity.sqlite'),{readOnly:true});attached=new ConversationActivityAttachedService(client,'user',undefined,{store:reader,assertUserRead(){if(!allowed)throw Error('actual_window_user_revoked');}});
  const actor={actorId:'user',requestSource:'user' as const},view=await attached.getWork('watch',actor),stamp=client.assertProjectWorkReadCurrent(view);expect(view.presentation?.deliveryStage).toBe('ready_for_acceptance');expect((await command('stats')).activityGets).toBe(1);reader.assertProjectForwardSnapshot(stamp,view);
  await command('invalidate_http');await vi.waitFor(()=>expect(()=>client!.assertProjectWorkReadCurrent(view)).toThrow());
  // A real daemon q revocation did not change the original SQLite witness or
  // head. The authenticated negative is independently required at Main.
  expect(()=>reader!.assertProjectForwardSnapshot(stamp,view)).not.toThrow();expect(()=>attached!.assertProjectWorkReadCurrent(view,actor)).toThrow();
  const next=await attached.getWork('watch',actor);expect(next.presentation?.deliveryStage).toBe('ready_for_acceptance');const dismissed=await attached.dismissAttention('watch',{expectedProjectionVersion:next.presentation!.projectionVersion,expectedPresentationIncarnation:next.attentionState!.presentationIncarnation},actor);expect(dismissed.attentionState?.dismissed).toBe(true);
  const handlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>();let revoke=false;
  ipcCleanup=registerConversationActivityIpc({handle(channel,handler){handlers.set(channel,handler as never);}},{async getWork(id:string,currentActor:typeof actor){const raw=await attached!.getWork(id,currentActor);if(revoke)queueMicrotask(()=>{allowed=false;});return raw;},assertReadResultCurrent:(raw:unknown,currentActor:typeof actor)=>attached!.assertProjectWorkReadCurrent(raw,currentActor)} as never,()=>({actorId:'user'}));
  const event={sender:{id:1,isDestroyed:()=>false,once:vi.fn(),removeListener:vi.fn(),send:vi.fn()}};expect((await handlers.get('desktop:activity:work')!(event,{watchId:'watch'}) as any).presentation.deliveryStage).toBe('ready_for_acceptance');revoke=true;await expect(handlers.get('desktop:activity:work')!(event,{watchId:'watch'})).rejects.toThrow('actual_window_user_revoked');
  console.log(JSON.stringify({test:'cross-process-project-forwarding',ownerPid:messages.find(m=>m.type==='ready').pid,receiverPid:process.pid,activityGets:(await command('stats')).activityGets,qOnlyRevocationRejected:true,sqliteStillVerifiesOldStamp:true,dismissed:true,outerUserRevocationRejected:true,scope:'real HTTP/independent owner/readonly Store/typed IPC; controlled thread and Room authorization'}));
 }finally{
  ipcCleanup?.();for(const waiter of waiters.values()){clearTimeout(waiter.timer);waiter.reject(Error('fixture_closing'));}waiters.clear();const address=client?.address;await attached?.close();client?.dispose();reader?.close();await stopOwner?.();await stopB?.();
  if(address&&process.platform!=='win32'){const dir=join(tmpdir(),`xa-${process.getuid?.()??'windows-user'}-${address.rootHash.slice(0,12)}`);if(dirname(address.socketPath)!==dir)throw Error('own_socket_directory_mismatch');rmdirSync(dir);}f.close();rmSync(root,{recursive:true,force:true});
 }
},30000);
