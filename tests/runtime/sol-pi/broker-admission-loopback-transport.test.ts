import {afterEach,expect,it,vi} from 'vitest';
import {createServer,type Server,type ClientRequest,type IncomingMessage} from 'node:http';
import type {Socket} from 'node:net';
import {
  createBrokerAdmissionLoopbackFetch,createSingleRequestHttpsFetch,
  attachOriginalSingleRequestResourceGate,readSingleRequestOwnedReply,
  readOriginalSingleRequestPhysicalReceipt,
} from '../../../src/runtime/sol-pi/single-request-https.js';

const wire=vi.hoisted(()=>({
  origin:'',calls:0,request:undefined as ClientRequest|undefined,
  options:[] as Array<{agent:unknown;connection:unknown;path:string}>,
  injection:undefined as undefined|{kind:string;tail:Promise<void>;closed():void},
  getterHits:0,
}));
vi.mock('node:http',async()=>{
  const actual=await vi.importActual<typeof import('node:http')>('node:http');
  return {...actual,request:(url:URL,options:import('node:http').RequestOptions,callback:(response:IncomingMessage)=>void)=>{
    // This pre-import fixture rewrite never opens the fixed product port.
    expect(url.origin).toBe('http://127.0.0.1:4318');
    expect(wire.origin).not.toBe('');
    wire.calls++;
    wire.options.push({agent:options.agent,connection:(options.headers as Record<string,string>).connection,path:url.pathname});
    const injection=wire.injection;
    const raw=actual.request(new URL(url.pathname,wire.origin),options,incoming=>{
      if(injection?.kind==='incoming')Object.defineProperty(incoming,Symbol('actual-incoming-tail'),{value:injection.tail});
      if(injection?.kind==='callback')Object.defineProperty(callback,Symbol('actual-callback-tail'),{value:injection.tail});
      callback(incoming);
    });
    wire.request=raw;
    if(injection){
      raw.once('close',injection.closed);
      if(injection.kind==='request')Object.defineProperty(raw,Symbol('actual-request-tail'),{value:injection.tail});
      if(injection.kind==='socket')raw.once('socket',socket=>Object.defineProperty(socket,Symbol('actual-socket-tail'),{value:injection.tail}));
      if(injection.kind==='error')raw.once('error',error=>Object.defineProperty(error,Symbol('actual-error-tail'),{value:injection.tail}));
      if(injection.kind==='getter'){
        const name=Symbol('original-public-getter');
        Object.defineProperty(raw,name,{configurable:true,get(){wire.getterHits++;return injection.tail;}});
        raw.once('close',()=>{delete (raw as unknown as Record<symbol,unknown>)[name];});
      }
    }
    return raw;
  }};
});
const active:Array<{server:Server;sockets:Set<Socket>}>=[];
async function serve(status=200,body='{"ok":true}',disconnect=false){
  const requests:Array<{path:string;port:number;body:string}>=[];
  const server=createServer((request,response)=>{
    let bodyIn='';request.setEncoding('utf8');request.on('data',chunk=>{bodyIn+=chunk;});
    request.on('end',()=>{requests.push({path:request.url!,port:request.socket.remotePort!,body:bodyIn});if(disconnect)request.socket.destroy();else{response.writeHead(status,{'content-type':'application/json',location:'http://127.0.0.1:4318/should-not-follow'});response.end(body);}});
  });
  const sockets=new Set<Socket>();server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));
  wire.origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  active.push({server,sockets});return requests;
}
afterEach(async()=>{
  wire.injection=undefined;wire.request=undefined;wire.calls=0;wire.options=[];wire.getterHits=0;
  for(const {server,sockets} of active.splice(0)){for(const socket of sockets)socket.destroy();await new Promise<void>(yes=>server.close(()=>yes()));}
  wire.origin='';
});
const body='{"protocol":"broker_dsh_control_v1"}';
const headers={'x-intent-broker-room-token':'isolated-fixture-token','content-type':'application/json'};
const address=(action:string)=>'http://127.0.0.1:4318/rooms/admission-control/'+action;
function transport(action:'baseline'|'apply'|'read'='read',expectedBody=body){
  const signal=new AbortController().signal;
  return createBrokerAdmissionLoopbackFetch({action,expectedBody,signal});
}
async function consume(engine:typeof fetch,action='read',expectedBody=body){
  const response=await engine(address(action),{method:'POST',headers,body:expectedBody});
  return readSingleRequestOwnedReply(engine,response);
}

