import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,closeSync,rmSync}from 'node:fs';
import {tmpdir}from 'node:os';
import {join}from 'node:path';
import {createHash}from 'node:crypto';
import {createOwnedSessionShutdownJournal}from '../../desktop/tests/fixtures/owned-session-shutdown-phase.mjs';
const retainedPartialUnitRoots=[];
function fixture(){
 let allocated,root,fd,closed=false;const refs=[];
 const keep=(label,value)=>{refs.push({label,value});if(label==='phase-native-fd')fd=value;return value;};
 const close=()=>{if(!closed&&fd!==undefined){closed=true;closeSync(fd);}};
 try{
  allocated=mkdtempSync(join(tmpdir(),'owned-phase-unit-'));root=realpathSync(allocated);const file=join(root,'phase-v1.jsonl');
  const journal=createOwnedSessionShutdownJournal({file,runNonce:'1'.repeat(32),fixtureNonce:'12345678-1234-1234-1234-123456789abc',pid:process.pid,ppid:process.ppid,keep});
  return{root,file,refs,journal,close,cleanup(){try{close();}catch(error){retainedPartialUnitRoots.push({root,refs,error});throw error;}rmSync(root,{recursive:true,force:false});}};
 }catch(error){
  const errors=[error];let closeConfirmed=true;try{close();}catch(cleanup){closeConfirmed=false;errors.push(cleanup);}if(root&&closeConfirmed){try{rmSync(root,{recursive:true,force:false});}catch(cleanup){errors.push(cleanup);}}else if(allocated)retainedPartialUnitRoots.push({allocated,root,refs,errors});
  if(errors.length===1)throw error;throw new AggregateError(errors,'phase_unit_setup_failed',{cause:error});
 }
}
function withFixture(work){let f,body,cleanup;try{f=fixture();work(f);}catch(error){body={error};}finally{if(f)try{f.cleanup();}catch(error){cleanup={error};}}if(body&&cleanup)throw new AggregateError([body.error,cleanup.error],'phase_unit_body_and_cleanup_failed',{cause:body.error});if(body)throw body.error;if(cleanup)throw cleanup.error;}
function chain(file){
 const text=readFileSync(file,'utf8');assert.ok(text.endsWith('\n'));let previous='0'.repeat(64),seq=0;
 return text.trimEnd().split('\n').map(line=>{const row=JSON.parse(line),{hash,...body}=row;assert.equal(row.seq,++seq);assert.equal(row.previousHash,previous);assert.equal(hash,createHash('sha256').update(JSON.stringify(body)).digest('hex'));previous=hash;return row;});
}
test('actual synchronous journal persists a closed own-data hash chain before returning',()=>{
 withFixture(f=>{f.journal.record('module_guard_import','entered');assert.equal(chain(f.file).at(-1).state,'entered');f.journal.record('module_guard_import','fulfilled');const rows=chain(f.file);assert.equal(rows.length,3);assert.equal(rows[2].state,'fulfilled');for(const r of f.refs.filter(r=>r.label==='phase-pending-row'))assert.equal(Object.getPrototypeOf(r.value),null);});
});
test('opaque Proxy and nullable original errors occupy identity slots without any trap',()=>{
 let traps=0;const opaque=new Proxy({},{get(){traps++;throw Error('trap');},getOwnPropertyDescriptor(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');},getPrototypeOf(){traps++;throw Error('trap');}});
 withFixture(f=>{for(const e of [opaque,opaque,undefined,null])f.journal.rejected('body_failure',e);const rows=chain(f.file);assert.deepEqual(rows.slice(1).map(r=>r.errorSlot),[1,1,2,3]);assert.equal(traps,0);const slots=f.refs.find(r=>r.label==='phase-original-error-slots').value;assert.equal(slots.length,3);assert.equal(slots[0],opaque);assert.equal(slots[1],undefined);assert.equal(slots[2],null);assert.ok(!readFileSync(f.file,'utf8').includes('trap'));});
});
test('actual diagnostic IO failure preserves original nullable rejection and actual IO error refs',()=>{
 withFixture(f=>{f.close();let caught;try{f.journal.rejected('body_failure',null);}catch(error){caught=error;}assert.ok(caught instanceof AggregateError);assert.equal(caught.errors.length,2);assert.equal(caught.errors[0],null);assert.equal(caught.cause,null);assert.equal(caught.errors[1],f.refs.find(r=>r.label==='phase-original-receipt-error').value);assert.notEqual(caught.errors[1],null);});
});
test('unknown phase, invalid state and non-finite counters fail without appending',()=>{
 withFixture(f=>{const before=readFileSync(f.file,'utf8');assert.throws(()=>f.journal.record('UNKNOWN','entered'));assert.throws(()=>f.journal.record('body_failure','UNKNOWN'));assert.throws(()=>f.journal.record('worker_observation','fulfilled',null,{workerStarts:Infinity,workerExits:0,workerObserverErrors:0}));assert.equal(readFileSync(f.file,'utf8'),before);});
});
test('actual worker and disposal observations use only fixed finite fields',()=>{
 withFixture(f=>{f.journal.record('worker_start','fulfilled',null,{workerKind:'delivery',workerOrdinal:1,workerThreadId:7});f.journal.record('worker_exit','fulfilled',null,{workerKind:'delivery',workerOrdinal:1,workerThreadId:7,workerExitCode:0});f.journal.record('worker_observation','fulfilled',null,{workerStarts:1,workerExits:1,workerObserverErrors:0});const original=Error('not serialized');f.journal.rejected('dispose_observation',original,{matchesPhysicalF:true,executionCount:0,transportCount:0,tailCount:0,returnedCount:0,observerErrors:0});const rows=chain(f.file);assert.equal(rows[2].workerExitCode,0);assert.equal(rows[4].matchesPhysicalF,true);assert.equal(rows[4].errorSlot,1);assert.ok(!readFileSync(f.file,'utf8').includes(original.message));});
});
