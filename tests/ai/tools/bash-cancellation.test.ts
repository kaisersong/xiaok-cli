import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
const { spawn } = await import('child_process');
const { bashTool } = await import('../../../src/ai/tools/bash.js');

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  vi.restoreAllMocks();
});

describe('bash cancellation', () => {
  it('does not report settlement when Windows taskkill and shell termination fail', async () => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
    const child = Object.assign(new EventEmitter(), {
      pid: 123456, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn(),
    });
    const killer = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReset().mockReturnValueOnce(child as never).mockReturnValueOnce(killer as never);
    const controller = new AbortController();
    let settled = false;
    const pending = bashTool.execute({ command: 'echo running' }, { signal: controller.signal } as never);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    void pending.then(() => { settled = true; }, () => { settled = true; });
    controller.abort();
    killer.emit('error', Object.assign(new Error('denied'), { code: 'EPERM' }));
    child.emit('error', Object.assign(new Error('kill denied'), { code: 'EPERM' }));
    await new Promise(setImmediate);
    expect(settled).toBe(false);
    child.emit('close', null);
    await rejected;
  });
  it.each(['timeout', 'elevation'])('waits for Windows child close after %s termination', async (reason) => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
    const child = Object.assign(new EventEmitter(), {
      pid: 123456, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn(),
    });
    vi.mocked(spawn).mockReset().mockReturnValue(child as never);
    let settled = false;
    const pending = bashTool.execute({ command: 'echo running', timeout_ms: 5 });
    void pending.then(() => { settled = true; });
    if (reason === 'elevation') child.stdout.write('requires administrator privileges');
    else await new Promise((resolve) => setTimeout(resolve, 10));
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', null);
    expect(await pending).toContain(reason === 'timeout' ? '超时' : '管理员权限');
  });
  it('never spawns with an already aborted context', async () => {
    vi.mocked(spawn).mockClear();
    await expect(bashTool.execute({ command: 'echo cancelled' }, { signal: AbortSignal.abort() } as never))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(['darwin', 'win32'])('cancels the process tree and waits for close on %s', async (platform) => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const child = Object.assign(new EventEmitter(), {
      pid: 123456, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn(),
    });
    vi.mocked(spawn).mockReset().mockReturnValue(child as never);
    const controller = new AbortController();
    let settled = false;
    const pending = bashTool.execute({ command: 'echo running' }, { signal: controller.signal } as never);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    void pending.then(() => { settled = true; }, () => { settled = true; });
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    if (platform === 'win32') {
      expect(spawn).toHaveBeenCalledWith('taskkill', ['/F', '/T', '/PID', '123456'], expect.anything());
    } else {
      expect(kill).toHaveBeenCalledWith(-123456, 'SIGKILL');
    }
    child.emit('close', null, 'SIGTERM');
    await rejection;
  });
});
