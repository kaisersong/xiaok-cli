import {it,expect} from 'vitest';
import {join} from 'node:path';
import {verificationRequestFixture} from '../../support/verification-request-fixture.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
it.each(['cancel','dispatch'] as const)('recovers the original request through actual signed routing and fixed client: %s',async mode=>{const f=await verificationRequestFixture(),socketPath=join(f.root,'recovery.sock'),unused=():never=>{throw Error('unused');};let renewals=0;
 const routing=createControllerOperationRouting({assertCurrent(){},async renew(){renewals++;},verification:f.operations,completion:f.composition.public,publication:{prepare:unused,approve:unused,reconcile:unused,recoverExpired:unused,observeOwner:unused,readOwnerPayload:unused},execution:{invoke:unused}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:f.keys.privateKey,allowedUserIds:[f.peer.uid],acceptPeer:()=>f.peer,invoke:routing.invoke});
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,roundTrip:(bytes,signal)=>callControllerIpc(socketPath,bytes,{signal}),roundTripSync:unused});
 try{const prepared=await client.verificationTransport.call('verification.prepareRequest',f.request) as {operationHandle:{id:string;secret:string}};
 if(mode==='dispatch'){
  const completed=await client.verificationTransport.call('verification.dispatch',{operationHandle:prepared.operationHandle}) as any;
  const result=await client.verificationTransport.call('verification.lookupRequest',f.query);
  expect(result).toMatchObject({state:'operation',operation:{id:prepared.operationHandle.id,state:'terminal',terminalResult:{attemptId:completed.attemptId,sourceRun:completed.sourceRun,verificationAtCompletion:completed.currentVerification}}});
  expect(await client.verificationTransport.call('verification.recoverRequest',{...f.query,requestSource:'scheduler'})).toEqual(result);
  return;
 }
 const result=await client.verificationTransport.call('verification.recoverRequest',{...f.query,requestSource:'scheduler'});expect(result).toMatchObject({state:'operation',operation:{id:prepared.operationHandle.id,state:'cancelled'}});
 expect(await client.verificationTransport.call('verification.recoverRequest',{...f.query,requestSource:'user'})).toEqual(result);expect(result).not.toHaveProperty('operationHandle');expect(renewals).toBe(1);
 await expect(client.verificationTransport.call('verification.recoverRequest',{...f.query,requestSource:'agent'})).rejects.toThrow('verification_request_retire_source');
 await expect(client.verificationTransport.call('verification.dispatch',{operationHandle:prepared.operationHandle})).rejects.toThrow('controller_operation_rejected');
 }finally{client.dispose();await server.close();await f.close();}
});
