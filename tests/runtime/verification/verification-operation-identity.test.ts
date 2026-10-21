import {it,expect} from 'vitest';
import {verificationRequestFixture} from '../../support/verification-request-fixture.js';
it('actual prepared operation and raw execution have distinct IDs while its material attachment is already atomic',async()=>{
 const f=await verificationRequestFixture();try{
 const prepared=await f.operations.prepareRequest(f.request,f.peer,new AbortController().signal);expect(prepared.created).toBe(true);if(!prepared.created)throw Error('fixture fresh');const observed=f.operations.lookupRequest(f.query,f.peer);expect(observed.state).toBe('operation');if(observed.state!=='operation')throw Error('fixture operation');
 expect(observed.operation.id).toBe(prepared.operationHandle.id);expect(observed.operation.expected.executionIdentity).not.toBe(observed.operation.id);
 const attached=f.material.inspectMountPlanHandoff({authorizationId:f.authorizationId},f.peer);expect(attached.state).toBe('attached');if(attached.state!=='attached')throw Error('fixture attachment');expect(attached.expected).toEqual(observed.operation.expected);expect(attached.invocation).toEqual(f.query.invocation);
 }finally{await f.close();}
});
