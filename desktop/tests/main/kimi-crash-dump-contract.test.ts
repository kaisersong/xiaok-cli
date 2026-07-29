import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Kimi task-local crash dump contract', () => {
  it('disables Electron Crashpad before the desktop app starts', () => {
    const source = readFileSync(
      join(process.cwd(), 'electron', 'main.ts'),
      'utf8',
    );
    const disableIndex = source.indexOf(
      "app.commandLine.appendSwitch('disable-crash-reporter')",
    );
    const breakpadIndex = source.indexOf(
      "app.commandLine.appendSwitch('disable-breakpad')",
    );
    const nodeReportIndex = source.indexOf('configureSafeCrashCapture()');
    const readyIndex = source.indexOf('app.whenReady()');

    expect(disableIndex).toBeGreaterThanOrEqual(0);
    expect(breakpadIndex).toBeGreaterThan(disableIndex);
    expect(nodeReportIndex).toBeGreaterThan(breakpadIndex);
    expect(readyIndex).toBeGreaterThan(disableIndex);
    expect(readyIndex).toBeGreaterThan(nodeReportIndex);
  });
});
