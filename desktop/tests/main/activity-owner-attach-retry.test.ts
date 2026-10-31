import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ensure = vi.hoisted(() => vi.fn());
vi.mock('../../../src/runtime/conversation-activity/owner-launcher.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/runtime/conversation-activity/owner-launcher.js')>()), ensureConversationActivityOwner: ensure,
}));
import { createDesktopServices } from '../../electron/desktop-services.js';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';
import { ConversationActivityService, type ActivityActor, type ActivityChange } from '../../../src/runtime/conversation-activity/service.js';

const roots: string[] = [];
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const actor = { requestSource: 'user' as const, actorId: 'desktop-user:test' };
const sourceConfig = { managedSources: [] } as never;
async function makeServices() {
  const root = mkdtempSync(join(tmpdir(), 'activity-attach-retry-')); roots.push(root);
  vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config')); vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
  const kswarmService = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), restart: vi.fn(async () => {}), getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
    onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }), bindActivityOwner: vi.fn() };
  const services = createDesktopServices({ dataRoot: join(root, 'data'), workspaceRoot: root, knowledgeDbPath: join(root, 'knowledge.sqlite'),
    pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService: kswarmService as never });
  await services.multiAgent!.ready;
  return { services, kswarmService, root };
}

describe('desktop activity owner attach failure', () => {
  it('returns stable asynchronous errors after attachment failure and waits for a retry', async () => {
    const { services } = await makeServices();
    try {
      const api = services.conversationActivity!;
      ensure.mockRejectedValueOnce(new Error('activity_owner_start_timeout'));
      await expect(services.attachConversationActivityOwner(sourceConfig)).rejects.toThrow('activity_owner_start_timeout');
      await expect(api.projectConnectionChanged('disconnected')).rejects.toThrow('activity_owner_unavailable');
      await expect(api.projectChanged('p')).rejects.toThrow('activity_owner_unavailable');
      ensure.mockClear();
      let resolve!: (client: unknown) => void;
      ensure.mockImplementation(() => new Promise(r => { resolve = r; }));
      const attachment = services.attachConversationActivityOwner(sourceConfig);
      await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
      let settled = false;
      const connection = api.projectConnectionChanged('connected').finally(() => { settled = true; });
      const project = api.projectChanged('p');
      await Promise.resolve(); expect(settled).toBe(false);
      const client = { request: vi.fn(async () => ({})), dispose: vi.fn(), ownerEpoch: 'e1' };
      resolve(client); await attachment; await connection; await project;
      expect(client.request).toHaveBeenCalledWith('hint', { source: 'kswarm', workId: 'p' });
    } finally { await services.disposeMultiAgent(); }
  });

  it('does not cache a failed attach: the next call tries again, and consumers only ever see one stable user-safe code', async () => {
    const { services } = await makeServices();
    try {
      ensure.mockRejectedValue(new Error('activity_owner_config_mismatch'));
      await expect(services.attachConversationActivityOwner(sourceConfig)).rejects.toThrow('activity_owner_config_mismatch');
      await expect(services.attachConversationActivityOwner(sourceConfig)).rejects.toThrow('activity_owner_config_mismatch');
      expect(ensure).toHaveBeenCalledTimes(2); // a cached rejection would have been returned without calling the launcher again
      const api = services.conversationActivity!;
      const errors = await Promise.all([api.list('thread', actor), api.subscribe('thread', actor, () => {})].map(call => call.then(() => '', (error: Error) => error.message)));
      expect(errors).toEqual(['activity_owner_unavailable', 'activity_owner_unavailable']);
      expect(errors.join(' ')).not.toContain('config_mismatch');
    } finally { await services.disposeMultiAgent(); }
  });

  it('recovers on a later attach after an earlier failure (no permanent failure state)', async () => {
    const { services, kswarmService } = await makeServices();
    try {
      const client = { request: vi.fn(async () => ({})), dispose: vi.fn(), ownerEpoch: 'e1' };
      ensure.mockRejectedValueOnce(new Error('activity_owner_start_timeout')).mockResolvedValueOnce(client);
      await expect(services.attachConversationActivityOwner(sourceConfig)).rejects.toThrow('activity_owner_start_timeout');
      await expect(services.attachConversationActivityOwner(sourceConfig)).resolves.toBeUndefined();
      expect(ensure).toHaveBeenCalledTimes(2);
      expect(kswarmService.bindActivityOwner).toHaveBeenCalledWith(client);
      // after a successful retry, consumers get past the attachment gate (they no longer see the failure code)
      await services.conversationActivity!.list('thread', actor).catch((error: Error) => expect(error.message).not.toBe('activity_owner_unavailable'));
    } finally { await services.disposeMultiAgent(); }
  });

  it('concurrent attach calls share one in-flight attempt', async () => {
    const { services } = await makeServices();
    try {
      let reject!: (error: Error) => void;
      ensure.mockImplementation(() => new Promise((_, r) => { reject = r; }));
      const first = services.attachConversationActivityOwner(sourceConfig), second = services.attachConversationActivityOwner(sourceConfig);
      await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
      reject(new Error('activity_owner_exited'));
      await expect(first).rejects.toThrow('activity_owner_exited'); await expect(second).rejects.toThrow('activity_owner_exited');
      expect(ensure).toHaveBeenCalledTimes(1);
    } finally { await services.disposeMultiAgent(); }
  });
});


