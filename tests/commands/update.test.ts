import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import {
  buildNpmUpdateInvocation,
  compareSemver,
  parseLatestVersion,
  registerUpdateCommand,
  runUpdateCommand,
  type UpdateDaemonController,
  type UpdateProcessRunner,
} from '../../src/commands/update.js';

function result(exitCode: number, stdout = '', stderr = '') {
  return { exitCode, stdout, stderr };
}

// 测试不得连接真实 daemon socket：默认控制器会停掉本机正在运行的 daemon。
const stoppedDaemon: UpdateDaemonController = {
  isRunning: async () => false,
  stop: async () => false,
  start: async () => undefined,
};

function createDaemon(
  calls: string[],
  running: boolean,
  options: { startFails?: boolean; isRunningFails?: boolean } = {},
) {
  const isRunning = vi.fn(async () => {
    calls.push('isRunning');
    if (options.isRunningFails) throw new Error('daemon probe failed');
    return running;
  });
  const stop = vi.fn(async () => {
    calls.push('stop');
    return true;
  });
  const start = vi.fn(async () => {
    calls.push('start');
    if (options.startFails) throw new Error('spawn failed');
  });
  return { controller: { isRunning, stop, start } satisfies UpdateDaemonController, isRunning, stop, start };
}

function createRun(calls: string[], options: { install?: { exitCode: number; stderr?: string } } = {}) {
  return vi.fn<UpdateProcessRunner>(async (invocation) => {
    if (invocation.args[0] === 'view') {
      calls.push('npm-view');
      return result(0, '"1.6.0"');
    }
    calls.push('npm-install');
    return result(options.install?.exitCode ?? 0, '', options.install?.stderr ?? '');
  });
}

