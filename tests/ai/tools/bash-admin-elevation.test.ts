import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawned: Array<{ command: string; args: string[]; child: EventEmitter & { stdout?: PassThrough } }> = [];

const spawnMock = vi.fn((command: string, args: string[]) => {
  const child = new EventEmitter() as EventEmitter & {
    stdout?: PassThrough;
    stderr?: PassThrough;
    pid?: number;
    kill?: ReturnType<typeof vi.fn>;
    unref?: ReturnType<typeof vi.fn>;
  };
  child.pid = command === 'taskkill' ? 4321 : 1234;
  child.kill = vi.fn();
  child.unref = vi.fn();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  spawned.push({ command, args, child });

  if (command !== 'taskkill') {
    setTimeout(() => {
      child.stdout?.write('Install requires administrator privileges; please run manually');
    }, 5);
  }

  return child;
});

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

const { bashTool } = await import('../../../src/ai/tools/bash.js');

describe.runIf(process.platform === 'win32')('bashTool Windows elevation handling', () => {
  beforeEach(() => {
    spawned.length = 0;
    spawnMock.mockClear();
  });

  it('returns an elevation error instead of waiting for timeout when output asks for admin rights', async () => {
    const result = await bashTool.execute({
      command: 'winget upgrade Microsoft.PowerShell',
      timeout_ms: 100,
    });

    expect(result).toMatch(/administrator|管理员权限/i);
    expect(result).not.toContain('超时');
    expect(spawned.some(entry => entry.command === 'taskkill')).toBe(true);
  });
});

