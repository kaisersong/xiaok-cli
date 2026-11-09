import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import sodium from 'libsodium-wrappers';
import { Coordinator } from '../../src/coordinator.mjs';
import { AuthorityJournal } from '../../src/journal.mjs';
import { base64,createKeyManifest,hash,hashBytes,sealEnvelope,sign,SUITE,verify } from '../../src/crypto.mjs';
await sodium.ready;
const ZERO='0'.repeat(64);
export function coordinatorFixture(t,{keyUse=false,deploymentMode='test'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-sync-coordinator-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:3}));
 const root=sodium.crypto_sign_keypair(),online=sodium.crypto_sign_keypair();
 const devices=Object.fromEntries(['a','b','c'].map(id=>[id,{sign:sodium.crypto_sign_keypair(),box:sodium.crypto_box_keypair()}]));
 const certBody={schemaVersion:1,rootKeyId:hashBytes(root.publicKey),syncGroupId:'group',coordinatorId:'coordinator',generation:1,deploymentMode,coordinatorPublicKey:base64(online.publicKey),capabilities:['head','receipt','authority',...(keyUse?['key-use-v1']:[])]};
 const certificate={body:certBody,signature:sign(['xiaok/context-sync/coordinator-certificate/v1',certBody],root.privateKey)};
 const identity={rootKeyId:certBody.rootKeyId,rootPublicKey:base64(root.publicKey),syncGroupId:'group',coordinatorId:'coordinator',certificate};
 const opts={stateDir:path.join(dir,'state'),witnessDir:path.join(dir,'witness'),identity};
 let journal,coordinator,record;
 const materials=new Map();
 function row(id,state='active',pairingId='bootstrap'){return {deviceId:id,state,role:id==='a'?'root':'member',signingPublicKey:base64(devices[id].sign.publicKey),encryptionPublicKey:base64(devices[id].box.publicKey),logicalProfileId:'logical',pairingId};}
 function membership(rows,previous=record){const body={schemaVersion:1,rootKeyId:identity.rootKeyId,syncGroupId:'group',coordinatorId:'coordinator',operationId:randomUUID(),membershipEpoch:(previous?.body.membershipEpoch??0)+1,keyEpoch:(previous?.body.keyEpoch??0)+1,previousHash:previous?hash(previous.body):ZERO,devices:rows};return {body,signature:sign(['xiaok/context-sync/membership/v1',body],root.privateKey)};}
 function manifest(r){if(!materials.has(r.body.operationId))materials.set(r.body.operationId,{contentKey:sodium.randombytes_buf(32),salt:sodium.randombytes_buf(32)});return createKeyManifest({rootKeyId:identity.rootKeyId,syncGroupId:'group',membership:r.body,contentEpoch:1,...materials.get(r.body.operationId),rootSigningKey:root.privateKey});}
 function open(initialize=false,extra={}){journal=new AuthorityJournal({...opts,...extra,initialize});coordinator=new Coordinator({journal,identity,signingKey:online.privateKey});return coordinator;}
 function close(){journal?.close();}t.after(close);
 function request(deviceId,route,body,{requestId=randomUUID(),expectedHead=journal.head()}={}){
  const challenge=coordinator.createChallenge({deviceId,...(route==='/v1/key-use/consume'?{clientNonce:base64(sodium.randombytes_buf(32))}:{})});assert.ok(verify(['xiaok/context-sync/challenge/v1',challenge.body],challenge.signature,online.publicKey));
  const auth={schemaVersion:1,method:'POST',path:route,rootKeyId:identity.rootKeyId,syncGroupId:'group',coordinatorId:'coordinator',deviceId,requestId,challengeId:challenge.body.challengeId,bodyHash:hash(body),expectedHead};
  return {method:'POST',path:route,auth,signature:sign(['xiaok/context-sync/request/v1',auth],devices[deviceId].sign.privateKey),body,requestSource:'user'};
 }
 function send(...args){const response=coordinator.handle(request(...args));assert.ok(verify(['xiaok/context-sync/response/v1',response.body],response.signature,online.publicKey));return response.body.result;}
 function grant(ids=['a'],revision=1,previousHash=ZERO){const body={schemaVersion:1,rootKeyId:identity.rootKeyId,syncGroupId:'group',coordinatorId:'coordinator',operationId:randomUUID(),conversationId:'conversation',branchId:'branch',logicalProfileId:'logical',ownerDeviceId:'a',allowedDeviceIds:ids,revision,previousHash};return {body,signature:sign(['xiaok/context-sync/scope/v1',body],root.privateKey)};}
 open(true);record=membership([row('a')]);coordinator.appendMembership({record,manifest:manifest(record),requestSource:'user'});const scope=grant();coordinator.registerScope({record:scope,requestSource:'user'});
 function event(origin='a',seq=1,previous=ZERO,payload={text:'ciphertext only'}){return sealEnvelope({header:{rootKeyId:identity.rootKeyId,syncGroupId:'group',conversationId:'conversation',branchId:'branch',originDeviceId:origin,keyEpoch:record.body.keyEpoch,contentEpoch:1,schemaVersion:1,cryptoSuite:SUITE,membershipEpoch:record.body.membershipEpoch,sourceEpoch:'source',originSequence:seq,previousEventHash:previous,parentRevision:0,eventType:'message',nonce:base64(sodium.randombytes_buf(24))},payload,...materials.get(record.body.operationId),signingKey:devices[origin].sign.privateKey});}
 function addB(){
  const result=send('a','/v1/pairings/begin',{joiningDevice:row('b','active','pending')});const body=result.pairing;
  coordinator.confirmPairing({pairingId:body.pairingId,sponsorSignature:sign(['xiaok/context-sync/pairing/v1',body],devices.a.sign.privateKey),joiningSignature:sign(['xiaok/context-sync/pairing/v1',body],devices.b.sign.privateKey),requestSource:'user'});
  const next=membership([row('a'),row('b','active',body.pairingId)]);coordinator.appendMembership({record:next,manifest:manifest(next),requestSource:'user'});record=next;
  coordinator.registerScope({record:grant(['a','b'],2,hash(scope.body)),requestSource:'user'});return body;
 }
 return {get coordinator(){return coordinator;},get journal(){return journal;},get record(){return record;},set record(r){record=r;},get material(){return materials.get(record.body.operationId);},root,online,devices,identity,opts,row,membership,manifest,request,send,event,addB,open,close,grant};
}
