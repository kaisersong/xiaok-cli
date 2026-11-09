import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {originalProjectDeliveryFixture} from '../../support/original-project-delivery-fixture.js';
import {ConversationActivityOwnerHost} from '../../../src/runtime/conversation-activity/owner-host.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {ConversationActivitySources} from '../../../src/runtime/conversation-activity/sources.js';
let original:ReturnType<typeof originalProjectDeliveryFixture>;
beforeAll(()=>{original=originalProjectDeliveryFixture();});afterAll(()=>original?.close());
it.each(['await','encoding','binding_changed'] as const)('rechecks the original project receipt after %s reentry before writing the actual owner socket result',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'project-owner-send-')),frames=new WeakSet<object>(),scope=original.pages.first.scope;
 let sources:ConversationActivitySources|undefined,client:ConversationActivityOwnerClient|undefined,host:ConversationActivityOwnerHost|undefined,pending:Promise<void>|undefined,release!:()=>void,fired=false;
 const held=new Promise<void>(yes=>{release=yes;});let hold=false,reads=0;
 try{
  host=new ConversationActivityOwnerHost({dataRoot:root,profileId:scope.profileId,actorId:'user',getThread:threadId=>({...scope,threadId,deleteState:'none'}),canObserveWork:()=>true,authorizeProducer:()=>true,
   projectSource:{assertOwner(owner){if(owner!==sources)throw Error('foreign Sources');},ensureRound:projectId=>sources!.ensureProjectRound(projectId),async read(audience,signal,current){reads++;current();if(hold)await held;current();if(signal.aborted)throw Error('source_aborted');const page={...original.pages.first.page,events:original.pages.first.page.events.filter((event:{sourceSequence:number})=>event.sourceSequence>audience.after)},scoped={...original.pages.first,page},frame={page:{...page,delivery:{status:'unavailable' as const,reasonCode:'SNAPSHOT_INCOMPLETE' as const}},scoped};frames.add(frame);frames.add(scoped);return frame;},assertRead(_audience,frame){if(!frames.has(frame))throw Error('foreign HTTP frame');},assertScoped(_audience,frame){if(!frames.has(frame))throw Error('foreign scoped frame');}}});
  sources=new ConversationActivitySources({store:host.store,service:host.service,fixedProjectSource:true,taskHost:()=>{throw Error('unexpected task');}});
  host.store.prepareAssociation({operationId:'op',creationIdempotencyKey:'op',origin:{...scope,threadId:'thread',actorId:'user'}});host.store.bindWork({operationId:'op',watchId:'watch',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:original.pages.first.page.sourceDataEpoch,workId:'p'});
  const invalidate=()=>{if(fired)return;fired=true;hold=true;pending=sources!.refreshProject('p',true);};
  if(mode==='await'){const read=host.service.getWork.bind(host.service);host.service.getWork=async(...args)=>{const view=await read(...args);queueMicrotask(invalidate);return view;};}
  else{const encode=JSON.stringify;vi.spyOn(JSON,'stringify').mockImplementation(((value:unknown,...args:unknown[])=>{const message=value as {type?:string;result?:{watch?:{source?:string}}};if(message?.type==='result'&&message.result?.watch?.source==='kswarm'){if(mode==='binding_changed'&&!fired){fired=true;(host!.store as unknown as{db:import('node:sqlite').DatabaseSync}).db.prepare("UPDATE work_watches SET data_json=json_set(data_json,'$.source','agent_group') WHERE watch_id=?").run('watch');}else if(mode!=='binding_changed')invalidate();}return Reflect.apply(encode,JSON,[value,...args]);}) as typeof JSON.stringify);}
  await host.start();client=new ConversationActivityOwnerClient(root,'user');
  await expect(client.request('work',{watchId:'watch'})).rejects.toThrow(/superseded|unverified|conflict/);expect(fired).toBe(true);expect(reads).toBeGreaterThanOrEqual(1);
 }finally{
  release();await pending;vi.restoreAllMocks();client?.dispose();await sources?.close();await host?.stop();
  if(host&&process.platform!=='win32'){const own=join(tmpdir(),`xa-${process.getuid?.()??'windows-user'}-${host.address.rootHash.slice(0,12)}`);if(dirname(host.address.socketPath)!==own)throw Error('own_socket_directory_mismatch');rmdirSync(own);}
  rmSync(root,{recursive:true,force:true});
 }
});
