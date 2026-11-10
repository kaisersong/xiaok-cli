import {tls} from './helpers/tls-fixture.mjs';
import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import sodium from 'libsodium-wrappers';
import { coordinatorFixture as fixture } from './helpers/coordinator-fixture.mjs';
import { startCoordinatorServer } from '../src/server.mjs';
import { CoordinatorClient } from '../src/transport.mjs';
import { base64,canonical,hash,hashBytes,sign } from '../src/crypto.mjs';
import { verifyServerResponse } from '../src/identity.mjs';
await sodium.ready;
test('content deletion travels through real TLS and complete catch-up without duplicate retry or nonowner writes',async t=>{
 const f=fixture(t);f.addB();const credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const clients=Object.fromEntries(['a','b'].map(deviceId=>[deviceId,new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId,signingKey:f.devices[deviceId].sign.privateKey,ca:credentials.cert})]));t.after(()=>Object.values(clients).forEach(c=>c.close()));
 const body={schemaVersion:1,rootKeyId:f.identity.rootKeyId,syncGroupId:'group',coordinatorId:'coordinator',operationId:'original-content-operation',conversationId:'conversation',branchId:'branch',logicalProfileId:'logical',ownerDeviceId:'a',scopeRevision:2,sourceSequence:1,previousHash:'0'.repeat(64),targets:[{kind:'message',id:'message'}]},record={body,signature:sign(['xiaok/context-sync/content-revocation/v1',body],f.devices.a.sign.privateKey)},route='/v1/content-revocations/append';
 const first=await clients.a.call(route,{record},{expectedHead:f.journal.head(),requestSource:'user'}),head=f.journal.head();
 assert.deepEqual((await clients.a.call(route,{record},{expectedHead:head,requestSource:'user'})).body.result,first.body.result);assert.deepEqual(f.journal.head(),head);
 await assert.rejects(()=>clients.b.call(route,{record},{expectedHead:head,requestSource:'user'}));
 await assert.rejects(()=>clients.a.call(route,{record},{expectedHead:head,requestSource:'agent'}));assert.deepEqual(f.journal.head(),head);
 const {fetchVerifiedScope}=await import('../src/sync-driver.mjs'),result=await fetchVerifiedScope({client:clients.b,identity:f.identity,deviceId:'b',scope:{conversationId:'conversation',branchId:'branch'},pageSize:1});
 assert.equal(result.status,'verified-control-only');assert.deepEqual(result.revocations.at(-1).body.targets,body.targets);assert.equal(result.revocations.at(-1).body.ownerRecordHash,hash(body));
});

