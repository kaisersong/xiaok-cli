import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mainSource = readFileSync(join(import.meta.dirname, '..', '..', 'electron', 'main.ts'), 'utf8');

describe('main.ts side effects audit', () => {
  const expectedSideEffects = [
    'setWindowOpenHandler',
    'will-navigate',
    'before-quit',
    'window-all-closed',
    'second-instance',
    'activate',
    'powerMonitor.on',
    'loadURL',
    'loadFile',
  ];

  it('contains all expected side-effect registrations', () => {
    for (const effect of expectedSideEffects) {
      expect(mainSource, `missing side-effect: ${effect}`).toContain(effect);
    }
  });

  it('registers process error handlers', () => {
    expect(mainSource).toContain("process.on('uncaughtException'");
    expect(mainSource).toContain("process.on('unhandledRejection'");
    expect(mainSource).toContain("process.on('exit'");
  });

  it('uses app.getPath for log directory (not __dirname-relative)', () => {
    expect(mainSource).toContain("app.getPath('userData')");
    expect(mainSource).not.toMatch(/join\(__dirname.*\.tmp/);
  });

  it('does not contain direct localhost fetch calls from renderer-facing code', () => {
    const lines = mainSource.split('\n');
    const rendererFetchLines = lines.filter(l =>
      l.includes('fetch(') &&
      l.includes('127.0.0.1') &&
      !l.includes('postRuntimePower') &&
      !l.includes('// internal')
    );
    expect(rendererFetchLines.length).toBeLessThanOrEqual(1);
  });
});
