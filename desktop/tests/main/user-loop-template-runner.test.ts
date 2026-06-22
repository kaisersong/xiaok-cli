import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompletionEvidenceStore } from '../../electron/completion-evidence-store.js';
import { LoopStore } from '../../electron/loop-store.js';
import { createUserLoopTemplateRunner, type UserLoopTaskPort } from '../../electron/user-loop-template-runner.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

describe('UserLoopTemplateRunner', () => {
  let rootDir: string;
  let outputDirectory: string;
  let outputPath: string;
  let loopStore: LoopStore;
  let evidenceStore: CompletionEvidenceStore;
  let now: number;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-user-loop-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    outputDirectory = join(rootDir, 'outputs');
    outputPath = join(outputDirectory, 'weekly.md');
    mkdirSync(outputDirectory, { recursive: true });
    loopStore = new LoopStore(join(rootDir, 'loops.sqlite'));
    evidenceStore = new CompletionEvidenceStore(join(rootDir, 'completion-evidence.sqlite'));
    now = 2_000;
    loopStore.createUserLoopTemplate({
      loopId: 'user-loop-1',
      title: 'Weekly Markdown',
      kind: 'markdown_file',
      prompt: 'Write the weekly note.',
      outputDirectory,
      outputFileName: 'weekly.md',
      now: 1_000,
    });
  });

  afterEach(() => {
    evidenceStore.close();
    loopStore.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('waits for a terminal task snapshot and records file_artifact evidence before success', async () => {
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_success' }),
      recoverTask: vi.fn(async () => {
        writeFileSync(outputPath, '# Weekly\n\nDone.\n');
        return { snapshot: taskSnapshot('task_success', 'completed') };
      }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('user-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    const result = await runner.runTemplateLoop({
      loopId: 'user-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result).toMatchObject({ status: 'success', run: expect.objectContaining({ id: run.id }) });
    expect(taskPort.createTask).toHaveBeenCalledWith(expect.objectContaining({
      materials: [],
      permissionMode: 'default',
      prompt: expect.stringContaining(outputPath),
    }));
    expect(taskPort.recoverTask).toHaveBeenCalledWith('task_success');
    expect(loopStore.getLoopRun(run.id)).toMatchObject({
      status: 'success',
      summary: expect.stringContaining('weekly.md'),
      evidenceIds: [expect.any(String)],
    });
    expect(loopStore.listLoopStages(run.id)).toEqual([
      expect.objectContaining({ stageKind: 'execute', status: 'success' }),
      expect.objectContaining({ stageKind: 'verify', status: 'success', evidenceIds: [expect.any(String)] }),
    ]);
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'file_artifact',
        summary: expect.stringContaining('weekly.md'),
        metadata: expect.objectContaining({
          paths: [outputPath],
        }),
      }),
    ]);
  });

  it('blocks the run when the task completes without the markdown file artifact', async () => {
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_missing_file' }),
      recoverTask: vi.fn().mockResolvedValue({ snapshot: taskSnapshot('task_missing_file', 'completed') }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('user-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    const result = await runner.runTemplateLoop({
      loopId: 'user-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result).toMatchObject({
      status: 'blocked',
      run: expect.objectContaining({
        id: run.id,
        nextActionKind: 'missing_file_artifact',
        nextActionSummary: expect.stringContaining(outputPath),
      }),
    });
    expect(loopStore.listLoopStages(run.id)).toEqual([
      expect.objectContaining({ stageKind: 'execute', status: 'success' }),
      expect.objectContaining({
        stageKind: 'verify',
        status: 'blocked',
        message: expect.stringContaining(outputPath),
      }),
    ]);
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({ kind: 'blocked', summary: expect.stringContaining(outputPath) }),
    ]);
  });

  it('creates the output directory before asking the task to write the markdown artifact', async () => {
    const missingOutputDirectory = join(rootDir, 'missing-output');
    const missingOutputPath = join(missingOutputDirectory, 'created.md');
    loopStore.createUserLoopTemplate({
      loopId: 'user-loop-missing-dir',
      title: 'Missing Dir Loop',
      kind: 'markdown_file',
      prompt: 'Write into a missing directory.',
      outputDirectory: missingOutputDirectory,
      outputFileName: 'created.md',
      now: 1_100,
    });
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_creates_dir' }),
      recoverTask: vi.fn(async () => {
        expect(existsSync(missingOutputDirectory)).toBe(true);
        writeFileSync(missingOutputPath, '# Created\n');
        return { snapshot: taskSnapshot('task_creates_dir', 'completed') };
      }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('user-loop-missing-dir', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    const result = await runner.runTemplateLoop({
      loopId: 'user-loop-missing-dir',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result).toMatchObject({ status: 'success' });
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'file_artifact',
        metadata: expect.objectContaining({ paths: [missingOutputPath] }),
      }),
    ]);
  });

  it('blocks legacy relative output directories before creating a task', async () => {
    (loopStore as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } })
      .db
      .prepare('update user_loop_templates set output_directory = ? where loop_id = ?')
      .run('relative-output', 'user-loop-1');
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'should_not_start' }),
      recoverTask: vi.fn().mockResolvedValue({ snapshot: taskSnapshot('should_not_start', 'completed') }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('user-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    const result = await runner.runTemplateLoop({
      loopId: 'user-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(taskPort.createTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'blocked',
      run: expect.objectContaining({
        id: run.id,
        nextActionKind: 'repair_output_directory',
        nextActionSummary: expect.stringContaining('absolute output directory'),
      }),
    });
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([
      expect.objectContaining({
        kind: 'blocked',
        metadata: expect.objectContaining({
          reason: 'relative_output_directory',
          outputDirectory: 'relative-output',
        }),
      }),
    ]);
  });

  it('fails the run when the task terminal snapshot failed', async () => {
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_failed' }),
      recoverTask: vi.fn().mockResolvedValue({ snapshot: taskSnapshot('task_failed', 'failed') }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('user-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    const result = await runner.runTemplateLoop({
      loopId: 'user-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result).toMatchObject({
      status: 'failed',
      run: expect.objectContaining({
        id: run.id,
        failureKind: 'executor_failed',
        message: '用户循环任务失败：状态 failed',
      }),
    });
    expect(loopStore.listLoopStages(run.id)).toEqual([
      expect.objectContaining({ stageKind: 'execute', status: 'failed', failureKind: 'executor_failed' }),
    ]);
    expect(evidenceStore.listEvidenceForOwner('loop_run', run.id)).toEqual([]);
  });

  it('cancels the underlying task with loop_poll_timeout when poll exceeds maxRunMs', async () => {
    const cancelTask = vi.fn(async () => undefined);
    let queryCount = 0;
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_runaway' }),
      // recoverTask first returns running indefinitely; after cancelTask is invoked, return cancelled
      recoverTask: vi.fn(async () => {
        queryCount++;
        if (cancelTask.mock.calls.length > 0) {
          return { snapshot: taskSnapshot('task_runaway', 'cancelled') };
        }
        return { snapshot: taskSnapshot('task_runaway', 'running') };
      }),
      cancelTask,
    };
    const run = expectStarted(loopStore.beginLoopRun('user-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
      pollIntervalMs: 5,
      maxRunMs: 30,
      sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    });

    const result = await runner.runTemplateLoop({
      loopId: 'user-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(cancelTask).toHaveBeenCalledWith('task_runaway', 'loop_poll_timeout');
    expect(result.status).toBe('failed');
    expect(queryCount).toBeGreaterThanOrEqual(2);
  });

  it('survives gracefully when cancelTask itself throws after poll timeout', async () => {
    const cancelTask = vi.fn(async () => { throw new Error('task already terminal'); });
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_already_terminal' }),
      recoverTask: vi.fn(async () => ({ snapshot: taskSnapshot('task_already_terminal', 'running') })),
      cancelTask,
    };
    const run = expectStarted(loopStore.beginLoopRun('user-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
      pollIntervalMs: 5,
      maxRunMs: 30,
      sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    });

    const result = await runner.runTemplateLoop({
      loopId: 'user-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(cancelTask).toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });

  it('passes watchdogMs in createTask so host watchdog tolerates loop max poll', async () => {
    const createTask = vi.fn().mockResolvedValue({ taskId: 'task_with_watchdog' });
    const taskPort: UserLoopTaskPort = {
      createTask,
      recoverTask: vi.fn(async () => {
        writeFileSync(outputPath, '# Done\n');
        return { snapshot: taskSnapshot('task_with_watchdog', 'completed') };
      }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('user-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    await runner.runTemplateLoop({
      loopId: 'user-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      watchdogMs: expect.any(Number),
    }));
    const created = createTask.mock.calls[0][0];
    // host watchdog should exceed the runner's maxRunMs default to give cancel cleanup buffer
    expect(created.watchdogMs).toBeGreaterThan(30 * 60_000);
  });
});

function expectStarted(result: ReturnType<LoopStore['beginLoopRun']>) {
  expect(result.status).toBe('started');
  if (result.status !== 'started') throw new Error('expected loop run to start');
  return result.run;
}

function taskSnapshot(taskId: string, status: TaskSnapshot['status']): TaskSnapshot {
  return {
    taskId,
    sessionId: 'session_1',
    status,
    prompt: 'test prompt',
    materials: [],
    events: [],
    createdAt: 1_000,
    updatedAt: 2_000,
  };
}

describe('UserLoopTemplateRunner — task_completion kind', () => {
  let rootDir: string;
  let loopStore: LoopStore;
  let evidenceStore: CompletionEvidenceStore;
  let now: number;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-task-completion-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    loopStore = new LoopStore(join(rootDir, 'loops.sqlite'));
    evidenceStore = new CompletionEvidenceStore(join(rootDir, 'completion-evidence.sqlite'));
    now = 2_000;
    loopStore.createUserLoopTemplate({
      loopId: 'tc-loop-1',
      title: 'Health Check',
      kind: 'task_completion',
      prompt: 'Check if all services are healthy.',
      now: 1_000,
    });
  });

  afterEach(() => {
    evidenceStore.close();
    loopStore.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('succeeds when task completes — no verify stage, evidence kind is answer', async () => {
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_tc_success' }),
      recoverTask: vi.fn().mockResolvedValue({ snapshot: taskSnapshot('task_tc_success', 'completed') }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('tc-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    const result = await runner.runTemplateLoop({
      loopId: 'tc-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result).toMatchObject({ status: 'success' });
    expect(taskPort.createTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Check if all services are healthy.',
      permissionMode: 'default',
    }));
    const finishedRun = loopStore.getLoopRun(run.id)!;
    expect(finishedRun.status).toBe('success');
    expect(finishedRun.summary).toContain('task_tc_success');
    expect(finishedRun.summary).toContain('Check if all services');
    // Only execute stage, no verify
    const stages = loopStore.listLoopStages(run.id);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ stageKind: 'execute', status: 'success' });
    // Evidence is 'answer' kind
    const evidence = evidenceStore.listEvidenceForOwner('loop_run', run.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      kind: 'answer',
      metadata: expect.objectContaining({ taskId: 'task_tc_success', promptPreview: expect.any(String) }),
    });
  });

  it('fails when task fails', async () => {
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_tc_fail' }),
      recoverTask: vi.fn().mockResolvedValue({ snapshot: taskSnapshot('task_tc_fail', 'failed') }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('tc-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    const result = await runner.runTemplateLoop({
      loopId: 'tc-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(loopStore.getLoopRun(run.id)!.status).toBe('failed');
    expect(loopStore.getLoopRun(run.id)!.message).toContain('failed');
  });

  it('blocks when scheduled trigger with autoRunApproved=false (plan mode)', async () => {
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'should_not_be_created' }),
      recoverTask: vi.fn(),
      cancelTask: vi.fn(),
    };
    const run = expectStarted(loopStore.beginLoopRun('tc-loop-1', { kind: 'scheduled' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    const result = await runner.runTemplateLoop({
      loopId: 'tc-loop-1',
      runId: run.id,
      trigger: { kind: 'scheduled' },
    });

    expect(result).toMatchObject({ status: 'blocked' });
    expect(loopStore.getLoopRun(run.id)!.status).toBe('blocked');
    expect(loopStore.getLoopRun(run.id)!.nextActionKind).toBe('awaiting_auto_run_approval');
    // Task should NOT be created
    expect(taskPort.createTask).not.toHaveBeenCalled();
  });

  it('succeeds for scheduled trigger when autoRunApproved=true', async () => {
    // Create a loop and manually set autoRunApproved (legacy field ignored on create)
    loopStore.createUserLoopTemplate({
      loopId: 'tc-loop-approved',
      title: 'Approved Loop',
      kind: 'task_completion',
      prompt: 'Do the thing.',
      now: 1_000,
    });
    // autoRunApproved is a legacy field ignored on create; set via raw DB
    const db = new DatabaseSync(join(rootDir, 'loops.sqlite'));
    db.prepare("update user_loop_templates set auto_run_approved = 1 where loop_id = 'tc-loop-approved'").run();
    db.close();
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_approved' }),
      recoverTask: vi.fn().mockResolvedValue({ snapshot: taskSnapshot('task_approved', 'completed') }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('tc-loop-approved', { kind: 'scheduled' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    const result = await runner.runTemplateLoop({
      loopId: 'tc-loop-approved',
      runId: run.id,
      trigger: { kind: 'scheduled' },
    });

    expect(result).toMatchObject({ status: 'success' });
    expect(taskPort.createTask).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: 'default',
    }));
  });

  it('reports timeout as auto-cancelled', async () => {
    let pollCount = 0;
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_timeout' }),
      recoverTask: vi.fn(async () => {
        pollCount++;
        if (pollCount > 3) {
          return { snapshot: taskSnapshot('task_timeout', 'cancelled') };
        }
        return { snapshot: taskSnapshot('task_timeout', 'running' as TaskSnapshot['status']) };
      }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('tc-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
      maxRunMs: 50,
      pollIntervalMs: 10,
      sleep: async () => { /* instant */ },
    });

    const result = await runner.runTemplateLoop({
      loopId: 'tc-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(loopStore.getLoopRun(run.id)!.message).toContain('cancelled');
  });

  it('persists taskId to stage metadata immediately after task creation', async () => {
    const taskPort: UserLoopTaskPort = {
      createTask: vi.fn().mockResolvedValue({ taskId: 'task_persist_id' }),
      recoverTask: vi.fn().mockResolvedValue({ snapshot: taskSnapshot('task_persist_id', 'completed') }),
      cancelTask: vi.fn(async () => undefined),
    };
    const run = expectStarted(loopStore.beginLoopRun('tc-loop-1', { kind: 'manual' }, 2_000, 60_000));
    const runner = createUserLoopTemplateRunner({
      loopStore,
      evidenceStore,
      taskPort,
      now: () => now,
    });

    await runner.runTemplateLoop({
      loopId: 'tc-loop-1',
      runId: run.id,
      trigger: { kind: 'manual' },
    });

    const stages = loopStore.listLoopStages(run.id);
    expect(stages[0].metadata).toMatchObject({ taskId: 'task_persist_id' });
  });

  it('does not require outputDirectory or outputFileName for creation', () => {
    // Verify the template was created with empty output fields
    const template = loopStore.getUserLoopTemplate('tc-loop-1');
    expect(template).toBeDefined();
    expect(template!.outputDirectory).toBe('');
    expect(template!.outputFileName).toBe('');
  });
});
