import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateArtifactEvidenceGuard } from '../../../src/runtime/guards/artifact-evidence-guard.js';
import {
  mergeCompletionExpectations,
  validateCompletionEvidence,
  type CompletionEvidenceRecord,
  type CompletionExpectation,
} from '../../../src/runtime/guards/completion-evidence.js';

function taskExpectation(input: {
  ownerId?: string;
  expectedKinds: CompletionExpectation['expectedKinds'];
  source?: CompletionExpectation['source'];
  confidence?: CompletionExpectation['confidence'];
}): CompletionExpectation {
  return {
    ownerKind: 'task',
    ownerId: input.ownerId ?? 'item-1',
    expectedKinds: input.expectedKinds,
    source: input.source ?? 'task_spec',
    confidence: input.confidence ?? 'explicit',
  };
}

function taskEvidence(input: Pick<CompletionEvidenceRecord, 'kind'> & Partial<CompletionEvidenceRecord>): CompletionEvidenceRecord {
  return {
    ownerKind: 'task',
    ownerId: 'item-1',
    summary: 'Evidence summary',
    ...input,
  };
}

function validateCompletedEvidence(input: {
  expectedKinds: CompletionExpectation['expectedKinds'];
  evidence: CompletionEvidenceRecord[];
}) {
  return validateCompletionEvidence({
    ownerKind: 'task',
    ownerId: 'item-1',
    targetStatus: 'completed',
    expectation: taskExpectation({ expectedKinds: input.expectedKinds }),
    evidence: input.evidence,
  });
}

