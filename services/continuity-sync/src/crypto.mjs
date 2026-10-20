import { createHash, hkdfSync } from 'node:crypto';
import sodium from 'libsodium-wrappers';

await sodium.ready;

export const SUITE = 'XC20P-HKDFSHA256-ED25519-v1';
const WRAP_SUITE = 'LIBSODIUM-CRYPTO-BOX-SEAL-v1';
const MAX_BYTES = 1024 * 1024;
const MAX_CANONICAL_BYTES = 2 * MAX_BYTES;
const TUPLE_FIELDS = ['rootKeyId','syncGroupId','conversationId','branchId','keyEpoch','contentEpoch','originDeviceId'];
const HEADER_FIELDS = [...TUPLE_FIELDS,'schemaVersion','cryptoSuite','membershipEpoch','sourceEpoch','originSequence','previousEventHash','parentRevision','eventType','nonce'];
const MANIFEST_FIELDS = ['schemaVersion','cryptoSuite','wrapSuite','rootKeyId','syncGroupId','membershipEpoch','keyEpoch','contentEpoch','membershipHash','salt','keyCommitment','wraps'];
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function fail() { throw new Error('invalid_crypto_data'); }
function string(value) {
  if (typeof value !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail();
  return value;
}
export function canonical(value) {
  const seen = new Set();
  function encode(v, depth) {
    if (depth > 64) fail();
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') return JSON.stringify(string(v));
    if (typeof v === 'number') { if (!Number.isSafeInteger(v) || Object.is(v,-0)) fail(); return String(v); }
    if (!v || typeof v !== 'object' || seen.has(v) || Object.getOwnPropertySymbols(v).length) fail();
    seen.add(v);
    let result;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) fail();
      const items = [];
      for (let i=0;i<v.length;i++) { const d=Object.getOwnPropertyDescriptor(v,String(i)); if (!d || !('value' in d)) fail(); items.push(encode(d.value,depth+1)); }
      result = '['+items.join(',')+']';
    } else {
      if (![Object.prototype,null].includes(Object.getPrototypeOf(v))) fail();
      const fields = Object.getOwnPropertyNames(v).sort().map(k=>{
        const d=Object.getOwnPropertyDescriptor(v,k); if (!d.enumerable || !('value' in d)) fail();
        return JSON.stringify(string(k))+':'+encode(d.value,depth+1);
      });
      result = '{'+fields.join(',')+'}';
    }
    seen.delete(v);
    if (Buffer.byteLength(result)>MAX_CANONICAL_BYTES) fail();
    return result;
  }
  const encoded=encode(value,0); if (Buffer.byteLength(encoded)>MAX_CANONICAL_BYTES) fail(); return encoded;
}
export function parseCanonical(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length>MAX_CANONICAL_BYTES) fail();
  const raw=utf8.decode(bytes), value=JSON.parse(raw);
  if (canonical(value)!==raw) fail();
  return value;
}
export function hashBytes(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function hash(value) { return hashBytes(canonical(value)); }
export function bytes(value,length) {
  if (!(value instanceof Uint8Array) || (length!==undefined && value.length!==length)) fail(); return value;
}
export function base64(value) { return Buffer.from(bytes(value)).toString('base64url'); }
export function unbase64(value,length) {
  if (typeof value!=='string' || value.length>MAX_BYTES*2 || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const out=new Uint8Array(Buffer.from(value,'base64url'));
  if (base64(out)!==value || (length!==undefined && out.length!==length)) fail(); return out;
}
export function exactObject(value,fields) {
  if (!value || Array.isArray(value) || typeof value!=='object') fail();
  if (Object.keys(value).sort().join('\0')!==[...fields].sort().join('\0')) fail();
  canonical(value); return value;
}
export function identifier(value) { if (typeof value!=='string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) fail(); return value; }
export function integer(value,min=0) { if (!Number.isSafeInteger(value) || Object.is(value,-0) || value<min) fail(); return value; }
function digest(value) { if (typeof value!=='string' || !/^[a-f0-9]{64}$/.test(value)) fail(); return value; }
export function signBytes(value,privateKey) { return sodium.crypto_sign_detached(bytes(value),bytes(privateKey,64)); }
export function sign(value,privateKey) { return base64(signBytes(Buffer.from(canonical(value)),privateKey)); }
export function verify(value,signature,publicKey) {
  try { return sodium.crypto_sign_verify_detached(unbase64(signature,64),canonical(value),bytes(publicKey,32)); } catch { return false; }
}
function validateTuple(tuple) {
  exactObject(tuple,TUPLE_FIELDS);
  for (const field of TUPLE_FIELDS) field.endsWith('Epoch')?integer(tuple[field],1):identifier(tuple[field]);
  return tuple;
}
function tupleOf(header) { return Object.fromEntries(TUPLE_FIELDS.map(k=>[k,header[k]])); }
export function deriveSenderKey(contentKey,salt,tuple) {
  validateTuple(tuple);
  return new Uint8Array(hkdfSync('sha256',bytes(contentKey,32),bytes(salt,32),Buffer.from(canonical(['xiaok/context-sync/aead/v1',tuple])),32));
}
export function validateHeader(header) {
  exactObject(header,HEADER_FIELDS); validateTuple(tupleOf(header));
  if (header.schemaVersion!==1 || header.cryptoSuite!==SUITE) fail();
  integer(header.membershipEpoch,1); integer(header.originSequence,1); integer(header.parentRevision);
  identifier(header.sourceEpoch); identifier(header.eventType); digest(header.previousEventHash); unbase64(header.nonce,24);
  return header;
}
export function encryptAead({key,nonce,aad,plaintext}) {
  bytes(plaintext);bytes(aad);if(plaintext.length>MAX_BYTES || aad.length>MAX_BYTES)fail();
  return sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext,aad,null,bytes(nonce,24),bytes(key,32));
}
export function decryptAead({key,nonce,aad,ciphertext}) {
  bytes(ciphertext);bytes(aad);if(ciphertext.length<16 || ciphertext.length>MAX_BYTES+16 || aad.length>MAX_BYTES)fail();
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null,ciphertext,aad,bytes(nonce,24),bytes(key,32));
}
export function envelopeSignatureInput(header,ciphertext) {
  return ['xiaok/context-sync/envelope-signature/v1',header,hashBytes(ciphertext)];
}
export function sealEnvelope({header,payload,contentKey,salt,signingKey}) {
  validateHeader(header);
  const key=deriveSenderKey(contentKey,salt,tupleOf(header));
  try {
    const ciphertext=encryptAead({key,nonce:unbase64(header.nonce,24),aad:Buffer.from(canonical(header)),plaintext:Buffer.from(canonical(payload))});
    return {header:parseCanonical(Buffer.from(canonical(header))),ciphertext:base64(ciphertext),signature:sign(envelopeSignatureInput(header,ciphertext),signingKey)};
  } finally { sodium.memzero(key); }
}
export function verifyEnvelope(envelope,signingPublicKey) {
  exactObject(envelope,['header','ciphertext','signature']);validateHeader(envelope.header);
  const ciphertext=unbase64(envelope.ciphertext);
  if (ciphertext.length<16 || ciphertext.length>MAX_BYTES+16 || !verify(envelopeSignatureInput(envelope.header,ciphertext),envelope.signature,signingPublicKey)) fail();
  return ciphertext;
}
export function openEnvelope({envelope,contentKey,salt,signingPublicKey,expected}) {
  // Current membership/revocation heads and signer membership are verified by the receiver owner.
  // This mandatory expected tuple prevents plaintext from crossing its selected conversation/branch.
  expected=parseCanonical(Buffer.from(canonical(expected)));
  validateTuple(Object.fromEntries(TUPLE_FIELDS.map(k=>[k,expected?.[k]])));
  const ciphertext=verifyEnvelope(envelope,signingPublicKey);
  for(const k of new Set([...TUPLE_FIELDS,...Object.keys(expected)])) if (!HEADER_FIELDS.includes(k) || envelope.header[k]!==expected[k]) fail();
  const key=deriveSenderKey(contentKey,salt,tupleOf(envelope.header));
  let plaintext;
  try { plaintext=decryptAead({key,nonce:unbase64(envelope.header.nonce,24),aad:Buffer.from(canonical(envelope.header)),ciphertext});return parseCanonical(plaintext); }
  finally { sodium.memzero(key);if(plaintext)sodium.memzero(plaintext); }
}
function validateMembership(membership) {
  // This structural subset is a manifest input; root-log verification is performed by the owner.
  integer(membership?.membershipEpoch,1);integer(membership?.keyEpoch,1);
  if(!Array.isArray(membership.devices)||membership.devices.length<1||membership.devices.length>256)fail();
  const ids=new Set();
  for(const d of membership.devices){identifier(d.deviceId);if(ids.has(d.deviceId)||!['active','revoked'].includes(d.state))fail();ids.add(d.deviceId);unbase64(d.encryptionPublicKey,32);}
  return membership.devices.filter(d=>d.state==='active');
}
export function createKeyManifest({rootKeyId,syncGroupId,membership,contentEpoch,contentKey,salt,rootSigningKey}) {
  identifier(rootKeyId);identifier(syncGroupId);integer(contentEpoch,1);bytes(contentKey,32);bytes(salt,32);
  const active=validateMembership(membership), wraps=Object.create(null);
  for(const d of active)wraps[d.deviceId]=base64(sodium.crypto_box_seal(contentKey,unbase64(d.encryptionPublicKey,32)));
  const body={schemaVersion:1,cryptoSuite:SUITE,wrapSuite:WRAP_SUITE,rootKeyId,syncGroupId,membershipEpoch:membership.membershipEpoch,keyEpoch:membership.keyEpoch,contentEpoch,membershipHash:hash(membership),salt:base64(salt),keyCommitment:hashBytes(contentKey),wraps};
  return {...body,signature:sign(['xiaok/context-sync/key-manifest/v1',body],rootSigningKey)};
}
export function verifyKeyManifest({manifest,membership,expected,rootPublicKey}) {
  exactObject(manifest,[...MANIFEST_FIELDS,'signature']);
  exactObject(expected,['rootKeyId','syncGroupId','membershipEpoch','keyEpoch','contentEpoch','membershipHash']);
  const {signature,...body}=manifest;
  if(manifest.schemaVersion!==1||manifest.cryptoSuite!==SUITE||manifest.wrapSuite!==WRAP_SUITE||!verify(['xiaok/context-sync/key-manifest/v1',body],signature,rootPublicKey))fail();
  for(const [k,v]of Object.entries(expected))if(manifest[k]!==v)fail();
  const active=validateMembership(membership);
  if(hash(membership)!==manifest.membershipHash || membership.membershipEpoch!==manifest.membershipEpoch || membership.keyEpoch!==manifest.keyEpoch)fail();
  if(Object.keys(manifest.wraps).sort().join('\0')!==active.map(d=>d.deviceId).sort().join('\0'))fail();
  for(const wrap of Object.values(manifest.wraps))unbase64(wrap,80);
  unbase64(manifest.salt,32);digest(manifest.keyCommitment);integer(manifest.contentEpoch,1);
  return body;
}
export function unwrapKeyManifest({manifest,membership,expected,rootPublicKey,deviceId,encryptionPublicKey,encryptionPrivateKey}) {
  verifyKeyManifest({manifest,membership,expected,rootPublicKey});
  const active=validateMembership(membership);
  const device=active.find(d=>d.deviceId===deviceId);
  if(!device || device.encryptionPublicKey!==base64(bytes(encryptionPublicKey,32)))fail();
  const salt=unbase64(manifest.salt,32);digest(manifest.keyCommitment);
  const contentKey=sodium.crypto_box_seal_open(unbase64(manifest.wraps[deviceId],80),encryptionPublicKey,bytes(encryptionPrivateKey,32));
  if(!contentKey || hashBytes(contentKey)!==manifest.keyCommitment){if(contentKey)sodium.memzero(contentKey);fail();}
  return {contentKey,salt};
}
