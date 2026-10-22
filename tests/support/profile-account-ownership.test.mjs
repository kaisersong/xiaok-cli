import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,lstatSync,mkdtempSync,readFileSync,realpathSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {createProfileAccountOwnership,acquireProfileAccountLease,assertProfileAccountWorkerReleased,teardownProfileAccount} from './profile-account-ownership.mjs';
const retained=[];
async function fixture(work){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'owned-account-unit-'))),stat=lstatSync(root);
 const refs={root,stat,workers:[],retained:false};let body;const cleanup=[];
 try{
  const ownership=createProfileAccountOwnership(root);
  const account=realpathSync(mkdtempSync(join(root,'account-')));
  await work({root,account,ownership,refs});
 }catch(error){body={error};}finally{
  if(refs.workers.some(record=>!record.exited)){refs.retained=true;retained.push(refs);cleanup.push(Error('account_unit_worker_exit_unknown'));}
  else if(existsSync(root))try{
   const now=lstatSync(root);assert.ok(now.isDirectory()&&!now.isSymbolicLink());assert.equal(realpathSync(root),root);
   for(const key of ['uid','dev','ino','birthtimeMs'])assert.equal(now[key],stat[key]);
   // Unit leases represent no actual callback. All native Workers above must
   // have emitted exit before this unit's exact directory may be removed.
   rmSync(root,{recursive:true,force:false});
  }catch(error){cleanup.push(error);retained.push(refs);}
 }
 const errors=[...(body?[body.error]:[]),...cleanup];
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new AggregateError(errors,'account_unit_body_and_cleanup_failed',{cause:errors[0]});
}
test('healthy account without a lease follows actual identity-checked teardown',()=>fixture(({root,ownership})=>{
 assertProfileAccountWorkerReleased(ownership);teardownProfileAccount(ownership);assert.equal(existsSync(root),false);
}));
test('actual held marker blocks worker admission and teardown; exact release is idempotent',()=>fixture(({root,account,ownership})=>{
 const lease=acquireProfileAccountLease(ownership,account,'1'.repeat(32));
 assert.ok(existsSync(lease.path));assert.throws(()=>assertProfileAccountWorkerReleased(ownership));
 assert.throws(()=>teardownProfileAccount(ownership));assert.ok(existsSync(root));
 lease.release();lease.release();assert.equal(existsSync(lease.path),false);
 assertProfileAccountWorkerReleased(ownership);teardownProfileAccount(ownership);assert.equal(existsSync(root),false);
}));
test('a missing active marker cannot be interpreted as a released callback',()=>fixture(({root,account,ownership})=>{
 const lease=acquireProfileAccountLease(ownership,account,'2'.repeat(32));unlinkSync(lease.path);
 assert.throws(()=>lease.release());assert.throws(()=>assertProfileAccountWorkerReleased(ownership));assert.throws(()=>teardownProfileAccount(ownership));assert.ok(existsSync(root));
}));
test('malformed marker blocks next-file admission and retains the account',()=>fixture(({root,ownership})=>{
 writeFileSync(join(root,'.owner-leases','incomplete.json'),'{',{flag:'wx',mode:0o600});
 assert.throws(()=>assertProfileAccountWorkerReleased(ownership));assert.throws(()=>teardownProfileAccount(ownership));assert.ok(existsSync(root));
}));
test('changed marker content cannot release the original lease',()=>fixture(({root,account,ownership})=>{
 const lease=acquireProfileAccountLease(ownership,account,'3'.repeat(32));writeFileSync(lease.path,'{}');
 assert.throws(()=>lease.release());assert.throws(()=>teardownProfileAccount(ownership));assert.ok(existsSync(root));
}));
test('changed immutable account identity receipt fails closed',()=>fixture(({root,ownership})=>{
 const file=join(root,'.owner-identity.json');const before=readFileSync(file,'utf8');writeFileSync(file,before+' ');
 assert.throws(()=>assertProfileAccountWorkerReleased(ownership));assert.throws(()=>teardownProfileAccount(ownership));assert.ok(existsSync(root));
}));
test('a real other thread lease retains the account without blocking this worker; native exit precedes removal',()=>fixture(async({root,account,ownership,refs})=>{
 const entry=new URL('./profile-account-ownership.mjs',import.meta.url).href;
 const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const m=await import(workerData.entry);const lease=m.acquireProfileAccountLease(workerData.ownership,workerData.account,'4'.repeat(32));parentPort.once('message',()=>{try{lease.release();parentPort.close();}catch(error){throw error;}});parentPort.postMessage('held');})().catch(error=>{throw error;});`,{eval:true,workerData:{entry,ownership,account}});
 const record={worker,exited:false,errors:[]};refs.workers.push(record);
 const exited=new Promise(resolve=>{worker.on('error',error=>record.errors.push(error));worker.once('exit',code=>{record.exited=true;record.code=code;resolve();});});
 const held=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',()=>reject(Error('account_unit_worker_exited_before_held')));});
 record.exitedPromise=exited;record.heldPromise=held;
 let body;const cleanup=[];
 try{assert.equal(await held,'held');assertProfileAccountWorkerReleased(ownership);assert.throws(()=>teardownProfileAccount(ownership));assert.ok(existsSync(root));}
 catch(error){body={error};}
 finally{try{worker.postMessage('release');}catch(error){cleanup.push(error);}try{await exited;}catch(error){cleanup.push(error);}}
 const errors=[...(body?[body.error]:[]),...record.errors,...cleanup];if(record.code!==0)errors.push(Error('account_unit_worker_nonzero_exit'));
 if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'account_unit_worker_failed',{cause:errors[0]});
 assertProfileAccountWorkerReleased(ownership);teardownProfileAccount(ownership);assert.equal(existsSync(root),false);
}));
