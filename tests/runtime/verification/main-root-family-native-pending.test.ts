import {it, expect} from 'vitest';
import {authorizeMainRootFamilyEnrollmentPending} from '../../../src/runtime/verification/main-root-family-enrollment-authorization.js';
import {mainRootFamilyReviewHash, mainRootFamilyReviewBytes, mainRootFamilyTargets, parseMainRootFamilyEnrollmentReview} from '../../../src/runtime/verification/main-root-family-enrollment-data.js';
const review=()=>parseMainRootFamilyEnrollmentReview({version:1,purpose:'main-root-family-enrollment',authorizationScope:'pending-only',authorityId:'authority',operationId:'operation',challengeId:'challenge',profileId:'profile',principal:{uid:501,gid:20,auditSessionId:7,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555'},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:2000},targets:mainRootFamilyTargets()});
function fixture(){
  const body=review();let count=0,unknown=0,now=1000,account=body.principal.accountGeneration;
  let approve:(input:any)=>Promise<string>=async()=>mainRootFamilyReviewHash(body);
  const options={authorityId:'authority',allowedUserIds:[501],signal:new AbortController().signal,
    clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:now,upperBound:now+1,evidenceHash:'a'.repeat(64)}),
    resolveAccount:async()=>account,approve:async(input:any)=>{count++;expect(input.reviewBytes.equals(mainRootFamilyReviewBytes(body))).toBe(true);return approve(input);},retainPhysicalUnknown(){unknown++;}};
  return {body,options,count:()=>count,unknown:()=>unknown,expire(){now=2000;},changeAccount(){account='11111111-AAAA-BBBB-CCCC-666666666666';},hook(fn:typeof approve){approve=fn;},call:()=>authorizeMainRootFamilyEnrollmentPending({requestSource:'user',review:body},options)};
}
it('authorizes only the exact pending-only body, account, session and review hash through the real broker operation',async()=>{
  const f=fixture();expect(await f.call()).toEqual({uid:501,auditSessionId:7,reviewHash:mainRootFamilyReviewHash(f.body)});expect(f.count()).toBe(1);expect(f.unknown()).toBe(0);
});
it.each(['agent','scheduler'] as const)('denies %s before the Native SDK',async requestSource=>{
  const f=fixture();await expect(authorizeMainRootFamilyEnrollmentPending({requestSource,review:f.body},f.options)).rejects.toThrow('main_root_enrollment_source');expect(f.count()).toBe(0);
});
it('refuses stale deadlines or changed accounts before approval',async()=>{
  const f=fixture();f.expire();await expect(f.call()).rejects.toThrow('main_root_enrollment_deadline');expect(f.count()).toBe(0);
  const g=fixture();g.changeAccount();await expect(g.call()).rejects.toThrow('main_root_enrollment_account_changed');expect(g.count()).toBe(0);
});
it('does not accept an approval whose account changes while Native review is open',async()=>{
  const f=fixture();f.hook(async()=>{f.changeAccount();return mainRootFamilyReviewHash(f.body);});await expect(f.call()).rejects.toThrow('main_root_enrollment_account_changed');
});
it('joins original rejected SDK tails and preserves throw undefined presence',async()=>{
  const f=fixture();let release!:()=>void,ended=false;const held=new Promise<void>(yes=>{release=yes;}),failure=Error('Native original failure');Object.defineProperty(failure,Symbol('held'),{value:held});f.hook(async()=>{throw failure;});
  const call=f.call().then(()=>{throw Error('unexpected success');},error=>{ended=true;return error;});
  for(let i=0;i<12;i++)await Promise.resolve();expect(ended).toBe(false);release();expect(await call).toBe(failure);expect(f.unknown()).toBe(0);
  const g=fixture();g.hook(async()=>{throw undefined;});let caught=false;try{await g.call();}catch(error){caught=true;expect(error).toBeUndefined();}expect(caught).toBe(true);
});
it('reports unknown to the original root-broker lock owner without dropping a known tail or invoking a getter',async()=>{
  const f=fixture();let release!:()=>void,ended=false,touched=0;const held=new Promise<void>(yes=>{release=yes;}),failure=Error('unknown Native');Object.defineProperties(failure,{cause:{value:held},opaque:{get(){touched++;return 1;}}});f.hook(async()=>{throw failure;});
  const call=f.call().catch(error=>{ended=true;return error;});for(let i=0;i<12;i++)await Promise.resolve();expect(ended).toBe(false);expect(f.unknown()).toBe(0);release();expect(await call).toBe(failure);expect(f.unknown()).toBe(1);expect(touched).toBe(0);
});
