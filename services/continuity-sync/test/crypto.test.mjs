import test from 'node:test';
import assert from 'node:assert/strict';
import { hkdfSync } from 'node:crypto';
import sodium from 'libsodium-wrappers';
import { SUITE,canonical,hash,sign,signBytes,verify,deriveSenderKey,sealEnvelope,openEnvelope,createKeyManifest,unwrapKeyManifest,encryptAead,decryptAead,parseCanonical,envelopeSignatureInput } from '../src/crypto.mjs';

await sodium.ready;
const tuple={rootKeyId:'root',syncGroupId:'group',conversationId:'conversation',branchId:'branch',keyEpoch:1,contentEpoch:1,originDeviceId:'device_A'};
const contentKey=new Uint8Array(32).fill(7),salt=new Uint8Array(32).fill(8);
const header={...tuple,schemaVersion:1,cryptoSuite:SUITE,membershipEpoch:1,sourceEpoch:'source',originSequence:1,previousEventHash:'0'.repeat(64),parentRevision:0,eventType:'message',nonce:sodium.to_base64(new Uint8Array(24).fill(9),sodium.base64_variants.URLSAFE_NO_PADDING)};
test('uses RFC 5869 test case 1 through the same HKDF primitive and exact domain-bound derivation',()=>{
 const actual=Buffer.from(hkdfSync('sha256',Buffer.alloc(22,0x0b),Buffer.from('000102030405060708090a0b0c','hex'),Buffer.from('f0f1f2f3f4f5f6f7f8f9','hex'),42)).toString('hex');
 assert.equal(actual,'3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
 const expected=new Uint8Array(hkdfSync('sha256',contentKey,salt,Buffer.from(canonical(['xiaok/context-sync/aead/v1',tuple])),32));assert.deepEqual(deriveSenderKey(contentKey,salt,tuple),expected);
 // Independently calculated with Python hmac and a literal info byte string.
 assert.equal(Buffer.from(deriveSenderKey(contentKey,salt,tuple)).toString('hex'),'d80d7b23ba65508ab359b967a1803da4b12a3c6ff861a1bc15953b737634f3a9');
 for(const field of ['conversationId','branchId','originDeviceId'])assert.notDeepEqual(deriveSenderKey(contentKey,salt,{...tuple,[field]:'different'}),expected);
 assert.notDeepEqual(deriveSenderKey(contentKey,salt,{...tuple,keyEpoch:2}),expected);
});
test('matches RFC 8032 Ed25519 test vector 1',()=>{
 const seed=Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex');
 const publicKey=Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex');
 const signature=signBytes(Buffer.alloc(0),Buffer.concat([seed,publicKey]));
 assert.equal(Buffer.from(signature).toString('hex'),'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b');
});

// Published libsodium 1.0.20 aead_xchacha20poly1305.{c,exp}, first vector.
// https://github.com/jedisct1/libsodium/tree/1.0.20/test/default
test('matches the published libsodium XChaCha20-Poly1305-IETF vector',()=>{
 const key=Buffer.from('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f','hex');
 const nonce=Buffer.from('07000000404142434445464748494a4b4c4d4e4f50515253','hex');
 const aad=Buffer.from('50515253c0c1c2c3c4c5c6c7','hex');
 const plaintext=Buffer.from("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
 const expected='f8ebea4875044066fc162a0604e171feecfb3d20425248563bcfd5a155dcc47bbda70b86e5ab9b55002bd1274c02db35321acd7af8b2e2d25015e136b7679458e9f43243bf719d639badb5feac03f80a19a96ef10cb1d15333a837b90946ba3854ee74da3f2585efc7e1e170e17e15e563e77601f4f85cafa8e5877614e143e68420';
 const ciphertext=encryptAead({key,nonce,aad,plaintext});assert.equal(Buffer.from(ciphertext).toString('hex'),expected);
 assert.deepEqual(Buffer.from(decryptAead({key,nonce,aad,ciphertext})),plaintext);
 for(const part of ['key','nonce','aad','ciphertext']){const args={key,nonce,aad,ciphertext};args[part]=Buffer.from(args[part]);args[part][0]^=1;assert.throws(()=>decryptAead(args));}
});
test('canonical parser rejects duplicate keys, noncanonical JSON and invalid Unicode without lossy decoding',()=>{
 for(const raw of [Buffer.from('{"a":1,"a":2}'),Buffer.from('{ "a":1}'),Buffer.from('{"b":2,"a":1}'),Buffer.from([0xff]),Buffer.from('{"a":"\\ud800"}')])assert.throws(()=>parseCanonical(raw));
 for(const value of ['\ud800',{'x':'\udfff'},Object.assign(Object.create({}),{a:1}),[,1]])assert.throws(()=>canonical(value));
 assert.deepEqual(parseCanonical(Buffer.from(canonical({text:'中文',a:[true,null,1]}))),{a:[true,null,1],text:'中文'});
});
test('signs canonical bytes and authenticates every header/ciphertext field before returning plaintext',()=>{
 const keys=sodium.crypto_sign_keypair(),value={messageId:'message',revision:1,text:'原始约束与证据'};
 const sealed=sealEnvelope({header,payload:value,contentKey,salt,signingKey:keys.privateKey});
 assert.equal(openEnvelope({envelope:sealed,contentKey,salt,signingPublicKey:keys.publicKey,expected:tuple}).text,value.text);
 assert.equal(verify({a:1,b:2},sign({b:2,a:1},keys.privateKey),keys.publicKey),true);
 for(const field of Object.keys(header)){
  const forged=typeof header[field]==='number'?header[field]+1:'forged';
  assert.throws(()=>openEnvelope({envelope:{...sealed,header:{...sealed.header,[field]:forged}},contentKey,salt,signingPublicKey:keys.publicKey,expected:tuple}));
 }
 const ciphertext=Buffer.from(sealed.ciphertext,'base64url');ciphertext[0]^=1;assert.throws(()=>openEnvelope({envelope:{...sealed,ciphertext:ciphertext.toString('base64url')},contentKey,salt,signingPublicKey:keys.publicKey,expected:tuple}));
 assert.throws(()=>openEnvelope({envelope:sealed,contentKey,salt,signingPublicKey:sodium.crypto_sign_keypair().publicKey,expected:tuple}));
 assert.throws(()=>sealEnvelope({header:{...header,cryptoSuite:'AES-GCM'},payload:value,contentKey,salt,signingKey:keys.privateKey}));
});
 test('rejects ambiguous canonical values, noncanonical base64, unknown fields and invalid header integers',()=>{
 for(const v of [{n:NaN},{n:1.1},{n:Infinity},{n:undefined},{n:2n},new Date(),{n:-0}])assert.throws(()=>canonical(v));
 const keys=sodium.crypto_sign_keypair();assert.throws(()=>sealEnvelope({header:{...header,actor:'forged'},payload:{text:'x'},contentKey,salt,signingKey:keys.privateKey}));
 assert.throws(()=>sealEnvelope({header:{...header,nonce:header.nonce+'='},payload:{text:'x'},contentKey,salt,signingKey:keys.privateKey}));
 assert.equal(hash({b:2,a:1}),hash({a:1,b:2}));
 for(const field of Object.keys(header)){const h={...header};delete h[field];assert.throws(()=>sealEnvelope({header:h,payload:{},contentKey,salt,signingKey:keys.privateKey}));}
 for(const n of [-1,0.5,Number.MAX_SAFE_INTEGER+1,NaN])assert.throws(()=>sealEnvelope({header:{...header,originSequence:n},payload:{},contentKey,salt,signingKey:keys.privateKey}));
});
test('rejects valid signatures over broken AEAD and authenticated malformed UTF8 before disclosing plaintext',()=>{
 const keys=sodium.crypto_sign_keypair(),key=deriveSenderKey(contentKey,salt,tuple);
 const args={contentKey,salt,signingPublicKey:keys.publicKey,expected:tuple};
 const sealed=sealEnvelope({header,payload:{text:'x'},contentKey,salt,signingKey:keys.privateKey});
 const ciphertext=Buffer.from(sealed.ciphertext,'base64url');ciphertext[0]^=1;
 const signature=sign(envelopeSignatureInput(header,ciphertext),keys.privateKey);
 assert.throws(()=>openEnvelope({...args,envelope:{header,ciphertext:ciphertext.toString('base64url'),signature}}));
 const malformed=encryptAead({key,nonce:Buffer.from(header.nonce,'base64url'),aad:Buffer.from(canonical(header)),plaintext:Buffer.from([0xff])});
 assert.throws(()=>openEnvelope({...args,envelope:{header,ciphertext:Buffer.from(malformed).toString('base64url'),signature:sign(envelopeSignatureInput(header,malformed),keys.privateKey)}}));
});
test('rejects exotic expected scopes and roundtrips every sealable wire-size boundary',()=>{
 const keys=sodium.crypto_sign_keypair(),payload={text:'x'.repeat(800_000)};
 const envelope=sealEnvelope({header,payload,contentKey,salt,signingKey:keys.privateKey});
 assert.equal(openEnvelope({envelope,contentKey,salt,signingPublicKey:keys.publicKey,expected:tuple}).text.length,800_000);
 const exotic=Object.create(null);for(const [k,v]of Object.entries({...tuple,conversationId:'wrong'}))Object.defineProperty(exotic,k,{value:v,enumerable:false});
 assert.throws(()=>openEnvelope({envelope,contentKey,salt,signingPublicKey:keys.publicKey,expected:exotic}));
 assert.throws(()=>sealEnvelope({header,payload:{text:'x'.repeat(1024*1024)},contentKey,salt,signingKey:keys.privateKey}));
});
test('root-signed key manifests wrap only active members and verify sender identity independently from sealed boxes',()=>{
 const root=sodium.crypto_sign_keypair(),a=sodium.crypto_box_keypair(),b=sodium.crypto_box_keypair();
 const membership={membershipEpoch:2,keyEpoch:2,devices:[{deviceId:'a',state:'active',encryptionPublicKey:Buffer.from(a.publicKey).toString('base64url')},{deviceId:'b',state:'revoked',encryptionPublicKey:Buffer.from(b.publicKey).toString('base64url')}]};
 const manifest=createKeyManifest({rootKeyId:'root',syncGroupId:'group',membership,contentEpoch:1,contentKey,salt,rootSigningKey:root.privateKey});
 const expected={rootKeyId:'root',syncGroupId:'group',membershipEpoch:2,keyEpoch:2,contentEpoch:1,membershipHash:hash(membership)};
 const args={manifest,membership,expected,rootPublicKey:root.publicKey,deviceId:'a',encryptionPublicKey:a.publicKey,encryptionPrivateKey:a.privateKey};
 assert.deepEqual(Object.keys(manifest.wraps),['a']);assert.deepEqual(unwrapKeyManifest(args),{contentKey,salt});
 assert.throws(()=>unwrapKeyManifest({...args,deviceId:'b',encryptionPublicKey:b.publicKey,encryptionPrivateKey:b.privateKey}));
 assert.throws(()=>unwrapKeyManifest({...args,manifest:{...manifest,keyEpoch:1}}));
 assert.throws(()=>unwrapKeyManifest({...args,expected:undefined}));
 for(const field of Object.keys(expected))assert.throws(()=>unwrapKeyManifest({...args,expected:{...expected,[field]:typeof expected[field]==='number'?999:'foreign'}}));
 const {signature:_,...body}=manifest;
 const wrongCommit={...body,keyCommitment:'0'.repeat(64)};
 assert.throws(()=>unwrapKeyManifest({...args,manifest:{...wrongCommit,signature:sign(['xiaok/context-sync/key-manifest/v1',wrongCommit],root.privateKey)}}));
 const wrongWrap={...body,wraps:{a:Buffer.from(sodium.crypto_box_seal(contentKey,b.publicKey)).toString('base64url')}};
 assert.throws(()=>unwrapKeyManifest({...args,manifest:{...wrongWrap,signature:sign(['xiaok/context-sync/key-manifest/v1',wrongWrap],root.privateKey)}}));
});
