import assert from 'node:assert/strict';
import path from 'node:path';
import sodium from 'libsodium-wrappers';
import {coordinatorFixture} from './coordinator-fixture.mjs';
import {tls} from './tls-fixture.mjs';
import {startCoordinatorServer} from '../../src/server.mjs';
import {AuthorityJournal} from '../../src/journal.mjs';
import {canonical,base64,hash} from '../../src/crypto.mjs';
import {createTestCredentialBackend} from '../../../continuity-device/src/os-backend.mjs';
import {deviceOsAccountId} from '../../../continuity-device/src/os-guard.mjs';
import {deviceJournalIdentity,deviceVaultAccountId,deviceRegistrationCommitment,openTestExistingDeviceOwner} from '../../src/device-owner.mjs';
await sodium.ready;
export async function sourceOwnerFixture(t,{alterVault,missing,alterFloor,registryDir}={}){
 const f=coordinatorFixture(t,{keyUse:true}),credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const options={identity:f.identity,deviceId:'a',logicalProfileId:'logical',baseUrl:host.url,ca:credentials.cert,stateDir:path.join(path.dirname(f.opts.stateDir),'device-body'),witnessDir:path.join(path.dirname(f.opts.stateDir),'device-witness')};
 const journal=new AuthorityJournal({...options,identity:deviceJournalIdentity(f.identity,'a'),initialize:true});const initial=journal.head();journal.close();
 const seed=f.devices.a.sign.privateKey.slice(0,sodium.crypto_sign_SEEDBYTES);assert.deepEqual(sodium.crypto_sign_seed_keypair(seed).publicKey,f.devices.a.sign.publicKey);
 const vault={schemaVersion:1,identityHash:hash(f.identity),deviceId:'a',logicalProfileId:'logical',signingSeed:base64(seed),boxPrivateKey:base64(f.devices.a.box.privateKey),registrationCommitment:deviceRegistrationCommitment({deviceId:'a',logicalProfileId:'logical',signingPublicKey:base64(f.devices.a.sign.publicKey),encryptionPublicKey:base64(f.devices.a.box.publicKey)})};seed.fill(0);
 alterVault?.(vault);
 const floor={schemaVersion:1,identityHash:hash(f.identity),deviceId:'a',cryptoHead:initial};alterFloor?.(floor);
 const accounts=new Map([[deviceVaultAccountId(f.identity,'a'),Buffer.from(canonical(vault))],[deviceOsAccountId(f.identity,'a'),Buffer.from(canonical(floor))]]);
 if(missing==='vault')accounts.delete(deviceVaultAccountId(f.identity,'a'));if(missing==='floor')accounts.delete(deviceOsAccountId(f.identity,'a'));
 let writes=0,readHook,writeHook;
 const testOptions={testRegistryDir:registryDir??path.join(path.dirname(f.opts.stateDir),'device-registry'),backendFactory:accountId=>createTestCredentialBackend({getSecret:()=>{readHook?.();return accounts.get(accountId)??null;},setSecret:bytes=>{writes++;writeHook?.(accountId,'before');accounts.set(accountId,Buffer.from(bytes));writeHook?.(accountId,'after');}},{accountId})};
 const open=()=>openTestExistingDeviceOwner(options,testOptions);
 return {f,host,options,testOptions,open,accounts,setReadHook(hook){readHook=hook;},setWriteHook(hook){writeHook=hook;},get writes(){return writes;}};
}
