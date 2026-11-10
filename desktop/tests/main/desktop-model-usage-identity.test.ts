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
import {outcome,type Fixture} from '../fixtures/model-usage-fixture-values.js';
import {observeCommands} from '../fixtures/model-usage-fixture-values.js';
// Mutate the actual private SQLite row, never a replacement getAgent result.
// Restore the exact bytes before host disposal so the intentional corruption
// cannot alter the unrelated original root owner's final factual publication.
it('durable identity: refuses capture when the actual agent row JSON id differs from its SQL key', ctx => withFixture(ctx, async f => {
  const row = f.db.prepare('SELECT agent_id,data_json FROM agents WHERE group_id=? AND agent_id=?')
    .get(f.context.groupId, f.context.agentId) as { agent_id: string; data_json: string };
  const changed = { ...JSON.parse(row.data_json), id: 'different-durable-agent-id' };
  try {
    f.db.prepare('UPDATE agents SET data_json=? WHERE group_id=? AND agent_id=?')
      .run(JSON.stringify(changed), f.context.groupId, f.context.agentId);
    const actual = f.db.prepare('SELECT agent_id,json_extract(data_json,\'$.id\') AS json_id FROM agents WHERE group_id=? AND agent_id=?')
      .get(f.context.groupId, f.context.agentId) as { agent_id: string; json_id: string };
    expect(actual.agent_id).toBe(f.context.agentId); expect(actual.json_id).toBe(changed.id);
    expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.id).toBe(changed.id);
    let failure: { error: unknown } | undefined;
    try { f.capture('corrupt-agent-before-capture'); } catch (error) { failure = { error }; }
    expect(failure).toBeDefined();
    expect(usageEvents(f)).toHaveLength(0);
    f.expectIntegrityFailure(failure!.error);
  } finally {
    f.db.prepare('UPDATE agents SET data_json=? WHERE group_id=? AND agent_id=?')
      .run(row.data_json, f.context.groupId, f.context.agentId);
  }
}));

it('durable identity: refuses queued settlement when actual SQL created_at diverges from unchanged agent JSON', ctx => withFixture(ctx, async f => {
  const cap = f.capture('corrupt-agent-after-queue');
  const row = f.db.prepare('SELECT created_at,data_json FROM agents WHERE group_id=? AND agent_id=?')
    .get(f.context.groupId, f.context.agentId) as { created_at: number; data_json: string };
  const raw = f.track('originalIdentityCommit', cap.commit(3, 5)), result = outcome(raw);
  try {
    f.db.prepare('UPDATE agents SET created_at=? WHERE group_id=? AND agent_id=?')
      .run(row.created_at + 1, f.context.groupId, f.context.agentId);
    const actual = f.db.prepare('SELECT created_at,data_json FROM agents WHERE group_id=? AND agent_id=?')
      .get(f.context.groupId, f.context.agentId) as { created_at: number; data_json: string };
    expect(actual.created_at).toBe(row.created_at + 1); expect(actual.data_json).toBe(row.data_json);
    const settled = await result;
    expect(settled.ok).toBe(false);
    expect(usageEvents(f)).toHaveLength(0);
    if (settled.ok) throw Error('expected actual identity rejection');
    f.expectIntegrityFailure(settled.error);
  } finally {
    await result;
    f.db.prepare('UPDATE agents SET created_at=?,data_json=? WHERE group_id=? AND agent_id=?')
      .run(row.created_at, row.data_json, f.context.groupId, f.context.agentId);
  }
}));

const durableDrifts = [
  'group-json-groupId', 'group-json-threadId', 'group-sql-thread_id', 'group-sql-boot_id',
  'group-sql-created_at', 'agent-json-id', 'agent-sql-parent_id', 'agent-sql-created_at',
] as const;
type SqlRow = Record<string, string | number | null>;
const factualTables = ['groups', 'agents', 'events', 'messages', 'contents', 'operations', 'root_turns',
  'managed_resources', 'activity_runs', 'activity_members'] as const;

