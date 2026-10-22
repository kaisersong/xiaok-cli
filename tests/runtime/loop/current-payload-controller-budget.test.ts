import {it,expect,vi,type TestContext} from 'vitest';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const leaf=vi.hoisted(()=>({factory:undefined as any,profile:undefined as any}));
vi.mock('../../../src/runtime/verification/controller-client.js',async original=>({...await original<typeof import('../../../src/runtime/verification/controller-client.js')>(),createInstalledVerificationClient:()=>leaf.factory()}));
vi.mock('../../../src/runtime/verification/migration-markers.js',async original=>({...await original<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>leaf.profile(),readInstalledMigrationOwner:()=>{const p=leaf.profile();return {kind:'protected-unregistered',authorityId:p.kind==='protected'?p.index.authorityId:'authority'};}}));
const ownerLeaf=vi.hoisted(()=>({profileId:'profile'}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(raw:any)=>Object.freeze({kind:'protected-unregistered',authorityId:'authority',owner:Object.freeze({profileId:ownerLeaf.profileId,ownerKind:raw.ownerKind,ownerId:raw.ownerId})})}));import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {VerificationReceiverStore} from '../../../src/runtime/verification/receiver-store.js';
import {startReceiverService} from '../../../src/runtime/verification/receiver-service.js';
import {createReceiverTransport} from '../../../src/runtime/verification/receiver-transport.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createReceiverUploadVerifier} from '../../../src/runtime/verification/receiver-upload-authentication.js';
import {publicationReviewBytes} from '../../../src/runtime/verification/publication-operation-review.js';
import {applicationBindingReviewBytes} from '../../../src/runtime/verification/application-binding-review.js';
import {createApprovedPublicationOperations} from '../../../src/runtime/verification/approved-publication-operation.js';
import {createApplicationBindingAuthority} from '../../../src/runtime/verification/application-binding-authority.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {createControllerApplicationRouting} from '../../../src/runtime/verification/controller-application-routing.js';
import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';
import {parsePublicProfileIndex} from '../../../src/runtime/verification/profile-index-publication.js';
import {createInstalledCompletionPublisher} from '../../../src/runtime/verification/installed-completion-publication.js';
import {readCurrentLoopPublishedCandidate} from '../../../src/runtime/loop/published-candidate.js';
import type {LoopApplicationBinding} from '../../../src/runtime/verification/loop-application-binding.js';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

