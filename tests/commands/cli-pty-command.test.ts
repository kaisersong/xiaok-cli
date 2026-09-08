import { PassThrough } from 'node:stream';
import { existsSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { runPtyCommand } from '../../src/commands/cli-pty-command.js';

function terminal(onOutput?: (text: string, input: PassThrough) => void) {
  const input = new PassThrough() as any;
  input.isTTY = true; input.isRaw = true; input.setRawMode = vi.fn();
  let screen = '';
  return { input, write: (text: string) => { screen += text; onOutput?.(screen, input); }, screen: () => screen };
}

describe('CLI PTY command', () => {
  it('rejects non-TTY and Windows before loading a native terminal', async () => {
    await expect(runPtyCommand('true', { platform: 'darwin', input: { isTTY: false } as any, write: () => {} })).rejects.toThrow('交互终端');
    await expect(runPtyCommand('true', { platform: 'win32', input: { isTTY: true } as any, write: () => {} })).rejects.toThrow('Windows');
  });
  it('does not start an aborted invocation', async () => {
    await expect(runPtyCommand('true', { ...terminal(), signal: AbortSignal.abort() })).rejects.toThrow();
  });
  it.runIf(process.platform !== 'win32')('provides a controlling terminal without echoing typed input and restores listeners', async () => {
    let entered = false;
    const tty = terminal((text, input) => {
      if (text.includes('Password:') && !entered) { entered = true; input.write('FAKE_SECRET_8271\r'); }
    });
    const result = await runPtyCommand('test -t 0 && test -r /dev/tty && printf "Password:" && read -r answer && test "$answer" = FAKE_SECRET_8271 && printf "DONE"', { ...tty, timeoutMs: 5000 });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('DONE');
    expect(tty.screen()).not.toContain('FAKE_SECRET_8271');
    expect(result.output).not.toContain('FAKE_SECRET_8271');
    expect(tty.input.listenerCount('data')).toBe(0);
    expect(tty.input.setRawMode).toHaveBeenLastCalledWith(true);
  });
  it.runIf(process.platform !== 'win32' && existsSync('/usr/bin/sudo'))('runs real sudo noninteractively without changing authentication state', async () => {
    const result = await runPtyCommand('/usr/bin/sudo -n /usr/bin/true', { ...terminal(), timeoutMs: 5000 });
    expect([0, 1]).toContain(result.exitCode);
    expect(result.output).not.toContain('a terminal is required');
  });

  it.runIf(process.platform !== 'win32')('waits for actual exit on cancellation and timeout', async () => {
    const controller = new AbortController();
    let pid = 0;
    const tty = terminal(text => { const match = text.match(/PID:(\d+)/); if (match) { pid = Number(match[1]); controller.abort(); } });
    await expect(runPtyCommand('printf "PID:%s\\n" "$$"; sleep 30', { ...tty, signal: controller.signal })).rejects.toThrow();
    expect(tty.input.listenerCount('data')).toBe(0);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow();
    const result = await runPtyCommand('sleep 30', { ...terminal(), timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
  });
});
