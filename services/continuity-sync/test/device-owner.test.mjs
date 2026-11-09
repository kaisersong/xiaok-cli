import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {claimDeviceNamespace} from '../../continuity-device/src/device-lock.mjs';
import sodium from 'libsodium-wrappers';
import {coordinatorFixture} from './helpers/coordinator-fixture.mjs';
import {tls} from './helpers/tls-fixture.mjs';
import {startCoordinatorServer} from '../src/server.mjs';
import {AuthorityJournal} from '../src/journal.mjs';
import {CryptoOutbox,createDeviceOwnedOutbox} from '../src/outbox.mjs';
import {canonical,base64,hash,openEnvelope} from '../src/crypto.mjs';
import {CoordinatorClient} from '../src/transport.mjs';
import {createTestCredentialBackend} from '../../continuity-device/src/os-backend.mjs';
import {deviceOsAccountId} from '../../continuity-device/src/os-guard.mjs';
import {deviceJournalIdentity,deviceVaultAccountId,deviceRegistrationCommitment,openExistingDeviceOwner,openTestExistingDeviceOwner} from '../src/device-owner.mjs';
await sodium.ready;

function lastDeviceDecision(options){const db=new DatabaseSync(path.join(options.stateDir,'authority.sqlite'),{readOnly:true});try{return JSON.parse(db.prepare('SELECT entry FROM authority_journal ORDER BY sequence DESC LIMIT 1').get().entry);}finally{db.close();}}

