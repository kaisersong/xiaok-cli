// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createHarnessOptimizationRuntime } from '../../electron/harness-optimization-service.js';
import type { HarnessResearchManifest } from '../../electron/harness-optimization-types.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const roots: string[] = [];
const hosts: Awaited<ReturnType<typeof createHarnessOptimizationRuntime>>[] = [];
const actor = Object.freeze({ requestSource: 'user' as const, principalId: 'local-user' });
let clock = Date.UTC(2026, 9, 20, 12);
const freshRoot = () => { const p = mkdtempSync(join(tmpdir(), 'harness-d0-')); roots.push(p); return p; };

async function open(dataRoot = freshRoot()) {
  const manifests = new Map<string, HarnessResearchManifest>();
  const host = await createHarnessOptimizationRuntime({ dataRoot, profileId: 'profile', workspaceId: 'workspace',
    authorizeUser: ctx => ctx === actor, manifestLookup: id => manifests.get(id), now: () => clock });
  hosts.push(host);
  return { host, manifests, dataRoot };
}

async function register(fixture: Awaited<ReturnType<typeof open>>, overrides: Partial<HarnessResearchManifest> = {}) {
  const state = await fixture.host.api.read();
  const manifest: HarnessResearchManifest = { id: 'manifest', ownerId: state.ownerId!, profileId: 'profile', workspaceId: 'workspace',
    behaviorFingerprint: digest('behavior'), bindingHash: digest('adapter'), executionKind: 'probe',
    expiresAt: clock + 600000, machineBoundMs: 10000, perRun: { tokens: 5000, requests: 2, timeoutMs: 10000 },
    steps: [{ id: 'a', bodyHash: digest('A'), tokens: 2000, timeoutMs: 3000 },
      { id: 'b', bodyHash: digest('B'), tokens: 2000, timeoutMs: 3000 }], ...overrides };
  fixture.manifests.set(manifest.id, manifest);
  const intent = await fixture.host.api.issueResearchIntent({ manifestId: manifest.id }, actor);
  const run = await fixture.host.api.startResearch({ manifestId: manifest.id, requestId: intent.requestId }, actor);
  return { manifest, intent, run };
}

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  clock = Date.UTC(2026, 9, 20, 12);
});

