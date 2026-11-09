// @vitest-environment node
import { expect, it, vi, type TestContext } from 'vitest';
import { mkdtempSync, realpathSync, lstatSync, rmSync, existsSync, type Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { mapDesktopModelUsageAdmission, type DesktopModelUsageAdmission } from '../../electron/desktop-model-usage-admission.js';
import { MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { assertDesktopModelPhysicalIdle, waitDesktopModelPhysicalIdle, type DesktopModelPhysicalScope } from '../../electron/desktop-task-stream.js';

import {withFixture,usageEvents} from '../fixtures/model-usage-fixture.js';
import {deferred,outcome,type Fixture} from '../fixtures/model-usage-fixture-values.js';
import {observeCommands} from '../fixtures/model-usage-fixture-values.js';
it('memoizes the exact real command P and applies one durable event/operation', ctx => withFixture(ctx, async f => {
  const cap = f.capture('normal-usage'), commands = observeCommands(f);
  const p = f.track('normalCommit', cap.commit(11, 13));
  expect(Object.isFrozen(cap)).toBe(true); expect(p).toBe(commands[0]); expect(cap.commit(11, 13)).toBe(p);
  expect(() => cap.commit(12, 13)).toThrow('usage_id_conflict');
  await p;
  expect(commands).toHaveLength(1); expect(usageEvents(f)).toHaveLength(1);
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.usage).toEqual({ inputTokens: 11, outputTokens: 13 });
  expect(usageEvents(f)[0].payload).toMatchObject({ usageId: 'normal-usage', inputTokens: 11, outputTokens: 13 });
}));

it('settles an admitted receipt after actual actor cancellation while ordinary usage remains denied', ctx => withFixture(ctx, async f => {
  const cap = f.capture('before-cancellation');
  await f.cancel(); expect(f.context.signal.aborted).toBe(true);
  await expect(f.service.recordUsage(f.context, { usageId: 'unadmitted', inputTokens: 2, outputTokens: 3 })).rejects.toThrow();
  expect(() => f.service.captureAdmittedUsage(f.context, 'after-cancellation')).toThrow();
  await f.track('cancelledCommit', cap.commit(17, 19));
  expect(usageEvents(f)).toHaveLength(1);
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.usage).toEqual({ inputTokens: 17, outputTokens: 19 });
}));

it('rejects cloned/borrowed receivers and cross-service actors without revoking the original', ctx => withFixture(ctx, async f => {
  const cap = f.capture('receiver-owner');
  const clone = { ...cap };
  expect(() => clone.commit(1, 2)).toThrow('desktop_model_usage_admission_invalid');
  expect(() => cap.revoke.call(clone)).toThrow('desktop_model_usage_admission_invalid');
  expect(() => cap.commit.call({} as DesktopModelUsageAdmission, 1, 2)).toThrow('desktop_model_usage_admission_invalid');
  await withFixture(ctx, async other => {
    const otherCap = other.capture('other-service');
    expect(() => cap.commit.call(otherCap, 1, 2)).toThrow('desktop_model_usage_admission_invalid');
    expect(() => other.service.captureAdmittedUsage(f.context, 'foreign-context')).toThrow();
  });
  await f.track('receiverCommit', cap.commit(1, 2)); expect(usageEvents(f)).toHaveLength(1);
  cap.revoke(); cap.revoke();
  expect(() => cap.commit(1, 2)).toThrow('desktop_model_usage_admission_revoked');
}));

it('rejects durable turn and incarnation replacement before any usage transaction', ctx => withFixture(ctx, async f => {
  const cap = f.capture('fixed-identity'), before = f.store.getAgent(f.context.groupId, f.context.agentId)!;
  try {
    f.store.putAgent(f.context.groupId, { ...before, turn: before.turn + 1, turnId: 'different-turn' });
    expect(() => cap.commit(3, 5)).toThrow('desktop_model_usage_admission_stale');
    f.store.putAgent(f.context.groupId, { ...before, createdAt: before.createdAt + 1 });
    expect(() => cap.commit(3, 5)).toThrow('desktop_model_usage_admission_stale');
    expect(usageEvents(f)).toHaveLength(0);
  } finally { f.store.putAgent(f.context.groupId, before); }
}));

