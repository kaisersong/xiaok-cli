import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import {Coordinator} from '../src/coordinator.mjs';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {base64,canonical,hash,hashBytes,sign,SUITE} from '../src/crypto.mjs';
import {coordinatorFixture} from './helpers/coordinator-fixture.mjs';
const route='/v1/key-use/consume';
function body(f,overrides={}){const result={header:{rootKeyId:f.identity.rootKeyId,syncGroupId:'group',conversationId:'conversation',branchId:'branch',keyEpoch:f.record.body.keyEpoch,contentEpoch:1,originDeviceId:'a',schemaVersion:1,cryptoSuite:SUITE,membershipEpoch:f.record.body.membershipEpoch,sourceEpoch:'source',originSequence:1,previousEventHash:'0'.repeat(64),parentRevision:0,eventType:'message',nonce:base64(randomBytes(24))},reservationId:randomUUID(),workerBootId:base64(randomBytes(32)),useId:randomUUID(),...overrides};return {...result,derivedKeyId:derived(f,result)};}
function derived(f,b){const {rootKeyId,syncGroupId,conversationId,branchId,keyEpoch,contentEpoch,originDeviceId}=b.header;return hash(['xiaok/context-sync/derived-key-id/v1',{rootKeyId,syncGroupId,conversationId,branchId,keyEpoch,contentEpoch,originDeviceId},hashBytes(f.material.contentKey),base64(f.material.salt)]);}
// hashBytes is the existing actual manifest key commitment, not hash(canonical(bytes)).
test('legacy root certificates cannot silently acquire encryption witness capability',t=>{const f=coordinatorFixture(t);assert.throws(()=>f.send('a',route,body(f)),/key_use_unavailable/);});
test('a fresh signed request consumes the original reservation and nonce in one durable transaction',t=>{
 const f=coordinatorFixture(t,{keyUse:true}),b=body(f),req=f.request('a',route,b),before=f.journal.head(),result=f.coordinator.handle(req).body.result;
 assert.equal(f.journal.head().sequence,before.sequence+1);assert.deepEqual(result,{useId:b.useId,reservationId:b.reservationId,workerBootId:b.workerBootId,challengeId:req.auth.challengeId,headerHash:hash(b.header),derivedKeyId:derived(f,b),count:1});
 assert.throws(()=>f.send('a',route,b),/key_use_consumed/);assert.equal(f.journal.head().sequence,before.sequence+1);
 const changed=body(f,{reservationId:b.reservationId});assert.throws(()=>f.send('a',route,changed),/key_use_consumed/);
 const sameNonce=body(f);sameNonce.header.nonce=b.header.nonce;assert.throws(()=>f.send('a',route,sameNonce),/key_use_consumed/);
});
test('a lost ACK cannot return an idempotent fresh permit for the same operation ID',t=>{
 const f=coordinatorFixture(t,{keyUse:true}),b=body(f),id=randomUUID();f.send('a',route,b,{requestId:id});
 assert.throws(()=>f.send('a',route,b,{requestId:id}),/key_use_consumed/);
 assert.throws(()=>f.send('a',route,body(f),{requestId:id}),/operation_conflict/);
});
test('server restart retains consumption and cumulative encryption budget',t=>{
 const f=coordinatorFixture(t,{keyUse:true}),a=body(f);f.send('a',route,a);f.coordinator.dispose();f.close();f.open();
 assert.throws(()=>f.send('a',route,a),/key_use_consumed/);const b=body(f);assert.equal(f.send('a',route,b).count,2);
});
test('stale head, origin, source scope, key epoch and malformed fields never consume a permit',t=>{
 const f=coordinatorFixture(t,{keyUse:true}),before=f.journal.head(),stale=f.request('a',route,body(f));f.send('a',route,body(f));
 assert.throws(()=>f.coordinator.handle(stale),/head_changed/);
 for(const mutate of [b=>b.header.originDeviceId='b',b=>b.header.conversationId='forbidden',b=>b.header.keyEpoch++,b=>b.header.membershipEpoch++,b=>b.header.contentEpoch++,b=>b.derivedKeyId='0'.repeat(64),b=>b.workerBootId='short',b=>b.extra='unsupported',b=>b.header.nonce='bad']){
  const b=body(f);mutate(b);assert.throws(()=>f.send('a',route,b));
 }
 assert.equal(f.journal.head().sequence,before.sequence+1);
});
test('consumption is private and does not break read-only full catch-up across its commitment',async t=>{
 const f=coordinatorFixture(t,{keyUse:true});const b=body(f);f.send('a',route,b);const row=f.journal.readJournal().at(-1);assert.equal(row.recordType,'key-use');assert.equal(row.disclosureClass,'scope-private');
 const target=f.journal.head(),controls=f.send('a','/v1/control/pull',{after:0,limit:100,targetHead:target}),events=f.send('a','/v1/events/pull',{conversationId:'conversation',branchId:'branch',after:0,limit:100,targetHead:target});
 assert.ok(!JSON.stringify(controls).includes(b.workerBootId));assert.ok(!JSON.stringify(controls).includes(b.reservationId));assert.deepEqual(events.entries,[]);
 const {fetchVerifiedScope}=await import('../src/sync-driver.mjs');const client={getHead(){const nonce=base64(randomBytes(32));return {nonce,response:f.coordinator.handle(f.request('a','/v1/head',{nonce}))};},call(path,request,options){return f.coordinator.handle(f.request('a',path,request,options));}};
 const verified=await fetchVerifiedScope({client,identity:f.identity,deviceId:'a',scope:{conversationId:'conversation',branchId:'branch'}});assert.deepEqual(verified.events,[]);assert.ok(!canonical(verified).includes(b.workerBootId));
});

