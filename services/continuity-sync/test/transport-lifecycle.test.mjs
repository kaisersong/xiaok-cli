import {test} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {coordinatorFixture} from './helpers/coordinator-fixture.mjs';
import {tls} from './helpers/tls-fixture.mjs';
import {startCoordinatorServer} from '../src/server.mjs';
import {CoordinatorClient} from '../src/transport.mjs';

test('closed transport drains the original native HTTPS request close events before releasing its owner',{skip:process.platform==='win32'},async t=>{
 const f=coordinatorFixture(t),credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const active=new Set(),request=https.request;
 t.mock.method(https,'request',(...args)=>{const req=request(...args);active.add(req);req.once('close',()=>active.delete(req));return req;});
 const client=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});t.after(()=>client.close());
 await assert.rejects(()=>client.drainClosed(),/client_not_closed/);
 let entered,release;const reached=new Promise(resolve=>entered=resolve);
 host.server.prependListener('request',(req,res)=>{if(req.url!=='/v1/head')return;const end=res.end;res.end=function(...args){release=()=>end.apply(res,args);entered();return res;};});
 const pending=client.getHead();pending.catch(()=>{});await reached;assert.ok(active.size>0);
 client.close();const drain=client.drainClosed();assert.equal(client.drainClosed(),drain,'close has one original drain obligation');
 release();await assert.rejects(()=>pending,/client_closed/);await drain;assert.equal(active.size,0,'actual original request descriptors must be closed');
 client.close();await client.drainClosed();
});
test('close reentry during native request construction retains its placeholder until that exact request closes',{skip:process.platform==='win32'},async t=>{
 const f=coordinatorFixture(t),credentials=tls(f,t),host=await startCoordinatorServer({coordinator:f.coordinator,tls:credentials});t.after(()=>host.close());
 const client=new CoordinatorClient({baseUrl:host.url,identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:credentials.cert});t.after(()=>client.close());
 const request=https.request;let release,closed=false;
 t.mock.method(https,'request',(...args)=>{
  client.close();const req=request(...args),destroy=req.destroy;
  req.once('close',()=>closed=true);
  req.destroy=function(error){release=()=>destroy.call(req,error);return req;};
  return req;
 });
 const pending=client.getHead();pending.catch(()=>{});let drained=false;const drain=client.drainClosed().then(()=>drained=true);
 await Promise.resolve();assert.equal(drained,false,'placeholder must be pending before original https.request returns');assert.equal(closed,false);
 assert.equal(typeof release,'function');release();await assert.rejects(()=>pending,/client_closed/);await drain;assert.equal(closed,true);
});
test('invalid CA is rejected before it can create an uncloseable native request placeholder',{skip:process.platform==='win32'},t=>{
 const f=coordinatorFixture(t);let client;
 try{assert.throws(()=>{client=new CoordinatorClient({baseUrl:'https://127.0.0.1:1',identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey,ca:{invalid:true}});},/invalid_ca/);}
 finally{client?.close();}
});
test('unexpected native construction failure reports sticky uncertainty instead of pretending a request closed',{skip:process.platform==='win32',timeout:2000},async t=>{
 const f=coordinatorFixture(t),client=new CoordinatorClient({baseUrl:'https://127.0.0.1:1',identity:f.identity,deviceId:'a',signingKey:f.devices.a.sign.privateKey});t.after(()=>client.close());
 t.mock.method(https,'request',()=>{throw new Error('synthetic_native_construction_unknown');});
 await assert.rejects(()=>client.getHead(),/synthetic_native_construction_unknown/);client.close();
 await assert.rejects(()=>client.drainClosed(),/transport_construction_uncertain/);
});
