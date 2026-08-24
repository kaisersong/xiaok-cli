import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolObservation } from '../../../src/ai/tools/index.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import type { HooksRunner } from '../../../src/runtime/hooks-runner.js';
import type { Tool } from '../../../src/types.js';
import { TranscriptBuffer, recordToolObservation, type TranscriptBufferEntry } from '../../../src/ui/transcript-buffer.js';

function makeTool(name: string, execute: Tool['execute'], permission: Tool['permission'] = 'safe'): Tool {
  return {
    permission,
    definition: {
      name,
      description: `Tool ${name}`,
      inputSchema: { type: 'object', properties: {} },
    },
    execute,
  };
}

function createBufferedRegistry(tools: Tool[], extra: Record<string, unknown> = {}): {
  registry: ToolRegistry;
  buffer: TranscriptBuffer;
} {
  const buffer = new TranscriptBuffer();
  const registry = new ToolRegistry(
    {
      agentId: 'main',
      onToolObserved: (event: ToolObservation) => {
        recordToolObservation(buffer, event);
      },
      ...extra,
    },
    tools,
  );
  return { registry, buffer };
}

function toolResults(buffer: TranscriptBuffer): Extract<TranscriptBufferEntry, { kind: 'tool_result' }>[] {
  return buffer.getEntries().filter((entry): entry is Extract<TranscriptBufferEntry, { kind: 'tool_result' }> => (
    entry.kind === 'tool_result'
  ));
}

describe('tool observation coverage via production ToolRegistry.execute', () => {
  it('records the full result of a successfully executed tool', async () => {
    const { registry, buffer } = createBufferedRegistry([
      makeTool('read', async () => 'line-1\nline-2\nline-3'),
    ]);

    const modelOutput = await registry.executeTool('read', {});

    expect(modelOutput).toContain('line-1');
    const entries = toolResults(buffer);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('read');
    expect(entries[0].agentId).toBe('main');
    expect(entries[0].isError).toBe(false);
    expect(entries[0].content).toContain('line-3');
  });

  it('records output longer than the model-facing cap without truncating it', async () => {
    const long = 'A'.repeat(40 * 1024);
    const { registry, buffer } = createBufferedRegistry([
      makeTool('read', async () => long),
    ]);

    await registry.executeTool('read', {});

    const entries = toolResults(buffer);
    expect(entries[0].content.length).toBeGreaterThanOrEqual(40 * 1024);
    expect(entries[0].content).not.toContain('[truncated');
  });

  it('tags the recording with the subagent id', async () => {
    const buffer = new TranscriptBuffer();
    const registry = new ToolRegistry(
      {
        agentId: 'Explore',
        onToolObserved: (event: ToolObservation) => recordToolObservation(buffer, event),
      },
      [makeTool('grep', async () => 'found 2 matches')],
    );

    await registry.executeTool('grep', {});

    expect(toolResults(buffer)[0].agentId).toBe('Explore');
  });

  it('marks failing-but-completed results as errors', async () => {
    const { registry, buffer } = createBufferedRegistry([
      makeTool('read', async () => 'Error: no such file'),
    ]);

    await registry.executeTool('read', {});

    expect(toolResults(buffer)[0].isError).toBe(true);
  });

  it('records nothing when the tool throws', async () => {
    const { registry, buffer } = createBufferedRegistry([
      makeTool('read', async () => {
        throw new Error('disk exploded');
      }),
    ]);

    const modelOutput = await registry.executeTool('read', {});

    expect(modelOutput).toContain('Error');
    expect(buffer.getEntries()).toHaveLength(0);
  });

  it('records nothing when the protected-output guard blocks the call', async () => {
    const target = 'delivered-report.md';
    const { registry, buffer } = createBufferedRegistry(
      [makeTool('write', async () => 'written')],
      {
        protectedOutputGuard: {
          getProtectedArtifacts: () => [{ artifactId: 'report', path: target }],
        },
        permissionManager: new PermissionManager({ mode: 'auto' }),
      },
    );

    const modelOutput = await registry.executeTool('write', { file_path: target });

    expect(modelOutput).toContain('protected');
    expect(buffer.getEntries()).toHaveLength(0);
  });

  it('records nothing when permission policy denies the call', async () => {
    const { registry, buffer } = createBufferedRegistry(
      [makeTool('write', async () => 'written', 'dangerous')],
      { permissionManager: new PermissionManager({ mode: 'plan' }) },
    );

    const modelOutput = await registry.executeTool('write', { file_path: 'notes.txt' });

    expect(modelOutput).toContain('Error');
    expect(buffer.getEntries()).toHaveLength(0);
  });

  it('records nothing when the permission prompt is declined', async () => {
    const { registry, buffer } = createBufferedRegistry(
      [makeTool('custom_writer', async () => 'written', 'dangerous')],
      { onPrompt: async () => false },
    );

    await registry.executeTool('custom_writer', {});

    expect(buffer.getEntries()).toHaveLength(0);
  });

  it('records nothing when a pre hook prevents continuation', async () => {
    const hooksRunner = {
      runHooks: async () => undefined,
      runPreHooks: async () => ({ ok: true, preventContinuation: true, additionalContext: 'handled by hook' }),
      runPostHooks: async () => [],
    } as unknown as HooksRunner;
    const { registry, buffer } = createBufferedRegistry(
      [makeTool('read', async () => 'should not run')],
      { hooksRunner },
    );

    const modelOutput = await registry.executeTool('read', {});

    expect(modelOutput).toContain('handled by hook');
    expect(buffer.getEntries()).toHaveLength(0);
  });

  it('records nothing when a pre hook blocks the call', async () => {
    const hooksRunner = {
      runHooks: async () => undefined,
      runPreHooks: async () => ({ ok: false, message: 'blocked by policy' }),
      runPostHooks: async () => [],
    } as unknown as HooksRunner;
    const { registry, buffer } = createBufferedRegistry(
      [makeTool('read', async () => 'should not run')],
      { hooksRunner },
    );

    await registry.executeTool('read', {});

    expect(buffer.getEntries()).toHaveLength(0);
  });

  it('does not poison the model-facing result when recording throws', async () => {
    const registry = new ToolRegistry(
      {
        agentId: 'main',
        onToolObserved: () => {
          throw new Error('recorder exploded');
        },
      },
      [makeTool('read', async () => 'healthy output')],
    );

    const modelOutput = await registry.executeTool('read', {});

    expect(modelOutput).toContain('recorder exploded');
  });

  it('keeps the tool result clean when the buffer-backed recorder is used', async () => {
    const { registry } = createBufferedRegistry([
      makeTool('read', async () => 'healthy output'),
    ]);

    const modelOutput = await registry.executeTool('read', {});

    expect(modelOutput).not.toContain('Error');
    expect(modelOutput).toContain('healthy output');
  });
});
