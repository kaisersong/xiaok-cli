import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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
import { createDesktopModelRunnerWithRegistry, runDesktopToolLoop } from '../../electron/desktop-services.js';

async function runWorkflowStatusProjection(input: {
  toolName?: string;
  result: Record<string, unknown>;
  dataRoot: string;
}): Promise<Array<Record<string, unknown>>> {
  const toolName = input.toolName ?? 'get_dynamic_workflow_status';
  const statusTool: Tool = {
    permission: 'safe',
    definition: {
      name: toolName,
      description: 'test workflow status',
      inputSchema: { type: 'object', properties: {} },
    },
    async execute() {
      return JSON.stringify(input.result);
    },
  };
  const registry = new ToolRegistry({ autoMode: true }, [statusTool]);
  const emitted: Array<Record<string, unknown>> = [];
  let streamCall = 0;

  await runDesktopToolLoop({
    adapter: {
      async *stream() {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: 'tool_use' as const,
            id: 'call-workflow-status',
            name: toolName,
            input: { projectId: 'project-1', workflowRunId: 'workflow-1' },
          };
          return;
        }
        yield { type: 'text' as const, delta: 'done' };
      },
    },
    systemPrompt: 'test',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'inspect workflow' }] }],
    allToolDefs: registry.getToolDefinitions(),
    registry,
    signal: new AbortController().signal,
    taskDeadline: Date.now() + 30_000,
    sessionId: 'session-1',
    turnId: 'turn-1',
    intentId: 'intent-1',
    stepId: 'step-1',
    taskId: 'task-1',
    materials: [],
    emitRuntimeEvent(event) {
      emitted.push(event as unknown as Record<string, unknown>);
    },
    skillInvocation: null,
    skillCatalog: {} as never,
    dataRoot: input.dataRoot,
    taskStartTime: Date.now(),
    maxIterations: 2,
    strategies: {
      compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} },
      buildApiView: messages => messages,
      processToolResult: result => result,
      trackAutoProgress: false,
      trackReferenceReads: false,
      emitSkillArtifactTrace: false,
    },
  });

  return emitted;
}

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

