import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeTraceRecorder } from '../../../src/runtime/trace/runtime-recorder.js';
import { validateTraceBundle, type TraceBundleV1 } from '../../../src/runtime/trace/schema.js';

describe('runtime trace recorder', () => {
  it('writes schema-valid redacted trace bundles from runtime tool and artifact events', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'xiaok-runtime-trace-'));
    const now = sequenceClock([
      '2026-05-18T00:00:00.000Z',
      '2026-05-18T00:00:01.000Z',
      '2026-05-18T00:00:02.000Z',
      '2026-05-18T00:00:03.000Z',
      '2026-05-18T00:00:04.000Z',
    ]);
    const recorder = new RuntimeTraceRecorder({
      rootDir,
      sessionId: 'sess-1',
      cwd: '/Users/song/projects/customer',
      command: 'xiaok chat',
      version: '0.0.0-test',
      previewBytes: 80,
      persistOutputBytes: 120,
      now,
    });

    recorder.handleEvent({ type: 'turn_started', sessionId: 'sess-1', turnId: 'turn-1' });
    recorder.handleEvent({
      type: 'pre_tool_use',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      toolName: 'bash',
      toolUseId: 'tool-1',
      toolInput: { command: 'echo hello', OPENAI_API_KEY: 'sk-test-secret' },
    });
    recorder.handleEvent({
      type: 'post_tool_use',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      toolName: 'bash',
      toolUseId: 'tool-1',
      toolInput: { command: 'echo hello' },
      toolResponse: `${'x'.repeat(160)}\nDATABASE_URL=postgres://user:pass@localhost/db`,
    });
    recorder.handleEvent({
      type: 'artifact_recorded',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      intentId: 'intent-1',
      stageId: 'stage-1',
      artifactId: 'artifact-1',
      label: 'report',
      kind: 'markdown',
      path: '/Users/song/projects/customer/report.md',
      creator: 'tool:bash',
    });
    recorder.handleEvent({ type: 'turn_completed', sessionId: 'sess-1', turnId: 'turn-1' });

    const outputPath = await recorder.flush();
    const bundle = JSON.parse(readFileSync(outputPath!, 'utf8')) as TraceBundleV1;

    expect(validateTraceBundle(bundle)).toEqual({ ok: true });
    expect(bundle.scope).toMatchObject({ kind: 'session', sessionId: 'sess-1' });
    expect(bundle.environment.cwd).toBe('/Users/[USER]/projects/customer');
    expect(bundle.turns).toEqual([expect.objectContaining({ id: 'turn-1' })]);
    expect(bundle.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        name: 'bash',
        ok: true,
        inputPreview: expect.stringContaining('[REDACTED:api_key]'),
        outputPreview: expect.not.stringContaining('postgres://user:pass'),
        persistedOutputPath: expect.stringContaining('tool-output'),
      }),
    ]);
    expect(bundle.artifacts).toEqual([
      expect.objectContaining({
        id: 'artifact-1',
        path: '/Users/[USER]/projects/customer/report.md',
        existsAtExport: false,
      }),
    ]);
    expect(bundle.events.map((event) => event.refs?.toolCallId).filter(Boolean)).toContain('tool-1');
    expect(JSON.stringify(bundle)).not.toContain('sk-test-secret');
    expect(JSON.stringify(bundle)).not.toContain('postgres://user:pass');
  });

  it('does not throw when trace writing fails', async () => {
    const warnings: unknown[] = [];
    const recorder = new RuntimeTraceRecorder({
      rootDir: '/dev/null/not-a-directory',
      sessionId: 'sess-2',
      onWarning: (error) => warnings.push(error),
    });

    recorder.handleEvent({ type: 'turn_started', sessionId: 'sess-2', turnId: 'turn-1' });

    await expect(recorder.flush()).resolves.toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('redacts secrets from failed tool error summaries', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'xiaok-runtime-trace-'));
    const recorder = new RuntimeTraceRecorder({ rootDir, sessionId: 'sess-3' });

    recorder.handleEvent({ type: 'turn_started', sessionId: 'sess-3', turnId: 'turn-1' });
    recorder.handleEvent({
      type: 'post_tool_use_failure',
      sessionId: 'sess-3',
      turnId: 'turn-1',
      toolName: 'web_fetch',
      toolInput: { url: 'https://example.com' },
      toolUseId: 'tool-secret-failure',
      error: 'Authorization: Bearer secret-token-123 failed',
    });

    const outputPath = await recorder.flush();
    const raw = readFileSync(outputPath!, 'utf8');

    expect(raw).not.toContain('secret-token-123');
    expect(raw).toContain('[REDACTED:bearer]');
  });

  it('does not duplicate cwd redaction metadata across repeated bundle creation', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'xiaok-runtime-trace-'));
    const recorder = new RuntimeTraceRecorder({
      rootDir,
      sessionId: 'sess-4',
      cwd: '/Users/song/projects/customer',
    });

    recorder.createBundle();
    const bundle = recorder.createBundle();

    expect(bundle.redactions.filter((redaction) => redaction.type === 'home_path')).toEqual([
      expect.objectContaining({ count: 1, fieldPath: 'environment.cwd' }),
    ]);
  });
});

function sequenceClock(values: string[]): () => Date {
  const fn = vi.fn(() => new Date(values[Math.min(fn.mock.calls.length, values.length - 1)]));
  return fn;
}
