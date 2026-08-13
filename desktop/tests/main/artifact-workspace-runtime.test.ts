import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost, type TaskRunner } from '../../../src/runtime/task-host/task-runtime-host.js';
import {
  createArtifactWorkspaceGenerationFileTools,
  createArtifactWorkspacePluginProducerTool,
  createArtifactWorkspaceTools,
  createArtifactWorkspaceUnavailableProducerTool,
} from '../../electron/artifact-workspace-tools.js';
import type { Tool, ToolExecutionContext } from '../../../src/types.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { ModelInvocationOptions, StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import { createDesktopModelRunnerWithRegistry, runDesktopToolLoop } from '../../electron/desktop-services.js';

describe('artifact workspace runtime contract', () => {
  let rootDir: string;
  let snapshotStore: FileTaskSnapshotStore;
  let materialRegistry: MaterialRegistry;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-artifact-workspace-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    snapshotStore = new FileTaskSnapshotStore(join(rootDir, 'tasks'));
    materialRegistry = new MaterialRegistry({
      workspaceRoot: join(rootDir, 'workspace'),
      maxBytes: 1024 * 1024,
      now: () => 100,
    });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('calls the persisted-event hook only after the artifact event is recoverable', async () => {
    const observations: Array<{ taskId: string; eventIndex: number; recoveredType?: string; recoveredMimeType?: string }> = [];
    let host!: InProcessTaskRuntimeHost;
    const runner: TaskRunner = async ({ emitRuntimeEvent }) => {
      emitRuntimeEvent({
        type: 'artifact_recorded',
        sessionId: 'session-1',
        turnId: 'turn-1',
        intentId: 'intent-1',
        stageId: 'stage-1',
        artifactId: 'artifact-1',
        label: 'report.html',
        kind: 'html',
        mimeType: 'text/html',
        path: join(rootDir, 'workspace', 'report.html'),
      });
    };

    host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      createTaskId: () => 'task-owned',
      createSessionId: () => 'session-1',
      onPersistedEvent: async ({ taskId, eventIndex }) => {
        const snapshot = await snapshotStore.recoverTask(taskId);
        observations.push({
          taskId,
          eventIndex,
          recoveredType: snapshot?.events[eventIndex]?.type,
          recoveredMimeType: snapshot?.events[eventIndex]?.type === 'artifact_recorded'
            ? snapshot.events[eventIndex].mimeType
            : undefined,
        });
      },
    });

    const created = await host.createTask({ prompt: '生成报告', materials: [] });
    await vi.waitFor(async () => {
      expect((await host.recoverTask(created.taskId)).snapshot.status).toBe('completed');
    });

    expect(observations).toContainEqual({
      taskId: 'task-owned',
      eventIndex: 2,
      recoveredType: 'artifact_recorded',
      recoveredMimeType: 'text/html',
    });
  });

  it('persists and projects an explicit terminal event after the final task status is durable', async () => {
    const observations: Array<{ eventType: string; status: string }> = [];
    const host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner: async ({ emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'artifact_recorded', sessionId: 'session-1', turnId: 'turn-1', intentId: 'intent-1',
          stageId: 'stage-1', artifactId: 'artifact-1', label: 'report.md', kind: 'markdown',
          path: join(rootDir, 'workspace', 'report.md'),
        });
      },
      createTaskId: () => 'task-terminal',
      createSessionId: () => 'session-1',
      onPersistedEvent: ({ event, snapshot }) => {
        observations.push({ eventType: event.type, status: snapshot.status });
      },
    });

    const created = await host.createTask({ prompt: '生成报告', materials: [] });
    await vi.waitFor(async () => {
      expect((await host.recoverTask(created.taskId)).snapshot.status).toBe('completed');
    });

    expect(observations.at(-1)).toEqual({ eventType: 'task_terminal', status: 'completed' });
    const recovered = (await host.recoverTask(created.taskId)).snapshot;
    expect(recovered.events.at(-1)).toEqual({ type: 'task_terminal', status: 'completed' });
  });

  it('persists a failed terminal event after the failed status is durable', async () => {
    const observations: Array<{ eventType: string; status: string }> = [];
    const host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner: async () => { throw new Error('injected failure'); },
      createTaskId: () => 'task-terminal-failed',
      createSessionId: () => 'session-1',
      onPersistedEvent: ({ event, snapshot }) => {
        observations.push({ eventType: event.type, status: snapshot.status });
      },
    });

    const created = await host.createTask({ prompt: '触发失败', materials: [] });
    await vi.waitFor(async () => {
      expect((await host.recoverTask(created.taskId)).snapshot.status).toBe('failed');
    });

    expect(observations.at(-1)).toEqual({ eventType: 'task_terminal', status: 'failed' });
    expect((await host.recoverTask(created.taskId)).snapshot.events.at(-1))
      .toEqual({ type: 'task_terminal', status: 'failed' });
  });

  it('persists a cancelled terminal event after the cancelled status is durable', async () => {
    const observations: Array<{ eventType: string; status: string }> = [];
    const host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner: async ({ signal }) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
      },
      createTaskId: () => 'task-terminal-cancelled',
      createSessionId: () => 'session-1',
      onPersistedEvent: ({ event, snapshot }) => {
        observations.push({ eventType: event.type, status: snapshot.status });
      },
    });

    const created = await host.createTask({ prompt: '等待取消', materials: [] });
    await vi.waitFor(async () => {
      expect((await host.recoverTask(created.taskId)).snapshot.status).toBe('running');
    });
    await host.cancelTask(created.taskId);

    expect(observations.at(-1)).toEqual({ eventType: 'task_terminal', status: 'cancelled' });
    expect((await host.recoverTask(created.taskId)).snapshot.events.at(-1))
      .toEqual({ type: 'task_terminal', status: 'cancelled' });
  });
});

