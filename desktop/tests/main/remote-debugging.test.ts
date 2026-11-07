import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configureDefaultRemoteDebugging,
  DEFAULT_DESKTOP_REMOTE_DEBUGGING_ADDRESS,
  DEFAULT_DESKTOP_REMOTE_DEBUGGING_PORT,
} from '../../electron/remote-debugging.js';

const repoRoot = join(__dirname, '..', '..', '..');

function fakeCommandLine(existingSwitches: string[] = []) {
  const appended: Array<{ name: string; value?: string }> = [];
  return {
    appended,
    commandLine: {
      hasSwitch(name: string) {
        return existingSwitches.includes(name);
      },
      appendSwitch(name: string, value?: string) {
        appended.push({ name, value });
      },
    },
  };
}

describe('desktop release remote debugging', () => {
  it('enables loopback-only remote debugging by default in development', () => {
    const fake = fakeCommandLine();

    const result = configureDefaultRemoteDebugging(fake.commandLine, ['xiaok'], { isPackaged: false, env: {} });

    expect(result).toEqual({
      enabled: true,
      port: DEFAULT_DESKTOP_REMOTE_DEBUGGING_PORT,
      address: DEFAULT_DESKTOP_REMOTE_DEBUGGING_ADDRESS,
    });
    expect(fake.appended).toEqual([
      { name: 'remote-debugging-port', value: '9222' },
      { name: 'remote-debugging-address', value: '127.0.0.1' },
    ]);
  });

  it.each([undefined, '', '0', 'true', '01', '1 ', ' 1'])('disables packaged defaults for env=%j', (value) => {
    const fake = fakeCommandLine();
    const result = configureDefaultRemoteDebugging(fake.commandLine, ['xiaok'], {
      isPackaged: true, env: { XIAOK_DESKTOP_REMOTE_DEBUGGING: value, XIAOK_REMOTE_DEBUGGING: '1' },
    });
    expect(result).toEqual({ enabled: false, reason: 'packaged_default_disabled' });
    expect(fake.appended).toEqual([]);
  });

  it('disables packaged defaults with omitted env and no hasSwitch implementation', () => {
    const fake = fakeCommandLine();
    const result = configureDefaultRemoteDebugging({ appendSwitch: fake.commandLine.appendSwitch }, [], { isPackaged: true });
    expect(result).toEqual({ enabled: false, reason: 'packaged_default_disabled' });
    expect(fake.appended).toEqual([]);
  });

  it('allows packaged defaults only with explicit env opt-in', () => {
    const fake = fakeCommandLine();
    expect(configureDefaultRemoteDebugging(fake.commandLine, [], {
      isPackaged: true, env: { XIAOK_DESKTOP_REMOTE_DEBUGGING: '1' },
    })).toEqual({ enabled: true, port: '9222', address: '127.0.0.1' });
    expect(fake.appended).toEqual([
      { name: 'remote-debugging-port', value: '9222' },
      { name: 'remote-debugging-address', value: '127.0.0.1' },
    ]);
  });

  it('preserves an explicit remote debugging port', () => {
    const fake = fakeCommandLine(['remote-debugging-port']);

    const result = configureDefaultRemoteDebugging(fake.commandLine, ['xiaok'], { isPackaged: true, env: { XIAOK_DESKTOP_REMOTE_DEBUGGING: '1' } });

    expect(result).toEqual({ enabled: false, reason: 'explicit_remote_debugging_port' });
    expect(fake.appended).toEqual([]);
  });

  it.each([['--remote-debugging-port=9333'], ['--remote-debugging-port', '9333'], ['--remote-debugging-port=0']])('preserves explicit argv port %j', (...args) => {
    const fake = fakeCommandLine();

    const result = configureDefaultRemoteDebugging(fake.commandLine, [
      'xiaok',
      ...args,
    ], { isPackaged: true, env: {} });

    expect(result).toEqual({ enabled: false, reason: 'explicit_remote_debugging_port' });
    expect(fake.appended).toEqual([]);
  });

  it('configures remote debugging before the single-instance lock', () => {
    const main = readFileSync(join(repoRoot, 'desktop', 'electron', 'main.ts'), 'utf8');

    const configureIndex = main.indexOf('configureDefaultRemoteDebugging(app.commandLine');
    const lockIndex = main.indexOf('app.requestSingleInstanceLock()');

    expect(configureIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(configureIndex).toBeLessThan(lockIndex);
    expect(main.slice(configureIndex, lockIndex)).toMatch(/process\.argv,\s*\{\s*isPackaged: app\.isPackaged,\s*env: process\.env/);
    const helper = readFileSync(join(repoRoot, 'desktop/electron/remote-debugging.ts'), 'utf8');
    expect(helper).toMatch(/if\s*\(options\.isPackaged\s*&&/);
  });
});


describe('packaged upgrade smoke contract', () => {
  it('opts old app into CDP and checks the OS relaunched app without CDP', () => {
    const script = readFileSync(join(repoRoot, 'scripts/qa/macos-real-upgrade.mjs'), 'utf8');
    expect(script).toContain("spawn(appExecutable, ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1']");
    expect(script).toContain("'packaged_default_cdp_must_not_listen'");
    expect(script).toContain("'-sTCP:LISTEN'");
    expect(script).toContain('CGWindowListCopyWindowInfo');
    expect(script).toContain('kCGWindowOwnerPID');
    expect(script).not.toContain('const newCDP');
    expect(script).toContain("signature(app, NEW.tag.slice(9), 'actually-upgraded')");
    expect(script).toContain("assert.deepEqual(actualTree, newTree");
  });
});
