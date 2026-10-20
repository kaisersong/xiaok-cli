import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import sodium from 'libsodium-wrappers';
import {coordinatorFixture} from './helpers/coordinator-fixture.mjs';
import {tls} from './helpers/tls-fixture.mjs';
import {startCoordinatorServer} from '../src/server.mjs';
import {AuthorityJournal} from '../src/journal.mjs';
import {canonical,base64,hash,openEnvelope} from '../src/crypto.mjs';
import {openOsCredentialBackend} from '../../continuity-device/src/os-backend.mjs';
import {deviceOsAccountId} from '../../continuity-device/src/os-guard.mjs';
import {deviceJournalIdentity,deviceVaultAccountId,deviceRegistrationCommitment,openExistingDeviceOwner} from '../src/device-owner.mjs';
await sodium.ready;

test('actual Aqua native vault and OS floor qualify the original existing owner across TLS, restart and deletion',{
 skip:process.env.XIAOK_RUN_OS_DEVICE_OWNER_QUALIFICATION!=='1'||process.platform!=='darwin',timeout:30000,
},async t=>{
 const f=coordinatorFixture(t,{keyUse:true,deploymentMode:'self-hosted'}),credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});
 const base=path.dirname(f.opts.stateDir),options={identity:f.identity,deviceId:'a',logicalProfileId:'logical',baseUrl:host.url,ca:credentials.cert,stateDir:path.join(base,'real-device-body'),witnessDir:path.join(base,'real-device-witness')};
 const accounts=[deviceVaultAccountId(f.identity,'a'),deviceOsAccountId(f.identity,'a')];
 const entries=[],backends=[];
 const attempted=new Set();let journal,owner;
 try{
  const require=createRequire(new URL('../../continuity-device/src/os-backend.mjs',import.meta.url)),{Entry}=require(`@napi-rs/keyring-darwin-${process.arch}`);
  for(const accountId of accounts){entries.push(new Entry('xiaok.continuity.device.v1',accountId));backends.push(openOsCredentialBackend({accountId}));}
  journal=new AuthorityJournal({...options,identity:deviceJournalIdentity(f.identity,'a'),initialize:true});const head=journal.head();journal.close();journal=undefined;
  const seed=f.devices.a.sign.privateKey.slice(0,sodium.crypto_sign_SEEDBYTES);assert.deepEqual(sodium.crypto_sign_seed_keypair(seed).publicKey,f.devices.a.sign.publicKey);
  const records=[{schemaVersion:1,identityHash:hash(f.identity),deviceId:'a',logicalProfileId:'logical',signingSeed:base64(seed),boxPrivateKey:base64(f.devices.a.box.privateKey),registrationCommitment:deviceRegistrationCommitment({deviceId:'a',logicalProfileId:'logical',signingPublicKey:base64(f.devices.a.sign.publicKey),encryptionPublicKey:base64(f.devices.a.box.publicKey)})},{schemaVersion:1,identityHash:hash(f.identity),deviceId:'a',cryptoHead:head}];seed.fill(0);
  // Synthetic qualification setup only, not a production enrollment implementation.
  for(let i=0;i<records.length;i++){assert.equal(backends[i].read(),null);attempted.add(i);const bytes=Buffer.from(canonical(records[i]));try{backends[i].createInitial(bytes);}finally{bytes.fill(0);}}
  owner=openExistingDeviceOwner(options);assert.equal(owner.kind,'os-device-owner');
  const receipt=await owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});owner.assertControlCurrent(receipt);
  assert.deepEqual(receipt.head,f.journal.head());assert.throws(()=>owner.assertPublicationCurrent(receipt),/sync_publication_unavailable/);
  for(const key of ['journal','guard','keyProvider','signingKey','contentKey'])assert.equal(key in owner,false);
  const request={eventId:'real-os-outgoing',payload:{text:'REAL_OS_ORIGINAL_OWNER_OUTGOING'},parentRevision:0,eventType:'message'},outgoing=await owner.sealOutgoing({conversationId:'conversation',branchId:'branch'},request,{requestSource:'user'}),envelope=JSON.parse(outgoing.wire);
  assert.equal(outgoing.status,'sealed-outgoing-only');assert.equal(envelope.header.originDeviceId,'a');assert.equal(openEnvelope({envelope,contentKey:f.material.contentKey,salt:f.material.salt,signingPublicKey:f.devices.a.sign.publicKey,expected:envelope.header}).text,request.payload.text);
  const floorBefore=backends[1].read();try{for(const extra of [{originDeviceId:'b'},{tuple:{}},{logicalProfileId:'other'},{sourceEpoch:'reset'},{mode:'sync'}])await assert.rejects(()=>owner.sealOutgoing({conversationId:'conversation',branchId:'branch'},{...request,...extra},{requestSource:'user'}));assert.deepEqual(backends[1].read(),floorBefore);}finally{floorBefore.fill(0);}

  await owner.close();owner=openExistingDeviceOwner(options);assert.throws(()=>owner.assertControlCurrent(receipt),/device_owner_unavailable/);
  const next=await owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});owner.assertControlCurrent(next);const reopened=await owner.sealOutgoing({conversationId:'conversation',branchId:'branch'},request,{requestSource:'user'});assert.equal(reopened.wire,outgoing.wire);await owner.close();owner=undefined;
  for(const entry of entries){assert.equal(entry.deleteCredential(),true);assert.equal(entry.getSecret(),null);}
  assert.throws(()=>openExistingDeviceOwner(options),/device_owner_unavailable/);
  for(const entry of entries)assert.equal(entry.getSecret(),null,'opening an existing lost device never recreates OS state');
  console.info('REAL_EXISTING_DEVICE_OWNER_QUALIFIED',JSON.stringify({identityHash:hash(f.identity),accounts,controlOnly:true,tls:true,outgoingAead:true,noRawProvider:true,restart:true,missingNeverRecreated:true}));
 }finally{
  try{await owner?.close();}finally{
   journal?.close();for(const backend of backends)backend.close();
   try{for(const i of attempted){if(entries[i].getSecret()!==null)assert.equal(entries[i].deleteCredential(),true);assert.equal(entries[i].getSecret(),null);}}
   finally{
    await host.close();
    const filename=hash(['xiaok/context-sync/device-owner/v1',f.identity.rootKeyId,f.identity.syncGroupId,'a'])+'.sqlite';
    const lock=path.join(os.userInfo().homedir,'.xiaok-continuity-devices-v1',filename);if(fs.existsSync(lock))fs.unlinkSync(lock);
   }
  }
 }
});