async function fixture(t,{alterVault,missing,alterFloor,registryDir}={}){
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
test('existing owner catches up through actual TLS and OS-anchored journal but never issues a publication capability',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());
 assert.equal(owner.kind,'test-only-device-owner');
 const receipt=await owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});
 assert.equal(receipt.status,'verified-control-only');assert.deepEqual(receipt.head,f.f.journal.head());assert.ok(Object.isFrozen(receipt));
 owner.assertControlCurrent(receipt);
 assert.throws(()=>owner.assertControlCurrent(structuredClone(receipt)),/device_owner_unavailable/);
 assert.throws(()=>owner.assertPublicationCurrent(receipt),/sync_publication_unavailable/);
 assert.deepEqual(Object.keys(owner),[]);assert.equal(JSON.stringify(owner),'{}');
 for(const key of ['journal','guard','keyProvider','signingKey','contentKey'])assert.equal(key in owner,false,'no raw key/provider/journal escape hatch');
 assert.ok(f.writes>=2,'coordinator pin and full verified control must both advance original floor');
 await owner.close();assert.throws(()=>owner.assertControlCurrent(receipt),/device_owner_unavailable/);
 const reopened=f.open();t.after(()=>reopened.close());assert.throws(()=>reopened.assertControlCurrent(receipt),/device_owner_unavailable/);
 const next=await reopened.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'scheduler'});reopened.assertControlCurrent(next);
});
test('a new catch-up invalidates every original receipt and cannot use replaced public client methods',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());
 const first=await owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});
 const oldCall=CoordinatorClient.prototype.call,oldHead=CoordinatorClient.prototype.getHead;
 try{
  CoordinatorClient.prototype.call=()=>assert.fail('owner must use captured original TLS call');
  CoordinatorClient.prototype.getHead=()=>assert.fail('owner must use captured original fresh head');
  const pending=owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'agent'});
  assert.throws(()=>owner.assertControlCurrent(first),/device_owner_unavailable/);
  await assert.rejects(()=>owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'}),/device_owner_busy/);
  const current=await pending;owner.assertControlCurrent(current);
  await assert.rejects(()=>owner.sync({conversationId:'another',branchId:'branch'},{requestSource:'user'}));
  assert.throws(()=>owner.assertControlCurrent(current),/device_owner_unavailable/);
 }finally{CoordinatorClient.prototype.call=oldCall;CoordinatorClient.prototype.getHead=oldHead;}
});
test('missing either existing OS item and mismatching floors never initialize or repair state',{skip:process.platform==='win32'},async t=>{
 for(const options of [{missing:'vault'},{missing:'floor'},{alterFloor:floor=>floor.cryptoHead.hash='f'.repeat(64)}]){
  const f=await fixture(t,options);assert.throws(f.open,/device_owner_unavailable/);assert.equal(f.writes,0);
 }
});
test('vault seeds, registration and current root membership must all agree before unwrapping',{skip:process.platform==='win32'},async t=>{
 const malformed=await fixture(t,{alterVault:v=>v.signingSeed=base64(sodium.randombytes_buf(32))});assert.throws(malformed.open,/device_owner_unavailable/);assert.equal(malformed.writes,0);
 const foreignSeed=sodium.randombytes_buf(32),foreign=sodium.crypto_sign_seed_keypair(foreignSeed);
 const f=await fixture(t,{alterVault:v=>{v.signingSeed=base64(foreignSeed);v.registrationCommitment=deviceRegistrationCommitment({deviceId:'a',logicalProfileId:'logical',signingPublicKey:base64(foreign.publicKey),encryptionPublicKey:base64(sodium.crypto_scalarmult_base(Buffer.from(v.boxPrivateKey,'base64url')))});}});
 const owner=f.open();t.after(()=>owner.close());
 await assert.rejects(()=>owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'}));
 assert.throws(()=>owner.assertControlCurrent({status:'verified-control-only'}),/device_owner_unavailable/);
});
test('production factory cannot adopt a test identity or caller-supplied secrets/backends',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);assert.throws(()=>openExistingDeviceOwner(f.options),/device_owner_unavailable/);
 assert.throws(()=>openExistingDeviceOwner({...f.options,backendFactory:f.testOptions.backendFactory}),/device_owner_unavailable/);assert.equal(f.writes,0);
});
test('closing during the original held TLS response cannot publish a late receipt or overlap another job',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());let entered,release;
 const reached=new Promise(resolve=>entered=resolve);
 f.host.server.prependListener('request',(req,res)=>{if(req.url!=='/v1/head')return;const end=res.end;res.end=function(...args){release=()=>end.apply(res,args);entered();return res;};});
 const pending=owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});pending.catch(()=>{});
 await reached;
 await assert.rejects(()=>owner.sync({conversationId:'other',branchId:'branch'},{requestSource:'user'}),/device_owner_busy/);
 const closing=owner.close();release();await assert.rejects(()=>pending);await closing;
 assert.throws(()=>owner.assertControlCurrent({status:'verified-control-only'}),/device_owner_unavailable/);
});
test('native read reentry closes admission but retains the original journal and one external drain until the actual lease job settles',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());let entered,release,insideClose,triggered,observed;
 const reached=new Promise(resolve=>entered=resolve),readTriggered=new Promise(resolve=>triggered=resolve),journalObserved=new Promise(resolve=>observed=resolve);
 f.host.server.prependListener('request',(req,res)=>{if(req.url!=='/v1/head')return;const end=res.end;res.end=function(...args){release=()=>end.apply(res,args);entered();return res;};});
 const pending=owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});pending.catch(()=>{});await reached;
 f.setReadHook(()=>{
  f.setReadHook(undefined);insideClose=owner.close();insideClose.catch(()=>{});triggered();
  queueMicrotask(()=>{
   let journal,locked=false;try{journal=new AuthorityJournal({...f.options,identity:deviceJournalIdentity(f.f.identity,'a')});}catch{locked=true;}finally{journal?.close();}
   observed(locked);
  });
 });
 release();await readTriggered;const external=owner.close();assert.equal(external,insideClose,'same original completion from a shutdown scope');
 assert.equal(await journalObserved,true,'journal cannot be released by an inside-ALS rejected drain');
 await assert.rejects(()=>pending);await external;
});
for(const stage of ['before','after'])test(`control commit never publishes across an OS floor ${stage}-write failure`,{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());const account=deviceOsAccountId(f.f.identity,'a');
 f.setWriteHook((id,at)=>{if(id===account&&at===stage)throw new Error('synthetic OS floor write uncertainty');});
 await assert.rejects(()=>owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'}));
 assert.throws(()=>owner.assertControlCurrent({status:'verified-control-only'}),/device_owner_unavailable/);
 await owner.close();f.setWriteHook(undefined);
 if(stage==='before')assert.throws(f.open,/device_owner_unavailable/,'advanced body cannot repair the old OS floor');
 else{
  const reopened=f.open();t.after(()=>reopened.close());
  assert.throws(()=>reopened.assertControlCurrent({status:'verified-control-only'}),/device_owner_unavailable/);
  const next=await reopened.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});reopened.assertControlCurrent(next);
 }
});
test('restoring both local body and file witness cannot roll back the original OS control floor',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());const backup=path.join(path.dirname(f.options.stateDir),'device-rollback-backup');fs.mkdirSync(backup,{mode:0o700});
 for(const [source,name]of [[f.options.stateDir,'body'],[f.options.witnessDir,'witness']])fs.cpSync(source,path.join(backup,name),{recursive:true});
 const receipt=await owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});owner.assertControlCurrent(receipt);await owner.close();
 for(const [target,name]of [[f.options.stateDir,'body'],[f.options.witnessDir,'witness']]){fs.rmSync(target,{recursive:true});fs.cpSync(path.join(backup,name),target,{recursive:true});}
 const before=f.writes;assert.throws(f.open,/device_owner_unavailable/);assert.equal(f.writes,before,'no OS rollback or recreation');
});

