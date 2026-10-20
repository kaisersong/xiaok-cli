import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import https from 'node:https';
import pathModule from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {deviceOwnerFixture} from './helpers/device-owner-fixture.mjs';
import {canonical} from '../src/crypto.mjs';
import {deviceOsAccountId} from '../../continuity-device/src/os-guard.mjs';
const scope={conversationId:'conversation',branchId:'branch'},request={eventId:'final-gate-original-event',payload:{text:'ORIGINAL_DEVICE_FINAL_GATE'},parentRevision:0,eventType:'message'};
const invalidate=f=>{const account=deviceOsAccountId(f.f.identity,'a'),record=JSON.parse(f.accounts.get(account));record.cryptoHead.hash='f'.repeat(64);f.accounts.set(account,Buffer.from(canonical(record)));};
for(const path of ['/v1/events/push','/v1/key-use/consume'])test(`original device floor must remain current after the last actual ${path} challenge await`,{timeout:20000},async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());if(path==='/v1/events/push')await owner.sealOutgoing(scope,request,{requestSource:'user'});
 let sent=0,armed=false,reached,release;const ready=new Promise(resolve=>reached=resolve);
 f.host.server.prependListener('request',(req,res)=>{
  if(req.url===path)sent++;
  if(req.url!=='/v1/challenge')return;
  // The original owner durably prepares intent/encrypting before this last
  // challenge. Earlier full-chain catchup challenges must remain untouched.
  const db=new DatabaseSync(pathModule.join(f.options.stateDir,'authority.sqlite'),{readOnly:true});let kind;try{kind=JSON.parse(db.prepare('SELECT entry FROM authority_journal ORDER BY sequence DESC LIMIT 1').get().entry).kind;}finally{db.close();}
  if(armed||kind!==(path==='/v1/events/push'?'device_outgoing_push_intent':'crypto_mark_encrypting'))return;armed=true;const end=res.end;res.end=function(...args){release=()=>end.apply(res,args);reached();return res;};
 });
 const pending=path==='/v1/events/push'?owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'}):owner.sealOutgoing(scope,request,{requestSource:'user'});pending.catch(()=>{});
 await ready;invalidate(f);release();await assert.rejects(pending);assert.equal(sent,0,'stale original device must not send the signed request body');
});
test('native HTTPS request construction cannot send after it invalidates the original device floor',{timeout:20000},async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());await owner.sealOutgoing(scope,request,{requestSource:'user'});let sent=0,tripped=false;
 f.host.server.prependListener('request',req=>{if(req.url==='/v1/events/push')sent++;});
 const construct=https.request;t.mock.method(https,'request',function(url,...args){const req=construct.call(this,url,...args);if(url.pathname==='/v1/events/push'){tripped=true;invalidate(f);}return req;});
 await assert.rejects(owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'}));assert.equal(tripped,true);assert.equal(sent,0);
});
for(const name of ['transport','device-owner'])test(`fixed modules support ${name} as the first independent ESM import`,()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../src/'+name+'.mjs',import.meta.url).href)});`],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
});
test('the final owner native-read gate can reenter close without sending or leaking its constructed request',{timeout:20000},async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());await owner.sealOutgoing(scope,request,{requestSource:'user'});let sent=0,constructed,closed=false,closing;
 f.host.server.prependListener('request',req=>{if(req.url==='/v1/events/push')sent++;});
 const construct=https.request;t.mock.method(https,'request',function(url,...args){const req=construct.call(this,url,...args);if(url.pathname==='/v1/events/push'){constructed=req;req.once('close',()=>closed=true);f.setReadHook(()=>{f.setReadHook(undefined);closing=owner.close();});}return req;});
 await assert.rejects(owner.pushOutgoing(scope,{eventId:request.eventId},{requestSource:'user'}));await closing;assert.ok(constructed);assert.equal(constructed.destroyed,true);assert.equal(closed,true);assert.equal(sent,0);
});
test('copied, proxied and non-pending owners cannot install a caller guard before HTTPS native work',{timeout:20000},async t=>{
 const f=await deviceOwnerFixture(t),owner=f.open();t.after(()=>owner.close());const {CoordinatorClient}=await import('../src/transport.mjs'),{claimOriginalDeviceTransport}=await import('../src/device-owner.mjs');let agents=0;
 t.mock.method(https,'Agent',()=>{agents++;throw new Error('native should not be reached');});
 const options={baseUrl:f.host.url,identity:f.f.identity,deviceId:'a',signingKey:f.f.devices.a.sign.privateKey,ca:f.options.ca};
 for(const fake of [{...owner},new Proxy(owner,{}),{kind:'os-device-owner',assertCurrent(){return true;}},owner])assert.throws(()=>new CoordinatorClient({...options,owner:fake}),/verified_device_owner_required/);
 assert.throws(()=>claimOriginalDeviceTransport(owner,{},options),/verified_device_owner_required/);assert.equal(agents,0);
});
