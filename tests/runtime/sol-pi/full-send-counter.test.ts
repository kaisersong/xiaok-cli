import OpenAI from 'openai';
import { createProviderDisclosureContext, createProviderDisclosureFetch } from '../../../src/runtime/sol-pi/provider-disclosure.js';
import { createTransportLeaseIssuer } from '../../../src/runtime/sol-pi/transport-lease.js';
import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFullSendCounter } from '../../../src/runtime/sol-pi/full-send-counter.js';
import { writeFileAtomicallySync } from '../../../src/utils/atomic-file.js';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const done of cleanup.splice(0).reverse()) done(); });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'solpi-counter-')); cleanup.push(() => rmSync(root, { recursive: true, force: true })); return root; }
const call = { logicalInvocationId: 'logical', serializedBody: '{"model":"m"}', observationIds: ['observation', 'observation'] };
describe('host durable logical full sends', () => {
  it('does not read Object.prototype properties as known observations', () => {
    const counter = createFullSendCounter({ root: fixture(), sessionId: 'session' }); cleanup.push(() => counter.dispose());
    expect(counter.read('toString')).toBeNull(); expect(counter.read('valueOf')).toBeNull();
    counter.registerNewObservation('toString');
    const input = { logicalInvocationId: 'toString', observationIds: ['toString'], serializedBody: '{}' };
    counter.prepare(input); counter.confirm(input); expect(counter.read('toString')).toBe(1);
  });
  it.each(['resolved', 'rejected', 'value'])('rejects non-synchronous atomic writer result %s without dispatch', async kind => {
    let breakWriter = false;
    const counter = createFullSendCounter({ root: fixture(), sessionId: 'session', atomicWrite: (path, text, options) => {
      if (breakWriter) return (kind === 'resolved' ? Promise.resolve() : kind === 'rejected' ? Promise.reject(new Error('async writer rejected')) : 7) as never;
      writeFileAtomicallySync(path, text, options);
    } }); cleanup.push(() => counter.dispose());
    counter.registerNewObservation('observation'); const { context, destination } = transport(counter); breakWriter = true;
    const raw = vi.fn(async () => new Response(null));
    await expect(createProviderDisclosureFetch(context, raw)(destination, { method: 'POST', body: call.serializedBody })).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled(); expect(counter.read('observation')).toBeNull();
  });

  it('only new registration starts at zero, deduplicates retry and preserves count after clean restart', () => {
    const root = fixture(); let counter = createFullSendCounter({ root, sessionId: 'session' }); cleanup.push(() => counter.dispose());
    expect(counter.read('old-missing')).toBeNull(); counter.registerNewObservation('observation'); expect(counter.read('observation')).toBe(0);
    counter.prepare(call); counter.confirm(call); counter.prepare(call); counter.confirm(call); expect(counter.read('observation')).toBe(1);
    expect(() => counter.registerNewObservation('observation')).toThrow(); expect(() => counter.prepare({ ...call, serializedBody: 'different' })).toThrow();
    counter.dispose(); counter = createFullSendCounter({ root, sessionId: 'session' }); expect(counter.read('observation')).toBe(1);
  });
  it('reports a frozen whole-root reservation and refuses foreign files without deleting them', () => {
    const root = fixture(); const counter = createFullSendCounter({ root, sessionId: 'session' }); cleanup.push(() => counter.dispose());
    expect(counter.getStorageReservation()).toEqual({ root: realpathSync(root), sessionId: 'session', maximumBytes: 4 * 1024 * 1024 });
    expect(Object.isFrozen(counter.getStorageReservation())).toBe(true);
    writeFileSync(join(root, 'user-material.txt'), 'keep');
    expect(() => counter.registerNewObservation('observation')).toThrow();
    expect(() => counter.dispose()).not.toThrow();
    expect(() => createFullSendCounter({ root, sessionId: 'session' })).toThrow();
    expect(readFileSync(join(root, 'user-material.txt'), 'utf8')).toBe('keep');
  });
  it('rejects oversized root and orphan atomic remnants before adding any files', () => {
    const root = fixture(); writeFileSync(join(root, '.full-send.json.orphan.tmp'), Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(() => createFullSendCounter({ root, sessionId: 'session' })).toThrow();
    expect(readdirSync(root)).toEqual(['.full-send.json.orphan.tmp']);
    unlinkSync(join(root, '.full-send.json.orphan.tmp'));
    writeFileSync(join(root, 'owner.sqlite-journal'), Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(() => createFullSendCounter({ root, sessionId: 'session' })).toThrow('QUOTA');
    expect(readdirSync(root)).toEqual(['owner.sqlite-journal']);
  });
  it('unknown after failed response stays unknown after retry receives 2xx', () => {
    const counter = createFullSendCounter({ root: fixture(), sessionId: 'session' }); cleanup.push(() => counter.dispose());
    counter.registerNewObservation('observation'); counter.prepare(call); counter.markUnknown(call); counter.prepare(call); counter.confirm(call);
    expect(counter.read('observation')).toBeNull();
  });
  it('post-write commit failure and restart cannot recover an uncertain count as known', () => {
    const root = fixture(); let fail = false;
    const counter = createFullSendCounter({ root, sessionId: 'session', atomicWrite: (path, text, options) => { writeFileAtomicallySync(path, text, options); if (fail) throw new Error('after disk write'); } });
    counter.registerNewObservation('observation'); counter.prepare(call); fail = true;
    expect(() => counter.confirm(call)).toThrow(); expect(counter.read('observation')).toBeNull(); counter.dispose();
    const recovered = createFullSendCounter({ root, sessionId: 'session' }); cleanup.push(() => recovered.dispose()); expect(recovered.read('observation')).toBeNull();
  });
  function transport(counter: ReturnType<typeof createFullSendCounter>) {
    const authority = {}; const issuer = createTransportLeaseIssuer({ authority, withAdmission: op => op(), validate() {}, onRevoke: () => () => {} }); cleanup.push(() => issuer.dispose());
    const destination = 'https://provider.example/v1/chat/completions';
    const context = createProviderDisclosureContext({ issuer, invocationId: 'logical', destination, model: 'm', capacityProfile: testOnlyCapacity(destination, 'm'),
      dependencies: [{ authority, key: 'observation', epoch: 1 }], fullSend: { counter, observationIds: ['observation', 'observation'] } });
    return { context, destination, issuer };
  }
  it('counts actual transport 2xx submission once across identical attempts', async () => {
    const counter = createFullSendCounter({ root: fixture(), sessionId: 'session' }); cleanup.push(() => counter.dispose()); counter.registerNewObservation('observation');
    const { context, destination } = transport(counter); const raw = vi.fn(async () => new Response(null, { status: 200 }));
    const fetch = createProviderDisclosureFetch(context, raw); const request = { method: 'POST', body: call.serializedBody };
    await fetch(destination, request); await fetch(destination, request); expect(raw).toHaveBeenCalledTimes(2); expect(counter.read('observation')).toBe(1);
  });
  it('real OpenAI SDK retry after 500 stays unknown even when the retry receives 2xx', async () => {
    const counter = createFullSendCounter({ root: fixture(), sessionId: 'session' }); cleanup.push(() => counter.dispose()); counter.registerNewObservation('observation');
    const { context } = transport(counter); let calls = 0;
    const raw = vi.fn(async () => ++calls === 1 ? new Response(JSON.stringify({ error: { message: 'retry', type: 'server_error' } }), { status: 500, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ id: 'completion', choices: [], model: 'm' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new OpenAI({ apiKey: 'test', baseURL: 'https://provider.example/v1', maxRetries: 1, fetch: createProviderDisclosureFetch(context, raw) });
    await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(raw).toHaveBeenCalledTimes(2); expect(counter.read('observation')).toBeNull();
  });
  it('failed counter prepare prevents the actual fetch', async () => {
    let fail = false;
    const counter = createFullSendCounter({ root: fixture(), sessionId: 'session', atomicWrite: (path, text, options) => { if (fail) throw new Error('prepare disk failure'); writeFileAtomicallySync(path, text, options); } }); cleanup.push(() => counter.dispose());
    counter.registerNewObservation('observation'); const { context, destination } = transport(counter); fail = true;
    const raw = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(createProviderDisclosureFetch(context, raw)(destination, { method: 'POST', body: call.serializedBody })).rejects.toThrow(); expect(raw).not.toHaveBeenCalled();
  });
  it('revalidates lease after durable preparation before any raw fetch', async () => {
    let afterWrite = () => {};
    const counter = createFullSendCounter({ root: fixture(), sessionId: 'session', atomicWrite: (path, text, options) => { writeFileAtomicallySync(path, text, options); afterWrite(); } }); cleanup.push(() => counter.dispose());
    counter.registerNewObservation('observation'); const { context, destination, issuer } = transport(counter);
    afterWrite = () => issuer.dispose(); const raw = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(createProviderDisclosureFetch(context, raw)(destination, { method: 'POST', body: call.serializedBody })).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled(); expect(counter.read('observation')).toBeNull();
  });
  it('pending restart becomes permanently unknown and concurrent owners cannot open', () => {
    const root = fixture(); let counter = createFullSendCounter({ root, sessionId: 'session' }); cleanup.push(() => counter.dispose());
    counter.registerNewObservation('observation'); counter.prepare(call);
    expect(() => createFullSendCounter({ root, sessionId: 'session' })).toThrow('OWNER_ACTIVE');
    counter.dispose(); counter = createFullSendCounter({ root, sessionId: 'session' }); counter.confirm(call);
    expect(counter.read('observation')).toBeNull();
  });
  it('missing or corrupt persisted ledger never reinitializes old observations as zero', () => {
    const root = fixture(); const counter = createFullSendCounter({ root, sessionId: 'session' }); counter.registerNewObservation('observation'); counter.dispose();
    unlinkSync(join(root, 'full-send.json')); expect(() => createFullSendCounter({ root, sessionId: 'session' })).toThrow('LEDGER_MISSING');
    writeFileSync(join(root, 'full-send.json'), '{broken'); expect(() => createFullSendCounter({ root, sessionId: 'session' })).toThrow();
  });
  it('enforces recovered observation quota and per-request bounds before dispatch', () => {
    const root = fixture();
    writeFileSync(join(root, 'full-send.json'), JSON.stringify({ version: 1, sessionId: 'session', clean: true,
      observations: Object.fromEntries(Array.from({ length: 1024 }, (_, index) => [`obs-${index}`, 0])), invocations: {} }));
    const counter = createFullSendCounter({ root, sessionId: 'session' }); cleanup.push(() => counter.dispose());
    expect(() => counter.registerNewObservation('overflow')).toThrow('QUOTA');
    expect(() => counter.prepare({ ...call, observationIds: ['missing'] })).toThrow('QUOTA');
    expect(() => counter.prepare({ ...call, observationIds: Array.from({ length: 129 }, (_, index) => `obs-${index}`) })).toThrow('INVALID_BINDING');
    expect(counter.read('obs-0')).toBe(0);
  });
  it('rejects a changed full ID set for the same logical invocation and saturates at two', () => {
    const counter = createFullSendCounter({ root: fixture(), sessionId: 'session' }); cleanup.push(() => counter.dispose()); counter.registerNewObservation('observation');
    for (let index = 0; index < 3; index++) { const input = { ...call, logicalInvocationId: `logical-${index}` }; counter.prepare(input); counter.confirm(input); }
    expect(counter.read('observation')).toBe(2);
    expect(() => counter.prepare({ ...call, logicalInvocationId: 'logical-0', observationIds: ['other'] })).toThrow('INVOCATION_REBOUND');
  });
  it('actual fetch network failure and post-dispatch counter commit failure stay unknown on restart', async () => {
    const root = fixture(); let writes = 0;
    const counter = createFullSendCounter({ root, sessionId: 'session', atomicWrite: (path, text, options) => { writeFileAtomicallySync(path, text, options); if (++writes === 4) throw new Error('commit disk failure'); } });
    counter.registerNewObservation('observation'); const { context, destination } = transport(counter);
    const raw = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(createProviderDisclosureFetch(context, raw)(destination, { method: 'POST', body: call.serializedBody })).rejects.toThrow(/AUTHORIZATION/);
    expect(raw).toHaveBeenCalledTimes(1); expect(counter.read('observation')).toBeNull(); counter.dispose();
    const recovered = createFullSendCounter({ root, sessionId: 'session' }); cleanup.push(() => recovered.dispose()); expect(recovered.read('observation')).toBeNull();
    const transport2 = transport(recovered);
    await expect(createProviderDisclosureFetch(transport2.context, async () => { throw new Error('network'); })(destination, { method: 'POST', body: call.serializedBody })).rejects.toThrow('network');
    expect(recovered.read('observation')).toBeNull();
  });

});
