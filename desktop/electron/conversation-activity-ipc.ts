import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { registerIpcHandler } from './ipc-runtime.js';
import type { ActivityActor, ActivityChange } from '../../src/runtime/conversation-activity/service.js';
import type { ConversationActivity, ReportingPreference } from '../../src/runtime/conversation-activity/types.js';

const key = z.string().min(1).max(256);
const state = z.enum(['accepted', 'queued', 'running', 'blocked', 'input_required', 'completed', 'failed', 'cancelled']);
const activity = z.object({
  activityId: key, localSeq: z.number().int().nonnegative(), watchId: key, threadId: key,
  kind: z.enum(['accepted', 'started', 'heartbeat', 'progress', 'artifact_available', 'blocked', 'input_required', 'completed', 'failed', 'cancelled', 'report', 'diagnostic']),
  at: z.number().finite(), projection: z.object({
    watchId: key, executionState: state, businessOutcome: z.enum(['unknown', 'success', 'error', 'cancelled']),
    freshness: z.enum(['fresh', 'reconnecting', 'stale', 'unavailable']), sourceSequence: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
    lastProgressAt: z.number().nullable(), lastHeartbeatAt: z.number().nullable(), lastReportAt: z.number().nullable(),
    summary: z.string().optional(), errorCode: z.string().optional(), evidenceRefs: z.array(z.string()),
  }).strict(),
}).strict();
const watch = z.object({
  operationId: key, watchId: key, source: z.enum(['kswarm', 'task_host', 'agent_group', 'mcp']),
  logicalSourceId: key, sourceDataEpoch: key, workId: key, runId: z.string().max(256).optional(), actualExecutionThreadId: key.optional(),
  origin: z.object({ profileId: key, threadId: key, workspaceId: key, actorId: key }).strict(),
  status: z.enum(['active', 'stopped']), generation: z.number().int().nonnegative(),
  preference: z.enum(['normal', 'critical_only', 'quiet']), policyRevision: z.number().int().nonnegative(), nextReportDueAt: z.number().finite(),
}).strict();
const workView = z.object({ watch, projection: activity.shape.projection }).strict();

export interface ConversationActivityIpcService {
  mcpInputs?(watchId: string, actor: ActivityActor): Promise<unknown>;
  mcpAnswer?(watchId: string, input: { inputId: string; expectedDigest: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }, actor: ActivityActor): Promise<void>;
  mcpCancel?(watchId: string, actor: ActivityActor): Promise<{ requested: true }>;
  list(threadId: string, actor: ActivityActor, page?: { afterLocalSeq?: number; limit?: number }): Promise<ConversationActivity[]>;
  subscribe(threadId: string, actor: ActivityActor, handler: (change: ActivityChange) => void): (() => void) | Promise<() => void>;
  reporting(watchId: string, preference: ReportingPreference, revision: number, actor: ActivityActor): Promise<unknown>;
  stop(watchId: string, revision: number, actor: ActivityActor): Promise<unknown>;
  getWork(watchId: string, actor: ActivityActor): Promise<unknown>;
  unread(actor: ActivityActor): Array<{ threadId: string; count: number }> | Promise<Array<{ threadId: string; count: number }>>;
  read(threadId: string, through: number, actor: ActivityActor): void | Promise<void>;
  overview(actor: ActivityActor, handler: (change: ActivityChange) => void): (() => void) | Promise<() => void>;
}

