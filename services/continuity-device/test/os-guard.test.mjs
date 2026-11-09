import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import path from 'node:path';
import {coordinatorFixture} from '../../continuity-sync/test/helpers/coordinator-fixture.mjs';
import {canonical,hash} from '../../continuity-sync/src/crypto.mjs';
import {claimDeviceNamespace} from '../src/device-lock.mjs';
import {createTestCredentialBackend} from '../src/os-backend.mjs';
import {deviceOsAccountId,openOsOutboxGuard,openTestOsOutboxGuard,originalOsOutboxGuard} from '../src/os-guard.mjs';
function fixture(t){
 const f=coordinatorFixture(t),deviceId='a',lease=claimDeviceNamespace({identity:f.identity,deviceId,testRegistryDir:path.join(path.dirname(f.opts.stateDir),'guard-namespace')});t.after(async()=>{lease.close();await lease.drainClosed();});
 const head={identityHash:hash(['own-local-journal']),sequence:0,hash:'1'.repeat(64)},record={schemaVersion:1,identityHash:hash(f.identity),deviceId,cryptoHead:head};
 let value=Buffer.from(canonical(record)),writes=0,onRead=()=>{},onWrite=()=>{};
 const entry={getSecret(){onRead();return value===null?null:[...value];},setSecret(bytes){writes++;value=Buffer.from(bytes);onWrite();}};
 const accountId=deviceOsAccountId(f.identity,deviceId),backend=createTestCredentialBackend(entry,{accountId});
 const options={lease,backend,identity:f.identity,deviceId};
 return {f,lease,entry,options,record,head,get value(){return value;},set value(v){value=v;},get writes(){return writes;},readHook(fn){onRead=fn;},writeHook(fn){onWrite=fn;},open:()=>openTestOsOutboxGuard(options)};
}
test('test lease/backends never qualify a production guard, clones/proxies/fake kinds never qualify either',t=>{
 const f=fixture(t),g=f.open();assert.equal(g.kind,'test-only');assert.throws(()=>originalOsOutboxGuard(g),/os_guard_unavailable/);
 for(const options of [f.options,{...f.options,lease:{kind:'device-namespace-lease'}},{...f.options,backend:{kind:'os-credential-backend',read:()=>f.value}},{...f.options,backend:new Proxy(f.options.backend,{})}])assert.throws(()=>openOsOutboxGuard(options),/os_guard_unavailable/);
 assert.equal(f.writes,0);
});
test('fixed OS account is checked independently from matching canonical record bytes',t=>{
 const f=fixture(t),wrong=createTestCredentialBackend(f.entry,{accountId:'0'.repeat(64)});
 assert.throws(()=>openTestOsOutboxGuard({...f.options,backend:wrong}),/os_guard_unavailable/);assert.equal(f.writes,0);
});
test('missing/malformed/foreign OS bytes are never initialized or repaired',t=>{
 const f=fixture(t);
 for(const value of [null,Buffer.from('{bad'),Buffer.from(JSON.stringify({...f.record,deviceId:'other'})),Buffer.from(canonical({...f.record,identityHash:'0'.repeat(64)})),Buffer.from(canonical({...f.record,cryptoHead:{...f.head,sequence:-1}}))]){
  f.value=value;assert.throws(f.open,/os_guard_unavailable/);assert.equal(f.writes,0);
 }
});
test('exact original readback advances once and returned metadata cannot mutate the private floor',t=>{
 const f=fixture(t),g=f.open(),next={...f.head,sequence:1,hash:'2'.repeat(64)},copy=g.read();copy.hash='9'.repeat(64);assert.deepEqual(g.read(),f.head);
 g.advance(f.head,next);assert.deepEqual(g.read(),next);assert.equal(f.writes,1);assert.deepEqual(JSON.parse(f.value).cryptoHead,next);
});
for(const change of ['before','skip','local-identity','external-bytes','missing','write-error','closed-on-read','closed-on-write'])test(`guard ${change} fails permanently without publishing another head`,t=>{
 const f=fixture(t),g=f.open(),original=Buffer.from(f.value),next={...f.head,sequence:1,hash:'2'.repeat(64)};
 if(change==='external-bytes')f.value=Buffer.from(canonical({...f.record,cryptoHead:next}));if(change==='missing')f.value=null;
 if(change==='write-error')f.writeHook(()=>{throw new Error('SECRET_CANARY');});
 if(change==='closed-on-read')f.readHook(()=>f.lease.close());if(change==='closed-on-write')f.writeHook(()=>f.lease.close());
 const before=change==='before'?{...f.head,hash:'8'.repeat(64)}:f.head;
 const proposed=change==='skip'?{...next,sequence:2}:change==='local-identity'?{...next,identityHash:'7'.repeat(64)}:next;
 assert.throws(()=>g.advance(before,proposed),error=>error.message==='os_guard_unavailable');
 f.value=original;f.readHook(()=>{});f.writeHook(()=>{});assert.throws(()=>g.read(),/os_guard_unavailable/);assert.throws(()=>g.advance(f.head,next),/os_guard_unavailable/);
});
test('another guard cannot use an old observation after the first original guard advances',t=>{
 const f=fixture(t),a=f.open(),b=f.open(),next={...f.head,sequence:1,hash:'2'.repeat(64)};a.advance(f.head,next);assert.throws(()=>b.read(),/os_guard_unavailable/);assert.throws(()=>b.advance(f.head,next),/os_guard_unavailable/);assert.equal(f.writes,1);
});
test('a changed public backend method cannot replace the captured original native channel',t=>{
 const f=fixture(t),prototype=Object.getPrototypeOf(f.options.backend);t.mock.method(prototype,'read',()=>{throw new Error('replaced-public-read');});t.mock.method(prototype,'compareReplace',()=>{throw new Error('replaced-public-write');});
 const g=f.open(),next={...f.head,sequence:1,hash:'2'.repeat(64)};g.advance(f.head,next);assert.deepEqual(g.read(),next);assert.equal(f.writes,1);
});