describe('desktop tool loop invocation and consumer ordering', () => {
  let rootDir: string;
  let registry: ToolRegistry;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-desktop-tool-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    registry = new ToolRegistry({ autoMode: true }, [{
      permission: 'read',
      definition: {
        name: 'noop',
        description: 'Return a deterministic tool result',
        inputSchema: { type: 'object', properties: {} },
      },
      async execute() {
        return JSON.stringify({ ok: true });
      },
    }]);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  function baseContext() {
    return {
      systemPrompt: 'system',
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'run' }] }],
      allToolDefs: registry.getToolDefinitions(),
      registry,
      signal: new AbortController().signal,
      taskDeadline: Date.now() + 30_000,
      sessionId: 'sess_123e4567-e89b-42d3-a456-426614174000',
      turnId: 'turn-1',
      intentId: 'intent-1',
      stepId: 'step-1',
      taskId: 'task-1',
      materials: [],
      emitRuntimeEvent: vi.fn(async () => undefined),
      skillInvocation: null,
      skillCatalog: {} as never,
      dataRoot: rootDir,
      taskStartTime: Date.now(),
      strategies: {
        compact: {
          enabled: false,
          shouldCompact: () => false,
          doCompact: async (_messages: unknown, _options?: StreamOptions) => {},
        },
        buildApiView: (messages: Parameters<typeof runDesktopToolLoop>[0]['messages']) => messages,
        processToolResult: (result: string) => result,
        trackAutoProgress: false,
        trackReferenceReads: false,
        emitSkillArtifactTrace: false,
      },
    };
  }

  it('reuses one current-signal StreamOptions object for compact, main, and finalization', async () => {
    const currentController = new AbortController();
    const staleController = new AbortController();
    const cacheKey = `pc1_${'a'.repeat(64)}`;
    const streamOptions: Array<StreamOptions | undefined> = [];
    const streamTools: string[][] = [];
    const compactOptions: Array<StreamOptions | undefined> = [];
    let streamCall = 0;
    const context = baseContext();

    const result = await runDesktopToolLoop({
      ...context,
      signal: currentController.signal,
      invocationOptions: {
        cacheKey,
        signal: staleController.signal,
      } as ModelInvocationOptions,
      maxIterations: 2,
      adapter: {
        async *stream(_messages, tools, _systemPrompt, options) {
          streamCall += 1;
          streamOptions.push(options);
          streamTools.push(tools.map(tool => tool.name));
          if (streamCall === 1) {
            yield { type: 'usage' as const, usage: { inputTokens: 10, outputTokens: 1 } };
            yield { type: 'tool_use' as const, id: 'call-1', name: 'noop', input: {} };
            return;
          }
          if (streamCall === 2) {
            yield { type: 'tool_use' as const, id: 'call-2', name: 'noop', input: {} };
            return;
          }
          yield { type: 'text' as const, delta: 'final' };
          yield { type: 'done' as const };
        },
      },
      strategies: {
        ...context.strategies,
        compact: {
          enabled: true,
          shouldCompact: inputTokens => inputTokens === 10,
          doCompact: async (_messages, options) => {
            compactOptions.push(options);
          },
        },
      },
    });

    expect(result.reply).toBe('final');
    expect(streamOptions).toHaveLength(3);
    expect(streamOptions[0]).toBe(streamOptions[1]);
    expect(streamOptions[1]).toBe(streamOptions[2]);
    expect(compactOptions).toEqual([streamOptions[0]]);
    expect(streamOptions[0]).toEqual({
      cacheKey,
      signal: currentController.signal,
    });
    expect(streamOptions[0]?.signal).not.toBe(staleController.signal);
    const expectedMainTools = context.allToolDefs.map(tool => tool.name);
    expect(streamTools).toEqual([expectedMainTools, expectedMainTools, []]);
  });

  it('waits for assistant delta persistence before consuming the next provider chunk', async () => {
    let markEmitStarted: (() => void) | undefined;
    const emitStarted = new Promise<void>((resolve) => { markEmitStarted = resolve; });
    let releaseEmit: (() => void) | undefined;
    const emitRelease = new Promise<void>((resolve) => { releaseEmit = resolve; });
    let providerAdvanced = false;
    const context = baseContext();

    const execution = runDesktopToolLoop({
      ...context,
      emitRuntimeEvent: vi.fn(async (event) => {
        if (event.type !== 'assistant_delta') return;
        markEmitStarted?.();
        await emitRelease;
      }),
      adapter: {
        async *stream() {
          yield { type: 'text' as const, delta: 'first' };
          providerAdvanced = true;
          yield { type: 'text' as const, delta: 'second' };
          yield { type: 'done' as const };
        },
      },
    });

    await emitStarted;
    expect(providerAdvanced).toBe(false);
    releaseEmit?.();
    await expect(execution).resolves.toMatchObject({ reply: 'firstsecond' });
    expect(providerAdvanced).toBe(true);
  });

  it('accounts main-stream usage once before propagating the same pending AbortError', async () => {
    const controller = new AbortController();
    const sentinel = new DOMException('main aborted', 'AbortError');
    const usage = vi.fn();
    const context = baseContext();

    const execution = runDesktopToolLoop({
      ...context,
      signal: controller.signal,
      adapter: {
        async *stream() {
          controller.abort(sentinel);
          yield { type: 'usage' as const, usage: { inputTokens: 12, outputTokens: 3 } };
          throw sentinel;
        },
      },
      onUsage: usage,
    });

    await expect(execution).rejects.toBe(sentinel);
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith(12, 3);
    expect(context.emitRuntimeEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'assistant_delta' }),
    );
    expect(context.messages).toHaveLength(1);
  });

  it('accounts finalization usage once before propagating the same pending AbortError', async () => {
    const controller = new AbortController();
    const sentinel = new DOMException('finalization aborted', 'AbortError');
    const usage = vi.fn();
    const context = baseContext();
    let streamCall = 0;

    const execution = runDesktopToolLoop({
      ...context,
      signal: controller.signal,
      maxIterations: 1,
      adapter: {
        async *stream() {
          streamCall += 1;
          if (streamCall === 1) {
            yield { type: 'tool_use' as const, id: 'call-1', name: 'noop', input: {} };
            return;
          }
          controller.abort(sentinel);
          yield { type: 'usage' as const, usage: { inputTokens: 21, outputTokens: 5 } };
          throw sentinel;
        },
      },
      onUsage: usage,
    });

    await expect(execution).rejects.toBe(sentinel);
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith(21, 5);
    expect(context.emitRuntimeEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'assistant_delta' }),
    );
  });

  it('checks abort after usage-only clean exhaustion before committing an assistant turn', async () => {
    const controller = new AbortController();
    const usage = vi.fn();
    const context = baseContext();

    const execution = runDesktopToolLoop({
      ...context,
      signal: controller.signal,
      adapter: {
        async *stream() {
          yield { type: 'usage' as const, usage: { inputTokens: 8, outputTokens: 0 } };
          controller.abort('user_cancelled');
        },
      },
      onUsage: usage,
    });

    await expect(execution).rejects.toThrow('task cancelled');
    expect(usage).toHaveBeenCalledTimes(1);
    expect(context.messages).toHaveLength(1);
  });
});