test('derived-key count cannot reset on a different nonce or exceed the fixed AEAD budget',t=>{
 const f=coordinatorFixture(t,{keyUse:true}),b=body(f),key='key-use-count:'+derived(f,b);
 f.journal.transact({operationId:randomUUID(),kind:'test_fault',request:{syntheticBudget:true}},tx=>{tx.set(key,2**32-1);return null;});
 assert.equal(f.send('a',route,b).count,2**32);const before=f.journal.head();assert.throws(()=>f.send('a',route,body(f)),/key_use_exhausted/);assert.deepEqual(f.journal.head(),before);
});

test('unknown, duplicate or reordered signed capabilities fail and existing pinned journals cannot be relabelled',t=>{
 const f=coordinatorFixture(t),original=structuredClone(f.identity);
 for(const capabilities of [['head','receipt','authority','other'],['head','receipt','authority','key-use-v1','key-use-v1'],['head','receipt','key-use-v1','authority']]){
  const identity=structuredClone(original);identity.certificate.body.capabilities=capabilities;identity.certificate.signature=sign(['xiaok/context-sync/coordinator-certificate/v1',identity.certificate.body],f.root.privateKey);assert.throws(()=>new Coordinator({journal:f.journal,identity,signingKey:f.online.privateKey}),/invalid_certificate/);
 }
 const identity=structuredClone(original);identity.certificate.body.capabilities.push('key-use-v1');identity.certificate.signature=sign(['xiaok/context-sync/coordinator-certificate/v1',identity.certificate.body],f.root.privateKey);assert.throws(()=>new Coordinator({journal:f.journal,identity,signingKey:f.online.privateKey}),/identity_mismatch/);
});
test('a failure after the actual durable write burns the same reservation even without any returned ACK',t=>{
 const f=coordinatorFixture(t,{keyUse:true}),b=body(f),transact=f.journal.transact.bind(f.journal);let fail=true;
 f.journal.transact=(...args)=>{const result=transact(...args);if(fail&&args[0].recordType==='key-use'){fail=false;throw new Error('synthetic lost write ACK');}return result;};
 assert.throws(()=>f.send('a',route,b),/lost write ACK/);assert.throws(()=>f.send('a',route,b),/key_use_consumed/);assert.equal(f.send('a',route,body(f)).count,2);
});
test('private key-use commitments interleaved with events and global changes preserve exact paged event coverage',async t=>{
 const f=coordinatorFixture(t,{keyUse:true});f.send('a',route,body(f));const event=f.event();f.send('a','/v1/events/push',{envelope:event});f.send('a',route,body(f));
 const scope=f.journal.get('scope:'+hash(['conversation','branch']));f.coordinator.registerScope({record:f.grant(['a'],2,hash(scope.body)),requestSource:'user'});f.send('a',route,body(f));
 const {fetchVerifiedScope}=await import('../src/sync-driver.mjs');const client={getHead(){const nonce=base64(randomBytes(32));return {nonce,response:f.coordinator.handle(f.request('a','/v1/head',{nonce}))};},call(path,request,options){return f.coordinator.handle(f.request('a',path,request,options));}};
 const result=await fetchVerifiedScope({client,identity:f.identity,deviceId:'a',scope:{conversationId:'conversation',branchId:'branch'},pageSize:1});assert.equal(result.events.length,1);
});

test('the actual coordinator cannot serve or consume after its original lifetime transaction has exited',t=>{
 const exec=DatabaseSync.prototype.exec;let owner;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql.includes('BEGIN EXCLUSIVE'))owner=this;return result;};
 let f;try{f=coordinatorFixture(t,{keyUse:true});}finally{DatabaseSync.prototype.exec=exec;}assert.ok(owner.isTransaction);const b=body(f),req=f.request('a',route,b),before=f.journal.head();owner.exec('ROLLBACK');assert.equal(owner.prepare('SELECT 1 AS ok').get().ok,1);
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./journal-worker.mjs',import.meta.url)),'open'],{env:{...process.env,JOURNAL_OPTIONS:JSON.stringify(f.opts)},encoding:'utf8',timeout:5000});assert.equal(child.status,0,child.stderr);assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});t.diagnostic(`lost-lock peer process ${child.pid} reaped`);
 assert.throws(()=>f.coordinator.handle(req),/authority_unavailable/);assert.throws(()=>f.coordinator.createChallenge({deviceId:'a'}),/authority_unavailable/);owner.exec('BEGIN EXCLUSIVE');assert.throws(()=>f.journal.head(),/authority_unavailable/);
 owner.exec('ROLLBACK');f.close();f.open();assert.deepEqual(f.journal.head(),before);assert.equal(f.send('a',route,b).count,1);
});

test('a legacy signed challenge cannot consume key-use even for an otherwise valid active device',t=>{
 const f=coordinatorFixture(t,{keyUse:true}),request=f.request('a',route,body(f)),legacy=f.coordinator.createChallenge({deviceId:'a'});request.auth.challengeId=legacy.body.challengeId;request.signature=sign(['xiaok/context-sync/request/v1',request.auth],f.devices.a.sign.privateKey);const before=f.journal.head();assert.throws(()=>f.coordinator.handle(request),/key_use_unavailable/);assert.deepEqual(f.journal.head(),before);
});
