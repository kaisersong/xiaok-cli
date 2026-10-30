// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import { createProjectAgentModel } from '../../electron/project-agent-model.js';
import type { Config, ModelAdapter } from '../../../src/types.js';
const phrase = '我将查看示例页面的状态。我需要先确认示例窗口的结构。';
describe('Desktop production text repetition failure', () => {
  it.each(['ordinary', 'project-default', 'project-selected'])('fails durably without executing uncommitted tools; %s', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-repetition-'));
    const executed: string[] = [], signals: AbortSignal[] = [];
    const cancelled: boolean[] = [];
    let requests = 0, closed = 0;
    const adapter = { getModelName: () => 'example', async *stream(_m: unknown, _t: unknown, _s: unknown, options: any) {
      signals.push(options.signal);
      const requestIndex = signals.length - 1;
      cancelled.push(false);
      options.signal.addEventListener('abort', () => { cancelled[requestIndex] = true; }, { once: true });
      try {
        if (++requests === 1) yield { type: 'tool_use' as const, id: 'completed', name: 'record', input: { label: 'completed' } };
        else if (requests === 2) {
          yield { type: 'tool_use' as const, id: 'uncommitted', name: 'record', input: { label: 'uncommitted' } };
          yield { type: 'text' as const, delta: '此前记录已完成。' };
          for (let i = 0; i < 180; i++) yield { type: 'text' as const, delta: phrase };
        } else yield { type: 'text' as const, delta: '不得把已发生的复读正常收尾。' };
        yield { type: 'done' as const };
      } finally { closed++; }
    } } as unknown as ModelAdapter;
    const registry = new ToolRegistry({ autoMode: true }, [{ definition: { name: 'record', description: 'test', inputSchema: { type: 'object', properties: {} } },
      async execute(input: any) { executed.push(input.label); return 'saved:' + input.label; } }]);
    const snapshotStore = new FileTaskSnapshotStore(join(root, 'snapshots'));
    const materialRegistry = new MaterialRegistry({ workspaceRoot: join(root, 'workspace'), maxBytes: 1024 * 1024 });
    const config = { schemaVersion: 2, defaultProvider: 'p', defaultModelId: 'm',
      providers: { p: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://localhost/v1' } },
      models: { m: { provider: 'p', model: 'example', label: 'Example', capabilities: ['tools'] },
        selected: { provider: 'p', model: 'selected-example', label: 'Selected example', capabilities: ['tools'] } } } as Config;
    const projectModel = mode !== 'ordinary' ? await createProjectAgentModel({ modelId: mode === 'project-selected' ? 'selected' : undefined,
      loadConfig: async () => config, createAdapter: () => adapter }) : undefined;
    const host = new InProcessTaskRuntimeHost({ materialRegistry, snapshotStore,
      createTaskId: () => 'repetition', runner: async input => {
        const result = await runDesktopToolLoop({ adapter, projectModel, registry, allToolDefs: registry.getToolDefinitions(),
          messages: [{ role: 'user', content: [{ type: 'text', text: '检查示例状态' }] }], systemPrompt: '',
          signal: input.signal, taskDeadline: Date.now() + 10_000, sessionId: input.sessionId, taskId: input.taskId,
          turnId: 'turn', intentId: 'intent', stepId: 'step', materials: [], emitRuntimeEvent: input.emitRuntimeEvent,
          skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(),
          strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
            buildApiView: m => m, processToolResult: r => r, trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false } });
        await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: 'turn', intentId: 'intent', stepId: 'step', note: result.reply });
      } });
    try {
      await host.createTask({ prompt: '检查示例状态', materials: [] }); await host.drain();
      const { snapshot } = await host.recoverTask('repetition');
      expect(snapshot.status).toBe('failed');
      expect(snapshot.events).toContainEqual({ type: 'error', message: 'MODEL_TEXT_REPETITION_DETECTED', retryable: false, code: 'MODEL_TEXT_REPETITION_DETECTED' });
      expect(snapshot.events.some(e => e.type === 'result')).toBe(false);
      expect(snapshot.events.some(e => e.type === 'execution_health' && e.state === 'recovering')).toBe(false);
      if (mode !== 'project-selected') expect(snapshot.events.filter(e => e.type === 'assistant_delta').map(e => e.delta).join('')).toContain('此前记录已完成');
      expect(executed).toEqual(['completed']); expect(requests).toBe(2);
      expect(signals[1].aborted).toBe(true); expect(closed).toBe(2);
      expect(cancelled[1]).toBe(true);
      const restarted = new InProcessTaskRuntimeHost({ materialRegistry, snapshotStore, runner: async () => { throw new Error('must not replay'); } });
      expect((await restarted.recoverTask('repetition')).snapshot.status).toBe('failed');
      expect(executed).toEqual(['completed']);
    } finally { await host.drain(); registry.dispose(); rmSync(root, { recursive: true, force: true }); }
  });
});