// Deliberate uncertainty retains native locks until this isolated worker exits.
// Never poison the surrounding test runner's device namespace.
test('native construction uncertainty retains the whole device namespace until worker exit',{skip:process.platform==='win32',timeout:20000},async t=>{
 if(process.env.XIAOK_DEVICE_UNKNOWN_WORKER!=='1'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-uncertain-worker-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const env={...process.env,XIAOK_DEVICE_UNKNOWN_WORKER:'1',XIAOK_DEVICE_UNKNOWN_ROOT:root};delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,['--test','--test-name-pattern=^native construction uncertainty retains the whole device namespace until worker exit$',fileURLToPath(import.meta.url)],{env,stdio:['ignore','pipe','pipe'],detached:true});
  t.diagnostic(`owned uncertain-device worker PID ${child.pid}`);let output='';
  child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
  const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},15000);
  const result=await new Promise(resolve=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',error=>resolve({error}));});clearTimeout(timer);
  assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});assert.throws(()=>process.kill(-child.pid,0),{code:'ESRCH'});
  t.diagnostic(`owned uncertain-device worker PID ${child.pid} reaped`);
  assert.equal(result.code,0,output);assert.match(output,/ORIGINAL_DEVICE_NAMESPACE_RETAINED/);
  const identity=JSON.parse(fs.readFileSync(path.join(root,'public-identity.json'),'utf8'));
  const next=claimDeviceNamespace({identity,deviceId:'a',testRegistryDir:path.join(root,'registry')});next.close();await next.drainClosed();
  t.diagnostic('DEVICE_NAMESPACE_AVAILABLE_ONLY_AFTER_WORKER_EXIT');return;
 }
 const root=process.env.XIAOK_DEVICE_UNKNOWN_ROOT;assert.ok(path.isAbsolute(root));
 const f=await fixture(t,{registryDir:path.join(root,'registry')}),owner=f.open();
 fs.writeFileSync(path.join(root,'public-identity.json'),JSON.stringify(f.f.identity),{mode:0o600});
 t.mock.method(https,'request',()=>{throw new Error('synthetic_native_construction_unknown');});
 await assert.rejects(()=>owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'}));
 await assert.rejects(()=>owner.close(),/transport_construction_uncertain/);
 assert.throws(()=>owner.assertControlCurrent({}),/device_owner_unavailable/);
 await assert.rejects(()=>owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'}),/device_owner_unavailable/);
 let competing;
 try{assert.throws(()=>{competing=claimDeviceNamespace({identity:f.f.identity,deviceId:'a',testRegistryDir:f.testOptions.testRegistryDir});},/device_owner_unavailable/,'unknown native descriptor must retain device-wide lock regardless of chosen journal path');}
 finally{competing?.close();}
 t.diagnostic('ORIGINAL_DEVICE_NAMESPACE_RETAINED');
});

