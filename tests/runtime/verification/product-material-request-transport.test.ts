import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {join} from 'node:path';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {authorizeProductValidationMaterials,consumeProductValidationMaterials} from '../../../src/runtime/verification/product-material-authorization.js';

it('uses one durable material request through the actual signed client and refuses a repeated native approval',async()=>{
 const f=await verifiedOperationFixture('loop-application'),socketPath=join(f.root,'product-material.sock'),phases:string[]=[];let approvals=0;
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:f.keys.privateKey,allowedUserIds:[f.peer.uid],acceptPeer:()=>f.peer,async invoke(method,payload:any,peer,signal){
  if(method==='materials.prepareRequest'){expect(phases.at(-1)).toBe('prepare');return f.material.prepareRequest(payload,peer,signal);}
  if(method==='materials.authorize'){expect(phases.at(-1)).toBe('authorize');approvals++;return f.material.authorize(payload.challengeId,peer,signal);}
  if(method==='materials.stage'){expect(phases.at(-1)).toBe('stage');return f.material.stage(payload,peer,signal);}
  throw Error('unexpected legacy or execution method');
 }});
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,roundTrip:(bytes,signal)=>callControllerIpc(socketPath,bytes,{signal}),roundTripSync(){throw Error('unused');}});
 const date=vi.spyOn(Date,'now').mockReturnValue(100000);
 try{
  const draft={purpose:'isolated-command' as const,invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:104999};
  const input={requestSource:'user' as const,draft,client:client.materialAuthorization,request:{requestId:'original-product-request',async beforeStep(step:any){phases.push(step.phase);expect(step.draft).toEqual(draft);}},async review(){},assertCurrent(){}};
  const authorized=await authorizeProductValidationMaterials(input),plan=consumeProductValidationMaterials(authorized);
  expect(plan.invocation).toEqual(draft.invocation);expect(phases).toEqual(['prepare','authorize','stage']);expect(approvals).toBe(1);
  expect(f.material.lookupRequest({requestId:input.request.requestId,invocation:draft.invocation},f.peer)).toMatchObject({state:'mapped',challengePhase:'staged'});
  await expect(authorizeProductValidationMaterials(input)).rejects.toThrow('validation_material_request_not_fresh');expect(approvals).toBe(1);
  expect(f.database.prepare('SELECT COUNT(*) n FROM material_authority_requests WHERE request_id=?').get(input.request.requestId)).toEqual({n:1});
 }finally{date.mockRestore();client.dispose();await server.close();await f.close();}
});
