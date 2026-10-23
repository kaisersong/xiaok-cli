import {it,expect} from 'vitest';import {qualificationDisplayDeadline} from '../../../src/runtime/verification/qualification-display-deadline.js';
it('wall preflight expiry never extends original deadline or current continuous remaining duration',()=>{
 const x={originalWallSample:1000,originalWallDeadline:31000,currentWallSample:1100,continuousRemainingMs:25000};expect(qualificationDisplayDeadline(x)).toBe(26100);expect(qualificationDisplayDeadline({...x,currentWallSample:30000})).toBe(31000);
});
it('rejects rollback, forward expiry and expired continuous evidence instead of extending authority',()=>{for(const x of [{currentWallSample:999,continuousRemainingMs:100},{currentWallSample:32000,continuousRemainingMs:100},{currentWallSample:1100,continuousRemainingMs:0}])expect(()=>qualificationDisplayDeadline({originalWallSample:1000,originalWallDeadline:31000,...x})).toThrow();});
