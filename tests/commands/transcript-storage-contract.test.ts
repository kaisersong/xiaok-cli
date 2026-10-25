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
    const shutdownStart = source.indexOf('const shutdownTerminal = (reason: ExitSignal) => exitFromSignal(reason);');
    const terminalStart = source.indexOf('finishTerminal = () => {', shutdownStart);
    const interruptStart = source.indexOf('const onInterrupt =', terminalStart);
    expect(shutdownStart).toBeGreaterThan(0);
    expect(terminalStart).toBeGreaterThan(shutdownStart);
    expect(interruptStart).toBeGreaterThan(terminalStart);
    const terminal = source.slice(terminalStart, interruptStart);
    const interrupt = source.slice(interruptStart, source.indexOf('interrupt = onInterrupt;', interruptStart));
    expect(interrupt).toContain("shutdownTerminal('sigint')");
    expect(source).toContain("process.on('SIGINT', dispatchInterrupt)");
    expect(terminal).toContain('unregisterCrashOutput();');
    expect(terminal).toContain('restoreCapturedOutput();');
    const restoreHelper = source.slice(source.indexOf('const restoreCapturedOutput ='), source.indexOf('const isBrokenPipeError ='));
    expect(restoreHelper).toContain('process.stdout.write = originalStdoutWrite;');
    expect(restoreHelper).toContain('process.stderr.write = originalStderrWrite;');
    const finalizer = source.slice(source.indexOf('finalizeOwners = async errors =>'), source.indexOf('const rawRuntimeHooks ='));
    const drainIndex = finalizer.indexOf('await drainContinuations(detachedWork);');
    const restoreIndex = finalizer.indexOf('finishTerminal();');
    const closeIndex = finalizer.indexOf('() => transcriptLogger.close(),');
    expect(drainIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeGreaterThan(drainIndex);
    expect(closeIndex).toBeGreaterThan(restoreIndex);

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