// Real approval/receiver/controller/installed-reader path. Peer/native approval
// remain the original fixture leaves; only the receiver query's scheduling cost
// is controlled. The actual 10s reader timer, signatures and freshness gates run.
const retainedOwners:Record<string,any>[]=[];
it.for([0, 3500])('reads one current payload without a duplicate receiver query (per-query charge %i)', (chargeMs,ctx) => runScenario(chargeMs,ctx));
it.for(['principal','close'] as const)('fences the new original server operation through %s', (mode,ctx) => runScenario(0,ctx,mode));
function runScenario(chargeMs:number,ctx:TestContext,mode:'normal'|'principal'|'close'='normal'){
 if(retainedOwners.some(owner=>owner.closed!==true))throw Error('loop_budget_previous_owner_unconfirmed');
 const owned:Record<string,any>={chargeMs,mode,errors:[]};retainedOwners.push(owned);
 let f:any,store:any,receiver:any,transport:any,publication:any,application:any,controller:any,publisher:any,armed=false,queries=0;
 let principalChanged=false,afterQuery=false;
 let queryEntered!:()=>void,beforeSendDone!:()=>void;let entered:Promise<void>,sent:Promise<void>;
 let hookFailure:{error:unknown}|undefined;
 const check=()=>ctx.signal.throwIfAborted();
 const onAbort=()=>{owned.aborted=true;};
 const scenario=Promise.resolve().then(async()=>{
 if(hookFailure)throw hookFailure.error;
 let bodyFailed=false,bodyError:unknown;
 try{
 ctx.signal.addEventListener('abort',onAbort,{once:true});
 entered=new Promise<void>(resolve=>{queryEntered=resolve;});owned.queryEntered=entered;
 sent=new Promise<void>(resolve=>{beforeSendDone=resolve;});owned.beforeSendDone=sent;
 check();
 const fixturePromise=verifiedOperationFixture('loop-application',{onAcquired(actual){owned.installed=actual;},onClock(){if(afterQuery){afterQuery=false;queueMicrotask(()=>{principalChanged=true;});}}});owned.fixturePromise=fixturePromise;
 f=await fixturePromise;owned.fixture=f;check();
 const identity=f.receiverIdentity,receiverPath=join(f.root,'receiver.sock');
 store=new VerificationReceiverStore({root:join(f.root,'receiver-state'),...identity,clock:f.clock});
 owned.store=store;
 receiver=await startReceiverService({socketPath:receiverPath,controllerServiceUid:501,identity,privateKey:f.keys.privateKey,store,assertCurrent(){},readPeer:socket=>{if(armed&&mode==='close'){owned.pausedSocket=socket;socket.pause();queryEntered();}return {...f.peer,pid:123};}});
 owned.receiver=receiver;check();
 transport=createReceiverTransport({socketPath:receiverPath,receiverServiceUid:700,identity,verifier:createReceiverReplyVerifier({...identity,publicKey:f.keys.publicKey}),uploadVerifier:createReceiverUploadVerifier({...identity,publicKey:f.keys.publicKey}),assertCurrent(){},readPeer:()=>({uid:700,gid:700,auditSessionId:1,pid:234})});

 owned.transport=transport;
 const resolvePrincipal=(p:typeof f.peer)=>({...p,accountGeneration:principalChanged?'22222222-AAAA-BBBB-CCCC-555555555555':'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const});
 publication=createApprovedPublicationOperations({database:f.database,authorityId:'authority',completion:f.composition,verification:f.operations,receiverIdentity:identity,
 receiver:{stagePayload:transport.stagePayload.bind(transport),call(...args){
  if(armed&&args[0]==='query'){queries++;if(chargeMs)vi.advanceTimersByTime(chargeMs);}
  let raw:Promise<unknown>;
  if(armed&&mode==='close'&&args[0]==='query'){
   // Deliberately uncooperative only in this case: still issue the real signed
   // query once and return its exact P. Its independent native owner releases it.
   const originalBefore=args[3];owned.beforeSendOriginal=originalBefore;
   raw=transport.call(args[0],args[1],undefined,()=>{const result=originalBefore?.();beforeSendDone();return result;});
  }else raw=transport.call(...args);
  if(armed&&args[0]==='query'){
   owned.queryOriginal=raw;
   owned.queryObservation=raw.then((value:unknown)=>{owned.queryOutcome={ok:true,value};if(mode==='principal')afterQuery=true;},(error:unknown)=>{owned.queryOutcome={ok:false,error};});
  }
  return raw;
 }},clock:f.clock,assertCurrent(){},resolvePrincipal,
 async approve(review){return {version:1,purpose:'completion-publication',authorityId:review.authorityId,challengeId:review.challengeId,uid:review.principal.uid,accountGeneration:review.principal.accountGeneration,auditSessionId:review.principal.auditSessionId,requestSource:review.requestSource,fullReviewHash:hash(publicationReviewBytes(review))};}});
 owned.publication=publication;
 application=createApplicationBindingAuthority({database:f.database,authorityId:'authority',completion:f.composition,clock:f.clock,assertCurrent(){},resolvePrincipal,
 async approve(review){return {uid:f.peer.uid,auditSessionId:f.peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});
 owned.application=application;
 const appRouting=createControllerApplicationRouting({application,assertCurrent(){},async renew(){}}),unused=():never=>{throw Error('unused');};
 const routing=createControllerOperationRouting({assertCurrent(){},async renew(){},publication,verification:f.operations,completion:f.composition.public,execution:{invoke:unused}});
 const socketPath=join(f.root,'controller.sock'),calls:string[]=[];
 controller=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:f.keys.privateKey,allowedUserIds:[f.peer.uid],acceptPeer:()=>f.peer,
 async invoke(method,payload,peer,signal){calls.push(method);return method.startsWith('application.')?appRouting.invoke(method,payload,peer,signal):routing.invoke(method,payload,peer,signal);}});
 owned.controller=controller;check();
 leaf.factory=()=>createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,roundTrip:(bytes,signal)=>callControllerIpc(socketPath,bytes,{signal}),roundTripSync:unused});
 leaf.profile=()=>({kind:'protected',index:parsePublicProfileIndex(JSON.parse(readFileSync(join(f.root,'markers','principals',String(f.peer.uid)+'.json'),'utf8')))});
 ownerLeaf.profileId=f.owner.profileId;
 publisher=createInstalledCompletionPublisher({ownerKind:f.owner.ownerKind,ownerId:f.owner.ownerId},'user');
 owned.publisher=publisher;
  const active=application.inspect({ownerKind:'loop',ownerId:f.owner.ownerId},f.peer).current!,binding=active.binding as LoopApplicationBinding;
  const original=await publisher.prepareRequest('original-loop-publication',ctx.signal);check();
  const committed=await publisher.approve(original,ctx.signal);check();expect(committed.status).toBe('committed');
  const attempts=(f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get() as {n:number}).n;
  calls.length=0;armed=true;
  if(mode==='principal'){
   await expect(publication.readCurrentOwnerPayload({ownerKind:'loop',ownerId:f.owner.ownerId},f.peer,ctx.signal)).rejects.toThrow('publication_operation_principal');
   expect(principalChanged).toBe(true);expect(queries).toBe(1);return;
  }
  if(mode==='close'){
   const raw=publication.readCurrentOwnerPayload({ownerKind:'loop',ownerId:f.owner.ownerId},f.peer,ctx.signal);owned.readOriginal=raw;
   let settled=false;const result=raw.then((value:unknown)=>{settled=true;return {ok:true,value};},(error:unknown)=>{settled=true;return {ok:false,error};});owned.readOutcome=result;
   await Promise.all([entered,sent]);check();expect(settled).toBe(false);expect(queries).toBe(1);expect(owned.queryOutcome).toBeUndefined();
   const close=publication.close();owned.originalPublicationClose=close;expect(publication.close()).toBe(close);
   let closeSettled=false,closedAfterRead=false;const closeObservation=close.then(()=>{closeSettled=true;closedAfterRead=settled;},(error:unknown)=>{closeSettled=true;owned.closeFailure={error};});owned.closeObservation=closeObservation;
   await new Promise<void>(resolve=>setImmediate(resolve));await new Promise<void>(resolve=>setImmediate(resolve));
   expect(closeSettled).toBe(false);expect(settled).toBe(false);expect(owned.queryOutcome).toBeUndefined();
   const transportClose=transport.close();owned.releaseTransportClose=transportClose;expect(transport.close()).toBe(transportClose);
   await transportClose;await closeObservation;expect(owned.closeFailure).toBeUndefined();expect(closedAfterRead).toBe(true);
   const ended=await result;expect(ended.ok).toBe(false);expect(ended.error).toBe(owned.queryOutcome.error);
   expect(owned.queryOutcome.ok).toBe(false);return;
  }
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  const result=await readCurrentLoopPublishedCandidate(binding,ctx.signal),body=JSON.parse(result.bytes.toString());
  expect(result.operationId).toBe(committed.operationId);expect(result.businessRevision).toBe(committed.businessRevision);expect(body.application).toEqual(active);
  expect(Buffer.from(body.evaluations[0].artifacts[0].bytesBase64,'base64').toString()).toBe('result');
  expect(calls).toEqual(['application.inspect','publication.readCurrentOwnerPayload','application.inspect','publication.observeOwner']);
  expect(queries).toBe(2);
  expect((f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get() as {n:number}).n).toBe(attempts);
 }catch(error){bodyFailed=true;bodyError=error;owned.bodyError={value:error};}
 finally{
  armed=false;
  const errors:unknown[]=owned.errors;
  async function stop(name:string,close:()=>unknown){try{const raw=close();owned[name]=raw;await raw;}catch(error){errors.push(error);}}
  await stop('resumePausedSocket',()=>owned.pausedSocket?.resume());
  await stop('restoreTimers',()=>vi.useRealTimers());
  await Promise.all([stop('publisherClose',()=>publisher?.dispose()),stop('controllerClose',()=>controller?.close()),stop('applicationClose',()=>application?.close()),stop('publicationClose',()=>publication?.close()),stop('transportClose',()=>transport?.close()),stop('receiverClose',()=>receiver?.close())]);
  if(!f){owned.partial=true;await stop('partialInstalledClose',()=>owned.installed?.close(true));errors.push(Error('loop_budget_setup_owner_unconfirmed'));}
  if(!errors.length){await stop('storeClose',()=>store?.close());if(!errors.length)await stop('fixtureClose',()=>f.close());}
  await stop('removeAbortListener',()=>ctx.signal.removeEventListener('abort',onAbort));
  if(errors.length){owned.retained=true;try{expect(retainedOwners.includes(owned)).toBe(true);}catch(error){errors.push(error);}const failures=bodyFailed?[bodyError,...errors]:errors;if(failures.length===1)throw failures[0];throw new AggregateError(failures,'loop_budget_cleanup_unconfirmed',{cause:failures[0]});}
  owned.closed=true;
 }
 if(bodyFailed)throw bodyError;
 });
 owned.scenario=scenario;
 try{ctx.onTestFinished(()=>scenario);}catch(error){hookFailure={error};owned.hookFailure=hookFailure;}
 return scenario;
}
