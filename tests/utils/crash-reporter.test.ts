import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reportCrash, setCrashContext } from '../../src/utils/crash-reporter.js';

function canSpawnChildProcesses(): boolean {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'pipe' });
  return !result.error && result.status === 0;
}

describe('crash reporter', () => {
  const tempDirs: string[] = [];
  const itIfCanSpawn = canSpawnChildProcesses() ? it : it.skip;

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  itIfCanSpawn('exits quietly when stdout downstream closes with EPIPE', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'xiaok-crash-reporter-'));
    tempDirs.push(configDir);
    const crashReporterModulePath = join(process.cwd(), '.test-dist', 'src', 'utils', 'crash-reporter.js');
    const childScript = `
      import { installGlobalCrashHandlers } from ${JSON.stringify(crashReporterModulePath)};
      installGlobalCrashHandlers();
      let index = 0;
      setInterval(() => {
        process.stdout.write('chunk ' + index++ + '\\n');
      }, 10);
    `;

    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XIAOK_CONFIG_DIR: configDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdoutClosed = false;
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', () => {
      if (!stdoutClosed) {
        stdoutClosed = true;
        child.stdout.destroy();
      }
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    const crashDir = join(configDir, 'crashes');
    expect(exit).toEqual({ code: 0, signal: null });
    expect(stderr).toBe('');
    expect(existsSync(crashDir) ? readdirSync(crashDir) : []).toEqual([]);
  }, 10_000);

  itIfCanSpawn('writes a crash report when a TTY-like stdout closes with EPIPE', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'xiaok-crash-reporter-tty-'));
    tempDirs.push(configDir);
    const crashReporterModulePath = join(process.cwd(), '.test-dist', 'src', 'utils', 'crash-reporter.js');
    const childScript = `
      import { installGlobalCrashHandlers } from ${JSON.stringify(crashReporterModulePath)};
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      installGlobalCrashHandlers();
      let index = 0;
      setInterval(() => {
        process.stdout.write('chunk ' + index++ + '\\n');
      }, 10);
    `;

    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XIAOK_CONFIG_DIR: configDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdoutClosed = false;
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', () => {
      if (!stdoutClosed) {
        stdoutClosed = true;
        child.stdout.destroy();
      }
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    const crashDir = join(configDir, 'crashes');
    const crashFiles = existsSync(crashDir) ? readdirSync(crashDir) : [];
    expect(exit).toEqual({ code: 1, signal: null });
    expect(stderr).toContain('崩溃报告已保存');
    expect(crashFiles).toHaveLength(1);
  }, 10_000);

  itIfCanSpawn('delegates TTY-like stdout EPIPE to a custom stream handler instead of crashing', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'xiaok-crash-reporter-handler-'));
    tempDirs.push(configDir);
    const markerPath = join(configDir, 'handled.txt');
    const crashReporterModulePath = join(process.cwd(), '.test-dist', 'src', 'utils', 'crash-reporter.js');
    const childScript = `
      import { writeFileSync } from 'node:fs';
      import { installGlobalCrashHandlers, setStreamErrorHandler } from ${JSON.stringify(crashReporterModulePath)};
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      setStreamErrorHandler((error, stream) => {
        if (stream !== process.stdout) return false;
        writeFileSync(${JSON.stringify(markerPath)}, String(error && typeof error === 'object' && 'code' in error ? error.code : 'handled'));
        setTimeout(() => process.exit(0), 0);
        return true;
      });
      installGlobalCrashHandlers();
      let index = 0;
      setInterval(() => {
        process.stdout.write('chunk ' + index++ + '\\n');
      }, 10);
    `;

    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XIAOK_CONFIG_DIR: configDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdoutClosed = false;
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', () => {
      if (!stdoutClosed) {
        stdoutClosed = true;
        child.stdout.destroy();
      }
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    const crashDir = join(configDir, 'crashes');
    expect(exit).toEqual({ code: 0, signal: null });
    expect(stderr).toBe('');
    expect(existsSync(markerPath)).toBe(true);
    expect(readFileSync(markerPath, 'utf8')).toBe('EPIPE');
    expect(existsSync(crashDir) ? readdirSync(crashDir) : []).toEqual([]);
  }, 10_000);

  itIfCanSpawn('records command context for a failing top-level CLI command', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'xiaok-crash-reporter-cli-'));
    tempDirs.push(configDir);
    const missingTracePath = join(configDir, 'missing-trace.json');
    const mainPath = join(process.cwd(), '.test-dist', 'src', 'main.js');

    const child = spawn(process.execPath, [mainPath, 'diagnose', '--trace', missingTracePath, '--format', 'json'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XIAOK_CONFIG_DIR: configDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    const crashDir = join(configDir, 'crashes');
    const crashFiles = existsSync(crashDir) ? readdirSync(crashDir) : [];
    expect(exit).toEqual({ code: 1, signal: null });
    expect(stderr).toContain('崩溃报告已保存');
    expect(crashFiles).toHaveLength(1);

    const report = JSON.parse(readFileSync(join(crashDir, crashFiles[0]!), 'utf8')) as {
      context?: { command?: string; args?: string[]; cwd?: string };
    };
    expect(report.context).toMatchObject({
      command: 'diagnose',
      args: ['diagnose', '--trace', missingTracePath, '--format', 'json'],
      cwd: process.cwd(),
    });
  }, 10_000);

  it('removes only expired crash report files before writing a new report', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'xiaok-crash-reporter-retention-'));
    tempDirs.push(configDir);
    const previousConfigDir = process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR = configDir;

    try {
      const crashDir = join(configDir, 'crashes');
      await reportCrash(new Error('create-dir'));
      const expiredCrash = join(crashDir, 'crash-expired.json');
      const freshCrash = join(crashDir, 'crash-fresh.json');
      const unrelated = join(crashDir, 'notes.json');
      writeFileSync(expiredCrash, '{}\n', 'utf8');
      writeFileSync(freshCrash, '{}\n', 'utf8');
      writeFileSync(unrelated, '{}\n', 'utf8');

      const oldTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const freshTime = new Date();
      utimesSync(expiredCrash, oldTime, oldTime);
      utimesSync(freshCrash, freshTime, freshTime);
      utimesSync(unrelated, oldTime, oldTime);

      setCrashContext({ command: 'doctor', args: ['doctor'], cwd: process.cwd() });
      await reportCrash(new Error('new crash'));

      const files = readdirSync(crashDir);
      expect(files).not.toContain('crash-expired.json');
      expect(files).toContain('crash-fresh.json');
      expect(files).toContain('notes.json');
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.XIAOK_CONFIG_DIR;
      } else {
        process.env.XIAOK_CONFIG_DIR = previousConfigDir;
      }
    }
  });
});
