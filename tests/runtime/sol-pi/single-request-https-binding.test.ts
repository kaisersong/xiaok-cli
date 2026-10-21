import {expect,it} from 'vitest';
import {createServer} from 'node:https';
import {readFileSync} from 'node:fs';
import type {Duplex} from 'node:stream';
import {createSingleRequestHttpsFetch,type SingleRequestHttpsOptions} from '../../../src/runtime/sol-pi/single-request-https.js';

it('retains the original physical lifecycle registration after options mutation',async()=>{
 const cert=readFileSync(new URL('../../fixtures/sol-pi-tls/cert.pem',import.meta.url));
 const key=readFileSync(new URL('../../fixtures/sol-pi-tls/key.pem',import.meta.url));
 const sockets=new Set<Duplex>();let received=0,originalCalls=0,replacementCalls=0;
 const server=createServer({cert,key},(req,res)=>{received++;req.resume();res.end('ok');});
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const destination=`https://127.0.0.1:${(server.address() as {port:number}).port}/dispatch`;
 const drains:Promise<void>[]=[];
 try{
  const options:SingleRequestHttpsOptions={destination,expectedBody:'{}',timeoutMs:2000,maxResponseBytes:1024,certificateAuthority:cert,trackPhysicalDrain:drain=>{originalCalls++;drains.push(drain);}};
  const fetch=createSingleRequestHttpsFetch(options);
  options.trackPhysicalDrain=()=>{replacementCalls++;};
  const response=await fetch(destination,{method:'POST',body:'{}'});
  expect(await response.text()).toBe('ok');await Promise.all(drains);
  expect(received).toBe(1);expect(originalCalls).toBe(1);expect(replacementCalls).toBe(0);
 }finally{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('does not write HTTP bytes when the original lifecycle registration rejects',async()=>{
 const cert=readFileSync(new URL('../../fixtures/sol-pi-tls/cert.pem',import.meta.url));
 const key=readFileSync(new URL('../../fixtures/sol-pi-tls/key.pem',import.meta.url));
 let received=0;const sockets=new Set<Duplex>();let physical:Promise<void>|undefined;
 const server=createServer({cert,key},(req,res)=>{received++;req.resume();res.end('unexpected');});
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const destination=`https://127.0.0.1:${(server.address() as {port:number}).port}/dispatch`;
 try{
  const fetch=createSingleRequestHttpsFetch({destination,expectedBody:'{}',timeoutMs:2000,maxResponseBytes:1024,certificateAuthority:cert,trackPhysicalDrain:drain=>{physical=drain;throw Error('registration rejected');}});
  await expect(fetch(destination,{method:'POST',body:'{}'})).rejects.toThrow();
  expect(physical).toBeDefined();await physical;expect(received).toBe(0);
  await expect(fetch(destination,{method:'POST',body:'{}'})).rejects.toThrow();expect(received).toBe(0);
 }finally{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
