// @vitest-environment node
import { createServer, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { Config } from '../../../src/types.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';
import { createProjectAgentModel } from '../../electron/project-agent-model.js';

describe('Desktop real provider stream ownership', () => {
  it.each(['ordinary', 'project-default', 'project-selected'])('continues after one committed tool without replay: %s', async mode => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-stream-lifecycle-'));
    const open = new Set<ServerResponse>(); let requests = 0, executions = 0;
    const server = createServer(async (req, res) => {
      for await (const _ of req) { /* Read actual SDK body. */ }
      open.add(res); res.on('close', () => open.delete(res));
      const first = ++requests === 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'example', choices: [{ index: 0,
        delta: first ? { tool_calls: [{ index: 0, id: 'committed', type: 'function', function: { name: 'record', arguments: '{}' } }] } : { content: '示例任务已经完成' }, finish_reason: first ? 'tool_calls' : 'stop' }] })}\n\n`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing port');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const adapter = new OpenAIAdapter({ apiKey: 'fixture', harnessContext: buildOpenAIHarnessContext({ identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: baseUrl, wireModel: 'example', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}) }) });
    const config = { schemaVersion: 2, defaultProvider: 'p', defaultModelId: 'm', providers: { p: { type: 'custom', protocol: 'openai_legacy', baseUrl } }, models: { m: { provider: 'p', model: 'example', label: 'Example', capabilities: ['tools'] }, selected: { provider: 'p', model: 'selected', label: 'Selected', capabilities: ['tools'] } } } as Config;
    const projectModel = mode === 'ordinary' ? undefined : await createProjectAgentModel({ modelId: mode === 'project-selected' ? 'selected' : undefined, loadConfig: async () => config, createAdapter: () => adapter });
    const registry = new ToolRegistry({ autoMode: true }, [{ definition: { name: 'record', description: 'fixture', inputSchema: { type: 'object', properties: {} } }, async execute() { executions++; return 'saved'; } }]);
    const snapshotStore = new FileTaskSnapshotStore(join(root, 'tasks'));
    const materialRegistry = new MaterialRegistry({ workspaceRoot: join(root, 'workspace'), maxBytes: 1024 }); let taskSignal: AbortSignal | undefined;
    const host = new InProcessTaskRuntimeHost({ materialRegistry, snapshotStore, createTaskId: () => 'fixture', runner: async input => {
      taskSignal = input.signal;
      const result = await runDesktopToolLoop({ adapter, projectModel, registry, allToolDefs: registry.getToolDefinitions(), messages: [{ role: 'user', content: [{ type: 'text', text: '执行一次示例操作并报告结果' }] }], systemPrompt: '', signal: input.signal, taskDeadline: Date.now() + 5000, sessionId: input.sessionId, taskId: input.taskId, turnId: 'turn', intentId: 'intent', stepId: 'step', materials: [], emitRuntimeEvent: input.emitRuntimeEvent, skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(), strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} }, buildApiView: m => m, processToolResult: r => r, trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false } });
      await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId, turnId: 'turn', intentId: 'intent', stepId: 'step', note: result.reply });
    } });
    try {
      await host.createTask({ prompt: '执行一次示例操作并报告结果', materials: [] }); await host.drain();
      const { snapshot } = await host.recoverTask('fixture');
      expect(snapshot.status).toBe('completed'); expect(requests).toBe(2); expect(executions).toBe(1); expect(taskSignal?.aborted).toBe(false);
      await expect.poll(() => open.size).toBe(0); expect(snapshot.events.some(e => e.type === 'error')).toBe(false);
      expect((await new FileTaskSnapshotStore(join(root, 'tasks')).recoverTask('fixture'))?.status).toBe('completed');
    } finally {
      for (const response of open) response.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      registry.dispose(); rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
