import {it,expect} from 'vitest';import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {authorizeOwnerEnrollment} from '../../../src/runtime/verification/owner-enrollment-authorization.js';
const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
function review(){const recipe={kind:'artifact-content',checks:[{id:'content',path:'result',sha256:'a'.repeat(64),structure:'utf8'}]};return {version:1,purpose:'completion-owner-enrollment',authorityId:'authority',challengeId:'c',principal:{uid:501,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',auditSessionId:7},profileSlot:'default',enrollment:{ownerKind:'task',ownerId:'t',invocations:[{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'}]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'o',predicateId:'p',predicateVersion:'1',semantics:'current-subject',definitionHash:hash(json(recipe)),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner'}},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:1500}};}
it('requires current account generation and original continuous deadline before and after full native review',async()=>{
 let now=1100,approved=0,account=review().principal.accountGeneration;
 const options={authorityId:'authority',allowedUserIds:[501],signal:new AbortController().signal,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:now,upperBound:now,evidenceHash:'a'.repeat(64)}),resolveAccount:async()=>account,approve:async(input:any)=>{approved++;expect(input.reviewBytes.toString()).toBe(json(review()));return hash(input.reviewBytes.toString());}};
 const result=await authorizeOwnerEnrollment(review(),options);expect(result).toEqual({uid:501,auditSessionId:7,reviewHash:hash(json(review()))});expect(approved).toBe(1);
 account='22222222-AAAA-BBBB-CCCC-555555555555';await expect(authorizeOwnerEnrollment(review(),options)).rejects.toThrow('enrollment_account_changed');expect(approved).toBe(1);account=review().principal.accountGeneration;
 await expect(authorizeOwnerEnrollment(review(),{...options,approve:async()=>{now=1500;return hash(json(review()));}})).rejects.toThrow('enrollment_deadline');
 now=1100;await expect(authorizeOwnerEnrollment(review(),{...options,approve:async()=>{account='22222222-AAAA-BBBB-CCCC-555555555555';return hash(json(review()));}})).rejects.toThrow('enrollment_account_changed');
});
it('rejects a different authority, purpose or native output rather than interpreting it as approval',async()=>{
 const r=review(),options={authorityId:'authority',allowedUserIds:[501],signal:new AbortController().signal,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1100,upperBound:1100,evidenceHash:'a'.repeat(64)}),resolveAccount:async()=>r.principal.accountGeneration,approve:async()=> 'b'.repeat(64)};
 await expect(authorizeOwnerEnrollment(r,options)).rejects.toThrow('enrollment_approval_unknown');await expect(authorizeOwnerEnrollment({...r,authorityId:'other'},options)).rejects.toThrow('enrollment_authority');await expect(authorizeOwnerEnrollment({...r,purpose:'materials'},options)).rejects.toThrow();
});
