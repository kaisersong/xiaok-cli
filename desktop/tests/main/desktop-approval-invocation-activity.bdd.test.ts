// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopCapabilityCatalog } from '../../electron/desktop-multi-agent-capabilities.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentTurnMailbox, MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import type { RuntimeEvent } from '../../../src/runtime/events.js';
import type { Message, ModelAdapter } from '../../../src/types.js';

describe('AP8 actual loop reports dispatch, not proposal or approval denial', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); vi.restoreAllMocks(); });
  it.each(['safe', 'denied', 'failed'] as const)('scoped %s reports whether the actual bound tool was invoked', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-approval-dispatch-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    store.registerThread({ threadId: 'dispatch-thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const group = store.createGroup('dispatch-thread'), controller = new AbortController();
    const mailbox = new DesktopMultiAgentTurnMailbox({ store, groupId: group.groupId, agentId: `root_${group.groupId}`,
      turnId: 'dispatch-turn', commands: new MultiAgentCommandSequencer(), assertCurrent: () => {}, onSeal: () => {} });
    const effect = vi.fn(async () => { if (mode === 'failed') throw new Error('actual_tool_failed'); return 'executed'; });
    const catalog = new DesktopCapabilityCatalog();
    const descriptor = catalog.publish({ requestSource: 'scheduler', ownerId: 'dispatch-owner', entry: {
      definition: { name: 'dispatch_fixture', description: 'dispatch fixture', inputSchema: { type: 'object', properties: {} } },
      aliases: [], permission: mode === 'denied' ? 'write' : 'safe',
      scope: { workspaceId: 'workspace', materialIds: [], permissions: ['safe', 'write'] }, bindInvocation: () => effect,
    } });
    catalog.authorize({ requestSource: 'user', capabilityId: descriptor.capabilityId });
    const scoped = catalog.createScopedRegistry(catalog.snapshotPolicy(), { groupId: group.groupId, agentId: `root_${group.groupId}`,
      turnId: 'dispatch-turn', cwd: root, workspaceId: 'workspace', materialIds: [], permissionRevision: 0,
      signal: controller.signal, deadlineAt: Date.now() + 30_000 }, { autoMode: false, onPrompt: async () => false });
    cleanup.push(() => scoped.dispose());
    const events: RuntimeEvent[] = []; let calls = 0;
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream() {
      if (++calls === 1) yield { type: 'tool_use', id: 'same-provider-id', name: 'dispatch_fixture', input: {} };
      else yield { type: 'text', delta: 'done' };
    } };
    await runDesktopToolLoop({ adapter, registry: scoped.registry, allToolDefs: scoped.registry.getToolDefinitions(),
      systemPrompt: 'system', messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }],
      signal: controller.signal, taskDeadline: Date.now() + 30_000, sessionId: 'session', turnId: 'dispatch-turn', intentId: 'intent',
      stepId: 'step', taskId: 'task', materials: [], emitRuntimeEvent: async event => { events.push(event); },
      skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(), mailbox, maxIterations: 2,
      strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
        buildApiView: (messages: Message[]) => messages, processToolResult: (result: string) => result,
        trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false },
    });
    expect(effect).toHaveBeenCalledTimes(mode === 'denied' ? 0 : 1);
    expect(events.filter(event => event.type === 'pre_tool_use')).toHaveLength(1);
    expect(events.filter(event => event.type === 'tool_finished')).toEqual([
      expect.objectContaining({ invocationId: 'same-provider-id', invoked: mode !== 'denied' }),
    ]);
  });
});
