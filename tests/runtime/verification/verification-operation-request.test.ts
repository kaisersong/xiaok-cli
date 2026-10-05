import '../../support/installed-controller-fixture.js';
import {it,expect} from 'vitest';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
const signal=()=>new AbortController().signal;
async function setup(onQualified?:()=>void|Promise<void>){
 const f=await verifiedOperationFixture('loop-application',{onQualified});
 const invocation={sessionIdentity:'request-session',compoundOperationId:'request-operation',validationInvocationId:'request-validation'};
 const registration=JSON.parse((f.database.prepare('SELECT registration_json FROM owner_enrollment_intents').get() as {registration_json:string}).registration_json);
 const challenge=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{ownerKind:f.owner.ownerKind,ownerId:f.owner.ownerId,invocations:[invocation]},registration},f.peer) as {challengeId:string};
 await f.composition.public.invoke('completion.authorize-owner',{challengeId:challenge.challengeId},f.peer);
 const materials=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal());
 const grant=await f.material.authorize(materials.challengeId,f.peer,signal()),staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal());
 const query={requestId:'original-request',invocation,obligationId:'original'},request={...query,expectedAttemptEpoch:1,requestSource:'user',mountPlanHandle:staged.mountPlanHandle};
 return {...f,query,request,authorizationId:materials.challengeId,api:f.operations};
}
it('maps the actual prepared operation to the original request without reissuing a private handle',async()=>{const f=await setup();try{
 expect(f.api.lookupRequest(f.query,f.peer)).toMatchObject({state:'absent'});
 const prepared=await f.api.prepareRequest(f.request,f.peer,signal());expect(prepared.created).toBe(true);if(!prepared.created)throw Error('fresh request required');expect(prepared.operationHandle.id).toBeTruthy();
 const observation=f.api.lookupRequest(f.query,f.peer);expect(observation).toMatchObject({state:'operation',owner:f.owner,operation:{id:prepared.operationHandle.id,state:'prepared',attemptId:prepared.attemptId}});
 const repeated=await f.api.prepareRequest(f.request,f.peer,signal());expect(repeated).toEqual({created:false,observation});expect(repeated).not.toHaveProperty('operationHandle');
 expect(f.database.prepare('SELECT count(*) n FROM verification_operations').get()).toEqual({n:2});
 }finally{await f.close();}});
it('absent recovery leaves a durable tombstone that rejects late original preparation',async()=>{const f=await setup();try{
 expect(f.api.retireRequest({...f.query,requestSource:'scheduler'},f.peer)).toMatchObject({state:'not_prepared'});
 await expect(f.api.prepareRequest(f.request,f.peer,signal())).rejects.toThrow('verification_request_retired');
 expect(f.material.inspectMountPlanHandoff({authorizationId:f.authorizationId},f.peer)).toMatchObject({state:'unclaimed'});
 expect(f.database.prepare('SELECT count(*) n FROM verification_operations').get()).toEqual({n:1});
 }finally{await f.close();}});
it('retires an actual in-flight prepare before its reservation transaction and preserves claimed material',async()=>{
 let gate:Promise<void>|undefined,enter:(()=>void)|undefined,release:(()=>void)|undefined;
 const f=await setup(()=>{enter?.();return gate;});
 try{const entered=new Promise<void>(resolve=>{enter=resolve;});gate=new Promise<void>(resolve=>{release=resolve;});
 const pending=f.api.prepareRequest(f.request,f.peer,signal());void pending.catch(()=>{});await entered;
 expect(f.api.lookupRequest(f.query,f.peer)).toMatchObject({state:'preparing'});
 expect(f.api.retireRequest({...f.query,requestSource:'user'},f.peer)).toMatchObject({state:'retired'});
 release!();await expect(pending).rejects.toThrow('verification_request_retired');
 expect(f.database.prepare('SELECT count(*) n FROM verification_operations').get()).toEqual({n:1});
 expect(f.database.prepare('SELECT count(*) n FROM execution_attempts').get()).toEqual({n:1});
 expect(f.material.inspectMountPlanHandoff({authorizationId:f.authorizationId},f.peer)).toMatchObject({state:'claimed'});
 }finally{release?.();await f.close();}
});
it.each(['epoch','source','handle','foreign','agent-retire'] as const)('rejects %s request misuse',async mode=>{const f=await setup();try{
 await f.api.prepareRequest(f.request,f.peer,signal());
 if(mode==='agent-retire')expect(()=>f.api.retireRequest({...f.query,requestSource:'agent'},f.peer)).toThrow();
 else if(mode==='foreign')expect(()=>f.api.lookupRequest(f.query,{...f.peer,uid:502})).toThrow();
 else {const changed={...f.request,...(mode==='epoch'?{expectedAttemptEpoch:2}:mode==='source'?{requestSource:'scheduler'}:{mountPlanHandle:{...f.request.mountPlanHandle,secret:'b'.repeat(64)}})};await expect(f.api.prepareRequest(changed,f.peer,signal())).rejects.toThrow('verification_request_changed');}
 }finally{await f.close();}});