export function registerConversationActivityIpc(
  registrar: IpcHandleRegistrar, service: ConversationActivityIpcService | null,
  authorize: (event: IpcMainInvokeEvent) => { actorId: string } | null,
): () => void {
  const subscriptions = new Map<string, () => void>();
  const pendingSubscriptions = new Map<string, symbol>();
  let disposed = false;
  const actor = (event: IpcMainInvokeEvent): ActivityActor => {
    const identity = authorize(event);
    if (!identity) throw new Error('activity_actor_forbidden');
    return { ...identity, requestSource: 'user' };
  };
  const get = () => { if (!service) throw new Error('activity_unavailable'); return service; };
  const register = <I, O>(channel: string, input: z.ZodType<I>, output: z.ZodType<O>, handler: (input: I, event: IpcMainInvokeEvent) => Promise<O>) =>
    registerIpcHandler({ registrar, channel, input, output, handler, sourceFile: 'conversation-activity-ipc.ts', rolloutRound: 3, riskTags: ['internal-mutation'] });

  register('desktop:activity:list', z.object({ threadId: key, afterLocalSeq: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(200).optional() }).strict(), z.array(activity),
    async (input, event) => get().list(input.threadId, actor(event), { afterLocalSeq: input.afterLocalSeq, limit: input.limit }));
  register('desktop:activity:work', z.object({ watchId: key }).strict(), workView, async (input, event) => workView.parse(await get().getWork(input.watchId, actor(event))));
  const field = z.object({ key, title: z.string().max(256), type: z.enum(['text','number','boolean','choice','choices']), required: z.boolean(), options: z.array(z.string().max(4096)).max(128).optional() }).strict();
  register('desktop:activity:mcpInputs', z.object({ watchId: key }).strict(), z.array(z.object({ inputId: key, expectedDigest: key, prompt: z.string().max(1024), fields: z.array(field).max(32) }).strict()).max(32), async (input, event) => {
    const handler = get().mcpInputs; if (!handler) throw new Error('activity_mcp_unavailable'); return handler(input.watchId, actor(event)) as Promise<any>;
  });
  register('desktop:activity:mcpAnswer', z.object({ watchId: key, inputId: key, expectedDigest: key, action: z.enum(['accept','decline','cancel']), content: z.record(z.unknown()).optional() }).strict(), z.void(), async (input, event) => {
    const handler = get().mcpAnswer; if (!handler) throw new Error('activity_mcp_unavailable'); const { watchId, ...answer } = input; await handler(watchId, answer, actor(event));
  });
  register('desktop:activity:mcpCancel', z.object({ watchId: key }).strict(), z.object({ requested: z.literal(true) }).strict(), async (input, event) => {
    const handler = get().mcpCancel; if (!handler) throw new Error('activity_mcp_unavailable'); return handler(input.watchId, actor(event));
  });
  register('desktop:activity:unread', z.void(), z.array(z.object({ threadId: key, count: z.number().int().positive() }).strict()), async (_input, event) => get().unread(actor(event)));
  register('desktop:activity:read', z.object({ threadId: key, throughLocalSeq: z.number().int().nonnegative() }).strict(), z.void(), async (input, event) => get().read(input.threadId, input.throughLocalSeq, actor(event)));
  const subscription = z.object({ threadId: key, subscriptionId: key }).strict();
  register('desktop:activity:subscribe', subscription, z.void(), async (input, event) => {
    const identity = actor(event), sender = event.sender;
    const subscriptionKey = `${sender.id}:${input.subscriptionId}`;
    subscriptions.get(subscriptionKey)?.();
    const token = Symbol('activity-subscription'); pendingSubscriptions.set(subscriptionKey, token);
    let dispose: () => void;
    try { dispose = await get().subscribe(input.threadId, identity, change => {
      if (!sender.isDestroyed()) sender.send('desktop:activity:changed', change);
    }); } catch (error) {
      if (pendingSubscriptions.get(subscriptionKey) === token) pendingSubscriptions.delete(subscriptionKey);
      throw error;
    }
    if (disposed || sender.isDestroyed() || pendingSubscriptions.get(subscriptionKey) !== token) { dispose(); return; }
    try { if (actor(event).actorId !== identity.actorId) throw new Error('activity_actor_forbidden'); }
    catch (error) { dispose(); pendingSubscriptions.delete(subscriptionKey); throw error; }
    const cleanup = () => { dispose(); subscriptions.delete(subscriptionKey); pendingSubscriptions.delete(subscriptionKey); sender.removeListener('destroyed', cleanup); };
    subscriptions.set(subscriptionKey, cleanup); sender.once('destroyed', cleanup);
  });
  register('desktop:activity:unsubscribe', z.object({ subscriptionId: key }).strict(), z.void(), async (input, event) => {
    actor(event); const subscriptionKey = `${event.sender.id}:${input.subscriptionId}`;
    pendingSubscriptions.delete(subscriptionKey); subscriptions.get(subscriptionKey)?.();
  });
  register('desktop:activity:overview', z.object({ subscriptionId: key }).strict(), z.void(), async (input, event) => {
    const identity = actor(event), sender = event.sender, subscriptionKey = `${sender.id}:${input.subscriptionId}`;
    subscriptions.get(subscriptionKey)?.();
    const token = Symbol('activity-overview'); pendingSubscriptions.set(subscriptionKey, token);
    const stop = await get().overview(identity, change => { if (!sender.isDestroyed()) sender.send('desktop:activity:changed', change); });
    if (disposed || sender.isDestroyed() || pendingSubscriptions.get(subscriptionKey) !== token) { stop(); return; }
    const cleanup = () => { stop(); pendingSubscriptions.delete(subscriptionKey); subscriptions.delete(subscriptionKey); sender.removeListener('destroyed', cleanup); };
    subscriptions.set(subscriptionKey, cleanup); sender.once('destroyed', cleanup);
  });
  register('desktop:activity:reporting', z.object({ watchId: key, preference: z.enum(['normal', 'critical_only', 'quiet']), expectedPolicyRevision: z.number().int().nonnegative() }).strict(), watch,
    async (input, event) => watch.parse(await get().reporting(input.watchId, input.preference, input.expectedPolicyRevision, actor(event))));
  register('desktop:activity:stop', z.object({ watchId: key, expectedPolicyRevision: z.number().int().nonnegative() }).strict(), watch,
    async (input, event) => watch.parse(await get().stop(input.watchId, input.expectedPolicyRevision, actor(event))));
  return () => { disposed = true; pendingSubscriptions.clear(); for (const stop of [...subscriptions.values()]) stop(); subscriptions.clear(); };
}