it('rejects store closure even when the original actor object still exists', ctx => withFixture(ctx, async f => {
  const cap = f.capture('closed-store');
  await f.finish(); f.store.close();
  expect(() => cap.commit(3, 5)).toThrow('desktop_model_usage_admission_stale');
}));

it('rejects every invalid token domain without queueing a factual command', ctx => withFixture(ctx, async f => {
  const cap = f.capture('invalid-tokens'), commands = observeCommands(f);
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => cap.commit(value, 1)).toThrow('invalid usage');
    expect(() => cap.commit(1, value)).toThrow('invalid usage');
  }
  expect(commands).toHaveLength(0); expect(usageEvents(f)).toHaveLength(0);
}));

it('rolls back overflow of the actual durable total without a usage event or operation', ctx => withFixture(ctx, async f => {
  const cap = f.capture('overflow'), before = f.store.getAgent(f.context.groupId, f.context.agentId)!;
  f.store.putAgent(f.context.groupId, { ...before, usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 } });
  await expect(f.track('overflowCommit', cap.commit(1, 0))).rejects.toThrow('invalid usage');
  expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.usage).toEqual({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 });
  expect(usageEvents(f)).toHaveLength(0);
}));

it('memoizes complete C separately from P and waits for the one original journal J', ctx => withFixture(ctx, async f => {
  const original = f.capture('mapped-journal'), commands = observeCommands(f), entered = deferred<void>(), journal = deferred<void>();
  let calls = 0, complete = false;
  f.keep('journalHold', journal); f.keep('journalEntered', entered);
  const cap = f.keep('mappedCap', mapDesktopModelUsageAdmission(original, () => { calls++; entered.resolve(); return f.track('journalJ', journal.promise); }));
  const c = f.track('mappedC', cap.commit(7, 9)); const settled = f.track('mappedSettlement', c.then(() => { complete = true; }));
  try {
    expect(cap.commit(7, 9)).toBe(c); expect(() => cap.commit(7, 10)).toThrow('usage_id_conflict');
    await entered.promise;
    expect(commands).toHaveLength(1); expect(c).not.toBe(commands[0]);
    expect(complete).toBe(false); expect(calls).toBe(1); expect(usageEvents(f)).toHaveLength(1);
    journal.resolve(); await c; await settled;
    expect(complete).toBe(true); expect(cap.commit(7, 9)).toBe(c); expect(calls).toBe(1);
    const clone = { ...cap };
    expect(() => clone.commit(7, 9)).toThrow('desktop_model_usage_admission_invalid');
    expect(() => cap.revoke.call(clone)).toThrow('desktop_model_usage_admission_invalid');
    cap.revoke(); cap.revoke(); expect(() => cap.commit(7, 9)).toThrow('desktop_model_usage_admission_revoked');
  } finally { journal.resolve(); await outcome(c); }
}));

for (const [name, reason] of [['Error', Error('original journal failure')], ['undefined', undefined], ['null', null]] as const) {
  it(`keeps journal rejection ${name} as the same failed C without a second J`, ctx => withFixture(ctx, async f => {
    const original = f.capture('failed-journal'), commands = observeCommands(f);
    let calls = 0;
    const cap = f.keep('failedMappedCap', mapDesktopModelUsageAdmission(original, () => { calls++; return f.track('failedJournalJ', Promise.reject(reason)); }));
    const c = f.track('failedMappedC', cap.commit(5, 6)); const result = await outcome(c);
    expect(result.ok).toBe(false); if (result.ok) throw Error('expected original journal rejection');
    expect(result.error).toBe(reason); expect(cap.commit(5, 6)).toBe(c);
    const repeated = await outcome(cap.commit(5, 6)); expect(repeated.ok).toBe(false);
    if (repeated.ok) throw Error('expected repeated original journal rejection');
    expect(repeated.error).toBe(reason); expect(calls).toBe(1); expect(commands).toHaveLength(1);
    expect(c).not.toBe(commands[0]); expect(usageEvents(f)).toHaveLength(1); cap.revoke();
  }));
}

it('revokes the original receipt if request-wrapper construction is rejected', ctx => withFixture(ctx, async f => {
  const original = f.capture('construction-failure');
  expect(() => mapDesktopModelUsageAdmission(original, undefined as never)).toThrow('desktop_model_usage_admission_invalid');
  expect(() => original.commit(1, 1)).toThrow('desktop_model_usage_admission_revoked');
  expect(usageEvents(f)).toHaveLength(0);
}));
