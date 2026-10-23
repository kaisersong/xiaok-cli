import {createPublicKey,verify,type KeyObject} from 'node:crypto';

export interface CompositeParticipantIdentity {
 readonly authorityId:string;readonly authorityGeneration:number;
 readonly instanceIncarnation:string;readonly keyId:string;
}
export interface CompositeParticipantExpectation {
 readonly egressId:string;readonly egressGeneration:number;readonly attemptId:string;
 readonly invocationId:string;readonly bodySha256:string;readonly destination:string;
 readonly model:string;readonly protocol:string;
}
export interface CompositeParticipantFacts extends CompositeParticipantIdentity,CompositeParticipantExpectation {
 readonly version:1;readonly domain:'xiaok.composite.participant.prepared.v1';
 readonly leaseId:string;readonly evidenceSha256:string;
}
declare const receiptBrand:unique symbol;
export interface CompositeParticipantReceipt {readonly [receiptBrand]:true}
const receipts=new WeakMap<object,{issuer:object;facts:Readonly<CompositeParticipantFacts>}>();
const verifiers=new WeakMap<object,object>();
export interface CompositeParticipantVerifier {verify(bytes:Buffer,expected:CompositeParticipantExpectation):CompositeParticipantReceipt}
const identityKeys=['authorityId','authorityGeneration','instanceIncarnation','keyId'] as const;
const expectationKeys=['egressId','egressGeneration','attemptId','invocationId','bodySha256','destination','model','protocol'] as const;
const factKeys=['version','domain',...identityKeys,...expectationKeys,'leaseId','evidenceSha256'];
function reject():never{throw Error('SOL_PI_COMPOSITE_PARTICIPANT_RECEIPT_REJECTED');}
function exact(raw:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!raw||Object.getPrototypeOf(raw)!==Object.prototype||Reflect.ownKeys(raw).length!==keys.length)reject();
 const result:Record<string,unknown>={};
 for(const key of keys){const field=Object.getOwnPropertyDescriptor(raw,key);if(!field||!('value'in field))reject();result[key]=field.value;}
 return result;
}
function id(raw:unknown){if(typeof raw!=='string'||!raw||Buffer.byteLength(raw)>256||/[\x00-\x1f\x7f]/.test(raw))reject();}
function generation(raw:unknown){if(!Number.isSafeInteger(raw)||Number(raw)<1)reject();}
function hash(raw:unknown){if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))reject();}
function identity(raw:unknown):CompositeParticipantIdentity{
 const value=exact(raw,identityKeys);id(value.authorityId);id(value.instanceIncarnation);id(value.keyId);generation(value.authorityGeneration);
 return Object.freeze(value) as unknown as CompositeParticipantIdentity;
}
function expectation(raw:unknown):CompositeParticipantExpectation{
 const value=exact(raw,expectationKeys);
 for(const key of ['egressId','attemptId','invocationId','model','protocol'])id(value[key]);
 generation(value.egressGeneration);hash(value.bodySha256);
 if(typeof value.destination!=='string'||Buffer.byteLength(value.destination)>2048)reject();
 const url=new URL(value.destination);
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href!==value.destination)reject();
 return Object.freeze(value) as unknown as CompositeParticipantExpectation;
}
function canonical(value:Record<string,unknown>){return JSON.stringify(value,Object.keys(value).sort());}
/** Authenticity only. This module does not assert that the issuer holds a live
 * source lease or has a protected installation. The coordinator must also hold
 * the complete original manifest and the current deployment registration. */
export function createCompositeParticipantVerifier(registration:CompositeParticipantIdentity&{publicKey:KeyObject}){
 const fixed=exact(registration,[...identityKeys,'publicKey']);
 const registered=identity(Object.fromEntries(identityKeys.map(key=>[key,fixed[key]])));
 const key=fixed.publicKey as KeyObject;
 if(!key||key.type!=='public'||key.asymmetricKeyType!=='ed25519')reject();
 const publicKey=createPublicKey({key:key.export({type:'spki',format:'der'}),type:'spki',format:'der'});
 const issuer=Object.freeze({});
 const result:CompositeParticipantVerifier=Object.freeze({verify(bytes:Buffer,expected:CompositeParticipantExpectation):CompositeParticipantReceipt{
  const binding=expectation(expected);
  if(!Buffer.isBuffer(bytes)||bytes.byteLength<1||bytes.byteLength>32768)reject();
  const frozen=Buffer.from(bytes),text=frozen.toString('utf8');if(!Buffer.from(text).equals(frozen))reject();
  const envelope=exact(JSON.parse(text),['payload','signature']),facts=exact(envelope.payload,factKeys);
  if(facts.version!==1||facts.domain!=='xiaok.composite.participant.prepared.v1')reject();
  const actualIssuer=identity(Object.fromEntries(identityKeys.map(key=>[key,facts[key]])));
  const actual=expectation(Object.fromEntries(expectationKeys.map(key=>[key,facts[key]])));
  id(facts.leaseId);hash(facts.evidenceSha256);
  for(const name of identityKeys)if(actualIssuer[name]!==registered[name])reject();
  for(const name of expectationKeys)if(actual[name]!==binding[name])reject();
  if(typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))reject();
  const signature=Buffer.from(envelope.signature,'base64url');if(signature.length!==64||signature.toString('base64url')!==envelope.signature)reject();
  const payload=canonical(facts),encoded='{"payload":'+payload+',"signature":'+JSON.stringify(envelope.signature)+'}';
  if(encoded!==text||!verify(null,Buffer.from(payload),publicKey,signature))reject();
  const token=Object.freeze({}) as CompositeParticipantReceipt;
  receipts.set(token,{issuer,facts:Object.freeze(facts) as unknown as Readonly<CompositeParticipantFacts>});return token;
 }});
 verifiers.set(result,issuer);return result;
}
/** An authenticated PREPARED assertion cannot be used as an egress decision or fence. */
export function readCompositeParticipantReceipt(verifier:CompositeParticipantVerifier,receipt:CompositeParticipantReceipt):Readonly<CompositeParticipantFacts>{
 const issuer=verifier&&typeof verifier==='object'?verifiers.get(verifier):undefined;
 const value=receipt&&typeof receipt==='object'?receipts.get(receipt):undefined;if(!issuer||!value||value.issuer!==issuer)reject();return value.facts;
}
