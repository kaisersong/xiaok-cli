import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sodium from 'libsodium-wrappers';
import {coordinatorFixture} from './helpers/coordinator-fixture.mjs';
import {tls} from './helpers/tls-fixture.mjs';
import {AuthorityJournal} from '../src/journal.mjs';
import {CryptoOutbox} from '../src/outbox.mjs';
import {CoordinatorClient} from '../src/transport.mjs';
import {startCoordinatorServer} from '../src/server.mjs';
import {canonical,hash,openEnvelope,sign} from '../src/crypto.mjs';
await sodium.ready;
async function fixture(t,{fault=()=>{}}={}){
 const f=coordinatorFixture(t,{keyUse:true}),credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const client=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});t.after(()=>client.close());
 const base=path.dirname(f.opts.stateDir),guardPath=path.join(base,'test-outbox-guard.json');
 const guard={kind:'test-only',read:()=>fs.existsSync(guardPath)?JSON.parse(fs.readFileSync(guardPath)):null,advance(before,after){assert.deepEqual(this.read(),before);const fd=fs.openSync(guardPath,'w',0o600);try{fs.writeFileSync(fd,canonical(after));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}};
 const journal=new AuthorityJournal({stateDir:path.join(base,'outbox'),witnessDir:path.join(base,'outbox-witness'),identity:{kind:'explicit-test-outbox',coordinatorIdentityHash:hash(f.identity)},initialize:true});t.after(()=>journal.close());
 let current=true;const context={...f.material,signingKey:f.devices.a.sign.privateKey,tuple:{rootKeyId:f.identity.rootKeyId,syncGroupId:'group',conversationId:'conversation',branchId:'branch',keyEpoch:1,contentEpoch:1,originDeviceId:'a'},membershipEpoch:1,sourceEpoch:'source'};
 let box=new CryptoOutbox({journal,guard,testOnly:true,initialize:true,coordinatorIdentity:f.identity,keyProvider(){if(!current)throw new Error('heads_unverified');return context;},fault});
 const input={eventId:'event',payload:{text:'上下文正文'},parentRevision:0,eventType:'message'};box.reserve(input);
 return {...f,host,client,guard,journal,context,input,get box(){return box;},setCurrent(v){current=v;},replaceBox(coordinatorIdentity=f.identity){box=new CryptoOutbox({journal,guard,testOnly:true,coordinatorIdentity,keyProvider:()=>context});return box;}};
}
function encryptCalls(t){const original=sodium.crypto_aead_xchacha20poly1305_ietf_encrypt;let count=0;t.mock.method(sodium,'crypto_aead_xchacha20poly1305_ietf_encrypt',(...args)=>{count++;return original(...args);});return()=>count;}
function options(f,extra={}){return {client:f.client,expectedHead:f.journal.head(),requestSource:'user',...extra};}
function remoteHead(f){return f.coordinator.handle(f.request('a','/v1/head',{nonce:Buffer.alloc(32,3).toString('base64url')})).body.result.head;}
function holdPermit(f){
 let release,entered;const reached=new Promise(resolve=>{entered=resolve;});
 f.host.server.prependListener('request',(req,res)=>{if(req.url!=='/v1/key-use/consume')return;const end=res.end;res.end=function(...args){release=()=>end.apply(res,args);entered();return res;};});
 return {reached,release(){assert.equal(typeof release,'function');release();}};
}
test('original TLS permit is durably recorded before the actual unique AEAD and ready wire decrypts',async t=>{
 const f=await fixture(t),count=encryptCalls(t),head=remoteHead(f);
 // Replacing the public method cannot manufacture or intercept the private permit path.
 f.client.call=()=>{throw new Error('public_call_must_not_run');};
 const envelope=await f.box.sealOnline('event',options(f,{expectedHead:head}));assert.equal(count(),1);
 const row=f.journal.get('event:event');assert.equal(row.status,'ready');assert.equal(typeof row.keyUse.responseHash,'string');assert.equal(row.keyUse.result.headerHash,hash(envelope.header));
 const kinds=f.journal.readJournal().map(e=>e.kind);assert.ok(kinds.indexOf('crypto_online_permit')<kinds.indexOf('crypto_seal'));
 const wire=f.box.takeReady('event');assert.equal(wire.toString(),canonical(envelope));assert.equal(openEnvelope({envelope,contentKey:f.context.contentKey,salt:f.context.salt,signingPublicKey:f.devices.a.sign.publicKey,expected:f.context.tuple}).text,'上下文正文');
 await assert.rejects(()=>f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)})),/already_sealed/);assert.equal(count(),1);
});
test('forged/proxied clients and another root-signed coordinator fail before network or encrypting',async t=>{
 const f=await fixture(t),count=encryptCalls(t),head=remoteHead(f),original=f.journal.get('event:event');
 const foreign=structuredClone(f.identity);foreign.coordinatorId='another';foreign.certificate.body.coordinatorId='another';foreign.certificate.signature=sign(['xiaok/context-sync/coordinator-certificate/v1',foreign.certificate.body],f.root.privateKey);
 const other=new CoordinatorClient({baseUrl:'https://127.0.0.1:1',identity:foreign,deviceId:'a',signingKey:f.devices.a.sign.privateKey});t.after(()=>other.close());
 for(const client of [{call:async()=>({})},new Proxy(f.client,{}),other])await assert.rejects(()=>f.box.sealOnline('event',options(f,{client,expectedHead:{...head,identityHash:hash(foreign)}})),/key_use_client_unavailable|coordinator_identity_mismatch/);
 assert.deepEqual(f.journal.get('event:event'),original);assert.equal(count(),0);
});
test('durable full coordinator pin cannot be changed when a new owner reopens the same original journal',async t=>{
 const f=await fixture(t),foreign=structuredClone(f.identity);foreign.coordinatorId='another';foreign.certificate.body.coordinatorId='another';foreign.certificate.signature=sign(['xiaok/context-sync/coordinator-certificate/v1',foreign.certificate.body],f.root.privateKey);
 assert.throws(()=>f.replaceBox(foreign),/coordinator_identity_mismatch|crypto_unavailable/);
 assert.equal(f.journal.get('crypto-coordinator-pin'),hash(f.identity));
 f.replaceBox();await assert.rejects(()=>f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)})),/reservation_from_old_boot/);
 f.box.retryUnsealed('event');await f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)}));assert.equal(f.journal.get('event:event').status,'ready');
});
test('lost actual coordinator ACK burns original nonce and never invokes AEAD, fresh reservation can proceed',async t=>{
 const f=await fixture(t),count=encryptCalls(t),original=f.journal.get('event:event'),handle=f.coordinator.handle.bind(f.coordinator);let lose=true;
 f.coordinator.handle=req=>{const response=handle(req);if(lose&&req.path==='/v1/key-use/consume'){lose=false;throw new Error('lost actual committed ACK');}return response;};
 await assert.rejects(()=>f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)})));assert.equal(count(),0);assert.equal(f.journal.get('event:event').status,'encrypting');
 await assert.rejects(()=>f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)})),/reservation_consumed/);
 const next=f.box.retryUnsealed('event');assert.notEqual(next.nonce,original.nonce);assert.notEqual(next.reservationId,original.reservationId);
 await f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)}));assert.equal(count(),1);assert.equal(f.journal.get('event:event').keyUse.result.count,2);
});
for(const change of ['closed','source','key','signer'])test(`held real TLS permit cannot cross ${change} context change`,async t=>{
 const f=await fixture(t),count=encryptCalls(t),hold=holdPermit(f),pending=f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)}));
 await hold.reached;const before=f.journal.get('event:event');assert.throws(()=>f.box.retryUnsealed('event'),/encryption_in_flight/);
 await assert.rejects(()=>f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)})),/encryption_in_flight/);
 assert.deepEqual(f.journal.get('event:event'),before);
 if(change==='closed')f.setCurrent(false);if(change==='source')f.context.sourceEpoch='changed';if(change==='key')f.context.contentKey=new Uint8Array(32).fill(98);if(change==='signer')f.context.signingKey=sodium.crypto_sign_keypair().privateKey;
 hold.release();await assert.rejects(()=>pending);assert.equal(count(),0);assert.throws(()=>f.box.takeReady('event'));
});
test('permit persistence guard failure never invokes AEAD or exposes a ready envelope',async t=>{
 const f=await fixture(t),count=encryptCalls(t),advance=f.guard.advance.bind(f.guard);f.guard.advance=(before,after)=>{if(f.journal.readJournal().at(-1).kind==='crypto_online_permit')throw new Error('OS write failure');return advance(before,after);};
 await assert.rejects(()=>f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)})),/crypto_unavailable/);assert.equal(count(),0);assert.throws(()=>f.box.takeReady('event'),/crypto_unavailable/);
});
test('guard/fault reentry cannot rotate the reservation or acquire a second original permit',async t=>{
 let active=false,f,second;
 f=await fixture(t,{fault(stage){if(stage==='encrypting_marked'&&active){assert.throws(()=>f.box.retryUnsealed('event'),/encryption_in_flight/);second=f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)}));second.catch(()=>{});}}});active=true;
 const count=encryptCalls(t),old=f.journal.get('event:event');await f.box.sealOnline('event',options(f,{expectedHead:remoteHead(f)}));await assert.rejects(()=>second,/encryption_in_flight/);assert.equal(f.journal.get('event:event').reservationId,old.reservationId);assert.equal(count(),1);
});
test('mutation origin is explicit and is preserved through real agent key-use',async t=>{
 const f=await fixture(t),count=encryptCalls(t),head=remoteHead(f);await assert.rejects(()=>f.box.sealOnline('event',options(f,{expectedHead:head,requestSource:undefined})),/request_source_required/);assert.equal(count(),0);
 await f.box.sealOnline('event',options(f,{expectedHead:head,requestSource:'agent'}));const row=f.coordinator.handle(f.request('a','/v1/head',{nonce:Buffer.alloc(32,4).toString('base64url')}));assert.equal(row.body.result.head.sequence,head.sequence+1);assert.equal(count(),1);
});
