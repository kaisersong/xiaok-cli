import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:https';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { channel } from 'node:diagnostics_channel';
import type { ClientRequest } from 'node:http';
import { createSessionExecutionAuthority, createSessionExecutionContext } from '../../../src/ai/runtime/session-store/execution-authority.js';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import OpenAI from 'openai';
import { createSingleRequestHttpsFetch } from '../../../src/runtime/sol-pi/single-request-https.js';
const cert = readFileSync(fileURLToPath(new URL('../../fixtures/sol-pi-tls/cert.pem', import.meta.url)));
const key = readFileSync(fileURLToPath(new URL('../../fixtures/sol-pi-tls/key.pem', import.meta.url)));
const running: Array<{ server: Server; sockets: Set<Duplex> }> = [];
async function serve(handler: Parameters<typeof createServer>[1]) {
  const server = createServer({ cert, key }, handler);
  const sockets = new Set<Duplex>(); server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  running.push({ server, sockets });
  return { server, sockets, url: `https://127.0.0.1:${(server.address() as { port: number }).port}/chat/completions` };
}
afterEach(async () => { for (const { server, sockets } of running.splice(0)) { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } });
const body = JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'x' }] });
const transport = (destination: string, extra = {}) => createSingleRequestHttpsFetch({ destination, expectedBody: body,
  timeoutMs: 2000, maxResponseBytes: 1024, certificateAuthority: cert, ...extra });
describe('single ClientRequest HTTPS transport', () => {
  it.each([307, 308, 421, 429, 500])('never follows or retries HTTP %i with the real SDK', async status => {
    let targetCalls = 0, calls = 0;
    const target = await serve((_req, res) => { targetCalls++; res.end('should not arrive'); });
    const origin = await serve((_req, res) => { calls++; res.writeHead(status, { location: target.url, 'content-type': 'application/json' }); res.end('{"error":{"message":"test"}}'); });
    const fetch = transport(origin.url);
    const client = new OpenAI({ apiKey: 'fixture-only', baseURL: origin.url.replace('/chat/completions', ''), maxRetries: 0, fetch });
    await expect(client.chat.completions.create(JSON.parse(body))).rejects.toThrow();
    expect(calls).toBe(1); expect(targetCalls).toBe(0);
    await expect(fetch(origin.url, { method: 'POST', body })).rejects.toThrow(); expect(calls).toBe(1);
  });
  it('rejects changed bytes, method, or destination before any request', async () => {
    let calls = 0; const origin = await serve((_req, res) => { calls++; res.end('ok'); });
    for (const change of [{ method: 'GET' }, { body: body + ' ' }]) {
      await expect(transport(origin.url)(origin.url, { method: 'POST', body, ...change })).rejects.toThrow();
    }
    await expect(transport(origin.url)(origin.url + '?other=1', { method: 'POST', body })).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it('retains cancellation through response body consumption', async () => {
    const origin = await serve((_req, res) => { res.writeHead(200); res.write('partial'); });
    const abort = new AbortController();
    const response = await transport(origin.url, { signal: abort.signal })(origin.url, { method: 'POST', body });
    const text = response.text(); abort.abort(); await expect(text).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 30)); expect(origin.sockets.size).toBe(0);
  });
  it('rejects Request and streaming bodies without reading them', async () => {
    let calls = 0;
    const origin = await serve((_req, res) => { calls++; res.end('ok'); });
    const request = new Request(origin.url, { method: 'POST', body });
    await expect(transport(origin.url)(request)).rejects.toThrow();
    await expect(transport(origin.url)(origin.url, { method: 'POST', body: new Blob([body]) })).rejects.toThrow();
    expect(request.bodyUsed).toBe(false);
    expect(calls).toBe(0);
  });
  it('enforces byte bounds and deadline even after headers', async () => {
    const oversized = await serve((_req, res) => res.end('x'.repeat(1025)));
    const response = await transport(oversized.url)(oversized.url, { method: 'POST', body });
    await expect(response.text()).rejects.toThrow();
    const hanging = await serve((_req, res) => { res.writeHead(200); res.write('p'); });
    const other = await transport(hanging.url, { timeoutMs: 50 })(hanging.url, { method: 'POST', body });
    await expect(other.text()).rejects.toThrow();
  });
  it('does not reopen a connection after the server disconnects', async () => {
    let calls = 0; const origin = await serve((req, _res) => { calls++; req.socket.destroy(); });
    await expect(transport(origin.url)(origin.url, { method: 'POST', body })).rejects.toThrow(); expect(calls).toBe(1);
  });
});

it.each(['abort', 'cancel', 'success', 'sdk-abort'] as const)('holds the real execution lease until client TLS close: %s', async mode => {
 const root=mkdtempSync(join(tmpdir(),'semantic-tls-drain-'));
 const authority=createSessionExecutionAuthority({root,sessionIdentity:'tls-drain',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});
 const events:string[]=[];
 const diagnostic=channel('http.client.request.start');
 const observe=(message:unknown)=>{const request=(message as {request:ClientRequest}).request;request.socket!.once('close',()=>events.push('socket-close'));};
 diagnostic.subscribe(observe);
 const lease=await authority.acquire({invocationId:'first',kind:'compaction'});
 try {
  const origin=await serve((_req,res)=>{res.writeHead(200,{'content-type':mode==='sdk-abort'?'text/event-stream':'text/plain'});res.write(mode==='sdk-abort'?'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n':'partial');if(mode==='success')res.end();});
  const abort=new AbortController();
  let work:Promise<unknown>;
  if(mode==='sdk-abort'){
   const sdkBody=JSON.stringify({...JSON.parse(body),stream:true});
   const fetch=createSingleRequestHttpsFetch({destination:origin.url,expectedBody:sdkBody,timeoutMs:2000,maxResponseBytes:1024,certificateAuthority:cert,trackPhysicalDrain:pending=>{lease.trackInFlight(pending);}});
   const sdk=new OpenAI({apiKey:'fixture',baseURL:origin.url.replace('/chat/completions',''),maxRetries:0,fetch});
   work=lease.trackInFlight((async()=>{const stream=await sdk.chat.completions.create(JSON.parse(sdkBody),{signal:abort.signal});for await(const _ of stream as any){abort.abort();}})());
  }else{
   const response=await transport(origin.url,{signal:abort.signal})(origin.url,{method:'POST',body});
   work=lease.trackInFlight<unknown>(mode==='cancel'?response.body!.cancel():response.text());
  }
  const settled=work.then(()=>events.push('settled'),()=>events.push('settled'));
  if(mode==='abort')abort.abort();
  const next=authority.acquire({invocationId:'second',kind:'compaction'}).then(value=>{events.push('next-lease');return value;});
  if(mode==='sdk-abort')await settled;
  await lease.releaseAfterDrain();await settled;
  const second=await next;await second.releaseAfterDrain();
  if(mode==='sdk-abort'){expect(events).toContain('socket-close');expect(events.indexOf('socket-close')).toBeLessThan(events.indexOf('next-lease'));}
  else expect(events).toEqual(['socket-close','settled','next-lease']);
 } finally {diagnostic.unsubscribe(observe);await lease.releaseAfterDrain();authority.dispose();rmSync(root,{recursive:true,force:true});}
});
