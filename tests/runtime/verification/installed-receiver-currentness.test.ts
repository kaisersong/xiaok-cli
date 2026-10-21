import {it,expect,vi} from 'vitest';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fixture=vi.hoisted(()=>({trusted:new WeakSet<object>()}));
// Isolate installed OS gates only; these fixtures never establish OS qualification.
vi.mock('../../../src/runtime/verification/installed-controller-lifetime.js',()=>({assertInstalledControllerLifetime(value:object){if(!fixture.trusted.has(value))throw Error('fixture_lifetime_revoked');}}));
vi.mock('../../../src/runtime/verification/installed-identity.js',()=>({assertRootProtectedFile(){}}));
import {createInstalledReceiverRegistration,assertInstalledReceiverRegistration} from '../../../src/runtime/verification/installed-receiver-registration.js';
import {createReceiverReplySigner} from '../../../src/runtime/verification/receiver-authentication.js';
it.each(['changed-file','revoked-lifetime','copied-registration'] as const)('rechecks retained actual verifier on every read and verify: %s',mode=>{
 const base=mkdtempSync(join(tmpdir(),'receiver-registration-')),controller=generateKeyPairSync('ed25519'),receiver=generateKeyPairSync('ed25519'),keyId=createHash('sha256').update(receiver.publicKey.export({format:'der',type:'spki'})).digest('hex');
 const definition={version:1,receiverId:'receiver',receiverInstanceEpoch:1,keyId,publicKeyPem:receiver.publicKey.export({format:'pem',type:'spki'}).toString(),serviceUid:601},lifetime={base,publicKey:controller.publicKey,manifest:{serviceUid:600,allowedUserIds:[501]}};fixture.trusted.add(lifetime);writeFileSync(join(base,'receiver.json'),JSON.stringify(definition));
 const registration=createInstalledReceiverRegistration(lifetime as any),verifier=registration.receiverVerifier;
 try{
  const signer=createReceiverReplySigner({receiverId:'receiver',receiverInstanceEpoch:1,keyId,privateKey:receiver.privateKey}),request={fullTupleHash:'a'.repeat(64),challenge:'b'.repeat(64)},reply=signer.sign(request,{status:'unknown',fullTupleHash:request.fullTupleHash}),accepted=verifier.verify(reply,request);expect(verifier.read(accepted).result.status).toBe('unknown');
  if(mode==='copied-registration'){expect(()=>assertInstalledReceiverRegistration({...registration},lifetime as any)).toThrow('identity');return;}
  if(mode==='changed-file')writeFileSync(join(base,'receiver.json'),JSON.stringify({...definition,receiverInstanceEpoch:2}));else fixture.trusted.delete(lifetime);
  expect(()=>verifier.read(accepted)).toThrow();expect(()=>verifier.verify(reply,request)).toThrow();
 }finally{registration.close();rmSync(base,{recursive:true,force:true});}
});
