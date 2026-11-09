import {test as nodeTest} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {deviceOwnerFixture} from './helpers/device-owner-fixture.mjs';
import * as ownerModule from '../src/device-owner.mjs';
import {hash} from '../src/crypto.mjs';
import {deviceOsAccountId} from '../../continuity-device/src/os-guard.mjs';
const test=(name,action)=>nodeTest(name,{skip:process.platform==='win32',timeout:20000},action);
const scope={conversationId:'conversation',branchId:'branch'},binding={storeId:'original-canonical-store',profileId:'local-canonical-profile'};
async function setup(t){const f=await deviceOwnerFixture(t);let owner=f.open();t.after(()=>owner.close());await owner.sealOutgoing(scope,{eventId:'anchor-candidate',payload:{kind:'candidate-test-only',text:'NOT_CANONICAL_PUBLICATION'},parentRevision:0,eventType:'canonical-snapshot-v1'},{requestSource:'user'});await owner.pushOutgoing(scope,{eventId:'anchor-candidate'},{requestSource:'user'});return {f,get owner(){return owner;},async reopen(){await owner.close();owner=f.open();return owner;}};}
function request(owner,stageId='original-stage'){return {...binding,stageId,manifestHash:hash(['main-store-manifest-test-only',stageId]),baseHead:owner.getCanonicalStoreAnchor(binding).head};}
function current(owner,receipt){return ownerModule.assertOriginalStoreAnchor(owner,receipt,{testOnly:true});}
function lastDecision(options){const db=new DatabaseSync(path.join(options.stateDir,'authority.sqlite'),{readOnly:true});try{return JSON.parse(db.prepare('SELECT entry FROM authority_journal ORDER BY sequence DESC LIMIT 1').get().entry);}finally{db.close();}}

