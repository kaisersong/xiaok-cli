import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoopStore } from '../../electron/loop-store.js';
import { CompletionEvidenceStore } from '../../electron/completion-evidence-store.js';
import {
  createUserLoopTemplateRunner,
  type UserLoopTaskPort,
} from '../../electron/user-loop-template-runner.js';
import type {
  TaskCreateInput,
  TaskSnapshot,
} from '../../../src/runtime/task-host/types.js';

describe('user loop template runner', () => {
  let rootDir: string;
  let store: LoopStore;
  let evidenceStore: CompletionEvidenceStore;
  let now: number;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-user-loop-template-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new LoopStore(join(rootDir, 'loops.sqlite'));
    evidenceStore = new CompletionEvidenceStore(join(rootDir, 'completion-evidence.sqlite'));
    now = 2_000;
  });

  afterEach(() => {
    try {
      evidenceStore.close();
    } catch { /* already closed */ }
    try {
      store.close();
    } catch { /* already closed */ }
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('blocks a completed markdown loop task when the expected output file is missing', async () => {
    const { definition } = store.createUserLoopTemplate({
      title: 'Weekly note',
      description: 'Write a weekly note',
      kind: 'markdown_file',
      prompt: 'Summarize this week.',
      outputDirectory: rootDir,
      outputFileName: 'weekly-note.md',
      now: 1_000,
    });
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const createdInputs: TaskCreateInput[] = [];
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        createdInputs,
        terminalSnapshot: completedSnapshot('task_missing_file'),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('blocked');
    expect(result.nextActionKind).toBe('missing_file_artifact');
    expect(store.getLoopRun(run.id)).toMatchObject({
      status: 'blocked',
      nextActionKind: 'missing_file_artifact',
      nextActionSummary: expect.stringContaining('weekly-note.md'),
    });
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'blocked',
        summary: expect.stringContaining('weekly-note.md'),
      }),
    ]);
    expect(store.listLoopStages(run.id).map(stage => stage.stageKind)).toEqual(['execute', 'verify']);
    expect(createdInputs[0]).toMatchObject({
      permissionMode: 'default',
    });
    expect(createdInputs[0].prompt).toContain('XIAOK_LOOP_MARKDOWN_START');
    expect(createdInputs[0].prompt).toContain('XIAOK_LOOP_MARKDOWN_END');
    expect(createdInputs[0].prompt).toContain('Xiaok will write that block to output_path');
  });

  it('creates the output directory before starting a markdown loop task', async () => {
    const outputDirectory = join(rootDir, 'missing', 'loops');
    const { definition } = store.createUserLoopTemplate({
      title: 'Directory note',
      description: 'Write into a directory that does not exist yet',
      kind: 'markdown_file',
      prompt: 'Summarize this week.',
      outputDirectory,
      outputFileName: 'directory-note.md',
      now: 1_000,
    });
    expect(existsSync(outputDirectory)).toBe(false);
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        terminalSnapshot: completedSnapshot('task_missing_directory_output'),
        onCreateTask: () => {
          expect(existsSync(outputDirectory)).toBe(true);
        },
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('blocked');
    expect(existsSync(outputDirectory)).toBe(true);
  });

  it('completes a markdown loop only after file artifact evidence exists', async () => {
    const { definition } = store.createUserLoopTemplate({
      title: 'Weekly note',
      description: 'Write a weekly note',
      kind: 'markdown_file',
      prompt: 'Summarize this week.',
      outputDirectory: rootDir,
      outputFileName: 'weekly-note.md',
      now: 1_000,
    });
    writeFileSync(join(rootDir, 'weekly-note.md'), '# Weekly\n');
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        terminalSnapshot: completedSnapshot('task_file_ok'),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('success');
    expect(store.getLoopRun(run.id)).toMatchObject({
      status: 'success',
      summary: expect.stringContaining('weekly-note.md'),
      evidenceIds: [expect.any(String)],
    });
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'file_artifact',
        summary: expect.stringContaining('weekly-note.md'),
        metadata: expect.objectContaining({
          taskId: 'task_file_ok',
          workspaceRoot: rootDir,
          localPaths: ['weekly-note.md'],
        }),
      }),
    ]);
    expect(store.listLoopStages(run.id)).toEqual([
      expect.objectContaining({
        stageKind: 'execute',
        status: 'success',
        metadata: expect.objectContaining({ taskId: 'task_file_ok' }),
      }),
      expect.objectContaining({
        stageKind: 'verify',
        status: 'success',
        evidenceIds: [expect.any(String)],
      }),
    ]);
  });

  it('recovers a textual Write tool call for the configured output path before verification', async () => {
    const outputPath = join(rootDir, 'sentinel.md');
    const { definition } = store.createUserLoopTemplate({
      title: 'Sentinel report',
      description: 'Write a release sentinel report',
      kind: 'markdown_file',
      prompt: 'Write the sentinel report.',
      outputDirectory: rootDir,
      outputFileName: 'sentinel.md',
      now: 1_000,
    });
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        terminalSnapshot: failedSnapshotWithSummary('task_textual_write', [
          'The report is ready.',
          `<tool_call>Write<arg_key>file_path</arg_key><arg_value>${outputPath}</arg_value><arg_key>content</arg_key><arg_value># Sentinel`,
          '',
          'Recovered body.',
          '</arg_value></tool_call>',
        ].join('\n')),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('success');
    expect(store.getLoopRun(run.id)).toMatchObject({
      status: 'success',
      summary: expect.stringContaining('sentinel.md'),
      evidenceIds: [expect.any(String)],
    });
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'file_artifact',
        metadata: expect.objectContaining({
          taskId: 'task_textual_write',
          paths: [outputPath],
          recoveredFrom: 'textual_write_tool_call',
        }),
      }),
    ]);
    expect(store.listLoopStages(run.id)).toEqual([
      expect.objectContaining({
        stageKind: 'execute',
        status: 'success',
        metadata: expect.objectContaining({
          taskId: 'task_textual_write',
          taskStatus: 'failed',
          recoveredOutputPath: outputPath,
          recoveryKind: 'textual_write_tool_call',
        }),
      }),
      expect.objectContaining({
        stageKind: 'verify',
        status: 'success',
        evidenceIds: [expect.any(String)],
      }),
    ]);
  });

  it('materializes a bounded final markdown block for the configured output path before verification', async () => {
    const outputPath = join(rootDir, 'sentinel.md');
    const { definition } = store.createUserLoopTemplate({
      title: 'Sentinel report',
      description: 'Write a release sentinel report',
      kind: 'markdown_file',
      prompt: 'Write the sentinel report.',
      outputDirectory: rootDir,
      outputFileName: 'sentinel.md',
      now: 1_000,
    });
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        terminalSnapshot: failedSnapshotWithSummary('task_markdown_block', [
          'The report is ready for Xiaok to persist.',
          'XIAOK_LOOP_MARKDOWN_START',
          '# Sentinel',
          '',
          '- tests: pass',
          '- review: pass',
          'XIAOK_LOOP_MARKDOWN_END',
        ].join('\n')),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('success');
    expect(readFileSync(outputPath, 'utf8')).toBe('# Sentinel\n\n- tests: pass\n- review: pass');
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'file_artifact',
        metadata: expect.objectContaining({
          taskId: 'task_markdown_block',
          paths: [outputPath],
          recoveredFrom: 'bounded_markdown_block',
        }),
      }),
    ]);
    expect(store.listLoopStages(run.id)).toEqual([
      expect.objectContaining({
        stageKind: 'execute',
        status: 'success',
        metadata: expect.objectContaining({
          taskId: 'task_markdown_block',
          taskStatus: 'failed',
          recoveredOutputPath: outputPath,
          recoveryKind: 'bounded_markdown_block',
        }),
      }),
      expect.objectContaining({
        stageKind: 'verify',
        status: 'success',
        evidenceIds: [expect.any(String)],
      }),
    ]);
  });

  it('materializes a bounded markdown block when the closing marker is clipped at the summary tail', async () => {
    const outputPath = join(rootDir, 'sentinel.md');
    const { definition } = store.createUserLoopTemplate({
      title: 'Clipped sentinel report',
      description: 'Write a release sentinel report',
      kind: 'markdown_file',
      prompt: 'Write the sentinel report.',
      outputDirectory: rootDir,
      outputFileName: 'sentinel.md',
      now: 1_000,
    });
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        terminalSnapshot: failedSnapshotWithSummary('task_clipped_markdown_block', [
          'The report is ready for Xiaok to persist.',
          'XIAOK_LOOP_MARKDOWN_START',
          '# Sentinel',
          '',
          'Recovered despite a clipped closing marker.',
          'XIAOK_LOOP_MARK',
        ].join('\n')),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('success');
    expect(readFileSync(outputPath, 'utf8')).toBe('# Sentinel\n\nRecovered despite a clipped closing marker.');
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'file_artifact',
        metadata: expect.objectContaining({
          taskId: 'task_clipped_markdown_block',
          recoveredFrom: 'bounded_markdown_block',
        }),
      }),
    ]);
  });

  it('does not recover textual Write content targeting a different path', async () => {
    const outputPath = join(rootDir, 'expected.md');
    const wrongPath = join(rootDir, 'wrong.md');
    const { definition } = store.createUserLoopTemplate({
      title: 'Wrong path report',
      description: 'Write a release sentinel report',
      kind: 'markdown_file',
      prompt: 'Write the sentinel report.',
      outputDirectory: rootDir,
      outputFileName: 'expected.md',
      now: 1_000,
    });
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        terminalSnapshot: failedSnapshotWithSummary('task_wrong_textual_write', [
          `<tool_call>Write<arg_key>path</arg_key><arg_value>${wrongPath}</arg_value><arg_key>content</arg_key><arg_value># Wrong</arg_value></tool_call>`,
        ].join('\n')),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('failed');
    expect(existsSync(outputPath)).toBe(false);
    expect(store.getLoopRun(run.id)).toMatchObject({
      status: 'failed',
      failureKind: 'executor_failed',
      message: 'User loop task ended with status failed.',
    });
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([]);
  });

  it('does not recover a partial textual Bash call as markdown output', async () => {
    const outputPath = join(rootDir, 'expected.md');
    const { definition } = store.createUserLoopTemplate({
      title: 'Partial bash report',
      description: 'Write a release sentinel report',
      kind: 'markdown_file',
      prompt: 'Write the sentinel report.',
      outputDirectory: rootDir,
      outputFileName: 'expected.md',
      now: 1_000,
    });
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        terminalSnapshot: failedSnapshotWithSummary('task_partial_textual_bash', [
          'I collected evidence and will write the report.',
          '<tool_call>Bash<arg_key>command</arg_key><arg_value>mkdir -p /tmp/loops',
        ].join('\n')),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('failed');
    expect(existsSync(outputPath)).toBe(false);
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([]);
  });

  it('materializes a runner-owned failure diagnostic when the artifact guard blocks after substantive work', async () => {
    const outputPath = join(rootDir, 'diagnostic.md');
    const { definition } = store.createUserLoopTemplate({
      title: 'Diagnostic report',
      description: 'Write a release sentinel report',
      kind: 'markdown_file',
      prompt: 'Write the sentinel report.',
      outputDirectory: rootDir,
      outputFileName: 'diagnostic.md',
      now: 1_000,
    });
    const summary = [
      'Context gathered. Both health endpoints are healthy. Documentation was checked.',
      'Product behavior was reviewed: LoopsSettings is mounted, GeneralSettings is clean, and locale keys exist.',
      'Tests passed: desktop-settings-service-status 11/11 and typecheck clean.',
      'Adversarial review identified README user-loop documentation gaps and orphaned DeveloperSettings diagnostics.',
      'Risk classification was prepared with P1/P2/P3 findings and concrete verification steps.',
      'The task then attempted to report progress for the final Markdown handoff instead of producing the handoff body.',
      '<tool_call>report_progress<arg_key>steps</arg_key><arg_value>[{"id":"s7","label":"write output_path markdown report","status":"running"}]</arg_value></tool_call>',
      'Additional execution evidence: '.repeat(20),
    ].join('\n');
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        terminalSnapshot: failedSnapshotWithSummary('task_guard_diagnostic', summary),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('success');
    const file = readFileSync(outputPath, 'utf8');
    expect(file).toContain('# Xiaok User Loop Failure Diagnostic');
    expect(file).toContain('task_guard_diagnostic');
    expect(file).toContain('Task is being completed without artifact evidence.');
    expect(file).toContain('README user-loop documentation gaps');
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'file_artifact',
        metadata: expect.objectContaining({
          taskId: 'task_guard_diagnostic',
          recoveredFrom: 'task_summary_failure_diagnostic',
        }),
      }),
    ]);
  });

  it('blocks an empty markdown artifact instead of treating it as completion evidence', async () => {
    const { definition } = store.createUserLoopTemplate({
      title: 'Empty note',
      description: '',
      kind: 'markdown_file',
      prompt: 'Write a note.',
      outputDirectory: rootDir,
      outputFileName: 'empty-note.md',
      now: 1_000,
    });
    writeFileSync(join(rootDir, 'empty-note.md'), '');
    const run = expectStarted(store.beginLoopRun(definition.id, { kind: 'manual' }, now, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        terminalSnapshot: completedSnapshot('task_empty_file'),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    const result = await runner.runTemplateLoop({
      loopId: definition.id,
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result.status).toBe('blocked');
    expect(store.getLoopRun(run.id)).toMatchObject({
      status: 'blocked',
      nextActionKind: 'missing_file_artifact',
    });
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'blocked',
        metadata: expect.objectContaining({
          findings: ['artifact_file_empty'],
        }),
      }),
    ]);
  });

  it('uses plan permission mode for scheduled template runs until auto-run is approved', async () => {
    const { definition } = store.createUserLoopTemplate({
      title: 'Daily note',
      description: '',
      kind: 'markdown_file',
      prompt: 'Summarize today.',
      outputDirectory: rootDir,
      outputFileName: 'daily-note.md',
      now: 1_000,
    });
    writeFileSync(join(rootDir, 'daily-note.md'), '# Daily\n');
    const firstRun = expectStarted(store.beginLoopRun(definition.id, { kind: 'scheduled' }, now, 60_000));
    const createdInputs: TaskCreateInput[] = [];
    const runner = createUserLoopTemplateRunner({
      loopStore: store,
      evidenceStore,
      taskPort: fakeTaskPort({
        createdInputs,
        terminalSnapshot: completedSnapshot('task_plan_mode'),
      }),
      now: () => now,
      pollIntervalMs: 1,
      maxRunMs: 100,
    });

    await runner.runTemplateLoop({
      loopId: definition.id,
      runId: firstRun.id,
      trigger: { kind: 'scheduled' },
    });

    expect(createdInputs[0].permissionMode).toBe('plan');

    expect(store.setUserLoopAutoRunApproved(definition.id, true, 2_500)?.autoRunApproved).toBe(true);
    now = 3_000;
    const secondRun = expectStarted(store.beginLoopRun(definition.id, { kind: 'scheduled' }, now, 60_000));
    await runner.runTemplateLoop({
      loopId: definition.id,
      runId: secondRun.id,
      trigger: { kind: 'scheduled' },
    });

    expect(createdInputs[1].permissionMode).toBe('default');
  });
});

