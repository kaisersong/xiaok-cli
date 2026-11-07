import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {originalProjectDeliveryFixture} from '../../support/original-project-delivery-fixture.js';
import {ConversationActivityOwnerHost} from '../../../src/runtime/conversation-activity/owner-host.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {ConversationActivitySources} from '../../../src/runtime/conversation-activity/sources.js';
import {ConversationActivityAttachedService} from '../../../src/runtime/conversation-activity/owner-service.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
let original:ReturnType<typeof originalProjectDeliveryFixture>;const cleanup:Array<()=>Promise<void>>=[];
beforeAll(()=>{original=originalProjectDeliveryFixture();});afterAll(()=>original.close());afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'project-forward-socket-')),scope=original.pages.first.scope,frames=new WeakSet<object>();let sources:ConversationActivitySources,hold:Promise<void>|undefined,reads=0;
 const host=new ConversationActivityOwnerHost({dataRoot:root,profileId:scope.profileId,actorId:'user',getThread:threadId=>({...scope,threadId,deleteState:'none'}),canObserveWork:()=>true,authorizeProducer:()=>true,
  projectSource:{assertOwner(owner){if(owner!==sources)throw Error('foreign_source_owner');},ensureRound:p=>sources.ensureProjectRound(p),admitHint:p=>sources.admitProjectHint(p),async read(audience,signal,current){reads++;current();if(hold)await hold;current();if(signal.aborted)throw Error('source_aborted');const page={...original.pages.first.page,events:original.pages.first.page.events.filter((event:{sourceSequence:number})=>event.sourceSequence>audience.after)},scoped={...original.pages.first,page};frames.add(scoped);const result={page:{...page,delivery:{status:'unavailable' as const,reasonCode:'SNAPSHOT_INCOMPLETE' as const}},scoped};frames.add(result);return result;},assertRead(_a,frame){if(!frames.has(frame))throw Error('http_frame_foreign');},assertScoped(_a,frame){if(!frames.has(frame))throw Error('http_frame_foreign');}}});
 sources=new ConversationActivitySources({store:host.store,service:host.service,fixedProjectSource:true,taskHost:()=>{throw Error('unexpected_task');}});
 host.store.prepareAssociation({operationId:'op',creationIdempotencyKey:'op',origin:{...scope,threadId:'thread',actorId:'user'}});host.store.bindWork({operationId:'op',watchId:'watch',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:original.pages.first.page.sourceDataEpoch,workId:'p'});
 await host.start();const client=new ConversationActivityOwnerClient(root,'producer'),reader=new ConversationActivityStore(host.store.file,{readOnly:true});
 cleanup.push(async()=>{client.dispose();reader.close();await sources.close();await host.stop();if(process.platform!=='win32'){const own=join(tmpdir(),`xa-${process.getuid?.()??'windows-user'}-${host.address.rootHash.slice(0,12)}`);if(dirname(host.address.socketPath)!==own)throw Error('own_socket_directory_mismatch');rmdirSync(own);}rmSync(root,{recursive:true,force:true});});
 return{host,client,sources,reader,get reads(){return reads;},hold(value?:Promise<void>){hold=value;}};
}
it('forwards an original Core ready through the actual authenticated owner socket and readonly Store',async()=>{
 const f=await fixture(),view=await f.client.readProjectWork('watch','p');expect(view.presentation?.deliveryStage).toBe('ready_for_acceptance');const stamp=f.client.assertProjectWorkReadCurrent(view);expect(stamp).toBeTruthy();f.reader.assertProjectForwardSnapshot(stamp,view);expect(f.reads).toBe(1);expect(()=>f.client.assertProjectWorkReadCurrent({...view})).toThrow();
});
it('does not mint the private project receive brand from generic RPC JSON',async()=>{
 const f=await fixture(),generic=await f.client.request('projectWorkRead',{watchId:'watch',projectId:'p'});expect(()=>f.client.assertProjectWorkReadCurrent(generic)).toThrow();
});
it('invalidates old forwarded ready synchronously on a known hint and admits the hint before any fresh read',async()=>{
 const f=await fixture(),view=await f.client.readProjectWork('watch','p');let release!:()=>void;f.hold(new Promise<void>(yes=>{release=yes;}));
 const hint=f.client.hintProject('p');expect(()=>f.client.assertProjectWorkReadCurrent(view)).toThrow();
 try{await hint;await vi.waitFor(()=>expect(f.reads).toBe(2));const next=await f.client.readProjectWork('watch','p');expect(next.presentation?.deliveryStage).toBe('none');expect(next.attentionState).toBeUndefined();}finally{release();await f.sources.refreshProject('p');}
});
it('keeps the receiving connection incarnation and rejects a view after disconnect',async()=>{
 const f=await fixture(),view=await f.client.readProjectWork('watch','p');f.client.dispose();expect(()=>f.client.assertProjectWorkReadCurrent(view)).toThrow();
});

