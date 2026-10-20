import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {coordinatorFixture} from '../../continuity-sync/test/helpers/coordinator-fixture.mjs';
import {canonical,hash,sign} from '../../continuity-sync/src/crypto.mjs';
import {AuthorityJournal} from '../../continuity-sync/src/journal.mjs';
import {CryptoOutbox} from '../../continuity-sync/src/outbox.mjs';
import {claimDeviceNamespace} from '../src/device-lock.mjs';
import {openOsCredentialBackend,createTestCredentialBackend} from '../src/os-backend.mjs';
import {deviceOsAccountId,openOsOutboxGuard,openTestOsOutboxGuard} from '../src/os-guard.mjs';

test('actual production OS guard cannot downgrade, change coordinator/device, or substitute an account',{
 skip:process.env.XIAOK_RUN_OS_GUARD_QUALIFICATION!=='1'||process.platform!=='darwin',timeout:30000,
},async t=>{
 const f=coordinatorFixture(t),identity=structuredClone(f.identity),deviceId='guard-test-'+randomUUID();
 identity.certificate.body.deploymentMode='self-hosted';identity.certificate.signature=sign(['xiaok/context-sync/coordinator-certificate/v1',identity.certificate.body],f.root.privateKey);
 const lease=claimDeviceNamespace({identity,deviceId}),accountId=deviceOsAccountId(identity,deviceId);
 let backend,journal,entry,writeAttempted=false;
 try{
 backend=openOsCredentialBackend({accountId});
 journal=new AuthorityJournal({stateDir:path.join(path.dirname(f.opts.stateDir),'real-guard-outbox'),witnessDir:path.join(path.dirname(f.opts.stateDir),'real-guard-witness'),identity:{kind:'synthetic-real-OS-test',identityHash:hash(identity),deviceId},initialize:true});
 const require=createRequire(import.meta.url),{Entry}=require(`@napi-rs/keyring-darwin-${process.arch}`);entry=new Entry('xiaok.continuity.device.v1',accountId);
  assert.equal(backend.read(),null);writeAttempted=true;backend.createInitial(Buffer.from(canonical({schemaVersion:1,identityHash:hash(identity),deviceId,cryptoHead:journal.head()})));
  const guard=openOsOutboxGuard({identity,deviceId,lease,backend}),before=journal.head();
  const context={...f.material,signingKey:f.devices.a.sign.privateKey,tuple:{rootKeyId:identity.rootKeyId,syncGroupId:identity.syncGroupId,conversationId:'conversation',branchId:'branch',keyEpoch:1,contentEpoch:1,originDeviceId:deviceId},membershipEpoch:1,sourceEpoch:'source'};
  const options={journal,guard,coordinatorIdentity:identity,keyProvider:()=>context};
  assert.throws(()=>new CryptoOutbox({...options,testOnly:true}),/os_guard_unavailable/);assert.deepEqual(journal.head(),before);
  const foreign=structuredClone(identity);foreign.coordinatorId='other';foreign.certificate.body.coordinatorId='other';foreign.certificate.signature=sign(['xiaok/context-sync/coordinator-certificate/v1',foreign.certificate.body],f.root.privateKey);
  assert.throws(()=>new CryptoOutbox({...options,coordinatorIdentity:foreign}),/crypto_unavailable/);assert.deepEqual(journal.head(),before);
  assert.throws(()=>openTestOsOutboxGuard({identity,deviceId,lease,backend:createTestCredentialBackend({getSecret:()=>null,setSecret:()=>assert.fail('must not write')},{accountId})}),/os_guard_unavailable/);
  let providerReads=0,nonces=0;const originalHead=journal.head();assert.throws(()=>new CryptoOutbox({...options,keyProvider(){providerReads++;return context;},randomNonce(){nonces++;return Buffer.alloc(24,4);}}),{code:'verified_device_owner_required'});assert.equal(providerReads,0);assert.equal(nonces,0);assert.deepEqual(journal.head(),originalHead);
  for(const testOnly of ['yes',1,{},[],null])assert.throws(()=>new CryptoOutbox({...options,testOnly,keyProvider(){providerReads++;return context;},randomNonce(){nonces++;return Buffer.alloc(24,4);}}),{code:'verified_device_owner_required'});
  assert.equal(providerReads,0);assert.equal(nonces,0);assert.deepEqual(journal.head(),originalHead);
  // Production construction now requires the actual private DeviceOwner. The
  // old caller-provider positive path is intentionally unavailable. Origin/no
  // synchronous-encryption invariants now run through device-owner-real.test.
  assert.throws(()=>openOsOutboxGuard({identity:foreign,deviceId,lease,backend}),/os_guard_unavailable/);
  assert.equal(nonces,0);
  assert.deepEqual(guard.read(),journal.head());
  console.info('REAL_OS_GUARD_QUALIFIED',JSON.stringify({identityHash:hash(identity),accountId,deviceId,coordinatorBound:true,deviceBound:true,productionDowngradeDenied:true}));
 }finally{
  backend?.close();journal?.close();lease.close();await lease.drainClosed();
  try{
   if(writeAttempted){if(entry.getSecret()!==null)assert.equal(entry.deleteCredential(),true);assert.equal(entry.getSecret(),null);}
  }finally{
   const filename=hash(['xiaok/context-sync/device-owner/v1',identity.rootKeyId,identity.syncGroupId,deviceId])+'.sqlite';fs.unlinkSync(path.join(os.userInfo().homedir,'.xiaok-continuity-devices-v1',filename));
  }
 }
});
