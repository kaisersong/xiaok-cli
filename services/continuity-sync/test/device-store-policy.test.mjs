import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import sodium from 'libsodium-wrappers';
import {deviceOwnerFixture} from './helpers/device-owner-fixture.mjs';
import * as ownerModule from '../src/device-owner.mjs';
import {hash} from '../src/crypto.mjs';
import {deviceOsAccountId} from '../../continuity-device/src/os-guard.mjs';
const test=(name,action)=>nodeTest(name,{skip:process.platform==='win32',timeout:20000},action);
const scope={conversationId:'conversation',branchId:'branch'},binding={storeId:'policy-canonical-store',profileId:'policy-canonical-profile'};
async function setup(t){const f=await deviceOwnerFixture(t);let owner=f.open();t.after(()=>owner.close());await owner.sealOutgoing(scope,{eventId:'policy-candidate',payload:{kind:'candidate-test-only',text:'NOT_A_CANONICAL_COMMIT'},parentRevision:0,eventType:'canonical-snapshot-v1'},{requestSource:'user'});await owner.pushOutgoing(scope,{eventId:'policy-candidate'},{requestSource:'user'});const incoming=await owner.captureCanonicalScopes([scope],{requestSource:'user'}),anchorInput={...binding,stageId:'same-purpose-id',manifestHash:hash('synthetic-manifest'),baseHead:owner.getCanonicalStoreAnchor(binding).head},anchor=owner.recordCanonicalStoreAnchor(incoming,anchorInput);return {f,incoming,anchor,anchorInput,get owner(){return owner;},async reopen(){await owner.close();owner=f.open();return owner;}};}
function request(owner,operationId='same-purpose-id',stickyFacts=[]){return {...binding,operationId,baseHead:owner.getCanonicalStoreAnchor(binding).head,policyHash:hash(['policy-test-only',operationId]),publicationHash:hash(['publication-intent-not-commit',operationId]),stickyFacts};}
function current(owner,receipt){return ownerModule.assertOriginalStoreAnchor(owner,receipt,{testOnly:true});}
function lastDecision(options){const db=new DatabaseSync(path.join(options.stateDir,'authority.sqlite'),{readOnly:true});try{return JSON.parse(db.prepare('SELECT entry FROM authority_journal ORDER BY sequence DESC LIMIT 1').get().entry);}finally{db.close();}}

