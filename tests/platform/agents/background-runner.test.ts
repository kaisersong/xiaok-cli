import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

    expect(job.jobId).toBe('job_1');
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
});
