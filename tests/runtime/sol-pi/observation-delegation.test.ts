import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';

import { createTransportLeaseIssuer } from '../../../src/runtime/sol-pi/transport-lease.js';

const destination = { provider: 'fixture', model: 'fixture', url: 'https://example.test/v1/messages' };
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'delegation-service-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  let time = 1000;
  const service = createObservationService({ profileRoot: root, profileId: 'fixture', now: () => time, redactor: { version: 'fixture', redact: text => text } });
  cleanups.push(() => service.dispose());
  const claims = { sessionId: 'parent', ownerAgentId: 'parent', scopeId: 'scope', permissionGeneration: 1, requestSource: 'user' as const, surface: 'ordinary-owner' as const };
  const parent = service.bindCaller(claims);
  const recipient = service.bindCaller({ ...claims, sessionId: 'child', ownerAgentId: 'child', requestSource: 'agent' });
  service.setArchivePolicy({ requestSource: 'user', caller: parent, policy: { version: 1, id: 'p', revision: 1, scopeId: 'scope', sourceAdapterId: 'fixture', sourceDescriptors: ['source'], expiresAt: 100000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: false, destinations: [destination] } });
  function capture(text = 'parent protected body') {
    const token = service.begin({ requestSource: 'user', caller: parent, invocationId: 'invocation', toolName: 'read', sourceAdapterId: 'fixture', sourceDescriptor: 'source' });
    service.append({ requestSource: 'user', caller: parent, capture: token, text });
    return service.finalize({ requestSource: 'user', caller: parent, capture: token, executionState: 'terminal', outcome: 'success' });
  }
  const ref = capture();
  const issue = (overrides = {}) => service.issueDelegation({ requestSource: 'user', caller: parent, recipient, observationIds: [ref.id], destination, expiresAt: 2000, ...overrides });
  const read = (caller: object, id = ref.id, target = destination) => service.read({ caller, id, destination: target, offset: 0, maxBytes: 64 });
  return { root, service, parent, recipient, claims, ref, issue, read, capture, setTime: (value: number) => { time = value; } };
}
describe('actual service delegated disclosure', () => {
  it('binds a host grant to one exact recipient and preserves immutable archive provenance', () => {
    const f = fixture();
    const before = readFileSync(join(f.root, 'observations', `${f.ref.id}.json`), 'utf8');
    expect(() => f.read(f.recipient)).toThrow();
    const capability = f.issue();
    const delegated = f.service.bindDelegatedCaller({ capability, recipient: f.recipient });
    const page = f.read(delegated);
    expect(page.content).toBe('parent protected body');
    f.service.transportPort.validate(page.dependencies, destination.url);
    expect(f.service.getReferenceMetadata(delegated, f.ref.id).sourceSessionId).toBe('parent');
    expect(readFileSync(join(f.root, 'observations', `${f.ref.id}.json`), 'utf8')).toBe(before);
    expect(() => f.read(f.recipient)).toThrow();
    expect(() => f.service.bindDelegatedCaller({ capability, recipient: f.recipient })).toThrow();
  });
  it('rejects forged capability, equivalent caller objects, and cross-service capabilities', () => {
    const f = fixture(); const other = fixture(); const cap = f.issue();
    const equivalent = f.service.bindCaller({ ...f.claims, sessionId: 'child', ownerAgentId: 'child', requestSource: 'agent' });
    expect(() => f.service.bindDelegatedCaller({ capability: {}, recipient: f.recipient })).toThrow();
    expect(() => f.service.bindDelegatedCaller({ capability: cap, recipient: equivalent })).toThrow();
    expect(() => other.service.bindDelegatedCaller({ capability: cap, recipient: other.recipient })).toThrow();
    expect(f.read(f.service.bindDelegatedCaller({ capability: cap, recipient: f.recipient })).content).toBeTruthy();
  });
  it('denies agent authorization, unlisted observations, destination drift, and mutation of the source', () => {
    const f = fixture(); const extra = f.capture('different source');
    expect(() => f.issue({ requestSource: 'agent' })).toThrow();
    expect(() => f.issue({ recipient: {} })).toThrow();
    expect(() => f.issue({ recipient: f.service.bindCaller(f.claims) })).toThrow();
    const delegated = f.service.bindDelegatedCaller({ capability: f.issue(), recipient: f.recipient });
    expect(() => f.read(delegated, extra.id)).toThrow();
    expect(() => f.read(delegated, f.ref.id, { ...destination, model: 'changed' })).toThrow();
    expect(() => f.service.clear({ requestSource: 'agent', caller: delegated, id: f.ref.id })).toThrow();
    expect(() => f.service.unpin({ requestSource: 'agent', caller: delegated, id: f.ref.id, referenceId: 'session:parent' })).toThrow();
  });
  it('pins only the actual delegated consumer without granting source deletion or unpin', () => {
    const f = fixture(); const caller = f.service.bindDelegatedCaller({ capability: f.issue(), recipient: f.recipient });
    expect(() => f.service.pin({ requestSource: 'agent', caller, id: f.ref.id, referenceId: 'session:parent' })).toThrow();
    f.service.pin({ requestSource: 'agent', caller, id: f.ref.id, referenceId: 'session:child' });
    const record = JSON.parse(readFileSync(join(f.root, 'observations', `${f.ref.id}.json`), 'utf8'));
    expect(record.pins).toEqual(['session:child']); expect(record.claims.sessionId).toBe('parent');
    expect(() => f.service.unpin({ requestSource: 'agent', caller, id: f.ref.id, referenceId: 'session:child' })).toThrow();
  });
  it('aborts a real transport attempt when the grant expires and never replays it', async () => {
    vi.useFakeTimers(); cleanups.push(() => vi.useRealTimers());
    const f = fixture(); const caller = f.service.bindDelegatedCaller({ capability: f.issue(), recipient: f.recipient });
    const page = f.read(caller); const issuer = createTransportLeaseIssuer(f.service.transportPort); cleanups.push(() => issuer.dispose());
    const capability = issuer.issue({ invocationId: 'request', destination: destination.url, serializedBody: '{}', dependencies: page.dependencies });
    let signal: AbortSignal | undefined;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => { signal = init.signal!; return new Response('ok'); });
    const request = { invocationId: 'request', input: destination.url, init: { method: 'POST', body: '{}' } };
    const attempt = issuer.dispatch(capability, request, fetch); await attempt.response;
    expect(signal?.aborted).toBe(false);
    f.setTime(2000); await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.aborted).toBe(true);
    expect(() => issuer.dispatch(capability, request, fetch)).toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
    attempt.finish();
  });
  it('bounds recursive redelegation by parent ids, destination, expiry and revocation', () => {
    const f = fixture();
    const childUser = f.service.bindCaller({ ...f.claims, sessionId: 'child', ownerAgentId: 'child' });
    const parentCap = f.issue({ recipient: childUser });
    const child = f.service.bindDelegatedCaller({ capability: parentCap, recipient: childUser });
    const grandchild = f.service.bindCaller({ ...f.claims, sessionId: 'grandchild', ownerAgentId: 'grandchild', requestSource: 'agent' });
    const input = { requestSource: 'user' as const, caller: child, recipient: grandchild, observationIds: [f.ref.id], destination, expiresAt: 1999 };
    expect(() => f.service.issueDelegation({ ...input, expiresAt: 2001 })).toThrow();
    expect(() => f.service.issueDelegation({ ...input, observationIds: [f.capture().id] })).toThrow();
    const cap = f.service.issueDelegation(input);
    const consumer = f.service.bindDelegatedCaller({ capability: cap, recipient: grandchild });
    expect(f.read(consumer).content).toContain('protected');
    f.service.revokeDelegation({ requestSource: 'user', caller: f.parent, capability: parentCap });
    expect(() => f.read(consumer)).toThrow();
  });
  it('enforces the maximum redelegation depth without widening source access', () => {
    const f = fixture(); let caller = f.parent;
    for (let depth = 1; depth <= 8; depth++) {
      const recipient = f.service.bindCaller({ ...f.claims, sessionId: `depth-${depth}`, ownerAgentId: `owner-${depth}` });
      const capability = f.service.issueDelegation({ requestSource: 'user', caller, recipient, observationIds: [f.ref.id], destination, expiresAt: 2000 });
      caller = f.service.bindDelegatedCaller({ capability, recipient });
      expect(f.read(caller).content).toContain('protected');
    }
    const recipient = f.service.bindCaller({ ...f.claims, sessionId: 'depth-9', ownerAgentId: 'owner-9' });
    expect(() => f.service.issueDelegation({ requestSource: 'user', caller, recipient, observationIds: [f.ref.id], destination, expiresAt: 2000 })).toThrow();
  });
  it.each(['parent', 'recipient', 'grant', 'expiry', 'revision'] as const)('denies stale read and actual transport after %s invalidation', cause => {
    const f = fixture(); const capability = f.issue();
    const delegated = f.service.bindDelegatedCaller({ capability, recipient: f.recipient });
    const page = f.read(delegated);
    if (cause === 'parent') f.service.revokeCaller({ requestSource: 'user', caller: f.parent, target: f.parent });
    if (cause === 'recipient') f.service.bindCaller({ ...f.claims, sessionId: 'child', ownerAgentId: 'child', permissionGeneration: 2 });
    if (cause === 'grant') f.service.revokeDelegation({ requestSource: 'user', caller: f.parent, capability });
    if (cause === 'expiry') f.setTime(2000);
    if (cause === 'revision') f.service.reviseTerminal({ requestSource: 'user', caller: f.parent, id: f.ref.id, outcome: 'error' });
    expect(() => f.read(delegated)).toThrow();
    expect(() => f.service.transportPort.validate(page.dependencies, destination.url)).toThrow();
  });
});
