import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import sodium from 'libsodium-wrappers';
import {deviceOwnerFixture} from './helpers/device-owner-fixture.mjs';
import {CoordinatorClient} from '../src/transport.mjs';
import {fetchVerifiedScope} from '../src/sync-driver.mjs';
import {canonical,hash,sign} from '../src/crypto.mjs';
import {deviceOsAccountId} from '../../continuity-device/src/os-guard.mjs';
await sodium.ready;
const test=(name,action)=>nodeTest(name,{skip:process.platform==='win32',timeout:20000},action);
const scope={conversationId:'conversation',branchId:'branch'},request={eventId:'original-pushed-event',payload:{text:'ORIGINAL_PERSISTED_CIPHERTEXT'},parentRevision:0,eventType:'message'};
function lastDecision(options){const db=new DatabaseSync(path.join(options.stateDir,'authority.sqlite'),{readOnly:true});try{return JSON.parse(db.prepare('SELECT entry FROM authority_journal ORDER BY sequence DESC LIMIT 1').get().entry);}finally{db.close();}}
function countEncryption(t){let count=0;const original=sodium.crypto_aead_xchacha20poly1305_ietf_encrypt;t.mock.method(sodium,'crypto_aead_xchacha20poly1305_ietf_encrypt',(...args)=>{count++;return original(...args);});return ()=>count;}
async function verifiedEvents(t,f){const client=new CoordinatorClient({baseUrl:f.host.url,identity:f.f.identity,deviceId:'a',signingKey:f.f.devices.a.sign.privateKey,ca:f.options.ca});try{return (await fetchVerifiedScope({client,identity:f.f.identity,deviceId:'a',scope})).events;}finally{client.close();await client.drainClosed();}}

test('original device owner pushes only persisted ciphertext once and reconciles exact accepted bytes across restart',async t=>{
 const f=await deviceOwnerFixture(t);let owner=f.open();t.after(()=>owner.close());const encrypted=countEncryption(t),outgoing=await owner.sealOutgoing(scope,request,{requestSource:'user'});let pushes=0;f.host.server.prependListener('request',req=>{if(req.url==='/v1/events/push')pushes++;});
 const result=await owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'});assert.equal(result.status,'accepted-ciphertext-only');assert.equal(result.eventHash,outgoing.eventHash);assert.equal('wire'in result,false);assert.equal(pushes,1);assert.equal(encrypted(),1);assert.throws(()=>owner.assertPublicationCurrent(result),/sync_publication_unavailable/);
 const events=await verifiedEvents(t,f);assert.equal(events.length,1);assert.equal(canonical(events[0].envelope),outgoing.wire);assert.deepEqual(result.accepted,events[0].accepted);
 assert.deepEqual((await owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'agent'})).accepted,result.accepted);await owner.close();owner=f.open();assert.deepEqual((await owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'scheduler'})).accepted,result.accepted);assert.equal(pushes,1);assert.equal(encrypted(),1);
});

test('commit then lost actual push ACK reconciles the original accepted event after restart without another push or AEAD',async t=>{
 const f=await deviceOwnerFixture(t);let owner=f.open();t.after(()=>owner.close());const encrypted=countEncryption(t),outgoing=await owner.sealOutgoing(scope,request,{requestSource:'user'}),handle=f.f.coordinator.handle.bind(f.f.coordinator);let pushes=0;
 f.f.coordinator.handle=req=>{const result=handle(req);if(req.path==='/v1/events/push'){pushes++;throw new Error('synthetic lost committed push ACK');}return result;};
 await assert.rejects(()=>owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'}));await owner.close();owner=f.open();const result=await owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'});assert.equal(result.eventHash,outgoing.eventHash);assert.equal(pushes,1);assert.equal(encrypted(),1);assert.equal((await verifiedEvents(t,f)).length,1);
});

test('intent with no actual coordinator commit retries only identical persisted bytes after restart',async t=>{
 const f=await deviceOwnerFixture(t);let owner=f.open();t.after(()=>owner.close());const encrypted=countEncryption(t),outgoing=await owner.sealOutgoing(scope,request,{requestSource:'user'}),handle=f.f.coordinator.handle.bind(f.f.coordinator),attempts=[];let lose=true;
 f.f.coordinator.handle=req=>{if(req.path==='/v1/events/push'){attempts.push({requestId:req.auth.requestId,wire:canonical(req.body.envelope)});if(lose){lose=false;throw new Error('synthetic precommit transport failure');}}return handle(req);};
 await assert.rejects(()=>owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'}));assert.equal((await verifiedEvents(t,f)).length,0);await owner.close();owner=f.open();const result=await owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'});assert.equal(result.eventHash,outgoing.eventHash);assert.equal(attempts.length,2);assert.notEqual(attempts[0].requestId,attempts[1].requestId);assert.deepEqual(attempts.map(a=>a.wire),[outgoing.wire,outgoing.wire]);assert.equal(encrypted(),1);assert.equal((await verifiedEvents(t,f)).length,1);
});

