import nodeTest from 'node:test';
const test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'},fn);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { coordinatorFixture } from './helpers/coordinator-fixture.mjs';
import { base64,canonical,hash } from '../src/crypto.mjs';
import { CoordinatorClient } from '../src/transport.mjs';
import { startCoordinatorServer } from '../src/server.mjs';
function certificate(directory,t){
 const key=path.join(directory,'tls-key.pem'),cert=path.join(directory,'tls-cert.pem'),config=path.join(directory,'tls.cnf');
 fs.writeFileSync(config,'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n',{mode:0o600});
 const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-config',config,'-days','1'],{encoding:'utf8',timeout:10_000});assert.equal(result.status,0,result.stderr);fs.writeFileSync(path.join(directory,'certificate-process.json'),canonical({pid:result.pid,exitCode:result.status}),{mode:0o600});t.diagnostic(`TLS fixture process ${result.pid} reaped`);return {key:fs.readFileSync(key),cert:fs.readFileSync(cert)};
}
async function replica(t,config){
 const child=fork(fileURLToPath(new URL('./helpers/replica-worker.mjs',import.meta.url)),[],{execPath:process.execPath,execArgv:[],stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}),exit=once(child,'exit');let exited=false;exit.then(()=>{exited=true;});
 fs.writeFileSync(path.join(path.dirname(config.directory),config.deviceId+'-'+child.pid+'-process.json'),canonical({pid:child.pid,deviceId:config.deviceId,profileId:config.profileId}),{mode:0o600});const pending=new Map();
 child.on('message',message=>{const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timeout);message.error?p.reject(new Error(message.error)):p.resolve(message.result);});
 child.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.timeout);p.reject(new Error('test_replica_exited'));}pending.clear();});child.stderr.resume();
 const call=(command,args={})=>new Promise((resolve,reject)=>{const id=randomUUID(),timeout=setTimeout(()=>{pending.delete(id);reject(new Error('test_replica_timeout'));},15_000);pending.set(id,{resolve,reject,timeout});child.send({id,command,...args});});
 let stopPromise;const stop=()=>stopPromise??=(async()=>{if(!exited){try{await call('stop');}catch{child.kill('SIGTERM');}}const result=await exit;assert.equal(result[0],0);t.diagnostic(`client ${config.deviceId} process ${child.pid} reaped`);})();t.after(stop);
 const started=await call('start',{config});return {call,stop,started};
}
test('independent persistent clients pair, encrypt, restart with identical bytes and reject revoked scope over TLS',async t=>{
 const f=coordinatorFixture(t),directory=path.dirname(f.opts.stateDir),tls=certificate(directory,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls});t.after(()=>host.close());
 const rootClient=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:tls.cert});t.after(()=>rootClient.close());
 const config=id=>({directory:path.join(directory,'replica-'+id),baseUrl:host.url,identity:f.identity,deviceId:id,profileId:randomUUID(),scope:{conversationId:'conversation',branchId:'branch'},signingKey:base64(f.devices[id].sign.privateKey),boxPublicKey:base64(f.devices[id].box.publicKey),boxSecretKey:base64(f.devices[id].box.privateKey),ca:tls.cert.toString(),initialize:true});
 const aConfig=config('a'),bConfig=config('b');let a=await replica(t,aConfig);const b=await replica(t,bConfig);assert.notEqual(a.started.profileId,b.started.profileId);await assert.rejects(()=>b.call('sync'),/unknown_device/);
 const pairing=await a.call('beginPairing',{joiningDevice:f.row('b','active','pending')}),sponsorSignature=await a.call('signPairing',{body:pairing}),joiningSignature=await b.call('signPairing',{body:pairing});
 await rootClient.control('/v1/pairings/confirm',{pairingId:pairing.pairingId,sponsorSignature,joiningSignature});const membership=f.membership([f.row('a'),f.row('b','active',pairing.pairingId)]);await rootClient.control('/v1/membership',{record:membership,manifest:f.manifest(membership)});f.record=membership;
 const oldScope=f.journal.get('scope:'+hash(['conversation','branch']));await rootClient.control('/v1/scopes',{record:f.grant(['a','b'],2,hash(oldScope.body))});
 const firstA=await a.call('push',{eventId:'message-a',payload:{text:'synthetic from a'}}),firstB=await b.call('push',{eventId:'message-b',payload:{text:'synthetic from b'}});assert.equal(firstA.accepted.originSequence,1);assert.equal(firstB.accepted.originSequence,1);assert.notEqual(firstA.accepted.streamId,firstB.accepted.streamId);
 for(const peer of [a,b])assert.deepEqual((await peer.call('sync')).opened.map(e=>e.payload.text).sort(),['synthetic from a','synthetic from b']);
 await a.stop();a=await replica(t,{...aConfig,initialize:false});await assert.rejects(()=>a.call('cachedWire',{eventId:'message-a'}),/heads_unverified/);
 const replay=await a.call('push',{eventId:'message-a',payload:{text:'synthetic from a'}});assert.equal(replay.wire,firstA.wire);assert.deepEqual(replay.accepted,firstA.accepted);
 const scope=f.journal.get('scope:'+hash(['conversation','branch']));await rootClient.control('/v1/scopes',{record:f.grant(['a'],3,hash(scope.body))});await assert.rejects(()=>b.call('sync'),/scope_forbidden/);await assert.rejects(()=>b.call('cachedWire',{eventId:'message-b'}),/heads_unverified/);
 const revoked=f.membership([f.row('a'),f.row('b','revoked',pairing.pairingId)]);await rootClient.control('/v1/membership',{record:revoked,manifest:f.manifest(revoked)});f.record=revoked;await assert.rejects(()=>b.call('push',{eventId:'forbidden',payload:{text:'never accepted'}}),/device_revoked/);
 const next=await a.call('push',{eventId:'message-a-2',payload:{text:'after rotation'}});assert.equal(next.accepted.originSequence,2);assert.equal((await a.call('sync')).opened.length,3);
 const cipherJournal=fs.readFileSync(path.join(aConfig.directory,'inbox-body','authority.sqlite'));assert.equal(cipherJournal.includes(Buffer.from('synthetic from a')),false);
 await a.stop();await b.stop();
});
