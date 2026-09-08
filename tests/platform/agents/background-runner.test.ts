import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createBackgroundRunner } from '../../../src/platform/agents/background-runner.js';
import { waitFor } from '../../support/wait-for.js';

describe('background runner', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-bg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates a background job, persists metadata, and stores completion state', async () => {
    const notify = vi.fn(async () => undefined);
    const runner = createBackgroundRunner({
      rootDir: testDir,
      execute: async ({ input }) => {
        return { ok: true, summary: `done:${String(input)}` };
      },
      notify,
    });

    const job = await runner.start({
      sessionId: 'sess_1',
      source: 'chat',
      input: 'fix slash menu',
    });

    expect(job.jobId).toMatch(/^job_[\da-f-]{36}$/);
    expect(job.status).toBe('queued');

    await waitFor(() => {
      expect(runner.get(job.jobId)).toMatchObject({
        jobId: job.jobId,
        sessionId: 'sess_1',
        status: 'completed',
        resultSummary: 'done:fix slash menu',
      });
    });

    const reloaded = createBackgroundRunner({
      rootDir: testDir,
      execute: async () => ({ ok: true, summary: 'unused' }),
      notify: async () => undefined,
    });
    expect(reloaded.get(job.jobId)).toMatchObject({
      jobId: job.jobId,
      status: 'completed',
      resultSummary: 'done:fix slash menu',
    });
  });

  it('sends a completion notification after the job finishes', async () => {
    const notify = vi.fn(async () => undefined);
    const runner = createBackgroundRunner({
      rootDir: testDir,
      execute: async () => ({ ok: true, summary: 'background complete' }),
      notify,
    });

    const job = await runner.start({
      sessionId: 'sess_2',
      source: 'chat',
      input: 'run background task',
    });

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: job.jobId,
          sessionId: 'sess_2',
          status: 'completed',
        }),
      );
    });
  });

  it('stores failure state when execution rejects', async () => {
    const runner = createBackgroundRunner({
      rootDir: testDir,
      execute: async () => {
        throw new Error('job failed hard');
      },
      notify: async () => undefined,
    });

    const job = await runner.start({
      sessionId: 'sess_3',
      source: 'chat',
      input: 'explode',
    });

    await waitFor(() => {
      expect(runner.get(job.jobId)).toMatchObject({
        jobId: job.jobId,
        status: 'failed',
        errorMessage: 'job failed hard',
      });
    });
  });

  it('marks in-flight jobs as interrupted only after their process is confirmed missing', async () => {
    const job = { schemaVersion: 1, jobId: 'job_1', sessionId: 'sess_restart', source: 'yzj',
      ownerId: 'exited-owner', ownerPid: 555555,
      inputSummary: 'process crashed', status: 'running', createdAt: 1, updatedAt: 1 };
    writeFileSync(join(testDir, 'job_1.json'), JSON.stringify(job));
    const inspect = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ESRCH' }); });
    try {
    const reloaded = createBackgroundRunner({
      rootDir: testDir,
      execute: async () => ({ ok: true, summary: 'unused' }),
      notify: async () => undefined,
    });

    expect(reloaded.get(job.jobId)).toMatchObject({
      jobId: job.jobId,
      status: 'failed',
      errorMessage: 'background job interrupted by process restart',
    });
    } finally { inspect.mockRestore(); }
  });

  it('lists background jobs by session', async () => {
    const runner = createBackgroundRunner({
      rootDir: testDir,
      execute: async ({ input }) => ({ ok: true, summary: String(input) }),
      notify: async () => undefined,
    });

    await runner.start({
      sessionId: 'sess_list',
      source: 'chat',
      input: 'job one',
    });
    await runner.start({
      sessionId: 'sess_other',
      source: 'chat',
      input: 'job two',
    });

    await waitFor(() => {
      expect(runner.listBySession('sess_list')[0]).toMatchObject({
        sessionId: 'sess_list',
      });
    });
  });

  it('associates background jobs with a task id and can list them by task', async () => {
    const runner = createBackgroundRunner({
      rootDir: testDir,
      execute: async ({ input }) => ({ ok: true, summary: String(input) }),
      notify: async () => undefined,
    });

    await runner.start({
      sessionId: 'sess_task',
      source: 'yzj',
      taskId: 'task_42',
      input: 'background follow-up',
    });

    await waitFor(() => {
      expect(runner.listByTask('task_42')[0]).toMatchObject({
        sessionId: 'sess_task',
        taskId: 'task_42',
      });
    });
  });

  it('does not surface notify failures as unhandled rejections after job completion', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const runner = createBackgroundRunner({
        rootDir: testDir,
        execute: async ({ input }) => ({ ok: true, summary: String(input) }),
        notify: async () => {
          throw new Error('notify failed');
        },
      });

      const job = await runner.start({
        sessionId: 'sess_notify',
        source: 'chat',
        input: 'background completion',
      });

      await waitFor(() => {
        expect(runner.get(job.jobId)).toMatchObject({
          jobId: job.jobId,
          status: 'completed',
          resultSummary: 'background completion',
        });
      });

      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('aborts and drains active jobs on dispose without sending completion notifications', async () => {
    let signal!: AbortSignal;
    const notify = vi.fn();
    const runner = createBackgroundRunner({ rootDir: testDir, notify,
      execute: async (context) => {
        signal = context.signal;
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        return { ok: true, summary: 'late success' };
      },
    });
    const job = await runner.start({ sessionId: 'active', source: 'chat', input: 'run' });
    expect(await runner.dispose()).toEqual({ settled: true, pendingJobs: [] });
    expect(signal.aborted).toBe(true);
    expect(runner.get(job.jobId)).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('BACKGROUND_RUNNER_DISPOSED') });
    expect(notify).not.toHaveBeenCalled();
    await expect(runner.start({ sessionId: 'late', source: 'chat', input: 'no' })).rejects.toThrow('disposed');
    expect(await runner.dispose()).toEqual({ settled: true, pendingJobs: [] });
  });

  it('cancels queued jobs before execute is entered', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const runner = createBackgroundRunner({ rootDir: testDir, notify: vi.fn(), execute });
    const starting = runner.start({ sessionId: 'queued', source: 'chat', input: 'run' });
    const stopping = runner.dispose();
    const job = await starting;
    await stopping;
    expect(execute).not.toHaveBeenCalled();
    expect(runner.get(job.jobId)).toMatchObject({ status: 'failed' });
  });

  it('reports a never-settling executor as pending after the bounded shutdown', async () => {
    const runner = createBackgroundRunner({ rootDir: testDir, shutdownTimeoutMs: 5, notify: vi.fn(),
      execute: () => new Promise(() => {}),
    });
    const job = await runner.start({ sessionId: 'forever', source: 'chat', input: 'run' });
    expect(await runner.dispose()).toEqual({ settled: false, pendingJobs: [job.jobId] });
    expect(runner.get(job.jobId)).toMatchObject({ status: 'failed' });
  });

  it('ignores late completion after dispose and retains already completed job state', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const notify = vi.fn();
    const runner = createBackgroundRunner({ rootDir: testDir, shutdownTimeoutMs: 5, notify,
      execute: async ({ input }) => { if (input === 'late') await gate; return { ok: true, summary: String(input) }; },
    });
    const done = await runner.start({ sessionId: 'same', source: 'chat', input: 'done' });
    await waitFor(() => expect(runner.get(done.jobId)?.status).toBe('completed'));
    const late = await runner.start({ sessionId: 'same', source: 'chat', input: 'late' });
    await runner.dispose();
    const cancelled = runner.get(late.jobId);
    finish();
    await new Promise(setImmediate);
    expect(runner.get(late.jobId)).toEqual(cancelled);
    expect(runner.get(done.jobId)?.status).toBe('completed');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(await runner.dispose()).toEqual({ settled: true, pendingJobs: [] });
  });

  it('isolates same-directory runners during creation, completion, recovery and shutdown', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const a = createBackgroundRunner({ rootDir: testDir, shutdownTimeoutMs: 5,
      execute: async () => { await gate; return { ok: true }; }, notify: vi.fn() });
    const b = createBackgroundRunner({ rootDir: testDir,
      execute: async () => ({ ok: true, summary: 'B completed' }), notify: vi.fn() });
    const jobA = await a.start({ sessionId: 'A', source: 'chat', input: 'A' });
    const observer = createBackgroundRunner({ rootDir: testDir,
      execute: async () => ({ ok: true }), notify: vi.fn() });
    expect(observer.get(jobA.jobId)?.status).toBe('running');
    const jobB = await b.start({ sessionId: 'B', source: 'chat', input: 'B' });
    expect(jobB.jobId).not.toBe(jobA.jobId);
    await waitFor(() => expect(b.get(jobB.jobId)?.status).toBe('completed'));
    await a.dispose();
    const persistedB = JSON.parse(readFileSync(join(testDir, `${jobB.jobId}.json`), 'utf8'));
    expect(persistedB).toMatchObject({ sessionId: 'B', status: 'completed', resultSummary: 'B completed' });
    release();
    await new Promise(setImmediate);
    await b.dispose();
    await observer.dispose();
  });

  it('preserves a live process owner and recovers its job only after that process exits', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const exited = once(child, 'exit');
    await once(child, 'spawn');
    const job = { schemaVersion: 1, jobId: 'job_external', sessionId: 'external', source: 'chat',
      ownerId: 'external-runner', ownerPid: child.pid, inputSummary: 'running elsewhere',
      status: 'running', createdAt: 1, updatedAt: 1 };
    try {
      writeFileSync(join(testDir, 'job_external.json'), JSON.stringify(job));
      const reader = createBackgroundRunner({ rootDir: testDir,
        execute: async () => ({ ok: true }), notify: vi.fn() });
      expect(reader.get(job.jobId)?.status).toBe('running');
      expect(JSON.parse(readFileSync(join(testDir, 'job_external.json'), 'utf8')).status).toBe('running');
    } finally {
      child.kill();
      await exited;
    }
    const recovered = createBackgroundRunner({ rootDir: testDir,
      execute: async () => ({ ok: true }), notify: vi.fn() });
    expect(recovered.get(job.jobId)).toMatchObject({ status: 'failed',
      errorMessage: 'background job interrupted by process restart' });
  });
});
