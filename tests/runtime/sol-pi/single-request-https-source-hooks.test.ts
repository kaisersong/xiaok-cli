import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:https';
import { readFileSync } from 'node:fs';
import type { Duplex } from 'node:stream';
import { createSingleRequestHttpsFetch, readSingleRequestOwnedReply,readOriginalSingleRequestPhysicalReceipt, type SingleRequestHttpsOptions, type SingleRequestSourceHooks } from '../../../src/runtime/sol-pi/single-request-https.js';
const nativeHandles = vi.hoisted(() => ({ request: undefined as import('node:http').ClientRequest | undefined, getterHits: 0, injection: undefined as undefined | { kind: string; tail: Promise<void>; closed(): void } }));
vi.mock('node:https', async () => {
  const actual = await vi.importActual<typeof import('node:https')>('node:https');
  return { ...actual, request: (url: URL, options: object, callback: Parameters<typeof actual.request>[2]) => {
    const injection = nativeHandles.injection;
    const listener = (incoming: import('node:http').IncomingMessage) => {
      if (injection?.kind === 'incoming') Object.defineProperty(incoming, Symbol('actual-incoming-tail'), { value: injection.tail });
      if (injection?.kind === 'callback') Object.defineProperty(callback!, Symbol('actual-callback-tail'), { value: injection.tail });
      callback!(incoming);
    };
    const request = actual.request(url, options, listener); nativeHandles.request = request;
    if (injection) {
      if (injection.kind === 'error-tail') request.once('error', error => Object.defineProperty(error, Symbol('actual-error-tail'), { value: injection.tail }));
      request.once('close', injection.closed);
      if (injection.kind === 'request') Object.defineProperty(request, Symbol('actual-request-tail'), { value: injection.tail });
      if (injection.kind === 'socket') request.once('socket', socket => Object.defineProperty(socket, Symbol('actual-socket-tail'), { value: injection.tail }));
    }
    if (injection?.kind === 'request-getter') {
      const key = Symbol('actual-public-getter');
      Object.defineProperty(request, key, { configurable: true, get() { nativeHandles.getterHits++; return injection.tail; } });
      request.once('close', () => { delete (request as unknown as Record<symbol, unknown>)[key]; });
    }
    if (injection?.kind === 'socket-getter') request.once('socket', socket => {
      const key = Symbol('actual-public-getter');
      Object.defineProperty(socket, key, { configurable: true, get() { nativeHandles.getterHits++; return injection.tail; } });
      socket.once('close', () => { delete (socket as unknown as Record<symbol, unknown>)[key]; });
    });
    if (injection?.kind === 'detached-internal-getter-tail') {
      const key = Symbol('actual-internal-resource');
      const get = () => { nativeHandles.getterHits++; return undefined; };
      Object.defineProperty(get, Symbol('original-getter-function-tail'), { value: injection.tail });
      Object.defineProperty(request, key, { configurable: true, value: Object.create(null, { nested: { get, enumerable: true } }) });
      request.once('close', () => { delete (request as unknown as Record<symbol, unknown>)[key]; });
    }
    return request;
  } };
});
const cert = readFileSync(new URL('../../fixtures/sol-pi-tls/cert.pem', import.meta.url));
const key = readFileSync(new URL('../../fixtures/sol-pi-tls/key.pem', import.meta.url));
const running: { server: Server; sockets: Set<Duplex> }[] = [];
async function serve(disconnect = false) {
  let requests = 0;
  const server = createServer({ cert, key }, (req, res) => { requests++; req.resume(); if (disconnect) res.destroy(); else res.end('ok'); });
  const sockets = new Set<Duplex>(); server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); running.push({ server, sockets });
  return { url: `https://127.0.0.1:${(server.address() as { port: number }).port}/source`, requests: () => requests };
}
afterEach(async () => { nativeHandles.injection = undefined; nativeHandles.getterHits = 0; for (const { server, sockets } of running.splice(0)) { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } });
function options(destination: string, sourceHooks: unknown, extra = {}): SingleRequestHttpsOptions {
  return { destination, expectedBody: '', method: 'GET' as const, timeoutMs: 2000, maxResponseBytes: 1024, certificateAuthority: cert, sourceHooks: sourceHooks as SingleRequestSourceHooks, ...extra };
}
async function rejection(work: Promise<unknown>): Promise<unknown> { try { await work; throw Error('expected rejection'); } catch (error) { return error; } }
function cause(raw: unknown): Record<string, unknown> {
  return Object.getOwnPropertyDescriptor(raw as object, 'cause')?.value as Record<string, unknown>;
}
describe('S1 original HTTPS Source hooks', () => {
  it.each(['request', 'socket', 'incoming', 'callback', 'detached-internal-getter-tail'])('waits for the actual %s visible SDK own-symbol tail after Native close', async kind => {
    const origin = await serve();
    let release!: () => void, closed!: () => void;
    const tail = new Promise<void>(yes => { release = yes; });
    const nativeClosed = new Promise<void>(yes => { closed = yes; });
    nativeHandles.injection = { kind, tail, closed };
    let drained = false, drain: Promise<void> | undefined;
    const fetch = createSingleRequestHttpsFetch(options(origin.url, { beforeTransport() {}, observeRawFailure() {} }, {
      trackPhysicalDrain(value: Promise<void>) { drain = value; void value.then(() => { drained = true; }); },
    }));
    const work = (async () => { const raw = await fetch(origin.url, { method: 'GET' }); return readSingleRequestOwnedReply(fetch, raw); })();
    try {
      await nativeClosed;
      await new Promise<void>(yes => setTimeout(yes, 20));
      expect(drained).toBe(false);
    } finally { release(); }
    const reply = await work; await drain;
    expect(new TextDecoder().decode(reply.bytes)).toBe('ok');
    readOriginalSingleRequestPhysicalReceipt(reply).assertKnown();
    expect(origin.requests()).toBe(1); expect(nativeHandles.getterHits).toBe(0);
  });
  it('keeps the actual SDK error own-symbol tail before exposing its known negative receipt', async () => {
    const origin = await serve(true);
    let release!: () => void, closed!: () => void, drain: Promise<void> | undefined, drained = false;
    const tail = new Promise<void>(yes => { release = yes; });
    const nativeClosed = new Promise<void>(yes => { closed = yes; });
    nativeHandles.injection = { kind: 'error-tail', tail, closed };
    const fetch = createSingleRequestHttpsFetch(options(origin.url, { beforeTransport() {}, observeRawFailure() {} }, { trackPhysicalDrain(value: Promise<void>) { drain = value; void value.then(() => { drained = true; }); } }));
    const work = rejection(fetch(origin.url, { method: 'GET' }));
    try { await nativeClosed; await new Promise<void>(yes => setTimeout(yes, 20)); expect(drained).toBe(false); }
    finally { release(); }
    const raw = await work; await drain;
    expect(cause(raw).primaryPresent).toBe(true);
    readOriginalSingleRequestPhysicalReceipt(raw).assertKnown();
  });
  it('refuses a foreign DOMException diagnostic exemption without touching its stack', async () => {
    const origin = await serve(), foreign = new DOMException('foreign', 'AbortError');
    const fetch = createSingleRequestHttpsFetch(options(origin.url, { beforeTransport() { throw foreign; }, observeRawFailure() {} }));
    const raw = await rejection(fetch(origin.url, { method: 'GET' }));
    expect(cause(raw).primary).toBe(foreign); expect(cause(raw).unknown).toBe(true);
    expect(()=>readOriginalSingleRequestPhysicalReceipt(raw)).toThrow('SINGLE_REQUEST_PHYSICAL_UNCONFIRMED');
    expect(origin.requests()).toBe(0);
  });
  it('joins data attached to its private AbortError by the real observer before negative drain', async () => {
    const origin = await serve(), abort = new AbortController();
    let release!: () => void, physical: Promise<void> | undefined, drained = false, observed = false;
    const tail = new Promise<void>(yes => { release = yes; });
    const fetch = createSingleRequestHttpsFetch(options(origin.url, {
      beforeTransport() {},
      observeRawFailure(raw: unknown) {
        if (!observed && raw instanceof DOMException) { observed = true; Object.defineProperty(raw, Symbol('private-abort-own-tail'), { value: tail }); }
      },
    }, { signal: abort.signal, trackPhysicalDrain(value: Promise<void>) { physical = value; void value.then(() => { drained = true; }); abort.abort(); } }));
    const work = rejection(fetch(origin.url, { method: 'GET' }));
    try { await new Promise<void>(yes => setTimeout(yes, 20)); expect(observed).toBe(true); expect(drained).toBe(false); }
    finally { release(); }
    const raw = await work; await physical;
    expect(cause(raw).primaryPresent).toBe(true); expect(origin.requests()).toBe(0);
  });
  it.each(['request-getter', 'socket-getter'])('keeps initial public %s unknown after actual SDK deletion without invoking it', async kind => {
    const origin = await serve();
    nativeHandles.injection = { kind, tail: Promise.resolve(), closed() {} };
    let drain: Promise<void> | undefined;
    const fetch = createSingleRequestHttpsFetch(options(origin.url, { beforeTransport() {}, observeRawFailure() {} }, { trackPhysicalDrain(value: Promise<void>) { drain = value; } }));
    const work = (async () => { const response = await fetch(origin.url, { method: 'GET' }); return readSingleRequestOwnedReply(fetch, response); })();
    const raw = await rejection(work); await drain;
    expect(nativeHandles.getterHits).toBe(0);
    expect(()=>readOriginalSingleRequestPhysicalReceipt(raw)).toThrow();
  });

  it('captures methods once with the original receiver and preserves the real GET drain', async () => {
    const origin = await serve(), phases: string[] = []; let getters = 0;
    const hooks = { beforeTransport(this: unknown, phase: string) { expect(this).toBe(hooks); phases.push(phase); }, observeRawFailure() {} };
    let drain: Promise<void> | undefined;
    const fetch = createSingleRequestHttpsFetch(options(origin.url, hooks, { trackPhysicalDrain: (value: Promise<void>) => { drain = value; } }));
    Object.defineProperty(hooks, 'beforeTransport', { get() { getters++; throw Error('late lookup'); } });
    const response = await fetch(origin.url, { method: 'GET' }); expect(await response.text()).toBe('ok'); await drain;
    expect(phases).toEqual(['connect', 'send']); expect(getters).toBe(0); expect(origin.requests()).toBe(1);
  });
  it.each(['connect', 'send'] as const)('a %s gate failure stops HTTP and keeps its original primary', async phase => {
    const origin = await serve(), primary = { reason: 'fixture-stop', [Symbol('tail')]: Promise.resolve() }; let drain: Promise<void> | undefined; const seen: unknown[] = [];
    const hooks = { beforeTransport(at: string) { if (at === phase) throw primary; }, observeRawFailure(raw: unknown) { seen.push(raw); } };
    const fetch = createSingleRequestHttpsFetch(options(origin.url, hooks, { trackPhysicalDrain: (value: Promise<void>) => { drain = value; } }));
    const error = await rejection(fetch(origin.url, { method: 'GET' })); if (drain) await drain;
    expect(origin.requests()).toBe(0); expect(seen[0]).toBe(primary); expect(cause(error)).toMatchObject({ primaryPresent: true, primary });
    if (phase === 'connect') { const physical=readOriginalSingleRequestPhysicalReceipt(error);physical.assertKnown();expect(physical.destination).toBe(origin.url);expect(physical.status).toBe(0); }
    else { expect(cause(error).unknown).toBe(true); expect(()=>readOriginalSingleRequestPhysicalReceipt(error)).toThrow('SINGLE_REQUEST_PHYSICAL_UNCONFIRMED'); }
    expect(()=>readOriginalSingleRequestPhysicalReceipt({...error as object})).toThrow();
  });
  it.each([undefined, { reason: 'first', [Symbol('tail')]: Promise.resolve() }])('observer throw cannot replace primary %j or bypass physical cleanup', async primary => {
    const origin = await serve(), secondary = { observer: true, tail: Promise.resolve() }; let physical: Promise<void> | undefined;
    const hooks = { beforeTransport() {}, observeRawFailure() { throw secondary; } };
    const fetch = createSingleRequestHttpsFetch(options(origin.url, hooks, { trackPhysicalDrain: (value: Promise<void>) => { physical = value; throw primary; } }));
    const error = await rejection(fetch(origin.url, { method: 'GET' })); await physical;
    const record = cause(error); expect(record.primaryPresent).toBe(true); expect(Object.hasOwn(record, 'primary')).toBe(true); expect(record.primary).toBe(primary);
    expect(record.secondary).toContainEqual({ kind: 'observer_throw', raw: secondary }); expect(record.unknown).toBe(true); expect(origin.requests()).toBe(0);
    expect(()=>readOriginalSingleRequestPhysicalReceipt(error)).toThrow('SINGLE_REQUEST_PHYSICAL_UNCONFIRMED');
  });
  it('observer nonvoid is retained as secondary, and the original cleanup still drains', async () => {
    const origin = await serve(), primary = Error('first'), returned = Promise.resolve({ late: Promise.resolve() }); let physical: Promise<void> | undefined;
    const hooks = { beforeTransport() {}, observeRawFailure() { return returned; } };
    const fetch = createSingleRequestHttpsFetch(options(origin.url, hooks, { trackPhysicalDrain: (value: Promise<void>) => { physical = value; throw primary; } }));
    const error = await rejection(fetch(origin.url, { method: 'GET' })); await physical;
    expect(cause(error).primary).toBe(primary); expect(cause(error).secondary).toContainEqual({ kind: 'observer_nonvoid', raw: returned });
    expect(cause(error).unknown).toBe(true); expect(origin.requests()).toBe(0);
  });
  it('a nonvoid gate never continues to connect', async () => {
    const origin = await serve(), returned = Promise.resolve();
    const error = await rejection(createSingleRequestHttpsFetch(options(origin.url, { beforeTransport() { return returned; }, observeRawFailure() {} }))(origin.url, { method: 'GET' }));
    expect(origin.requests()).toBe(0); expect(cause(error).primary).toBe(returned); expect(cause(error).unknown).toBe(true);
  });
  it('keeps the original Signal check after a registration callback aborts', async () => {
    const origin = await serve(), abort = new AbortController(); let physical: Promise<void> | undefined;
    const fetch = createSingleRequestHttpsFetch(options(origin.url, { beforeTransport() {}, observeRawFailure() {} }, { signal: abort.signal, trackPhysicalDrain: (value: Promise<void>) => { physical = value; abort.abort(); } }));
    await rejection(fetch(origin.url, { method: 'GET' })); await physical; expect(origin.requests()).toBe(0);
  });
  it('rejects Proxy/accessor/async/bound async hooks before any hook body or trap runs', async () => {
    const origin = await serve(); let calls = 0;
    const asyncHook = async () => { calls++; };
    function* generator() { calls++; }
    const bad = [new Proxy({}, { ownKeys() { calls++; return []; } }), { get beforeTransport() { calls++; return () => {}; }, observeRawFailure() {} },
      { beforeTransport: asyncHook, observeRawFailure() {} }, { beforeTransport: asyncHook.bind(null), observeRawFailure() {} },
      { beforeTransport: generator, observeRawFailure() {} }, { beforeTransport: generator.bind(null), observeRawFailure() {} },
      { beforeTransport: new Proxy(() => {}, { getPrototypeOf() { calls++; return Function.prototype; } }), observeRawFailure() {} }];
    for (const hooks of bad) expect(() => createSingleRequestHttpsFetch(options(origin.url, hooks))).toThrow('SEMANTIC_SINGLE_REQUEST_REJECTED');
    expect(calls).toBe(0); expect(origin.requests()).toBe(0);
  });
  it('never reads a late request.end accessor after the registration callback', async () => {
    const origin = await serve(); let getters = 0, physical: Promise<void> | undefined;
    const fetch = createSingleRequestHttpsFetch(options(origin.url, { beforeTransport() {}, observeRawFailure() {} }, {
      trackPhysicalDrain(value: Promise<void>) {
        physical = value;
        Object.defineProperty(nativeHandles.request!, 'end', { get() { getters++; throw Error('late native end getter'); } });
      },
    }));
    const raw = await rejection(fetch(origin.url, { method: 'GET' })); await physical;
    expect(cause(raw).unknown).toBe(true);
    expect(()=>readOriginalSingleRequestPhysicalReceipt(raw)).toThrow('SINGLE_REQUEST_PHYSICAL_UNCONFIRMED');
    expect(getters).toBe(0); expect(origin.requests()).toBe(0);
  });
  it('an observer that synchronously aborts preserves the original primary and drains once', async () => {
    const origin = await serve(), abort = new AbortController(), primary = { native: 'first' }; let calls = 0, physical: Promise<void> | undefined;
    const hooks = { beforeTransport() {}, observeRawFailure() { calls++; abort.abort(); } };
    const fetch = createSingleRequestHttpsFetch(options(origin.url, hooks, { signal: abort.signal, trackPhysicalDrain(value: Promise<void>) { physical = value; throw primary; } }));
    const raw = await rejection(fetch(origin.url, { method: 'GET' })); await physical;
    expect(cause(raw).primary).toBe(primary); expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThan(4); expect(origin.requests()).toBe(0);
  });
  it('the owned reader consumes the original body and close, and refuses unrelated Response instances', async () => {
    const origin = await serve(), hooks = { beforeTransport() {}, observeRawFailure() {} };
    const fetch = createSingleRequestHttpsFetch(options(origin.url, hooks));
    const response = await fetch(origin.url, { method: 'GET' });
    const reply = await readSingleRequestOwnedReply(fetch, response);
    expect(new TextDecoder().decode(reply.bytes)).toBe('ok'); expect(reply.ownUnknown).toBe(false);
    const physical=readOriginalSingleRequestPhysicalReceipt(reply);expect(physical).toMatchObject({kind:'single_request_physical_receipt_v1',destination:origin.url,method:'GET',requestBody:'',status:200});physical.assertKnown();expect(()=>readOriginalSingleRequestPhysicalReceipt({...reply})).toThrow();let getters=0;const forged=new Proxy({},{get(){getters++;throw Error('fake physical getter');}});expect(()=>readOriginalSingleRequestPhysicalReceipt(forged)).toThrow();expect(getters).toBe(0);
    await expect(readSingleRequestOwnedReply(fetch, new Response('forged'))).rejects.toThrow();
    const another = createSingleRequestHttpsFetch(options(origin.url, hooks));
    await expect(readSingleRequestOwnedReply(another, response)).rejects.toThrow();
  });
  it('extra response symbol tails are preserved without calling added accessors', async () => {
    const origin = await serve(), fetch = createSingleRequestHttpsFetch(options(origin.url, { beforeTransport() {}, observeRawFailure() {} }));
    const response = await fetch(origin.url, { method: 'GET' }), tail = Promise.resolve({ next: Promise.resolve() }); let calls = 0;
    Object.defineProperty(response, Symbol('sdk-tail'), { value: tail });
    Object.defineProperty(response, 'unsafe', { get() { calls++; return 42; } });
    const reply = await readSingleRequestOwnedReply(fetch, response);
    expect(reply.ownExtras).toContain(tail); expect(reply.ownUnknown).toBe(true); expect(calls).toBe(0);expect(()=>readOriginalSingleRequestPhysicalReceipt(reply)).toThrow('SINGLE_REQUEST_PHYSICAL_UNCONFIRMED');
  });
});
