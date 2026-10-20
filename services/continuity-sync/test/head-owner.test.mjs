import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tls} from './helpers/tls-fixture.mjs';
import {coordinatorFixture} from './helpers/coordinator-fixture.mjs';
import {startCoordinatorServer} from '../src/server.mjs';
import {CoordinatorClient} from '../src/transport.mjs';

test('original fresh head uses private TLS even after public transport methods are replaced',{skip:process.platform==='win32'},async t=>{
 const f=coordinatorFixture(t),credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const client=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});t.after(()=>client.close());
 const original=CoordinatorClient.prototype.getHead,call=CoordinatorClient.prototype.call,getHead=CoordinatorClient.prototype.getHead;
 const handle=f.coordinator.handle.bind(f.coordinator);let actualHeads=0;f.coordinator.handle=request=>{if(request.path==='/v1/head')actualHeads++;return handle(request);};
 try{
  client.call=()=>assert.fail('replaced public call must never supply original head');
  const first=await original.call(client,{expectedHead:f.journal.head()});
  assert.equal(actualHeads,1);assert.deepEqual(first.response.body.result.head,f.journal.head());
  CoordinatorClient.prototype.call=()=>assert.fail('replaced prototype call must never supply original head');
  CoordinatorClient.prototype.getHead=()=>assert.fail('replaced prototype getHead must never supply captured original head');
  const next=await original.call(client,{expectedHead:f.journal.head()});
  assert.equal(actualHeads,2);assert.notEqual(next.nonce,first.nonce);assert.equal(next.response.body.result.nonce,next.nonce);
  await assert.rejects(()=>original.call(new Proxy(client,{}),{}));
 }finally{CoordinatorClient.prototype.call=call;CoordinatorClient.prototype.getHead=getHead;}
});
