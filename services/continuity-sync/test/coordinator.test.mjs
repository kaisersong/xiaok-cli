import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import sodium from 'libsodium-wrappers';
import { Coordinator } from '../src/coordinator.mjs';
import { AuthorityJournal } from '../src/journal.mjs';
import { base64,createKeyManifest,hash,hashBytes,sealEnvelope,sign,SUITE,verify } from '../src/crypto.mjs';
await sodium.ready;
const ZERO='0'.repeat(64);
import { coordinatorFixture as fixture } from './helpers/coordinator-fixture.mjs';
test('root certificates cannot delegate membership and agent paths cannot enroll or alter scopes',t=>{
 const f=fixture(t),before=f.journal.head();const next=f.membership([f.row('a')]);
 assert.throws(()=>f.coordinator.appendMembership({record:next,manifest:f.manifest(next),requestSource:'agent'}),/forbidden/);
 assert.throws(()=>f.coordinator.registerScope({record:f.grant(['a','b'],2),requestSource:'agent'}),/forbidden/);assert.deepEqual(f.journal.head(),before);
 const forged={...next,signature:sign(['xiaok/context-sync/membership/v1',next.body],f.online.privateKey)};
 assert.throws(()=>f.coordinator.appendMembership({record:forged,manifest:f.manifest(next),requestSource:'user'}),/invalid_signature/);
});
test('control transport returns a signed receipt only after the root mutation is durable',t=>{
 const f=fixture(t),next=f.membership([f.row('a')]),response=f.coordinator.handleControl({path:'/v1/membership',body:{record:next,manifest:f.manifest(next)},requestSource:'user'});
 assert.ok(verify(['xiaok/context-sync/control-response/v1',response.body],response.signature,f.online.publicKey));assert.deepEqual(response.body.journalHead,f.journal.head());assert.equal(response.body.operationId,next.body.operationId);
});
test('auth binds path/body/expected head and consumes challenge only once',t=>{
 const f=fixture(t),body={nonce:base64(sodium.randombytes_buf(32))},req=f.request('a','/v1/head',body);
 const response=f.coordinator.handle(req);assert.equal(response.body.result.nonce,body.nonce);assert.throws(()=>f.coordinator.handle(req),/challenge_unavailable/);
 for(const changed of [{...f.request('a','/v1/head',body),body:{nonce:'changed'}},{...f.request('a','/v1/head',body),path:'/v1/events/push'}])assert.throws(()=>f.coordinator.handle(changed),/invalid_request|invalid_signature/);
});
test('explicit dual signed pairing and root approval are both mandatory; revoked device IDs never revive',t=>{
 const f=fixture(t);const unpaired=f.membership([f.row('a'),f.row('b')]);assert.throws(()=>f.coordinator.appendMembership({record:unpaired,manifest:f.manifest(unpaired),requestSource:'user'}),/pairing_required/);
 f.addB();const revoked=f.membership([f.row('a'),f.row('b','revoked',f.record.body.devices[1].pairingId)]);f.coordinator.appendMembership({record:revoked,manifest:f.manifest(revoked),requestSource:'user'});f.record=revoked;
 assert.throws(()=>f.coordinator.createChallenge({deviceId:'b'}),/device_revoked/);
 const revived=f.membership([f.row('a'),f.row('b','active',revoked.body.devices[1].pairingId)]);assert.throws(()=>f.coordinator.appendMembership({record:revived,manifest:f.manifest(revived),requestSource:'user'}),/device_revoked/);
});
test('accepts only signed in-scope chained ciphertext and retries preserve the durable decision',t=>{
 const f=fixture(t),envelope=f.event(),requestId=randomUUID();const a=f.send('a','/v1/events/push',{envelope},{requestId});
 assert.equal(a.accepted.eventHash,hash(envelope));const before=f.journal.head();assert.deepEqual(f.send('a','/v1/events/push',{envelope},{requestId}),a);assert.deepEqual(f.journal.head(),before);
 assert.throws(()=>f.send('a','/v1/events/push',{envelope:f.event('a',3)}),/stream_gap/);
 const next=f.event('a',2,hash(envelope));f.send('a','/v1/events/push',{envelope:next});f.close();f.open();assert.equal(f.send('a','/v1/events/push',{envelope},{requestId}).accepted.eventHash,a.accepted.eventHash);
 assert.throws(()=>f.send('a','/v1/events/push',{envelope:next},{requestId}),/operation_conflict/);
});
test('new key epochs require both new root-committed content keys and fresh salt',t=>{
 const f=fixture(t),next=f.membership([f.row('a')]);
 const reused=createKeyManifest({rootKeyId:f.identity.rootKeyId,syncGroupId:'group',membership:next.body,contentEpoch:1,...f.material,rootSigningKey:f.root.privateKey});
 assert.throws(()=>f.coordinator.appendMembership({record:next,manifest:reused,requestSource:'user'}),/key_rotation_required/);
});
test('separate origins share no sequence counter; revocation accepts no late offline events',t=>{
 const f=fixture(t);f.addB();const a=f.event(),b=f.event('b');f.send('a','/v1/events/push',{envelope:a});f.send('b','/v1/events/push',{envelope:b});
 const late=f.event('b',2,hash(b));const revoked=f.membership([f.row('a'),f.row('b','revoked',f.record.body.devices[1].pairingId)]);f.coordinator.appendMembership({record:revoked,manifest:f.manifest(revoked),requestSource:'user'});f.record=revoked;
 const replay=f.send('a','/v1/events/push',{envelope:b});assert.equal(replay.accepted.eventHash,hash(b));assert.throws(()=>f.send('a','/v1/events/push',{envelope:late}),/device_revoked|origin_mismatch/);
 const nonce=base64(sodium.randombytes_buf(32)),head=f.send('a','/v1/head',{nonce});assert.equal(head.nonce,nonce);assert.equal(head.membershipHead.epoch,3);assert.equal(head.revocationHead.sequence,1);
});
test('public journal proofs never bypass a current conversation scope to disclose ciphertext',t=>{
 const f=fixture(t);f.addB();const oldScope=f.journal.get('scope:'+hash(['conversation','branch']));
 f.coordinator.registerScope({record:f.grant(['a'],3,hash(oldScope.body)),requestSource:'user'});
 const envelope=f.event();f.send('a','/v1/events/push',{envelope});
 const targetHead=f.journal.head(),proof=f.send('b','/v1/journal/pull',{after:0,limit:100,targetHead});
 assert.ok(proof.entries.length>0);for(const entry of proof.entries){assert.equal(typeof entry.entryHash,'string');assert.ok(['global-control','scope-private'].includes(entry.disclosureClass));assert.equal(entry.scopeDigest,entry.disclosureClass==='global-control'?null:hash(['xiaok/context-sync/scope/v1',f.identity.rootKeyId,'group','conversation','branch']));assert.equal(entry.changes,undefined);assert.equal(entry.request,undefined);}
 const controls=f.send('b','/v1/control/pull',{after:0,limit:100,targetHead});
 assert.deepEqual(controls.entries.map(x=>x.commitment.sequence),proof.entries.filter(x=>x.disclosureClass==='global-control').map(x=>x.sequence));
 assert.ok(controls.entries.every(x=>x.entry.request.path!=='/v1/events/push'));
 const fresh=f.send('b','/v1/head',{nonce:base64(sodium.randombytes_buf(32))});assert.equal(fresh.revocationHead.sequence,1);
 assert.throws(()=>f.send('b','/v1/events/pull',{conversationId:'conversation',branchId:'branch',after:0,limit:100,targetHead}),/scope_forbidden/);
 const allowed=f.send('a','/v1/events/pull',{conversationId:'conversation',branchId:'branch',after:0,limit:100,targetHead});
 const found=allowed.entries.find(x=>x.entry.request.body.envelope?.ciphertext===envelope.ciphertext);assert.ok(found);assert.equal(hash(found.entry),found.commitment.entryHash);
});
test('proof cursors beyond the pinned target are invalid rather than an empty successful tail',t=>{
 const f=fixture(t),targetHead=f.journal.head();assert.throws(()=>f.send('a','/v1/journal/pull',{after:targetHead.sequence+1,limit:100,targetHead}),/invalid_page/);
});
test('multi-page mixed logs cover the last scope revocation and reject a drifting pinned head',t=>{
 const f=fixture(t);f.addB();let previous=ZERO;
 for(let sequence=1;sequence<=105;sequence++){const envelope=f.event('a',sequence,previous);f.send('a','/v1/events/push',{envelope});previous=hash(envelope);}
 const oldScope=f.journal.get('scope:'+hash(['conversation','branch']));f.coordinator.registerScope({record:f.grant(['a'],3,hash(oldScope.body)),requestSource:'user'});
 const targetHead=f.journal.head(),proofs=[],controls=[];let after=0;
 while(after<targetHead.sequence){const page=f.send('b','/v1/journal/pull',{after,limit:100,targetHead});assert.ok(page.entries.length);proofs.push(...page.entries);controls.push(...f.send('b','/v1/control/pull',{after,limit:100,targetHead}).entries);after=page.entries.at(-1).sequence;}
 assert.equal(proofs.at(-1).hash,targetHead.hash);assert.equal(controls.at(-1).entry.recordType,'scope');assert.equal(controls.at(-1).entry.sequence,targetHead.sequence);
 assert.deepEqual(controls.map(x=>x.commitment.sequence),proofs.filter(x=>x.disclosureClass==='global-control').map(x=>x.sequence));
 const next=f.event('a',106,previous);f.send('a','/v1/events/push',{envelope:next});
 for(const route of ['/v1/journal/pull','/v1/control/pull','/v1/events/pull']){
  const body={after:0,limit:100,targetHead,...(route==='/v1/events/pull'?{conversationId:'conversation',branchId:'branch'}:{})};
  assert.throws(()=>f.send('a',route,body,{expectedHead:targetHead}),/head_changed/);
 }
});
test('dispose prevents all signing and mutation entrances',t=>{
 const f=fixture(t),before=f.journal.head(),request=f.request('a','/v1/head',{nonce:base64(sodium.randombytes_buf(32))}),next=f.membership([f.row('a')]);f.coordinator.dispose();
 for(const action of [()=>f.coordinator.handle(request),()=>f.coordinator.createChallenge({deviceId:'a'}),()=>f.coordinator.appendMembership({record:next,manifest:f.manifest(next),requestSource:'user'}),()=>f.coordinator.registerScope({record:f.grant(),requestSource:'user'}),()=>f.coordinator.confirmPairing({pairingId:'unknown',requestSource:'user'})])assert.throws(action,/coordinator_disposed/);
 assert.deepEqual(f.journal.head(),before);
});
