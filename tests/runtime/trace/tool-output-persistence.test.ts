import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TraceBundleWriter } from '../../../src/runtime/trace/writer.js';

describe('trace tool output persistence', () => {
  it('redacts large tool output before writing persisted output files', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'xiaok-trace-writer-'));
    const writer = new TraceBundleWriter({ rootDir, previewBytes: 40, persistOutputBytes: 80 });
    const content = [
      'x'.repeat(100),
      'DATABASE_URL=postgres://user:pass@localhost/db',
      'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz',
    ].join('\n');

    const result = writer.persistLargeOutput({ toolCallId: 'tool-1', content });

    expect(result.path).toBeTruthy();
    expect(result.preview.length).toBeLessThanOrEqual(40);
    expect(result.redactedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bytes).toBe(Buffer.byteLength(content, 'utf8'));
    expect(result.redactions.map((r) => r.type)).toEqual(expect.arrayContaining(['database_url', 'secret_env']));

    const persisted = readFileSync(result.path!, 'utf8');
    expect(persisted).not.toContain('postgres://user:pass');
    expect(persisted).not.toContain('ghp_');
    expect(persisted).toContain('DATABASE_URL=[REDACTED:database_url]');
    expect(persisted).toContain('GITHUB_TOKEN=[REDACTED:secret_env]');
  });

  it('keeps small output inline without creating a persisted file', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'xiaok-trace-writer-'));
    const writer = new TraceBundleWriter({ rootDir, previewBytes: 100, persistOutputBytes: 1000 });

    const result = writer.persistLargeOutput({ toolCallId: 'tool-2', content: 'short output' });

    expect(result).toMatchObject({
      preview: 'short output',
      bytes: Buffer.byteLength('short output', 'utf8'),
      path: undefined,
    });
    expect(result.redactedSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
