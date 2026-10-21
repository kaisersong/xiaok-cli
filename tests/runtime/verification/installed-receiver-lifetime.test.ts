import {it,expect} from 'vitest';
import {createInstalledReceiverLifetime,assertInstalledReceiverLifetime} from '../../../src/runtime/verification/installed-receiver-lifetime.js';
it('rejects caller-supplied paths or lifetime copies before installed filesystem access',()=>{
 expect(()=>Reflect.apply(createInstalledReceiverLifetime,null,[{base:'/tmp'}])).toThrow('receiver_lifetime_arguments');
 expect(()=>assertInstalledReceiverLifetime({assertCurrent(){throw Error('caller-controlled');}})).toThrow('receiver_lifetime_identity');
});
