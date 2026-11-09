import '../../support/installed-controller-fixture.js';
import {it,expect,describe} from 'vitest';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {join} from 'node:path';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {createPublicationClient} from '../../../src/runtime/verification/publication-client.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {encodeControllerResponse} from '../../../src/runtime/verification/controller-response.js';
import {VERIFICATION_BUDGET} from '../../../src/runtime/verification/protocol.js';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {loopPublicationReceiver} from '../../support/loop-publication-receiver.js';

const legacy=256*1024,maximum=(VERIFICATION_BUDGET.rpcBytes-64*1024)/4*3;
const owner={profileId:'profile',ownerKind:'task' as const,ownerId:'task'},H='a'.repeat(64);
const observation=()=>({owner,businessRevision:1,currentVerification:'valid' as const,
 publication:{status:'committed' as const,current:true,operationId:'operation',fullTupleHash:H}});

// Signed remote observations exercise the original client decoder and pager;
// this fixture is not an installed authority or Native qualification.
function signedRemote(advertisement:{present:boolean;value?:unknown}={present:false}){
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const body=Buffer.alloc(1024*1024,97),hash=createHash('sha256').update(body).digest('hex');
 const pages:Array<{offset:number;maxBytes:number}>=[];
 let epoch='epoch',tamper=false,businessFailure:{error:unknown}|undefined,oversized=false;
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey,
  async roundTrip(bytes){
   const request=JSON.parse(bytes.toString());let result:unknown;
   if(request.method!=='controller.identity'&&businessFailure)throw businessFailure.error;
   if(request.method==='controller.identity')result={serviceEpoch:epoch,requestTicket:H,
    ...(advertisement.present?{publicationReadPageBytes:advertisement.value}:{})};
   else if(request.method==='publication.observeOwner')result=observation();
   else if(request.method==='publication.readOwnerPayload'){
    const {offset,maxBytes}=request.payload;pages.push({offset,maxBytes});
    const part=oversized?Buffer.alloc(maxBytes+1,97):body.subarray(offset,offset+maxBytes);
    result={owner,businessRevision:1,operationId:'operation',fullTupleHash:H,payloadHash:hash,
     totalBytes:body.length,offset,bytes:part.toString('base64'),eof:offset+part.length===body.length};
   }else throw Error('unexpected_fixture_method');
   const encoded=encodeControllerResponse({domain:'xiaok.controller.response.v1',authorityId:'authority',
    serviceEpoch:epoch,nonce:request.nonce,method:request.method,requestHash:request.requestHash,result},privateKey);
   if(tamper&&request.method==='controller.identity'){
    const changed=JSON.parse(encoded.toString());changed.payload.result.publicationReadPageBytes=legacy;
    return Buffer.from(JSON.stringify(changed));
   }
   return encoded;
  },roundTripSync(){throw Error('unused_sync');}});
 return {client,pages,body,publication:createPublicationClient({owner,requestSource:'agent',transport:client.publicationTransport}),
  setEpoch(value:string){epoch=value;},tamper(){tamper=true;},
  failBusiness(error:unknown){businessFailure={error};},oversize(){oversized=true;}};
}

it('uses authenticated advertised pages through the original signed client and pager',async()=>{
 const remote=signedRemote({present:true,value:maximum});
 try{
  const result=await remote.publication.readPayload(await remote.publication.observe());
  expect(result.bytes).toEqual(remote.body);
  expect(remote.pages).toEqual([{offset:0,maxBytes:maximum},{offset:maximum,maxBytes:maximum}]);
 }finally{remote.client.dispose();}
});

it.each([false,true])('keeps the old server %s legacy-page contract',async explicit=>{
 const remote=signedRemote({present:explicit,value:legacy});
 try{
  expect((await remote.publication.readPayload(await remote.publication.observe())).bytes).toEqual(remote.body);
  expect(remote.pages.map(page=>page.maxBytes)).toEqual([legacy,legacy,legacy,legacy]);
 }finally{remote.client.dispose();}
});

it('captures each requested limit before the authenticated hello can update metadata',async()=>{
 const remote=signedRemote({present:true,value:maximum});
 try{
  expect((await remote.publication.readPayload(observation())).bytes).toEqual(remote.body);
  expect(remote.pages).toEqual([{offset:0,maxBytes:legacy},{offset:legacy,maxBytes:maximum},
   {offset:legacy+maximum,maxBytes:maximum}]);
 }finally{remote.client.dispose();}
});

it.each([null,'737280',0,maximum+1])('rejects unsupported signed page metadata before business work: %s',async value=>{
 const remote=signedRemote({present:true,value});
 try{
  await expect(remote.publication.observe()).rejects.toThrow('controller_publication_page_limit');
  expect(remote.pages).toEqual([]);
 }finally{remote.client.dispose();}
});

