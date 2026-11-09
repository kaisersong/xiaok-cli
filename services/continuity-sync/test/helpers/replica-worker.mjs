// Test host wiring only. File guards below are explicitly test-only, never production OS storage.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthorityJournal } from '../../src/journal.mjs';
import { CryptoOutbox } from '../../src/outbox.mjs';
import { CoordinatorClient } from '../../src/transport.mjs';
import { fetchVerifiedScope } from '../../src/sync-driver.mjs';
import { base64,canonical,hash,openEnvelope,sign,unbase64,unwrapKeyManifest } from '../../src/crypto.mjs';
import { privateDirectory,syncDirectory } from '../../src/private-files.mjs';
let config,client,journal,inbox,box,context=null,signingKey,boxPublicKey,boxSecretKey;
function testGuard(filename){return {kind:'test-only',read(){try{return JSON.parse(fs.readFileSync(filename,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}},advance(expected,next){if(canonical(this.read())!==canonical(expected))throw new Error('test_guard_conflict');const temporary=filename+'.'+randomUUID();const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);try{fs.writeFileSync(fd,canonical(next));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,filename);syncDirectory(path.dirname(filename));}};}
function stop(){client?.close();journal?.close();inbox?.close();signingKey?.fill(0);boxSecretKey?.fill(0);context?.contentKey.fill(0);context=null;}
async function sync(){
 context?.contentKey.fill(0);context=null;
 const floor=testGuard(path.join(config.directory,'test-control-floor.json'));
 if(floor.read()===null)throw new Error('test_control_floor_missing');
 const result=await fetchVerifiedScope({client,identity:config.identity,deviceId:config.deviceId,scope:config.scope,minimumHead:floor.read(),pageSize:2});
 // Durable floor precedes every unwrap/AEAD; a partial page never reaches this point.
 floor.advance(floor.read(),result.head);
 const unwrap=(membership,manifest)=>unwrapKeyManifest({manifest,membership:membership.body,deviceId:config.deviceId,encryptionPublicKey:boxPublicKey,encryptionPrivateKey:boxSecretKey,rootPublicKey:unbase64(config.identity.rootPublicKey,32),expected:{rootKeyId:config.identity.rootKeyId,syncGroupId:config.identity.syncGroupId,membershipEpoch:membership.body.membershipEpoch,keyEpoch:membership.body.keyEpoch,contentEpoch:manifest.contentEpoch,membershipHash:hash(membership.body)}});
 const opened=[];
 for(const event of result.events){
  const {contentKey:key}=unwrap(event.membership,event.keyManifest);let payload;
  try{payload=openEnvelope({envelope:event.envelope,contentKey:key,salt:unbase64(event.keyManifest.salt,32),signingPublicKey:unbase64(event.membership.body.devices.find(d=>d.deviceId===event.envelope.header.originDeviceId).signingPublicKey,32),expected:{rootKeyId:config.identity.rootKeyId,syncGroupId:config.identity.syncGroupId,...config.scope,keyEpoch:event.envelope.header.keyEpoch,contentEpoch:event.envelope.header.contentEpoch,originDeviceId:event.envelope.header.originDeviceId}});}finally{key.fill(0);}
  // Synthetic test payload is returned for assertions; durable inbox retains ciphertext only.
  opened.push({origin:event.envelope.header.originDeviceId,sequence:event.envelope.header.originSequence,eventHash:event.eventHash,payload});
  if(inbox.get('event:'+event.eventHash)===undefined)inbox.transact({operationId:event.eventHash,kind:'test_cipher_inbox',request:{eventHash:event.eventHash}},tx=>{tx.set('event:'+event.eventHash,event);return null;});
 }
 const {contentKey}=unwrap(result.membership,result.keyManifest);
 context={contentKey,salt:unbase64(result.keyManifest.salt,32),signingKey,tuple:{rootKeyId:config.identity.rootKeyId,syncGroupId:config.identity.syncGroupId,...config.scope,keyEpoch:result.membership.body.keyEpoch,contentEpoch:result.keyManifest.contentEpoch,originDeviceId:config.deviceId},membershipEpoch:result.membership.body.membershipEpoch,sourceEpoch:'synthetic-source'};
 return {head:result.head,opened};
}
async function command(message){
 if(message.command==='start'){
  config=message.config;privateDirectory(config.directory);signingKey=unbase64(config.signingKey,64);boxPublicKey=unbase64(config.boxPublicKey,32);boxSecretKey=unbase64(config.boxSecretKey,32);
  client=new CoordinatorClient({baseUrl:config.baseUrl,identity:config.identity,deviceId:config.deviceId,signingKey,ca:config.ca});
  const make=(kind)=>new AuthorityJournal({stateDir:path.join(config.directory,kind+'-body'),witnessDir:path.join(config.directory,kind+'-witness'),identity:{kind:'explicit-test-'+kind,deviceId:config.deviceId,profileId:config.profileId},initialize:config.initialize});
  journal=make('outbox');inbox=make('inbox');const guard=testGuard(path.join(config.directory,'test-crypto-floor.json'));
  box=new CryptoOutbox({journal,guard,testOnly:true,initialize:config.initialize,keyProvider(){if(!context)throw new Error('heads_unverified');return context;}});
  const floor=testGuard(path.join(config.directory,'test-control-floor.json'));if(config.initialize)floor.advance(null,{identityHash:hash(config.identity),sequence:0,hash:hash(['xiaok/context-sync/authority-genesis/v2',config.identity])});else if(floor.read()===null)throw new Error('test_control_floor_missing');
  return {profileId:config.profileId,deviceId:config.deviceId,pid:process.pid};
 }
 if(message.command==='sync')return sync();
 if(message.command==='beginPairing'){const head=await client.getHead();return (await client.call('/v1/pairings/begin',{joiningDevice:message.joiningDevice},{expectedHead:head.response.body.result.head,requestSource:'user'})).body.result.pairing;}
 if(message.command==='signPairing')return sign(['xiaok/context-sync/pairing/v1',message.body],signingKey);
 if(message.command==='cachedWire')return base64(box.takeReady(message.eventId));
 if(message.command==='push'){
  const verified=await sync();const record=box.reserve({eventId:message.eventId,payload:message.payload,parentRevision:0,eventType:'message'});if(record.status==='reserved')box.seal(message.eventId);const wire=box.takeReady(message.eventId);
  const response=await client.call('/v1/events/push',{envelope:JSON.parse(wire)},{expectedHead:verified.head,requestId:message.eventId,requestSource:'user'});return {wire:base64(wire),accepted:response.body.result.accepted};
 }
 if(message.command==='stop'){stop();return {stopped:true};}
 throw new Error('unknown_test_command');
}
let chain=Promise.resolve();process.on('message',message=>{chain=chain.then(async()=>{try{const result=await command(message);process.send({id:message.id,result},()=>{if(message.command==='stop')process.disconnect();});}catch(error){context?.contentKey.fill(0);context=null;process.send({id:message.id,error:error.message});}});});
process.on('disconnect',stop);process.on('SIGTERM',()=>{stop();process.exitCode=0;process.disconnect();});