describe('xiaok update', () => {
  it('registers a top-level update command', () => {
    const program = new Command();
    registerUpdateCommand(program, '1.5.0', {
      run: vi.fn(async () => result(0, '"1.5.0"')),
      log: vi.fn(),
      daemon: stoppedDaemon,
    });

    expect(program.commands.find((command) => command.name() === 'update')?.description())
      .toContain('最新版');
  });

  it('parses only a single valid semver from npm JSON output', () => {
    expect(parseLatestVersion('"1.6.0"\n')).toBe('1.6.0');
    expect(parseLatestVersion('["1.6.0"]')).toBe('1.6.0');
    expect(() => parseLatestVersion('["1.5.0", "1.6.0"]')).toThrow(/版本/);
    expect(() => parseLatestVersion('"latest"')).toThrow(/版本/);
    expect(() => parseLatestVersion('not-json')).toThrow(/registry/);
  });

  it('compares stable and prerelease versions without downgrading', () => {
    expect(compareSemver('1.6.0', '1.5.0')).toBeGreaterThan(0);
    expect(compareSemver('1.5.0', '1.5.0')).toBe(0);
    expect(compareSemver('1.5.0-beta.1', '1.5.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('uses cross-platform fixed npm invocations', () => {
    expect(buildNpmUpdateInvocation('view', 'darwin')).toEqual({
      command: 'npm',
      args: ['view', 'xiaokcode@latest', 'version', '--json'],
      shell: false,
      stdio: 'pipe',
    });
    expect(buildNpmUpdateInvocation('install', 'win32')).toEqual({
      command: 'npm.cmd',
      args: ['install', '--global', 'xiaokcode@latest'],
      shell: true,
      stdio: 'inherit',
    });
  });

  it('does not install when the current version is already latest', async () => {
    const run = vi.fn<UpdateProcessRunner>(async () => result(0, '"1.5.0"'));
    const log = vi.fn();

    await expect(runUpdateCommand('1.5.0', { run, log, platform: 'darwin', daemon: stoppedDaemon }))
      .resolves.toEqual({ status: 'current', currentVersion: '1.5.0', latestVersion: '1.5.0' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('已经是最新版'));
  });

  it('does not downgrade when the current version is newer than latest', async () => {
    const run = vi.fn<UpdateProcessRunner>(async () => result(0, '"1.5.0"'));

    await expect(runUpdateCommand('1.6.0', { run, log: vi.fn(), platform: 'linux', daemon: stoppedDaemon }))
      .resolves.toEqual({ status: 'newer', currentVersion: '1.6.0', latestVersion: '1.5.0' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('installs the fixed latest package when a newer version exists', async () => {
    const calls: string[] = [];
    const run = createRun(calls);
    const log = vi.fn();

    await expect(runUpdateCommand('1.5.0', { run, log, platform: 'linux', daemon: stoppedDaemon }))
      .resolves.toEqual({ status: 'updated', currentVersion: '1.5.0', latestVersion: '1.6.0' });
    expect(calls).toEqual(['npm-view', 'npm-install']);
    expect(run).toHaveBeenNthCalledWith(2, {
      command: 'npm',
      args: ['install', '--global', 'xiaokcode@latest'],
      shell: false,
      stdio: 'inherit',
    });
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('xiaok --version'));
  });

  it('stops the running daemon before install and restarts it on the new version', async () => {
    const calls: string[] = [];
    const run = createRun(calls);
    const daemon = createDaemon(calls, true);
    const log = vi.fn();

    await expect(runUpdateCommand('1.5.0', { run, log, platform: 'win32', daemon: daemon.controller }))
      .resolves.toEqual({ status: 'updated', currentVersion: '1.5.0', latestVersion: '1.6.0' });
    expect(calls).toEqual(['npm-view', 'isRunning', 'stop', 'npm-install', 'start']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('先停止'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('已按新版本重启'));
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('xiaok --version'));
  });

  it('leaves an already stopped daemon untouched', async () => {
    const calls: string[] = [];
    const run = createRun(calls);
    const daemon = createDaemon(calls, false);

    await runUpdateCommand('1.5.0', { run, log: vi.fn(), platform: 'win32', daemon: daemon.controller });

    expect(calls).toEqual(['npm-view', 'isRunning', 'npm-install']);
    expect(daemon.stop).not.toHaveBeenCalled();
    expect(daemon.start).not.toHaveBeenCalled();
  });

  it('restores the daemon when installation fails after the daemon was stopped', async () => {
    const calls: string[] = [];
    const run = createRun(calls, { install: { exitCode: 1, stderr: 'EACCES permission denied' } });
    const daemon = createDaemon(calls, true);
    const log = vi.fn();

    await expect(runUpdateCommand('1.5.0', { run, log, platform: 'win32', daemon: daemon.controller }))
      .rejects.toThrow(/npm prefix/);

    expect(calls).toEqual(['npm-view', 'isRunning', 'stop', 'npm-install', 'start']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('已恢复运行'));
  });

  it('still completes the update when the daemon probe fails', async () => {
    const calls: string[] = [];
    const run = createRun(calls);
    const daemon = createDaemon(calls, false, { isRunningFails: true });
    const log = vi.fn();

    await expect(runUpdateCommand('1.5.0', { run, log, platform: 'win32', daemon: daemon.controller }))
      .resolves.toEqual({ status: 'updated', currentVersion: '1.5.0', latestVersion: '1.6.0' });
    expect(calls).toEqual(['npm-view', 'isRunning', 'npm-install']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('无法确认 xiaok daemon 状态'));
  });

  it('reports an update that succeeded even when the daemon cannot restart', async () => {
    const calls: string[] = [];
    const run = createRun(calls);
    const daemon = createDaemon(calls, true, { startFails: true });
    const log = vi.fn();

    await expect(runUpdateCommand('1.5.0', { run, log, platform: 'win32', daemon: daemon.controller }))
      .resolves.toEqual({ status: 'updated', currentVersion: '1.5.0', latestVersion: '1.6.0' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('xiaok daemon start'));
  });

  it('explains EBUSY lock contention with an actionable hint', async () => {
    const calls: string[] = [];
    const run = createRun(calls, {
      install: {
        exitCode: -4082,
        stderr: 'npm error code EBUSY\nnpm error EBUSY: resource busy or locked, copyfile onnxruntime.dll',
      },
    });

    await expect(runUpdateCommand('1.5.0', { run, log: vi.fn(), platform: 'win32', daemon: stoppedDaemon }))
      .rejects.toThrow(/EBUSY/);
    await expect(runUpdateCommand('1.5.0', { run, log: vi.fn(), platform: 'win32', daemon: stoppedDaemon }))
      .rejects.toThrow(/daemon stop/);
  });

  it('fails honestly when registry lookup or installation fails', async () => {
    const lookupFailure = vi.fn<UpdateProcessRunner>(async () => result(1, '', 'network unavailable'));
    await expect(runUpdateCommand('1.5.0', { run: lookupFailure, log: vi.fn(), platform: 'darwin', daemon: stoppedDaemon }))
      .rejects.toThrow(/network unavailable/);

    const installFailure = vi.fn<UpdateProcessRunner>()
      .mockResolvedValueOnce(result(0, '"1.6.0"'))
      .mockResolvedValueOnce(result(1, '', 'EACCES permission denied'));
    await expect(runUpdateCommand('1.5.0', { run: installFailure, log: vi.fn(), platform: 'darwin', daemon: stoppedDaemon }))
      .rejects.toThrow(/npm prefix/);
  });
});
