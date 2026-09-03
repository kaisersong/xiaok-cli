import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('transcript storage contracts', () => {
  it('keeps the built-in transcript path consumers on a frozen read-only allowlist', () => {
    const files = listTypeScriptFiles(join(process.cwd(), 'src'));
    const references = files.flatMap((file) => readFileSync(join(process.cwd(), file), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /\btranscript_path\b|\btranscriptPath\b/.test(line))
      .map((line) => `${file}:${line}`))
      .sort();

    expect(references).toEqual([
      'src/commands/chat.ts:transcriptPath: transcriptLogger.path,',
      'src/commands/chat.ts:transcript_path: transcriptLogger.path,',
      'src/platform/runtime/registry-factory.ts:transcriptPath?: string;',
      'src/platform/runtime/registry-factory.ts:transcript_path: options.transcriptPath,',
      'src/runtime/hooks-runner.ts:transcript_path?: string;',
      "src/runtime/hooks-runner.ts:...(ctx.transcript_path ? { transcript_path: ctx.transcript_path } : {}),",
    ].sort());
  });

  it('wires chat through async logger open and synchronous lifecycle close', () => {
    const source = readFileSync(join(process.cwd(), 'src/commands/chat.ts'), 'utf8');
    expect(source).toContain('await FileTranscriptLogger.open(sessionId)');
    expect(source).toContain('() => transcriptLogger.close(),');
  });

  it('opens file fsync handles with write access for Windows FlushFileBuffers', () => {
    const source = readFileSync(join(process.cwd(), 'src/ui/transcript-storage.ts'), 'utf8');
    const helper = source.slice(source.indexOf('function fsyncFile('), source.indexOf('function fsyncDirectory('));
    expect(helper).toContain("openSync(path, 'r+')");
    expect(helper).not.toContain("openSync(path, 'r')");
  });

  it('restores transcript stream wrappers before SIGINT closes the logger', () => {
    const source = readFileSync(join(process.cwd(), 'src/commands/chat.ts'), 'utf8');
    const handler = source.slice(source.indexOf('// SIGINT 处理'), source.indexOf('const handleCompletedIntentFeedbackResult'));
    const restoreIndex = handler.indexOf('process.stdout.write = originalStdoutWrite;');
    const cleanupIndex = handler.indexOf('await cleanupRuntimeResourcesWithTimeout();');
    expect(restoreIndex).toBeGreaterThan(0);
    expect(restoreIndex).toBeLessThan(cleanupIndex);
  });
});

function listTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
    }
  };
  visit(root);
  return files.map((path) => path.slice(process.cwd().length + 1).replace(/\\/g, '/'));
}