describe('KSwarm workflow status artifact projection', () => {
  let workspaceRoot: string;
  let artifactsDir: string;

  beforeEach(() => {
    workspaceRoot = join(tmpdir(), `xiaok-workflow-status-artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    artifactsDir = join(workspaceRoot, 'artifacts');
    mkdirSync(artifactsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('records every valid workflow artifact without claiming the status task created the files', async () => {
    const htmlPath = join(artifactsDir, 'report.html');
    const markdownPath = join(artifactsDir, 'report.md');
    const textPath = join(artifactsDir, 'notes.txt');
    const outsidePath = join(tmpdir(), `xiaok-workflow-status-direct-escape-${Date.now()}.html`);
    writeFileSync(htmlPath, '<!doctype html><title>Report</title>');
    writeFileSync(markdownPath, '# Report');
    writeFileSync(textPath, 'notes');
    writeFileSync(outsidePath, '<!doctype html><title>Outside</title>');
    const canonicalHtmlPath = realpathSync(htmlPath);
    const canonicalMarkdownPath = realpathSync(markdownPath);
    const canonicalTextPath = realpathSync(textPath);

    const workflowResult = {
      ok: true,
      projectId: 'project-1',
      workflowRunId: 'workflow-1',
      status: 'completed',
      projectWorkspacePath: workspaceRoot,
      diagnostics: 'x'.repeat(12_000),
      scriptResult: {
        workspacePath: workspaceRoot,
        producerAgent: 'xiaok-worker',
        artifacts: [
          { path: 'artifacts/report.html', kind: 'html', label: 'report.html' },
          { path: 'artifacts/report.md', kind: 'markdown', label: 'report.md' },
          { path: 'artifacts/report.html', kind: 'html', label: 'duplicate.html' },
          'artifacts/notes.txt',
          { path: relative(workspaceRoot, outsidePath), kind: 'html', label: 'relative-outside.html' },
          { path: outsidePath, kind: 'html', label: 'absolute-outside.html' },
          { path: 'artifacts/missing.html', kind: 'html', label: 'missing.html' },
        ],
      },
    };

    try {
      const emitted = await runWorkflowStatusProjection({
        dataRoot: workspaceRoot,
        result: workflowResult,
      });
      const artifactEvents = emitted.filter(event => event.type === 'artifact_recorded');

      expect(artifactEvents).toEqual([
        expect.objectContaining({
          artifactId: expect.stringMatching(/^artifact_[a-f0-9]{20}$/),
          path: canonicalHtmlPath,
          kind: 'html',
          label: 'report.html',
          creator: 'xiaok-worker',
        }),
        expect.objectContaining({
          artifactId: expect.stringMatching(/^artifact_[a-f0-9]{20}$/),
          path: canonicalMarkdownPath,
          kind: 'markdown',
          label: 'report.md',
          creator: 'xiaok-worker',
        }),
        expect.objectContaining({
          artifactId: expect.stringMatching(/^artifact_[a-f0-9]{20}$/),
          path: canonicalTextPath,
          kind: 'file',
          label: 'notes.txt',
          creator: 'xiaok-worker',
        }),
      ]);
      expect(artifactEvents[0]?.artifactId).not.toBe(artifactEvents[1]?.artifactId);
      expect(emitted.filter(event => event.type === 'file_changed')).toEqual([]);

      const repeated = await runWorkflowStatusProjection({
        dataRoot: workspaceRoot,
        result: workflowResult,
      });
      expect(repeated.filter(event => event.type === 'artifact_recorded').map(event => event.artifactId))
        .toEqual(artifactEvents.map(event => event.artifactId));
    } finally {
      rmSync(outsidePath, { force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('rejects an artifacts symlink that resolves outside the workspace', async () => {
    const validPath = join(artifactsDir, 'valid.html');
    const outsidePath = join(tmpdir(), `xiaok-workflow-status-outside-${Date.now()}.html`);
    const escapedPath = join(artifactsDir, 'escaped.html');
    writeFileSync(validPath, '<!doctype html><title>Valid</title>');
    writeFileSync(outsidePath, '<!doctype html><title>Outside</title>');
    symlinkSync(outsidePath, escapedPath);
    const canonicalValidPath = realpathSync(validPath);

    try {
      const emitted = await runWorkflowStatusProjection({
        dataRoot: workspaceRoot,
        result: {
          ok: true,
          workflowRunId: 'workflow-1',
          projectWorkspacePath: workspaceRoot,
          scriptResult: {
            workFolder: workspaceRoot,
            artifacts: [
              { path: 'artifacts/valid.html', kind: 'html' },
              { path: 'artifacts/escaped.html', kind: 'html' },
            ],
          },
        },
      });

      expect(emitted.filter(event => event.type === 'artifact_recorded')).toEqual([
        expect.objectContaining({ path: canonicalValidPath, label: 'valid.html' }),
      ]);
    } finally {
      rmSync(outsidePath, { force: true });
    }
  });

  it('ignores artifact-shaped output from other tools', async () => {
    const htmlPath = join(artifactsDir, 'report.html');
    writeFileSync(htmlPath, '<!doctype html><title>Report</title>');

    const emitted = await runWorkflowStatusProjection({
      toolName: 'inspect_project',
      dataRoot: workspaceRoot,
      result: {
        ok: true,
        workflowRunId: 'workflow-1',
        scriptResult: {
          workspacePath: workspaceRoot,
          artifacts: [{ path: 'artifacts/report.html', kind: 'html' }],
        },
      },
    });

    expect(emitted.filter(event => event.type === 'artifact_recorded')).toEqual([]);
  });

  it('does not let an invalid status artifact escape through the generic output_path fallback', async () => {
    const fallbackPath = join(workspaceRoot, 'fallback.html');
    writeFileSync(fallbackPath, '<!doctype html><title>Fallback</title>');

    const emitted = await runWorkflowStatusProjection({
      dataRoot: workspaceRoot,
      result: {
        ok: true,
        workflowRunId: 'workflow-1',
        projectWorkspacePath: workspaceRoot,
        output_path: fallbackPath,
        scriptResult: {
          workspacePath: workspaceRoot,
          artifacts: [{ path: '../outside.html', kind: 'html' }],
        },
      },
    });

    expect(emitted.filter(event => event.type === 'artifact_recorded')).toEqual([]);
    expect(emitted.filter(event => event.type === 'file_changed')).toEqual([]);
  });

  it('rejects artifacts when the workflow result declares a different workspace than the KSwarm project', async () => {
    const declaredWorkspace = join(tmpdir(), `xiaok-workflow-status-declared-${Date.now()}`);
    const declaredArtifacts = join(declaredWorkspace, 'artifacts');
    const declaredHtml = join(declaredArtifacts, 'report.html');
    mkdirSync(declaredArtifacts, { recursive: true });
    writeFileSync(declaredHtml, '<!doctype html><title>Untrusted</title>');

    try {
      const emitted = await runWorkflowStatusProjection({
        dataRoot: workspaceRoot,
        result: {
          ok: true,
          workflowRunId: 'workflow-1',
          projectWorkspacePath: workspaceRoot,
          scriptResult: {
            workspacePath: declaredWorkspace,
            artifacts: [{ path: 'artifacts/report.html', kind: 'html' }],
          },
        },
      });

      expect(emitted.filter(event => event.type === 'artifact_recorded')).toEqual([]);
    } finally {
      rmSync(declaredWorkspace, { recursive: true, force: true });
    }
  });

  it('does not project workflow artifacts without an authoritative KSwarm project workspace', async () => {
    const htmlPath = join(artifactsDir, 'report.html');
    writeFileSync(htmlPath, '<!doctype html><title>Report</title>');

    const emitted = await runWorkflowStatusProjection({
      dataRoot: workspaceRoot,
      result: {
        ok: true,
        workflowRunId: 'workflow-1',
        scriptResult: {
          workspacePath: workspaceRoot,
          artifacts: [{ path: 'artifacts/report.html', kind: 'html' }],
        },
      },
    });

    expect(emitted.filter(event => event.type === 'artifact_recorded')).toEqual([]);
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