test('original owner privately seals outgoing bytes through TLS permit and reuses only identical persisted ciphertext across restart',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);let owner=f.open();t.after(()=>owner.close());let count=0;const encrypt=sodium.crypto_aead_xchacha20poly1305_ietf_encrypt;t.mock.method(sodium,'crypto_aead_xchacha20poly1305_ietf_encrypt',(...args)=>{count++;return encrypt(...args);});
 const scope={conversationId:'conversation',branchId:'branch'},input={eventId:'outgoing-original',payload:{text:'ORIGINAL_OWNER_ENCRYPTED'},parentRevision:0,eventType:'message'};
 const first=await owner.sealOutgoing(scope,input,{requestSource:'user'});assert.equal(first.status,'sealed-outgoing-only');assert.equal(typeof first.wire,'string');const envelope=JSON.parse(first.wire);assert.equal(hash(envelope),first.eventHash);assert.equal(envelope.header.originDeviceId,'a');assert.equal(openEnvelope({envelope,contentKey:f.f.material.contentKey,salt:f.f.material.salt,signingPublicKey:f.f.devices.a.sign.publicKey,expected:envelope.header}).text,input.payload.text);assert.equal(count,1);
 const again=await owner.sealOutgoing(scope,input,{requestSource:'agent'});assert.equal(again.wire,first.wire);assert.equal(count,1);await owner.close();owner=f.open();
 const reopened=await owner.sealOutgoing(scope,input,{requestSource:'scheduler'});assert.equal(reopened.wire,first.wire);assert.equal(count,1);assert.equal(JSON.parse(reopened.wire).header.sourceEpoch,envelope.header.sourceEpoch);
 assert.throws(()=>owner.assertPublicationCurrent(first),/sync_publication_unavailable/);for(const key of ['outbox','journal','guard','keyProvider','signingKey','contentKey'])assert.equal(key in owner,false);
});
test('outgoing caller cannot select source epoch, origin, profile, raw tuple or synchronous encryption mode',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());const before=f.writes,scope={conversationId:'conversation',branchId:'branch'},input={eventId:'outgoing-extra',payload:{text:'fixture'},parentRevision:0,eventType:'message'};
 for(const extra of [{sourceEpoch:'spoof'},{originDeviceId:'b'},{logicalProfileId:'foreign'},{tuple:{}},{mode:'sync'}])await assert.rejects(()=>owner.sealOutgoing(scope,{...input,...extra},{requestSource:'user'}));assert.equal(f.writes,before);
 await assert.rejects(()=>owner.sealOutgoing(scope,input,{}),/request_source_required/);assert.equal(f.writes,before);
});
test('closing during actual outgoing one-use permit returns no wire and never reaches AEAD',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());let entered,release,count=0;const reached=new Promise(resolve=>entered=resolve),encrypt=sodium.crypto_aead_xchacha20poly1305_ietf_encrypt;t.mock.method(sodium,'crypto_aead_xchacha20poly1305_ietf_encrypt',(...args)=>{count++;return encrypt(...args);});f.host.server.prependListener('request',(req,res)=>{if(req.url!=='/v1/key-use/consume')return;const end=res.end;res.end=function(...args){release=()=>end.apply(res,args);entered();return res;};});
 const pending=owner.sealOutgoing({conversationId:'conversation',branchId:'branch'},{eventId:'outgoing-held',payload:{text:'never escapes'},parentRevision:0,eventType:'message'},{requestSource:'user'});pending.catch(()=>{});await reached;const closing=owner.close();release();await assert.rejects(()=>pending);await closing;assert.equal(count,0);
});
test('outgoing initialization cannot adopt a missing publication epoch when original journal already contains non-control history',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),initialOwner=f.open();await initialOwner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});await initialOwner.close();const journal=new AuthorityJournal({...f.options,identity:deviceJournalIdentity(f.f.identity,'a')});const old=journal.head();journal.transact({operationId:'old-publication-history',kind:'crypto_mark_encrypting',request:{}},tx=>{tx.set('outgoing-old-history',{unknown:true});return null;});const after=journal.head();journal.close();const account=deviceOsAccountId(f.f.identity,'a'),floor=JSON.parse(f.accounts.get(account).toString());assert.deepEqual(floor.cryptoHead,old);floor.cryptoHead=after;f.accounts.set(account,Buffer.from(canonical(floor)));const owner=f.open();t.after(()=>owner.close());
 await assert.rejects(()=>owner.sealOutgoing({conversationId:'conversation',branchId:'branch'},{eventId:'no-fresh-epoch',payload:{},parentRevision:0,eventType:'message'},{requestSource:'user'}));
});

test('an original owner does not export or reopen its one-use private outbox construction',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());let reads=0,nonces=0;
 const options={journal:{head(){reads++;throw new Error('foreign journal');}},guard:{kind:'os-protected',read(){reads++;throw new Error('foreign guard');},advance(){reads++;}},keyProvider(){reads++;throw new Error('foreign provider');},coordinatorIdentity:f.f.identity,randomNonce(){nonces++;return Buffer.alloc(24);}};
 const before=f.writes;
 for(const proposed of [undefined,{},structuredClone(owner),new Proxy(owner,{}),owner]){
  assert.throws(()=>createDeviceOwnedOutbox(proposed,options),{code:'verified_device_owner_required'});
 }
 assert.equal(reads,0);assert.equal(nonces,0);assert.equal(f.writes,before);
});

test('the private owner facade retains original outbox and local journal methods after public prototype replacement',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());
 const identityHash=hash(deviceJournalIdentity(f.f.identity,'a')),head=AuthorityJournal.prototype.head;
 for(const method of ['reserve','sealOnline','takeReady'])t.mock.method(CryptoOutbox.prototype,method,()=>assert.fail('public outbox prototype cannot hijack the private facade'));
 for(const method of ['head','get','transact','readJournal']){
  const original=AuthorityJournal.prototype[method];t.mock.method(AuthorityJournal.prototype,method,function(...args){if(head.call(this).identityHash===identityHash)assert.fail('public journal prototype cannot change owner facts');return original.apply(this,args);});
 }
 const outgoing=await owner.sealOutgoing({conversationId:'conversation',branchId:'branch'},{eventId:'captured-originals',payload:{text:'CAPTURED_ORIGINALS'},parentRevision:0,eventType:'message'},{requestSource:'user'});
 const envelope=JSON.parse(outgoing.wire);assert.equal(openEnvelope({envelope,contentKey:f.f.material.contentKey,salt:f.f.material.salt,signingPublicKey:f.f.devices.a.sign.publicKey,expected:envelope.header}).text,'CAPTURED_ORIGINALS');
});

