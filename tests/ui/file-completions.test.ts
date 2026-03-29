import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileCompleter, resolveFileReferences } from '../../src/ui/file-completions.js';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('FileCompleter', () => {
  let tempDir: string;
  let completer: FileCompleter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xiaok-test-'));
    await writeFile(join(tempDir, 'test.ts'), 'test content');
    await writeFile(join(tempDir, 'readme.md'), 'readme');
    await writeFile(join(tempDir, 'config.json'), '{}');
    completer = new FileCompleter(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('getCompletions', () => {
    it('returns matching files for partial name', async () => {
      const completions = await completer.getCompletions('test');
      expect(completions).toContainEqual({ cmd: '@test.ts', desc: 'ts' });
    });

    it('returns all files for empty partial', async () => {
      const completions = await completer.getCompletions('');
      expect(completions.length).toBeGreaterThan(0);
    });

    it('filters by file extension', async () => {
      const completions = await completer.getCompletions('test');
      const tsFiles = completions.filter(c => c.desc === 'ts');
      expect(tsFiles.length).toBeGreaterThan(0);
    });

    it('limits results to 15 items', async () => {
      // Create more than 15 files
      for (let i = 0; i < 20; i++) {
        await writeFile(join(tempDir, `file${i}.txt`), 'content');
      }
      completer.invalidate(); // Clear cache

      const completions = await completer.getCompletions('');
      expect(completions.length).toBeLessThanOrEqual(15);
    });
  });

  describe('invalidate', () => {
    it('clears the cache', async () => {
      await completer.getCompletions(''); // Populate cache
      completer.invalidate();
      // Cache should be cleared, next call will rescan
      const completions = await completer.getCompletions('');
      expect(completions).toBeDefined();
    });
  });
});

describe('resolveFileReferences', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xiaok-test-'));
    await writeFile(join(tempDir, 'example.txt'), 'Hello World');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resolves file references to content', async () => {
    const text = 'Check this file: @example.txt';
    const result = await resolveFileReferences(text, tempDir);
    expect(result).toContain('Hello World');
    expect(result).toContain('```example.txt');
  });

  it('leaves non-existent files unchanged', async () => {
    const text = 'Check @nonexistent.txt';
    const result = await resolveFileReferences(text, tempDir);
    expect(result).toBe(text);
  });

  it('handles multiple file references', async () => {
    await writeFile(join(tempDir, 'file1.txt'), 'Content 1');
    await writeFile(join(tempDir, 'file2.txt'), 'Content 2');

    const text = 'Files: @file1.txt and @file2.txt';
    const result = await resolveFileReferences(text, tempDir);
    expect(result).toContain('Content 1');
    expect(result).toContain('Content 2');
  });

  it('returns original text when no references found', async () => {
    const text = 'No file references here';
    const result = await resolveFileReferences(text, tempDir);
    expect(result).toBe(text);
  });
});
