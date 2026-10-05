import {it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({ns:1_000_000_000n}));
vi.mock('../../../src/runtime/verification/installed-receiver-lifetime.js',()=>({assertInstalledReceiverLifetime(){f.ns+=200_000_000n;}}));
vi.mock('../../../src/runtime/verification/installed-identity.js',()=>({assertRootProtectedExecutable(){},assertRootProtectedFile(){}}));
vi.mock('../../../src/runtime/verification/continuous-clock.js',()=>({readKernelContinuousNanoseconds:()=>f.ns}));
vi.mock('node:child_process',()=>({spawnSync(_node:string,_args:string[],options:{input:string}){f.ns+=10_000_000n;return{status:0,signal:null,stdout:JSON.stringify({version:1,nonce:options.input,sample:{domainId:'continuous-original',qualificationEpoch:1,evidenceHash:'a'.repeat(64),lowerBound:Number(f.ns/1_000_000n),upperBound:Number(f.ns/1_000_000n)}})};}}));
import {createInstalledReceiverClock} from '../../../src/runtime/verification/installed-receiver-clock.js';
it('actual clock factory includes final synchronous identity checks in the returned current upper bound',()=>{
 const clock=createInstalledReceiverClock({release:'/fixed'} as any);const value=clock.sample();expect(value.upperBound).toBe(Number(f.ns/1_000_000n));clock.close();
});