type ActivityFacade = NonNullable<ReturnType<typeof createDesktopServices>['conversationActivity']>;
type FacadeName = 'mcpInputs' | 'unread' | 'read' | 'overview' | 'getWork' | 'reporting' | 'stop';
const facadeNames: FacadeName[] = ['mcpInputs', 'unread', 'read', 'overview', 'getWork', 'reporting', 'stop'];
function invokeFacade(name: FacadeName, api: ActivityFacade, identity: ActivityActor, callback: (change: ActivityChange) => void) {
  switch (name) {
    case 'mcpInputs': return api.mcpInputs('watch', identity);
    case 'unread': return api.unread(identity);
    case 'read': return api.read('thread', 37, identity);
    case 'overview': return api.overview(identity, callback);
    case 'getWork': return api.getWork('watch', identity);
    case 'reporting': return api.reporting('watch', 'quiet', 7, identity);
    case 'stop': return api.stop('watch', 7, identity);
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function observe<T>(call: () => T | PromiseLike<T>) {
  let settled = false;
  type Outcome = { ok: true; value: T } | { ok: false; error: unknown };
  const outcome = Promise.resolve().then(call).then<Outcome, Outcome>(
    value => { settled = true; return { ok: true, value }; },
    error => { settled = true; return { ok: false, error }; },
  );
  return { outcome, settled: () => settled };
}
const checkpoint = () => new Promise<void>(resolve => setImmediate(resolve));

describe('all public activity facades share the existing owner attachment gate', () => {
  it.each(facadeNames)('%s waits through disposed-owner attachment, rejects failure safely, and forwards after retry', async name => {
    ensure.mockReset();
    const { services, kswarmService, root } = await makeServices();
    const first = deferred<ConversationActivityOwnerClient>(), retry = deferred<ConversationActivityOwnerClient>();
    const callback = vi.fn<(change: ActivityChange) => void>();
    const client = new ConversationActivityOwnerClient(join(root, 'data'), 'desktop');
    // Only the transport boundary is scripted. Facade, local service disposal,
    // attached-service actor checks and overview subscription lifecycle are real.
    const request = vi.spyOn(client, 'request').mockResolvedValue(undefined);
    const overview = vi.spyOn(client, 'subscribeOverview');
    const disposed = vi.spyOn(ConversationActivityService.prototype, 'dispose');
    const localCalls = [
      vi.spyOn(ConversationActivityService.prototype, 'getWork'),
      vi.spyOn(ConversationActivityService.prototype, 'unreadThreads'),
      vi.spyOn(ConversationActivityService.prototype, 'markRead'),
      vi.spyOn(ConversationActivityService.prototype, 'subscribeOverview'),
      vi.spyOn(ConversationActivityService.prototype, 'updateReporting'),
      vi.spyOn(ConversationActivityService.prototype, 'stopWatch'),
    ];
    const pending: Array<Promise<unknown>> = [observe(() => first.promise).outcome, observe(() => retry.promise).outcome];
    const errors: unknown[] = [];
    let stopOverview: (() => void) | undefined;
    try {
      const api = services.conversationActivity, profile = services.multiAgent;
      if (!api || !profile) throw new Error('activity_fixture_unavailable');
      const identity: ActivityActor = { requestSource: 'user', actorId: `desktop-user:${profile.profileId}` };
      ensure.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => retry.promise);
      const attachment = observe(() => services.attachConversationActivityOwner(sourceConfig)); pending.push(attachment.outcome);
      await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
      expect(disposed).toHaveBeenCalledTimes(1);
      for (const spy of localCalls) spy.mockClear();
      const firstCall = observe(() => invokeFacade(name, api, identity, callback)); pending.push(firstCall.outcome);
      await checkpoint();
      expect(firstCall.settled()).toBe(false);
      for (const spy of localCalls) expect(spy).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled(); expect(overview).not.toHaveBeenCalled();
      expect(kswarmService.bindActivityOwner).not.toHaveBeenCalled();
      const primary = new Error('activity_owner_start_timeout'); first.reject(primary);
      expect(await attachment.outcome).toEqual({ ok: false, error: primary });
      const failed = await firstCall.outcome;
      if (failed.ok) throw new Error('activity_call_succeeded_after_failed_attach');
      expect(failed.error).toBeInstanceOf(Error);
      expect(failed.error).toHaveProperty('message', 'activity_owner_unavailable');
      for (const spy of localCalls) expect(spy).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled(); expect(overview).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled(); expect(kswarmService.bindActivityOwner).not.toHaveBeenCalled();

      const retryAttachment = observe(() => services.attachConversationActivityOwner(sourceConfig)); pending.push(retryAttachment.outcome);
      await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
      const retryCall = observe(() => invokeFacade(name, api, identity, callback)); pending.push(retryCall.outcome);
      await checkpoint(); expect(retryCall.settled()).toBe(false);
      expect(request).not.toHaveBeenCalled(); expect(overview).not.toHaveBeenCalled();
      retry.resolve(client);
      expect(await retryAttachment.outcome).toEqual({ ok: true, value: undefined });
      const success = await retryCall.outcome;
      if (!success.ok) throw success.error;
      expect(kswarmService.bindActivityOwner).toHaveBeenCalledTimes(1);
      expect(kswarmService.bindActivityOwner).toHaveBeenCalledWith(client);
      for (const spy of localCalls) expect(spy).not.toHaveBeenCalled();
      if (name === 'overview') {
        expect(overview).toHaveBeenCalledTimes(1); expect(overview).toHaveBeenCalledWith(callback);
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith('overview', { subscriptionId: expect.any(String) });
        if (typeof success.value !== 'function') throw new Error('overview_cleanup_missing');
        const unsubscribe = success.value; stopOverview = () => { unsubscribe(); };
        stopOverview(); stopOverview = undefined;
        expect(request).toHaveBeenCalledWith('unsubscribe', request.mock.calls[0][1]);
      } else {
        const expected: Record<Exclude<FacadeName, 'overview'>, unknown[][]> = {
          mcpInputs: [['work', { watchId: 'watch' }], ['mcpInputs', { watchId: 'watch' }]],
          unread: [['unread']], read: [['read', { threadId: 'thread', through: 37 }]],
          getWork: [['work', { watchId: 'watch' }]],
          reporting: [['reporting', { watchId: 'watch', preference: 'quiet', revision: 7 }]],
          stop: [['stop', { watchId: 'watch', revision: 7 }]],
        };
        expect(request.mock.calls).toEqual(expected[name]);
      }
    } catch (error) { errors.push(error); } finally {
      // Always settle/join this test's held attach/call promises before closing
      // the real service and its temporary SQLite owners, including on RED.
      first.reject(new Error('activity_fixture_closing')); retry.resolve(client);
      await Promise.all(pending);
      try { stopOverview?.(); } catch (error) { errors.push(error); }
      try { await services.disposeMultiAgent(); } catch (error) { errors.push(error); }
      try { client.dispose(); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'activity_fixture_cleanup_failed');
    }
  });

  it('keeps the disabled facade null and never starts attachment', async () => {
    ensure.mockReset(); vi.stubEnv('XIAOK_CONVERSATION_ACTIVITY', '0');
    const { services } = await makeServices();
    try {
      expect(services.conversationActivity).toBeNull();
      await expect(services.attachConversationActivityOwner(sourceConfig)).resolves.toBeUndefined();
      expect(ensure).not.toHaveBeenCalled();
    } finally { await services.disposeMultiAgent(); }
  });
});
