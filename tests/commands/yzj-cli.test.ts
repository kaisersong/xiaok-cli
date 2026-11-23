import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { registerYzjCliCommand, runYzjCli } from '../../src/commands/yzj-cli.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../src/runtime/bundled-yzj-cli.js', () => ({
  ensureBundledYzjCli: () => ({ binaryPath: 'managed path/yzj-cli.exe' }),
  getYzjCliLaunchArgs: () => ['runner.cjs', 'managed path/yzj-cli.exe', 'installer.js'],
}));

afterEach(()=>vi.unstubAllEnvs());
describe('xiaok yzj-cli passthrough', () => {
  it.each([
    ['--help'], ['--version'], ['update', '--force'],
    ['im', 'message', 'send', '--content', 'hello & $(echo injected)', '--group-id', 'g1'],
    ['--profile', 'work', 'calendar', 'event', 'list', '--start', '2026-11-05'],
  ])('forwards argv unchanged: %j', async (...args) => {
    const run = vi.fn(async () => 0); const program = new Command();
    registerYzjCliCommand(program, { run });
    await program.parseAsync(['node', 'xiaok', 'yzj-cli', ...args]);
    expect(run).toHaveBeenCalledWith(args);
  });
  it('returns the upstream confirmation-required exit code', async () => {
    const run = vi.fn(async () => 10); const program = new Command(); const exit = vi.fn();
    registerYzjCliCommand(program, { run, setExitCode: exit });
    await program.parseAsync(['node', 'xiaok', 'yzj-cli', 'doc', 'delete', '--id', 'd1']);
    expect(exit).toHaveBeenCalledWith(10);
  });
  it('spawns the managed native executable without a shell and preserves exit 10', async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as any);
    const before = process.listenerCount('SIGINT');
    for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH'])vi.stubEnv(key,'injected-fixture-value');
    const args = ['im', 'message', 'send', '--content', 'hello & $(echo injected)'];
    const pending = runYzjCli(args);
    expect(spawn).toHaveBeenCalledWith(process.execPath, ['runner.cjs', 'managed path/yzj-cli.exe', 'installer.js', ...args], {
      shell: false, stdio: 'inherit', env: expect.any(Object),
    });
    // Ordinary Node CLI preserves its ambient environment; packaged fuse tests
    // independently cover removal of these variables in the fixed runtime.
    for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH'])expect(vi.mocked(spawn).mock.calls[0][2]!.env?.[key]).toBe('injected-fixture-value');
    child.emit('close', 10, null);
    expect(await pending).toBe(10); expect(process.listenerCount('SIGINT')).toBe(before);
  });
  it('forwards cancellation and releases signal listeners after a spawn failure', async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as any);
    const listeners = process.listeners('SIGTERM'); const before = listeners.length;
    const pending = runYzjCli(['--version']);
    const forward = process.listeners('SIGTERM').find(listener => !listeners.includes(listener))!;
    forward('SIGTERM'); expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('error', new Error('ENOENT'));
    await expect(pending).rejects.toThrow('ENOENT'); expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});