describe('ArtifactEvidenceGuard', () => {
  it('passes completed task submission when no expectation or evidence is provided', () => {
    const decision = evaluateArtifactEvidenceGuard({
      taskId: 'item-2',
      status: 'done',
      artifacts: [],
    });

    expect(decision).toMatchObject({
      ok: true,
      mode: 'pass',
    });
    expect(decision.events).toEqual([
      expect.objectContaining({
        source: 'guard',
        type: 'guard.passed',
        refs: { taskId: 'item-2' },
      }),
    ]);
  });

  it('passes non-terminal or artifact-backed tasks', () => {
    expect(evaluateArtifactEvidenceGuard({ taskId: 'item-1', status: 'in_progress', artifacts: [] }).ok).toBe(true);
    expect(evaluateArtifactEvidenceGuard({ taskId: 'item-2', status: 'done', artifacts: ['artifact-1'] }).ok).toBe(true);
  });

  it('passes answer completions when valid answer evidence exists', () => {
    const decision = evaluateArtifactEvidenceGuard({
      taskId: 'item-1',
      status: 'completed',
      artifacts: [],
      expectation: taskExpectation({ expectedKinds: ['answer'] }),
      evidence: [{
        ownerKind: 'task',
        ownerId: 'item-1',
        kind: 'answer',
        summary: '问题已直接回答。',
        metadata: { responseId: 'resp-1' },
      }],
    });

    expect(decision.ok).toBe(true);
  });

  it('blocks completion when expectation and evidence belong to a different task', () => {
    const decision = evaluateArtifactEvidenceGuard({
      taskId: 'item-1',
      status: 'completed',
      artifacts: [],
      expectation: taskExpectation({ ownerId: 'item-2', expectedKinds: ['answer'] }),
      evidence: [{
        ownerKind: 'task',
        ownerId: 'item-2',
        kind: 'answer',
        summary: '问题已直接回答。',
        metadata: { responseId: 'resp-1' },
      }],
    });

    expect(decision).toMatchObject({
      ok: false,
      mode: 'block',
    });
  });

  it('passes file artifact completions via answer fallback when valid answer evidence exists', () => {
    const decision = evaluateArtifactEvidenceGuard({
      taskId: 'item-1',
      status: 'completed',
      artifacts: [],
      expectation: taskExpectation({ expectedKinds: ['file_artifact'] }),
      evidence: [{
        ownerKind: 'task',
        ownerId: 'item-1',
        kind: 'answer',
        summary: '问题已直接回答。',
        metadata: { responseId: 'resp-1' },
      }],
    });

    expect(decision).toMatchObject({
      ok: true,
      mode: 'pass',
    });
  });

  it('fails answer evidence validation without response id or snapshot hash', () => {
    const result = validateCompletionEvidence({
      ownerKind: 'task',
      ownerId: 'item-1',
      targetStatus: 'completed',
      expectation: taskExpectation({ expectedKinds: ['answer'] }),
      evidence: [{
        ownerKind: 'task',
        ownerId: 'item-1',
        kind: 'answer',
        summary: '问题已直接回答。',
        metadata: { responseId: '', responseSnapshotHash: '' },
      }],
    });

    expect(result).toMatchObject({
      ok: false,
      failureKind: 'validation_failed',
    });
  });

  it('rejects legacy expectations for completed owners', () => {
    const result = validateCompletionEvidence({
      ownerKind: 'task',
      ownerId: 'item-1',
      targetStatus: 'completed',
      expectation: taskExpectation({
        expectedKinds: ['answer'],
        source: 'legacy_classifier',
        confidence: 'legacy',
      }),
      evidence: [{
        ownerKind: 'task',
        ownerId: 'item-1',
        kind: 'answer',
        summary: '问题已直接回答。',
        metadata: { responseId: 'resp-1' },
      }],
    });

    expect(result).toMatchObject({
      ok: false,
      failureKind: 'validation_failed',
    });
  });

  it('rejects blocked evidence for completed owners', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['blocked'],
      evidence: [taskEvidence({
        kind: 'blocked',
        summary: '等待用户补充信息。',
      })],
    });

    expect(result.ok).toBe(false);
  });

  it('runs completion validation for success status in the guard', () => {
    const decision = evaluateArtifactEvidenceGuard({
      taskId: 'item-1',
      status: 'success',
      artifacts: [],
      expectation: taskExpectation({
        expectedKinds: ['answer'],
        source: 'legacy_classifier',
        confidence: 'legacy',
      }),
      evidence: [{
        ownerKind: 'task',
        ownerId: 'item-1',
        kind: 'answer',
        summary: '问题已直接回答。',
        metadata: { responseId: 'resp-1' },
      }],
    });

    expect(decision).toMatchObject({
      ok: false,
      mode: 'block',
    });
  });

  it('passes blocked targets when blocked evidence exists without an expectation', () => {
    const result = validateCompletionEvidence({
      ownerKind: 'task',
      ownerId: 'item-1',
      targetStatus: 'blocked',
      evidence: [{
        ownerKind: 'task',
        ownerId: 'item-1',
        kind: 'blocked',
        summary: '等待用户补充信息。',
      }],
    });

    expect(result.ok).toBe(true);
  });

  it('ignores historical blocked evidence when valid answer evidence completes the owner', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['answer'],
      evidence: [
        taskEvidence({
          kind: 'blocked',
          summary: '',
        }),
        taskEvidence({
          kind: 'answer',
          summary: '问题已直接回答。',
          metadata: { responseId: 'resp-1' },
        }),
      ],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects completed owners when same-owner non-blocked evidence has a blank summary', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['answer'],
      evidence: [
        taskEvidence({
          kind: 'answer',
          summary: '问题已直接回答。',
          metadata: { responseId: 'resp-1' },
        }),
        taskEvidence({
          kind: 'file_artifact',
          summary: '  ',
          uri: 'file:///tmp/report.md',
        }),
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects file artifact evidence with a blank summary', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['file_artifact'],
      evidence: [taskEvidence({
        kind: 'file_artifact',
        summary: '  ',
        uri: 'file:///tmp/report.md',
      })],
    });

    expect(result).toMatchObject({
      ok: false,
      failureKind: 'validation_failed',
    });
  });

  it('rejects file artifact evidence with blank paths', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['file_artifact'],
      evidence: [taskEvidence({
        kind: 'file_artifact',
        metadata: { paths: [''] },
      })],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects file artifact evidence when any path is invalid', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['file_artifact'],
      evidence: [taskEvidence({
        kind: 'file_artifact',
        metadata: { paths: ['/tmp/report.md', ''] },
      })],
    });

    expect(result.ok).toBe(false);
  });

  it('passes valid file artifact evidence', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['file_artifact'],
      evidence: [taskEvidence({
        kind: 'file_artifact',
        metadata: { paths: ['/tmp/report.md'] },
      })],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects local file artifact evidence when declared local paths are missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-local-artifact-missing-'));
    try {
      const result = validateCompletedEvidence({
        expectedKinds: ['file_artifact'],
        evidence: [taskEvidence({
          kind: 'file_artifact',
          metadata: {
            workspaceRoot: root,
            localPaths: ['missing-report.md'],
          },
        })],
      });

      expect(result).toMatchObject({
        ok: false,
        failureKind: 'validation_failed',
        message: 'File artifact evidence local path is missing: missing-report.md',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes local file artifact evidence when declared local paths exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-local-artifact-present-'));
    try {
      writeFileSync(join(root, 'report.md'), '# Report\n');
      const result = validateCompletedEvidence({
        expectedKinds: ['file_artifact'],
        evidence: [taskEvidence({
          kind: 'file_artifact',
          metadata: {
            workspaceRoot: root,
            localPaths: ['report.md'],
          },
        })],
      });

      expect(result.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not let invalid localPaths override a valid artifact URI', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['file_artifact'],
      evidence: [taskEvidence({
        kind: 'file_artifact',
        uri: 'https://example.com/report.md',
        metadata: {
          localPaths: ['missing-report.md'],
        },
      })],
    });

    expect(result.ok).toBe(true);
  });

  it('passes local file artifact evidence for absolute paths inside the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-local-artifact-absolute-inside-'));
    try {
      const reportPath = join(root, 'report.md');
      writeFileSync(reportPath, '# Report\n');
      const result = validateCompletedEvidence({
        expectedKinds: ['file_artifact'],
        evidence: [taskEvidence({
          kind: 'file_artifact',
          metadata: {
            workspaceRoot: root,
            localPaths: [reportPath],
          },
        })],
      });

      expect(result.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects local file artifact evidence for absolute paths outside the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-local-artifact-absolute-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'xiaok-local-artifact-absolute-outside-'));
    try {
      const outsideReport = join(outside, 'report.md');
      writeFileSync(outsideReport, '# Outside Report\n');
      const result = validateCompletedEvidence({
        expectedKinds: ['file_artifact'],
        evidence: [taskEvidence({
          kind: 'file_artifact',
          metadata: {
            workspaceRoot: root,
            localPaths: [outsideReport],
          },
        })],
      });

      expect(result).toMatchObject({
        ok: false,
        failureKind: 'validation_failed',
        message: `File artifact evidence local path escapes workspace: ${outsideReport}`,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('rejects local file artifact evidence that escapes through a symlinked directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-local-artifact-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'xiaok-local-artifact-symlink-outside-'));
    try {
      writeFileSync(join(outside, 'report.md'), '# Outside Report\n');
      symlinkSync(outside, join(root, 'linked'), 'dir');
      const result = validateCompletedEvidence({
        expectedKinds: ['file_artifact'],
        evidence: [taskEvidence({
          kind: 'file_artifact',
          metadata: {
            workspaceRoot: root,
            localPaths: ['linked/report.md'],
          },
        })],
      });

      expect(result).toMatchObject({
        ok: false,
        failureKind: 'validation_failed',
        message: 'File artifact evidence local path escapes workspace: linked/report.md',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not force remote artifact URIs through local file existence checks', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['file_artifact'],
      evidence: [taskEvidence({
        kind: 'file_artifact',
        uri: 'https://example.com/report.md',
      })],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects command action evidence with malformed commands', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['command_action'],
      evidence: [taskEvidence({
        kind: 'command_action',
        metadata: { commands: [{}] },
      })],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects command action evidence when any command is invalid', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['command_action'],
      evidence: [taskEvidence({
        kind: 'command_action',
        metadata: {
          commands: [
            { command: 'npm test', exitCode: 0, summary: 'Tests passed.' },
            {},
          ],
        },
      })],
    });

    expect(result.ok).toBe(false);
  });

  it('passes valid command action evidence', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['command_action'],
      evidence: [taskEvidence({
        kind: 'command_action',
        metadata: {
          commands: [{ command: 'npm test', exitCode: 0, summary: 'Tests passed.' }],
        },
      })],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects project update evidence with blank changed tasks', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['project_update'],
      evidence: [taskEvidence({
        kind: 'project_update',
        metadata: { projectId: 'project-1', changedTasks: [''] },
      })],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects project update evidence when any changed task is invalid', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['project_update'],
      evidence: [taskEvidence({
        kind: 'project_update',
        metadata: { projectId: 'project-1', changedTasks: ['task-1', null] },
      })],
    });

    expect(result.ok).toBe(false);
  });

  it('passes valid project update evidence', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['project_update'],
      evidence: [taskEvidence({
        kind: 'project_update',
        metadata: { projectId: 'project-1', changedTasks: ['task-1'] },
      })],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects log diagnostic evidence with summary only', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['log_diagnostic'],
      evidence: [taskEvidence({
        kind: 'log_diagnostic',
        summary: 'No errors found.',
      })],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects log diagnostic evidence when any finding is invalid', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['log_diagnostic'],
      evidence: [taskEvidence({
        kind: 'log_diagnostic',
        metadata: { findings: ['ok', {}] },
      })],
    });

    expect(result.ok).toBe(false);
  });

  it('passes valid log diagnostic evidence with findings', () => {
    const result = validateCompletedEvidence({
      expectedKinds: ['log_diagnostic'],
      evidence: [taskEvidence({
        kind: 'log_diagnostic',
        metadata: { findings: ['No errors found.'] },
      })],
    });

    expect(result.ok).toBe(true);
  });

  it('merges expectations by priority and same-level intersection', () => {
    expect(mergeCompletionExpectations([
      taskExpectation({ expectedKinds: ['file_artifact'], confidence: 'inferred', source: 'tool_schema' }),
      taskExpectation({ expectedKinds: ['answer'], confidence: 'explicit', source: 'task_spec' }),
    ])).toMatchObject({
      confidence: 'explicit',
      expectedKinds: ['answer'],
    });

    expect(mergeCompletionExpectations([
      taskExpectation({ expectedKinds: ['answer', 'file_artifact'] }),
      taskExpectation({ expectedKinds: ['file_artifact', 'command_action'] }),
    ])).toMatchObject({
      expectedKinds: ['file_artifact'],
    });

    const conflict = mergeCompletionExpectations([
      taskExpectation({ expectedKinds: ['answer'] }),
      taskExpectation({ expectedKinds: ['file_artifact'] }),
    ]);
    expect(conflict).toBeDefined();
    expect(conflict?.expectedKinds).toEqual([]);
    if (!conflict) {
      throw new Error('expected conflicting expectations to preserve an empty expectedKinds contract');
    }

    const decision = evaluateArtifactEvidenceGuard({
      taskId: 'item-1',
      status: 'completed',
      artifacts: ['artifact-1'],
      expectation: conflict,
      evidence: [{
        ownerKind: 'task',
        ownerId: 'item-1',
        kind: 'answer',
        summary: '问题已直接回答。',
        metadata: { responseId: 'resp-1' },
      }],
    });

    expect(decision).toMatchObject({
      ok: true,
      mode: 'pass',
    });
  });
});