test('outgoing push caller cannot provide bytes, origin, accepted receipt or a replacement scope tuple',async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());const before=f.writes;
 for(const extra of [{wire:'spoof'},{envelope:{}},{originDeviceId:'b'},{accepted:{}},{tuple:{}}])await assert.rejects(()=>owner.pushOutgoing(scope,{eventId:request.eventId,...extra},{requestSource:'user'}));assert.equal(f.writes,before);
 await assert.rejects(()=>owner.pushOutgoing(scope,{eventId:request.eventId},{}),/request_source_required/);assert.equal(f.writes,before);
});

test('held actual push response cannot return success after owner close; later original catchup retains the accepted fact',async t=>{
 const f=await deviceOwnerFixture(t);let owner=f.open();t.after(()=>owner.close());const encrypted=countEncryption(t);await owner.sealOutgoing(scope,request,{requestSource:'user'});let entered,release;const reached=new Promise(resolve=>entered=resolve);f.host.server.prependListener('request',(req,res)=>{if(req.url!=='/v1/events/push')return;const end=res.end;res.end=function(...args){release=()=>end.apply(res,args);entered();return res;};});
 const pending=owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'});pending.catch(()=>{});await reached;const closing=owner.close();release();await assert.rejects(()=>pending);await closing;owner=f.open();assert.equal((await owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'})).status,'accepted-ciphertext-only');assert.equal(encrypted(),1);
});

for(const kind of ['device_outgoing_push_intent','device_outgoing_accepted'])for(const stage of ['before','after'])test(`actual ${kind} OS floor ${stage}-write uncertainty never fabricates a returned acceptance`,async t=>{
 const f=await deviceOwnerFixture(t);let owner=f.open();t.after(()=>owner.close());const encrypted=countEncryption(t),outgoing=await owner.sealOutgoing(scope,request,{requestSource:'user'}),account=deviceOsAccountId(f.f.identity,'a');let tripped=false;
 f.setWriteHook((id,at)=>{if(id===account&&at===stage&&!tripped&&lastDecision(f.options).kind===kind){tripped=true;throw new Error('synthetic push floor uncertainty');}});
 await assert.rejects(()=>owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'}));assert.equal(tripped,true);const events=await verifiedEvents(t,f);assert.equal(events.length,kind==='device_outgoing_accepted'?1:0);await owner.close();f.setWriteHook(undefined);
 if(stage==='before')assert.throws(f.open,/device_owner_unavailable/);
 else{owner=f.open();const result=await owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'});assert.equal(result.eventHash,outgoing.eventHash);assert.equal(encrypted(),1);}
});

test('push uses original captured TLS client despite replacement public call and head methods',async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());await owner.sealOutgoing(scope,request,{requestSource:'user'});
 t.mock.method(CoordinatorClient.prototype,'call',()=>assert.fail('public transport cannot intercept private push'));t.mock.method(CoordinatorClient.prototype,'getHead',()=>assert.fail('public transport cannot intercept private catchup'));
 const result=await owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'});assert.equal(result.status,'accepted-ciphertext-only');assert.equal(result.eventHash,hash(f.f.journal.readJournal(0,100).find(e=>e.recordType==='event').request.body.envelope));
});

test('an online-signed wrong accepted receipt cannot replace the original stream, event or acceptance position',async t=>{
 for(const alter of [r=>r.streamId='f'.repeat(64),r=>r.originSequence++,r=>r.eventHash='f'.repeat(64),r=>r.journalSequence=0,r=>r.journalSequence=Number.MAX_SAFE_INTEGER,r=>r.journalSequence=1,r=>r.extra=true]){
  const f=await deviceOwnerFixture(t);let owner=f.open();t.after(()=>owner.close());await owner.sealOutgoing(scope,request,{requestSource:'user'});const handle=f.f.coordinator.handle.bind(f.f.coordinator);
  f.f.coordinator.handle=req=>{const response=handle(req);if(req.path==='/v1/events/push'){alter(response.body.result.accepted);response.signature=sign(['xiaok/context-sync/response/v1',response.body],f.f.online.privateKey);}return response;};
  await assert.rejects(()=>owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'}));await owner.close();owner=f.open();assert.equal((await owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'})).status,'accepted-ciphertext-only','later true complete chain preserves the actual accepted fact');
 }
});

test('only the current original root scope owner may push its sealed pending bytes',async t=>{
 const f=await deviceOwnerFixture(t);f.f.addB();const owner=f.open();t.after(()=>owner.close());await owner.sealOutgoing(scope,request,{requestSource:'user'});
 const current=f.f.journal.readJournal(0,100).filter(e=>e.recordType==='scope').at(-1).request.body.record.body,record=f.f.grant(['a','b'],current.revision+1,hash(current));record.body.ownerDeviceId='b';record.signature=sign(['xiaok/context-sync/scope/v1',record.body],f.f.root.privateKey);f.f.coordinator.registerScope({record,requestSource:'user'});
 await assert.rejects(()=>owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'}));assert.equal((await verifiedEvents(t,f)).length,0);
});
