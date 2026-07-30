import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import type { Tool } from '../../../src/types.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';

// Verification of the merged canvas workflow-artifact feature against master's
// kept core `resolveKSwarmWorkflowStatusArtifacts` (reads scriptResult.workspacePath).
// Canvas's tool change (now on master) emits the workspace at TOP-LEVEL
// projectWorkspacePath. This exercises the live tool-loop caller (desktop-services.ts
// :5305) which shares the same core the recovery layer calls, to see whether artifacts
// resolve for each output shape.

describe('KSwarm workflow-artifact resolution — post-merge verification', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(tmpdir(), `xiaok-wf-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(workspaceRoot, 'artifacts'), { recursive: true });
    writeFileSync(join(workspaceRoot, 'artifacts', 'report.html'), '<!doctype html><title>R</title>');
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function statusTool(resultJson: string): Tool {
    return {
      permission: 'safe',
      definition: {
        name: 'get_dynamic_workflow_status',
        description: 'returns workflow status',
        inputSchema: { type: 'object', properties: {} },
      },
      async execute() { return resultJson; },
    };
  }

  function baseContext(registry: ToolRegistry, dataRoot: string) {
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
      dataRoot,
      taskStartTime: Date.now(),
      strategies: {
        compact: { enabled: false, shouldCompact: () => false, doCompact: async (_m: unknown, _o?: StreamOptions) => {} },
        buildApiView: (messages: Parameters<typeof runDesktopToolLoop>[0]['messages']) => messages,
        processToolResult: (result: string) => result,
        trackAutoProgress: false,
        trackReferenceReads: false,
        emitSkillArtifactTrace: false,
      },
    };
  }

  async function recordedArtifacts(resultJson: string): Promise<string[]> {
    const registry = new ToolRegistry({ autoMode: true }, [statusTool(resultJson)]);
    const context = baseContext(registry, workspaceRoot);
    let streamCall = 0;
    await runDesktopToolLoop({
      ...context,
      maxIterations: 2,
      adapter: {
        async *stream() {
          streamCall += 1;
          if (streamCall === 1) {
            yield { type: 'tool_use' as const, id: 'call-1', name: 'get_dynamic_workflow_status', input: {} };
            return;
          }
          yield { type: 'text' as const, delta: 'final' };
          yield { type: 'done' as const };
        },
      },
    });
    return context.emitRuntimeEvent.mock.calls
      .map(([event]) => event as { type: string; label?: string })
      .filter(event => event.type === 'artifact_recorded')
      .map(event => event.label ?? '');
  }

  it('resolves artifacts when the workspace is in scriptResult.workspacePath (master core shape)', async () => {
    const result = JSON.stringify({
      ok: true,
      workflowRunId: 'wf-1',
      scriptResult: {
        workspacePath: workspaceRoot,
        producerAgent: 'xiaok-worker',
        artifacts: [{ path: 'artifacts/report.html', kind: 'html', label: 'report.html' }],
      },
    });
    expect(await recordedArtifacts(result)).toEqual(['report.html']);
  });

  it('resolves artifacts when the workspace is only at top-level projectWorkspacePath (canvas tool shape)', async () => {
    const result = JSON.stringify({
      ok: true,
      workflowRunId: 'wf-1',
      projectWorkspacePath: workspaceRoot,
      scriptResult: {
        producerAgent: 'xiaok-worker',
        artifacts: [{ path: 'artifacts/report.html', kind: 'html', label: 'report.html' }],
      },
    });
    expect(await recordedArtifacts(result)).toEqual(['report.html']);
  });
});
