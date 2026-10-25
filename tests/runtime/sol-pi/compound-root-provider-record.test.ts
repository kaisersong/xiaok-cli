import {it,expect} from 'vitest';
import {createCompoundOperationLedger} from '../../../src/runtime/sol-pi/compound-operation.js';
import {reserveProviderAttempt,validateProviderAttempt} from '../../../src/runtime/sol-pi/compound-provider-attempt.js';
it('records an explicit root authorization instead of inventing a parent operation',()=>{
 const input={issuerIncarnation:'issuer',logicalInvocationId:'request',attemptIndex:0 as const,serializedBodySha256:'a'.repeat(64),destination:{provider:'test',model:'test',url:'https://example.test/messages'},closureDigest:'b'.repeat(64),rootAdmission:{rootSessionIdentity:'root',authorizationId:'host-authorization',generation:1}};
 const result=reserveProviderAttempt(createCompoundOperationLedger(),'root',input);
 expect(result.ledger.providerAttempts![0]).toMatchObject({rootAdmission:input.rootAdmission,transportState:'reserved'});expect(result.ledger.providerAttempts![0]).not.toHaveProperty('parentAdmission');
 expect(()=>validateProviderAttempt({...result.ledger.providerAttempts![0],parentAdmission:{parentSessionIdentity:'fake',parentOperationId:'fake',generation:1}})).toThrow();
 expect(()=>reserveProviderAttempt(createCompoundOperationLedger(),'other',input)).toThrow();
 expect(()=>reserveProviderAttempt(createCompoundOperationLedger(),'root',{...input,rootAdmission:{...input.rootAdmission,generation:0}})).toThrow();
});