for (const boundary of ['factory', 'queued'] as const) {
  it.for(durableDrifts)(`durable matrix ${boundary}: refuses %s without changing another actual group or its thread index`, (drift, ctx) => withFixture(ctx, async f => {
    // H, its root agent and B are real rows in the same database, not mocked
    // identities returned by a getter. H has a distinct, existing thread.
    f.service.registerThread({ threadId: 'usage-other-thread', profileId: 'usage-profile', workspaceId: 'usage-workspace', cwd: f.context.cwd });
    const h = f.store.createGroup('usage-other-thread');
    const hRoot = f.store.getAgent(h.groupId, `root_${h.groupId}`)!;
    f.store.putAgent(h.groupId, { ...hRoot, resourcesReleased: true, cleanupPending: false });
    const bId = `identity-witness-${randomUUID()}`;
    f.store.putAgent(f.context.groupId, { id: bId, parentId: null, taskName: 'identity_witness', canonicalName: '/identity_witness',
      depth: 0, status: 'closed', turn: 0, resourcesReleased: true, cleanupPending: false });
    const originalG = f.db.prepare('SELECT * FROM groups WHERE group_id=?').get(f.context.groupId) as SqlRow;
    const originalA = f.db.prepare('SELECT * FROM agents WHERE group_id=? AND agent_id=?').get(f.context.groupId, f.context.agentId) as SqlRow;
    const originalH = f.db.prepare('SELECT * FROM groups WHERE group_id=?').get(h.groupId) as SqlRow;
    const snapshotH = () => factualTables.map(table => ({ table,
      rows: f.db.prepare(`SELECT * FROM ${table} WHERE group_id=? ORDER BY rowid`).all(h.groupId) }));
    const beforeH = snapshotH(), beforeB = f.store.getAgent(f.context.groupId, bId);
    const beforeThreads = f.db.prepare('SELECT * FROM thread_bindings WHERE thread_id IN (?,?) ORDER BY thread_id')
      .all('usage-thread', 'usage-other-thread');
    const beforeEvents = f.db.prepare('SELECT * FROM events WHERE group_id=? ORDER BY seq').all(f.context.groupId);
    const beforeOperations = f.db.prepare('SELECT * FROM operations WHERE group_id=? ORDER BY operation_id').all(f.context.groupId);
    const beforeUsage = f.store.getAgent(f.context.groupId, f.context.agentId)!.usage;
    const cap = boundary === 'queued' ? f.capture(`matrix-${drift}`) : undefined;
    // P is published before the queued microtask executes. No await is allowed
    // between this call and the real SQL mutation below.
    const pending = cap ? outcome(f.track('matrixCommit', cap.commit(3, 5))) : undefined;
    const writeRow = (table: 'groups' | 'agents', row: SqlRow) => {
      const columns = Object.keys(row).filter(column => column !== 'group_id' && (table !== 'agents' || column !== 'agent_id'));
      f.db.prepare(`UPDATE ${table} SET ${columns.map(column => `${column}=?`).join(',')} WHERE group_id=?${table === 'agents' ? ' AND agent_id=?' : ''}`)
        .run(...columns.map(column => row[column]), row.group_id, ...(table === 'agents' ? [row.agent_id] : []));
    };
    try {
      const table = drift.startsWith('group-') ? 'groups' : 'agents';
      const original = table === 'groups' ? originalG : originalA;
      const changed = { ...original };
      if (drift === 'group-json-groupId' || drift === 'group-json-threadId' || drift === 'agent-json-id') {
        const json = JSON.parse(String(original.data_json));
        if (drift === 'group-json-groupId') json.groupId = h.groupId;
        else if (drift === 'group-json-threadId') json.threadId = 'usage-other-thread';
        else json.id = bId;
        changed.data_json = JSON.stringify(json);
      } else if (drift === 'group-sql-thread_id') changed.thread_id = 'usage-other-thread';
      else if (drift === 'group-sql-boot_id') changed.boot_id = 'different-physical-boot';
      else if (drift === 'agent-sql-parent_id') changed.parent_id = bId;
      else changed.created_at = Number(original.created_at) + 1;
      writeRow(table, changed);
      const actual = f.db.prepare(`SELECT * FROM ${table} WHERE group_id=?${table === 'agents' ? ' AND agent_id=?' : ''}`)
        .get(f.context.groupId, ...(table === 'agents' ? [f.context.agentId] : []));
      expect(actual).toEqual(changed);
      const result = pending ? await pending : await outcome(Promise.resolve().then(() => f.capture(`matrix-${drift}`)));
      // Inspect all cross-identity side effects before asserting refusal. This
      // also detects the rejected-v4 spread/freeze write into existing H.
      expect(snapshotH()).toEqual(beforeH);
      expect(f.db.prepare('SELECT byte_usage FROM groups WHERE group_id=?').get(h.groupId)).toEqual({ byte_usage: originalH.byte_usage });
      expect(f.db.prepare('SELECT thread_id FROM groups WHERE group_id=?').get(f.context.groupId)).toEqual({ thread_id: changed.thread_id ?? originalG.thread_id });
      expect(f.db.prepare('SELECT * FROM thread_bindings WHERE thread_id IN (?,?) ORDER BY thread_id').all('usage-thread', 'usage-other-thread')).toEqual(beforeThreads);
      expect(f.store.getAgent(f.context.groupId, bId)).toEqual(beforeB);
      expect(f.store.getAgent(f.context.groupId, f.context.agentId)!.usage).toEqual(beforeUsage);
      expect(f.db.prepare('SELECT * FROM events WHERE group_id=? ORDER BY seq').all(f.context.groupId)).toEqual(beforeEvents);
      expect(f.db.prepare('SELECT * FROM operations WHERE group_id=? ORDER BY operation_id').all(f.context.groupId)).toEqual(beforeOperations);
      expect(result.ok).toBe(false);
      if (result.ok) throw Error('expected actual matrix identity rejection');
      f.expectIntegrityFailure(result.error);
    } finally {
      if (pending) await pending;
      // Exact pre-corruption rows, including H if a buggy freeze overwrote it.
      // Do not normalize through a getter which has discarded the SQL keys.
      writeRow('groups', originalG); writeRow('groups', originalH); writeRow('agents', originalA);
    }
  }));
}