function raw(url,ca,{method='POST',headers={},body='{}'}={}){return new Promise((resolve,reject)=>{const req=https.request(url,{method,ca,servername:'localhost',agent:false,headers:{'content-type':'application/json',...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);});}
test('real TLS clients authenticate independently and invalid CA/Host/Origin/body never reaches control mutations',async t=>{
 const f=fixture(t);f.addB();const credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const a=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});
 const b=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'b',signingKey:f.devices.b.sign.privateKey,ca:credentials.cert});t.after(()=>{a.close();b.close();});
 const nonce=base64(sodium.randombytes_buf(32)),response=await a.call('/v1/head',{nonce},{expectedHead:f.journal.head(),requestSource:'user'});assert.equal(response.body.result.nonce,nonce);
 assert.equal(response.body.requestBodyHash,hash({nonce}));
 const wrong={...response,body:{...response.body,requestBodyHash:hash({nonce:'different'})}};wrong.signature=sign(['xiaok/context-sync/response/v1',wrong.body],f.online.privateKey);
 assert.throws(()=>verifyServerResponse({response:wrong,identity:f.identity,coordinatorPublicKey:f.online.publicKey,path:'/v1/head',requestId:response.body.requestId,deviceId:'a',requestBodyHash:hash({nonce})}),/invalid_response/);
 const mutable={nonce:base64(sodium.randombytes_buf(32))},originalNonce=mutable.nonce,pending=a.call('/v1/head',mutable,{expectedHead:f.journal.head(),requestSource:'user'});mutable.nonce='mutated';assert.equal((await pending).body.result.nonce,originalNonce);
 const envelope=f.event('b');const accepted=await b.call('/v1/events/push',{envelope},{expectedHead:f.journal.head(),requestSource:'user'});assert.equal(accepted.body.result.accepted.originSequence,1);
 const before=f.journal.head();
 assert.equal((await raw(host.url+'/v1/challenge',credentials.cert,{headers:{host:'attacker.invalid'},body:canonical({deviceId:'a'})})).status,421);
 assert.equal((await raw(host.url+'/v1/challenge',credentials.cert,{headers:{origin:'https://attacker.invalid'},body:canonical({deviceId:'a'})})).status,403);
 assert.equal((await raw(host.url+'/v1/challenge',credentials.cert,{body:'{"deviceId":"a","deviceId":"b"}'})).status,400);
 assert.equal((await raw(host.url+'/v1/challenge',credentials.cert,{method:'GET'})).status,405);assert.deepEqual(f.journal.head(),before);
 const untrusted=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey});t.after(()=>untrusted.close());await assert.rejects(()=>untrusted.call('/v1/head',{nonce},{expectedHead:before,requestSource:'user'}));
});
test('deployable CLI restarts the same authority over TLS and refuses a missing witness',async t=>{
 const f=fixture(t),credentials=tls(f,t),dir=path.dirname(f.opts.stateDir),secret=path.join(dir,'online-key'),config=path.join(dir,'server.json');
 fs.chmodSync(credentials.files.cert,0o600);fs.writeFileSync(secret,base64(f.online.privateKey),{mode:0o600});
 fs.writeFileSync(config,canonical({schemaVersion:1,identity:f.identity,stateDir:f.opts.stateDir,witnessDir:f.opts.witnessDir,signingKeyFile:secret,tlsKeyFile:credentials.files.key,tlsCertFile:credentials.files.cert,host:'127.0.0.1',port:0,publicOrigin:null}),{mode:0o600});f.close();fs.rmSync(f.opts.stateDir,{recursive:true});fs.rmSync(f.opts.witnessDir,{recursive:true});const registry=path.join(dir,'provisioning');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.mjs',import.meta.url)),'--config',config,'--initialize','--test-provisioning-dir',registry],{stdio:['ignore','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}),exited=once(child,'exit');let exitSeen=false;exited.then(()=>{exitSeen=true;});
 fs.writeFileSync(path.join(dir,'server-process.json'),JSON.stringify({pid:child.pid}));t.after(async()=>{if(!exitSeen)child.kill('SIGTERM');await exited;});
 const startup=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('startup_timeout')),5000);child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.slice(0,text.indexOf('\n'))));}});child.once('exit',()=>{clearTimeout(timer);if(!text.includes('\n'))reject(new Error('startup_failed'));});});
 const client=new CoordinatorClient({baseUrl:startup.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});t.after(()=>client.close());await client.control('/v1/membership',{record:f.record,manifest:f.manifest(f.record)});assert.equal((await client.getHead()).response.body.result.membershipHead.epoch,1);
 client.close();child.kill('SIGTERM');const [code]=await exited;assert.equal(code,0);t.diagnostic(`service process ${child.pid} reaped`);
 const restart=spawnSync(process.execPath,[fileURLToPath(new URL('../src/server.mjs',import.meta.url)),'--config',config,'--test-provisioning-dir',registry],{encoding:'utf8',timeout:750});assert.match(restart.stdout,/listening/);assert.equal(restart.status,0);t.diagnostic(`restarted service process ${restart.pid} reaped`);
 fs.unlinkSync(path.join(f.opts.witnessDir,'heads.sqlite'));
 const refused=spawnSync(process.execPath,[fileURLToPath(new URL('../src/server.mjs',import.meta.url)),'--config',config,'--test-provisioning-dir',registry],{encoding:'utf8',timeout:5000,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});assert.equal(refused.status,1);assert.equal(refused.stdout,'');assert.ok(!refused.stderr.includes(base64(f.online.privateKey)));t.diagnostic(`unavailable service process ${refused.pid} reaped`);
});
test('HTTPS admission enforces size, concurrency and clean shutdown',async t=>{
 const f=fixture(t),credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials,maxBodyBytes:1024,maxConcurrent:1});t.after(()=>host.close());
 const response=await raw(host.url+'/v1/challenge',credentials.cert,{body:'x'.repeat(2048),headers:{'content-length':'2048'}});assert.equal(response.status,413);assert.ok(!response.text.includes('x'.repeat(100)));
 const seen=once(host.server,'request'),held=https.request(host.url+'/v1/challenge',{method:'POST',ca:credentials.cert,agent:false,headers:{'content-type':'application/json','content-length':'100'}},res=>res.resume());held.on('error',()=>{});held.flushHeaders();held.write('{');await seen;
 assert.equal((await raw(host.url+'/v1/challenge',credentials.cert,{body:canonical({deviceId:'a'})})).status,429);
 const closed=new Promise(resolve=>held.once('close',resolve));held.destroy();await closed;
 await host.close();await assert.rejects(()=>raw(host.url+'/v1/challenge',credentials.cert));
});

