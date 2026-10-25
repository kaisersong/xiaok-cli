import {it,expect} from 'vitest';
import {parseVerificationOperationPrepareRequest,parseVerificationOperationRetireRequest,parseVerificationOperationRequestObservation} from '../../../src/runtime/verification/verification-operation-request.js';
const query={requestId:'request',invocation:{sessionIdentity:'session',compoundOperationId:'operation',validationInvocationId:'validation'},obligationId:'original'};
const owner={profileId:'profile',ownerKind:'loop',ownerId:'loop'};
it('does not evaluate caller getters while capturing a fresh request',()=>{let reads=0;const request={...query,requestSource:'user',expectedAttemptEpoch:0,get mountPlanHandle(){reads++;return {id:'plan',secret:'a'.repeat(64)};}};expect(()=>parseVerificationOperationPrepareRequest(request)).toThrow();expect(reads).toBe(0);});
it.each(['agent','system','USER',null])('does not grant retirement to %s',requestSource=>{expect(()=>parseVerificationOperationRetireRequest({...query,requestSource})).toThrow('verification_request_retire_source');});
it('rejects private handles and a mismatched execution invocation in observed history',()=>{
 const operation={id:'operation',state:'prepared',attemptId:'attempt',expected:{...query.invocation,executionIdentity:'execution',scopeDigest:'a'.repeat(64)}};
 expect(()=>parseVerificationOperationRequestObservation({...query,owner,state:'operation',operation:{...operation,secret:'a'.repeat(64)}})).toThrow();
 expect(()=>parseVerificationOperationRequestObservation({...query,owner,state:'operation',operation:{...operation,expected:{...operation.expected,validationInvocationId:'other'}}})).toThrow('verification_request_execution');
 const observed=parseVerificationOperationRequestObservation({...query,owner,state:'operation',operation});expect(Object.isFrozen(observed)).toBe(true);if(observed.state==='operation')expect(Object.isFrozen(observed.operation.expected)).toBe(true);
});