it('durable pre-COMMIT: swallowing an actual identity failure cannot commit earlier probe or later port/control writes', ctx => withFixture(ctx, async f => {
  const bId = `transaction-witness-${randomUUID()}`;
  f.store.putAgent(f.context.groupId, { id: bId, parentId: null, taskName: 'transaction_witness', canonicalName: '/transaction_witness',
    depth: 0, status: 'closed', turn: 0, resourcesReleased: true, cleanupPending: false });
  const row = f.db.prepare('SELECT data_json FROM agents WHERE group_id=? AND agent_id=?')
    .get(f.context.groupId, f.context.agentId) as { data_json: string };
  const originalGroup = f.store.requireGroup(f.context.groupId);
  const originalGroupRow = f.db.prepare('SELECT * FROM groups WHERE group_id=?').get(f.context.groupId) as SqlRow;
  const operationId = `identity-probe-${randomUUID()}`, lateOperationId = `${operationId}-late`;
  const failure: { value: unknown }[] = [], portFailure: { value: unknown }[] = [], controlFailure: { value: unknown }[] = [];
  let transactionResult: { ok: true; value: unknown } | { ok: false; error: unknown };
  try {
    try {
      const value = f.store.transaction(port => {
        port.putOperation({ groupId: f.context.groupId, operationId, command: 'usage', requestHash: 'before-identity-probe',
          applyState: 'applied', result: { state: 'completed' } });
        f.db.prepare('UPDATE agents SET data_json=? WHERE group_id=? AND agent_id=?')
          .run(JSON.stringify({ ...JSON.parse(row.data_json), id: bId }), f.context.groupId, f.context.agentId);
        expect(f.store.getAgent(f.context.groupId, f.context.agentId)?.id).toBe(bId);
        try { f.capture('inside-original-transaction'); } catch (error) { failure.push({ value: error }); }
        // Swallow the expected failure deliberately. Do not throw a test
        // assertion here: only the original store exit gate may force rollback.
        try { port.putOperation({ groupId: f.context.groupId, operationId: lateOperationId, command: 'usage', requestHash: 'after-identity-probe',
          applyState: 'applied', result: { state: 'completed' } }); }
        catch (error) { portFailure.push({ value: error }); }
        try { f.store.putGroup({ ...originalGroup, mutationBlockedReason: 'must-not-write-after-integrity-failure' }, true); }
        catch (error) { controlFailure.push({ value: error }); }
        return 'original callback swallowed its failure';
      });
      transactionResult = { ok: true, value };
    } catch (error) { transactionResult = { ok: false, error }; }
    // The outer transaction, not a test assertion thrown in its callback, must
    // roll back the successful earlier statement as well as the corrupt row.
    expect(f.db.prepare('SELECT operation_id FROM operations WHERE group_id=? AND operation_id IN (?,?)')
      .all(f.context.groupId, operationId, lateOperationId)).toEqual([]);
    expect(f.db.prepare('SELECT data_json FROM agents WHERE group_id=? AND agent_id=?').get(f.context.groupId, f.context.agentId)).toEqual(row);
    expect(failure).toHaveLength(1); expect(portFailure).toHaveLength(1); expect(controlFailure).toHaveLength(1);
    expect(portFailure[0].value).toBe(failure[0].value); expect(controlFailure[0].value).toBe(failure[0].value);
    expect(transactionResult.ok).toBe(false);
    if (transactionResult.ok) throw Error('expected original store exit failure');
    expect(transactionResult.error).toBe(failure[0].value);
    f.expectIntegrityFailure(transactionResult.error);
  } finally {
    f.db.prepare('UPDATE agents SET data_json=? WHERE group_id=? AND agent_id=?').run(row.data_json, f.context.groupId, f.context.agentId);
    f.db.prepare('DELETE FROM operations WHERE group_id=? AND operation_id IN (?,?)').run(f.context.groupId, operationId, lateOperationId);
    // Repair only this fixture's deliberate old-code control write before the
    // unrelated root-owner finalization. New code must never perform that write.
    const columns = Object.keys(originalGroupRow).filter(column => column !== 'group_id');
    f.db.prepare(`UPDATE groups SET ${columns.map(column => `${column}=?`).join(',')} WHERE group_id=?`)
      .run(...columns.map(column => originalGroupRow[column]), f.context.groupId);
  }
}));
