import type { NativeActor } from '../codex-native-service.js';
import type { DesktopGoalProjection } from '../desktop-goal-coordinator.js';
import { goalBindingHash, SqliteGoalStore } from '../goal-store-sqlite.js';
import type { TaskSnapshot } from '../../shared/task-types.js';
import { digest, effectSnapshotHash } from './store.js';

interface GoalReadOwner {
  store: SqliteGoalStore;
  assertAccess(threadId: string, actor: NativeActor): void;
  assertLiveProjection(threadId: string, value: DesktopGoalProjection): void;
  readTask(taskId: string): TaskSnapshot | null;
  assertTaskReadable(snapshot: TaskSnapshot): void;
}

/** Sources come from the owner's committed turns, never from a projection DTO. */
export function createGoalDisclosure(owner: GoalReadOwner) {
  const { store, assertAccess, assertLiveProjection, readTask, assertTaskReadable } = owner;
  if (!store || [assertAccess, assertLiveProjection, readTask, assertTaskReadable].some(callback => typeof callback !== 'function')) throw new Error('goal_provenance_unavailable');
  type Receipt = { threadId: string; value: DesktopGoalProjection | null; actor: NativeActor; fingerprint: string };
  const receipts = new WeakMap<object, Receipt>(), values = new WeakMap<object, WeakMap<object, object>>();

  function synchronous(result: unknown): void {
    if (result === undefined) return;
    if (result instanceof Promise) void result.catch(() => undefined);
    throw new Error('goal_content_unavailable');
  }

  function requireTask(taskId: string): TaskSnapshot {
    const binding = store.getTaskBinding(taskId), source = store.readTaskSource(taskId), actual = readTask(taskId), scope = actual?.executionScope;
    if (!binding || !source || !actual || actual.taskId !== taskId || actual.sessionId !== source.sourceEpoch
      || actual.context?.threadId !== binding.threadId || source.scopeHash !== goalBindingHash(binding)
      || scope?.kind !== 'goal_turn' || scope.threadId !== binding.threadId || scope.goalId !== binding.goalId
      || scope.epoch !== binding.epoch || scope.goalTurnId !== binding.goalTurnId || scope.origin !== binding.origin) throw new Error('goal_content_unavailable');
    synchronous(assertTaskReadable(actual));
    return actual;
  }

  function fingerprint(threadId: string, value: DesktopGoalProjection | null): string {
    const document = store.readDisclosureDocument(threadId);
    if (!document) {
      if (value !== null) throw new Error('goal_content_unavailable');
      return digest([1, threadId, null]);
    }
    const { state } = document;
    if (!value || Object.keys(value).some(key => !['state', 'activation', 'waitingReason'].includes(key))
      || !['armed', 'disarmed'].includes(value.activation) || value.waitingReason !== undefined && !['waiting_children', 'children_need_attention'].includes(value.waitingReason)
      || digest(value.state) !== digest(state) || !store.hasUserInputSource(state)) throw new Error('goal_content_unavailable');
    synchronous(assertLiveProjection(threadId, value));
    if (document.turns.some(turn => turn.goalId !== state.goalId) || document.evidence.some(item => item.goalId !== state.goalId)) throw new Error('goal_content_unavailable');
    const turns = document.turns.filter(turn => turn.epoch === state.epoch), evidence = document.evidence.filter(item => item.epoch === state.epoch);
    if (state.turnsUsed !== turns.length || new Set(turns.map(turn => turn.turnId)).size !== turns.length
      || evidence.some(item => !turns.some(turn => turn.turnId === item.goalTurnId))) throw new Error('goal_content_unavailable');
    const sources = turns.map(turn => {
      const source = store.readTurnSource(state.goalId, state.epoch, turn.turnId);
      if (!source) throw new Error('goal_content_unavailable');
      const binding = store.getTaskBinding(source.taskId), actual = requireTask(source.taskId);
      if (!binding || binding.threadId !== threadId || binding.goalId !== state.goalId || binding.epoch !== state.epoch
        || binding.goalTurnId !== turn.turnId || source.sourceEpoch !== actual.sessionId
        || effectSnapshotHash(actual) !== source.snapshotHash) throw new Error('goal_content_unavailable');
      return [binding, source];
    });
    if (turns.length === 0) {
      if (state.tokensUsed !== 0 || state.activeWallClockMs !== 0 || state.consecutiveBlockedTurns !== 0
        || state.blockerFingerprint !== undefined || evidence.length !== 0) throw new Error('goal_content_unavailable');
      if (state.status === 'active') {
        if (state.terminalReason !== undefined) throw new Error('goal_content_unavailable');
      } else {
        const allowed = state.status === 'paused' ? ['user_paused', 'permission_revoked', 'thread_attachment_timeout']
          : state.status === 'cancelled' ? ['user_cancelled'] : [];
        const event = [...document.events].reverse().find(item => item.revision === state.revision);
        if (!state.terminalReason || !allowed.includes(state.terminalReason) || !event || event.goalId !== state.goalId
          || event.reason !== state.terminalReason || !['user', 'runtime'].includes(event.actor)
          || event.type !== (state.status === 'paused' ? 'paused' : 'cancelled')) throw new Error('goal_content_unavailable');
      }
    }
    return digest([1, threadId, state, value.activation, value.waitingReason ?? null, turns, evidence, sources]);
  }

  function assertCurrent(receipt: object, value: DesktopGoalProjection | null, actor: NativeActor): void {
    try {
      const read = receipts.get(receipt);
      if (!read || read.value !== value || read.actor !== actor) throw new Error('goal_content_unavailable');
      synchronous(assertAccess(read.threadId, actor));
      if (fingerprint(read.threadId, value) !== read.fingerprint) throw new Error('goal_content_unavailable');
    } catch { throw new Error('goal_content_unavailable'); }
  }

  return Object.freeze({
    capture(threadId: string, value: DesktopGoalProjection | null, actor: NativeActor) {
      try {
        synchronous(assertAccess(threadId, actor));
        const receipt = Object.freeze({});
        receipts.set(receipt, { threadId, value, actor, fingerprint: fingerprint(threadId, value) });
        if (value) { const actors = values.get(value) ?? new WeakMap<object, object>(); actors.set(actor, receipt); values.set(value, actors); }
        return Object.freeze({ value, receipt });
      } catch { throw new Error('goal_content_unavailable'); }
    },
    assertCurrent,
    assertValueCurrent(threadId: string, value: DesktopGoalProjection | null, actor: NativeActor): void {
      if (value === null) {
        synchronous(assertAccess(threadId, actor)); fingerprint(threadId, null); return;
      }
      const receipt = values.get(value)?.get(actor), read = receipt && receipts.get(receipt);
      if (!receipt || read?.threadId !== threadId) throw new Error('goal_content_unavailable');
      assertCurrent(receipt, value, actor);
    },
    assertTaskCurrent(taskId: string): void { requireTask(taskId); },
  });
}
