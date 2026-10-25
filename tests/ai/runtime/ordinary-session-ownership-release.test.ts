import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { acquireSaveLock } from '../../../src/ai/runtime/session-store/mutation-lock.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { createSessionExecutionContext, assertSessionExecutionLease } from '../../../src/ai/runtime/session-store/execution-authority.js';
import { createEmptySessionIntentLedger } from '../../../src/runtime/intent-delegation/store.js';
import { intentNativeLedgerHash } from '../../../src/runtime/intent-delegation/native-contract-journal.js';
import { writeFileAtomicallySync } from '../../../src/utils/atomic-file.js';
import { createIntentLedgerRecord } from '../../../src/runtime/intent-delegation/types.js';
import { takeoverSessionOwnership } from '../../../src/runtime/intent-delegation/ownership.js';
import { createIntentPlan } from '../../../src/ai/intent-delegation/planner.js';

// Branch tests only. Real Windows installation/ConPTY qualification is separate.
vi.mock('../../../src/runtime/verification/windows-installation-absence.js', () => ({ readWindowsInstallationAbsence: () => 'ordinary' }));
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
async function fixture(atomic = writeFileAtomicallySync) {
  const root = mkdtempSync(join(tmpdir(), 'ordinary-ownership-release-')); roots.push(root);
  const store = new FileSessionStore(root, atomic), ledger = createEmptySessionIntentLedger('session', 1);
  ledger.ownership = { state: 'owned', ownerInstanceId: 'host', updatedAt: 1 }; ledger.instanceId = 'host';
  await store.save({ sessionId: 'session', cwd: root, createdAt: 1, updatedAt: 1, lineage: ['session'], messages: [{ role: 'user', content: [{ type: 'text', text: 'retained ordinary history' }] }], usage: { inputTokens: 1, outputTokens: 2 }, compactions: [], memoryRefs: [], approvalRefs: [], backgroundJobRefs: [], promptSnapshotId: 'prompt_original', intentDelegation: ledger });
  const file = join(root, 'session.json');
  const input = () => ({ sessionId: 'session', instanceId: 'host', expectedLedgerHash: intentNativeLedgerHash(store.getIntentNativeLedgerSync('session')), requestSource: 'user', now: 10, hostContext: createSessionExecutionContext({ requestSource: 'user', ownerId: 'host', scopeId: 'cli-session-exit' }) });
  const bytes = () => readFileSync(file, 'utf8');
  const inject = (change: (raw: any) => void) => { const raw = JSON.parse(bytes()); change(raw); writeFileSync(file, JSON.stringify(raw)); };
  return { root, store, file, input, bytes, inject };
}
const release = (store: FileSessionStore, input: any): Promise<boolean> => (store as any).releaseOrdinarySessionOwnership(input);
function windows() { vi.spyOn(process, 'platform', 'get').mockReturnValue('win32'); }

it('releases only the ordinary owner through the real store while preserving the original prompt and history', async () => {
  const f = await fixture(), previous = await f.store.load('session'); windows();
  const transition = vi.spyOn(f.store, 'transitionIntentSessionOwnership');
  expect(await release(f.store, f.input())).toBe(true);
  expect(transition).toHaveBeenCalledTimes(1);
  const permit = transition.mock.calls[0]![0].lease;
  expect(() => assertSessionExecutionLease(permit, { root: f.root, sessionIdentity: 'session' })).toThrow('invalid_session_execution_lease');
  const next = await f.store.load('session');
  expect(next?.intentDelegation?.ownership).toEqual({ state: 'released', previousOwnerInstanceId: 'host', updatedAt: 10 });
  for (const key of ['messages','usage','cwd','lineage','compactions','memoryRefs','approvalRefs','backgroundJobRefs','promptSnapshotId','model','skillEval','skillExecution'] as const) expect(next?.[key]).toEqual(previous?.[key]);
  expect(next?.storeRevision).toBe(previous!.storeRevision! + 1);
});

for (const wrong of [
  { requestSource: 'agent' }, { requestSource: 'scheduler' }, { instanceId: 'foreign' },
  { sessionId: 'foreign' }, { expectedLedgerHash: '0'.repeat(64) }, { now: 0 }, { hostContext: {} },
]) it(`rejects an unauthorized/stale ordinary release ${Object.keys(wrong)[0]} without modifying the source`, async () => {
  const f = await fixture(); windows(); const before = f.bytes();
  await expect(release(f.store, { ...f.input(), ...wrong })).rejects.toThrow();
  expect(f.bytes()).toBe(before);
});

