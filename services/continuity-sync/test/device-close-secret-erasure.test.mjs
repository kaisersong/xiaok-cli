import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import https from 'node:https';
import sodium from 'libsodium-wrappers';
import {deviceOwnerFixture} from './helpers/device-owner-fixture.mjs';
import {claimDeviceNamespace} from '../../continuity-device/src/device-lock.mjs';
await sodium.ready;
for(const failure of ['construction','cancellation']){
 const name=`owner secret erasure preserves the uncertain ${failure} namespace until physical exit`;
 test(name,{skip:process.platform==='win32',timeout:20000},async t=>{
  if(process.env.XIAOK_SECRET_ERASURE_WORKER!==failure){
   const root=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-secret-erasure-worker-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
   const env={...process.env,XIAOK_SECRET_ERASURE_WORKER:failure,XIAOK_SECRET_ERASURE_ROOT:root};delete env.NODE_TEST_CONTEXT;
   const child=spawn(process.execPath,['--test',`--test-name-pattern=^${name}$`,fileURLToPath(import.meta.url)],{env,stdio:['ignore','pipe','pipe'],detached:true});t.diagnostic(`owned secret-erasure worker PID ${child.pid}`);let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
   const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},15000),result=await new Promise(resolve=>{child.once('close',(code,signal)=>resolve({code,signal}));child.once('error',error=>resolve({error}));});clearTimeout(timer);
   assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});assert.throws(()=>process.kill(-child.pid,0),{code:'ESRCH'});t.diagnostic(`owned secret-erasure worker PID ${child.pid} reaped`);assert.equal(result.code,0,output);assert.match(output,/SECRETS_ZERO_NAMESPACE_RETAINED/);
   const identity=JSON.parse(fs.readFileSync(path.join(root,'public-identity.json'),'utf8')),next=claimDeviceNamespace({identity,deviceId:'a',testRegistryDir:path.join(root,'registry')});next.close();await next.drainClosed();return;
  }
  const root=process.env.XIAOK_SECRET_ERASURE_ROOT;assert.ok(path.isAbsolute(root));const f=await deviceOwnerFixture(t,{registryDir:path.join(root,'registry')});fs.writeFileSync(path.join(root,'public-identity.json'),JSON.stringify(f.f.identity),{mode:0o600});
  // Observe real arrays returned to the original constructor; never install a
  // replacement key-provider, fake owner, settlement or synthetic close event.
  let signing,box;const keypair=sodium.crypto_sign_seed_keypair,base=sodium.crypto_scalarmult_base;
  t.mock.method(sodium,'crypto_sign_seed_keypair',(...args)=>{const pair=keypair(...args);signing=pair.privateKey;return pair;});t.mock.method(sodium,'crypto_scalarmult_base',(...args)=>{box=args[0];return base(...args);});
  const owner=f.open();assert.equal(signing.length,64);assert.equal(box.length,32);assert.ok(signing.some(byte=>byte!==0));assert.ok(box.some(byte=>byte!==0));
  if(failure==='construction'){t.mock.method(https,'request',()=>{throw new Error('synthetic_native_construction_unknown');});await assert.rejects(owner.sync({conversationId:'conversation',branchId:'branch'},{requestSource:'user'}));}
  else t.mock.method(https.Agent.prototype,'destroy',()=>{throw new Error('synthetic_native_cancellation_unknown');});
  const closing=owner.close();assert.strictEqual(owner.close(),closing);await assert.rejects(closing);assert.equal(signing.every(byte=>byte===0),true);assert.equal(box.every(byte=>byte===0),true);
  assert.throws(()=>claimDeviceNamespace({identity:f.f.identity,deviceId:'a',testRegistryDir:f.testOptions.testRegistryDir}),/device_owner_unavailable/);assert.throws(f.open,/device_owner_unavailable/);t.diagnostic('SECRETS_ZERO_NAMESPACE_RETAINED');
 });
}