test('CLI cannot reinitialize one coordinator identity in fresh directories',async t=>{
 const f=fixture(t),credentials=tls(f,t),dir=path.dirname(f.opts.stateDir),secret=path.join(dir,'online-key'),registry=path.join(dir,'provisioning');
 fs.chmodSync(credentials.files.cert,0o600);fs.writeFileSync(secret,base64(f.online.privateKey),{mode:0o600});
 const configFor=name=>{const config=path.join(dir,name+'.json');fs.writeFileSync(config,canonical({schemaVersion:1,identity:f.identity,stateDir:path.join(dir,name+'-state'),witnessDir:path.join(dir,name+'-witness'),signingKeyFile:secret,tlsKeyFile:credentials.files.key,tlsCertFile:credentials.files.cert,host:'127.0.0.1',port:0,publicOrigin:null}),{mode:0o600});return config;};
 const firstConfig=configFor('first'),secondConfig=configFor('second'),server=fileURLToPath(new URL('../src/server.mjs',import.meta.url));
 const child=spawn(process.execPath,[server,'--config',firstConfig,'--initialize','--test-provisioning-dir',registry],{stdio:['ignore','pipe','pipe']}),exited=once(child,'exit');let exitSeen=false;exited.then(()=>{exitSeen=true;});t.after(async()=>{if(!exitSeen)child.kill('SIGTERM');await exited;});
 const started=await new Promise(resolve=>{let output='';const timeout=setTimeout(()=>{child.kill('SIGTERM');resolve(false);},5000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n')){clearTimeout(timeout);resolve(true);}});child.once('exit',()=>{clearTimeout(timeout);resolve(false);});});
 assert.equal(started,true,'first explicit initialization must start');child.kill('SIGTERM');assert.equal((await exited)[0],0);
 const reset=spawnSync(process.execPath,[server,'--config',secondConfig,'--initialize','--test-provisioning-dir',registry],{encoding:'utf8',timeout:5000});assert.equal(reset.status,1);assert.equal(reset.stdout,'');assert.equal(fs.existsSync(path.join(dir,'second-state','authority.sqlite')),false);
 t.diagnostic(`provisioning processes ${child.pid} and ${reset.pid} reaped`);
});
test('embedded HTTPS listener also refuses remote publicOrigin for a test certificate',async t=>{
 const f=fixture(t),credentials=tls(f,t);
 const attempt=startCoordinatorServer({coordinator:f.coordinator,tls:credentials,publicOrigin:'https://sync.example.invalid'}).then(host=>{t.after(()=>host.close());return host;});
 await assert.rejects(()=>attempt,/test_listener_forbidden/);
});
test('real TLS catch-up shrinks oversized read pages and never returns partial results on close',async t=>{
 const f=fixture(t),credentials=tls(f,t);let previous='0'.repeat(64);
 for(let i=1;i<=4;i++){const envelope=f.event('a',i,previous,{text:'x'.repeat(200*1024)});f.send('a','/v1/events/push',{envelope});previous=hash(envelope);}
 const host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const client=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});t.after(()=>client.close());
 const {fetchVerifiedScope}=await import('../src/sync-driver.mjs'),limits=[],call=client.call.bind(client);client.call=(route,body,options)=>{if(route==='/v1/events/pull')limits.push(body.limit);return call(route,body,options);};
 const result=await fetchVerifiedScope({client,identity:f.identity,deviceId:'a',scope:{conversationId:'conversation',branchId:'branch'}});assert.equal(result.events.length,4);assert.ok(limits.some(limit=>limit<100));
 const pending=fetchVerifiedScope({client,identity:f.identity,deviceId:'a',scope:{conversationId:'conversation',branchId:'branch'}});client.close();await assert.rejects(()=>pending,/client_closed/);
});
test('test certificates accept numeric loopback only rather than hostname resolution',async t=>{
 const f=fixture(t),credentials=tls(f,t);
 const attempt=startCoordinatorServer({coordinator:f.coordinator,tls:credentials,host:'localhost',publicOrigin:'https://localhost'}).then(host=>{t.after(()=>host.close());return host;});await assert.rejects(()=>attempt,/test_listener_forbidden/);
});

test('actual TLS key-use client rejects an old valid signed permit under the next original challenge',async t=>{
 const f=fixture(t,{keyUse:true}),credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const client=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});t.after(()=>client.close());
 const request={header:f.event().header,reservationId:'tls-original-reservation',workerBootId:base64(sodium.randombytes_buf(32)),useId:'tls-original-use'},requestId='tls-key-use-request';
 const {rootKeyId,syncGroupId,conversationId,branchId,keyEpoch,contentEpoch,originDeviceId}=request.header;request.derivedKeyId=hash(['xiaok/context-sync/derived-key-id/v1',{rootKeyId,syncGroupId,conversationId,branchId,keyEpoch,contentEpoch,originDeviceId},hashBytes(f.material.contentKey),base64(f.material.salt)]);
 const original=await client.call('/v1/key-use/consume',request,{requestId,expectedHead:f.journal.head(),requestSource:'scheduler'});assert.equal(original.body.result.count,1);
 const handle=f.coordinator.handle.bind(f.coordinator);f.coordinator.handle=req=>req.path==='/v1/key-use/consume'?original:handle(req);
 await assert.rejects(()=>client.call('/v1/key-use/consume',request,{requestId,expectedHead:f.journal.head(),requestSource:'scheduler'}),/invalid_key_use_response/);
});

