import { describe, expect, it, vi } from 'vitest';
import { createTerminalOutputRouter } from '../../src/commands/terminal-output-router.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const epipe = () => Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
describe('terminal output failure circuit', () => {
  it('bounds logs when both real child-process output pipes disconnect', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-epipe-circuit-'));
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
    const entry = new URL(`../../src/commands/terminal-output-router.${extension}`, import.meta.url).href;
    const logger = new URL(`../../src/utils/logger.${extension}`, import.meta.url).href;
    const crashes = new URL(`../../src/utils/crash-reporter.${extension}`, import.meta.url).href;
    const script = `
      import { createTerminalOutputRouter } from ${JSON.stringify(entry)};
      import { createLogger } from ${JSON.stringify(logger)};
      import { installGlobalCrashHandlers, setStreamErrorHandler } from ${JSON.stringify(crashes)};
      import { writeFileSync } from 'node:fs';
      const log = createLogger('chat', { stderr: false });
      const router = createTerminalOutputRouter({
        stdout: process.stdout.write.bind(process.stdout), stderr: process.stderr.write.bind(process.stderr),
        onFailure: (stream, error) => log.error('stream_error', { stream, error: String(error) }),
      });
      setStreamErrorHandler((error, stream) => { router.fail(stream === process.stdout ? 'stdout' : 'stderr', error); return true; });
      installGlobalCrashHandlers();
      const timer = setInterval(() => { router.write('stdout', 'tick\\n'); router.write('stderr', 'tick\\n'); }, 1);
      setTimeout(() => {
        clearInterval(timer);
        writeFileSync(${JSON.stringify(join(root, 'result.json'))}, JSON.stringify({ hasOutput: router.hasOutput() }));
      }, 300);
    `;
    const child = spawn(process.execPath, [...(extension === 'ts' ? ['--import', 'tsx'] : []), '--input-type=module', '-e', script], {
      env: { ...process.env, XIAOK_CONFIG_DIR: root, TMPDIR: root, TMP: root, TEMP: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.once('data', () => child.stdout.destroy());
    child.stderr.once('data', () => child.stderr.destroy());
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject); child.once('close', resolve);
      });
      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'))).toEqual({ hasOutput: false });
      const log = readFileSync(join(root, 'logs', 'xiaok.log'), 'utf8');
      expect(log.match(/stream_error/g)).toHaveLength(2);
      expect(log).toContain('EPIPE');
      expect(log.length).toBeLessThan(1000);
    } finally {
      clearTimeout(timeout);
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('handles asynchronous errors once per stream and never retries a broken destination', () => {
    const stdout = vi.fn(() => true);
    const stderr = vi.fn(() => true);
    const onFailure = vi.fn();
    const router = createTerminalOutputRouter({ stdout, stderr, onFailure });
    for (let i = 0; i < 10000; i++) router.fail('stdout', epipe());
    router.write('stdout', 'fallback');
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10000; i++) router.fail('stderr', epipe());
    for (let i = 0; i < 100; i++) router.write('stdout', 'discard');
    expect(onFailure).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(router.hasOutput()).toBe(false);
  });
  it('marks failures before callbacks can re-enter and stops after both synchronous writes fail', () => {
    const stdout = vi.fn(() => { throw epipe(); });
    const stderr = vi.fn(() => { throw epipe(); });
    const onFailure = vi.fn(() => { router.write('stderr', 'cleanup'); });
    const router = createTerminalOutputRouter({ stdout, stderr, onFailure });
    expect(() => router.write('stdout', 'hello')).not.toThrow();
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(2);
  });
  it('does not mistake backpressure for a broken stream', () => {
    const onFailure = vi.fn();
    const router = createTerminalOutputRouter({ stdout: () => false, stderr: () => true, onFailure });
    expect(router.write('stdout', 'hello')).toBe(false);
    expect(router.hasOutput()).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