test('an unbound original owner cannot create its first store binding using offline policy facts',async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());assert.equal(typeof owner.recordCanonicalStorePolicy,'function');const before=f.writes;
 assert.throws(()=>owner.recordCanonicalStorePolicy(request(owner)));assert.equal(f.writes,before);
});
test('fresh state facts are private mode/generation-bound and advancing policy invalidates the old state and anchor',async t=>{
 const f=await setup(t),owner=f.owner,before=owner.getCanonicalStoreAnchor(binding);current(owner,before);
 const result=owner.recordCanonicalStorePolicy(request(owner));assert.equal(result.status,'store-anchor-only');assert.equal(result.purpose,'policy-prepared');current(owner,result);assert.throws(()=>current(owner,before));assert.throws(()=>current(owner,f.anchor));
 const state=owner.getCanonicalStoreAnchor(binding);assert.equal(state.policyHash,result.policyHash);assert.equal(state.publicationHash,result.publicationHash);current(owner,state);
 for(const receipt of [result,state]){assert.throws(()=>ownerModule.assertOriginalStoreAnchor(owner,receipt));assert.throws(()=>current(owner,structuredClone(receipt)));assert.throws(()=>current(owner,new Proxy(receipt,{})));assert.throws(()=>owner.assertPublicationCurrent(receipt),/sync_publication_unavailable/);}
 await owner.sync(scope,{requestSource:'user'});assert.throws(()=>current(owner,result));assert.throws(()=>current(owner,state));
});
test('reopened genuine owner without incoming/TLS can pin local revocation with zero HTTP and AEAD, never a COMMIT proof',async t=>{
 const f=await setup(t),owner=await f.reopen();let http=0,encryption=0;t.mock.method(https,'request',()=>{http++;throw new Error('synthetic offline transport');});t.mock.method(sodium,'crypto_aead_xchacha20poly1305_ietf_encrypt',()=>{encryption++;throw new Error('must_not_encrypt');});
 const input=request(owner,'offline-policy',[{kind:'grant',id:'original-grant',revision:3}]),fact=owner.recordCanonicalStorePolicy(input);assert.equal(http,0);assert.equal(encryption,0);assert.equal(fact.policyHash,input.policyHash);current(owner,fact);assert.throws(()=>owner.assertPublicationCurrent(fact),/sync_publication_unavailable/);
 const next=await f.reopen(),state=next.getCanonicalStoreAnchor(binding);assert.deepEqual(state.head,fact.head);assert.equal(state.policyHash,fact.policyHash);current(next,state);assert.throws(()=>current(next,fact));
});
test('policy operation namespace is distinct from candidate stage and exact current replay performs no native writes',async t=>{
 const f=await setup(t),owner=f.owner,input=request(owner),fact=owner.recordCanonicalStorePolicy(input),writes=f.f.writes;
 assert.deepEqual(owner.recordCanonicalStorePolicy(input),fact);assert.equal(f.f.writes,writes);assert.equal(lastDecision(f.f.options).kind,'device_canonical_store_policy');
 for(const patch of [{policyHash:'a'.repeat(64)},{publicationHash:'b'.repeat(64)},{storeId:'replacement'},{profileId:'replacement'}])assert.throws(()=>owner.recordCanonicalStorePolicy({...input,...patch}));
 assert.equal(f.f.writes,writes);assert.throws(()=>owner.recordCanonicalStoreAnchor(f.incoming,f.anchorInput));
});
test('typed sticky facts cannot be reset, lowered, duplicated, or replaced by arbitrary SQL/text',async t=>{
 const f=await setup(t),owner=f.owner;
 owner.recordCanonicalStorePolicy(request(owner,'first-policy',[{kind:'grant',id:'grant',revision:4},{kind:'scope',id:'conversation',revision:2}]));
 const base=request(owner,'next-policy'),before=f.f.writes;
 for(const stickyFacts of [[{kind:'grant',id:'grant',revision:3}],[{kind:'grant',id:'grant',revision:4,revoked:false}],[{kind:'sql',id:'DROP TABLE',revision:5}],[{kind:'grant',id:'grant',revision:4,text:'PRIVATE'}],[{kind:'grant',id:'grant',revision:4},{kind:'grant',id:'grant',revision:4}]])assert.throws(()=>owner.recordCanonicalStorePolicy({...base,stickyFacts}));
 for(const patch of [{policyHash:null},{publicationHash:null},{reset:true}])assert.throws(()=>owner.recordCanonicalStorePolicy({...base,...patch}));assert.equal(f.f.writes,before);
 const prior=owner.getCanonicalStoreAnchor(binding),empty=owner.recordCanonicalStorePolicy(base);assert.equal(empty.stickyHash,prior.stickyHash);current(owner,empty);
});
test('a stale policy head or a new store cannot replace an already pinned store, even after restart',async t=>{
 const f=await setup(t),owner=f.owner,input=request(owner,'first-policy'),fact=owner.recordCanonicalStorePolicy(input);owner.recordCanonicalStorePolicy(request(owner,'next-policy'));
 assert.throws(()=>owner.recordCanonicalStorePolicy(input));assert.throws(()=>current(owner,fact));const next=await f.reopen();assert.throws(()=>next.getCanonicalStoreAnchor({...binding,storeId:'new-store'}));assert.throws(()=>next.recordCanonicalStorePolicy({...input,storeId:'new-store'}));
});
for(const at of ['before','after'])test(`actual policy OS floor ${at}-write uncertainty returns no private fact`,async t=>{
 const f=await setup(t),owner=f.owner,input=request(owner),account=deviceOsAccountId(f.f.f.identity,'a');let tripped=false;
 f.f.setWriteHook((id,stage)=>{if(id===account&&stage===at&&lastDecision(f.f.options).kind==='device_canonical_store_policy'&&!tripped){tripped=true;throw new Error('synthetic policy floor uncertainty');}});
 assert.throws(()=>owner.recordCanonicalStorePolicy(input));assert.equal(tripped,true);assert.throws(()=>owner.getCanonicalStoreAnchor(binding));
});
test('native close reentry cannot return policy/state facts or admit a replacement',async t=>{
 const f=await setup(t),owner=f.owner,input=request(owner);let closing;
 f.f.setReadHook(()=>{if(!closing)closing=owner.close();});assert.throws(()=>owner.recordCanonicalStorePolicy(input));assert.strictEqual(owner.close(),closing);await closing;assert.throws(()=>owner.getCanonicalStoreAnchor(binding));
});