import {join} from 'node:path';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
it('uses the original signed controller for prepare, lookup and retirement without returning duplicate execution authority',async()=>{const f=await setup(),socketPath=join(f.root,'request.sock');const unused=():never=>{throw Error('unused');};let renewals=0;
 const routing=createControllerOperationRouting({assertCurrent(){},async renew(){renewals++;},verification:f.operations,completion:f.composition.public,publication:{prepare:unused,approve:unused,reconcile:unused,recoverExpired:unused,observeOwner:unused,readOwnerPayload:unused},execution:{invoke:unused}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:f.keys.privateKey,allowedUserIds:[f.peer.uid],acceptPeer:()=>f.peer,invoke:routing.invoke});
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,roundTrip:(bytes,signal)=>callControllerIpc(socketPath,bytes,{signal}),roundTripSync:unused});
 try{const first=await client.verificationTransport.call('verification.prepareRequest',f.request) as any;expect(first.created).toBe(true);
 const observation=await client.verificationTransport.call('verification.lookupRequest',f.query);expect(observation).toMatchObject({state:'operation',operation:{id:first.operationHandle.id}});
 expect(await client.verificationTransport.call('verification.prepareRequest',f.request)).toEqual({created:false,observation});
 expect(await client.verificationTransport.call('verification.retireRequest',{...f.query,requestSource:'scheduler'})).toEqual(observation);expect(renewals).toBe(2);
 await expect(client.verificationTransport.call('verification.retireRequest',{...f.query,requestSource:'agent'})).rejects.toThrow('verification_request_retire_source');
 }finally{client.dispose();await server.close();await f.close();}
});
it.each(['ignore','tamper'] as const)('request mapping %s rolls back the original run, raw, attempt and operation together',async mode=>{const f=await setup();try{
 const before=f.database.prepare('SELECT attempt_epoch FROM mandatory_observation_checks WHERE obligation_id=?').get('original');
 f.database.exec(mode==='ignore'?"CREATE TRIGGER request_fault BEFORE UPDATE ON verification_prepare_requests BEGIN SELECT RAISE(IGNORE); END":"CREATE TRIGGER request_fault AFTER UPDATE ON verification_prepare_requests BEGIN UPDATE verification_prepare_requests SET operation_id='wrong-operation' WHERE request_id=NEW.request_id; END");
 await expect(f.api.prepareRequest(f.request,f.peer,signal())).rejects.toThrow('verification_request_commit');
 expect(f.database.prepare('SELECT count(*) n FROM verification_operations').get()).toEqual({n:1});expect(f.database.prepare('SELECT count(*) n FROM execution_attempts').get()).toEqual({n:1});expect(f.database.prepare('SELECT attempt_epoch FROM mandatory_observation_checks WHERE obligation_id=?').get('original')).toEqual(before);
 expect(f.api.lookupRequest(f.query,f.peer)).toMatchObject({state:'preparing'});expect(f.material.inspectMountPlanHandoff({authorizationId:f.authorizationId},f.peer)).toMatchObject({state:'claimed'});
 }finally{await f.close();}});
it('rejects a registered but different invocation for the consumed material without creating an operation',async()=>{const f=await setup();try{
 await expect(f.api.prepareRequest({...f.request,invocation:{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'}},f.peer,signal())).rejects.toThrow('verification_request_material');
 expect(f.database.prepare('SELECT count(*) n FROM verification_operations').get()).toEqual({n:1});expect(f.material.inspectMountPlanHandoff({authorizationId:f.authorizationId},f.peer)).toMatchObject({state:'claimed'});
 }finally{await f.close();}});
it('does not consume material when the original request intent was not actually inserted',async()=>{const f=await setup();try{
 f.database.exec("CREATE TRIGGER request_fault BEFORE INSERT ON verification_prepare_requests BEGIN SELECT RAISE(IGNORE); END");
 await expect(f.api.prepareRequest(f.request,f.peer,signal())).rejects.toThrow('verification_request_commit');expect(f.api.lookupRequest(f.query,f.peer)).toMatchObject({state:'absent'});
 expect(f.material.inspectMountPlanHandoff({authorizationId:f.authorizationId},f.peer)).toMatchObject({state:'unclaimed'});
 }finally{await f.close();}});
it('rejects a raw journal change at the final request mapping write and rolls back the complete reservation',async()=>{const f=await setup();try{
 f.database.exec("CREATE TRIGGER request_fault AFTER UPDATE ON verification_prepare_requests BEGIN UPDATE execution_attempts SET state='unknown' WHERE session_id='request-session'; END");
 await expect(f.api.prepareRequest(f.request,f.peer,signal())).rejects.toThrow('docker_reservation_handoff_changed');
 expect(f.database.prepare('SELECT count(*) n FROM execution_attempts').get()).toEqual({n:1});expect(f.api.lookupRequest(f.query,f.peer)).toMatchObject({state:'preparing'});
 expect(f.material.inspectMountPlanHandoff({authorizationId:f.authorizationId},f.peer)).toMatchObject({state:'claimed'});
 }finally{await f.close();}});
it('does not treat a missing request association as absent while its real operation still exists',async()=>{const f=await setup();try{
 await f.api.prepareRequest(f.request,f.peer,signal());f.database.prepare('DELETE FROM verification_prepare_requests WHERE request_id=?').run(f.query.requestId);
 expect(()=>f.api.lookupRequest(f.query,f.peer)).toThrow('verification_request_association');expect(()=>f.api.retireRequest({...f.query,requestSource:'scheduler'},f.peer)).toThrow('verification_request_association');
 await expect(f.api.prepareRequest(f.request,f.peer,signal())).rejects.toThrow('verification_request_association');expect(f.database.prepare('SELECT count(*) n FROM verification_operations').get()).toEqual({n:2});
 }finally{await f.close();}});
