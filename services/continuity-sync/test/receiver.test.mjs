import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import sodium from 'libsodium-wrappers';
import { coordinatorFixture as fixture } from './helpers/coordinator-fixture.mjs';
import { verifyCatchUp } from '../src/receiver.mjs';
import { base64,hash,sign } from '../src/crypto.mjs';
import { journalCommitment } from '../src/journal.mjs';
await sodium.ready;
function capture(f,deviceId='a',privateOverride,pageSize=100){
 const firstNonce=base64(sodium.randombytes_buf(32));const firstHead=f.coordinator.handle(f.request(deviceId,'/v1/head',{nonce:firstNonce}));const targetHead=firstHead.body.result.head;
 const commitments=[],controlEntries=[],privateEntries=[];
 let after=0;while(after<targetHead.sequence){
  const proof=f.send(deviceId,'/v1/journal/pull',{after,limit:pageSize,targetHead});assert.ok(proof.entries.length);commitments.push(...proof.entries);
  controlEntries.push(...f.send(deviceId,'/v1/control/pull',{after,limit:pageSize,targetHead}).entries);
  if(privateOverride===undefined)privateEntries.push(...f.send(deviceId,'/v1/events/pull',{conversationId:'conversation',branchId:'branch',after,limit:pageSize,targetHead}).entries);
  after=proof.entries.at(-1).sequence;
 }
 const finalNonce=base64(sodium.randombytes_buf(32));const finalHead=f.coordinator.handle(f.request(deviceId,'/v1/head',{nonce:finalNonce}));
 return {identity:f.identity,deviceId,scope:{conversationId:'conversation',branchId:'branch'},firstNonce,firstHead,finalNonce,finalHead,commitments,controlEntries,privateEntries:privateOverride??privateEntries};
}
test('verifies an exact complete control and scoped event chain before producing a read candidate',t=>{
 const f=fixture(t);const envelope=f.event();f.send('a','/v1/events/push',{envelope});const args=capture(f),result=verifyCatchUp(args);
 assert.deepEqual(result.head,args.firstHead.body.result.head);assert.equal(result.events.length,1);assert.equal(result.events[0].eventHash,hash(envelope));assert.equal(result.scope.body.allowedDeviceIds[0],'a');assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.events[0].envelope));
});
test('missing tail, omitted global control, omitted last scoped event and foreign entry all fail closed',t=>{
 const f=fixture(t);f.send('a','/v1/events/push',{envelope:f.event()});const args=capture(f);
 for(const altered of [{...args,commitments:args.commitments.slice(0,-1)},{...args,controlEntries:args.controlEntries.slice(0,-1)},{...args,privateEntries:[]},{...args,privateEntries:[{...args.privateEntries[0],entry:{...args.privateEntries[0].entry,request:{forged:true}}}]}])assert.throws(()=>verifyCatchUp(altered));
});
test('current root scope excludes a device even if a relay hands it a valid private entry',t=>{
 const f=fixture(t);f.addB();const old=f.journal.get('scope:'+hash(['conversation','branch']));f.coordinator.registerScope({record:f.grant(['a'],3,hash(old.body)),requestSource:'user'});f.send('a','/v1/events/push',{envelope:f.event()});
 const authorized=capture(f),excluded=capture(f,'b',authorized.privateEntries);assert.throws(()=>verifyCatchUp(excluded),/scope_forbidden/);
});
test('fresh head drift, nonce replay and a lower restored OS floor never open candidates',t=>{
 const f=fixture(t);const first=f.event();f.send('a','/v1/events/push',{envelope:first});const args=capture(f);
 assert.throws(()=>verifyCatchUp({...args,firstNonce:base64(sodium.randombytes_buf(32))}),/invalid_head/);
 assert.throws(()=>verifyCatchUp({...args,minimumHead:{...args.firstHead.body.result.head,sequence:999}}),/head_rollback/);
 f.send('a','/v1/events/push',{envelope:f.event('a',2,hash(first))});const finalNonce=base64(sodium.randombytes_buf(32)),finalHead=f.coordinator.handle(f.request('a','/v1/head',{nonce:finalNonce}));
 assert.throws(()=>verifyCatchUp({...args,finalNonce,finalHead}),/head_changed/);
});
test('the OS watermark must be an exact ancestor rather than merely a lower counter',t=>{
 const f=fixture(t);f.send('a','/v1/events/push',{envelope:f.event()});const args=capture(f),first=args.commitments[0];
 const prefix={identityHash:first.identityHash,sequence:first.sequence,hash:first.hash};assert.equal(verifyCatchUp({...args,minimumHead:prefix}).head.hash,args.firstHead.body.result.head.hash);
 assert.throws(()=>verifyCatchUp({...args,minimumHead:{...prefix,hash:'f'.repeat(64)}}),/head_rollback/);
 assert.throws(()=>verifyCatchUp({...args,minimumHead:{...prefix,sequence:0,hash:'f'.repeat(64)}}),/head_rollback/);
 assert.throws(()=>verifyCatchUp({...args,minimumHead:{...args.firstHead.body.result.head,hash:'f'.repeat(64)}}),/head_rollback/);
});
test('a correctly committed private entry cannot smuggle extra fields or another scope through its changes',t=>{
 const f=fixture(t);f.send('a','/v1/events/push',{envelope:f.event()});const original=capture(f);
 for(const alter of [entry=>{entry.result.extraPrivateBody='must never become a candidate';},entry=>{entry.changes.push({key:'other-private-scope',deleted:false,value:{text:'foreign'}});}]){
  const args=structuredClone(original),bundle=args.privateEntries.at(-1);alter(bundle.entry);const commitment=journalCommitment(bundle.entry),proof={...commitment,hash:hash(commitment)};
  bundle.commitment=proof;args.commitments[args.commitments.length-1]=proof;
  for(const response of [args.firstHead,args.finalHead]){response.body.result.head.hash=proof.hash;response.body.journalHead.hash=proof.hash;response.signature=sign(['xiaok/context-sync/response/v1',response.body],f.online.privateKey);}
  assert.throws(()=>verifyCatchUp(args));
 }
});
test('individually bounded valid events are verified across pages beyond the single-wire byte budget',t=>{
 const f=fixture(t);let previous='0'.repeat(64);for(let n=1;n<=4;n++){const envelope=f.event('a',n,previous,{text:'x'.repeat(200*1024)});f.send('a','/v1/events/push',{envelope});previous=hash(envelope);}
 const args=capture(f,'a',undefined,1);assert.ok(Buffer.byteLength(JSON.stringify(args))>2*1024*1024);assert.equal(verifyCatchUp(args).events.length,4);
});
test('two fresh head proofs cannot reuse the same nonce and response',t=>{
 const f=fixture(t),args=capture(f);assert.throws(()=>verifyCatchUp({...args,finalNonce:args.firstNonce,finalHead:args.firstHead}),/invalid_head/);
});
test('device revocation covers every accepted target stream exactly once including replay aliases',t=>{
 const f=fixture(t);f.addB();const b=f.event('b');f.send('b','/v1/events/push',{envelope:b});const next=f.membership([f.row('a'),f.row('b','revoked',f.record.body.devices[1].pairingId)]);f.coordinator.appendMembership({record:next,manifest:f.manifest(next),requestSource:'user'});f.record=next;f.send('a','/v1/events/push',{envelope:b});
 const args=capture(f);assert.equal(verifyCatchUp(args).events.length,1);
 for(const change of [body=>{body.cutoffs=[];},body=>{body.cutoffs.push(structuredClone(body.cutoffs[0]));},body=>{body.cutoffs[0].originDeviceId='a';}]){
  const forged=structuredClone(args),bundles=[...forged.controlEntries,...forged.privateEntries],bySequence=new Map(bundles.map(b=>[b.entry.sequence,b]));let revocationHash;
  const changed=bundles.find(b=>b.entry.changes.some(c=>c.key.startsWith('revocation:'))).entry;
  const rev=changed.changes.find(c=>c.key.startsWith('revocation:')).value;change(rev.body);rev.signature=sign(['xiaok/context-sync/revocation/v1',rev.body],f.online.privateKey);revocationHash=hash(rev.body);changed.changes.find(c=>c.key==='revocation-head').value.hash=revocationHash;
  let previous=forged.commitments[0].previousHash;
  forged.commitments=forged.commitments.map(p=>{const bundle=bySequence.get(p.sequence);bundle.entry.previousHash=previous;const c=journalCommitment(bundle.entry),proof={...c,hash:hash(c)};bundle.commitment=proof;previous=proof.hash;return proof;});
  for(const response of [forged.firstHead,forged.finalHead]){response.body.result.head.hash=previous;response.body.journalHead.hash=previous;response.body.result.revocationHead.hash=revocationHash;response.signature=sign(['xiaok/context-sync/response/v1',response.body],f.online.privateKey);}
  assert.throws(()=>verifyCatchUp(forged));
 }
});
test('online coordinator signatures cannot authorize an origin excluded by the root scope at first acceptance',t=>{
 const f=fixture(t);f.addB();const old=f.journal.get('scope:'+hash(['conversation','branch']));f.coordinator.registerScope({record:f.grant(['a'],3,hash(old.body)),requestSource:'user'});
 f.send('a','/v1/events/push',{envelope:f.event('a')});const forged=capture(f),bundle=forged.privateEntries.at(-1),entry=bundle.entry;
 // Model a compromised online signer, preserving all root records and the valid B device signature.
 const envelope=f.event('b'),oldReceipt=entry.result.accepted,streamId=hash(['group','conversation','branch','b',1]),receipt={...oldReceipt,streamId,eventHash:hash(envelope)};
 entry.request.actor='b';entry.request.body.envelope=envelope;entry.requestHash=hash({kind:entry.kind,request:entry.request});entry.result.accepted=receipt;
 for(const change of entry.changes){
  if(change.key==='stream:'+oldReceipt.streamId){change.key='stream:'+streamId;change.value={...change.value,hash:receipt.eventHash,originDeviceId:'b'};}
  else if(change.key==='event:'+oldReceipt.streamId+':1'){change.key='event:'+streamId+':1';change.value={envelope,accepted:receipt};}
  else if(change.key==='stream-ids')change.value=change.value.map(id=>id===oldReceipt.streamId?streamId:id);
 }
 entry.changes.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 const commitment=journalCommitment(entry),proof={...commitment,hash:hash(commitment)};bundle.commitment=proof;forged.commitments[forged.commitments.length-1]=proof;
 for(const response of [forged.firstHead,forged.finalHead]){response.body.result.head.hash=proof.hash;response.body.journalHead.hash=proof.hash;response.signature=sign(['xiaok/context-sync/response/v1',response.body],f.online.privateKey);}
 assert.throws(()=>verifyCatchUp(forged),/scope_forbidden/);
});
test('origin scope is checked at the first accepted event rather than its later authorized replay',t=>{
 const f=fixture(t);f.addB();const envelope=f.event('b');f.send('b','/v1/events/push',{envelope});const old=f.journal.get('scope:'+hash(['conversation','branch']));f.coordinator.registerScope({record:f.grant(['a'],3,hash(old.body)),requestSource:'user'});f.send('a','/v1/events/push',{envelope});
 assert.equal(verifyCatchUp(capture(f)).events.length,1);
});
test('each verified event retains its original root-signed acceptance scope across owner transfer and relay',t=>{
 const f=fixture(t);f.addB();const original=f.journal.get('scope:'+hash(['conversation','branch']));
 const envelope=f.event('a');f.send('a','/v1/events/push',{envelope});
 const transferred=f.grant(['a','b'],3,hash(original.body));transferred.body.ownerDeviceId='b';
 transferred.signature=sign(['xiaok/context-sync/scope/v1',transferred.body],f.root.privateKey);
 f.coordinator.registerScope({record:transferred,requestSource:'user'});
 f.send('b','/v1/events/push',{envelope});
 const later=f.event('b');f.send('b','/v1/events/push',{envelope:later});
 const verified=verifyCatchUp(capture(f));
 assert.equal(verified.scope.body.ownerDeviceId,'b');assert.equal(verified.events.length,2);
 assert.deepEqual(verified.events[0].acceptedScope,original);
 assert.deepEqual(verified.events[1].acceptedScope,transferred);
 assert.equal(verified.events[0].envelope.header.originDeviceId,verified.events[0].acceptedScope.body.ownerDeviceId);
 assert.ok(Object.isFrozen(verified.events[0].acceptedScope));assert.ok(Object.isFrozen(verified.events[0].acceptedScope.body));
});
