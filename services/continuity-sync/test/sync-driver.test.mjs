import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import sodium from 'libsodium-wrappers';
import { coordinatorFixture } from './helpers/coordinator-fixture.mjs';
import { base64,hash } from '../src/crypto.mjs';
await sodium.ready;
function clientFor(f,{alter=(_path,value)=>value,before=()=>{}}={}){
 return {async getHead(){const nonce=base64(sodium.randombytes_buf(32));return {nonce,response:f.coordinator.handle(f.request('a','/v1/head',{nonce}))};},async call(route,body,options){before(route,body);return alter(route,f.coordinator.handle(f.request('a',route,body,options)));}};
}
const scope={conversationId:'conversation',branchId:'branch'};
test('network driver scans independent filtered pages to one exact fresh head',async t=>{
 const f=coordinatorFixture(t);let previous='0'.repeat(64);for(let i=1;i<=5;i++){const envelope=f.event('a',i,previous);f.send('a','/v1/events/push',{envelope});previous=hash(envelope);}
 const {fetchVerifiedScope}=await import('../src/sync-driver.mjs');const result=await fetchVerifiedScope({client:clientFor(f),identity:f.identity,deviceId:'a',scope,pageSize:2});assert.equal(result.status,'verified-control-only');assert.equal(result.events.length,5);assert.deepEqual(result.head,f.journal.head());
});
test('network driver rejects false EOF, nonprogress, wrong pinned head and explicit resource overflow',async t=>{
 const f=coordinatorFixture(t);f.send('a','/v1/events/push',{envelope:f.event()});const {fetchVerifiedScope}=await import('../src/sync-driver.mjs');
 for(const alter of [(route,r)=>route==='/v1/journal/pull'?{...r,body:{...r.body,result:{...r.body.result,entries:[]}}}:r,(route,r)=>route==='/v1/events/pull'?{...r,body:{...r.body,result:{...r.body.result,scannedUntil:0}}}:r,(route,r)=>route==='/v1/control/pull'?{...r,body:{...r.body,result:{...r.body.result,targetHead:{...r.body.result.targetHead,hash:'f'.repeat(64)}}}}:r])await assert.rejects(()=>fetchVerifiedScope({client:clientFor(f,{alter}),identity:f.identity,deviceId:'a',scope,pageSize:1}));
 await assert.rejects(()=>fetchVerifiedScope({client:clientFor(f),identity:f.identity,deviceId:'a',scope,maxRecords:1}),/sync_limit/);
});
test('only oversized read pages are retried with a smaller limit and no candidate escapes head drift',async t=>{
 const f=coordinatorFixture(t),{fetchVerifiedScope}=await import('../src/sync-driver.mjs');let retries=0;
 const before=(route,body)=>{if(body.limit>1){retries++;throw new Error('response_too_large');}};
 assert.equal((await fetchVerifiedScope({client:clientFor(f,{before}),identity:f.identity,deviceId:'a',scope,pageSize:4})).status,'verified-control-only');assert.ok(retries>0);
 const client=clientFor(f);let heads=0;const getHead=client.getHead;client.getHead=async()=>{if(++heads===2)f.send('a','/v1/events/push',{envelope:f.event()});return getHead();};await assert.rejects(()=>fetchVerifiedScope({client,identity:f.identity,deviceId:'a',scope}),/head_changed/);
});