for(const stage of ['before','after'])test(`outgoing publication epoch survives only the original OS floor ${stage}-write outcome`,{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);let owner=f.open();t.after(()=>owner.close());await owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'});
 let tripped=false,epoch,count=0;const account=deviceOsAccountId(f.f.identity,'a'),encrypt=sodium.crypto_aead_xchacha20poly1305_ietf_encrypt;t.mock.method(sodium,'crypto_aead_xchacha20poly1305_ietf_encrypt',(...args)=>{count++;return encrypt(...args);});
 f.setWriteHook((id,at)=>{
  if(id!==account||at!==stage||tripped)return;
  const last=lastDeviceDecision(f.options);
  if(last.kind==='crypto_publication_source_init'){tripped=true;epoch=last.request.publicationEpoch;throw new Error('synthetic publication epoch floor uncertainty');}
 });
 const scope={conversationId:'conversation',branchId:'branch'},request={eventId:'epoch-floor-outcome',payload:{text:'only after actual floor'},parentRevision:0,eventType:'message'};
 await assert.rejects(()=>owner.sealOutgoing(scope,request,{requestSource:'user'}));assert.equal(tripped,true);assert.equal(count,0);await owner.close();f.setWriteHook(undefined);
 if(stage==='before')assert.throws(f.open,/device_owner_unavailable/);
 else{owner=f.open();const outgoing=await owner.sealOutgoing(scope,request,{requestSource:'user'});assert.equal(JSON.parse(outgoing.wire).header.sourceEpoch,epoch);assert.equal(count,1);}
});

test('closing reentrantly from a native floor write before a one-use permit prevents AEAD and ciphertext return',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),owner=f.open();t.after(()=>owner.close());let closing,tripped=false,count=0;const account=deviceOsAccountId(f.f.identity,'a'),encrypt=sodium.crypto_aead_xchacha20poly1305_ietf_encrypt;t.mock.method(sodium,'crypto_aead_xchacha20poly1305_ietf_encrypt',(...args)=>{count++;return encrypt(...args);});
 f.setWriteHook((id,at)=>{if(id!==account||at!=='after'||tripped)return;if(lastDeviceDecision(f.options).kind==='crypto_online_permit'){tripped=true;closing=owner.close();closing.catch(()=>{});}});
 await assert.rejects(()=>owner.sealOutgoing({conversationId:'conversation',branchId:'branch'},{eventId:'permit-native-reentry',payload:{text:'never returned'},parentRevision:0,eventType:'message'},{requestSource:'user'}));assert.equal(tripped,true);assert.equal(count,0);assert.equal(owner.close(),closing);await closing;
});

for(const first of ['device-owner','outbox'])test(`fresh Node ESM initialization supports ${first} as the first module`,{timeout:15000},async t=>{
 const second=first==='outbox'?'device-owner':'outbox',moduleUrl=name=>new URL(`../src/${name}.mjs`,import.meta.url).href;
 const script=`const first=await import(${JSON.stringify(moduleUrl(first))});const second=await import(${JSON.stringify(moduleUrl(second))});if(typeof (first.openExistingDeviceOwner??second.openExistingDeviceOwner)!=='function'||typeof (first.createDeviceOwnedOutbox??second.createDeviceOwnedOutbox)!=='function')throw Error('missing original entry');console.log('FRESH_ESM_ORDER_QUALIFIED');`;
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,['--input-type=module','--eval',script],{env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});t.diagnostic(`owned ESM initialization PID ${child.pid}`);let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
 const timer=setTimeout(()=>{try{process.kill(process.platform==='win32'?child.pid:-child.pid,'SIGKILL');}catch{}},10000);
 const result=await new Promise(resolve=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',error=>resolve({error}));});clearTimeout(timer);
 assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});if(process.platform!=='win32')assert.throws(()=>process.kill(-child.pid,0),{code:'ESRCH'});t.diagnostic(`owned ESM initialization PID ${child.pid} reaped`);assert.equal(result.code,0,output);assert.match(output,/FRESH_ESM_ORDER_QUALIFIED/);
});
