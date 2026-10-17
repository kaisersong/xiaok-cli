import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';
import { createTransportLeaseIssuer } from '../../../src/runtime/sol-pi/transport-lease.js';

const destination = { provider: 'test-provider', model: 'test-model', url: 'https://example.test/v1/messages' };
function diskText(root: string): string {
  return readdirSync(root).map(name => { const path = join(root, name); return statSync(path).isDirectory() ? diskText(path) : readFileSync(path).toString('utf8'); }).join('\n');
}
describe('P1-A host observation service production contract', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
  function fixture(options: { reservedProfileBytes?: number; localOnly?: boolean; authorized?: boolean; surface?: 'ordinary-owner' | 'room' | 'restricted' | 'multi-authority'; limits?: { recordBytes?: number; collectorBytes?: number; sessionBytes?: number; profileBytes?: number } } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-observation-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    let time = 1000;
    const redact = vi.fn((text: string) => text.replaceAll('KNOWN_SECRET', '[redacted]'));
    const service = createObservationService({ profileRoot: root, profileId: 'profile', now: () => time, redactor: { version: 'test-v1', redact }, limits: options.limits, reservedProfileBytes: options.reservedProfileBytes });
    cleanup.push(() => service.dispose());
    const claims = { sessionId: 'session', ownerAgentId: 'owner', scopeId: 'scope', permissionGeneration: 1, requestSource: 'agent' as const, surface: options.surface ?? 'ordinary-owner' };
    const caller = service.bindCaller(claims);
    const user = service.bindCaller({ ...claims, requestSource: 'user' });
    const policy = { version: 1 as const, id: 'policy', revision: 1, scopeId: 'scope', sourceAdapterId: 'test-source', sourceDescriptors: ['source'], expiresAt: 10000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: true, destinations: options.localOnly ? [] : [destination] };
    if (options.authorized !== false) service.setArchivePolicy({ requestSource: 'user', caller: user, policy });
    function capture(text: string, facts: { executionState: 'terminal' | 'termination_pending'; outcome?: 'success' | 'error' | 'timeout'; incompleteReason?: string } = { executionState: 'terminal', outcome: 'success' }) {
      const capture = service.begin({ requestSource: 'agent', caller, invocationId: 'invocation', toolName: 'bash', sourceAdapterId: 'test-source', sourceDescriptor: 'source' });
      service.append({ requestSource: 'agent', caller, capture, text });
      return service.finalize({ requestSource: 'agent', caller, capture, ...facts });
    }
    return { root, service, caller, user, claims, policy, capture, redact, setTime(value: number) { time = value; } };
  }
  it.each(['budget', 'cancelled', 'timeout', 'termination_pending', 'collector_unavailable'] as const)('does not archive a known secret prefix from incomplete %s capture even with user incomplete consent', reason => {
    const f = fixture({ limits: { recordBytes: 6 } });
    const capture = f.service.begin({ requestSource: 'agent', caller: f.caller, invocationId: 'partial-secret', toolName: 'bash', sourceAdapterId: 'test-source', sourceDescriptor: 'source' });
    f.service.append({ requestSource: 'agent', caller: f.caller, capture, text: 'KNOWN_' });
    if (reason === 'budget') f.service.append({ requestSource: 'agent', caller: f.caller, capture, text: 'SECRET' });
    const ref = f.service.finalize({ requestSource: 'agent', caller: f.caller, capture,
      executionState: reason === 'termination_pending' ? 'termination_pending' : 'terminal',
      ...(reason === 'termination_pending' ? {} : { outcome: reason === 'cancelled' || reason === 'timeout' ? reason : 'success' }),
      ...(reason === 'collector_unavailable' ? { incompleteReason: reason } : {}) });
    expect(ref.complete).toBe(false); expect(ref.contentHash).toBe(''); expect(ref.byteLength).toBe(0);
    expect(ref.executionState).toBe(reason === 'termination_pending' ? 'termination_pending' : 'terminal');
    expect(f.redact).not.toHaveBeenCalled(); expect(diskText(f.root)).not.toContain('KNOWN_');
    expect(readdirSync(join(f.root, 'observations'))).not.toContain(`${ref.id}.body`);
    expect(() => f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
  });
  it.each(['timeout', 'cancelled', 'termination_pending'] as const)('derives incomplete %s facts before an empty caller reason', state => {
    const f = fixture(); const capture = f.service.begin({ requestSource: 'agent', caller: f.caller, invocationId: 'empty-reason', toolName: 'bash', sourceAdapterId: 'test-source', sourceDescriptor: 'source' });
    f.service.append({ requestSource: 'agent', caller: f.caller, capture, text: 'KNOWN_' });
    const ref = f.service.finalize({ requestSource: 'agent', caller: f.caller, capture, executionState: state === 'termination_pending' ? state : 'terminal', ...(state === 'termination_pending' ? {} : { outcome: state }), incompleteReason: '' });
    expect(ref.complete).toBe(false); expect(ref.byteLength).toBe(0); expect(ref.contentHash).toBe('');
    expect(ref.incompleteReason).toBe(state === 'termination_pending' ? 'termination_unconfirmed' : state);
    expect(f.redact).not.toHaveBeenCalled(); expect(diskText(f.root)).not.toContain('KNOWN_');
    expect(() => f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
  });
  it.each(['', ' ', 'unknown_reason', 'x'.repeat(4097), null, false, 0, {}])('rejects malformed caller reason from disclosure: %j', reason => {
    const f = fixture(); const ref = f.capture('KNOWN_', { executionState: 'terminal', outcome: 'success', incompleteReason: reason as string });
    expect(ref.complete).toBe(false); expect(ref.byteLength).toBe(0); expect(ref.contentHash).toBe('');
    expect(ref.incompleteReason).toBe('invalid_incomplete_reason');
    expect(ref.outcome).toBe('success'); expect(f.redact).not.toHaveBeenCalled(); expect(diskText(f.root)).not.toContain('KNOWN_');
  });
  it('classifies unique-dependency quota without evicting existing protected references', () => {
    const f = fixture(); const ref = f.capture('page');
    const args = { caller: f.caller, id: ref.id, offset: 0, maxBytes: 4, destination };
    const original = f.service.read(args);
    for (let i = 1; i < 4096; i++) f.service.read({ ...args, caller: f.service.bindCaller(f.claims) });
    try { f.service.read({ ...args, caller: f.service.bindCaller(f.claims) }); throw new Error('expected quota refusal'); }
    catch (error) { expect(error).toMatchObject({ code: 'observation_dependency_budget_exceeded', recovery: 'fresh-task', retryable: false }); }
    expect(f.service.read(args).dependencies).toEqual(original.dependencies);
    f.service.transportPort.validate(original.dependencies, destination.url);
  });
  it('reuses a current caller/ref/destination dependency across pages and invalidates it on policy change', () => {
    const f = fixture(); const ref = f.capture('paged');
    const first = f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination }).dependencies;
    for (let i = 0; i < 4100; i++) expect(f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination }).dependencies).toEqual(first);
    f.service.setArchivePolicy({ requestSource: 'user', caller: f.user, policy: { ...f.policy, revision: 2 } });
    expect(() => f.service.transportPort.validate(first, destination.url)).toThrow();
  });
  it('deducts reservation from the configured profile limit and rejects an exhausted budget', () => {
    const f = fixture({ limits: { profileBytes: 8 * 1024 * 1024 }, reservedProfileBytes: 4 * 1024 * 1024 });
    expect(f.service.getStorageBudget().profileBytes).toBe(4 * 1024 * 1024);
    expect(() => fixture({ limits: { profileBytes: 4 }, reservedProfileBytes: 4 })).toThrow('invalid_limit');
    expect(() => fixture({ limits: { profileBytes: 4 }, reservedProfileBytes: 5 })).toThrow('invalid_limit');
  });
  it('reserves actual profile capacity for a separate bounded host ledger', () => {
    const f = fixture({ reservedProfileBytes: 4 * 1024 * 1024 });
    const budget = f.service.getStorageBudget();
    expect(budget.reservedBytes).toBe(4 * 1024 * 1024);
    expect(budget.profileBytes + budget.reservedBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(budget.profileRoot).toMatch(/xiaok-observation-/);
    expect(Object.isFrozen(budget)).toBe(true);
  });
  it('default denies unclassified secret bytes without buffering for redaction or writing any body', () => {
    const f = fixture({ authorized: false }); const secret = 'unmarked-random-sensitive-tail-48f177c0';
    const ref = f.capture(secret);
    expect(ref.complete).toBe(false); expect(ref.incompleteReason).toBe('archive_policy_denied');
    expect(f.redact).not.toHaveBeenCalled(); expect(diskText(f.root)).not.toContain(secret);
    expect(() => f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
  });
  it('local persistence alone does not authorize model disclosure', () => {
    const f = fixture({ localOnly: true }); const ref = f.capture('local only');
    expect(ref.complete).toBe(true);
    expect(() => f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
  });
  it('hashes immutable redacted UTF8 bytes and advances pages only on byte boundaries', () => {
    const f = fixture(); const ref = f.capture('a😀中KNOWN_SECRET');
    expect(ref.contentHash).toBe(createHash('sha256').update('a😀中[redacted]').digest('hex'));
    const first = f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 4, destination });
    expect(first.content).toBe('a'); expect(first.nextOffset).toBe(1);
    const second = f.service.read({ caller: f.caller, id: ref.id, offset: first.nextOffset, maxBytes: 4, destination });
    expect(second.content).toBe('😀'); expect(second.nextOffset).toBe(5);
    expect(() => f.service.read({ caller: f.caller, id: ref.id, offset: 2, maxBytes: 4, destination })).toThrow();
    for (const maxBytes of [3, 65537, 4.5]) expect(() => f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes, destination })).toThrow();
  });
  it('refuses forged caller, another owner and a changed model for the same URL', () => {
    const f = fixture(); const ref = f.capture('authorized');
    const other = f.service.bindCaller({ ...f.claims, ownerAgentId: 'other' });
    for (const caller of [{ ...f.claims }, other]) expect(() => f.service.read({ caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
    expect(() => f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination: { ...destination, model: 'other' } })).toThrow();
  });
  it.each(['room', 'restricted', 'multi-authority'] as const)('never expands model disclosure for %s', surface => {
    const f = fixture({ surface, authorized: false });
    expect(() => f.service.begin({ requestSource: 'agent', caller: f.caller, invocationId: 'invocation', toolName: 'bash', sourceAdapterId: 'test-source', sourceDescriptor: 'source' })).toThrow(/not.ready|unsupported/i);
  });
  it('rechecks expiry and policy revocation on subsequent pages', () => {
    const f = fixture(); const ref = f.capture('allowed');
    const read = () => f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination });
    expect(read().content).toBe('allowed'); f.setTime(10000); expect(read).toThrow();
    f.setTime(1000); f.service.revokePolicy({ requestSource: 'user', caller: f.user, policyId: 'policy' }); expect(read).toThrow();
  });
  it('clear is user-only and tombstone invalidates a previously read transport dependency', () => {
    const f = fixture(); const ref = f.capture('authorized');
    const page = f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination });
    expect(() => f.service.clear({ requestSource: 'agent', caller: f.caller, id: ref.id })).toThrow();
    const issuer = createTransportLeaseIssuer(f.service.transportPort); cleanup.push(() => issuer.dispose());
    const body = JSON.stringify({ model: destination.model, content: page.content });
    const capability = issuer.issue({ invocationId: 'request', destination: destination.url, serializedBody: body, dependencies: page.dependencies });
    f.service.clear({ requestSource: 'user', caller: f.user, id: ref.id });
    const fetch = vi.fn(async () => new Response('ok'));
    expect(() => issuer.dispatch(capability, { invocationId: 'request', input: destination.url, init: { method: 'POST', body } }, fetch)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps capture completeness separate from execution success and unknown termination', () => {
    const f = fixture(); const error = f.capture('complete error log', { executionState: 'terminal', outcome: 'error' });
    expect(error.complete).toBe(true); expect(error.outcome).toBe('error');
    const pending = f.capture('partial log', { executionState: 'termination_pending', incompleteReason: 'termination_unconfirmed' });
    expect(pending.complete).toBe(false); expect(pending.outcome).toBeUndefined();
  });
  it('enforces 16MiB observation collection bound without cancelling the command', () => {
    const f = fixture(); const ref = f.capture('x'.repeat(16 * 1024 * 1024 + 1));
    expect(ref.complete).toBe(false); expect(ref.incompleteReason).toBe('output_budget_exceeded');
    expect(ref.byteLength).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
  it('rejects forged requestSource and a source not covered by the host policy', () => {
    const f = fixture();
    expect(() => f.service.clear({ requestSource: 'user', caller: f.caller, id: 'arbitrary' })).toThrow();
    const capture = f.service.begin({ requestSource: 'agent', caller: f.caller, invocationId: 'other', toolName: 'bash', sourceAdapterId: 'test-source', sourceDescriptor: 'unapproved source' });
    f.service.append({ requestSource: 'agent', caller: f.caller, capture, text: 'SOURCE_SECRET' });
    const ref = f.service.finalize({ requestSource: 'agent', caller: f.caller, capture, executionState: 'terminal', outcome: 'success' });
    expect(ref.incompleteReason).toBe('archive_policy_denied'); expect(diskText(f.root)).not.toContain('SOURCE_SECRET');
  });
  it('denies a second live owner of the same profile directory', () => {
    const f = fixture();
    expect(() => createObservationService({ profileRoot: f.root, profileId: 'profile', redactor: { version: 'test-v1', redact: (text: string) => text } })).toThrow();
  });

  it('reopens immutable records only after fresh host authorization and reconciles unpublished fragments', () => {
    const f = fixture(); const ref = f.capture('durable');
    f.service.begin({ requestSource: 'agent', caller: f.caller, invocationId: 'unfinished', toolName: 'bash', sourceAdapterId: 'test-source', sourceDescriptor: 'source' });
    f.service.dispose();
    const orphan = join(f.root, 'observations', '00000000-0000-4000-8000-000000000000.body');
    const partial = join(f.root, 'observations', 'partial.tmp'); writeFileSync(orphan, 'orphan'); writeFileSync(partial, 'partial');
    const next = createObservationService({ profileRoot: f.root, profileId: 'profile', now: () => 1000, redactor: { version: 'test-v1', redact: (text: string) => text } }); cleanup.push(() => next.dispose());
    const caller = next.bindCaller(f.claims); const user = next.bindCaller({ ...f.claims, requestSource: 'user' });
    expect(() => next.read({ caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
    next.setArchivePolicy({ requestSource: 'user', caller: user, policy: f.policy });
    expect(next.read({ caller, id: ref.id, offset: 0, maxBytes: 64, destination }).content).toBe('durable');
    expect(readdirSync(join(f.root, 'observations'))).not.toContain('partial.tmp');
    expect(readdirSync(join(f.root, 'observations'))).not.toContain('00000000-0000-4000-8000-000000000000.body');
    const indexes = readdirSync(join(f.root, 'observations')).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => JSON.parse(readFileSync(join(f.root, 'observations', name), 'utf8')));
    expect(indexes.find(entry => entry.ref.invocationId === 'unfinished').ref.executionState).toBe('interrupted');
  });
  it('marks missing persisted bodies unavailable on restart without re-executing a tool', () => {
    const f = fixture(); const ref = f.capture('missing'); f.service.dispose(); unlinkSync(join(f.root, 'observations', `${ref.id}.body`));
    const next = createObservationService({ profileRoot: f.root, profileId: 'profile', now: () => 1000, redactor: { version: 'test-v1', redact: (text: string) => text } }); cleanup.push(() => next.dispose());
    const caller = next.bindCaller(f.claims); const user = next.bindCaller({ ...f.claims, requestSource: 'user' }); next.setArchivePolicy({ requestSource: 'user', caller: user, policy: f.policy });
    expect(() => next.read({ caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
  });
  it('fails closed on a real disk commit failure and never publishes the partial body', () => {
    const f = fixture(); const capture = f.service.begin({ requestSource: 'agent', caller: f.caller, invocationId: 'diskfailure', toolName: 'bash', sourceAdapterId: 'test-source', sourceDescriptor: 'source' });
    f.service.append({ requestSource: 'agent', caller: f.caller, capture, text: 'body' });
    const name = readdirSync(join(f.root, 'observations')).find(name => /^[a-f0-9-]{36}\.json$/.test(name))!; const id = name.slice(0, -5);
    mkdirSync(join(f.root, 'observations', `${id}.body`));
    expect(() => f.service.finalize({ requestSource: 'agent', caller: f.caller, capture, executionState: 'terminal', outcome: 'success' })).toThrow();
    expect(() => f.service.read({ caller: f.caller, id, offset: 0, maxBytes: 64, destination })).toThrow();
  });
  it('preserves active evidence at a lowered hard quota instead of evicting it', () => {
    const f = fixture({ limits: { sessionBytes: 40000, profileBytes: 50000 } });
    const ref = f.capture('x'.repeat(10000));
    expect(ref.complete).toBe(true);
    expect(() => f.capture('new')).toThrow(/quota/);
    expect(f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination }).content).toBe('x'.repeat(64));
  });
  it('retains referenced ended evidence while removing unreferenced evidence older than seven days', () => {
    const f = fixture(); const pinned = f.capture('pinned'); const expired = f.capture('expired');
    f.service.pin({ requestSource: 'agent', caller: f.caller, id: pinned.id, referenceId: 'message' });
    f.service.endSession({ requestSource: 'agent', caller: f.caller }); f.setTime(8 * 86400000);
    f.service.endSession({ requestSource: 'agent', caller: f.caller });
    expect(readdirSync(join(f.root, 'observations'))).toContain(`${pinned.id}.body`);
    expect(readdirSync(join(f.root, 'observations'))).not.toContain(`${expired.id}.body`);
  });
  it('terminal revision invalidates prior transport dependencies without rewriting body bytes', () => {
    // Partial bodies are metadata-only in v1; use a complete capture to test revision invalidation.
    const f = fixture(); const ref = f.capture('complete capture');
    const page = f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination });
    const revised = f.service.reviseTerminal({ requestSource: 'agent', caller: f.caller, id: ref.id, outcome: 'timeout' });
    expect(revised.complete).toBe(false); expect(revised.contentHash).toBe(ref.contentHash); expect(revised.revision).toBeGreaterThan(ref.revision);
    expect(() => f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow('observation_unavailable');
    expect(() => f.service.transportPort.validate(page.dependencies, destination.url)).toThrow();
  });

  it('recovers a SIGKILLed owner using the OS lock without replay or publishing buffered bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-observation-crash-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const moduleUrl = pathToFileURL(resolve('src/runtime/sol-pi/observation-service.ts')).href;
    const script = `import {createObservationService} from ${JSON.stringify(moduleUrl)};
      const s=createObservationService({profileRoot:${JSON.stringify(root)},profileId:'profile',redactor:{version:'test-v1',redact:t=>t}});
      const c=s.bindCaller({sessionId:'s',ownerAgentId:'o',scopeId:'scope',permissionGeneration:1,requestSource:'agent',surface:'ordinary-owner'});
      s.begin({requestSource:'agent',caller:c,invocationId:'crashed',toolName:'bash',sourceAdapterId:'source',sourceDescriptor:'command'});
      process.kill(process.pid,'SIGKILL');`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { timeout: 10000, encoding: 'utf8' });
    expect(child.signal).toBe('SIGKILL');
    const next = createObservationService({ profileRoot: root, profileId: 'profile', redactor: { version: 'test-v1', redact: (text: string) => text } }); cleanup.push(() => next.dispose());
    const index = readdirSync(join(root, 'observations')).find(name => /^[a-f0-9-]{36}\.json$/.test(name))!;
    const ref = JSON.parse(readFileSync(join(root, 'observations', index), 'utf8')).ref;
    expect(ref.executionState).toBe('interrupted'); expect(ref.complete).toBe(false); expect(ref.contentHash).toBe('');
  });
  it('persists authority identity and prevents a revoked policy revision from reappearing after restart', () => {
    const f = fixture(); const ref = f.capture('authorized'); const metadata = f.service.getReferenceMetadata(f.caller, ref.id);
    f.service.revokePolicy({ requestSource: 'user', caller: f.user, policyId: f.policy.id }); f.service.dispose();
    const next = createObservationService({ profileRoot: f.root, profileId: 'profile', now: () => 1000, redactor: { version: 'test-v1', redact: (text: string) => text } }); cleanup.push(() => next.dispose());
    expect(next.authorityId).toBe(metadata.authorityId);
    const user = next.bindCaller({ ...f.claims, requestSource: 'user' });
    expect(() => next.setArchivePolicy({ requestSource: 'user', caller: user, policy: f.policy })).toThrow(/stale/);
  });

  it('never accepts agent credentials for policy mutation and rejects an old scope generation', () => {
    const f = fixture(); const ref = f.capture('authorized');
    expect(() => f.service.setArchivePolicy({ requestSource: 'user', caller: f.caller, policy: { ...f.policy, revision: 2 } })).toThrow();
    f.service.bindCaller({ ...f.claims, permissionGeneration: 2 });
    expect(() => f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
    expect(() => f.service.bindCaller(f.claims)).toThrow(/stale/);
  });
  it('bounds simultaneous collectors and never archives incomplete bytes without explicit incomplete permission', () => {
    const f = fixture({ limits: { recordBytes: 8, collectorBytes: 10 } });
    f.service.setArchivePolicy({ requestSource: 'user', caller: f.user, policy: { ...f.policy, revision: 2, allowIncomplete: false } });
    const start = () => f.service.begin({ requestSource: 'agent', caller: f.caller, invocationId: 'bounded', toolName: 'bash', sourceAdapterId: 'test-source', sourceDescriptor: 'source' });
    const first = start(); const second = start();
    f.service.append({ requestSource: 'agent', caller: f.caller, capture: first, text: '12345678' });
    f.service.append({ requestSource: 'agent', caller: f.caller, capture: second, text: '1234' });
    const ref = f.service.finalize({ requestSource: 'agent', caller: f.caller, capture: second, executionState: 'terminal', outcome: 'success' });
    expect(ref.incompleteReason).toBe('output_budget_exceeded'); expect(ref.byteLength).toBe(0); expect(ref.contentHash).toBe('');
    expect(f.service.finalize({ requestSource: 'agent', caller: f.caller, capture: first, executionState: 'terminal', outcome: 'success' }).complete).toBe(true);
  });
  it('policy revocation aborts an admitted real transport attempt and prevents retries', async () => {
    const f = fixture(); const ref = f.capture('authorized'); const page = f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination });
    const issuer = createTransportLeaseIssuer(f.service.transportPort); cleanup.push(() => issuer.dispose());
    const body = JSON.stringify({ model: destination.model, content: page.content }); const cap = issuer.issue({ invocationId: 'request', destination: destination.url, serializedBody: body, dependencies: page.dependencies });
    let signal: AbortSignal | undefined; const fetch = vi.fn(async (_url: string, init: RequestInit) => { signal = init.signal as AbortSignal; return new Response('ok'); });
    const request = { invocationId: 'request', input: destination.url, init: { method: 'POST', body } };
    const attempt = issuer.dispatch(cap, request, fetch); await attempt.response;
    f.service.revokePolicy({ requestSource: 'user', caller: f.user, policyId: 'policy' }); expect(signal?.aborted).toBe(true);
    expect(() => issuer.dispatch(cap, request, fetch)).toThrow(); expect(fetch).toHaveBeenCalledOnce(); attempt.finish();
  });

  it.each(['timeout', 'cancelled'] as const)('terminal correction to %s cannot retain complete=true', outcome => {
    const f = fixture(); const ref = f.capture('original complete output'); expect(ref.complete).toBe(true);
    const page = f.service.read({ caller: f.caller, id: ref.id, offset: 0, maxBytes: 64, destination });
    const revised = f.service.reviseTerminal({ requestSource: 'agent', caller: f.caller, id: ref.id, outcome });
    expect(revised.complete).toBe(false); expect(revised.incompleteReason).toBe(outcome); expect(revised.contentHash).toBe(ref.contentHash);
    expect(() => f.service.transportPort.validate(page.dependencies, destination.url)).toThrow();
  });

  it('cannot silently create a new authority when identity metadata disappeared from an existing store', () => {
    const f = fixture(); f.capture('durable'); f.service.dispose(); unlinkSync(join(f.root, 'observations', 'authority.json'));
    expect(() => createObservationService({ profileRoot: f.root, profileId: 'profile', redactor: { version: 'test-v1', redact: (text: string) => text } })).toThrow(/authority/);
  });
  it.each(['missing', 'corrupt'] as const)('refuses current terminal facts that are %s after restart', mode => {
    const f = fixture(); const ref = f.capture('durable'); f.service.dispose(); const path = join(f.root, 'observations', `${ref.id}.terminal-${ref.revision}`);
    if (mode === 'missing') unlinkSync(path); else writeFileSync(path, '{}');
    const next = createObservationService({ profileRoot: f.root, profileId: 'profile', now: () => 1000, redactor: { version: 'test-v1', redact: (text: string) => text } }); cleanup.push(() => next.dispose());
    const caller = next.bindCaller(f.claims); const user = next.bindCaller({ ...f.claims, requestSource: 'user' }); next.setArchivePolicy({ requestSource: 'user', caller: user, policy: f.policy });
    expect(() => next.read({ caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
  });
  it.each(['boolean', 'state', 'generation', 'terminalOutcome', 'incompleteReason'] as const)('strictly rejects a malformed recovered %s field', field => {
    const f = fixture(); const ref = f.capture('durable'); f.service.dispose(); const path = join(f.root, 'observations', `${ref.id}.json`);
    const entry = JSON.parse(readFileSync(path, 'utf8'));
    if (field === 'boolean') entry.ref.complete = 'true';
    if (field === 'state') entry.ref.executionState = 'finished';
    if (field === 'generation') entry.claims.permissionGeneration = -1;
    if (field === 'terminalOutcome') delete entry.ref.outcome;
    if (field === 'incompleteReason') { entry.ref.complete = false; delete entry.ref.incompleteReason; }
    writeFileSync(path, JSON.stringify(entry));
    expect(() => createObservationService({ profileRoot: f.root, profileId: 'profile', redactor: { version: 'test-v1', redact: (text: string) => text } })).toThrow(/index/);
  });

  describe('explicit native read file scopes', () => {
    function scoped(endLine?: number) {
      const f = fixture(); const file = join(f.root, 'material.txt'); writeFileSync(file, 'one\ntwo\nthree');
      const policy = { ...f.policy, revision: 2, sourceAdapterId: 'native.read.v1', sourceDescriptors: [], readFileScopes: [{ filePath: file, startLine: 2, ...(endLine === undefined ? {} : { endLine }) }] };
      f.service.setArchivePolicy({ requestSource: 'user', caller: f.user, policy });
      const collect = (offset: number, limit?: number, path = file, toolName = 'read', adapter = 'native.read.v1') => {
        const capture = f.service.begin({ requestSource: 'agent', caller: f.caller, invocationId: 'scoped-read', toolName, sourceAdapterId: adapter,
          sourceDescriptor: JSON.stringify({ toolName, filePath: path, offset, ...(limit === undefined ? {} : { limit }) }) });
        f.service.append({ requestSource: 'agent', caller: f.caller, capture, text: 'selected lines' });
        return f.service.finalize({ requestSource: 'agent', caller: f.caller, capture, executionState: 'terminal', outcome: 'success' });
      };
      return { ...f, file, policy, collect };
    }
    it('authorizes contained subranges without changing policy per read', () => {
      const f = scoped(4); const one = f.collect(2, 1); const two = f.collect(3, 2);
      expect(one.complete).toBe(true); expect(two.complete).toBe(true);
      expect(f.service.read({ caller: f.caller, id: two.id, offset: 0, maxBytes: 64, destination }).content).toBe('selected lines');
    });
    it.each([[1, 1], [4, 2], [2, undefined], [2, 0], [2, -1], [2.5, 1], [2, 1.5], [Number.MAX_SAFE_INTEGER, 2]])('denies an invalid or noncontained range %s/%s', (offset, limit) => {
      const f = scoped(4); const ref = f.collect(offset!, limit);
      expect(ref.complete).toBe(false); expect(ref.incompleteReason).toBe('archive_policy_denied'); expect(ref.contentHash).toBe('');
    });
    it('only permits an unlimited tail when the explicit scope has no upper bound', () => {
      const f = scoped(); expect(f.collect(3).complete).toBe(true);
    });
    it('does not match another path, adapter or tool', () => {
      const f = scoped(4);
      for (const ref of [f.collect(2, 1, f.file + '.other'), f.collect(2, 1, f.file, 'bash'), f.collect(2, 1, f.file, 'read', 'custom.read')]) expect(ref.contentHash).toBe('');
    });
    it('refuses directory/wildcard/relative scopes and invalid scope endpoints', () => {
      const f = scoped(4);
      for (const scope of [{ filePath: f.root, startLine: 1 }, { filePath: '*', startLine: 1 }, { filePath: 'relative.txt', startLine: 1 }, { filePath: f.file, startLine: 0 }, { filePath: f.file, startLine: 4, endLine: 3 }]) {
        expect(() => f.service.setArchivePolicy({ requestSource: 'user', caller: f.user, policy: { ...f.policy, revision: 3, readFileScopes: [scope] } })).toThrow();
      }
    });
    it('revalidates the archived range after restart and new policy authorization', () => {
      const f = scoped(4); const ref = f.collect(2, 2); f.service.dispose();
      const next = createObservationService({ profileRoot: f.root, profileId: 'profile', now: () => 1000, redactor: { version: 'test-v1', redact: (text: string) => text } }); cleanup.push(() => next.dispose());
      const caller = next.bindCaller(f.claims); const user = next.bindCaller({ ...f.claims, requestSource: 'user' });
      next.setArchivePolicy({ requestSource: 'user', caller: user, policy: { ...f.policy, readFileScopes: [{ filePath: f.file, startLine: 3, endLine: 4 }] } });
      expect(() => next.read({ caller, id: ref.id, offset: 0, maxBytes: 64, destination })).toThrow();
    });
    it('does not infer subrange permission from the old exact descriptor format', () => {
      const f = fixture(); const file = join(f.root, 'exact.txt'); writeFileSync(file, 'lines');
      f.service.setArchivePolicy({ requestSource: 'user', caller: f.user, policy: { ...f.policy, revision: 2, sourceAdapterId: 'native.read.v1', sourceDescriptors: [JSON.stringify({ toolName: 'read', filePath: file, offset: 1 })] } });
      const capture = f.service.begin({ requestSource: 'agent', caller: f.caller, invocationId: 'exact', toolName: 'read', sourceAdapterId: 'native.read.v1', sourceDescriptor: JSON.stringify({ toolName: 'read', filePath: file, offset: 2, limit: 1 }) });
      f.service.append({ requestSource: 'agent', caller: f.caller, capture, text: 'denied' });
      expect(f.service.finalize({ requestSource: 'agent', caller: f.caller, capture, executionState: 'terminal', outcome: 'success' }).incompleteReason).toBe('archive_policy_denied');
    });
  });

});
