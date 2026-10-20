import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {coordinatorFixture as fixture} from './helpers/coordinator-fixture.mjs';
import {verifyCatchUp} from '../src/receiver.mjs';
import {base64,hash,sign} from '../src/crypto.mjs';
import {journalCommitment} from '../src/journal.mjs';
const ROUTE='/v1/content-revocations/append',ZERO='0'.repeat(64);
function record(f,{owner='a',operationId=randomUUID(),conversationId='conversation',branchId='branch',scopeRevision=f.journal.get('scope:'+hash([conversationId,branchId])).body.revision,sourceSequence=1,previousHash=ZERO,targets=[{kind:'message',id:'m'}]}={}){
 const body={schemaVersion:1,rootKeyId:f.identity.rootKeyId,syncGroupId:'group',coordinatorId:'coordinator',operationId,conversationId,branchId,logicalProfileId:'logical',ownerDeviceId:owner,scopeRevision,sourceSequence,previousHash,targets};
 return {body,signature:sign(['xiaok/context-sync/content-revocation/v1',body],f.devices[owner].sign.privateKey)};
}
function capture(f){
 const firstNonce=base64(new Uint8Array(32).fill(1)),firstHead=f.coordinator.handle(f.request('a','/v1/head',{nonce:firstNonce})),targetHead=firstHead.body.result.head,commitments=[],controlEntries=[],privateEntries=[];
 for(let after=0;after<targetHead.sequence;){const p=f.send('a','/v1/journal/pull',{after,limit:1,targetHead});commitments.push(...p.entries);controlEntries.push(...f.send('a','/v1/control/pull',{after,limit:1,targetHead}).entries);privateEntries.push(...f.send('a','/v1/events/pull',{conversationId:'conversation',branchId:'branch',after,limit:1,targetHead}).entries);after=p.entries.at(-1).sequence;}
 const finalNonce=base64(new Uint8Array(32).fill(2)),finalHead=f.coordinator.handle(f.request('a','/v1/head',{nonce:finalNonce}));return {identity:f.identity,deviceId:'a',scope:{conversationId:'conversation',branchId:'branch'},firstNonce,firstHead,finalNonce,finalHead,commitments,controlEntries,privateEntries};
}
function rechainLast(f,args){
 const bundle=args.controlEntries.at(-1),e=bundle.entry;e.requestHash=hash({kind:e.kind,request:e.request});const proof={...journalCommitment(e)};proof.hash=hash(proof);bundle.commitment=proof;args.commitments[args.commitments.length-1]=proof;
 for(const response of [args.firstHead,args.finalHead]){response.body.result.head.hash=proof.hash;response.body.journalHead.hash=proof.hash;response.signature=sign(['xiaok/context-sync/response/v1',response.body],f.online.privateKey);}return args;
}
test('real owner content deletion advances the existing complete revocation head and no plaintext',t=>{
 const f=fixture(t),r=record(f),answer=f.send('a',ROUTE,{record:r});assert.equal(answer.revocationHead.sequence,1);const result=verifyCatchUp(capture(f));assert.equal(result.status,'verified-control-only');assert.equal(result.revocations[0].body.type,'content');assert.deepEqual(result.revocations[0].body.targets,r.body.targets);assert.equal(result.revocations[0].body.ownerRecordHash,hash(r.body));assert.equal(f.journal.readJournal().at(-1).recordType,'content-revocation');
});
test('inner owner operation is idempotent across outer IDs and survives restart without another tombstone',t=>{
 const f=fixture(t),r=record(f,{operationId:'original'}),answer=f.send('a',ROUTE,{record:r}),head=f.journal.head();assert.deepEqual(f.send('a',ROUTE,{record:r}),answer);assert.deepEqual(f.journal.head(),head);
 f.close();f.open(false);assert.deepEqual(f.send('a',ROUTE,{record:r}),answer);assert.deepEqual(f.journal.head(),head);
 const changed=record(f,{operationId:'original',targets:[{kind:'message',id:'different'}]});assert.throws(()=>f.send('a',ROUTE,{record:changed}),/operation_conflict/);
});
test('only current authenticated user owner with the exact inner signature/profile/scope can append',t=>{
 const f=fixture(t);f.addB();assert.throws(()=>f.send('b',ROUTE,{record:record(f,{owner:'b'})}),/scope_forbidden/);
 for(const mutate of [r=>{r.body.logicalProfileId='foreign';r.signature=sign(['xiaok/context-sync/content-revocation/v1',r.body],f.devices.a.sign.privateKey);},r=>{r.signature=sign(['xiaok/context-sync/content-revocation/v1',r.body],f.online.privateKey);},r=>{r.body.scopeRevision--;r.signature=sign(['xiaok/context-sync/content-revocation/v1',r.body],f.devices.a.sign.privateKey);}]){const r=record(f);mutate(r);assert.throws(()=>f.send('a',ROUTE,{record:r}));}
 for(const source of ['agent','scheduler']){const req=f.request('a',ROUTE,{record:record(f)});req.requestSource=source;assert.throws(()=>f.coordinator.handle(req),/forbidden/);}
 assert.equal(f.journal.get('revocation-head'),undefined);
});
test('same IDs in another branch never share tombstones, and same inner operation is scoped independently',t=>{
 const f=fixture(t),first=record(f,{operationId:'shared'});f.send('a',ROUTE,{record:first});
 const body={...f.grant().body,operationId:randomUUID(),branchId:'other'};f.coordinator.registerScope({record:{body,signature:sign(['xiaok/context-sync/scope/v1',body],f.root.privateKey)},requestSource:'user'});
 f.send('a',ROUTE,{record:record(f,{operationId:'shared',branchId:'other'})});const keys=f.journal.readJournal().flatMap(e=>e.changes.filter(c=>c.key.startsWith('content-tombstone:')).map(c=>c.key));assert.equal(keys.length,2);assert.equal(new Set(keys).size,2);
 assert.throws(()=>f.send('a',ROUTE,{record:record(f,{targets:[{kind:'conversation',id:'foreign'}]})}));
});
test('source sequence/previous hash cannot skip, reset or reorder accepted revocations',t=>{
 const f=fixture(t),first=record(f);f.send('a',ROUTE,{record:first});for(const opts of [{sourceSequence:1},{sourceSequence:3,previousHash:hash(first.body)},{sourceSequence:2,previousHash:ZERO}])assert.throws(()=>f.send('a',ROUTE,{record:record(f,opts)}));
 const next=record(f,{sourceSequence:2,previousHash:hash(first.body),targets:[{kind:'reference',id:'r'}]});assert.equal(f.send('a',ROUTE,{record:next}).revocationHead.sequence,2);assert.equal(verifyCatchUp(capture(f)).revocations.length,2);
});
test('root scope revision and key rotations never erase a prior permanent tombstone',t=>{
 const f=fixture(t),first=record(f);f.send('a',ROUTE,{record:first});const before=f.journal.readJournal().at(-1).changes.find(c=>c.key.startsWith('content-tombstone:'));
 const priorScope=f.journal.get('scope:'+hash(['conversation','branch']));f.coordinator.registerScope({record:f.grant(['a'],2,hash(priorScope.body)),requestSource:'user'});const next=f.membership([f.row('a')]);f.coordinator.appendMembership({record:next,manifest:f.manifest(next),requestSource:'user'});f.record=next;
 assert.deepEqual(f.journal.get(before.key),before.value);const again=record(f,{sourceSequence:2,previousHash:hash(first.body)});f.send('a',ROUTE,{record:again});assert.deepEqual(f.journal.get(before.key),before.value);assert.equal(verifyCatchUp(capture(f)).revocations.length,2);
});
test('receiver rejects omitted revocation tail, online-only forged owner signature and private extra changes',t=>{
 const f=fixture(t);f.send('a',ROUTE,{record:record(f)});const args=capture(f);assert.throws(()=>verifyCatchUp({...args,controlEntries:args.controlEntries.slice(0,-1)}),/incomplete_control/);
 for(const mutate of [e=>{e.request.body.record.signature=sign(['xiaok/context-sync/content-revocation/v1',e.request.body.record.body],f.online.privateKey);},e=>{e.changes.push({key:'foreign-private-record',deleted:false,value:'PRIVATE_CANARY'});}]){const altered=structuredClone(args);mutate(altered.controlEntries.at(-1).entry);assert.throws(()=>verifyCatchUp(rechainLast(f,altered)));}
});
for(const stage of ['body_prepared','witness_committed','body_committed'])test(`actual content route at ${stage} never acknowledges partial tombstones or duplicates a lost ACK`,t=>{
 const f=fixture(t),r=record(f,{targets:[{kind:'message',id:'m1'},{kind:'message',id:'m2'}]}),before=f.journal.head();
 f.close();let inject=true;f.open(false,{fault(s){if(inject&&s===stage)throw new Error('content_fault');}});
 assert.throws(()=>f.send('a',ROUTE,{record:r}));inject=false;
 if(stage!=='body_prepared')assert.throws(()=>f.journal.head(),/authority_unavailable/);
 f.close();
 if(stage==='witness_committed'){assert.throws(()=>f.open(false),/authority_unavailable/);return;}
 f.open(false);
 if(stage==='body_prepared'){
  assert.deepEqual(f.journal.head(),before);assert.equal(f.journal.get('revocation-head'),undefined);
  assert.equal(f.journal.readJournal().flatMap(e=>e.changes).filter(c=>c.key.startsWith('content-')).length,0);
 }else{
  assert.equal(f.journal.head().sequence,before.sequence+1);
  const changes=f.journal.readJournal().at(-1).changes;
  assert.equal(changes.filter(c=>c.key.startsWith('content-tombstone:')).length,2);
  for(const change of changes)assert.deepEqual(f.journal.get(change.key),change.value);
 }
 const result=f.send('a',ROUTE,{record:r}),after=f.journal.head();assert.equal(result.revocationHead.sequence,1);
 assert.deepEqual(f.send('a',ROUTE,{record:r}),result);assert.deepEqual(f.journal.head(),after);
 assert.equal(verifyCatchUp(capture(f)).revocations.length,1);
});
test('owner transfer and return cannot clear first tombstones or reset the original source chain',t=>{
 const f=fixture(t);f.addB();const a=record(f);f.send('a',ROUTE,{record:a});const first=f.journal.readJournal().at(-1).changes.find(c=>c.key.startsWith('content-tombstone:'));
 function owner(id){const prior=f.journal.get('scope:'+hash(['conversation','branch'])),body={...prior.body,operationId:randomUUID(),ownerDeviceId:id,revision:prior.body.revision+1,previousHash:hash(prior.body)};f.coordinator.registerScope({record:{body,signature:sign(['xiaok/context-sync/scope/v1',body],f.root.privateKey)},requestSource:'user'});}
 owner('b');f.send('b',ROUTE,{record:record(f,{owner:'b'})});owner('a');
 assert.throws(()=>f.send('a',ROUTE,{record:record(f)}));
 f.send('a',ROUTE,{record:record(f,{sourceSequence:2,previousHash:hash(a.body)})});
 assert.deepEqual(f.journal.get(first.key),first.value);assert.equal(verifyCatchUp(capture(f)).revocations.filter(r=>r.body.type==='content').length,3);
});
