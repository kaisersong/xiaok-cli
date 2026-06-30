import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { SENSITIVE_FILE_REDACTION } from '../../../src/shared/stream-safety/redact.js';

describe('readTool', () => {
  let dir: string;
  let readTool: ReturnType<typeof createReadTool>;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    readTool = createReadTool({ cwd: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads file with line numbers', async () => {
    writeFileSync(join(dir, 'foo.txt'), 'line1\nline2\nline3');
    const result = await readTool.execute({ file_path: join(dir, 'foo.txt') });
    expect(result).toContain('1\tline1');
    expect(result).toContain('2\tline2');
  });

  it('returns error message for missing file', async () => {
    const result = await readTool.execute({ file_path: join(dir, 'missing.txt') });
    expect(result).toContain('Error');
  });

  it('fails closed for sensitive file types', async () => {
    writeFileSync(join(dir, '.env'), 'OPENAI_API_KEY=sk-live_abcdefghijklmnopqrstuvwxyz');

    const result = await readTool.execute({ file_path: join(dir, '.env') });

    expect(result).toBe(SENSITIVE_FILE_REDACTION);
    expect(result).not.toContain('sk-live');
  });

  it('redacts secrets from normal file output', async () => {
    writeFileSync(join(dir, 'notes.txt'), [
      'Authorization: Bearer sk-live_abcdefghijklmnopqrstuvwxyz',
      'commit 0123456789abcdef0123456789abcdef01234567',
    ].join('\n'));

    const result = await readTool.execute({ file_path: join(dir, 'notes.txt') });

    expect(result).toContain('Authorization: Bearer <redacted>');
    expect(result).toContain('0123456789abcdef0123456789abcdef01234567');
    expect(result).not.toContain('sk-live_abcdefghijklmnopqrstuvwxyz');
  });

  it('truncates oversized output when max_chars is provided', async () => {
    writeFileSync(join(dir, 'large.txt'), Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join('\n'));

    const result = await readTool.execute({
      file_path: join(dir, 'large.txt'),
      max_chars: 60,
    });

    expect(result).toContain('已截断');
  });
});