for (const claims of [
  { requestSource: 'agent', ownerId: 'host', scopeId: 'cli-session-exit' },
  { requestSource: 'scheduler', ownerId: 'host', scopeId: 'cli-session-exit' },
  { requestSource: 'user', ownerId: 'foreign', scopeId: 'cli-session-exit' },
  { requestSource: 'user', ownerId: 'host', scopeId: 'foreign' },
] as const) it(`rejects mismatched opaque host claims ${JSON.stringify(claims)}`, async () => {
  const f = await fixture(); windows(); const before = f.bytes();
  await expect(release(f.store, { ...f.input(), hostContext: createSessionExecutionContext(claims) })).rejects.toThrow();
  expect(f.bytes()).toBe(before);
});

it('rejects getters before reading their values or committing', async () => {
  const f = await fixture(); windows(); const before = f.bytes(); let calls = 0;
  const request = { ...f.input(), get instanceId() { calls++; return 'host'; } };
  await expect(release(f.store, request)).rejects.toThrow(); expect(calls).toBe(0); expect(f.bytes()).toBe(before);
});

for (const [key, value] of [
  ['executionProtected', true], ['executionProtected', false], ['executionProtected', null],
  ['protectedObservationClosure', { version: 1, requiresReauthorization: true, observations: [] }],
  ['compoundOperations', {}], ['semanticCompaction', {}], ['unknownProtection', {}],
  ['compactions', [{}]], ['memoryRefs', ['original']], ['approvalRefs', ['original']], ['backgroundJobRefs', ['original']],
] as const) it(`never classifies source ${key}=${JSON.stringify(value)} as ordinary`, async () => {
  const f = await fixture(), request = f.input(); f.inject(raw => { raw[key] = value; }); windows(); const before = f.bytes();
  expect(await release(f.store, request)).toBe(false); expect(f.bytes()).toBe(before);
});

for (const field of ['nativeContracts', 'producerActions', 'publicationCandidates', 'verificationExecutions', 'unknownNative']) it(`declines retained ${field}, including an empty field`, async () => {
  const f = await fixture(), request = f.input(); f.inject(raw => { raw.intentDelegation[field] = []; }); windows(); const before = f.bytes();
  expect(await release(f.store, request)).toBe(false); expect(f.bytes()).toBe(before);
});

for (const where of ['intents', 'latestPlan'] as const) it(`declines ${where} executionTerminals even when empty`, async () => {
  const f = await fixture(), request = f.input(); const plan = createIntentPlan({ sessionId: 'session', instanceId: 'host', input: '写一份报告', skills: [] });
  if (plan.kind !== 'plan') throw Error('actual planner fixture');
  f.inject(raw => { raw.intentDelegation.intents = [plan.plan]; raw.intentDelegation.latestPlan = plan.plan; if (where === 'intents') raw.intentDelegation.intents[0].executionTerminals = []; else raw.intentDelegation.latestPlan.executionTerminals = []; });
  windows(); const before = f.bytes(); expect(await release(f.store, request)).toBe(false); expect(f.bytes()).toBe(before);
});

it('preserves a protected source introduced after preflight and before the original transition', async () => {
  const f = await fixture(); windows(); const transition = f.store.transitionIntentSessionOwnership.bind(f.store);
  vi.spyOn(f.store, 'transitionIntentSessionOwnership').mockImplementation(async input => { f.inject(raw => { raw.executionProtected = true; }); return transition(input); });
  await expect(release(f.store, f.input())).rejects.toThrow();
  expect(JSON.parse(f.bytes()).executionProtected).toBe(true);
  expect(JSON.parse(f.bytes()).intentDelegation.ownership.state).toBe('owned');
});

it('rejects an actual active SQLite execution lock without granting an ordinary release', async () => {
  const f = await fixture(), directory = join(f.root, '.session-execution'); mkdirSync(directory);
  const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(join(directory, createHash('sha256').update('session').digest('hex') + '.sqlite'), { timeout: 0 });
  db.exec('BEGIN EXCLUSIVE');
  try { windows(); const before = f.bytes(); await expect(release(f.store, f.input())).rejects.toThrow(); expect(f.bytes()).toBe(before); }
  finally { db.close(); }
});

it('propagates a real atomic writer failure without marking ownership released', async () => {
  let fail = false;
  const f = await fixture((file, body, options) => { if (fail) throw Error('ORIGINAL_ATOMIC_WRITE_FAILURE'); writeFileAtomicallySync(file, body, options); });
  windows(); fail = true; const before = f.bytes();
  await expect(release(f.store, f.input())).rejects.toThrow('ORIGINAL_ATOMIC_WRITE_FAILURE'); expect(f.bytes()).toBe(before);
});

