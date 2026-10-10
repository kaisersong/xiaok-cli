import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ensure = vi.hoisted(() => vi.fn());
vi.mock('../../../src/runtime/conversation-activity/owner-launcher.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/runtime/conversation-activity/owner-launcher.js')>()), ensureConversationActivityOwner: ensure,
}));
import { createDesktopServices } from '../../electron/desktop-services.js';

const roots: string[] = [];
afterEach(() => { vi.clearAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
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
  return { services, kswarmService };
}

describe('desktop activity owner attach failure', () => {
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
