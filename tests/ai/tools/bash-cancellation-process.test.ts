import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashTool } from '../../../src/ai/tools/bash.js';
import { waitFor } from '../../support/wait-for.js';

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

describe.runIf(process.platform !== 'win32')('real bash process cancellation', () => {
  it('settles a timeout only after an ignore-TERM child has exited', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xiaok-bash-timeout-'));
    const script = join(dir, 'child.cjs');
    const pidFile = join(dir, 'child.pid');
    writeFileSync(script, "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);");
    let pid: number | undefined;
    try {
      const pending = bashTool.execute({ command: `${quote(process.execPath)} ${quote(script)} ${quote(pidFile)} & wait`, timeout_ms: 300 });
      await waitFor(() => { pid = Number(readFileSync(pidFile, 'utf8')); expect(pid).toBeGreaterThan(0); });
      expect(await pending).toContain('超时');
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
  it('interrupts a shell and its running child before releasing the invocation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xiaok-bash-abort-'));
    const script = join(dir, 'child.cjs');
    const pidFile = join(dir, 'child.pid');
    writeFileSync(script, "require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);");
    const controller = new AbortController();
    let pid: number | undefined;
    const pending = bashTool.execute({ command: `${quote(process.execPath)} ${quote(script)} ${quote(pidFile)} & wait`,
      timeout_ms: 10000 }, { signal: controller.signal } as never);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    try {
      await waitFor(() => { pid = Number(readFileSync(pidFile, 'utf8')); expect(pid).toBeGreaterThan(0); });
      process.kill(pid!, 0);
      controller.abort();
      await rejection;
      await waitFor(() => expect(() => process.kill(pid!, 0)).toThrow());
    } finally {
      controller.abort();
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