describe('artifact workspace narrow tools', () => {
  it('persists one canonical scoped artifact event and claims the exact typed-ack identity', async () => {
    const generationRoot = join(tmpdir(), `xiaok-artifact-canonical-event-${Date.now()}`);
    mkdirSync(join(generationRoot, 'lease-1'), { recursive: true });
    const fileTools = createArtifactWorkspaceGenerationFileTools(generationRoot, () => 'markdown');
    const claims: Array<Record<string, unknown>> = [];
    const registry = new ToolRegistry({ autoMode: true }, fileTools);
    for (const tool of createArtifactWorkspaceTools({
      async claimProducedArtifact(input) {
        claims.push(input as unknown as Record<string, unknown>);
        return { outcomeKind: 'ready_version' as const, versionId: 'version-1' };
      },
    })) {
      registry.registerTool(tool);
    }
    const emitted: Array<Record<string, unknown>> = [];
    let streamCall = 0;
    const outputPath = join(generationRoot, 'lease-1', 'result.md');

    await runDesktopToolLoop({
      adapter: {
        async *stream(messages) {
          streamCall += 1;
          if (streamCall === 1) {
            yield {
              type: 'tool_use' as const,
              id: 'call-write-1',
              name: 'write',
              input: { file_path: 'result.md', content: '# result' },
            };
            return;
          }
          if (streamCall === 2) {
            const last = messages.at(-1);
            const result = last?.content.find(block => block.type === 'tool_result');
            const ack = JSON.parse(result?.type === 'tool_result' ? result.content : '{}') as { artifactId?: string };
            yield {
              type: 'tool_use' as const,
              id: 'call-claim-1',
              name: 'artifact_workspace_fulfill_placeholder',
              input: { leaseId: 'lease-1', producedArtifactId: ack.artifactId },
            };
            return;
          }
          yield { type: 'text' as const, delta: 'done' };
        },
      },
      systemPrompt: 'test',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'write result' }] }],
      allToolDefs: registry.getToolDefinitions(),
      registry,
      signal: new AbortController().signal,
      taskDeadline: Date.now() + 30_000,
      sessionId: 'session-1',
      turnId: 'turn-1',
      intentId: 'intent-1',
      stepId: 'step-1',
      taskId: 'task-owned',
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: 'request-1', leaseId: 'lease-1' },
      materials: [],
      emitRuntimeEvent(event) {
        emitted.push(event as unknown as Record<string, unknown>);
      },
      skillInvocation: null,
      skillCatalog: {} as never,
      dataRoot: generationRoot,
      taskStartTime: Date.now(),
      maxIterations: 4,
      strategies: {
        compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
        buildApiView: messages => messages,
        processToolResult: result => result,
        trackAutoProgress: false,
        trackReferenceReads: false,
        emitSkillArtifactTrace: false,
      },
    });

    const artifactEvents = emitted.filter(event => event.type === 'artifact_recorded');
    expect(artifactEvents).toHaveLength(1);
    expect(artifactEvents[0]).toMatchObject({
      artifactId: expect.stringMatching(/^artifact_[a-f0-9]{20}$/),
      path: outputPath,
      kind: 'markdown',
      mimeType: 'text/markdown',
      creator: 'agent',
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ producedArtifactId: artifactEvents[0].artifactId });
    expect(artifactEvents[0].artifactId).not.toBe('artifact_call-write-1');
    rmSync(generationRoot, { recursive: true, force: true });
  });

  it('preserves bundled slides kind, MIME and provenance through the canonical tool loop event', async () => {
    const generationRoot = join(tmpdir(), `xiaok-artifact-plugin-event-${Date.now()}`);
    const pluginTool: Tool = {
      permission: 'write',
      definition: {
        name: 'mcp__slide-renderer__render_slide',
        description: 'render slide',
        inputSchema: { type: 'object', properties: { brief_json: { type: 'string' } }, required: ['brief_json'] },
      },
      async execute(input) {
        writeFileSync(String(input.output_path), '<section class="slide">Deck</section>');
        return JSON.stringify({ success: true });
      },
    };
    const producer = createArtifactWorkspacePluginProducerTool({
      generationRoot,
      resolveRequestedKind: () => 'slides',
      tool: pluginTool,
      requestedKind: 'slides',
      outputFileName: 'slides.html',
      pluginSource: 'kai-slide-creator',
      mimeType: 'application/vnd.xiaok.slides+html',
    });
    const claims: Array<Record<string, unknown>> = [];
    const registry = new ToolRegistry({ autoMode: true }, [producer]);
    for (const tool of createArtifactWorkspaceTools({
      async claimProducedArtifact(input) {
        claims.push(input as unknown as Record<string, unknown>);
        return { outcomeKind: 'ready_version' as const, versionId: 'version-slides' };
      },
    })) registry.registerTool(tool);
    const emitted: Array<Record<string, unknown>> = [];
    let streamCall = 0;

    await runDesktopToolLoop({
      adapter: {
        async *stream(messages) {
          streamCall += 1;
          if (streamCall === 1) {
            yield {
              type: 'tool_use' as const,
              id: 'call-slide-1',
              name: 'mcp__slide-renderer__render_slide',
              input: { brief_json: '{"title":"Deck"}' },
            };
            return;
          }
          if (streamCall === 2) {
            const last = messages.at(-1);
            const result = last?.content.find(block => block.type === 'tool_result');
            const ack = JSON.parse(result?.type === 'tool_result' ? result.content : '{}') as { artifactId?: string };
            yield {
              type: 'tool_use' as const,
              id: 'call-claim-slide',
              name: 'artifact_workspace_fulfill_placeholder',
              input: { leaseId: 'lease-1', producedArtifactId: ack.artifactId },
            };
            return;
          }
          yield { type: 'text' as const, delta: 'done' };
        },
      },
      systemPrompt: 'test',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'render slides' }] }],
      allToolDefs: registry.getToolDefinitions(), registry,
      signal: new AbortController().signal,
      taskDeadline: Date.now() + 30_000,
      sessionId: 'session-1', turnId: 'turn-1', intentId: 'intent-1', stepId: 'step-1', taskId: 'task-owned',
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: 'request-1', leaseId: 'lease-1' },
      materials: [],
      emitRuntimeEvent(event) { emitted.push(event as unknown as Record<string, unknown>); },
      skillInvocation: null, skillCatalog: {} as never, dataRoot: generationRoot, taskStartTime: Date.now(), maxIterations: 4,
      strategies: {
        compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
        buildApiView: messages => messages,
        processToolResult: result => result,
        trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false,
      },
    });

    const artifactEvents = emitted.filter(event => event.type === 'artifact_recorded');
    expect(artifactEvents).toEqual([expect.objectContaining({
      artifactId: expect.stringMatching(/^artifact_[a-f0-9]{20}$/),
      path: join(generationRoot, 'lease-1', 'slides.html'),
      kind: 'slides',
      mimeType: 'application/vnd.xiaok.slides+html',
      creator: 'plugin:kai-slide-creator',
    })]);
    expect(claims[0]).toMatchObject({ producedArtifactId: artifactEvents[0].artifactId });
    rmSync(generationRoot, { recursive: true, force: true });
  });

  it('exposes only lease-directory filesystem tools and rejects cross-lease writes', async () => {
    const generationRoot = join(tmpdir(), `xiaok-artifact-generation-tools-${Date.now()}`);
    mkdirSync(join(generationRoot, 'lease-1'), { recursive: true });
    const tools = createArtifactWorkspaceGenerationFileTools(generationRoot, () => 'markdown');
    expect(tools.map(tool => tool.definition.name)).toEqual(['read', 'write', 'edit']);
    expect(tools.map(tool => tool.definition.name)).not.toContain('bash');
    const context = {
      taskId: 'task-owned',
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: 'request-1', leaseId: 'lease-1' },
    } as ToolExecutionContext;
    const ownPath = join(generationRoot, 'lease-1', 'result.md');
    const writeResult = await tools[1].execute({ file_path: ownPath, content: '# safe' }, context);
    expect(JSON.parse(writeResult)).toMatchObject({
      ok: true, artifactPath: ownPath, kind: 'markdown', mimeType: 'text/markdown',
    });
    expect(readFileSync(ownPath, 'utf8')).toBe('# safe');
    await expect(tools[1].execute({
      file_path: join(generationRoot, 'lease-2', 'forbidden.md'), content: '# forbidden',
    }, context)).rejects.toThrow();
    rmSync(generationRoot, { recursive: true, force: true });
  });

  it('forces bundled plugin output into the lease directory and preserves plugin provenance', async () => {
    const generationRoot = join(tmpdir(), `xiaok-artifact-plugin-tools-${Date.now()}`);
    const calls: Record<string, unknown>[] = [];
    const pluginTool: Tool = {
      permission: 'write',
      definition: {
        name: 'mcp__slide-renderer__render_slide',
        description: 'render slide',
        inputSchema: {
          type: 'object',
          properties: { brief_json: { type: 'string' }, output_path: { type: 'string' } },
          required: ['brief_json'],
        },
      },
      async execute(input) {
        calls.push(input);
        writeFileSync(String(input.output_path), '<section class="slide">Deck</section>');
        return JSON.stringify({ success: true });
      },
    };
    const tool = createArtifactWorkspacePluginProducerTool({
      generationRoot,
      resolveRequestedKind: () => 'slides',
      tool: pluginTool,
      requestedKind: 'slides',
      outputFileName: 'slides.html',
      pluginSource: 'kai-slide-creator',
      mimeType: 'application/vnd.xiaok.slides+html',
    });
    const context = {
      taskId: 'task-owned',
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: 'request-1', leaseId: 'lease-1' },
    } as ToolExecutionContext;

    const result = JSON.parse(await tool.execute({
      brief_json: '{"title":"Deck"}', output_path: join(tmpdir(), 'injected.html'),
    }, context));
    const expectedOutput = join(generationRoot, 'lease-1', 'slides.html');
    expect(calls).toEqual([expect.objectContaining({ output_path: expectedOutput })]);
    expect(result).toMatchObject({
      ok: true,
      artifactPath: expectedOutput,
      kind: 'slides',
      mimeType: 'application/vnd.xiaok.slides+html',
      creator: 'plugin:kai-slide-creator',
      pluginSource: 'kai-slide-creator',
    });
    expect(tool.definition.inputSchema).not.toMatchObject({
      properties: expect.objectContaining({ output_path: expect.anything() }),
    });
    rmSync(generationRoot, { recursive: true, force: true });
  });

  it('blocks handwritten HTML before bytes are written so plugin failure cannot create a fallback artifact', async () => {
    const generationRoot = join(tmpdir(), `xiaok-artifact-html-fallback-${Date.now()}`);
    mkdirSync(join(generationRoot, 'lease-1'), { recursive: true });
    const tools = createArtifactWorkspaceGenerationFileTools(generationRoot, () => 'html');
    const outputPath = join(generationRoot, 'lease-1', 'fallback.html');
    const context = {
      taskId: 'task-owned',
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: 'request-1', leaseId: 'lease-1' },
    } as ToolExecutionContext;

    await expect(tools[1].execute({ file_path: outputPath, content: '<h1>Fallback</h1>' }, context))
      .rejects.toThrow('plugin_unavailable');
    expect(existsSync(outputPath)).toBe(false);
    rmSync(generationRoot, { recursive: true, force: true });
  });

  it('returns plugin_unavailable without creating a fallback artifact', async () => {
    const tool = createArtifactWorkspaceUnavailableProducerTool({
      name: 'mcp__slide-renderer__render_slide',
      pluginSource: 'kai-slide-creator',
      requestedKind: 'slides',
      properties: { brief_json: { type: 'string' } },
      required: ['brief_json'],
    });
    await expect(tool.execute({ brief_json: '{}' })).resolves.toContain('plugin_unavailable');
  });

  it('keeps the actual artifact runner registry free of global and KSwarm mutation tools', () => {
    const generationRoot = join(tmpdir(), `xiaok-artifact-generation-registry-${Date.now()}`);
    const registryMaterials = new MaterialRegistry({ workspaceRoot: generationRoot, maxBytes: 1024, now: () => 100 });
    const tools = createArtifactWorkspaceGenerationFileTools(generationRoot, () => 'markdown');
    const registry = new ToolRegistry({ autoMode: true }, tools);
    createDesktopModelRunnerWithRegistry(
      registry,
      tools,
      generationRoot,
      {} as never,
      registryMaterials,
      {},
      { restrictedArtifactGeneration: true },
    );
    expect(registry.getToolDefinitions().map(definition => definition.name).sort()).toEqual([
      'edit', 'read', 'tool_search', 'write',
    ]);
  });

  it('exposes exactly three lease-only tools and injects host-owned task identity', async () => {
    const seen: unknown[] = [];
    const tools = createArtifactWorkspaceTools({
      async claimProducedArtifact(input) {
        seen.push(input);
        return { outcomeKind: 'ready_version' as const, versionId: 'version-1' };
      },
    });
    expect(tools.map(tool => tool.definition.name)).toEqual([
      'artifact_workspace_fulfill_placeholder',
      'artifact_workspace_append_revision',
      'artifact_workspace_append_collection_item',
    ]);
    for (const tool of tools) {
      expect(tool.definition.inputSchema).toMatchObject({
        type: 'object', required: ['leaseId', 'producedArtifactId'], additionalProperties: false,
      });
    }
    const context = {
      taskId: 'task-owned',
      executionScope: { kind: 'artifact_workspace_generation', generationRequestId: 'request-1', leaseId: 'lease-1' },
    } as ToolExecutionContext;
    const result = await tools[0].execute({
      leaseId: 'lease-1', producedArtifactId: 'artifact-1', taskId: 'model-injected', workspaceId: 'forbidden',
    }, context);
    expect(JSON.parse(result)).toMatchObject({ ok: true, outcomeKind: 'ready_version', versionId: 'version-1' });
    expect(seen).toEqual([expect.objectContaining({
      leaseId: 'lease-1', producedArtifactId: 'artifact-1', taskId: 'task-owned',
      executionScope: context.executionScope, expectedAction: 'fulfill_placeholder', projectionKind: 'narrow_tool',
    })]);
    expect(seen[0]).not.toMatchObject({ workspaceId: expect.anything() });
  });

  it('default-denies execution without a host-owned context', async () => {
    const tools = createArtifactWorkspaceTools({ claimProducedArtifact: vi.fn() });
    await expect(tools[1].execute({ leaseId: 'lease-1', producedArtifactId: 'artifact-1' }))
      .resolves.toContain('permission_denied');
  });
});