function fakeTaskPort(input: {
  createdInputs?: TaskCreateInput[];
  terminalSnapshot: TaskSnapshot;
  onCreateTask?: (taskInput: TaskCreateInput) => void;
}): UserLoopTaskPort {
  return {
    async createTask(taskInput) {
      input.onCreateTask?.(taskInput);
      input.createdInputs?.push(taskInput);
      return { taskId: input.terminalSnapshot.taskId };
    },
    async recoverTask() {
      return { snapshot: input.terminalSnapshot };
    },
  };
}

function completedSnapshot(taskId: string): TaskSnapshot {
  return {
    taskId,
    sessionId: 'session-test',
    status: 'completed',
    prompt: 'prompt',
    materials: [],
    events: [],
    result: {
      summary: 'done',
      artifacts: [],
    },
    createdAt: 1_000,
    updatedAt: 2_000,
  };
}

function failedSnapshotWithSummary(taskId: string, summary: string): TaskSnapshot {
  return {
    ...completedSnapshot(taskId),
    status: 'failed',
    result: {
      summary,
      artifacts: [],
    },
    salvage: {
      summary: ['Completion evidence guard blocked task completion.'],
      reason: 'Task is being completed without artifact evidence.',
    },
  };
}

function expectStarted(result: ReturnType<LoopStore['beginLoopRun']>) {
  expect(result.status).toBe('started');
  if (result.status !== 'started') throw new Error('expected loop run to start');
  return result.run;
}