describe('D0 real local owner and configuration', () => {
  it('initializes off/none, rejects public enable and reflect without overwriting state', async () => {
    const { host } = await open();
    const state = await host.api.read();
    expect(state.status).toBe('ready');
    expect(state.publicStatus).toBe('unavailable');
    expect(state.config).toMatchObject({ schemaVersion: 1, enabled: false, mode: 'none',
      maxExtraRequestTokensPerUtcDay: 60000, maxExtraRequestsPerUtcDay: 5 });
    await expect(host.api.setEnabled(true, actor)).rejects.toThrow('public_unavailable');
    for (const patch of [{ mode: 'reflect' }, { enabled: true }, { publicGeneration: 8 }, { maxExtraRequestsPerUtcDay: NaN }]) {
      await expect(host.api.saveConfig(patch, actor)).rejects.toThrow();
    }
    expect((await host.api.read()).config).toEqual(state.config);
  });

  it('denies agent, scheduler and forged user identities on every mutation', async () => {
    const { host } = await open();
    for (const requestSource of ['agent', 'scheduler', 'user']) {
      const fake = { requestSource, principalId: 'local-user' };
      await expect(host.api.saveConfig({ mode: 'probe' }, fake)).rejects.toThrow('actor_forbidden');
      await expect(host.api.setEnabled(false, fake)).rejects.toThrow('actor_forbidden');
      await expect(host.api.issueResearchIntent({ manifestId: 'x' }, fake)).rejects.toThrow('actor_forbidden');
      await expect(host.api.startResearch({ manifestId: 'x', requestId: 'x' }, fake)).rejects.toThrow('actor_forbidden');
      await expect(host.api.revoke({ scope: 'all' }, fake)).rejects.toThrow('actor_forbidden');
    }
  });

  it('holds the OS owner lock across aliases and preserves owner identity on clean reopen', async () => {
    const first = await open();
    const state = await first.host.api.read();
    const aliasParent = freshRoot(); const alias = join(aliasParent, 'alias');
    symlinkSync(first.dataRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const second = await open(alias);
    expect((await second.host.api.read()).status).toBe('unavailable');
    await first.host.dispose();
    const third = await open(first.dataRoot);
    const reopened = await third.host.api.read();
    expect(reopened.status).toBe('ready');
    expect(reopened.ownerId).toBe(state.ownerId);
    expect(reopened.ownerEpoch).toBe(state.ownerEpoch! + 1);
  });

  it('refuses to rebuild a ready owner after database loss', async () => {
    const first = await open();
    await first.host.api.read(); await first.host.dispose();
    const witnessPath = join(first.dataRoot, 'harness-optimization-owner.json');
    const witness = readFileSync(witnessPath);
    unlinkSync(join(first.dataRoot, 'harness-optimization.sqlite'));
    const reopened = await open(first.dataRoot);
    expect((await reopened.host.api.read()).status).toBe('unavailable');
    expect(readFileSync(witnessPath)).toEqual(witness);
  });

  it('rejects a copied owner root and its old ticket', async () => {
    const f = await open(); const { run } = await register(f);
    const ticket = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    await f.host.dispose();
    const copied = freshRoot(); cpSync(f.dataRoot, copied, { recursive: true });
    const second = await open(copied);
    expect((await second.host.api.read()).status).toBe('unavailable');
    await expect(second.host.driver.send(ticket, () => { throw Error('sent'); })).rejects.toThrow('optimization_unavailable');
  });
});

describe('D0 escrow, attempts and recovery', () => {
  it('replays the same root intent once, charges parent escrow once and slots only subdivide', async () => {
    const f = await open(); const { intent, run } = await register(f);
    expect(await f.host.api.startResearch({ manifestId: 'manifest', requestId: intent.requestId }, actor)).toEqual(run);
    const before = await f.host.driver.audit();
    expect(before.budget).toMatchObject({ reservedTokens: 5000, reservedRequests: 2, usedTokens: 0 });
    const attempt = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    expect((await f.host.driver.audit()).budget).toEqual(before.budget);
    await expect(f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') })).rejects.toThrow();
    expect(attempt.ownerEpoch).toBeGreaterThan(0);
  });

  it('rejects whole-plan overflow and concurrent busy runs atomically', async () => {
    const f = await open(); await register(f);
    await expect(register(f, { id: 'second' })).rejects.toThrow('research_busy');
    expect((await f.host.driver.audit()).budget.reservedTokens).toBe(5000);
    await f.host.api.revoke({ scope: 'all' }, actor);
    await f.host.api.saveConfig({ maxExtraRequestsPerUtcDay: 1 }, actor);
    await expect(register(f, { id: 'too-big' })).rejects.toThrow('budget_insufficient');
  });

  it('keeps unknown reserved after revoke and settles late usage once in the original bucket', async () => {
    const f = await open(); const { run } = await register(f);
    const attempt = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    let sends = 0;
    await f.host.driver.send(attempt, () => { sends++; });
    expect(sends).toBe(1);
    await f.host.api.revoke({ scope: 'all' }, actor);
    expect((await f.host.driver.audit()).budget).toMatchObject({ reservedTokens: 2000, reservedRequests: 1 });
    clock += 24 * 3600000;
    await f.host.driver.settle({ invocationId: attempt.invocationId, inputTokens: 1000, outputTokens: 200 });
    await f.host.driver.settle({ invocationId: attempt.invocationId, inputTokens: 1000, outputTokens: 200 });
    const audit = await f.host.driver.audit();
    expect(audit.budget).toMatchObject({ usedTokens: 1200, usedRequests: 1, reservedTokens: 0, reservedRequests: 0 });
    await expect(f.host.driver.settle({ invocationId: attempt.invocationId, inputTokens: 1000, outputTokens: 300 })).rejects.toThrow('usage_conflict');
  });

  it('no-op saves/off and public mode do not revoke independently authorized research', async () => {
    const f = await open(); const { run } = await register(f);
    const before = (await f.host.api.read()).config!;
    await f.host.api.setEnabled(false, actor);
    await f.host.api.saveConfig({ mode: 'none' }, actor);
    expect((await f.host.api.read()).config).toEqual(before);
    await f.host.api.saveConfig({ mode: 'probe', maxExtraRequestTokensPerUtcDay: 70000 }, actor);
    const attempt = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    let sent = false; await f.host.driver.send(attempt, () => { sent = true; }); expect(sent).toBe(true);
  });

  it('blocks a prepared ticket after explicit revoke and after relevant budget reduction', async () => {
    for (const operation of ['revoke', 'lower'] as const) {
      const f = await open(); const { run } = await register(f);
      const attempt = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
      if (operation === 'revoke') await f.host.api.revoke({ scope: 'all' }, actor);
      else await f.host.api.saveConfig({ maxExtraRequestTokensPerUtcDay: 50000 }, actor);
      let sent = false;
      await expect(f.host.driver.send(attempt, () => { sent = true; })).rejects.toThrow();
      expect(sent).toBe(false);
    }
  });

  it('aborts owned in-flight work when the shared research budget is lowered', async () => {
    const f = await open(); const { run } = await register(f);
    const ticket = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    let signal: AbortSignal | undefined;
    await f.host.driver.send(ticket, value => { signal = value; });
    await f.host.api.saveConfig({ maxExtraRequestTokensPerUtcDay: 50000 }, actor);
    expect(signal?.aborted).toBe(true);
    expect((await f.host.driver.audit()).budget).toMatchObject({ reservedTokens: 2000, reservedRequests: 1 });
  });

  it('does not block a research marker ACK while only the guidance budget is lowered', async () => {
    const f = await open(); const { run } = await register(f);
    const ticket = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    let sends = 0;
    const sending = f.host.driver.send(ticket, () => { sends++; }).catch(error => error.message);
    await f.host.api.saveConfig({ maxGuidanceTokensPerUtcDay: 5000 }, actor);
    expect(await sending).toBeUndefined();
    expect(sends).toBe(1);
  });

  it('denies substituted bodies, forged tickets, expired plans and clock rollback', async () => {
    const f = await open(); const { run } = await register(f);
    await expect(f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('other') })).rejects.toThrow('body_mismatch');
    const ticket = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    await expect(f.host.driver.send({ ...ticket }, () => { throw Error('sent'); })).rejects.toThrow('ticket_invalid');
    clock -= 10000;
    await expect(f.host.driver.send(ticket, () => { throw Error('sent'); })).rejects.toThrow('clock_rollback');
  });

  it('rechecks the real deadline after an asynchronous marker ACK', async () => {
    const f = await open(); const { run } = await register(f);
    const ticket = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    let sends = 0;
    const pending = f.host.driver.send(ticket, () => { sends++; });
    clock += 60000;
    await expect(pending).rejects.toThrow('research_expired');
    expect(sends).toBe(0);
  });

  it('resets a corrected clock explicitly without changing grant fences or budget', async () => {
    const f = await open(); const { run } = await register(f);
    const ticket = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    const before = await f.host.api.read();
    const budget = (await f.host.driver.audit()).budget;
    clock -= 10000;
    await expect(f.host.driver.send(ticket, () => { throw Error('sent'); })).rejects.toThrow('clock_rollback');
    expect((await f.host.api.read()).dispatchBlocked).toBe(true);
    clock += 10000;
    await f.host.api.resetClockGuard({ expectedHighWaterMark: before.highWaterMark! }, actor);
    expect((await f.host.api.read()).config).toEqual(before.config);
    expect((await f.host.driver.audit()).budget).toEqual(budget);
  });

  it('keeps the full observed overage and disables the unreliable binding', async () => {
    const f = await open(); const { run } = await register(f);
    const ticket = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    await f.host.driver.send(ticket, () => undefined);
    await f.host.driver.settle({ invocationId: ticket.invocationId, inputTokens: 2500, outputTokens: 100 });
    expect((await f.host.driver.audit()).budget).toMatchObject({ usedTokens: 2600, reservedTokens: 0 });
    await expect(register(f, { id: 'after-overage' })).rejects.toThrow('binding_unavailable');
  });

  it('returns one pending operation while real SQLite is blocked, and a late marker cannot send', async () => {
    const f = await open(); const { run } = await register(f, { executionKind: 'formal-evaluation' });
    const ticket = await f.host.driver.prepareAttempt({ runId: run.runId, stepId: 'a', bodyHash: digest('A') });
    const blocker = new DatabaseSync(join(f.dataRoot, 'harness-optimization.sqlite'));
    blocker.exec('BEGIN IMMEDIATE');
    let sends = 0;
    const sending = f.host.driver.send(ticket, () => { sends++; }).catch(error => error.message);
    try {
      const results = await Promise.all(Array.from({ length: 10 }, () => f.host.api.revoke({ scope: 'all' }, actor))) as Array<{ phase: string; operationId: string }>;
      expect(new Set(results.map(r => r.operationId)).size).toBe(1);
      expect(results.every(r => r.phase === 'closing_pending')).toBe(true);
      expect(sends).toBe(0);
      blocker.exec('COMMIT');
      expect(await sending).toBe('grant_revoked');
      await vi.waitFor(async () => {
        expect((await f.host.api.read()).closeOperations?.[0].phase).toBe('closed');
      }, { timeout: 2000 });
      const state = await f.host.api.read();
      expect(state.config).toMatchObject({ publicGeneration: 1, researchGeneration: 1 });
      expect(blocker.prepare('SELECT COUNT(*) AS count FROM applied_operations').get()).toMatchObject({ count: 1 });
      expect(blocker.prepare('SELECT spent FROM formal_trials').get()).toMatchObject({ spent: 1 });
      expect(sends).toBe(0);
    } finally { try { blocker.exec('ROLLBACK'); } catch {} blocker.close(); }
  });

  it.skipIf(process.getuid?.() === 0)('retries the same failed journal operation once permissions recover', async () => {
    const f = await open(); await register(f);
    const directory = join(f.dataRoot, 'harness-optimization-journal'); mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o000);
    try {
      const failed = await f.host.api.revoke({ scope: 'all' }, actor) as { phase: string; operationId: string };
      expect(failed.phase).toBe('close_persistence_failed');
      expect((await f.host.api.read()).dispatchBlocked).toBe(true);
      chmodSync(directory, 0o700);
      const retried = await f.host.api.revoke({ scope: 'all' }, actor) as { phase: string; operationId: string };
      expect(retried).toMatchObject({ phase: 'closed', operationId: failed.operationId });
      expect((await f.host.api.read()).config).toMatchObject({ publicGeneration: 1, researchGeneration: 1 });
    } finally { chmodSync(directory, 0o700); }
  });
});
