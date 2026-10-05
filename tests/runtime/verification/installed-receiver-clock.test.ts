import {it,expect} from 'vitest';
import {createInstalledReceiverClock} from '../../../src/runtime/verification/installed-receiver-clock.js';
it('rejects copied lifetime before reading caller supplied paths or starting helpers',()=>{let touched=false;const fake={get release(){touched=true;throw Error('path touched');}};expect(()=>createInstalledReceiverClock(fake as any)).toThrow('receiver_lifetime_identity');expect(touched).toBe(false);});
