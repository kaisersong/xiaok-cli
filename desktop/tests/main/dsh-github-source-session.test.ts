// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:https';
import { readFileSync } from 'node:fs';
import type { Duplex } from 'node:stream';
import * as sessions from '../../electron/dsh-github-source-session.js';
const network = vi.hoisted(() => ({ origin: '', attempts: 0 }));
vi.mock('node:https', async () => {
  const original = await vi.importActual<typeof import('node:https')>('node:https');
  const { readFileSync } = await import('node:fs');
  const cert = readFileSync(new URL('../../../tests/fixtures/sol-pi-tls/cert.pem', import.meta.url));
  return { ...original, request: (url: URL, options: object, callback: Parameters<typeof original.request>[2]) => {
    network.attempts++; if (!network.origin) throw Error('fixture network not installed');
    return original.request(new URL(url.pathname + url.search, network.origin), { ...options, ca: cert }, callback);
  } };
});
const scope = { profileId: 'profile', tenantId: 'tenant', workspaceId: 'workspace' };
const bound = { repositoryId: '123', nodeId: 'R_123', owner: 'octo', repo: 'demo' };
const actor = Object.freeze({ nativeActor: 'fixture-main-user' });
const cert = readFileSync(new URL('../../../tests/fixtures/sol-pi-tls/cert.pem', import.meta.url));
const key = readFileSync(new URL('../../../tests/fixtures/sol-pi-tls/key.pem', import.meta.url));
const running: { server: Server; sockets: Set<Duplex> }[] = [];
async function serve() {
  const paths: string[] = [], headers: unknown[] = [];
  const server = createServer({ cert, key }, (req, res) => {
    paths.push(req.url!); headers.push(req.headers.authorization); req.resume(); res.setHeader('content-type', 'application/json');
    if (req.url === '/user') res.end(JSON.stringify({ id: 12, node_id: 'U_12', login: 'person' }));
    else if (req.url === '/repos/octo/demo') res.end(JSON.stringify({ id: 123, node_id: 'R_123', name: 'demo', owner: { id: 13, login: 'octo' }, private: true }));
    else res.end('[]');
  });
  const sockets = new Set<Duplex>(); server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); running.push({ server, sockets });
  network.origin = `https://127.0.0.1:${(server.address() as { port: number }).port}`; return { paths, headers };
}
afterEach(async () => { network.origin = ''; network.attempts = 0; for (const { server, sockets } of running.splice(0)) { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } });
type Session = ReturnType<typeof sessions.createMainGithubSourceSession>;
const isolated = (authority: object) => (sessions as unknown as { __createIsolatedGithubSession(scope: object, authority: object): Session }).__createIsolatedGithubSession(scope, authority);
function authorityFixture() {
  let mode = 'observe', sequence = 0, settleFailurePresent = false, settleFailure: unknown; const measurements: unknown[] = [], bindings: unknown[] = [];
  const authority = {
    resolve(context: unknown) { if (context !== actor) throw Error('fixture native actor denied'); return { data: { ...scope, requestSource: 'user', mode, sourceBindingId: 'binding', configurationRevision: 1, credentialEpoch: 1, providerAccountId: '12', repository: bound }, assertCurrent() { if (mode === 'off') throw Error('fixture mode off'); } }; },
    reserve(_frame: object, input: unknown) { sequence++; return { attemptId: `read-${sequence}`, reservationRef: `meter-${sequence}`, maxResponseBytes: 1024 * 1024, timeoutMs: 2000 }; },
    settle(_attempt: object, measurement: unknown) { if (settleFailurePresent) throw settleFailure; measurements.push(measurement); },
    bind(_frame: object, value: unknown) { bindings.push(value); },
  };
  return { authority, measurements, bindings, off() { mode = 'off'; }, throwOnSettle(raw: unknown) { settleFailurePresent = true; settleFailure = raw; } };
}
describe('S1 Main GitHub session isolation (fixture authority is never production genuine)', () => {
  it('the fixed connection owner admits no callbacks and denies all operations before original handle binding',()=>{
    const create=(sessions as unknown as {createMainGithubSourceConnectionOwner(options:unknown):{getSession():Session;bindStore(store:unknown):void;sourceReadAuthoritySource:{resolve(proof:unknown,purpose:string):unknown}}}).createMainGithubSourceConnectionOwner;
    expect(typeof create).toBe('function');let calls=0;
    expect(()=>create({scope,realm:{},userSource:{},authorize(){calls++;}})).toThrow();
    const owner=create({scope,realm:{},userSource:{}});expect(()=>owner.getSession()).toThrow();expect(()=>owner.sourceReadAuthoritySource.resolve({},'source_read_scan')).toThrow();
    expect(()=>owner.bindStore(new Proxy({}, {get(){calls++;return undefined;}}))).toThrow();expect(calls).toBe(0);
  });
  it('the public constructor has no callback grant and performs zero HTTP without genuine A/read meter', async () => {
    const session = sessions.createMainGithubSourceSession(scope);
    await expect(session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor)).rejects.toThrow('DSH_GITHUB_SOURCE_NOT_READY');
    expect(network.attempts).toBe(0); expect(session.getStatus().state).toBe('unavailable'); await session.close();
  });
  it('the real private core owns credentials, performs user/repo GETs and settles each original attempt', async () => {
    const server = await serve(), fixture = authorityFixture(), session = isolated(fixture.authority);
    const result = await session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor);
    expect(result.state).toBe('connected'); expect(server.paths).toEqual(['/user', '/repos/octo/demo']);
    expect(server.headers).toEqual(['Bearer fixture-only', 'Bearer fixture-only']); expect(fixture.measurements).toHaveLength(2); expect(fixture.bindings).toHaveLength(1);
    const read = await session.read({ schemaVersion: 1, kind: 'issues', boundRepository: bound, page: 1, since: null, labelNames: [] }, actor);
    expect(read.page.kind).toBe('issues'); expect(read.page.completeness).toBe('complete'); expect(fixture.measurements).toHaveLength(3);
    expect(JSON.stringify(session.getStatus())).not.toContain('fixture-only'); await session.close();
  });
  it('the original read custody receipt preserves actual headers and rejects copies or another session', async () => {
    await serve(); const fixture = authorityFixture(), session = isolated(fixture.authority);
    await session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor);
    const result = await session.read({schemaVersion:1,kind:'events',boundRepository:bound,page:1},actor);
    const reader=(sessions as unknown as {readOriginalGithubSessionRead(session:unknown,result:unknown):{plan:{planHash:string};physical:string;meter:{kind:string};headers:{link:string|null}}}).readOriginalGithubSessionRead;
    try {
      expect(typeof reader).toBe('function');const receipt=reader(session,result);expect(receipt.plan.planHash).toBe(result.planHash);expect(receipt.physical).toBe('closed');expect(receipt.headers.link).toBe(null);expect(receipt.meter.kind).toBe('unqualified_callback_ack');
      expect(()=>reader(session,{...result})).toThrow();const other=isolated(fixture.authority);try{expect(()=>reader(other,result)).toThrow();}finally{await other.close();}
      let calls=0;expect(()=>reader(new Proxy({}, {get(){calls++;return undefined;}}),result)).toThrow();expect(calls).toBe(0);
    } finally {await session.close();}
  });
  it('a setup discovers actual provider/repository identity before a real bound read context exists',async()=>{
    const server=await serve(),fixture=authorityFixture(),setupContext={},boundContext={};let sawSetup=false;
    const bindingResolve=fixture.authority.resolve;
    fixture.authority.resolve=function(context:unknown){
      if(context===setupContext)return{data:{...scope,kind:'source_setup',requestSource:'user',mode:'observe',setupId:'native-setup',configurationRevision:1,candidateRepository:{owner:'octo',repo:'demo'}},assertCurrent(){}} as unknown as ReturnType<typeof bindingResolve>;
      if(context===boundContext)return bindingResolve.call(this,actor);throw Error('fixture proof denied');
    };
    fixture.authority.bind=(_frame:object,value:unknown)=>{expect(value).toMatchObject({providerAccountId:'12',repository:bound});sawSetup=true;return boundContext;};
    const session=isolated(fixture.authority);
    try{expect((await session.connect({operationId:'setup',secret:'fixture-only',expectedConfigurationRevision:1},setupContext)).state).toBe('connected');expect(sawSetup).toBe(true);expect(server.paths).toEqual(['/user','/repos/octo/demo']);expect(session.getStatus().repositoryId).toBe('123');}finally{await session.close();}
  });
  it('denies a copied actor or mode off before any credentialed HTTP', async () => {
    await serve(); const fixture = authorityFixture(), session = isolated(fixture.authority);
    await expect(session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, { ...actor })).rejects.toThrow();
    fixture.off(); await expect(session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor)).rejects.toThrow();
    expect(network.attempts).toBe(0); await session.close();
  });
  it('a Source callback that synchronously closes cannot escape the already registered operation root', async () => {
    await serve(); const fixture = authorityFixture(); let session: Session, closing: Promise<void> | undefined;
    const resolve = fixture.authority.resolve;
    fixture.authority.resolve = function (context: unknown) { closing = session.close(); return resolve.call(this, context); };
    session = isolated(fixture.authority);
    await expect(session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor)).rejects.toThrow();
    await closing; expect(network.attempts).toBe(0);
  });
  it('disconnected/restarted sessions cannot reuse the former credential or skip user intent', async () => {
    await serve(); const fixture = authorityFixture(), session = isolated(fixture.authority);
    await session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor);
    await session.disconnect(actor); const count = network.attempts;
    await expect(session.read({ schemaVersion: 1, kind: 'events', boundRepository: bound, page: 1 }, actor)).rejects.toThrow();
    expect(network.attempts).toBe(count); expect(session.getStatus().state).toBe('credential_required'); await session.close();
    const restarted = sessions.createMainGithubSourceSession(scope); expect(restarted.getStatus().state).toBe('unavailable'); await restarted.close();
  });
  it('cannot read or report connected before the original connection binding has settled', async () => {
    await serve(); const fixture = authorityFixture(); let release!: () => void, bindingReached = false;
    const pending = new Promise<void>(resolve => { release = resolve; });
    fixture.authority.bind = () => { bindingReached = true; return pending; };
    const session = isolated(fixture.authority), connecting = session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor);
    try {
      await vi.waitFor(() => expect(bindingReached).toBe(true));
      expect(session.getStatus().state).toBe('validating'); const calls = network.attempts;
      await expect(session.read({ schemaVersion: 1, kind: 'events', boundRepository: bound, page: 1 }, actor)).rejects.toThrow('DSH_GITHUB_CREDENTIAL_REQUIRED');
      expect(network.attempts).toBe(calls);
    } finally { release(); await connecting; await session.close(); }
  });
  it('a meter settlement rejection is sticky unknown and cannot authorize another read', async () => {
    await serve(); const fixture = authorityFixture(), session = isolated(fixture.authority), failure = Error('meter acknowledgement unknown');
    await session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor);
    fixture.throwOnSettle(failure);
    await expect(session.read({ schemaVersion: 1, kind: 'events', boundRepository: bound, page: 1 }, actor)).rejects.toBe(failure);
    const calls = network.attempts;
    try {
      expect(session.getStatus().state).toBe('unknown');
      await expect(session.read({ schemaVersion: 1, kind: 'events', boundRepository: bound, page: 1 }, actor)).rejects.toThrow();
      expect(network.attempts).toBe(calls);
    } finally { await session.close().catch(() => undefined); }
  });
  it.each(['timeout', 'extra', 'attempt'] as const)('an invalid reservation %s is retained unknown, never sent or guessed-settled', async invalid => {
    await serve(); const fixture = authorityFixture(); let finish!: () => void;
    const tail = new Promise<void>(resolve => { finish = resolve; });
    const raw = { attemptId: invalid === 'attempt' ? '' : 'seen-attempt', reservationRef: 'seen-ref',
      maxResponseBytes: 1024, timeoutMs: invalid === 'timeout' ? 0 : 2000,
      ...(invalid === 'extra' ? { extra: tail } : {}) };
    fixture.authority.reserve = () => raw;
    const session = isolated(fixture.authority);
    await session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor).catch(() => undefined);
    let closed = false; const closing = session.close().then(value => { closed = true; return value; }, error => { closed = true; return error; });
    try {
      await Promise.resolve(); await Promise.resolve(); expect(network.attempts).toBe(0); expect(fixture.measurements).toHaveLength(0);
      expect(session.getStatus().state).toBe('unknown'); if (invalid === 'extra') expect(closed).toBe(false);
    } finally { finish(); expect(await closing).toBe(raw); }
  });
  it.each(['reserve', 'settle', 'bind'] as const)('a %s raw then getter is never assimilated and known sibling tails remain held', async endpoint => {
    await serve(); const fixture = authorityFixture(); let getters = 0, finish!: () => void;
    const tail = new Promise<void>(resolve => { finish = resolve; });
    const raw = { get then() { getters++; return undefined; }, [Symbol('known-tail')]: tail };
    Object.defineProperty(fixture.authority, endpoint, { value() { return raw; }, configurable: true });
    const session = isolated(fixture.authority);
    await session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor).catch(() => undefined);
    let closed = false; const closing = session.close().then(() => { closed = true; }, () => { closed = true; });
    try { await Promise.resolve(); await Promise.resolve(); expect(getters).toBe(0); expect(session.getStatus().state).toBe('unknown'); expect(closed).toBe(false); }
    finally { finish(); await closing; }
  });
  it.each(['reserve', 'settle', 'bind'] as const)('a %s native Promise constructor getter is rejected without invocation', async endpoint => {
    await serve(); const fixture = authorityFixture(); let getters = 0, finish!: () => void;
    const tail = new Promise<void>(resolve => { finish = resolve; }), raw = Promise.resolve(undefined);
    Object.defineProperty(raw, 'constructor', { get() { getters++; return Promise; } });
    Object.defineProperty(raw, Symbol('known-tail'), { value: tail });
    Object.defineProperty(fixture.authority, endpoint, { value() { return raw; }, configurable: true });
    const session = isolated(fixture.authority);
    await session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor).catch(() => undefined);
    let closed = false; const closing = session.close().then(() => { closed = true; }, () => { closed = true; });
    try { await Promise.resolve(); await Promise.resolve(); expect(getters).toBe(0); expect(session.getStatus().state).toBe('unknown'); expect(closed).toBe(false); }
    finally { finish(); await closing; }
  });
  it.each(['reserve', 'settle', 'bind'] as const)('a %s Promise with changed native species is unconfirmed without invoking that getter', async endpoint => {
    await serve(); const fixture = authorityFixture(), original = Object.getOwnPropertyDescriptor(Promise, Symbol.species)!;
    let getters = 0; const raw = Promise.resolve(undefined);
    Object.defineProperty(fixture.authority, endpoint, { value() {
      Object.defineProperty(Promise, Symbol.species, { ...original, get() { getters++; return Promise; } });
      queueMicrotask(() => Object.defineProperty(Promise, Symbol.species, original));
      return raw;
    }, configurable: true });
    const session = isolated(fixture.authority);
    try {
      const connecting = session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor);
      if (endpoint === 'reserve') Object.defineProperty(Promise, Symbol.species, original);
      await connecting.catch(() => undefined);
      expect(getters).toBe(0); expect(session.getStatus().state).toBe('unknown');
    } finally { Object.defineProperty(Promise, Symbol.species, original); await session.close().catch(() => undefined); }
  });
  it.each(['resolve', 'current'] as const)('an observed %s authority loss cannot revive the old credential after recovery', async loss => {
    await serve(); const fixture = authorityFixture(); let revoked = false;
    const resolve = fixture.authority.resolve;
    fixture.authority.resolve = function (context: unknown) {
      if (revoked && loss === 'resolve') throw Error('fixture identity lost');
      const frame = resolve.call(this, context);
      return { ...frame, assertCurrent() { if (revoked) throw Error('fixture current lost'); frame.assertCurrent(); } };
    };
    const session = isolated(fixture.authority), plan = { schemaVersion: 1, kind: 'events', boundRepository: bound, page: 1 };
    await session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor);
    revoked = true; await expect(session.read(plan, actor)).rejects.toThrow(); revoked = false;
    const count = network.attempts;
    try { await expect(session.read(plan, actor)).rejects.toThrow(); expect(network.attempts).toBe(count); }
    finally { await session.close().catch(() => undefined); }
  });
  it('a malformed Source frame retains symbol and dynamic outcome tails before reporting unconfirmed', async () => {
    await serve(); const fixture = authorityFixture(); let finishParent!: (value: unknown) => void, finishChild!: () => void;
    const parentTail = new Promise<unknown>(resolve => { finishParent = resolve; }), childTail = new Promise<void>(resolve => { finishChild = resolve; });
    const resolve = fixture.authority.resolve;
    fixture.authority.resolve = function (context: unknown) { return { ...resolve.call(this, context), [Symbol('source-tail')]: parentTail }; };
    const session = isolated(fixture.authority);
    await expect(session.connect({ operationId: 'connect', secret: 'fixture-only', expectedConfigurationRevision: 1 }, actor)).rejects.toThrow();
    let closed = false; const closing = session.close().then(() => { closed = true; return undefined; }, error => { closed = true; return error; });
    try {
      finishParent({ [Symbol('child')]: childTail }); await Promise.resolve(); await Promise.resolve();
      expect(closed).toBe(false); expect(network.attempts).toBe(0);
      expect(session.getStatus().state).toBe('unknown');
    } finally { finishParent(undefined); finishChild(); await closing; }
  });
});
