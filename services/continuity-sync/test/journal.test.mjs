import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { AuthorityJournal } from '../src/journal.mjs';
import { hash } from '../src/crypto.mjs';

const identity={schemaVersion:1,rootKeyId:'root',syncGroupId:'group',coordinatorId:'authority',rootPublicKey:'public-fixture'};
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-sync-journal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:3}));return {stateDir:path.join(dir,'state'),witnessDir:path.join(dir,'witness'),identity};}
function mutate(j,id='op1',value=1){return j.transact({operationId:id,kind:'fixture',request:{value}},tx=>{tx.set('counter',value);return {value};});}

test('persists immutable decisions and rejects changed operation IDs after restart',t=>{
 const opts=fixture(t);let j=new AuthorityJournal({...opts,initialize:true});const result=mutate(j);assert.equal(j.get('counter'),1);
 const head=j.head();assert.equal(head.sequence,1);j.close();j=new AuthorityJournal(opts);t.after(()=>j.close());
 assert.deepEqual(mutate(j),result);assert.deepEqual(j.head(),head);assert.throws(()=>mutate(j,'op1',2),/operation_conflict/);assert.equal(j.get('counter'),1);
 assert.deepEqual(j.readJournal(0,10).map(x=>x.operationId),['op1']);
});
test('public commitments verify the exact head without exposing private requests or changes',t=>{
 const opts=fixture(t),j=new AuthorityJournal({...opts,initialize:true});t.after(()=>j.close());mutate(j);const full=j.readJournal(0,10)[0],proof=j.readCommitments(0,10)[0];
 assert.equal(proof.entryHash,hash(Object.fromEntries(Object.entries(full).filter(([k])=>k!=='hash'))));assert.equal(proof.request,undefined);assert.equal(proof.changes,undefined);assert.equal(hash(Object.fromEntries(Object.entries(proof).filter(([k])=>k!=='hash'))),j.head().hash);
});
test('snapshots request before apply so caller mutation cannot corrupt an acknowledged journal',t=>{
 const opts=fixture(t);let j=new AuthorityJournal({...opts,initialize:true});const request={value:1,nested:{id:'accepted'}};
 const result=j.transact({operationId:'mutable',kind:'fixture',request},(tx,accepted)=>{
  request.value=2;request.nested.id='changed';assert.ok(Object.isFrozen(accepted));assert.ok(Object.isFrozen(accepted.nested));
  tx.set('counter',accepted.value);return {value:accepted.value};
 });assert.deepEqual(result.request,{value:1,nested:{id:'accepted'}});j.close();j=new AuthorityJournal(opts);t.after(()=>j.close());
 assert.equal(j.get('counter'),1);assert.deepEqual(j.transact({operationId:'mutable',kind:'fixture',request:{value:1,nested:{id:'accepted'}}},()=>assert.fail('must reuse decision')),result);
 assert.throws(()=>j.transact({operationId:'mutable',kind:'fixture',request},()=>assert.fail('must not apply')),/operation_conflict/);
});
test('keeps lifetime owner lock through both independent commits',t=>{
 const opts=fixture(t);let stages=0;
 const j=new AuthorityJournal({...opts,initialize:true,fault(stage){if(['body_prepared','witness_committed','body_committed'].includes(stage)){
  stages++;const run=spawnSync(process.execPath,[fileURLToPath(new URL('./journal-worker.mjs',import.meta.url)),'open'],{env:{...process.env,JOURNAL_OPTIONS:JSON.stringify(opts)},encoding:'utf8',timeout:5000});assert.equal(run.status,23,run.stderr);
 }}});t.after(()=>j.close());mutate(j);mutate(j,'op2',2);assert.equal(stages,6);
});
test('poisons immediately after witnessed body failure; all read/receipt and mutation routes reject',t=>{
 const opts=fixture(t);const j=new AuthorityJournal({...opts,initialize:true,fault(stage){if(stage==='witness_committed')throw new Error('simulated_commit_failure');}});t.after(()=>j.close());
 assert.throws(()=>mutate(j),/authority_unavailable/);
 for(const action of [()=>j.head(),()=>j.get('counter'),()=>j.readJournal(0,10),()=>j.getDecision('op1'),()=>mutate(j,'op2',2)])assert.throws(action,/authority_unavailable/);
 j.close();assert.throws(()=>new AuthorityJournal(opts),/authority_unavailable/);
});
test('pre-witness errors rollback without poisoning or consuming the operation',t=>{
 const opts=fixture(t);let fail=true;const j=new AuthorityJournal({...opts,initialize:true,fault(stage){if(fail&&stage==='body_prepared')throw new Error('before_witness');}});t.after(()=>j.close());
 assert.throws(()=>mutate(j),/before_witness/);assert.equal(j.head().sequence,0);assert.equal(j.get('counter'),undefined);fail=false;mutate(j);assert.equal(j.head().sequence,1);
});
test('uncertain rollback result poisons even if the body happens to match the old head',t=>{
 const opts=fixture(t);const j=new AuthorityJournal({...opts,initialize:true,fault(stage){if(stage==='body_prepared')throw new Error('before_witness');}});t.after(()=>j.close());
 const original=DatabaseSync.prototype.exec;let once=true;
 t.mock.method(DatabaseSync.prototype,'exec',function(sql){const result=original.call(this,sql);if(once&&sql==='ROLLBACK'){once=false;throw new Error('rollback_result_unknown');}return result;});
 assert.throws(()=>mutate(j),/authority_unavailable/);assert.throws(()=>j.head(),/authority_unavailable/);
});
test('restoring old body or old witness independently cannot sign or serve current state',t=>{
 const opts=fixture(t);let j=new AuthorityJournal({...opts,initialize:true});mutate(j);j.close();
 const oldBody=fs.readFileSync(path.join(opts.stateDir,'authority.sqlite')),oldWitness=fs.readFileSync(path.join(opts.witnessDir,'heads.sqlite'));
 j=new AuthorityJournal(opts);mutate(j,'op2',2);j.close();const newBody=fs.readFileSync(path.join(opts.stateDir,'authority.sqlite'));
 fs.writeFileSync(path.join(opts.stateDir,'authority.sqlite'),oldBody);assert.throws(()=>new AuthorityJournal(opts),/authority_unavailable/);
 fs.writeFileSync(path.join(opts.stateDir,'authority.sqlite'),newBody);fs.writeFileSync(path.join(opts.witnessDir,'heads.sqlite'),oldWitness);assert.throws(()=>new AuthorityJournal(opts),/authority_unavailable/);
});
test('missing witness, identity mismatch and nonempty initial directories never silently reinitialize',t=>{
 const opts=fixture(t);const j=new AuthorityJournal({...opts,initialize:true});mutate(j);j.close();
 assert.throws(()=>new AuthorityJournal({...opts,identity:{...identity,syncGroupId:'foreign'}}),/authority_unavailable/);
 fs.unlinkSync(path.join(opts.witnessDir,'heads.sqlite'));
 assert.throws(()=>new AuthorityJournal(opts),/authority_unavailable/);assert.throws(()=>new AuthorityJournal({...opts,initialize:true}),/authority_unavailable/);
});
for(const stage of ['body_prepared','witness_committed','body_committed'])test(`actual SIGKILL at ${stage} preserves the specified crash boundary`,async t=>{
 const opts=fixture(t);const j=new AuthorityJournal({...opts,initialize:true});j.close();const marker=path.join(opts.stateDir,'crash-stage');
 const child=spawn(process.execPath,[fileURLToPath(new URL('./journal-worker.mjs',import.meta.url)),'crash'],{env:{...process.env,JOURNAL_OPTIONS:JSON.stringify(opts),CRASH_STAGE:stage,CRASH_MARKER:marker},stdio:['ignore','ignore','pipe']});
 fs.writeFileSync(path.join(opts.stateDir,'test-process.json'),JSON.stringify({pid:child.pid,stage}));
 const exited=once(child,'exit');let exitSeen=false;exited.then(()=>{exitSeen=true;});t.after(async()=>{if(!exitSeen)child.kill('SIGKILL');await exited;});
 const start=Date.now();while(!fs.existsSync(marker)){if(exitSeen||Date.now()-start>5000)assert.fail('worker did not reach crash stage');await new Promise(r=>setTimeout(r,10));}
 child.kill('SIGKILL');await exited;
 if(stage==='witness_committed'){assert.throws(()=>new AuthorityJournal(opts),/authority_unavailable/);return;}
 const reopened=new AuthorityJournal(opts);t.after(()=>reopened.close());assert.equal(reopened.head().sequence,stage==='body_committed'?1:0);
 if(stage==='body_committed')assert.deepEqual(reopened.getDecision('op1').result,{value:1});
});

