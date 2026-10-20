import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import sodium from 'libsodium-wrappers';
import {deviceOwnerFixture} from './helpers/device-owner-fixture.mjs';
import * as ownerModule from '../src/device-owner.mjs';
import {canonical,hash,sealEnvelope,sign,base64,unbase64,envelopeSignatureInput} from '../src/crypto.mjs';
import {CoordinatorClient} from '../src/transport.mjs';
await sodium.ready;
const test=(name,action)=>nodeTest(name,{skip:process.platform==='win32',timeout:20000},action);
const firstScope={conversationId:'conversation',branchId:'branch'},secondScope={conversationId:'second-conversation',branchId:'branch'};
const firstBody={schemaVersion:1,kind:'candidate-test-only',text:'AUTHENTICATED_FIRST_CANDIDATE'},secondBody={schemaVersion:1,kind:'candidate-test-only',text:'AUTHENTICATED_SECOND_CANDIDATE'};
function addSecondScope(f){const record=f.f.grant(f.f.record.body.devices.filter(d=>d.state==='active').map(d=>d.deviceId).sort());record.body.conversationId=secondScope.conversationId;record.signature=sign(['xiaok/context-sync/scope/v1',record.body],f.f.root.privateKey);f.f.coordinator.registerScope({record,requestSource:'user'});}
async function publish(owner,scope,payload,eventId='first-snapshot'){const outgoing=await owner.sealOutgoing(scope,{eventId,payload,parentRevision:0,eventType:'canonical-snapshot-v1'},{requestSource:'user'});await owner.pushOutgoing(scope,{eventId},{requestSource:'user'});return outgoing;}
async function pushAdversarial(f,origin,envelope){const client=new CoordinatorClient({baseUrl:f.host.url,identity:f.f.identity,deviceId:origin,signingKey:f.f.devices[origin].sign.privateKey,ca:f.options.ca});try{const h=await client.getHead();return await client.call('/v1/events/push',{envelope},{expectedHead:h.response.body.result.head,requestSource:'user'});}finally{client.close();await client.drainClosed();}}
function assertCurrent(owner,receipt){ownerModule.assertOriginalIncoming(owner,receipt,{testOnly:true});}

test('one original receiver captures two scopes at the same verified head and issues only a private incoming candidate receipt',async t=>{
 const f=await deviceOwnerFixture(t);f.f.addB();addSecondScope(f);const producer=f.open(),receiver=f.provisionDevice('b').open();t.after(()=>producer.close());t.after(()=>receiver.close());
 await publish(producer,firstScope,firstBody);await publish(producer,secondScope,secondBody,'second-snapshot');
 const receipt=await receiver.captureCanonicalScopes([firstScope,secondScope],{requestSource:'user'});assert.equal(receipt.status,'verified-incoming-candidates');assert.deepEqual(receipt.head,f.f.journal.head());assert.equal(receipt.deviceId,'b');assert.equal(receipt.logicalProfileId,'logical');assert.equal(receipt.scopes.length,2);assert.deepEqual(receipt.scopes.map(s=>s.candidate.payload),[firstBody,secondBody]);assertCurrent(receiver,receipt);
 assert.throws(()=>ownerModule.assertOriginalIncoming(receiver,receipt),/device_owner_unavailable/,'a real signed-test owner never qualifies production intake');for(const testOnly of ['yes',1,{},[]])assert.throws(()=>ownerModule.assertOriginalIncoming(receiver,receipt,{testOnly}),/device_owner_unavailable/);
 for(const s of receipt.scopes){assert.equal(s.candidate.acceptedScope.body.ownerDeviceId,'a');assert.equal(s.candidate.header.originDeviceId,'a');assert.equal(s.quarantine.count,0);}
 for(const key of ['keyProvider','contentKey','salt','signingKey','boxPrivateKey','journal'])assert.equal(key in receipt,false);
 assert.throws(()=>receiver.assertPublicationCurrent(receipt),/sync_publication_unavailable/);assert.throws(()=>assertCurrent(receiver,structuredClone(receipt)),/device_owner_unavailable/);assert.throws(()=>assertCurrent(receiver,new Proxy(receipt,{})),/device_owner_unavailable/);
 const original=Object.getPrototypeOf(receiver).assertIncomingCurrent;try{Object.getPrototypeOf(receiver).assertIncomingCurrent=()=>{};assert.throws(()=>assertCurrent(receiver,structuredClone(receipt)),/device_owner_unavailable/);assertCurrent(receiver,receipt);}finally{Object.getPrototypeOf(receiver).assertIncomingCurrent=original;}
 await receiver.sync(firstScope,{requestSource:'scheduler'});assert.throws(()=>assertCurrent(receiver,receipt),/device_owner_unavailable/);
});

test('a new key epoch without a current canonical snapshot is unavailable, then a fresh owner snapshot leaves old events quarantined',async t=>{
 const f=await deviceOwnerFixture(t),producer=f.open();t.after(()=>producer.close());await publish(producer,firstScope,firstBody);f.f.addB();const provision=f.provisionDevice('b');let receiver=provision.open();t.after(()=>receiver.close());
 await assert.rejects(()=>receiver.captureCanonicalScopes([firstScope],{requestSource:'user'}),/canonical_snapshot_unavailable/);await receiver.close();
 await publish(producer,firstScope,secondBody,'current-key-snapshot');receiver=provision.open();
 const receipt=await receiver.captureCanonicalScopes([firstScope],{requestSource:'user'});assert.deepEqual(receipt.scopes[0].candidate.payload,secondBody);assert.equal(receipt.scopes[0].quarantine.count,1);assertCurrent(receiver,receipt);
});