it('rejects the captured private permit in strong/native sibling entries and on replay', async () => {
  const f = await fixture(); windows(); const transition = vi.spyOn(f.store, 'transitionIntentSessionOwnership');
  await release(f.store, f.input()); const captured = transition.mock.calls[0]![0], before = f.bytes();
  expect(() => f.store.assertIntentNativeLease('session', 'user', captured.lease)).toThrow('invalid_session_execution_lease');
  await expect(f.store.compareAndSave({ nextSnapshot: (await f.store.load('session'))!, lease: captured.lease } as any)).rejects.toThrow('invalid_session_execution_lease');
  await expect(f.store.transitionIntentSessionOwnership(captured)).rejects.toThrow(); expect(f.bytes()).toBe(before);
});

it('does not offer an ordinary release on macOS', async () => {
  const f = await fixture(); vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin'); const before = f.bytes();
  expect(await release(f.store, f.input())).toBe(false); expect(f.bytes()).toBe(before);
});

it('rejects a copied permit or one presented to a different FileStore/root', async () => {
  const f = await fixture(), other = await fixture(); windows();
  const original = f.store.transitionIntentSessionOwnership.bind(f.store);
  vi.spyOn(f.store, 'transitionIntentSessionOwnership').mockImplementation(async input => {
    await expect(other.store.transitionIntentSessionOwnership(input)).rejects.toThrow();
    await expect(original({ ...input, lease: { ...input.lease } })).rejects.toThrow();
    return original(input);
  });
  const before = other.bytes(); expect(await release(f.store, f.input())).toBe(true); expect(other.bytes()).toBe(before);
});

for (const action of ['resume', 'takeover'] as const) it(`never grants ${action} with the ordinary release permit`, async () => {
  const f = await fixture(); windows(); const original = f.store.transitionIntentSessionOwnership.bind(f.store);
  vi.spyOn(f.store, 'transitionIntentSessionOwnership').mockImplementation(async input => {
    await expect(original({ ...input, action })).rejects.toThrow();
    return original(input);
  });
  expect(await release(f.store, f.input())).toBe(true);
});

it('rejects an unexpected concurrent history change, rather than normalizing it away', async () => {
  const f = await fixture(); windows(); const original = f.store.transitionIntentSessionOwnership.bind(f.store);
  vi.spyOn(f.store, 'transitionIntentSessionOwnership').mockImplementation(async input => {
    f.inject(raw => { raw.messages.push({ role: 'user', content: [{ type: 'text', text: 'concurrent history' }] }); });
    return original(input);
  });
  await expect(release(f.store, f.input())).rejects.toThrow();
  const raw = JSON.parse(f.bytes()); expect(raw.messages).toHaveLength(2); expect(raw.intentDelegation.ownership.state).toBe('owned');
});

it('propagates a second-pointer write failure, consumes its permit and never replays the possibly committed snapshot', async () => {
  let fail = false;
  const f = await fixture((file, body, options) => { if (fail && file.endsWith('last_session')) throw Error('POINTER_WRITE_FAILURE'); writeFileAtomicallySync(file, body, options); });
  windows(); fail = true; const transition = vi.spyOn(f.store, 'transitionIntentSessionOwnership');
  await expect(release(f.store, f.input())).rejects.toThrow('POINTER_WRITE_FAILURE');
  expect(JSON.parse(f.bytes()).intentDelegation.ownership.state).toBe('released');
  const bytes = f.bytes(), captured = transition.mock.calls[0]![0];
  await expect(f.store.transitionIntentSessionOwnership(captured)).rejects.toThrow(); expect(f.bytes()).toBe(bytes);
});

it('detects a post-write history replacement and suppresses the success notification', async () => {
  let replace = false;
  const f = await fixture((file, body, options) => {
    writeFileAtomicallySync(file, body, options);
    if (replace && file.endsWith('session.json')) {
      const raw = JSON.parse(readFileSync(file, 'utf8')); raw.promptSnapshotId = 'foreign_prompt'; writeFileSync(file, JSON.stringify(raw));
    }
  });
  windows(); replace = true; const notice = vi.fn(); f.store.onCommit(notice);
  await expect(release(f.store, f.input())).rejects.toThrow(); expect(notice).not.toHaveBeenCalled();
  expect(JSON.parse(f.bytes()).promptSnapshotId).toBe('foreign_prompt');
});

