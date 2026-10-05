import {it,expect} from 'vitest';
import {validateReceiverClockRoundTrip} from '../../../src/runtime/verification/receiver-clock-protocol.js';
const nonce='a'.repeat(64),sample={domainId:'continuous-test',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:'b'.repeat(64)};
it('uses outward integer rounding and expands authenticated clock upper bound to call end',()=>{
 expect(validateReceiverClockRoundTrip({version:1,nonce,sample},{nonce,before:1000999999n,after:1002000001n})).toEqual({...sample,upperBound:1003});
});
it('rejects nonce, stale/outside bounds and excessive RTT',()=>{
 for(const response of [{version:1,nonce:'c'.repeat(64),sample},{version:1,nonce,sample:{...sample,lowerBound:999}},{version:1,nonce,sample:{...sample,upperBound:1005}}])expect(()=>validateReceiverClockRoundTrip(response,{nonce,before:1000000000n,after:1002000000n})).toThrow();
 expect(()=>validateReceiverClockRoundTrip({version:1,nonce,sample},{nonce,before:0n,after:6000000000n})).toThrow();
});