it('exports the fixed Broker Admission loopback transport without selecting a model profile',()=>{
  expect(createBrokerAdmissionLoopbackFetch).toBeTypeOf('function');
});
it('uses one new actual connection per baseline/apply/read and preserves exact body/physical receipts',async()=>{
  const requests=await serve();
  for(const action of ['baseline','apply','read'] as const){
    const engine=transport(action),reply=await consume(engine,action);
    expect(new TextDecoder().decode(reply.bytes)).toBe('{"ok":true}');
    expect(readOriginalSingleRequestPhysicalReceipt(reply)).toMatchObject({destination:address(action),method:'POST',requestBody:body,status:200});
    await expect(consume(engine,action)).rejects.toThrow();
  }
  expect(requests.map(row=>row.path)).toEqual(['baseline','apply','read'].map(action=>'/rooms/admission-control/'+action));
  expect(requests.map(row=>row.body)).toEqual([body,body,body]);
  expect(new Set(requests.map(row=>row.port)).size).toBe(3);
  expect(wire.options.every(row=>row.agent===false&&row.connection==='close')).toBe(true);
  expect(wire.calls).toBe(3);
});
it.each([307,308,409,429,500])('does not redirect/retry actual HTTP %i and exposes only the actual close receipt',async status=>{
  const requests=await serve(status),reply=await consume(transport());
  expect(reply.status).toBe(status);readOriginalSingleRequestPhysicalReceipt(reply).assertKnown();
  expect(requests).toHaveLength(1);expect(wire.calls).toBe(1);
});
it('keeps HTTP excluded from the default HTTPS factory',()=>{
  expect(()=>createSingleRequestHttpsFetch({destination:address('read'),expectedBody:body,timeoutMs:1000,maxResponseBytes:100})).toThrow();
  expect(wire.calls).toBe(0);
});
it('rejects factory override/accessor/Proxy/wrong action before any SDK or getter',()=>{
  let traps=0;const options={action:'read',expectedBody:body,signal:new AbortController().signal};
  const inputs:unknown[]=[{...options,action:'other'},{...options,destination:'http://127.0.0.1:1234'},{...options,timeoutMs:1},{...options,transportProfile:'model_stream_v1'},{...options,expectedBody:'x'.repeat(16385)},{...options,signal:{}},new Proxy(options,{ownKeys(){traps++;throw Error();},get(){traps++;throw Error();}}),Object.defineProperty({...options},'action',{get(){traps++;return 'read';}})];
  for(const input of inputs)expect(()=>createBrokerAdmissionLoopbackFetch(input as Parameters<typeof createBrokerAdmissionLoopbackFetch>[0])).toThrow();
  expect(traps).toBe(0);expect(wire.calls).toBe(0);
});
it('rejects changed destination/body/method/protected init without HTTP or Proxy traps',async()=>{
  await serve();let traps=0;
  for(const [url,init] of [
    [address('read')+'?x=1',{method:'POST',headers,body}],
    ['http://localhost:4318/rooms/admission-control/read',{method:'POST',headers,body}],
    [address('apply'),{method:'POST',headers,body}],
    [address('read'),{method:'GET',headers,body}],
    [address('read'),{method:'POST',headers,body:body+' '}],
    [address('read'),{method:'POST',headers:{...headers,connection:'keep-alive'},body}],
    [address('read'),{method:'POST',headers,body,dispatcher:{}}],
    [address('read'),new Proxy({},{get(){traps++;throw Error();},ownKeys(){traps++;throw Error();}})],
  ] as Array<[string,RequestInit]>){await expect(transport()(url,init)).rejects.toThrow();}
  expect(wire.calls).toBe(0);expect(traps).toBe(0);
});
it('keeps the exact 16KiB request and 32KiB response bounds',async()=>{
  const requests=await serve(200,'x'.repeat(32769));
  const signal=new AbortController().signal,engine=createBrokerAdmissionLoopbackFetch({action:'read',expectedBody:'x'.repeat(16384),signal});
  await expect(consume(engine,'read','x'.repeat(16384))).rejects.toThrow();
  expect(requests[0]!.body.length).toBe(16384);expect(wire.calls).toBe(1);
});
it.each(['request','socket','incoming','callback'])('waits for actual %s own-symbol SDK tail after close',async kind=>{
  await serve();let release!:()=>void,closed!:()=>void;
  const tail=new Promise<void>(yes=>{release=yes;}),close=new Promise<void>(yes=>{closed=yes;});
  wire.injection={kind,tail,closed};let settled=false;
  const work=consume(transport());const observer=work.then(()=>{settled=true;},()=>{settled=true;});
  try{await close;await new Promise(yes=>setTimeout(yes,15));expect(settled).toBe(false);}finally{release();}
  const reply=await work;await observer;readOriginalSingleRequestPhysicalReceipt(reply).assertKnown();
});
it('keeps the real error own-symbol tail before a known negative receipt, with no retry',async()=>{
  await serve(200,'',true);let release!:()=>void,closed!:()=>void;
  const tail=new Promise<void>(yes=>{release=yes;}),close=new Promise<void>(yes=>{closed=yes;});wire.injection={kind:'error',tail,closed};
  let settled=false;const work=consume(transport()).then(()=>{throw Error('must-reject');},error=>error);work.then(()=>{settled=true;});
  try{await close;await new Promise(yes=>setTimeout(yes,15));expect(settled).toBe(false);}finally{release();}
  readOriginalSingleRequestPhysicalReceipt(await work).assertKnown();expect(wire.calls).toBe(1);
});
it('never washes an initial public getter by SDK deletion, never calls it',async()=>{
  await serve();wire.injection={kind:'getter',tail:Promise.resolve(),closed(){}};
  const error=await consume(transport()).then(()=>{throw Error('must-reject');},error=>error);
  expect(()=>readOriginalSingleRequestPhysicalReceipt(error)).toThrow();expect(wire.getterHits).toBe(0);
});
it('uses the same fixed source connect/send gates and rejects current loss before send',async()=>{
  const requests=await serve();const engine=transport();let local=true;const phases:string[]=[];
  attachOriginalSingleRequestResourceGate(engine,{beforeSource(phase:string){phases.push(phase);if(phase==='send')local=false;},afterSourceLocal(){if(!local)throw Error('source-revoked');},observeRawFailure(){}});
  await expect(consume(engine)).rejects.toThrow();expect(phases).toEqual(['connect','send']);
  expect(requests).toHaveLength(0);expect(wire.calls).toBe(1);
});
it('never reads an inherited profile or lifecycle hook while normalizing the fixed factory',()=>{
  let getters=0;
  const profile=Object.getOwnPropertyDescriptor(Object.prototype,'transportProfile');
  const observer=Object.getOwnPropertyDescriptor(Object.prototype,'trackPhysicalDrain');
  try{
    Object.defineProperty(Object.prototype,'transportProfile',{configurable:true,get(){getters++;return undefined;}});
    Object.defineProperty(Object.prototype,'trackPhysicalDrain',{configurable:true,get(){getters++;return undefined;}});
    transport();
  }finally{
    if(profile)Object.defineProperty(Object.prototype,'transportProfile',profile);else delete (Object.prototype as {transportProfile?:unknown}).transportProfile;
    if(observer)Object.defineProperty(Object.prototype,'trackPhysicalDrain',observer);else delete (Object.prototype as {trackPhysicalDrain?:unknown}).trackPhysicalDrain;
  }
  expect(getters).toBe(0);expect(wire.calls).toBe(0);
});
