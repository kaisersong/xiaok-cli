import {it,expect} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {parseInstalledDeploymentManifest} from '../../../src/runtime/verification/deployment-manifest.js';
it('pins separate service identity and explicit interactive UID allowlist in one strict deployment manifest',()=>{
 const {publicKey}=generateKeyPairSync('ed25519');const value={version:2,authorityId:'a',publicKeyPem:publicKey.export({type:'spki',format:'pem'}).toString(),packageHash:'a'.repeat(64),serviceUid:400,allowedUserIds:[501]};
 expect(parseInstalledDeploymentManifest(value).serviceUid).toBe(400);
 for(const invalid of [{...value,serviceUid:0},{...value,allowedUserIds:[400]},{...value,allowedUserIds:[0]},{...value,migrationRoot:'/tmp'},{...value,version:1}])expect(()=>parseInstalledDeploymentManifest(invalid)).toThrow();
});