test('a new TLS call rejects replay of both the old signed challenge and its old signed permit',async t=>{
 const f=fixture(t,{keyUse:true}),credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const client=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});t.after(()=>client.close());
 const request={header:f.event().header,reservationId:'double-replay-reservation',workerBootId:base64(sodium.randombytes_buf(32)),useId:'double-replay-use'},requestId='double-replay-request';
 const {rootKeyId,syncGroupId,conversationId,branchId,keyEpoch,contentEpoch,originDeviceId}=request.header;request.derivedKeyId=hash(['xiaok/context-sync/derived-key-id/v1',{rootKeyId,syncGroupId,conversationId,branchId,keyEpoch,contentEpoch,originDeviceId},hashBytes(f.material.contentKey),base64(f.material.salt)]);
 const create=f.coordinator.createChallenge.bind(f.coordinator);let oldChallenge;f.coordinator.createChallenge=input=>oldChallenge=create(input);
 const oldPermit=await client.call('/v1/key-use/consume',request,{requestId,expectedHead:f.journal.head(),requestSource:'scheduler'});
 const handle=f.coordinator.handle.bind(f.coordinator);f.coordinator.createChallenge=()=>oldChallenge;f.coordinator.handle=req=>req.path==='/v1/key-use/consume'?oldPermit:handle(req);
 await assert.rejects(()=>client.call('/v1/key-use/consume',request,{requestId,expectedHead:f.journal.head(),requestSource:'scheduler'}),/invalid_challenge/);
 const reopened=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});t.after(()=>reopened.close());await assert.rejects(()=>reopened.call('/v1/key-use/consume',request,{requestId,expectedHead:f.journal.head(),requestSource:'scheduler'}),/invalid_challenge/);
});
