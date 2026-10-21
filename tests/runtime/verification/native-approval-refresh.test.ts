import {it,expect} from 'vitest';
import {refreshNativeApprovalQualification} from '../../../src/runtime/verification/native-approval-refresh.js';
it('refreshes expired engine eligibility after GUI without replacing the original approval or deadline',async()=>{
 let time=35,refreshes=0;const approval=Object.freeze({reviewHash:'original'}),deadline={domainId:'d',qualificationEpoch:1,notBefore:0,validUntil:90};
 const result=await refreshNativeApprovalQualification({approval,deadline,originalEngineBinding:'engine-a',async ensureQualified(){refreshes++;time+=5;},currentEngineBinding:()=> 'engine-a',clock:()=>({domainId:'d',qualificationEpoch:1,lowerBound:time,upperBound:time,evidenceHash:'a'.repeat(64)}),assertCurrent(){}});
 expect(result).toBe(approval);expect(refreshes).toBe(1);expect(deadline.validUntil).toBe(90);
});
it.each(['expired','changed','clock'])('rejects an expired original approval or changed engine/clock after real refresh work (%s)',async(mode)=>{
 let time=35,engine='engine-a',domain='d';const deadline={domainId:'d',qualificationEpoch:1,notBefore:0,validUntil:40};
 await expect(refreshNativeApprovalQualification({approval:{reviewHash:'original'},deadline,originalEngineBinding:engine,async ensureQualified(){if(mode==='expired')time=41;if(mode==='changed')engine='engine-b';if(mode==='clock')domain='new';},currentEngineBinding:()=>engine,clock:()=>({domainId:domain,qualificationEpoch:1,lowerBound:time,upperBound:time,evidenceHash:'a'.repeat(64)}),assertCurrent(){}})).rejects.toThrow();
});
