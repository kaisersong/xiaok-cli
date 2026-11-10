import type { NativeActor } from '../codex-native-service.js';
import type { DesktopGoalProjection, PreparedGoalTask } from '../desktop-goal-coordinator.js';
import type { createGoalDisclosure } from './goal-disclosure.js';
import { digest } from './store.js';

type Reply = { goal: DesktopGoalProjection; preparedTask: PreparedGoalTask };
interface GoalEgressOwner {
  disclosure: ReturnType<typeof createGoalDisclosure>;
  assertAccess(threadId: string, actor: NativeActor): void;
  assertOrigin(threadId: string, value: DesktopGoalProjection | null): void;
  assertPrepared(value: PreparedGoalTask): void;
}

/** Only main assembles this owner. Receipts never cross preload. */
export function createGoalEgress(owner: GoalEgressOwner) {
  if (!owner.disclosure || [owner.assertAccess, owner.assertOrigin, owner.assertPrepared].some(value => typeof value !== 'function')) throw new Error('goal_content_unavailable');
  const replies = new WeakMap<object, { actor: NativeActor; threadId: string; receipt: object; hash: string }>();
  const prepared = new WeakSet<object>();
  function sync(value: unknown) {
    if (value === undefined) return;
    if (value instanceof Promise) void value.catch(() => undefined);
    throw new Error('goal_content_unavailable');
  }
  function read(threadId: string, value: DesktopGoalProjection | null, actor: NativeActor) {
    sync(owner.assertAccess(threadId, actor));
    sync(owner.assertOrigin(threadId, value));
    return owner.disclosure.capture(threadId, value, actor);
  }
  function assertPrepared(value: PreparedGoalTask, actor: NativeActor) {
    sync(owner.assertAccess(value.threadId, actor));
    sync(owner.assertPrepared(value));
  }
  return Object.freeze({
    captureRead: read,
    assertRead: owner.disclosure.assertCurrent,
    recordReply(threadId: string, value: Reply, actor: NativeActor): Reply {
      const captured = read(threadId, value.goal, actor);
      assertPrepared(value.preparedTask, actor);
      if (value.preparedTask.threadId !== threadId || Object.keys(value).some(key => !['goal', 'preparedTask'].includes(key))) throw new Error('goal_content_unavailable');
      replies.set(value, { actor, threadId, receipt: captured.receipt, hash: digest(value) });
      return value;
    },
    assertReply(value: Reply, actor: NativeActor) {
      const proof = replies.get(value);
      if (!proof || proof.actor !== actor || proof.hash !== digest(value)) throw new Error('goal_content_unavailable');
      sync(owner.assertAccess(proof.threadId, actor));
      owner.disclosure.assertCurrent(proof.receipt, value.goal, actor);
      assertPrepared(value.preparedTask, actor);
    },
    recordPrepared(value: PreparedGoalTask) { sync(owner.assertPrepared(value)); prepared.add(value); },
    assertPrepared(value: PreparedGoalTask, actor: NativeActor) {
      if (!prepared.has(value)) throw new Error('goal_content_unavailable');
      assertPrepared(value, actor);
    },
    assertBroadcast(value: { threadId: string; goal: DesktopGoalProjection }, actor: NativeActor) {
      if (Object.keys(value).some(key => !['threadId', 'goal'].includes(key))) throw new Error('goal_content_unavailable');
      const proof = read(value.threadId, value.goal, actor);
      owner.disclosure.assertCurrent(proof.receipt, value.goal, actor);
    },
    assertAccess(threadId: string, actor: NativeActor) { sync(owner.assertAccess(threadId, actor)); },
  });
}