test('original owner anchors one exact candidate/store/head in its real journal and floor, never canonical publication',async t=>{
 const {f,owner}=await setup(t),incoming=await owner.captureCanonicalScopes([scope],{requestSource:'user'}),input=request(owner),before=f.writes;
 const anchor=owner.recordCanonicalStoreAnchor(incoming,input);assert.equal(anchor.status,'store-anchor-only');assert.equal(anchor.storeId,binding.storeId);assert.equal(anchor.head.sequence,input.baseHead.sequence+1);assert.equal(anchor.manifestHash,input.manifestHash);assert.ok(f.writes>before);current(owner,anchor);
 assert.throws(()=>owner.assertPublicationCurrent(anchor),/sync_publication_unavailable/);assert.throws(()=>ownerModule.assertOriginalIncoming(owner,anchor,{testOnly:true}),/device_owner_unavailable/);
 const writes=f.writes;assert.deepEqual(owner.recordCanonicalStoreAnchor(incoming,input),anchor);assert.equal(f.writes,writes);assert.equal(lastDecision(f.options).kind,'device_canonical_store_anchor');assert.equal(JSON.stringify(lastDecision(f.options)).includes('NOT_CANONICAL_PUBLICATION'),false);
});
test('only the mode-bound original private anchor receipt qualifies, independent of public prototypes',async t=>{
 const {owner}=await setup(t),incoming=await owner.captureCanonicalScopes([scope],{requestSource:'user'}),anchor=owner.recordCanonicalStoreAnchor(incoming,request(owner));
 assert.throws(()=>ownerModule.assertOriginalStoreAnchor(owner,anchor),/device_owner_unavailable/);for(const testOnly of ['yes',1,{},null])assert.throws(()=>ownerModule.assertOriginalStoreAnchor(owner,anchor,{testOnly}),/device_owner_unavailable/);
 for(const copy of [structuredClone(anchor),new Proxy(anchor,{})])assert.throws(()=>current(owner,copy),/device_owner_unavailable/);
 const proto=Object.getPrototypeOf(owner),prior=proto.assertStoreAnchorCurrent;try{proto.assertStoreAnchorCurrent=()=>{};assert.throws(()=>current(owner,structuredClone(anchor)),/device_owner_unavailable/);current(owner,anchor);}finally{if(prior===undefined)delete proto.assertStoreAnchorCurrent;else proto.assertStoreAnchorCurrent=prior;}
});
test('copied or stale incoming data and wrong base/store/profile never advance the original floor',async t=>{
 const {f,owner}=await setup(t),incoming=await owner.captureCanonicalScopes([scope],{requestSource:'user'}),input=request(owner),before=f.writes;
 assert.throws(()=>owner.recordCanonicalStoreAnchor(structuredClone(incoming),input));assert.equal(f.writes,before);
 assert.throws(()=>owner.recordCanonicalStoreAnchor(incoming,{...input,baseHead:{...input.baseHead,hash:'0'.repeat(64)}}));assert.equal(f.writes,before);
 owner.recordCanonicalStoreAnchor(incoming,input);const after=f.writes;
 for(const changed of [{storeId:'replacement-store'},{profileId:'replacement-profile'},{manifestHash:'f'.repeat(64)},{stageId:'new-stage'}])assert.throws(()=>owner.recordCanonicalStoreAnchor(incoming,{...input,...changed}));
 assert.equal(f.writes,after);await owner.sync(scope,{requestSource:'user'});const afterSync=f.writes;assert.throws(()=>owner.recordCanonicalStoreAnchor(incoming,input));assert.equal(f.writes,afterSync);
});
test('a later store head invalidates the older anchor and cannot be rewound by an old stage',async t=>{
 const {owner}=await setup(t),incoming=await owner.captureCanonicalScopes([scope],{requestSource:'user'}),firstInput=request(owner),first=owner.recordCanonicalStoreAnchor(incoming,firstInput),second=owner.recordCanonicalStoreAnchor(incoming,request(owner,'second-stage'));
 assert.equal(second.head.sequence,first.head.sequence+1);current(owner,second);assert.throws(()=>current(owner,first));assert.throws(()=>owner.recordCanonicalStoreAnchor(incoming,firstInput));
});
test('live control-row tampering cannot manufacture a different OS-pinned store state without an original journal decision',async t=>{
 const {f,owner}=await setup(t),incoming=await owner.captureCanonicalScopes([scope],{requestSource:'user'});owner.recordCanonicalStoreAnchor(incoming,request(owner));
 const db=new DatabaseSync(path.join(f.options.stateDir,'authority.sqlite'));
 try{const stored=JSON.parse(db.prepare('SELECT value FROM control WHERE key=?').get('canonical-store-head').value);stored.head.hash='f'.repeat(64);db.prepare('UPDATE control SET value=? WHERE key=?').run(JSON.stringify(stored),'canonical-store-head');}finally{db.close();}
 assert.throws(()=>owner.getCanonicalStoreAnchor(binding),/device_owner_unavailable/);
});
test('restart keeps the pinned store/head and only fresh original incoming can reconcile the same exact anchor',async t=>{
 const f=await setup(t),owner=f.owner,incoming=await owner.captureCanonicalScopes([scope],{requestSource:'user'}),input=request(owner),anchor=owner.recordCanonicalStoreAnchor(incoming,input),next=await f.reopen();
 assert.throws(()=>current(owner,anchor));assert.throws(()=>current(next,anchor));assert.deepEqual(next.getCanonicalStoreAnchor(binding).head,anchor.head);assert.throws(()=>next.getCanonicalStoreAnchor({...binding,storeId:'replacement'}));
 const fresh=await next.captureCanonicalScopes([scope],{requestSource:'user'}),before=f.f.writes,reconciled=next.recordCanonicalStoreAnchor(fresh,input);assert.equal(f.f.writes,before);assert.deepEqual(reconciled.head,anchor.head);current(next,reconciled);assert.notStrictEqual(reconciled,anchor);
});
for(const at of ['before','after'])test(`actual original OS floor ${at}-write uncertainty returns no anchor capability`,async t=>{
 const {f,owner}=await setup(t),incoming=await owner.captureCanonicalScopes([scope],{requestSource:'user'}),input=request(owner),account=deviceOsAccountId(f.f.identity,'a');let tripped=false;
 f.setWriteHook((id,stage)=>{if(id===account&&stage===at&&lastDecision(f.options).kind==='device_canonical_store_anchor'&&!tripped){tripped=true;throw new Error('synthetic anchor floor uncertainty');}});
 assert.throws(()=>owner.recordCanonicalStoreAnchor(incoming,input));assert.equal(tripped,true);assert.throws(()=>owner.getCanonicalStoreAnchor(binding));
});
test('original native callback close reentry invalidates anchor admission and keeps the one close promise',async t=>{
 const {f,owner}=await setup(t),incoming=await owner.captureCanonicalScopes([scope],{requestSource:'user'}),input=request(owner);let closing;
 f.setReadHook(()=>{if(!closing)closing=owner.close();});assert.throws(()=>owner.recordCanonicalStoreAnchor(incoming,input));assert.ok(closing);assert.strictEqual(owner.close(),closing);await closing;
});
