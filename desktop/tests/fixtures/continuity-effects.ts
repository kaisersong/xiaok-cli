import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ToolExecutionContext } from '../../../src/types.js';
import { ContinuityService } from '../../electron/context-continuity/service.js';

/** Standalone catalog fixtures still use the real durable main effect owner. */
export function continuityEffects(root: string) {
  const service = new ContinuityService({ dbPath: join(root, 'effect-policy.sqlite'), profileId: 'fixture-profile' });
  const actor = { requestSource: 'user' as const, profileId: 'fixture-profile', actorId: 'desktop-user:fixture-profile' };
  const record = (taskId: string, invocationId: string, name: string) => service.recordUnprovenEffect(actor, taskId, invocationId, name);
  return {
    record,
    context(taskId: string): ToolExecutionContext {
      return { taskId, recordUnprovenEffect: name => record(taskId, randomUUID(), name) } as ToolExecutionContext;
    },
    count(taskId?: string): number {
      return Number(taskId
        ? service.store.db.prepare('SELECT count(*) AS n FROM unproven_effects WHERE task_id=?').get(taskId)!.n
        : service.store.db.prepare('SELECT count(*) AS n FROM unproven_effects').get()!.n);
    },
    close: () => service.close(),
  };
}
