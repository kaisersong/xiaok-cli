import {it,expect} from 'vitest';
import {createInstalledExecutionStack} from '../../../src/runtime/verification/installed-execution-stack.js';
it('rejects copied lifetime facts before touching a DB, ACL or engine',async()=>{let reads=0;await expect(createInstalledExecutionStack({lifetime:{assertCurrent(){}},get access(){reads++;throw Error('must not touch');},get resolveOwnerKey(){reads++;throw Error('must not touch');}} as any)).rejects.toThrow('controller_lifetime_identity');expect(reads).toBe(0);});
