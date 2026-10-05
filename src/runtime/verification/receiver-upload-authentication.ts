import {sign,verify,type KeyObject} from 'node:crypto';
import {canonicalVerificationJson as json,VERIFICATION_BUDGET} from './protocol.js';
import type {Identity} from './receiver-authentication.js';
export interface UploadProgress{fullTupleHash:string;totalBytes:number;receivedBytes:number}
export interface UploadRequestBinding{requestHash:string;challenge:string}
export interface SignedUploadReply{payload:Identity&UploadRequestBinding&{domain:'xiaok.receiver.upload.v1';progress:UploadProgress};signature:string}
function hash(value:unknown){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function identity(input:Identity):Identity{if(typeof input.receiverId!=='string'||!input.receiverId||input.receiverId.length>160||typeof input.keyId!=='string'||!input.keyId||input.keyId.length>160||!Number.isSafeInteger(input.receiverInstanceEpoch)||input.receiverInstanceEpoch<1)throw Error('receiver_upload_identity');return Object.freeze({receiverId:input.receiverId,receiverInstanceEpoch:input.receiverInstanceEpoch,keyId:input.keyId});}
function request(raw:UploadRequestBinding){if(!raw||Object.keys(raw).sort().join(',')!=='challenge,requestHash'||!hash(raw.requestHash)||!hash(raw.challenge))throw Error('receiver_upload_request');return {requestHash:raw.requestHash,challenge:raw.challenge};}
function progress(raw:UploadProgress):Readonly<UploadProgress>{if(!raw||Object.keys(raw).sort().join(',')!=='fullTupleHash,receivedBytes,totalBytes'||!hash(raw.fullTupleHash)||!Number.isSafeInteger(raw.totalBytes)||raw.totalBytes<0||raw.totalBytes>VERIFICATION_BUDGET.outboxPayloadBytes||!Number.isSafeInteger(raw.receivedBytes)||raw.receivedBytes<0||raw.receivedBytes>raw.totalBytes||(raw.totalBytes>0&&raw.receivedBytes===0))throw Error('receiver_upload_progress');return Object.freeze({...raw});}
/** Separate signature domain: an upload acknowledgement is never a publication reply. */
export function createReceiverUploadSigner(input:Identity&{privateKey:KeyObject}){
 const id=identity(input),key=input.privateKey;if(key.type!=='private'||key.asymmetricKeyType!=='ed25519')throw Error('receiver_upload_key');
 return Object.freeze({sign(binding:UploadRequestBinding,value:UploadProgress):SignedUploadReply{const payload=Object.freeze({...id,...request(binding),domain:'xiaok.receiver.upload.v1' as const,progress:progress(value)});return Object.freeze({payload,signature:sign(null,Buffer.from(json(payload)),key).toString('base64')});}});
}
export function createReceiverUploadVerifier(input:Identity&{publicKey:KeyObject}){
 const id=identity(input),key=input.publicKey;if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')throw Error('receiver_upload_key');
 return Object.freeze({verify(raw:SignedUploadReply,binding:UploadRequestBinding):Readonly<UploadProgress>{
  const expected=request(binding),value=JSON.parse(json(raw)) as SignedUploadReply,p=value?.payload;
  if(!value||Object.keys(value).sort().join(',')!=='payload,signature'||typeof value.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(value.signature)||!p||Object.keys(p).sort().join(',')!=='challenge,domain,keyId,progress,receiverId,receiverInstanceEpoch,requestHash'||p.domain!=='xiaok.receiver.upload.v1'||p.keyId!==id.keyId||p.receiverId!==id.receiverId||p.receiverInstanceEpoch!==id.receiverInstanceEpoch||p.requestHash!==expected.requestHash||p.challenge!==expected.challenge||!verify(null,Buffer.from(json(p)),key,Buffer.from(value.signature,'base64')))throw Error('receiver_upload_signature');return progress(p.progress);
 }});
}
