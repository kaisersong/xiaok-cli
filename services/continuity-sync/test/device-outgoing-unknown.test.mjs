import {test} from 'node:test';
import assert from 'node:assert/strict';
import sodium from 'libsodium-wrappers';
import {deviceOwnerFixture} from './helpers/device-owner-fixture.mjs';
await sodium.ready;
test('an original owner never re-encrypts or resets an old unsealed reservation after committed permit ACK loss',{skip:process.platform==='win32',timeout:20000},async t=>{
 const f=await deviceOwnerFixture(t);let owner=f.open();t.after(()=>owner.close());let count=0,permits=0;const encrypt=sodium.crypto_aead_xchacha20poly1305_ietf_encrypt,handle=f.f.coordinator.handle.bind(f.f.coordinator);
 t.mock.method(sodium,'crypto_aead_xchacha20poly1305_ietf_encrypt',(...args)=>{count++;return encrypt(...args);});
 f.f.coordinator.handle=req=>{const response=handle(req);if(req.path==='/v1/key-use/consume'){permits++;throw new Error('synthetic lost original permit ACK');}return response;};
 const scope={conversationId:'conversation',branchId:'branch'},request={eventId:'original-unknown-no-reset',payload:{text:'must stay unsealed'},parentRevision:0,eventType:'message'};
 await assert.rejects(()=>owner.sealOutgoing(scope,request,{requestSource:'user'}));assert.equal(count,0);assert.equal(permits,1);await owner.close();owner=f.open();
 await assert.rejects(()=>owner.sealOutgoing(scope,request,{requestSource:'user'}));assert.equal(count,0);assert.equal(permits,1,'old boot cannot consume another permit for its unknown reservation');
 assert.throws(()=>owner.assertPublicationCurrent({eventId:request.eventId}),/sync_publication_unavailable/);
});
