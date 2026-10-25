import {it,expect} from 'vitest';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {parseInstalledReceiverRegistration,createInstalledReceiverRegistration} from '../../../src/runtime/verification/installed-receiver-registration.js';
it.each(['valid','controller-uid','interactive-uid','controller-key','self','key-id','epoch','extra'] as const)('pins an independently installed receiver registration: %s',mode=>{
 const controller=generateKeyPairSync('ed25519'),receiver=generateKeyPairSync('ed25519'),policy={controllerPublicKey:controller.publicKey,controllerServiceUid:600,interactiveUids:[501]},publicKey=mode==='controller-key'?controller.publicKey:receiver.publicKey;
 const raw:any={version:1,receiverId:mode==='self'?'self:task:t':'business-receiver',receiverInstanceEpoch:mode==='epoch'?-1:1,keyId:mode==='key-id'?'a'.repeat(64):createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex'),publicKeyPem:publicKey.export({format:'pem',type:'spki'}).toString(),serviceUid:mode==='controller-uid'?600:mode==='interactive-uid'?501:601};if(mode==='extra')raw.endpoint='/tmp/attacker.sock';
 if(mode==='valid'){const result=parseInstalledReceiverRegistration(raw,policy);expect(result.receiverId).toBe('business-receiver');expect(Object.isFrozen(result)).toBe(true);}else expect(()=>parseInstalledReceiverRegistration(raw,policy)).toThrow();
});
it('rejects copied lifetime before reading a caller controlled path',()=>{
 let touched=0;expect(()=>createInstalledReceiverRegistration({get base(){touched++;throw Error('path');}} as any)).toThrow('controller_lifetime_identity');expect(touched).toBe(0);
});
