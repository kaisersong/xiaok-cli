import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolExecutionFact } from '../../../src/types.js';
import { bashTool } from '../../../src/ai/tools/bash.js';
import { createWriteTool } from '../../../src/ai/tools/write.js';
import { GoalEvidenceCollector } from '../../../src/runtime/goal/index.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function collector() {
  return new GoalEvidenceCollector({ goalId: 'g1', epoch: 1, goalTurnId: 't1' });
}

function acceptFact(target: GoalEvidenceCollector, fact: ToolExecutionFact): void {
  target.accept({ type: 'tool_execution_fact', sessionId: 's1', turnId: 't1', ...fact });
  target.accept({
    type: 'tool_finished', sessionId: 's1', turnId: 't1',
    invocationId: fact.invocationId, toolName: fact.toolName, ok: true,
  });
}

describe('Goal evidence-producing tools', () => {
  it('uses the real bash exit code rather than parsing result text', async () => {
    const facts: ToolExecutionFact[] = [];
    const result = await bashTool.execute({ command: 'exit 0' }, {
      toolInvocationId: 'bash_1', runtimeFactSink: { emit: fact => facts.push(fact) },
    });
    expect(result).not.toMatch(/^Error/u);
    expect(facts).toEqual([expect.objectContaining({
      invocationId: 'bash_1', factKind: 'command_result', exitCode: 0,
    })]);
    const target = collector();
    acceptFact(target, facts[0]!);
    expect(target.flush()[0]?.record.kind).toBe('command_action');
  });

  it('emits a normalized path only after a real write succeeds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-write-'));
    roots.push(root);
    const filePath = join(root, 'out.txt');
    const facts: ToolExecutionFact[] = [];
    await createWriteTool({ cwd: root }).execute({ file_path: filePath, content: 'ok' }, {
      toolInvocationId: 'write_1', runtimeFactSink: { emit: fact => facts.push(fact) },
    });
    expect(facts).toEqual([expect.objectContaining({
      invocationId: 'write_1', factKind: 'file_mutation', normalizedFilePaths: [filePath],
    })]);
    const target = collector();
    acceptFact(target, facts[0]!);
    expect(target.flush()[0]?.record.uri).toBe(filePath);
  });
});
