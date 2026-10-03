import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn: spawnMock }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
const { bashTool } = await import('../../../src/ai/tools/bash.js');
const { runInteractiveShellCommand } = await import('../../../src/commands/chat-shell-escape.js');
const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
const children: ReturnType<typeof childFixture>[] = [];
function childFixture() {
  return Object.assign(new EventEmitter(), { pid: 123456, exitCode: null as number | null,
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn() });
}
beforeEach(() => {
  vi.useFakeTimers(); spawnMock.mockReset();
  Object.defineProperty(process, 'platform', { ...original, value: 'win32' });
});
afterEach(() => {
  for (const child of children.splice(0)) { child.emit('close', 0, null); child.stdout.destroy(); child.stderr.destroy(); }
  Object.defineProperty(process, 'platform', original); vi.useRealTimers(); vi.restoreAllMocks();
});
describe('Windows shell with inherited GUI output handles', () => {
  it.each(['tool', 'interactive'])('finishes %s after real parent exit without waiting for the launched app', async entry => {
    const child = childFixture(); children.push(child); spawnMock.mockReturnValue(child);
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    let result: unknown;
    const pending = entry === 'tool' ? bashTool.execute({ command: 'start "" chrome.exe', timeout_ms: 50 })
      : runInteractiveShellCommand('start "" chrome.exe', { platform: 'win32' });
    void pending.then(value => { result = value; });
    child.stdout.write('before exit'); child.exitCode = 0; child.emit('exit', 0, null);
    child.stdout.write('buffered tail');
    await vi.advanceTimersByTimeAsync(250);
    const output = typeof result === 'string' ? result : (result as { output?: string } | undefined)?.output;
    expect(output).toContain('before exit'); expect(output).toContain('buffered tail');
    expect(output).toContain('输出管道');
    expect(spawnMock).toHaveBeenCalledTimes(1); expect(child.kill).not.toHaveBeenCalled();
    expect(child.stdout.destroyed).toBe(true); expect(child.stderr.destroyed).toBe(true);
    if (entry === 'interactive') expect(result).toMatchObject({ exitCode: 0 });
    await pending; out.mockRestore();
  });
  it('keeps the observed nonzero shell exit code after output drain', async () => {
    const child = childFixture(); children.push(child); spawnMock.mockReturnValue(child);
    let result: unknown; void bashTool.execute({ command: 'echo error' }).then(value => { result = value; });
    child.stderr.write('failure'); child.exitCode = 7; child.emit('exit', 7, null);
    await vi.advanceTimersByTimeAsync(250);
    expect(result).toContain('exit 7'); expect(result).toContain('failure');
  });
  it('does not kill an exited/reusable Windows PID on an abort during drain', async () => {
    const child = childFixture(); children.push(child); spawnMock.mockReturnValue(child);
    const controller = new AbortController();
    const pending = bashTool.execute({ command: 'start "" chrome.exe' }, { signal: controller.signal } as never);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    child.exitCode = 0; child.emit('exit', 0, null); controller.abort();
    await rejected; expect(spawnMock).toHaveBeenCalledTimes(1); expect(child.kill).not.toHaveBeenCalled();
  });
  it('retains normal close output and does not add the inherited-pipe notice', async () => {
    const child = childFixture(); children.push(child); spawnMock.mockReturnValue(child);
    const pending = bashTool.execute({ command: 'echo normal' });
    child.stdout.write('normal'); child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null);
    expect(await pending).toBe('normal'); await vi.advanceTimersByTimeAsync(250);
    expect(child.stdout.destroyed).toBe(false);
  });
});
