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
  it('enables loopback-only remote debugging by default', () => {
    const fake = fakeCommandLine();

    const result = configureDefaultRemoteDebugging(fake.commandLine, ['xiaok']);

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

  it('preserves an explicit remote debugging port', () => {
    const fake = fakeCommandLine(['remote-debugging-port']);

    const result = configureDefaultRemoteDebugging(fake.commandLine, ['xiaok']);

    expect(result).toEqual({ enabled: false, reason: 'explicit_remote_debugging_port' });
    expect(fake.appended).toEqual([]);
  });

  it('detects an explicit argv remote debugging port before appending defaults', () => {
    const fake = fakeCommandLine();

    const result = configureDefaultRemoteDebugging(fake.commandLine, [
      'xiaok',
      '--remote-debugging-port=9333',
    ]);

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
  });
});