it('does not consult inherited metadata accessors on a legacy signed identity',async()=>{
 const key='publicationReadPageBytes',prior=Object.getOwnPropertyDescriptor(Object.prototype,key);
 const define=Object.defineProperty;let calls=0;
 const remote=signedRemote();
 try{
  define(Object.prototype,key,{configurable:true,get(){calls++;throw Error('inherited_metadata_getter');}});
  expect((await remote.publication.readPayload(await remote.publication.observe())).bytes).toEqual(remote.body);
  expect(remote.pages).toHaveLength(4);expect(calls).toBe(0);
 }finally{
  if(prior)define(Object.prototype,key,prior);else delete (Object.prototype as any)[key];
  remote.client.dispose();
 }
});

it('does not transfer another actual client metadata through a matching transport shape',async()=>{
 const advertised=signedRemote({present:true,value:maximum}),old=signedRemote();
 try{
  await advertised.publication.observe();await old.publication.observe();
  expect((await advertised.publication.readPayload(observation())).bytes).toEqual(advertised.body);
  expect(advertised.pages.map(page=>page.maxBytes)).toEqual([maximum,maximum]);
  advertised.pages.length=0;
  const wrapper={call:advertised.client.publicationTransport.call.bind(advertised.client.publicationTransport)};
  const unbranded=createPublicationClient({owner,requestSource:'agent',transport:wrapper});
  expect((await unbranded.readPayload(observation())).bytes).toEqual(advertised.body);
  expect(advertised.pages.map(page=>page.maxBytes)).toEqual([legacy,legacy,legacy,legacy]);
  expect((await old.publication.readPayload(observation())).bytes).toEqual(old.body);
  expect(old.pages.map(page=>page.maxBytes)).toEqual([legacy,legacy,legacy,legacy]);
 }finally{advertised.client.dispose();old.client.dispose();}
});

it('rejects an oversized signed page under the unchanged frame cap without a legacy retry',async()=>{
 const remote=signedRemote({present:true,value:maximum});
 try{
  const observed=await remote.publication.observe();remote.oversize();
  await expect(remote.publication.readPayload(observed)).rejects.toThrow('publication_client_payload_page');
  expect(remote.pages).toEqual([{offset:0,maxBytes:maximum}]);
 }finally{remote.client.dispose();}
});

it.each(['undefined','unknown'] as const)('preserves the original %s failure without negotiating a retry',async mode=>{
 const remote=signedRemote({present:true,value:maximum});
 const original=mode==='undefined'?undefined:Error('controller_ipc_timeout_unknown');
 let rejected=false,caught:unknown;
 try{
  const observed=await remote.publication.observe();remote.failBusiness(original);
  try{await remote.publication.readPayload(observed);}catch(error){rejected=true;caught=error;}
  expect(rejected).toBe(true);expect(caught).toBe(original);expect(remote.pages).toEqual([]);
 }finally{remote.client.dispose();}
});

it('does not let metadata bypass response signatures or an invalidated service epoch',async()=>{
 const forged=signedRemote({present:true,value:maximum}),changed=signedRemote({present:true,value:maximum});
 try{
  forged.tamper();await expect(forged.publication.observe()).rejects.toThrow('controller_response_signature');
  expect(forged.pages).toEqual([]);
  await changed.publication.observe();changed.setEpoch('other');
  await expect(changed.publication.observe()).rejects.toThrow('controller_instance_changed');
  await expect(changed.publication.readPayload(observation())).rejects.toThrow();
  expect(changed.pages).toEqual([]);
 }finally{forged.client.dispose();changed.client.dispose();}
});

it('serializes the real maximum signed page below the unchanged RPC cap and rejects overflow',()=>{
 const {privateKey}=generateKeyPairSync('ed25519');
 const page={owner:{profileId:'"'.repeat(160),ownerKind:'task',ownerId:'\\'.repeat(160)},
  businessRevision:Number.MAX_SAFE_INTEGER,operationId:'"'.repeat(160),fullTupleHash:H,payloadHash:H,
  totalBytes:32*1024**2,offset:32*1024**2-maximum,bytes:Buffer.alloc(maximum,97).toString('base64'),eof:true};
 const payload={domain:'xiaok.controller.response.v1',authorityId:'a'.repeat(160),serviceEpoch:'e'.repeat(160),
  nonce:H,method:'publication.readOwnerPayload',requestHash:H,result:page};
 const encoded=encodeControllerResponse(payload,privateKey);
 expect(encoded.length).toBeLessThanOrEqual(VERIFICATION_BUDGET.rpcBytes);
 expect(JSON.parse(encoded.toString()).payload.result.bytes).toHaveLength(983040);
 expect(()=>encodeControllerResponse({...payload,result:{...page,bytes:Buffer.alloc(maximum+64*1024,97).toString('base64')}},privateKey))
  .toThrow('controller_response_essential_limit');
});

type F=Awaited<ReturnType<typeof verifiedOperationFixture>>;
type Receiver=Awaited<ReturnType<typeof loopPublicationReceiver>>;
const retainedFixtures=new Set<object>();
type FixtureInventory={f?:F;receiver?:Receiver;failure?:{error:unknown};work?:Promise<void>;
 server?:Awaited<ReturnType<typeof startPublicController>>;client?:ReturnType<typeof createAuthenticatedControllerClient>;
 cleanupErrors:unknown[]};
