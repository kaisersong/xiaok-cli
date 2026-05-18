import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultAheLiveSmokeChecks, runAheLiveSmokeGate } from '../../../src/runtime/evals/live-smoke-gate.js';

describe('AHE-lite live smoke release gate', () => {
  it('classifies live smoke commands and writes an auditable release-gate summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ahe-live-gate-'));
    const outputPath = join(root, 'live-smoke.json');
    const summary = await runAheLiveSmokeGate({
      outputPath,
      now: () => new Date('2026-05-18T00:00:00.000Z'),
      checks: [
        {
          id: 'tmux',
          label: 'tmux TTY e2e',
          command: ['python3', 'tests/e2e/tmux-e2e.py'],
          run: async () => ({ exitCode: 0, stdout: 'PASS: terminal e2e completed', stderr: '', durationMs: 5 }),
        },
        {
          id: 'desktop-ipc',
          label: 'Desktop AHE IPC',
          command: ['npm', '--prefix', 'desktop', 'test', '--', 'tests/main/ahe-lite-live-ipc.test.ts'],
          run: async () => ({ exitCode: 1, stdout: '', stderr: 'AssertionError: trace export failed', durationMs: 5 }),
        },
        {
          id: 'kswarm-restart',
          label: 'KSwarm restart recovery',
          command: ['npm', '--prefix', 'desktop', 'test', '--', 'tests/main/ahe-lite-live-ipc.test.ts'],
          run: async () => ({ exitCode: 124, stdout: '', stderr: 'timed out waiting for restart', timedOut: true, durationMs: 30_000 }),
        },
      ],
    });

    expect(summary.recommendation).toBe('revise');
    expect(summary.results.map((result) => result.failureClass)).toEqual(['pass', 'product', 'timeout']);
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      results: expect.arrayContaining([
        expect.objectContaining({ id: 'desktop-ipc', failureClass: 'product' }),
      ]),
    });
  });

  it('marks skipped live smoke release gates inconclusive with a manifest reason', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ahe-live-gate-'));
    const summary = await runAheLiveSmokeGate({
      outputPath: join(root, 'live-smoke.json'),
      skipReason: 'CI runner has no tmux display',
      checks: createDefaultAheLiveSmokeChecks(),
    });

    expect(summary.recommendation).toBe('inconclusive');
    expect(summary.results.every((result) => result.failureClass === 'skipped')).toBe(true);
    expect(summary.skipReason).toBe('CI runner has no tmux display');
  });

  it('classifies sandbox socket permission failures as infra instead of product failures', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ahe-live-gate-'));
    const summary = await runAheLiveSmokeGate({
      outputPath: join(root, 'live-smoke.json'),
      now: () => new Date('2026-05-18T00:00:00.000Z'),
      checks: [
        {
          id: 'tmux',
          label: 'tmux TTY e2e',
          command: ['python3', 'tests/e2e/tmux-e2e.py'],
          run: async () => ({
            exitCode: 1,
            stdout: '',
            stderr: 'PermissionError: [Errno 1] Operation not permitted',
            durationMs: 5,
          }),
        },
      ],
    });

    expect(summary.recommendation).toBe('inconclusive');
    expect(summary.results[0]?.failureClass).toBe('infra');
  });
});