for(const mode of ['extra-control','missing-control','row-operation','old-entry'])test(`fresh original replay rejects ${mode} without advancing its genuine head`,t=>{
 const opts=fixture(t),j=new AuthorityJournal({...opts,initialize:true});t.after(()=>j.close());mutate(j);mutate(j,'op2',2);
 const head=j.head();assert.equal(j.assertReplayCurrent(),undefined);
 const db=new DatabaseSync(path.join(opts.stateDir,'authority.sqlite'));
 try{
  if(mode==='extra-control')db.prepare('INSERT INTO control VALUES (?,?)').run('nonce:foreign','{}');
  if(mode==='missing-control')db.prepare('DELETE FROM control WHERE key=?').run('counter');
  if(mode==='row-operation')db.prepare('UPDATE authority_journal SET operation_id=? WHERE sequence=1').run('changed-physical-row');
  if(mode==='old-entry'){const row=db.prepare('SELECT entry FROM authority_journal WHERE sequence=1').get(),entry=JSON.parse(row.entry);entry.request.value=99;db.prepare('UPDATE authority_journal SET entry=? WHERE sequence=1').run(JSON.stringify(entry));}
 }finally{db.close();}
 assert.deepEqual(j.head(),head,'ordinary pinned head does not authenticate materialized rows');
 assert.throws(()=>j.assertReplayCurrent(),/authority_unavailable/);
 assert.throws(()=>j.head(),/authority_unavailable/,'failure is sticky for this original journal');
});
