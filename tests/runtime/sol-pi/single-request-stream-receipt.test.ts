import {expect,it} from 'vitest';
import {createServer} from 'node:https';
import {readFileSync} from 'node:fs';
import type {Duplex} from 'node:stream';
import * as source from '../../../src/runtime/sol-pi/single-request-https.js';
it('genuine consumed streaming bodies have an original close receipt without a second body read',async()=>{
 const cert=readFileSync(new URL('../../fixtures/sol-pi-tls/cert.pem',import.meta.url)),key=readFileSync(new URL('../../fixtures/sol-pi-tls/key.pem',import.meta.url));
 const sockets=new Set<Duplex>();let end!:()=>void;
 const server=createServer({cert,key},(req,res)=>{req.resume();res.write('first');end=()=>res.end('last');});
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));
 const url=`https://127.0.0.1:${(server.address() as {port:number}).port}/model`;
 try{
  const fetch=source.createSingleRequestHttpsFetch({destination:url,expectedBody:'{}',maxResponseBytes:1024,timeoutMs:2000,certificateAuthority:cert,sourceHooks:{beforeTransport(){},observeRawFailure(){}}});
  const response=await fetch(url,{method:'POST',body:'{}'}),reader=(source as unknown as {readOriginalSingleRequestStreamPhysicalReceipt(fetch:typeof globalThis.fetch,result:unknown):Promise<object>}).readOriginalSingleRequestStreamPhysicalReceipt;
  expect(typeof reader).toBe('function');let settled=false;const closing=reader(fetch,response).then(receipt=>{settled=true;return receipt;});
  const body=response.text();await new Promise(yes=>setTimeout(yes,10));expect(settled).toBe(false);end();expect(await body).toBe('firstlast');
  const receipt=await closing;source.readOriginalSingleRequestPhysicalReceipt(receipt).assertKnown();expect(response.bodyUsed).toBe(true);
  await expect(reader(fetch,{...response})).rejects.toThrow();let calls=0;await expect(reader(fetch,new Proxy({}, {get(){calls++;throw Error();}}))).rejects.toThrow();expect(calls).toBe(0);
  const other=source.createSingleRequestHttpsFetch({destination:url,expectedBody:'{}',maxResponseBytes:1024,timeoutMs:2000,certificateAuthority:cert});await expect(reader(other,response)).rejects.toThrow();
 }finally{for(const socket of sockets)socket.destroy();await new Promise<void>(yes=>server.close(()=>yes()));}
});
it('an accepted native stream cancel racing incoming EOF does not close its already cancelled controller twice',async()=>{
 const cert=readFileSync(new URL('../../fixtures/sol-pi-tls/cert.pem',import.meta.url)),key=readFileSync(new URL('../../fixtures/sol-pi-tls/key.pem',import.meta.url));const sockets=new Set<Duplex>();
 const server=createServer({cert,key},(req,res)=>{req.resume();res.end('semantic terminal before SDK reader return');});server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));
 const url=`https://127.0.0.1:${(server.address() as {port:number}).port}/model`;
 try{const fetch=source.createSingleRequestHttpsFetch({destination:url,expectedBody:'{}',maxResponseBytes:1024,timeoutMs:2000,certificateAuthority:cert,sourceHooks:{beforeTransport(){},observeRawFailure(){}}});const response=await fetch(url,{method:'POST',body:'{}'}),reader=response.body!.getReader();await reader.read();await reader.cancel();const receipt=await source.readOriginalSingleRequestStreamPhysicalReceipt(fetch,response);source.readOriginalSingleRequestPhysicalReceipt(receipt).assertKnown();}
 finally{for(const socket of sockets)socket.destroy();await new Promise<void>(yes=>server.close(()=>yes()));}
});

