import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import sodium from 'libsodium-wrappers';
import { CryptoOutbox } from '../src/outbox.mjs';
import { AuthorityJournal } from '../src/journal.mjs';
import { canonical,hash,openEnvelope,SUITE } from '../src/crypto.mjs';
await sodium.ready;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-sync-outbox-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:3}));
 const options={stateDir:path.join(dir,'body'),witnessDir:path.join(dir,'witness'),identity:{kind:'crypto-fixture',deviceId:'a'}};
 // Explicitly test-only independent durable guard. This is not a production OS-protected implementation.
 const guardFile=path.join(dir,'test-guard.json');const guard={kind:'test-only',read(){return fs.existsSync(guardFile)?JSON.parse(fs.readFileSync(guardFile,'utf8')):null;},advance(expected,next){assert.deepEqual(this.read(),expected);const fd=fs.openSync(guardFile,'w',0o600);fs.writeFileSync(fd,canonical(next));fs.fsyncSync(fd);fs.closeSync(fd);}};
 const keys=sodium.crypto_sign_keypair();let current=true;
 const context={contentKey:new Uint8Array(32).fill(3),salt:new Uint8Array(32).fill(4),signingKey:keys.privateKey,tuple:{rootKeyId:'root',syncGroupId:'group',conversationId:'conversation',branchId:'branch',keyEpoch:1,contentEpoch:1,originDeviceId:'a'},membershipEpoch:1,sourceEpoch:'source'};
 let journal,box;
 function open({initialize=false,...extra}={}){journal=new AuthorityJournal({...options,initialize});box=new CryptoOutbox({journal,guard,testOnly:true,initialize,keyProvider(){if(!current)throw new Error('heads_unverified');return context;},...extra});return box;}
 function close(){journal?.close();}t.after(close);
 return {open,close,guard,guardFile,context,keys,options,get journal(){return journal;},setCurrent(value){current=value;}};
}
test('requires a qualified durable guard and never silently substitutes file storage',t=>{
 const f=fixture(t);assert.throws(()=>f.open({initialize:true,testOnly:false}),/os_guard_unavailable/);
});
test('production never recreates a missing OS head from an empty restored journal',t=>{
 const f=fixture(t);f.guard.kind='os-protected';assert.throws(()=>f.open({initialize:true,testOnly:false}),/crypto_unavailable/);
});
test('a forged os-protected kind with matching durable bytes never qualifies a production guard',t=>{
 const f=fixture(t);f.open({initialize:true});f.close();f.guard.kind='os-protected';
 assert.throws(()=>f.open({testOnly:false}),/crypto_unavailable|os_guard_unavailable/);
});
test('a production guard kind cannot enter the explicit synchronous test-only mode',t=>{
 const f=fixture(t);f.guard.kind='os-protected';assert.throws(()=>f.open({initialize:true,testOnly:true}),/os_guard_unavailable/);
});
test('reserves, seals and retransmits only immutable bytes across restart',t=>{
 const f=fixture(t);let box=f.open({initialize:true});box.reserve({eventId:'event1',payload:{text:'待执行输入'},parentRevision:0,eventType:'message'});
 assert.throws(()=>box.takeReady('event1'),/not_sealed/);const sealed=box.seal('event1');const wire=box.takeReady('event1');assert.equal(wire.toString(),canonical(sealed));
 f.close();box=f.open();assert.equal(box.takeReady('event1').toString(),wire.toString());assert.throws(()=>box.seal('event1'),/already_sealed/);
 assert.equal(openEnvelope({envelope:JSON.parse(wire),contentKey:f.context.contentKey,salt:f.context.salt,signingPublicKey:f.keys.publicKey,expected:f.context.tuple}).text,'待执行输入');
});
test('keeps a single winner and fixes payload/order before encryption',t=>{
 const f=fixture(t),box=f.open({initialize:true});const args={eventId:'event1',payload:{text:'one'},parentRevision:0,eventType:'message'};
 const a=box.reserve(args);assert.deepEqual(box.reserve(args),a);assert.throws(()=>box.reserve({...args,payload:{text:'two'}}),/event_conflict/);
 assert.throws(()=>box.reserve({...args,eventId:'event2'}),/stream_pending/);box.seal('event1');box.reserve({...args,eventId:'event2'});const b=box.seal('event2');assert.equal(b.header.originSequence,2);assert.equal(b.header.previousEventHash,hash(box.readSealed('event1')));
});
test('restarts burn unsealed reservations and use fresh nonces for the same logical input',t=>{
 const f=fixture(t);let box=f.open({initialize:true});const a=box.reserve({eventId:'event1',payload:{text:'same'},parentRevision:0,eventType:'message'});f.close();box=f.open();
 assert.throws(()=>box.seal('event1'),/reservation_from_old_boot/);const b=box.retryUnsealed('event1');assert.notEqual(b.nonce,a.nonce);assert.equal(b.payloadHash,a.payloadHash);assert.equal(b.header.originSequence,a.header.originSequence);box.seal('event1');
 assert.throws(()=>box.retryUnsealed('event1'),/already_sealed/);
});
test('a crash after encryption cannot encrypt the same reservation twice or expose in-memory bytes',t=>{
 const f=fixture(t);let failed=false;const box=f.open({initialize:true,fault(stage){if(stage==='encrypted'&&!failed){failed=true;throw new Error('crash_before_seal');}}});
 const a=box.reserve({eventId:'event1',payload:{text:'x'},parentRevision:0,eventType:'message'});assert.throws(()=>box.seal('event1'),/crash_before_seal/);assert.throws(()=>box.seal('event1'),/reservation_consumed/);assert.throws(()=>box.takeReady('event1'),/not_sealed/);
 const b=box.retryUnsealed('event1');assert.notEqual(b.nonce,a.nonce);box.seal('event1');assert.ok(box.takeReady('event1').length);
});
test('duplicate random nonce and CSPRNG failure poison before encryption',t=>{
 const f=fixture(t),box=f.open({initialize:true,randomNonce(){return Buffer.alloc(24,9);}});box.reserve({eventId:'event1',payload:{text:'x'},parentRevision:0,eventType:'message'});box.seal('event1');
 assert.throws(()=>box.reserve({eventId:'event2',payload:{text:'y'},parentRevision:0,eventType:'message'}),/crypto_unavailable/);assert.throws(()=>box.takeReady('event1'),/crypto_unavailable/);
});
test('CSPRNG error never falls back to a counter or weak random source',t=>{
 const f=fixture(t),box=f.open({initialize:true,randomNonce(){throw new Error('entropy_unavailable');}});
 assert.throws(()=>box.reserve({eventId:'event1',payload:{},parentRevision:0,eventType:'message'}),/crypto_unavailable/);
 assert.throws(()=>box.reserve({eventId:'event2',payload:{},parentRevision:0,eventType:'message'}),/crypto_unavailable/);
});
test('the per-derived-key budget stops before a 2^32+1 reservation',t=>{
 const f=fixture(t),box=f.open({initialize:true});const record=box.reserve({eventId:'event1',payload:{},parentRevision:0,eventType:'message'});box.seal('event1');
 const before=f.journal.head();f.journal.transact({operationId:'budget-fixture',kind:'fixture',request:{count:2**32}},tx=>{tx.set('count:'+record.derivedKeyId,2**32);return null;});f.guard.advance(before,f.journal.head());
 assert.throws(()=>box.reserve({eventId:'event2',payload:{},parentRevision:0,eventType:'message'}),/crypto_unavailable/);
});
test('guard write failure after body commit permanently closes this crypto owner',t=>{
 const f=fixture(t),box=f.open({initialize:true});f.guard.advance=()=>{throw new Error('os_store_unavailable');};
 assert.throws(()=>box.reserve({eventId:'event1',payload:{},parentRevision:0,eventType:'message'}),/crypto_unavailable/);
 assert.throws(()=>box.seal('event1'),/crypto_unavailable/);f.close();assert.throws(()=>f.open(),/crypto_unavailable/);
});
test('an async guard cannot admit encryption by updating only its cache',t=>{
 const f=fixture(t),box=f.open({initialize:true});let cached=f.guard.read();f.guard.read=()=>cached;f.guard.advance=async(_expected,next)=>{cached=next;};
 assert.throws(()=>box.reserve({eventId:'event1',payload:{},parentRevision:0,eventType:'message'}),/crypto_unavailable/);assert.throws(()=>box.seal('event1'),/crypto_unavailable/);
});
test('guard advance failure or guard rollback blocks encryption and old ready transmission',t=>{
 const f=fixture(t);let box=f.open({initialize:true});const old=fs.readFileSync(f.guardFile);box.reserve({eventId:'event1',payload:{text:'x'},parentRevision:0,eventType:'message'});box.seal('event1');fs.writeFileSync(f.guardFile,old);
 assert.throws(()=>box.takeReady('event1'),/crypto_unavailable/);f.close();assert.throws(()=>f.open(),/crypto_unavailable/);
});
test('unverified current membership/revocation heads block both new seal and retransmission',t=>{
 const f=fixture(t),box=f.open({initialize:true});box.reserve({eventId:'event1',payload:{text:'x'},parentRevision:0,eventType:'message'});box.seal('event1');f.setCurrent(false);
 assert.throws(()=>box.takeReady('event1'),/heads_unverified/);assert.throws(()=>box.reserve({eventId:'event2',payload:{},parentRevision:0,eventType:'message'}),/heads_unverified/);
});
test('retry cannot relabel an accepted payload into a new source or membership epoch',t=>{
 const f=fixture(t);let box=f.open({initialize:true});const old=box.reserve({eventId:'event1',payload:{text:'old source version'},parentRevision:0,eventType:'message'});
 f.context.sourceEpoch='source_v2';assert.throws(()=>box.seal('event1'),/key_epoch_changed/);assert.throws(()=>box.retryUnsealed('event1'),/key_epoch_changed/);
 assert.deepEqual(f.journal.get('event:event1'),old);f.close();box=f.open();assert.throws(()=>box.retryUnsealed('event1'),/key_epoch_changed/);
 f.context.sourceEpoch='source';f.context.membershipEpoch=2;assert.throws(()=>box.retryUnsealed('event1'),/key_epoch_changed/);assert.deepEqual(f.journal.get('event:event1'),old);
});
test('source epoch changes quarantine old unaccepted ready bytes until owner reconciliation',t=>{
 const f=fixture(t),box=f.open({initialize:true});box.reserve({eventId:'event1',payload:{text:'old version'},parentRevision:0,eventType:'message'});box.seal('event1');
 f.context.sourceEpoch='source_v2';assert.throws(()=>box.takeReady('event1'),/key_epoch_changed/);
});
for(const stage of ['before_guard_advance','reservation_committed','encrypting_marked','encrypted','sealed','network_admitted'])test(`actual outbox SIGKILL at ${stage} never reuses a nonce or guesses transmission`,async t=>{
 const f=fixture(t);f.open({initialize:true});f.close();const marker=path.join(f.options.stateDir,'crash-marker');
 const child=spawn(process.execPath,[fileURLToPath(new URL('./outbox-worker.mjs',import.meta.url))],{stdio:['pipe','ignore','pipe']});const exited=once(child,'exit');let exitSeen=false;exited.then(()=>{exitSeen=true;});
 fs.writeFileSync(path.join(f.options.stateDir,'test-process.json'),JSON.stringify({pid:child.pid,stage}));
 child.stdin.end(JSON.stringify({options:f.options,guardFile:f.guardFile,marker,stage,context:{...f.context,...Object.fromEntries(['contentKey','salt','signingKey'].map(k=>[k,Buffer.from(f.context[k]).toString('base64url')]))}}));
 t.after(async()=>{if(!exitSeen)child.kill('SIGKILL');await exited;});
 const start=Date.now();while(!fs.existsSync(marker)){if(exitSeen||Date.now()-start>5000)assert.fail('worker did not reach '+stage);await new Promise(r=>setTimeout(r,10));}
 child.kill('SIGKILL');await exited;
 if(stage==='before_guard_advance'){assert.throws(()=>f.open(),/crypto_unavailable/);return;}
 const box=f.open();if(['sealed','network_admitted'].includes(stage)){
  const wire=box.takeReady('event1');assert.equal(box.takeReady('event1').toString(),wire.toString());assert.throws(()=>box.retryUnsealed('event1'),/already_sealed/);
 }else{
  assert.throws(()=>box.takeReady('event1'),/not_sealed/);assert.throws(()=>box.seal('event1'),/reservation_from_old_boot/);
  const previous=f.journal.get('event:event1');const fresh=box.retryUnsealed('event1');assert.notEqual(fresh.nonce,previous.nonce);box.seal('event1');assert.ok(box.takeReady('event1').length);
 }
});