it('returns a qualified project through AttachedService and rechecks its actual local user on final return',async()=>{
 const f=await fixture();let allowed=true;const actor={actorId:'user',requestSource:'user' as const},attached=new ConversationActivityAttachedService(f.client,'user',undefined,{store:f.reader,assertUserRead(){if(!allowed)throw Error('actual_local_user_revoked');}});
 const view=await attached.getWork('watch',actor);expect(view.presentation?.deliveryStage).toBe('ready_for_acceptance');expect(()=>attached.assertProjectWorkReadCurrent(view,actor)).not.toThrow();allowed=false;expect(()=>attached.assertProjectWorkReadCurrent(view,actor)).toThrow('actual_local_user_revoked');
});
it('retains original dismiss CAS through the dedicated authenticated project path',async()=>{
 const f=await fixture(),view=await f.client.readProjectWork('watch','p'),next=await f.client.readProjectWork('watch','p',undefined,{expectedProjectionVersion:view.presentation!.projectionVersion,expectedPresentationIncarnation:view.attentionState!.presentationIncarnation});
 expect(next.attentionState?.dismissed).toBe(true);expect(()=>f.client.assertProjectWorkReadCurrent(view)).toThrow();f.reader.assertProjectForwardSnapshot(f.client.assertProjectWorkReadCurrent(next),next);
});
it('processes a same-batch negative before an earlier reentrant subscription callback',async()=>{
 const f=await fixture(),view=await f.client.readProjectWork('watch','p');let notified!:()=>void;const reached=new Promise<void>(yes=>{notified=yes;}),checks:boolean[]=[];
 const stop=await f.client.subscribe('thread',()=>{try{f.client.assertProjectWorkReadCurrent(view);checks.push(true);}catch{checks.push(false);}notified();});
 const subscriptionId=[...(f.client as unknown as{subscriptions:Map<string,unknown>}).subscriptions.keys()][0]!,send=(f.host as unknown as{send:(peer:any,message:any,before?:()=>void)=>void}).send.bind(f.host);let negative:any,peer:any;
 const spy=vi.spyOn(f.host as any,'send').mockImplementation((client:any,message:any,before:any)=>{if(message.type==='projectNegative'){negative=message;peer=client;}else send(client,message,before);});
 try{f.host.invalidateProjectReads('p');expect(negative).toBeTruthy();peer.socket.write(JSON.stringify({type:'change',subscriptionId,change:{threadId:'thread',watchId:'watch'}})+'\n'+JSON.stringify(negative)+'\n');await reached;expect(checks).toEqual([false]);}
 finally{spy.mockRestore();stop();}
});
it.each(['await','encoding'] as const)('writes no strong project envelope after %s-time Source invalidation',async mode=>{
 const f=await fixture();let release!:()=>void,fired=false,pending:Promise<void>|undefined;const held=new Promise<void>(yes=>{release=yes;}),originalGet=f.host.service.getWork.bind(f.host.service),stringify=JSON.stringify;const invalidate=()=>{if(fired)return;fired=true;f.hold(held);pending=f.sources.admitProjectHint('p').settled;};
 const wires:string[]=[],peerWrites:ReturnType<typeof vi.spyOn>[]=[];
 const peerSpy=vi.spyOn(f.host as any,'send').mockImplementation(function(this:any,client:any,message:any,before:any){if(!peerWrites.length){const write=client.socket.write.bind(client.socket);peerWrites.push(vi.spyOn(client.socket,'write').mockImplementation((bytes:any,...args:any[])=>{wires.push(String(bytes));return write(bytes,...args);}));}return Object.getPrototypeOf(f.host).send.call(f.host,client,message,before);});
 const product=mode==='await'?vi.spyOn(f.host.service,'getWork').mockImplementation(async(...args)=>{const result=await originalGet(...args);invalidate();return result;}):vi.spyOn(JSON,'stringify').mockImplementation(((value:unknown,...args:unknown[])=>{if(value&&typeof value==='object'&&(value as any).type==='result'&&(value as any).result?.protocol===1)invalidate();return Reflect.apply(stringify,JSON,[value,...args]);}) as typeof JSON.stringify);
 try{await expect(f.client.readProjectWork('watch','p')).rejects.toThrow(/superseded|unverified/);expect(fired).toBe(true);expect(wires.some(line=>{try{return JSON.parse(line).result?.view?.attentionState;}catch{return false;}})).toBe(false);}
 finally{release();await pending;product.mockRestore();peerSpy.mockRestore();for(const spy of peerWrites)spy.mockRestore();}
});
it('closes a malformed dedicated response before an earlier same-batch subscription can consume a valid old receipt',async()=>{
 const f=await fixture();let envelope:any,peer:any;const send=(f.host as any).send.bind(f.host),capture=vi.spyOn(f.host as any,'send').mockImplementation((client:any,message:any,before:any)=>{if(message.type==='result'&&message.result?.protocol===1){envelope=message.result;peer=client;}return send(client,message,before);});
 const view=await f.client.readProjectWork('watch','p');capture.mockRestore();let callback!:()=>void;const reached=new Promise<void>(yes=>{callback=yes;}),checks:boolean[]=[];
 const stop=await f.client.subscribe('thread',()=>{try{f.client.assertProjectWorkReadCurrent(view);checks.push(true);}catch{checks.push(false);}callback();});const subscriptionId=[...(f.client as any).subscriptions.keys()][0];
 // Controlled wire corruption after a real Core receipt's last guard. This
 // fixture tests receive ordering, not a new Source qualification.
 const replay=vi.spyOn(f.host as any,'projectWorkRead').mockResolvedValue(envelope),corrupt=vi.spyOn(f.host as any,'send').mockImplementation((client:any,message:any,before:any)=>{if(message.type==='result'&&message.result===envelope){before?.();peer.socket.write(JSON.stringify({type:'change',subscriptionId,change:{threadId:'thread',watchId:'watch'}})+'\n'+JSON.stringify({...message,result:{...envelope,stamp:{...envelope.stamp,stateDigest:'corrupted'}}})+'\n');}else send(client,message,before);});
 try{await expect(f.client.readProjectWork('watch','p')).rejects.toThrow();await Promise.race([reached,new Promise<void>(yes=>setTimeout(yes,20))]);expect(checks).not.toContain(true);expect(()=>f.client.assertProjectWorkReadCurrent(view)).toThrow();}
 finally{corrupt.mockRestore();replay.mockRestore();stop();}
});
it('routes one same-head external hint recovery to the actual socket subscriber without stable-read feedback',async()=>{
 const f=await fixture();await f.client.readProjectWork('watch','p');let release!:()=>void;f.hold(new Promise<void>(yes=>{release=yes;}));const reads:Promise<unknown>[]=[],changes:unknown[]=[];let recovered!:()=>void;const recovery=new Promise<void>(yes=>{recovered=yes;});
 const stop=await f.client.subscribe('thread',change=>{changes.push(change);reads.push(f.client.readProjectWork('watch','p').then(view=>{if(view.presentation?.deliveryStage==='ready_for_acceptance')recovered();}));});
 try{await f.client.hintProject('p');const unknown=await f.client.readProjectWork('watch','p');expect(unknown.attentionState).toBeUndefined();release();await f.sources.refreshProject('p');await Promise.race([recovery,new Promise<never>((_yes,no)=>setTimeout(()=>no(Error('same_head_recovery_missing')),1000))]);await Promise.all(reads);expect(changes).toHaveLength(1);expect(f.reads).toBe(3);}
 finally{release();await f.sources.refreshProject('p');stop();}
});
it('routes a settled event over a captured subscription set when a callback subscribes reentrantly',async()=>{
 const f=await fixture();await f.client.readProjectWork('watch','p');let oldCalls=0,newCalls=0,reached!:()=>void,added:Promise<()=>void>|undefined,stopNew:(()=>void)|undefined;const routed=new Promise<void>(yes=>{reached=yes;});
 const stop=await f.client.subscribe('thread',()=>{oldCalls++;if(!added)added=f.client.subscribe('thread',()=>{newCalls++;});reached();});
 try{await f.client.hintProject('p');await routed;stopNew=await added;expect(oldCalls).toBe(1);expect(newCalls).toBe(0);}finally{stop();stopNew?.();}
});
