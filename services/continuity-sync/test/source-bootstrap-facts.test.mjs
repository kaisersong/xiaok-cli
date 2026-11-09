import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import {sourceOwnerFixture} from './helpers/source-owner-fixture.mjs';
import * as original from '../src/device-owner.mjs';
import {hash,sign} from '../src/crypto.mjs';
import {deviceOsAccountId} from '../../continuity-device/src/os-guard.mjs';
const scopes=[{conversationId:'conversation',branchId:'branch'}],binding={storeId:'original-source-store',profileId:'original-source-profile'},request={requestSource:'user'};
const current=(owner,receipt)=>original.assertOriginalSourceControls(owner,receipt,{testOnly:true});
test('original full-scope writer controls are immutable FACT only and invalidate on a new original job or close',async t=>{
 const f=await sourceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());const receipt=await owner.captureCanonicalSourceControls(scopes,request);current(owner,receipt);assert.equal(receipt.status,'verified-canonical-source-control-only');assert.equal(receipt.deviceId,'a');assert.equal(receipt.logicalProfileId,'logical');assert.equal(receipt.scopes.length,1);assert.equal(receipt.scopes[0].grant.ownerDeviceId,'a');assert.ok(Object.isFrozen(receipt));assert.ok(Object.isFrozen(receipt.scopes[0].grant));assert.throws(()=>owner.assertPublicationCurrent(receipt),/sync_publication_unavailable/);
 for(const fake of [structuredClone(receipt),new Proxy(receipt,{}),{}])assert.throws(()=>current(owner,fake));assert.throws(()=>current({...owner},receipt));assert.throws(()=>original.assertOriginalSourceControls(owner,receipt));
 await owner.sync(scopes[0],request);assert.throws(()=>current(owner,receipt));const next=await owner.captureCanonicalSourceControls(scopes,request);current(owner,next);await owner.close();assert.throws(()=>current(owner,next));
});
test('source controls reject reader-only or foreign-profile scopes and an incomplete selected set',async t=>{
 const f=await sourceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());f.f.addB();
 for(const variant of [{conversationId:'reader-only-source',ownerDeviceId:'b'},{conversationId:'foreign-profile-source',logicalProfileId:'another-profile'}]){const record=f.f.grant(['a','b']);Object.assign(record.body,variant);record.signature=sign(['xiaok/context-sync/scope/v1',record.body],f.f.root.privateKey);if(variant.logicalProfileId)assert.throws(()=>f.f.coordinator.registerScope({record,requestSource:'user'}),/profile_mapping_required/);else f.f.coordinator.registerScope({record,requestSource:'user'});await assert.rejects(()=>owner.captureCanonicalSourceControls([{conversationId:variant.conversationId,branchId:'branch'}],request));}
 await assert.rejects(()=>owner.captureCanonicalSourceControls([scopes[0],scopes[0]],request));await assert.rejects(()=>owner.captureCanonicalSourceControls([scopes[0],{conversationId:'missing',branchId:'branch'}],request));
});
test('first source anchor requires original current controls and remains only OS write-ahead FACT across policy and restart',async t=>{
 const f=await sourceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());const control=await owner.captureCanonicalSourceControls(scopes,request),base=owner.getCanonicalStoreAnchor(binding),input={...binding,stageId:'source-stage',manifestHash:hash(['original-source-manifest']),baseHead:base.head};assert.equal(base.head.sequence,0);
 for(const fake of [structuredClone(control),new Proxy(control,{}),{}])assert.throws(()=>owner.recordCanonicalSourceStoreAnchor(fake,input));const prepared=owner.recordCanonicalSourceStoreAnchor(control,input);assert.equal(prepared.purpose,'source-bootstrap');original.assertOriginalStoreAnchor(owner,prepared,{testOnly:true});assert.deepEqual(owner.recordCanonicalSourceStoreAnchor(control,input),prepared);assert.throws(()=>owner.assertPublicationCurrent(prepared),/sync_publication_unavailable/);
 assert.throws(()=>owner.recordCanonicalSourceStoreAnchor(control,{...input,manifestHash:'f'.repeat(64)}));assert.throws(()=>owner.getCanonicalStoreAnchor({...binding,storeId:'another-store'}));
 const policy=owner.recordCanonicalStorePolicy({...binding,operationId:'source-policy',baseHead:prepared.head,policyHash:'a'.repeat(64),publicationHash:'b'.repeat(64),stickyFacts:[]});assert.equal(policy.head.sequence,2);assert.throws(()=>owner.recordCanonicalSourceStoreAnchor(control,input));await owner.close();
 const reopened=f.open();t.after(()=>reopened.close());const state=reopened.getCanonicalStoreAnchor(binding);assert.deepEqual(state.head,policy.head);assert.equal(state.policyHash,'a'.repeat(64));assert.throws(()=>current(reopened,control));assert.throws(()=>reopened.assertPublicationCurrent(state),/sync_publication_unavailable/);
});
for(const stage of ['before','after'])test('first source anchor rejects OS floor uncertainty '+stage,async t=>{
 const f=await sourceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());const control=await owner.captureCanonicalSourceControls(scopes,request),base=owner.getCanonicalStoreAnchor(binding),account=deviceOsAccountId(f.f.identity,'a');f.setWriteHook((id,at)=>{if(id===account&&at===stage)throw new Error('synthetic_source_floor_uncertainty');});assert.throws(()=>owner.recordCanonicalSourceStoreAnchor(control,{...binding,stageId:'uncertain-source-stage',manifestHash:'a'.repeat(64),baseHead:base.head}));assert.throws(()=>current(owner,control));assert.throws(()=>owner.getCanonicalStoreAnchor(binding));f.setWriteHook(undefined);
});

test('captures all selected writer scopes and refuses a control-floor change during the final original native read',async t=>{
 const f=await sourceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());const second=f.f.grant();second.body.conversationId='second-source';second.signature=sign(['xiaok/context-sync/scope/v1',second.body],f.f.root.privateKey);f.f.coordinator.registerScope({record:second,requestSource:'user'});
 const control=await owner.captureCanonicalSourceControls([...scopes,{conversationId:'second-source',branchId:'branch'}],request);assert.equal(control.scopes.length,2);current(owner,control);
 const db=new DatabaseSync(path.join(f.options.stateDir,'authority.sqlite')),before=db.prepare('SELECT value FROM control WHERE key=?').get('verified-control-floor').value,changed=JSON.parse(before);changed.membershipHash='f'.repeat(64);let reads=0,tripped=false;
 try{f.setReadHook(()=>{if(++reads===3){tripped=true;db.prepare('UPDATE control SET value=? WHERE key=?').run(JSON.stringify(changed),'verified-control-floor');}});assert.throws(()=>current(owner,control),/device_owner_unavailable/);assert.equal(tripped,true);}finally{f.setReadHook(undefined);db.prepare('UPDATE control SET value=? WHERE key=?').run(before,'verified-control-floor');db.close();}
});
