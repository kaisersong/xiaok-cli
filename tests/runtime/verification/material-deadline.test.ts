import {it,expect} from 'vitest';
import {freezeMaterialDeadline,assertMaterialDeadline} from '../../../src/runtime/verification/material-deadline.js';
const clock=(lowerBound:number,upperBound=lowerBound)=>({domainId:'clock',qualificationEpoch:1,lowerBound,upperBound,evidenceHash:'a'.repeat(64)});
it('freezes first-prepare remaining lifetime, including GUI time and uncertainty',()=>{
 const d=freezeMaterialDeadline({requestedWallExpiry:11000,wallNow:1000,clock:clock(500,510),maximumLifetimeMs:5000});
 expect(d.continuousExpiresAt).toBe(5500);
 expect(()=>assertMaterialDeadline(d,{wallNow:0,clock:clock(5500)})).toThrow('material_deadline_expired');
 expect(()=>assertMaterialDeadline(d,{wallNow:11000,clock:clock(600)})).toThrow('material_deadline_expired');
 expect(()=>assertMaterialDeadline(d,{wallNow:1000,clock:{...clock(600),domainId:'restart'}})).toThrow('material_deadline_domain');
 expect(()=>assertMaterialDeadline(d,{wallNow:1000,clock:clock(5490,5500)})).toThrow('material_deadline_expired');
});
it('does not sign zero/unknown/overflow lifetimes or malformed clock evidence',()=>{
 for(const value of [NaN,Infinity,1000,Number.MAX_SAFE_INTEGER+1])expect(()=>freezeMaterialDeadline({requestedWallExpiry:value,wallNow:1000,clock:clock(500),maximumLifetimeMs:5000})).toThrow();
 expect(()=>freezeMaterialDeadline({requestedWallExpiry:9000,wallNow:1000,clock:clock(600,500),maximumLifetimeMs:5000})).toThrow();
});