it('resource overlay narrows the same original transport around each original Source gate',async()=>{
 const attach=(source as unknown as {attachOriginalSingleRequestResourceGate(fetch:typeof globalThis.fetch,gate:unknown):void}).attachOriginalSingleRequestResourceGate;
 expect(typeof attach).toBe('function');
 const cert=readFileSync(new URL('../../fixtures/sol-pi-tls/cert.pem',import.meta.url)),key=readFileSync(new URL('../../fixtures/sol-pi-tls/key.pem',import.meta.url));let requests=0;const order:string[]=[];
 const server=createServer({cert,key},(req,res)=>{requests++;req.resume();res.end('same engine');});await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));
 const url=`https://127.0.0.1:${(server.address() as {port:number}).port}/model`;
 try{
  const fetch=source.createSingleRequestHttpsFetch({destination:url,expectedBody:'{}',maxResponseBytes:1024,timeoutMs:2000,certificateAuthority:cert,sourceHooks:{beforeTransport(phase){order.push('source:'+phase);},observeRawFailure(){}}});
  attach(fetch,{beforeSource(phase:string){order.push('M:'+phase);},afterSourceLocal(phase:string){order.push('local:'+phase);},observeRawFailure(){}});
  expect(()=>attach(fetch,{beforeSource(){},afterSourceLocal(){},observeRawFailure(){}})).toThrow();
  const response=await fetch(url,{method:'POST',body:'{}'});expect(await response.text()).toBe('same engine');await source.readOriginalSingleRequestStreamPhysicalReceipt(fetch,response);
  expect(order).toEqual(['M:connect','source:connect','local:connect','M:send','source:send','local:send']);expect(requests).toBe(1);
  let getters=0;const foreign=new Proxy({}, {get(){getters++;throw Error();},getOwnPropertyDescriptor(){getters++;throw Error();}});
  expect(()=>attach(foreign as typeof fetch,foreign)).toThrow();expect(getters).toBe(0);
  const second=source.createSingleRequestHttpsFetch({destination:url,expectedBody:'{}',maxResponseBytes:1024,timeoutMs:2000,certificateAuthority:cert});expect(()=>attach(second,foreign)).toThrow();expect(getters).toBe(0);
 }finally{await new Promise<void>(yes=>server.close(()=>yes()));}
});
it('both original and resource observers are attempted while original failure stays first and HTTP stays zero',async()=>{
 const attach=(source as unknown as {attachOriginalSingleRequestResourceGate(fetch:typeof globalThis.fetch,gate:unknown):void}).attachOriginalSingleRequestResourceGate;
 expect(typeof attach).toBe('function');const original=Error('original source refusal'),secondary=Error('observer refusal');let sourceSeen=0,resourceSeen=0;
 const fetch=source.createSingleRequestHttpsFetch({destination:'https://127.0.0.1:1/model',expectedBody:'{}',maxResponseBytes:1024,timeoutMs:100,sourceHooks:{beforeTransport(){throw original;},observeRawFailure(){sourceSeen++;throw secondary;}}});
 attach(fetch,{beforeSource(){},afterSourceLocal(){},observeRawFailure(){resourceSeen++;throw secondary;}});
 await expect(fetch('https://127.0.0.1:1/model',{method:'POST',body:'{}'})).rejects.toMatchObject({cause:{primary:original,unknown:true}});
 expect(sourceSeen).toBe(1);expect(resourceSeen).toBe(1);
});

it('resource Current revocation is rechecked by the original Source after the resource gate and before native connect',async()=>{
 let current=true,localCalls=0;const original=Error('actual source revoked');
 const fetch=source.createSingleRequestHttpsFetch({destination:'https://127.0.0.1:1/model',expectedBody:'{}',maxResponseBytes:1024,timeoutMs:100,sourceHooks:{beforeTransport(){if(!current)throw original;},observeRawFailure(){}}});
 source.attachOriginalSingleRequestResourceGate(fetch,{beforeSource(){current=false;},afterSourceLocal(){localCalls++;},observeRawFailure(){}});
 let failure:unknown;try{await fetch('https://127.0.0.1:1/model',{method:'POST',body:'{}'});}catch(error){failure=error;}
 expect(failure).toMatchObject({cause:{primary:original,unknown:false}});expect(localCalls).toBe(0);
 const receipt=await source.readOriginalSingleRequestStreamPhysicalReceipt(fetch,failure);source.readOriginalSingleRequestPhysicalReceipt(receipt).assertKnown();
});
