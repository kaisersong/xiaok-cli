import { describe, expect, it } from 'vitest';
import { GoalEvidenceCollector } from '../../../src/runtime/goal/index.js';

describe('GoalEvidenceCollector', () => {
  it('requires a matching successful tool_finished event and exitCode zero', () => {
    const collector = new GoalEvidenceCollector({
      goalId: 'goal_1',
      epoch: 1,
      goalTurnId: 'turn_1',
      now: () => 100,
    });

    collector.accept({
      type: 'tool_execution_fact',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      invocationId: 'call_1',
      toolName: 'bash',
      factKind: 'command_result',
      exitCode: 0,
    });
    expect(collector.flush()).toEqual([]);

    collector.accept({
      type: 'tool_finished',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      invocationId: 'call_1',
      toolName: 'bash',
      ok: true,
    });
    const evidence = collector.flush();
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.record.kind).toBe('command_action');
    expect(evidence[0]?.record.metadata?.commands).toEqual([
      { command: 'bash', summary: 'completed', exitCode: 0 },
    ]);
  });

  it('rejects denied, aborted, failed and non-zero command results', () => {
    const collector = new GoalEvidenceCollector({
      goalId: 'goal_1',
      epoch: 1,
      goalTurnId: 'turn_1',
      now: () => 100,
    });
    for (const [invocationId, exitCode, ok] of [
      ['deny', null, false],
      ['abort', null, false],
      ['failed', 1, false],
      ['bad-ok', 1, true],
    ] as const) {
      collector.accept({
        type: 'tool_execution_fact', sessionId: 'sess_1', turnId: 'turn_1',
        invocationId, toolName: 'bash', factKind: 'command_result', exitCode,
      });
      collector.accept({
        type: 'tool_finished', sessionId: 'sess_1', turnId: 'turn_1',
        invocationId, toolName: 'bash', ok,
      });
    }
    expect(collector.flush()).toEqual([]);
  });

  it('records successful normalized write paths and discards unpaired facts at turn end', () => {
    const collector = new GoalEvidenceCollector({
      goalId: 'goal_1', epoch: 1, goalTurnId: 'turn_1', now: () => 100,
    });
    collector.accept({
      type: 'tool_execution_fact', sessionId: 'sess_1', turnId: 'turn_1',
      invocationId: 'write_1', toolName: 'write', factKind: 'file_mutation',
      normalizedFilePaths: ['/tmp/a.txt'],
    });
    collector.accept({
      type: 'tool_finished', sessionId: 'sess_1', turnId: 'turn_1',
      invocationId: 'write_1', toolName: 'write', ok: true,
    });
    collector.accept({
      type: 'tool_execution_fact', sessionId: 'sess_1', turnId: 'turn_1',
      invocationId: 'orphan', toolName: 'write', factKind: 'file_mutation',
      normalizedFilePaths: ['/tmp/orphan.txt'],
    });
    collector.settleTurn();
    const evidence = collector.flush();
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.record.uri).toBe('/tmp/a.txt');
  });
});
