import {it,expect} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {createReceiverUploadSigner,createReceiverUploadVerifier} from '../../../src/runtime/verification/receiver-upload-authentication.js';
it('binds upload acknowledgement to the exact request and independent registered identity',()=>{
 const keys=generateKeyPairSync('ed25519'),identity={receiverId:'receiver',receiverInstanceEpoch:1,keyId:'key'};
 const signer=createReceiverUploadSigner({...identity,privateKey:keys.privateKey}),verifier=createReceiverUploadVerifier({...identity,publicKey:keys.publicKey});
 const request={requestHash:'a'.repeat(64),challenge:'b'.repeat(64)},progress={fullTupleHash:'c'.repeat(64),totalBytes:1024,receivedBytes:512};
 const signed=signer.sign(request,progress);expect(verifier.verify(signed,request)).toEqual(progress);
 expect(()=>verifier.verify(signed,{...request,requestHash:'d'.repeat(64)})).toThrow();
 expect(()=>verifier.verify(signed,{...request,challenge:'d'.repeat(64)})).toThrow();
 expect(()=>verifier.verify({...signed,payload:{...signed.payload,progress:{...progress,receivedBytes:1024}}},request)).toThrow();
 expect(()=>createReceiverUploadVerifier({...identity,receiverInstanceEpoch:2,publicKey:keys.publicKey}).verify(signed,request)).toThrow();
 expect(()=>signer.sign(request,{...progress,receivedBytes:2048})).toThrow();
});
