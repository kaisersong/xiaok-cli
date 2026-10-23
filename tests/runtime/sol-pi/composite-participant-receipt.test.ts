import {expect,it} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createCompositeParticipantVerifier,readCompositeParticipantReceipt} from '../../../src/runtime/sol-pi/composite-participant-receipt.js';
const canonical=(value:Record<string,unknown>)=>JSON.stringify(value,Object.keys(value).sort());
const identity={authorityId:'broker-a',authorityGeneration:2,instanceIncarnation:'boot-a',keyId:'key-a'};
const expected={egressId:'egress',egressGeneration:3,attemptId:'attempt',invocationId:'logical',bodySha256:'a'.repeat(64),destination:'https://example.test/chat/completions',model:'model',protocol:'openai_legacy'};
const payload={version:1,domain:'xiaok.composite.participant.prepared.v1',...identity,...expected,leaseId:'lease',evidenceSha256:'b'.repeat(64)};
const encode=(privateKey:ReturnType<typeof generateKeyPairSync>['privateKey'],facts:Record<string,unknown>)=>Buffer.from('{"payload":'+canonical(facts)+',"signature":'+JSON.stringify(sign(null,Buffer.from(canonical(facts)),privateKey).toString('base64url'))+'}');
it('accepts only the exact deployed issuer and original attempt binding',()=>{
 const keys=generateKeyPairSync('ed25519');const verifier=createCompositeParticipantVerifier({...identity,publicKey:keys.publicKey});
 const receipt=verifier.verify(encode(keys.privateKey,payload),expected);
 expect(readCompositeParticipantReceipt(verifier,receipt)).toEqual(payload);
 expect(()=>readCompositeParticipantReceipt(verifier,{...receipt})).toThrow();
 for(const change of [{bodySha256:'c'.repeat(64)},{egressGeneration:4},{attemptId:'other'},{destination:'https://other.test/chat/completions'}])expect(()=>verifier.verify(encode(keys.privateKey,payload),{...expected,...change})).toThrow();
});
it('rejects valid signatures for old deployment, other domain, unknown fields, and another key',()=>{
 const keys=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');const verifier=createCompositeParticipantVerifier({...identity,publicKey:keys.publicKey});
 for(const change of [{authorityGeneration:1},{instanceIncarnation:'old'},{domain:'xiaok.composite.egress.fence.v1'},{extra:true}])expect(()=>verifier.verify(encode(keys.privateKey,{...payload,...change}),expected)).toThrow();
 expect(()=>verifier.verify(encode(other.privateKey,payload),expected)).toThrow();
 expect(()=>verifier.verify(Buffer.alloc(32769),expected)).toThrow();
});
it('captures deployment registration and returns immutable receipt facts',()=>{
 const keys=generateKeyPairSync('ed25519'),registration={...identity,publicKey:keys.publicKey};const verifier=createCompositeParticipantVerifier(registration);
 registration.instanceIncarnation='replaced';registration.publicKey=generateKeyPairSync('ed25519').publicKey;
 const receipt=verifier.verify(encode(keys.privateKey,payload),expected),facts=readCompositeParticipantReceipt(verifier,receipt);
 expect(Object.isFrozen(facts)).toBe(true);expect(facts.instanceIncarnation).toBe('boot-a');
});
it('rejects noncanonical envelope bytes and accessor expectations without evaluating them',()=>{
 const keys=generateKeyPairSync('ed25519'),verifier=createCompositeParticipantVerifier({...identity,publicKey:keys.publicKey});
 const bytes=encode(keys.privateKey,payload);
 expect(()=>verifier.verify(Buffer.from(' '+bytes.toString()),expected)).toThrow();
 let reads=0;const accessor={...expected};Object.defineProperty(accessor,'bodySha256',{enumerable:true,get(){reads++;return expected.bodySha256;}});
 expect(()=>verifier.verify(bytes,accessor)).toThrow();expect(reads).toBe(0);
});
it('cannot substitute a receipt minted by another verifier using the same claimed identity',()=>{
 const deployed=generateKeyPairSync('ed25519'),foreign=generateKeyPairSync('ed25519');
 const registered=createCompositeParticipantVerifier({...identity,publicKey:deployed.publicKey});
 const other=createCompositeParticipantVerifier({...identity,publicKey:foreign.publicKey});
 const substituted=other.verify(encode(foreign.privateKey,payload),expected);
 expect(()=>readCompositeParticipantReceipt(registered,substituted)).toThrow();
 expect(registered).toBeDefined();
});
it('preserves the exact authorized provider query without accepting another query',()=>{
 const keys=generateKeyPairSync('ed25519'),verifier=createCompositeParticipantVerifier({...identity,publicKey:keys.publicKey});
 const target={...expected,destination:expected.destination+'?api-version=2026-01-01'};
 const receipt=verifier.verify(encode(keys.privateKey,{...payload,...target}),target);
 expect(readCompositeParticipantReceipt(verifier,receipt).destination).toBe(target.destination);
 expect(()=>verifier.verify(encode(keys.privateKey,{...payload,...target}),{...target,destination:expected.destination+'?api-version=2026-02-01'})).toThrow();
});