test('a later root owner cannot vouch a canonical candidate that was accepted while it was only an allowed member',async t=>{
 const f=await deviceOwnerFixture(t);f.f.addB();const producer=f.open(),receiver=f.provisionDevice('b').open();t.after(()=>producer.close());t.after(()=>receiver.close());await publish(producer,firstScope,firstBody);
 const template=f.f.event('b').header,envelope=sealEnvelope({header:{...template,eventType:'canonical-snapshot-v1'},payload:{text:'UNAUTHORIZED_OLD_OWNER_CANARY'},...f.f.material,signingKey:f.f.devices.b.sign.privateKey});await pushAdversarial(f,'b',envelope);
 const current=f.f.journal.readJournal(0,100).filter(e=>e.recordType==='scope').at(-1).request.body.record.body,record=f.f.grant(['a','b'],current.revision+1,hash(current));record.body.ownerDeviceId='b';record.signature=sign(['xiaok/context-sync/scope/v1',record.body],f.f.root.privateKey);f.f.coordinator.registerScope({record,requestSource:'user'});
 const receipt=await receiver.captureCanonicalScopes([firstScope],{requestSource:'user'});assert.deepEqual(receipt.scopes[0].candidate.payload,firstBody);assert.equal(receipt.scopes[0].candidate.acceptedScope.body.ownerDeviceId,'a');assert.equal(receipt.scopes[0].quarantine.count,1);assertCurrent(receiver,receipt);
});

test('the latest eligible owner snapshot with a genuine origin signature but invalid AEAD cannot fall back to an older snapshot',async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());const old=await publish(owner,firstScope,firstBody),header={...f.f.event('a',2,old.eventHash).header,eventType:'canonical-snapshot-v1'},envelope=sealEnvelope({header,payload:secondBody,...f.f.material,signingKey:f.f.devices.a.sign.privateKey}),ciphertext=unbase64(envelope.ciphertext);ciphertext[0]^=1;envelope.ciphertext=base64(ciphertext);envelope.signature=sign(envelopeSignatureInput(header,ciphertext),f.f.devices.a.sign.privateKey);await pushAdversarial(f,'a',envelope);
 await assert.rejects(()=>owner.captureCanonicalScopes([firstScope],{requestSource:'user'}));
});

test('head drift during the second original scope catchup returns no batch receipt or rollback floor',async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());addSecondScope(f);await publish(owner,firstScope,firstBody);await publish(owner,secondScope,secondBody,'second-snapshot');let pulls=0,entered,release;const reached=new Promise(resolve=>entered=resolve);
 f.host.server.prependListener('request',(req,res)=>{if(req.url!=='/v1/events/pull'||++pulls!==2)return;const end=res.end;res.end=function(...args){release=()=>end.apply(res,args);entered();return res;};});
 const pending=owner.captureCanonicalScopes([firstScope,secondScope],{requestSource:'user'});pending.catch(()=>{});await reached;
 const current=f.f.journal.readJournal(0,100).filter(e=>e.recordType==='scope'&&e.request.body.record.body.conversationId===firstScope.conversationId).at(-1).request.body.record.body,record=f.f.grant(['a'],current.revision+1,hash(current));f.f.coordinator.registerScope({record,requestSource:'user'});release();await assert.rejects(()=>pending);
});

test('close while the second actual scope response is held cannot publish the already decrypted first candidate',async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());addSecondScope(f);await publish(owner,firstScope,firstBody);await publish(owner,secondScope,secondBody,'second-snapshot');let pulls=0,entered,release;const reached=new Promise(resolve=>entered=resolve);
 f.host.server.prependListener('request',(req,res)=>{if(req.url!=='/v1/events/pull'||++pulls!==2)return;const end=res.end;res.end=function(...args){release=()=>end.apply(res,args);entered();return res;};});
 const pending=owner.captureCanonicalScopes([firstScope,secondScope],{requestSource:'user'});pending.catch(()=>{});await reached;const closing=owner.close();release();await assert.rejects(()=>pending);await closing;
});

for(const [name,makeBody]of [['own-then',()=>({then:'untrusted data'})],['too-many-objects',()=>Array.from({length:11000},()=>({}))],['wrapper-depth',()=>{let value={text:'deep'};for(let i=0;i<33;i++)value={nested:value};return value;}]])test(`incoming ${name} is rejected inside the original job before it can create an uncertain namespace obligation`,async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());await publish(owner,firstScope,makeBody());
 await assert.rejects(()=>owner.captureCanonicalScopes([firstScope],{requestSource:'user'}));const closing=owner.close();let timer;try{await Promise.race([closing,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('original namespace drain did not finish')),2000);})]);}finally{clearTimeout(timer);}
 const reopened=f.open();await reopened.close();
});
