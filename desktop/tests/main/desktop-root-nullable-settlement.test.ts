// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { assertDesktopModelPhysicalIdle, type DesktopModelPhysicalScope } from '../../electron/desktop-task-stream.js';
import { deferred, withRootUsageOwner } from '../fixtures/root-usage-ownership.js';

const probe = vi.hoisted(() => ({ owners: new Map<object, any>() }));
vi.mock('../../electron/desktop-task-stream.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/desktop-task-stream.js')>();
  return { ...actual, closeDesktopModelPhysicalScope: function(this: unknown, ...args: Parameters<typeof actual.closeDesktopModelPhysicalScope>) {
    const raw = Reflect.apply(actual.closeDesktopModelPhysicalScope, this, args);
    probe.owners.get(args[0])?.close(args[0], args[1], raw, new Error('owned nullable close observation').stack); return raw;
  } };
});

it.for([undefined, null] as const)('actual root keeps body %s and the one native settlement failure with own cause', (primitive, ctx) => withRootUsageOwner(ctx, 'nullable', async owner => {
  const store = owner.keep('store', new DesktopMultiAgentStore(join(owner.root, 'groups.sqlite'))); owner.attachStore(store);
  const db = (store as unknown as { db: DatabaseSync }).db;
  const coordinator = owner.coordinator = owner.keep('coordinator', new DesktopExecutionCoordinator());
  const service = owner.service = owner.keep('service', new DesktopMultiAgentService({ store, coordinator,
    createSession: async () => { throw Error('nullable literal root never requests a child'); } }));
  service.registerThread({ threadId: 'nullable-root-thread', profileId: 'owned-profile', workspaceId: 'owned-workspace', cwd: owner.root });
  const materials = owner.materials = owner.keep('materials', new MaterialRegistry({ workspaceRoot: join(owner.root, 'materials'), maxBytes: 1048576 }));
  const closes: Array<{ scope: DesktopModelPhysicalScope; raw: Promise<void>; stack?: string }> = [];
  const runnerEntered = owner.keep('runnerEnteredBarrier', deferred());
  let rootP!: Promise<unknown>, context!: DesktopAgentExecutionContext, scope!: DesktopModelPhysicalScope;
  let triggerInstalled = false, schemaRow: unknown, beforeTarget: unknown, nativeU: { error: unknown } | undefined;
  let targetCalls = 0, nativeFailures = 0, validationFailure: { error: unknown } | undefined;
  let rootFailure: { error: unknown } | undefined;
  const extras: unknown[] = [], nativeErrors: unknown[] = [], targetStacks: string[] = [];
  const name = `owned_root_settlement_${owner.identity.nonce.replaceAll('-', '')}`;
  expect(name).toMatch(/^owned_root_settlement_[a-f0-9]{32}$/);
  const state = owner.keep('nullableObserverState', { close: (actual: DesktopModelPhysicalScope, reason: unknown, raw: Promise<void>, stack?: string) => {
    closes.push({ scope: actual, raw, stack }); owner.keep(`closeReason:${closes.length}`, { reason }); owner.watch('originalNullablePhysicalClose', raw);
  } }); owner.keep('physicalObserverDispatch', probe.owners);
  owner.keep('targetNativeFailureBox', () => nativeU); owner.keep('targetStacks', targetStacks); owner.keep('extraFailures', extras); owner.keep('nativeErrorOriginals', nativeErrors); owner.keep('closes', closes);
  const put = store.putAgent;
  const putSpy = vi.spyOn(store, 'putAgent').mockImplementation(function(this: DesktopMultiAgentStore, ...args) {
    const target = triggerInstalled && context && args[0] === context.groupId && args[1].id === context.agentId
      && args[1].activationState === 'settled';
    if (target) {
      targetCalls++; targetStacks.push(new Error('owned actual target putAgent').stack ?? '');
      beforeTarget = db.prepare('SELECT group_id,agent_id,data_json FROM agents WHERE group_id=? AND agent_id=?').get(context.groupId, context.agentId);
    }
    try { return Reflect.apply(put, this, args); }
    catch (error) {
      nativeErrors.push(error);
      if (target) { nativeFailures++; nativeU ??= { error }; if (nativeFailures > 1) extras.push(error); }
      else extras.push(error);
      throw error;
    }
  }); owner.restores.push(() => putSpy.mockRestore());
  const host = owner.host = owner.keep('host', new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(owner.root, 'tasks')), materialRegistry: materials,
    runner: input => {
      const raw = service.runRoot(input, async current => {
        context = owner.keep('actualRootContext', current); owner.keep('actualTicket', context.memberTicket);
        scope = owner.keep('actualRootScope', service.captureRootModelPhysicalScope(context)); probe.owners.set(scope, state); assertDesktopModelPhysicalIdle(scope);
        expect(context.groupId).toMatch(/^[a-zA-Z0-9_-]+$/); expect(context.agentId).toMatch(/^[a-zA-Z0-9_-]+$/);
        const before = store.getAgent(context.groupId, context.agentId)!; expect(before.activationState).toBe('active');
        db.exec(`CREATE TEMP TRIGGER "${name}" BEFORE UPDATE OF data_json ON agents
          WHEN NEW.group_id='${context.groupId}' AND NEW.agent_id='${context.agentId}'
            AND coalesce(json_extract(OLD.data_json,'$.activationState'),'')<>'settled'
            AND json_extract(NEW.data_json,'$.activationState')='settled'
          BEGIN SELECT RAISE(ABORT,'owned_nullable_final_settlement'); END`);
        triggerInstalled = true;
        schemaRow = owner.keep('installedTriggerRow', db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_temp_schema WHERE name=?').get(name));
        expect(schemaRow).toMatchObject({ type: 'trigger', name, tbl_name: 'agents' });
        throw primitive;
      }); rootP = owner.watch('actualNullableRunRoot', raw); runnerEntered.resolve(); return raw;
    }, authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
    decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason) }));
  try {
    await owner.watch('initialize', service.initialize(host));
    const prepared = await owner.watch('prepareRoot', service.prepareRoot(host, 'nullable-root-thread', { prompt: 'Literal original root throws the parameter.', materials: [] }));
    await owner.watch('startTask', host.startTask(prepared.taskId));
    await runnerEntered.promise;
    const result = await owner.outcome(rootP); expect(result.ok).toBe(false);
    if (result.ok) throw Error('nullable_original_root_rejection_missing'); rootFailure = { error: result.error };
    expect(result.error).toBeInstanceOf(AggregateError);
    const error = result.error as AggregateError;
    expect(Object.hasOwn(error, 'errors')).toBe(true); expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toBe(primitive); expect(error.errors[1]).toBe(nativeU?.error);
    expect(Object.hasOwn(error, 'cause')).toBe(true); expect(error.cause).toBe(primitive);
    expect(nativeU).toBeDefined(); expect(nativeU!.error).toBeInstanceOf(Error);
    expect((nativeU!.error as any).code).toBe('ERR_SQLITE_ERROR'); expect(Number.isSafeInteger((nativeU!.error as any).errcode)).toBe(true);
    expect(targetCalls).toBe(1); expect(nativeFailures).toBe(1); expect(targetStacks[0]).toContain('desktop-multi-agent-service.ts:2522');
    expect(closes).toHaveLength(1); expect(closes[0].scope).toBe(scope); expect(closes[0].stack).toContain('desktop-multi-agent-service.ts:2492'); await closes[0].raw;
    await owner.watch('actualHostDrain', host.drain()); assertDesktopModelPhysicalIdle(scope);
    expect(context.memberTicket.released).toBe(true); expect(coordinator.snapshot().active).toBe(0);
    expect(db.prepare('SELECT group_id,agent_id,data_json FROM agents WHERE group_id=? AND agent_id=?').get(context.groupId, context.agentId)).toEqual(beforeTarget);
    expect(store.getAgent(context.groupId, context.agentId)?.activationState).not.toBe('settled');
    owner.retainVerifiedRoot(rootP, result.error);
  } catch (error) { validationFailure = { error }; }
  finally {
    // Never remove the fault before the actual original root/physical/finally.
    // A validator failure cannot skip this owned drop attempt or disposal.
    try {
      if (!rootP) throw Error('nullable_original_root_not_started');
      const original = await owner.outcome(rootP); if (!original.ok) rootFailure ??= { error: original.error };
      await owner.watch('dropPrerequisiteHostDrain', host.drain());
      expect(closes.length).toBeGreaterThan(0); await closes[0].raw; assertDesktopModelPhysicalIdle(scope);
      expect(context.memberTicket.released).toBe(true); expect(coordinator.snapshot().active).toBe(0);
      expect(db.isTransaction).toBe(false); expect(owner.nativeOpen(db)).toBe(true);
      if (!triggerInstalled) throw Error('nullable_owned_trigger_missing');
      const beforeDrop = db.prepare('SELECT group_id,agent_id,data_json FROM agents WHERE group_id=? AND agent_id=?').get(context.groupId, context.agentId);
      expect(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_temp_schema WHERE name=?').get(name)).toEqual(schemaRow);
      db.exec(`DROP TRIGGER temp."${name}"`); triggerInstalled = false;
      expect(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_temp_schema WHERE name=?').get(name)).toBeUndefined();
      expect(db.prepare('SELECT group_id,agent_id,data_json FROM agents WHERE group_id=? AND agent_id=?').get(context.groupId, context.agentId)).toEqual(beforeDrop);
      owner.keep('exactTriggerDropped', { name, sameNativeDb: db, verified: true });
    } catch (error) { extras.push(error); }
    try { await owner.originalDispose(); } catch (error) { extras.push(error); }
    try {
      expect(targetCalls).toBe(1); expect(nativeFailures).toBe(1);
      expect(service.runtimeStatus().blocked).toBe(true); expect(store.isClosed()).toBe(false); expect(owner.nativeOpen(db)).toBe(true);
      expect(db.prepare('SELECT 1 AS alive').get()).toEqual({ alive: 1 });
    } catch (error) { extras.push(error); }
  }
  if (validationFailure || extras.length) throw new AggregateError([
    ...(rootFailure ? [rootFailure.error] : []), ...(validationFailure ? [validationFailure.error] : []), ...extras,
  ], 'nullable_original_root_and_extra_failures', { cause: rootFailure ? rootFailure.error : validationFailure?.error });
}));
