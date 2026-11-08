import {beforeAll,afterAll,it,expect,vi} from 'vitest';
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
import {readCurrentLoopPublicationSet} from '../../../src/runtime/loop/published-set.js';
import {readCurrentLoopPublishedCandidate} from '../../../src/runtime/loop/published-candidate.js';
import type {LoopApplicationBinding} from '../../../src/runtime/verification/loop-application-binding.js';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

// Actual verification/receiver/controller/installed-client pipeline; peer
// identity and native approval are explicit fixture leaves, not OS evidence.
type OriginalFixture=Awaited<ReturnType<typeof verifiedOperationFixture>>;
const owned:{
 f?:OriginalFixture;store?:VerificationReceiverStore;
 receiver?:Awaited<ReturnType<typeof startReceiverService>>;
 publication?:ReturnType<typeof createApprovedPublicationOperations>;
 application?:ReturnType<typeof createApplicationBindingAuthority>;
 controller?:Awaited<ReturnType<typeof startPublicController>>;
 publisher?:ReturnType<typeof createInstalledCompletionPublisher>;
}={};
let ready:{f:OriginalFixture;store:VerificationReceiverStore;application:ReturnType<typeof createApplicationBindingAuthority>;publisher:ReturnType<typeof createInstalledCompletionPublisher>;calls:string[]}|undefined;
// Presence is separate from the raw value: `throw undefined` is still a failure.
let primary:{raw:unknown}|undefined;

beforeAll(async()=>{
 try{

 const f=await verifiedOperationFixture('loop-application');owned.f=f;
 const identity=f.receiverIdentity,receiverPath=join(f.root,'receiver.sock');
 const store=new VerificationReceiverStore({root:join(f.root,'receiver-state'),...identity,clock:f.clock});owned.store=store;
 const receiver=await startReceiverService({socketPath:receiverPath,controllerServiceUid:501,identity,privateKey:f.keys.privateKey,store,assertCurrent(){},readPeer:()=>({...f.peer,pid:123})});owned.receiver=receiver;
 const transport=createReceiverTransport({socketPath:receiverPath,receiverServiceUid:700,identity,verifier:createReceiverReplyVerifier({...identity,publicKey:f.keys.publicKey}),uploadVerifier:createReceiverUploadVerifier({...identity,publicKey:f.keys.publicKey}),assertCurrent(){},readPeer:()=>({uid:700,gid:700,auditSessionId:1,pid:234})});
 const resolvePrincipal=(p:typeof f.peer)=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const});
 const publication=createApprovedPublicationOperations({database:f.database,authorityId:'authority',completion:f.composition,verification:f.operations,receiverIdentity:identity,receiver:transport,clock:f.clock,assertCurrent(){},resolvePrincipal,
 async approve(review){return {version:1,purpose:'completion-publication',authorityId:review.authorityId,challengeId:review.challengeId,uid:review.principal.uid,accountGeneration:review.principal.accountGeneration,auditSessionId:review.principal.auditSessionId,requestSource:review.requestSource,fullReviewHash:hash(publicationReviewBytes(review))};}});owned.publication=publication;
 const application=createApplicationBindingAuthority({database:f.database,authorityId:'authority',completion:f.composition,clock:f.clock,assertCurrent(){},resolvePrincipal,
 async approve(review){return {uid:f.peer.uid,auditSessionId:f.peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});owned.application=application;
 const appRouting=createControllerApplicationRouting({application,assertCurrent(){},async renew(){}}),unused=():never=>{throw Error('unused');};
 const routing=createControllerOperationRouting({assertCurrent(){},async renew(){},publication,verification:f.operations,completion:f.composition.public,execution:{invoke:unused}});
 const socketPath=join(f.root,'controller.sock'),calls:string[]=[];
 const controller=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:f.keys.privateKey,allowedUserIds:[f.peer.uid],acceptPeer:()=>f.peer,
 async invoke(method,payload,peer,signal){calls.push(method);return method.startsWith('application.')?appRouting.invoke(method,payload,peer,signal):routing.invoke(method,payload,peer,signal);}});owned.controller=controller;
 leaf.factory=()=>createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,roundTrip:(bytes,signal)=>callControllerIpc(socketPath,bytes,{signal}),roundTripSync:unused});
 leaf.profile=()=>({kind:'protected',index:parsePublicProfileIndex(JSON.parse(readFileSync(join(f.root,'markers','principals',String(f.peer.uid)+'.json'),'utf8')))});
 ownerLeaf.profileId=f.owner.profileId;
 const publisher=createInstalledCompletionPublisher({ownerKind:f.owner.ownerKind,ownerId:f.owner.ownerId},'user');owned.publisher=publisher;
 ready={f,store,application,publisher,calls};
 }catch(raw){if(!primary)primary={raw};throw raw;}
});

afterAll(async()=>{
 const errors:unknown[]=[];
 // Keep the original order, but a failing close cannot skip its siblings.
 try{owned.publisher?.dispose();}catch(raw){errors.push(raw);}
 try{await owned.controller?.close();}catch(raw){errors.push(raw);}
 try{owned.application?.close();}catch(raw){errors.push(raw);}
 try{await owned.publication?.close();}catch(raw){errors.push(raw);}
 try{await owned.receiver?.close();}catch(raw){errors.push(raw);}
 try{owned.store?.close();}catch(raw){errors.push(raw);}
 try{await owned.f?.close();}catch(raw){errors.push(raw);}
 if(errors.length){
  const failures=primary?[primary.raw,...errors]:errors;
  throw new AggregateError(failures,'loop_publication_fixture_cleanup_failed',{cause:failures[0]});
 }
});

it('reads the original receiver Loop payload then rejects the same historical commit after proof expiry',async()=>{
 try{
  if(!ready)throw Error('loop_publication_fixture_not_ready');
  const {f,store,application,publisher,calls}=ready;
  const active=application.inspect({ownerKind:'loop',ownerId:f.owner.ownerId},f.peer).current!,binding=active.binding as LoopApplicationBinding;
  const original=await publisher.prepareRequest('original-loop-publication');
  const committed=await publisher.approve(original);expect(committed.status).toBe('committed');
  const set=await readCurrentLoopPublicationSet([binding]);expect(set.publications[0]).toMatchObject({owner:f.owner,operationId:committed.operationId,businessRevision:committed.businessRevision,application:active});
  calls.length=0;
  const result=await readCurrentLoopPublishedCandidate(binding),body=JSON.parse(result.bytes.toString());
  expect(result.operationId).toBe(committed.operationId);expect(result.businessRevision).toBe(committed.businessRevision);expect(body.application).toEqual(active);
  expect(Buffer.from(body.evaluations[0].artifacts[0].bytesBase64,'base64').toString()).toBe('result');
  expect(calls.every(method=>['application.inspect','publication.observeOwner','publication.readOwnerPayload'].includes(method))).toBe(true);
  const count=(f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get() as {n:number}).n;
  f.setTime(10000);
  await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow();
  expect(store.readVisible(committed.operationId)).toBeTruthy();
  expect((f.database.prepare('SELECT COUNT(*) n FROM execution_attempts').get() as {n:number}).n).toBe(count);
 }catch(raw){if(!primary)primary={raw};throw raw;}
});