async function withActualPublication(work:(f:F,receiver:Receiver,held:FixtureInventory)=>Promise<void>){
 const held:FixtureInventory={cleanupErrors:[]};retainedFixtures.add(held);
 let primary:{error:unknown}|undefined;const failures=held.cleanupErrors;
 try{
  held.f=await verifiedOperationFixture('large-artifact');
  held.receiver=await loopPublicationReceiver(held.f);
  const prepared=held.receiver.publication.prepare({ownerKind:held.f.owner.ownerKind,ownerId:held.f.owner.ownerId,requestSource:'user'},held.f.peer);
  await held.receiver.publication.approve({challengeId:prepared.challengeId},held.f.peer,new AbortController().signal);
  held.work=work(held.f,held.receiver,held);await held.work;
 }catch(error){primary={error};held.failure=primary;}
 finally{
  if(held.receiver)try{await held.receiver.close();}catch(error){failures.push(error);}
  if(held.f)try{await held.f.close();}catch(error){failures.push(error);}
  if(!primary&&!failures.length)retainedFixtures.delete(held);
 }
 if(failures.length)throw new AggregateError([...(primary?[primary.error]:[]),...failures],'publication_page_fixture_cleanup_unknown',{cause:primary?.error});
 if(primary)throw primary.error;
}

describe.skipIf(process.platform==='win32')('actual publication authority and peer-authenticated public IPC',()=>{
 it('negotiates one larger page while executing the original live authority and payload checks',async()=>{
  await withActualPublication(async(f,receiver,held)=>{
   let server:Awaited<ReturnType<typeof startPublicController>>|undefined;
   let client:ReturnType<typeof createAuthenticatedControllerClient>|undefined;
   let primary:{error:unknown}|undefined;const failures:unknown[]=[],sizes:number[]=[];
   try{
    const socketPath=join(f.root,'page-size-public.sock');
    server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'epoch',privateKey:f.keys.privateKey,
     allowedUserIds:[f.peer.uid],acceptPeer:()=>f.peer,async invoke(method,payload,peer,signal){
      if(method==='publication.observeOwner')return receiver.publication.observeOwner(payload,peer,signal);
      if(method==='publication.readOwnerPayload'){sizes.push((payload as any).maxBytes);return receiver.publication.readOwnerPayload(payload,peer,signal);}
      throw Error('unexpected_actual_method');}});
    held.server=server;
    client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,
     roundTrip:(bytes,signal)=>callControllerIpc(socketPath,bytes,{signal}),roundTripSync(){throw Error('unused_sync');}});
    held.client=client;
    const publication=createPublicationClient({owner:f.owner,requestSource:'agent',transport:client.publicationTransport});
    const result=await publication.readPayload(await publication.observe());
    expect(result.bytes.length).toBeGreaterThan(legacy);expect(result.bytes.length).toBeLessThan(maximum);
    expect(sizes).toEqual([maximum]);
    expect(createHash('sha256').update(result.bytes).digest('hex')).toBe(result.payloadHash);
   }catch(error){primary={error};}
   finally{
    if(client)try{client.dispose();}catch(error){failures.push(error);}
    if(server)try{await server.close();}catch(error){failures.push(error);}
   }
   if(failures.length)throw new AggregateError([...(primary?[primary.error]:[]),...failures],'publication_page_public_cleanup_unknown',{cause:primary?.error});
   if(primary)throw primary.error;
  });
 },60000);

 it('preserves old requested bounds, accepts the new bound and denies overflow or expired state',async()=>{
  await withActualPublication(async(f,receiver)=>{
   const signal=new AbortController().signal,observed=await receiver.publication.observeOwner({ownerKind:f.owner.ownerKind,ownerId:f.owner.ownerId},f.peer,signal);
   if(observed.publication.status!=='committed')throw Error('actual_publication_required');
   const request={ownerKind:f.owner.ownerKind,ownerId:f.owner.ownerId,operationId:observed.publication.operationId,
    fullTupleHash:observed.publication.fullTupleHash,offset:0,maxBytes:legacy};
   const old=await receiver.publication.readOwnerPayload(request,f.peer,signal);
   expect(Buffer.from(old.bytes,'base64')).toHaveLength(legacy);expect(old.eof).toBe(false);
   const large=await receiver.publication.readOwnerPayload({...request,maxBytes:maximum},f.peer,signal);
   expect(Buffer.from(large.bytes,'base64').length).toBeGreaterThan(legacy);expect(large.eof).toBe(true);
   await expect(receiver.publication.readOwnerPayload({...request,maxBytes:maximum+1},f.peer,signal)).rejects.toThrow('publication_payload_request');
   f.setTime(999999);
   await expect(receiver.publication.readOwnerPayload({...request,maxBytes:maximum},f.peer,signal)).rejects.toThrow(/publication_payload_not_current|publication_operation_not_current/);
  });
 },60000);
});
