// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import type { ExecutionLease } from '../../electron/desktop-execution-coordinator.js';
import { cleanupActivityCase, activityFixture, barrier, nativeAuthorizer, serviceSite, spawnChunk, sqliteFault, tick, writeChunk, type Cleanup } from '../fixtures/multi-agent-activity-failure.js';

describe.runIf(nativeAuthorizer)('R6 AF real factory activity and sibling SQLite failures', () => {
  const cleanup: Cleanup = [];
  afterEach(() => cleanupActivityCase(cleanup));

  it.each([
    ['AF1 first group', 'groups', 'recordActivity', 0],
    ['AF1 queued group', 'groups', serviceSite('async recordActivity(', "this.requireActor(context.actor", 1), 0],
    ['AF1 queued apply agent', 'agents', 'applyActivity', 0],
  ] as const)('%s read failure freezes the owner before its next actual scoped write', async (_label, table, site, occurrence) => {
    const f = await activityFixture(cleanup), effect = join(f.root, 'next-effect.txt');
    const fault = sqliteFault(f, { table, column: 'data_json', site, occurrence });
    f.setProgram(async function* ({ call }) { if (call === 1) { await tick(); yield writeChunk(effect); } else yield { type: 'text', delta: 'done' }; });
    const task = await f.start(); await f.settled(task);
    expect(fault.traces).toHaveLength(1); expect(f.store.requireGroup(f.rootContext().groupId)).toBeTruthy();
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.rootContext().signal.aborted).toBe(true);
    expect.soft(existsSync(effect)).toBe(false); expect(f.calls.filter(call => !call.child).length).toBeLessThanOrEqual(1);
  });

  it.each([
    ['AF2 first group', 'groups', 'recordRunStarted', 0, false],
    ['AF2 queued group', 'groups', serviceSite('async recordRunStarted(', 'this.requireActor(context.actor', 1), 0, false],
    ['AF2 receipt', 'operations', serviceSite('async recordRunStarted(', 'store.getOperation'), 0, false],
    ['AF2 transaction existing guard', 'agents', serviceSite('async recordRunStarted(', 'const previous = this.requireAgent'), 0, true],
  ] as const)('%s failure blocks child model entry and the parent next write', async (_label, table, site, occurrence, existing) => {
    const f = await activityFixture(cleanup), effect = join(f.root, 'root-after-child-fault.txt');
    const fault = sqliteFault(f, { table, column: 'data_json', site, occurrence });
    f.setProgram(async function* ({ child, call }) {
      if (child) { yield writeChunk(join(f.root, 'forbidden-child.txt')); return; }
      if (call === 1) yield spawnChunk();
      else if (call === 2) { await fault.hit; await tick(); yield writeChunk(effect); }
      else yield { type: 'text', delta: 'done' };
    });
    const task = await f.start(); await f.settled(task);
    expect(fault.traces).toHaveLength(1); expect.soft(f.calls.filter(call => call.child)).toHaveLength(0);
    expect.soft(f.live().frozen).toBe(existing ? 'multi_agent_presentation_persistence_failed' : 'multi_agent_persistence_failed');
    expect.soft(f.rootContext().signal.aborted).toBe(true); expect.soft(existsSync(effect)).toBe(false);
    expect(existsSync(join(f.root, 'forbidden-child.txt'))).toBe(false);
  });

  it.each(['recordRuntimeEvent', 'recordUsage'] as const)('AF2b root awaited %s read failure must abort its already running child', async method => {
    const f = await activityFixture(cleanup), entered = barrier(), release = barrier(), effect = join(f.root, 'child-after-root-fault.txt');
    const usage = method === 'recordUsage' ? vi.spyOn(f.service, 'recordUsage') : undefined;
    cleanup.push(() => { release.release(); });
    const fault = sqliteFault(f, { table: 'groups', column: 'data_json', site: method });
    f.setProgram(async function* ({ child, call }) {
      if (child) { if (call === 1) { entered.release(); await release.wait; yield writeChunk(effect); } else yield { type: 'text', delta: 'child done' }; return; }
      if (call === 1) yield spawnChunk();
      else { await entered.wait; if (method === 'recordUsage') yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
        else yield { type: 'text', delta: 'root output' }; }
    });
    const task = await f.start(); await fault.hit; await tick();
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.childContext().signal.aborted).toBe(true);
    release.release(); await f.settled(task);
    await vi.waitFor(() => expect(f.store.getAgent(f.childContext().groupId, f.childContext().agentId)?.executionActive).toBe(false));
    expect(fault.traces).toHaveLength(1); expect(existsSync(effect)).toBe(false);
    if (usage) {
      expect(usage).toHaveBeenCalledTimes(1);
      expect(usage.mock.results[0]?.type).toBe('return');
      let usageFailure: unknown;
      await usage.mock.results[0]!.value.catch((error: unknown) => { usageFailure = error; });
      expect(usageFailure).toBeInstanceOf(Error);
      expect(usageFailure).toMatchObject({ code: 'ERR_SQLITE_ERROR', errcode: 23 });
      expect((await f.services.recoverTask(task)).snapshot.status).not.toBe('completed');
      await f.assertFailedDisposal(async error => {
        expect(error).toBeInstanceOf(AggregateError);
        const physical = error as AggregateError;
        expect(physical.message).toBe('agent_model_physical_drain_unconfirmed');
        expect(physical.errors).toHaveLength(1); expect(physical.errors[0]).toBe(usageFailure);
        expect(f.service.runtimeStatus().blocked).toBe(true);
        expect(f.store.getAgent(f.rootContext().groupId, f.rootContext().agentId)).toMatchObject({ executionActive: false, resourcesReleased: false, cleanupPending: true });
      });
    }
  });

  it.each(['groups', 'operations'] as const)('AF2b child tool_finished %s read failure preserves its previous file but blocks parent next dispatch', async table => {
    const f = await activityFixture(cleanup), previous = join(f.root, 'already-dispatched.txt'), effect = join(f.root, 'parent-after-tool-fault.txt');
    const fault = sqliteFault(f, { table, column: 'data_json', site: table === 'groups' ? 'recordToolFinished' : serviceSite('async recordToolFinished(', 'const existing = this.persistenceIO') });
    f.setProgram(async function* ({ child, call }) {
      if (child) { if (call === 1) yield writeChunk(previous); else yield { type: 'text', delta: 'child done' }; return; }
      if (call === 1) yield spawnChunk();
      else if (call === 2) { await fault.hit; await tick(); yield writeChunk(effect); }
      else yield { type: 'text', delta: 'done' };
    });
    const task = await f.start(); await f.settled(task);
    expect(fault.traces).toHaveLength(1); expect(existsSync(previous)).toBe(true);
    expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed'); expect.soft(f.rootContext().signal.aborted).toBe(true);
    expect(existsSync(effect)).toBe(false);
  });

  it.each([
    ['AF6 list first group', 'groups', 'DesktopMultiAgentService.list', 'list_agents'],
    ['AF6 list page', 'agents', 'DesktopMultiAgentService.list', 'list_agents'],
    ['AF6 send receipt', 'operations', 'DesktopMultiAgentService.mutate', 'send_message'],
    ['AF6 scoped invocation', 'groups', 'assertInvocation', 'write'],
  ] as const)('%s failure blocks the actual provider next tool dispatch', async (_label, table, site, tool) => {
    const f = await activityFixture(cleanup), effect = join(f.root, 'next-effect.txt');
    const fault = sqliteFault(f, { table, column: 'data_json', site, extra: () => f.calls.length > 0 });
    f.setProgram(async function* ({ call }) {
      if (call === 1) {
        if (tool === 'write') yield writeChunk(join(f.root, 'first-effect.txt'), 'first');
        else yield { type: 'tool_use', id: 'control', name: tool, input: tool === 'send_message' ? { target: 'main', message: 'bounded' } : {} };
      } else if (call === 2) yield writeChunk(effect);
      else yield { type: 'text', delta: 'done' };
    });
    const task = await f.start(); await f.settled(task);
    expect(fault.traces).toHaveLength(1); expect.soft(f.live().frozen).toBe('multi_agent_persistence_failed');
    expect.soft(f.rootContext().signal.aborted).toBe(true); expect(existsSync(effect)).toBe(false);
  });
});

