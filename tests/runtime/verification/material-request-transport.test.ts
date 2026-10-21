import '../../support/installed-controller-fixture.js';
import {it,expect} from 'vitest';
import {join} from 'node:path';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
it('carries real material request history across signed transport without recreating a native challenge',async()=>{
 const f=await verifiedOperationFixture('loop-application'),socketPath=join(f.root,'materials.sock');let malformed=false;
 const invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},query={requestId:'materials-request',invocation};
 const request={requestId:query.requestId,requestSource:'user',draft:{purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:104999}};
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:f.keys.privateKey,allowedUserIds:[f.peer.uid],acceptPeer:()=>f.peer,async invoke(method,payload,peer,signal){
  if(method==='materials.prepareRequest')return f.material.prepareRequest(payload,peer,signal);
  if(method==='materials.lookupRequest'){const result=f.material.lookupRequest(payload,peer);return malformed?{...result,requestId:'wrong-request'}:result;}
  if(method==='materials.retireRequest')return f.material.retireRequest(payload,peer);
  throw Error('unexpected method');
 }});
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,roundTrip:(bytes,signal)=>callControllerIpc(socketPath,bytes,{signal}),roundTripSync(){throw Error('unexpected sync');}});
 try{
  expect(await client.materialRequestTransport.call('materials.lookupRequest',query)).toMatchObject({state:'absent'});
  const first=await client.materialRequestTransport.call('materials.prepareRequest',request) as {created:boolean;challengeId:string};expect(first.created).toBe(true);
  const again=await client.materialRequestTransport.call('materials.prepareRequest',request);expect(again).toMatchObject({created:false,challengeId:first.challengeId});expect(again).not.toHaveProperty('canonicalReview');
  malformed=true;await expect(client.materialRequestTransport.call('materials.lookupRequest',query)).rejects.toThrow('material_request_binding');malformed=false;
  expect(await client.materialRequestTransport.call('materials.retireRequest',{...query,requestSource:'scheduler'})).toMatchObject({state:'retired',challengePhase:'prepared'});
  await expect(client.materialRequestTransport.call('materials.prepareRequest',request)).rejects.toThrow('controller_operation_rejected');
  await expect(client.materialRequestTransport.call('materials.retireRequest',{...query,requestSource:'agent'})).rejects.toThrow('material_request_source');
  expect(f.database.prepare('SELECT count(*) n FROM material_authority_requests').get()).toEqual({n:1});
 }finally{client.dispose();await server.close();await f.close();}
});
