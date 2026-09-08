// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import type { HostDeliveryRecord, HostDeliveryReport } from '../../../src/runtime/task-host/delivery-types.js';
import { bounded, createPostSealHarness, deferred, type PostSealHarness } from '../fixtures/desktop-post-seal-harness.js';

describe('R4 actual service report boundary: durable seal, captured input and one short queue', () => {
  const fixtures: PostSealHarness[] = []; const releases: Array<() => void> = []; const tasks: Promise<unknown>[] = [];
  afterEach(async () => {
    vi.restoreAllMocks(); for (const release of releases.splice(0)) release();
    await Promise.allSettled(tasks.splice(0));
    for (const fixture of fixtures.splice(0)) await fixture.close();
  });
  async function setup(options: { spawnChild?: boolean; active?: boolean } = {}) {
    const tail = deferred(); const body = deferred(); const entered = deferred();
    releases.push(() => tail.resolve(), () => body.resolve());
    const f = await createPostSealHarness({ spawnChild: options.spawnChild ?? false,
      emit: async () => { entered.resolve(); if (options.active) await body.promise; }, runnerTail: () => tail.promise }); fixtures.push(f);
    return { f, tail, body, entered };
  }
  async function sealed(spawnChild = false) {
    const value = await setup({ spawnChild }); const taskId = await value.f.start(); await bounded(value.f.rootSealed.promise);
    return { ...value, taskId, report: reportFor(value.f, taskId) };
  }
  function reportFor(f: PostSealHarness, taskId: string): HostDeliveryReport {
    const binding = f.store.getRootBinding(taskId)!;
    return { source: { sourceTaskId: taskId, groupId: binding.groupId, rootTurnId: binding.rootTurnId,
      rootEpoch: binding.rootEpoch, preparationId: binding.preparationId, bootId: binding.bootId },
    delivery: { version: 1, revision: 1, status: 'checking', stage: 'flush', verification: 'pending', hostSettlement: 'pending',
      readerCleanup: 'none', storeCleanup: 'none', startedAt: 1000, deadlineAt: 3000 } };
  }
  function send(f: PostSealHarness, report: HostDeliveryReport) {
    return f.service.recordHostDelivery({ requestSource: 'scheduler', authority: f.service.bindHostDeliveryOwner(f.host), report });
  }
  function advanced(report: HostDeliveryReport): HostDeliveryReport {
    return { source: { ...report.source }, delivery: { ...report.delivery, revision: 2, stage: 'snapshot' } };
  }
  function facts(f: PostSealHarness) {
    const db = new DatabaseSync(join(f.root, 'groups.sqlite'), { readOnly: true });
    try { return {
      groups: db.prepare('SELECT group_id,byte_usage,data_json FROM groups ORDER BY group_id').all(),
      roots: db.prepare('SELECT source_task_id,logical_bytes,data_json FROM root_turns ORDER BY source_task_id').all(),
      agents: db.prepare('SELECT group_id,agent_id,logical_bytes,data_json FROM agents ORDER BY group_id,agent_id').all(),
      events: db.prepare('SELECT group_id,seq,logical_bytes,data_json FROM events ORDER BY group_id,seq').all(),
    }; } finally { db.close(); }
  }
  function queues(f: PostSealHarness) {
    // Read the actual queue owners only. Tests never replace the sequencer,
    // insert an async command into it, or reproduce its batching algorithm.
    return f.service as unknown as {
      groups: Map<string, { commands: MultiAgentCommandSequencer }>;
      resourceCommands: Map<string, { commands: MultiAgentCommandSequencer; users: number }>;
    };
  }

  it.each(['preparing', 'queued', 'active'] as const)('first checking rejects actual durable root phase=%s despite a valid bound host and all six source fields', async phase => {
    const { f, entered } = await setup({ active: phase === 'active' }); let taskId: string;
    if (phase === 'preparing') {
      const prepareEntered = deferred(); const prepareRelease = deferred(); releases.push(() => prepareRelease.resolve());
      const original = f.host.prepareTask.bind(f.host);
      vi.spyOn(f.host, 'prepareTask').mockImplementation(async (...args) => { prepareEntered.resolve(); await prepareRelease.promise; return original(...args); });
      const preparation = f.service.prepareRoot(f.host, 'post-seal-thread', { prompt: 'Preparing actual host', materials: [] }); tasks.push(preparation);
      await bounded(prepareEntered.promise);
      taskId = (facts(f).roots[0] as { source_task_id: string }).source_task_id;
    } else if (phase === 'queued') taskId = (await f.service.prepareRoot(f.host, 'post-seal-thread', { prompt: 'Queued actual root', materials: [] })).taskId;
    else { taskId = await f.start(); await bounded(entered.promise); }
    const report = reportFor(f, taskId); expect(f.store.getRootBinding(taskId)?.phase).toBe(phase);
    const before = facts(f);
    const outcome = await send(f, report).then(ack => ({ accepted: true, ack }), error => ({ accepted: false, error }));
    expect.soft(outcome.accepted).toBe(false);
    expect.soft(facts(f)).toEqual(before); expect.soft(f.store.getRootBinding(taskId)).not.toHaveProperty('delivery');
  });

  it.each(['mutate-nested', 'replace-report'] as const)('captures the caller report before enqueue: %s cannot change the committed source or marker', async mutation => {
    const { f, taskId, report } = await sealed(); const expected = structuredClone(report);
    const input = { requestSource: 'scheduler' as const, authority: f.service.bindHostDeliveryOwner(f.host), report };
    const pending = f.service.recordHostDelivery(input);
    if (mutation === 'mutate-nested') {
      input.report.source.sourceTaskId = 'late-caller-source'; input.report.delivery.revision = 99;
      Object.assign(input.report.delivery, { detail: 'late untrusted metadata' });
    } else input.report = { ...advanced(report), source: { ...report.source, groupId: '55555555-5555-4555-8555-555555555555' } };
    expect(f.store.getRootBinding(taskId)).not.toHaveProperty('delivery');
    await pending;
    expect(f.store.getRootBinding(taskId)?.delivery).toEqual(expected.delivery);
    expect(f.store.readEvents(expected.source.groupId).filter(event => event.kind === 'delivery')).toHaveLength(1);
    expect(f.store.readEvents(expected.source.groupId).at(-1)?.payload).toEqual(expected);
  });

  it.each(['live-group', 'existing-resource-owner'] as const)('report reuses %s FIFO across bounded flushes instead of creating a second queue', async population => {
    const { f, report } = await sealed(population === 'live-group'); const map = queues(f); const timeline: string[] = [];
    const unsubscribe = f.store.subscribe(event => { if (event.kind === 'delivery') timeline.push(`report-${(event.payload.delivery as { revision: number }).revision}`); });
    let first: Promise<unknown> | undefined; let queue: MultiAgentCommandSequencer;
    if (population === 'live-group') {
      expect(map.groups.has(report.source.groupId)).toBe(true); queue = map.groups.get(report.source.groupId)!.commands;
    } else {
      expect(map.groups.has(report.source.groupId)).toBe(false);
      first = send(f, report); queue = map.resourceCommands.get(report.source.groupId)!.commands;
    }
    try {
      const ordered = Array.from({ length: 70 }, (_, index) => queue.run(() => { timeline.push(`queued-${index}`); }));
      const pending = send(f, first ? advanced(report) : report);
      expect(map.resourceCommands.get(report.source.groupId)?.commands).toBe(queue);
      await Promise.all([...ordered, pending, ...(first ? [first] : [])]);
      expect(timeline.indexOf('queued-69')).toBeLessThan(timeline.indexOf(first ? 'report-2' : 'report-1'));
      expect(f.store.getRootBinding(report.source.sourceTaskId)?.delivery?.revision).toBe(first ? 2 : 1);
    } finally { unsubscribe(); }
  });

  it.each(['version', 'status', 'stage', 'cleanup', 'revision-type', 'extra-metadata', 'missing-stage', 'missing-verification'] as const)(
    'does not silently repair corrupt durable delivery.%s by accepting a later otherwise-valid report', async corruption => {
      const { f, taskId, report } = await sealed(); await send(f, report);
      const bad = structuredClone(report.delivery) as unknown as Record<string, unknown>;
      if (corruption === 'version') bad.version = 2;
      if (corruption === 'status') bad.status = 'fabricated';
      if (corruption === 'stage') bad.stage = 'fabricated';
      if (corruption === 'cleanup') bad.storeCleanup = 'fabricated';
      if (corruption === 'revision-type') bad.revision = '1';
      if (corruption === 'extra-metadata') bad.detail = 'malformed historical free metadata';
      if (corruption === 'missing-stage') delete bad.stage;
      if (corruption === 'missing-verification') delete bad.verification;
      // Use the real store/encoder/SQLite to represent an invalid historical
      // row. No parser/reducer/transaction logic is supplied by the fixture.
      f.store.putRootBinding({ ...f.store.getRootBinding(taskId)!, delivery: bad as unknown as HostDeliveryRecord }, true);
      const before = facts(f);
      await expect(send(f, advanced(report))).rejects.toThrow();
      expect(facts(f)).toEqual(before);
    });

  it('store close after report enqueue revokes the registered callback before any transaction or projection write', async () => {
    const { f, report } = await sealed(); await send(f, report);
    const authority = f.service.bindHostDeliveryOwner(f.host); const before = facts(f);
    const transaction = vi.spyOn(f.store, 'transaction'); const root = vi.spyOn(f.store, 'putRootBinding'); const event = vi.spyOn(f.store, 'appendEvent');
    const pending = f.service.recordHostDelivery({ requestSource: 'scheduler', authority, report: advanced(report) });
    const observed = pending.then(() => ({ accepted: true }), error => ({ accepted: false, error }));
    const shutdown = f.service.dispose(); f.store.close(); await shutdown;
    const outcome = await observed; expect(outcome.accepted).toBe(false);
    expect('error' in outcome && String(outcome.error)).toContain('host_delivery_store_closed');
    expect(transaction).not.toHaveBeenCalled(); expect(root).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled();
    expect(facts(f)).toEqual(before);
  });

  it('a live current-boot host authority cannot claim the recovery-only unknown/committed failed-host exception', async () => {
    const { f, report } = await sealed(); await send(f, report); const before = facts(f);
    const recovery: HostDeliveryReport = { source: { ...report.source }, delivery: { ...report.delivery,
      revision: 2, stage: 'settle', status: 'unknown', hostSettlement: 'committed', hostTerminalStatus: 'failed', finishedAt: 3500,
      guardFailure: { code: 'recovery_unconfirmed', stage: 'settle', needsExplicitFollowup: true } } };
    expect(report.source.bootId).toBe(f.store.bootId);
    const outcome = await send(f, recovery).then(ack => ({ accepted: true, ack }), error => ({ accepted: false, error }));
    expect.soft(outcome.accepted).toBe(false);
    expect.soft(facts(f)).toEqual(before);
  });
});
