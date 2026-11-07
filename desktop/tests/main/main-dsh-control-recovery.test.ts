// @vitest-environment node
import {expect,it} from 'vitest';
import {existsSync} from 'node:fs';
import {createOriginalMainDshControlRecovery} from '../../electron/main-dsh-control-recovery.js';
import {claimOriginalMainDshServiceRole} from '../../electron/main-dsh-service-role.js';
import * as recoveryModule from '../../electron/main-dsh-control-recovery.js';
it('exposes the private original recovery physical-fate assertion',()=>{
 expect(recoveryModule).toHaveProperty('assertOriginalMainDshControlRecoveryPhysicalKnown',expect.any(Function));
});
it('exposes the original Main read-only control recovery producer',async()=>{
 const path=new URL('../../electron/main-dsh-control-recovery.ts',import.meta.url);
 const api=existsSync(path)?await import('../../electron/main-dsh-control-recovery.js'):{};
 expect(api).toHaveProperty('createOriginalMainDshControlRecovery',expect.any(Function));
});
it('rejects foreign recovery tuples and role claims before Proxy traps or getters',()=>{
 let reads=0;const foreign=new Proxy({},{get(){reads++;throw Error('trap');},getOwnPropertyDescriptor(){reads++;throw Error('trap');},ownKeys(){reads++;throw Error('trap');}});
 expect(()=>createOriginalMainDshControlRecovery(foreign)).toThrow();
 expect(()=>createOriginalMainDshControlRecovery({services:foreign,sources:foreign,brokerClient:foreign})).toThrow();
 expect(()=>claimOriginalMainDshServiceRole(foreign,foreign,'runtime')).toThrow();
 expect(()=>recoveryModule.assertOriginalMainDshControlRecoveryPhysicalKnown(foreign,foreign,foreign)).toThrow();
 expect(reads).toBe(0);
});
it('exposes the fixed mutually exclusive original Services role narrowing gate',async()=>{
 const path=new URL('../../electron/main-dsh-service-role.ts',import.meta.url);
 const api=existsSync(path)?await import('../../electron/main-dsh-service-role.js'):{};
 expect(api).toHaveProperty('claimOriginalMainDshServiceRole',expect.any(Function));
});
