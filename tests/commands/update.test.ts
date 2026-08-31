import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import {
  buildNpmUpdateInvocation,
  compareSemver,
  parseLatestVersion,
  registerUpdateCommand,
  runUpdateCommand,
  type UpdateProcessRunner,
} from '../../src/commands/update.js';

function result(exitCode: number, stdout = '', stderr = '') {
  return { exitCode, stdout, stderr };
}

describe('xiaok update', () => {
  it('registers a top-level update command', () => {
    const program = new Command();
    registerUpdateCommand(program, '1.5.0', {
      run: vi.fn(async () => result(0, '"1.5.0"')),
      log: vi.fn(),
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

    await expect(runUpdateCommand('1.5.0', { run, log, platform: 'darwin' }))
      .resolves.toEqual({ status: 'current', currentVersion: '1.5.0', latestVersion: '1.5.0' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('已经是最新版'));
  });

  it('does not downgrade when the current version is newer than latest', async () => {
    const run = vi.fn<UpdateProcessRunner>(async () => result(0, '"1.5.0"'));

    await expect(runUpdateCommand('1.6.0', { run, log: vi.fn(), platform: 'linux' }))
      .resolves.toEqual({ status: 'newer', currentVersion: '1.6.0', latestVersion: '1.5.0' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('installs the fixed latest package when a newer version exists', async () => {
    const run = vi.fn<UpdateProcessRunner>()
      .mockResolvedValueOnce(result(0, '"1.6.0"'))
      .mockResolvedValueOnce(result(0));
    const log = vi.fn();

    await expect(runUpdateCommand('1.5.0', { run, log, platform: 'linux' }))
      .resolves.toEqual({ status: 'updated', currentVersion: '1.5.0', latestVersion: '1.6.0' });
    expect(run).toHaveBeenNthCalledWith(2, {
      command: 'npm',
      args: ['install', '--global', 'xiaokcode@latest'],
      shell: false,
      stdio: 'inherit',
    });
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('xiaok --version'));
  });

  it('fails honestly when registry lookup or installation fails', async () => {
    const lookupFailure = vi.fn<UpdateProcessRunner>(async () => result(1, '', 'network unavailable'));
    await expect(runUpdateCommand('1.5.0', { run: lookupFailure, log: vi.fn(), platform: 'darwin' }))
      .rejects.toThrow(/network unavailable/);

    const installFailure = vi.fn<UpdateProcessRunner>()
      .mockResolvedValueOnce(result(0, '"1.6.0"'))
      .mockResolvedValueOnce(result(1, '', 'EACCES permission denied'));
    await expect(runUpdateCommand('1.5.0', { run: installFailure, log: vi.fn(), platform: 'darwin' }))
      .rejects.toThrow(/npm prefix/);
  });
});
