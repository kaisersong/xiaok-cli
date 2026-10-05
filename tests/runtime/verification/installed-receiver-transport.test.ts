import {it,expect} from 'vitest';
import {createInstalledReceiverTransport} from '../../../src/runtime/verification/installed-receiver-transport.js';
it('rejects copied deployment objects before reading endpoint or key',()=>{
 let touched=false;
 const forged={get socketPath(){touched=true;throw Error('untrusted endpoint');}};
 expect(()=>createInstalledReceiverTransport({} as never,forged as never)).toThrow('controller_lifetime_identity');
 expect(touched).toBe(false);
});