it('holds the original root mutex throughout an absent-DB ordinary write and readback', async () => {
  let observe = false, root = '', observations = 0;
  const f = await fixture((file, body, options) => {
    if (observe) {
      expect(() => acquireSaveLock(join(root, '.session-store-lock'))).toThrow(); observations++;
    }
    writeFileAtomicallySync(file, body, options);
  });
  root = f.root; windows(); observe = true;
  expect(await release(f.store, f.input())).toBe(true); expect(observations).toBe(2);
  const unlock = acquireSaveLock(join(root, '.session-store-lock')); unlock();
});

for (const where of ['ownership','intent','stage','step','breadcrumb','receipt','salvage'] as const) it(`rejects unknown nested ${where} protection fields without normalizing them`, async () => {
  const f = await fixture(), plan = createIntentPlan({ sessionId: 'session', instanceId: 'host', input: '写一份报告', skills: [] });
  if (plan.kind !== 'plan') throw Error('actual planner fixture');
  f.inject(raw => {
    const record = createIntentLedgerRecord(plan.plan, 1);
    raw.intentDelegation.intents = [record]; raw.intentDelegation.latestPlan = structuredClone(record); raw.intentDelegation.activeIntentId = record.intentId;
    const ledger = raw.intentDelegation;
    const unknown = { unknownProtection: {} };
    if (where === 'ownership') Object.assign(ledger.ownership, unknown);
    if (where === 'intent') { Object.assign(ledger.intents[0], unknown); Object.assign(ledger.latestPlan, unknown); }
    if (where === 'stage') { Object.assign(ledger.intents[0].stages[0], unknown); Object.assign(ledger.latestPlan.stages[0], unknown); }
    if (where === 'step') { Object.assign(ledger.intents[0].steps[0], unknown); Object.assign(ledger.latestPlan.steps[0], unknown); }
    if (where === 'breadcrumb') ledger.breadcrumbs = [{ intentId: record.intentId, stepId: record.activeStepId, status: 'running', message: 'retained', createdAt: 1, ...unknown }];
    if (where === 'receipt') ledger.receipt = { intentId: record.intentId, stepId: record.activeStepId, note: 'retained', createdAt: 1, ...unknown };
    if (where === 'salvage') ledger.salvage = { intentId: record.intentId, summary: ['retained'], createdAt: 1, ...unknown };
  });
  const request = f.input(), before = f.bytes(); windows();
  expect(await release(f.store, request)).toBe(false); expect(f.bytes()).toBe(before);
});

it('preserves a real ordinary planner record, its active stages and retained business fields', async () => {
  const f = await fixture(), plan = createIntentPlan({ sessionId: 'session', instanceId: 'host', input: '写一份报告', skills: [] });
  if (plan.kind !== 'plan') throw Error('actual planner fixture');
  f.inject(raw => {
    const record = createIntentLedgerRecord(plan.plan, 1);
    raw.intentDelegation.intents = [record]; raw.intentDelegation.latestPlan = structuredClone(record); raw.intentDelegation.activeIntentId = record.intentId;
  });
  const request = f.input(), before = JSON.parse(f.bytes()); windows();
  expect(await release(f.store, request)).toBe(true); const after = JSON.parse(f.bytes());
  expect(after.intentDelegation.intents).toEqual(before.intentDelegation.intents);
  expect(after.intentDelegation.latestPlan).toEqual(before.intentDelegation.latestPlan);
  expect(after.intentDelegation.activeIntentId).toBe(before.intentDelegation.activeIntentId);
});

it('releases a real takeover state only when its actual current owner and instance match the host', async () => {
  const f = await fixture();
  const original = f.store.getIntentNativeLedgerSync('session')!;
  const taken = takeoverSessionOwnership({ ...original, instanceId: 'previous', ownership: { state: 'owned', ownerInstanceId: 'previous', updatedAt: 1 } }, 'host', { now: 2, confirmHighRisk: true });
  f.inject(raw => { raw.intentDelegation = taken; raw.updatedAt = 2; });
  expect(taken.ownership.state).toBe('takeover'); const request = f.input(), before = JSON.parse(f.bytes()); windows();
  expect(await release(f.store, request)).toBe(true);
  const after = JSON.parse(f.bytes()); expect(after.intentDelegation.ownership).toEqual({ state: 'released', previousOwnerInstanceId: 'host', updatedAt: 10 });
  expect(after.messages).toEqual(before.messages); expect(after.promptSnapshotId).toBe(before.promptSnapshotId);
});
