// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelAdapter } from '../../../src/types.js';
import { buildToolList } from '../../../src/ai/tools/index.js';
import { createSkillCatalog } from '../../../src/ai/skills/loader.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentRuntime } from '../../electron/desktop-multi-agent-runtime.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopOwnedToolRegistry, DesktopToolCatalogBridge } from '../../electron/desktop-multi-agent-catalog-bridge.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

describe('BDD: SubAgent presentation uses actual Desktop tool settlement', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action(); });

  it.each(['normal', 'sqlite', 'provider', 'budget', 'cancel', 'many_tools'] as const)('Given reused provider invocation IDs and outcome=%s, Then recorded work stays truthful and old callbacks cannot mutate the next turn', async outcome => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ma-presentation-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const source = join(root, 'source.ts'); writeFileSync(source, 'export const PRESENTATION_REAL_SOURCE = 42;\n');
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    let runtime!: DesktopMultiAgentRuntime;
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: input => runtime.createSession(input) });
    cleanup.push(() => service.dispose()); runtime = new DesktopMultiAgentRuntime({ service });
    service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const broad = new DesktopOwnedToolRegistry({ autoMode: true }, buildToolList(undefined, { cwd: root }));
    const catalog = new DesktopToolCatalogBridge({ registry: broad, workspaceId: 'workspace' }); cleanup.push(() => { catalog.dispose(); broad.dispose(); }); catalog.authorizeRoot();
    const finished = vi.spyOn(service, 'recordToolFinished');
    if (outcome === 'sqlite') {
      const append = store.appendEvent.bind(store);
      vi.spyOn(store, 'appendEvent').mockImplementation((groupId, event, ...rest) => {
        if (event.kind === 'tool_finished') throw new Error('SQLITE_FULL: tool receipt');
        return append(groupId, event, ...rest);
      });
    }
    let call = 0, secondTurn = false, groupId = '', childId = '';
    let releaseCancel!: () => void; const cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; }); cleanup.push(() => releaseCancel());
    let waitingForCancel = false;
    const callbackErrors: unknown[] = [];
    const adapter: Pick<ModelAdapter, 'stream'> = { async *stream(messages) {
      try {
        call++;
        if (outcome === 'many_tools') {
          if (call === 1) {
            const names = ['__proto__', ...Array.from({ length: 33 }, (_, i) => `unknown_${i}`), `${'long'.repeat(16)}a`, `${'long'.repeat(16)}b`];
            for (const [index, name] of names.entries()) yield { type: 'tool_use', id: `unknown-call-${index}`, name, input: {} };
          } else yield { type: 'text', delta: 'Only recorded tool facts are reported.' };
          return;
        }
        if (call === 2 && !secondTurn && outcome === 'provider') throw new Error('injected provider failure');
        if (call === 2 && !secondTurn && outcome === 'cancel') { waitingForCancel = true; await cancelGate; }
        if (call === 1 || call === 2 && !secondTurn) {
          if (call === 2) {
            expect(JSON.stringify(messages)).toContain('PRESENTATION_REAL_SOURCE');
            const [context, fact] = finished.mock.calls[0];
            const saved = store.getAgent(groupId, childId);
            await expect(service.recordRunStarted(context, 'duplicate run')).rejects.toThrow(/turn.*already/);
            expect(store.getAgent(groupId, childId)).toEqual(saved);
            const before = store.getAgent(groupId, childId)?.toolsCompleted;
            await service.recordToolFinished(context, fact);
            expect(store.getAgent(groupId, childId)?.toolsCompleted).toBe(before);
            await expect(service.recordToolFinished(context, { ...fact, ok: !fact.ok })).rejects.toThrow(/conflict/);
          }
          yield { type: 'tool_use', id: 'provider-reuses-id', name: 'Read', input: { file_path: source } };
          if (call === 1 && !secondTurn) yield { type: 'tool_use', id: 'failure', name: 'write', input: { file_path: join(root, 'forbidden'), content: 'no' } };
        } else yield { type: 'text', delta: '\u001b[31mFINAL_RESULT\u001b[0m\nPUBLIC_SUMMARY' };
      } catch (error) { callbackErrors.push(error); throw error; }
    } };
    const materialRegistry = new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 });
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')), materialRegistry,
      authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }), runner: input => service.runRoot(input, async context => {
        groupId = context.groupId;
        const scope = runtime.bindRoot(context, { adapter, catalog: catalog.catalog, policy: catalog.catalog.snapshotPolicy(), systemPrompt: 'PRIVATE_SYSTEM_SENTINEL', workspaceId: 'workspace',
          materialIds: [], permissionRevision: 0, registryOptions: { autoMode: true }, materials: [], materialRegistry,
          skillCatalog: createSkillCatalog(undefined, root), dataRoot: root,
          agents: outcome === 'budget' ? [{ name: 'budgeted', systemPrompt: 'Inspect source', allowedTools: ['read'], maxIterations: 1 }] : [],
          emitRuntimeEvent: input.emitRuntimeEvent, maxIterations: 4 });
        try {
          const result = await scope.registry.executeTool('spawn_agent', { task_name: 'review', message: '\u001b[31mRead\u001b[0m\nsource', tools: ['Read'],
            ...(outcome === 'budget' ? { agent: 'budgeted' } : {}) });
          childId = JSON.parse(result).targetAgentId;
        } finally { scope.dispose(); }
      }) });
    await service.initialize(host); const task = await service.prepareRoot(host, 'thread', { prompt: 'inspect', materials: [] });
    await host.startTask(task.taskId); await host.drain(); expect(childId).toBeTruthy();
    const access = service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    if (outcome === 'many_tools') {
      await vi.waitFor(() => expect(store.getAgent(groupId, childId)).toMatchObject({ status: 'completed', executionActive: false }));
      const row = store.getAgent(groupId, childId)!;
      expect(row).toMatchObject({ toolsCompleted: 36, toolsFailed: 36, otherToolCount: 4, toolStatisticsComplete: true });
      expect(Object.keys(row.toolCounts!)).toHaveLength(32); expect(Object.hasOwn(row.toolCounts!, '__proto__')).toBe(true);
      expect(row.toolCounts!['__proto__']).toBe(1); expect(row.taskSummary).not.toContain('PRIVATE_SYSTEM_SENTINEL');
      return;
    }
    if (outcome === 'cancel') {
      await vi.waitFor(() => expect(waitingForCancel).toBe(true));
      await service.userInterrupt({ access, requestSource: 'user', groupId, agentId: childId, operationId: 'interrupt', expectedTurn: 1 });
      expect(store.getAgent(groupId, childId)).toMatchObject({ executionActive: true, toolStatisticsComplete: false });
      releaseCancel();
    }
    if (outcome === 'sqlite') {
      await vi.waitFor(() => expect(store.getGroup(groupId)?.mutationBlockedReason).toMatch(/persistence/));
      expect(finished.mock.calls[0][1]).toMatchObject({ toolName: 'Read', ok: true });
      const failed = store.getAgent(groupId, childId)!;
      expect(failed.toolStatisticsComplete).toBe(false); expect(failed.status).not.toBe('completed');
      expect(store.readEvents(groupId, 0, 100).filter(event => event.kind === 'tool_finished')).toHaveLength(0);
      return;
    }
    if (outcome !== 'normal') {
      await vi.waitFor(() => expect(store.getAgent(groupId, childId)?.executionActive).toBe(false));
      const previous = store.getAgent(groupId, childId)!;
      expect(previous.status).toBe(outcome === 'cancel' ? 'interrupted' : 'failed');
      expect(previous.toolStatisticsComplete).toBe(false);
      const [context, fact] = finished.mock.calls[0]; const head = store.getGroup(groupId)!.lastSeq;
      for (const input of [fact, { ...fact, executionEventId: 'late-termination-event' }]) await expect(service.recordToolFinished(context, input)).rejects.toThrow(/stale|authority/);
      expect(store.getAgent(groupId, childId)).toEqual(previous); expect(store.getGroup(groupId)!.lastSeq).toBe(head);
      if (outcome === 'budget') return;
      call = 0; secondTurn = true;
      await service.userFollowup({ access, requestSource: 'user', groupId, agentId: childId, operationId: 'after-failure', expectedTurn: 1, message: 'Read again' });
      await vi.waitFor(() => expect(store.getAgent(groupId, childId)).toMatchObject({ turn: 2, status: 'completed', toolsCompleted: 1, toolStatisticsComplete: true }));
      return;
    }
    await vi.waitFor(() => expect(store.getAgent(groupId, childId)).toMatchObject({ status: 'completed', executionActive: false }));
    expect(callbackErrors).toEqual([]);
    const first = store.getAgent(groupId, childId)!;
    expect(first).toMatchObject({ presentationOrdinal: 1, taskSummary: 'Read source', toolsCompleted: 3, toolsFailed: 1, toolCounts: { Read: 2, write: 1 }, toolStatisticsComplete: true, resultSummary: 'FINAL_RESULT PUBLIC_SUMMARY' });
    const events = store.readEvents(groupId, 0, 100).filter(event => event.kind === 'tool_finished');
    expect(events).toHaveLength(3); expect(new Set(events.map(event => event.payload.executionEventId)).size).toBe(3);
    const [oldContext, oldFact] = finished.mock.calls[0];
    const sealedHead = store.getGroup(groupId)!.lastSeq;
    for (const fact of [oldFact, { ...oldFact, executionEventId: 'late-after-seal' }]) await expect(service.recordToolFinished(oldContext, fact)).rejects.toThrow(/stale|authority/);
    expect(store.getAgent(groupId, childId)).toEqual(first); expect(store.getGroup(groupId)!.lastSeq).toBe(sealedHead);
    call = 0; secondTurn = true;
    await service.userFollowup({ access, requestSource: 'user', groupId, agentId: childId, operationId: 'next-turn', expectedTurn: 1, message: 'Read again' });
    await vi.waitFor(() => expect(store.getAgent(groupId, childId)).toMatchObject({ turn: 2, status: 'completed', executionActive: false }));
    const next = store.getAgent(groupId, childId)!;
    expect(next).toMatchObject({ presentationOrdinal: 1, taskSummary: 'Read again', toolsCompleted: 1, toolsFailed: 0, toolCounts: { Read: 1 } });
    expect(next.turnId).not.toBe(first.turnId);
    await expect(service.recordToolFinished(oldContext, oldFact)).rejects.toThrow(/stale|inactive|authority/);
    expect(store.getAgent(groupId, childId)?.toolsCompleted).toBe(1);
  });
});