describe('activity fixture cleanup ownership', () => {
  it.each([false, true])('retains the real open journal after fulfilled disposal with lease release before cleanup=%s', async releaseBeforeCleanup => {
    const actions: Cleanup = [];
    let ticket: ExecutionLease | undefined, bodyFailure: { error: unknown } | undefined;
    let removalAttempts = 0;
    try {
      const f = await activityFixture(actions);
      ticket = await f.coordinator.acquireLease({ policy: 'ordinary' });
      const created = fs.lstatSync(f.root), canonicalRoot = fs.realpathSync(f.root), originalRemove = fs.rmSync;
      expect(f.coordinator.snapshot().active).toBe(1);
      const raw = f.dispose(); expect(f.dispose()).toBe(raw); await raw;
      expect(f.service.runtimeStatus().blocked).toBe(false); expect(f.db.isOpen).toBe(true);
      expect(f.db.prepare('SELECT 1 AS one').get()).toMatchObject({ one: 1 });
      if (releaseBeforeCleanup) ticket.release();
      expect(f.coordinator.snapshot().active).toBe(releaseBeforeCleanup ? 0 : 1);
      expect(f.service.runtimeStatus().blocked).toBe(false); expect(f.db.isOpen).toBe(true);
      vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
        if (target === f.root) {
          removalAttempts++;
          console.info('XIAOK_ACTIVITY_RETAINED_ROOT ' + JSON.stringify({ version: 1, root: canonicalRoot,
            workerPid: process.pid, workerPpid: process.ppid, uid: process.getuid?.() ?? null,
            runToken: process.env.XIAOK_ACTIVITY_FORENSICS_RUN_TOKEN ?? null,
            stat: { dev: created.dev, ino: created.ino, uid: created.uid, birthtimeMs: created.birthtimeMs } }));
          throw new Error('activity_fixture_live_journal_removal_attempt');
        }
        return originalRemove(target, options);
      });
      syncBuiltinESMExports();
      let failure: unknown;
      try { await cleanupActivityCase(actions); } catch (error) { failure = error; }
      expect(failure).toBeUndefined(); expect(removalAttempts).toBe(0); expect(existsSync(f.root)).toBe(true);
    } catch (error) { bodyFailure = { error }; throw error; }
    finally {
      const errors: unknown[] = [];
      try { ticket?.release(); } catch (error) { errors.push(error); }
      try { await cleanupActivityCase(actions); } catch (error) { errors.push(error); }
      try { vi.restoreAllMocks(); } catch (error) { errors.push(error); }
      try { syncBuiltinESMExports(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError([...(bodyFailure ? [bodyFailure.error] : []), ...errors], 'activity_journal_case_cleanup_failed', { cause: bodyFailure?.error });
    }
  });

  it('preserves every unknown cleanup failure and still runs later actions and restores spies and environment', async () => {
    const first = new Error('first cleanup failure'), second = new Error('second cleanup failure');
    const order: string[] = [], target = { value: () => 'original' };
    const previous = process.env.XIAOK_ACTIVITY_CLEANUP_REGRESSION;
    vi.spyOn(target, 'value').mockReturnValue('mocked'); vi.stubEnv('XIAOK_ACTIVITY_CLEANUP_REGRESSION', 'stubbed');
    const actions: Cleanup = [() => { order.push('last'); }, () => { order.push('second'); throw second; }, () => { order.push('first'); throw first; }];
    let failure: unknown;
    try { await cleanupActivityCase(actions); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect((failure as AggregateError).errors[0]).toBe(first); expect((failure as AggregateError).errors[1]).toBe(second);
    expect(order).toEqual(['first', 'second', 'last']); expect(actions).toHaveLength(0);
    expect(target.value()).toBe('original'); expect(process.env.XIAOK_ACTIVITY_CLEANUP_REGRESSION).toBe(previous);
  });
});
