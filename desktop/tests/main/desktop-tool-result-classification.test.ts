import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { bashTool } from '../../../src/ai/tools/bash.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import type { Tool } from '../../../src/types.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';

function cannedTool(name: string, permission: Tool['permission'], result: string): Tool {
  return {
    permission,
    definition: {
      name,
      description: `returns ${JSON.stringify(result)}`,
      inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } },
    },
    async execute() {
      return result;
    },
  };
}

describe('desktop tool result classification', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-tool-result-class-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  function baseContext(registry: ToolRegistry) {
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
      emitRuntimeEvent: vi.fn(),
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

  function singleToolCallAdapter(name: string, input: Record<string, unknown> = {}) {
    let streamCall = 0;
    return {
      async *stream() {
        streamCall += 1;
        if (streamCall === 1) {
          yield { type: 'tool_use' as const, id: 'call-1', name, input };
          return;
        }
        yield { type: 'text' as const, delta: 'final' };
        yield { type: 'done' as const };
      },
    };
  }

  async function runWith(tool: Tool, input: Record<string, unknown> = {}) {
    const registry = new ToolRegistry({ autoMode: true }, [tool]);
    const context = baseContext(registry);
    await runDesktopToolLoop({
      ...context,
      maxIterations: 2,
      adapter: singleToolCallAdapter(tool.definition.name, input),
    });
    const emitted = context.emitRuntimeEvent.mock.calls.map(
      ([event]) => (event as { type: string }).type,
    );
    return { context, emitted };
  }

  it('reports a declined tool call as a failure, not a success', async () => {
    const { context, emitted } = await runWith(cannedTool('bash', 'bash', '（已取消: bash）'));

    expect(emitted).toContain('post_tool_use_failure');
    expect(emitted).not.toContain('post_tool_use');

    const toolResult = context.messages
      .flatMap(message => message.content)
      .find(block => block.type === 'tool_result');
    expect(toolResult).toMatchObject({ type: 'tool_result', is_error: true });
  });

  it('does not infer an artifact from a declined write', async () => {
    const { emitted } = await runWith(
      cannedTool('write', 'write', '（已取消: write）'),
      { file_path: join(rootDir, 'report.md') },
    );

    expect(emitted).not.toContain('artifact_recorded');
    expect(emitted).not.toContain('file_changed');
    expect(emitted).toContain('post_tool_use_failure');
  });

  // Invariant lock, not a regression test: `startsWith('Error')` already classifies
  // this as a failure today. It exists so nobody relaxes the rule to /^Error\b/,
  // which would flip it to success.
  it('keeps classifying Errors-prefixed output as a failure', async () => {
    const { emitted } = await runWith(cannedTool('probe', 'safe', 'Errors found: 0'));

    expect(emitted).toContain('post_tool_use_failure');
    expect(emitted).not.toContain('post_tool_use');
  });

  // Invariant lock: a non-zero bash exit must stay a failure.
  it('keeps classifying a non-zero exit result as a failure', async () => {
    const { emitted } = await runWith(cannedTool('probe', 'safe', 'Error (exit 1): boom'));

    expect(emitted).toContain('post_tool_use_failure');
    expect(emitted).not.toContain('post_tool_use');
  });

  it('treats an ordinary result as a success', async () => {
    const { emitted } = await runWith(cannedTool('probe', 'safe', 'ok'));

    expect(emitted).toContain('post_tool_use');
    expect(emitted).not.toContain('post_tool_use_failure');
  });

  it('reports a JSON domain-level failure as a failure, not a success', async () => {
    const { context, emitted } = await runWith(cannedTool(
      'inspect_project',
      'safe',
      '{"ok":false,"status":400,"error":"project_not_found","projectName":"Dream"}',
    ));

    expect(emitted).toContain('post_tool_use_failure');
    expect(emitted).not.toContain('post_tool_use');

    const toolResult = context.messages
      .flatMap(message => message.content)
      .find(block => block.type === 'tool_result');
    expect(toolResult).toMatchObject({ type: 'tool_result', is_error: true });
  });

  it('reports a renderer that produced nothing as a failure', async () => {
    const { emitted } = await runWith(cannedTool(
      'mcp__slide-renderer__render_slide',
      'safe',
      '{"success":false,"html":"","errors":["BRIEF validation failed"]}',
    ));

    expect(emitted).toContain('post_tool_use_failure');
  });

  // A kswarm call that advanced nothing is not a success. An exception for
  // `no_intervention_required` was rejected: most of those payloads are repair
  // submissions kswarm refused while discarding the artifact.
  it('reports a kswarm call that advanced nothing as a failure', async () => {
    const { context, emitted } = await runWith(cannedTool(
      'continue_project',
      'safe',
      '{"ok":false,"status":400,"error":"no_intervention_required","intervention":{"required":false,"severity":"normal","reason":"no_blocking_task"}}',
    ));

    expect(emitted).toContain('post_tool_use_failure');

    const toolResult = context.messages
      .flatMap(message => message.content)
      .find(block => block.type === 'tool_result');
    expect(toolResult).toMatchObject({ type: 'tool_result', is_error: true });
  });

  // An exception for a non-empty output_path was rejected as fail-open: the
  // report renderer writes best-effort inside a try/catch and returns the path
  // regardless, so the path proves nothing about the artifact existing.
  it('reports a failed report render as a failure even when it names an output path', async () => {
    const { emitted } = await runWith(cannedTool(
      'render_report_artifact',
      'safe',
      `{"success":false,"output_path":"${join(rootDir, 'report.html').replace(/\\/g, '\\\\')}","validation":{"l0_passed":true,"l2_passed":false}}`,
    ));

    expect(emitted).toContain('post_tool_use_failure');
  });

  // End-to-end through the real bash tool. The permission decline happens before
  // tool.execute, so no shell is ever spawned.
  it('reports a real auto-mode bash decline as a failure without spawning a shell', async () => {
    const registry = new ToolRegistry({ autoMode: true }, [bashTool]);
    const context = baseContext(registry);

    await runDesktopToolLoop({
      ...context,
      maxIterations: 2,
      adapter: singleToolCallAdapter('bash', { command: 'rm -rf ./build' }),
    });

    const emitted = context.emitRuntimeEvent.mock.calls.map(
      ([event]) => (event as { type: string }).type,
    );
    expect(emitted).toContain('post_tool_use_failure');
    expect(emitted).not.toContain('post_tool_use');

    const failure = context.emitRuntimeEvent.mock.calls
      .map(([event]) => event as { type: string; error?: string })
      .find(event => event.type === 'post_tool_use_failure');
    expect(failure?.error?.startsWith('（已取消: ')).toBe(true);
  });

  // Pins that deny and prompt stay distinct: a BLOCK-class command is denied by
  // policy and already classified as a failure today.
  it('denies block-class bash by policy rather than by prompt', async () => {
    const registry = new ToolRegistry({ autoMode: true }, [bashTool]);
    const context = baseContext(registry);

    await runDesktopToolLoop({
      ...context,
      maxIterations: 2,
      adapter: singleToolCallAdapter('bash', { command: 'rm -rf /' }),
    });

    const failure = context.emitRuntimeEvent.mock.calls
      .map(([event]) => event as { type: string; error?: string })
      .find(event => event.type === 'post_tool_use_failure');
    expect(failure?.error).toContain('权限不足');
  });
});
