import {it,expect} from 'vitest';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {parseCompositeServicePair} from '../../../src/runtime/verification/composite-service-registration.js';
function registration(kind:'egress'|'participant',uid:number){const key=generateKeyPairSync('ed25519').publicKey;return{version:1,kind,authorityId:kind+'-authority',instanceEpoch:1,keyId:createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex'),publicKeyPem:key.export({format:'pem',type:'spki'}).toString(),serviceUid:uid,packageHash:'a'.repeat(64),controllerAuthorityId:'controller'};}
it('requires two independent exact package-bound service authorities and keys',()=>{
 const e=registration('egress',402),p=registration('participant',403),binding={packageHash:'a'.repeat(64),controllerAuthorityId:'controller',forbiddenUids:[400,401,501],forbiddenPublicKeys:[] as string[]};
 const pair=parseCompositeServicePair(e,p,binding);expect(Object.isFrozen(pair.egress)).toBe(true);
 for(const bad of [{...p,serviceUid:402},{...p,serviceUid:501},{...p,publicKeyPem:e.publicKeyPem,keyId:e.keyId},{...p,kind:'egress'},{...p,keyId:'b'.repeat(64)},{...p,controllerAuthorityId:'another'},{...p,packageHash:'b'.repeat(64)},{...p,socket:'/tmp/evil'}])expect(()=>parseCompositeServicePair(e,bad,binding)).toThrow();
 expect(()=>parseCompositeServicePair(e,p,{...binding,forbiddenPublicKeys:[e.publicKeyPem]})).toThrow();
});
