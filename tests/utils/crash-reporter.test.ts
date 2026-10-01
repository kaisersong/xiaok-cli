import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  configureSafeCrashCapture,
  reportCrash,
  setCrashContext,
} from '../../src/utils/crash-reporter.js';

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

  it('disables Node diagnostic reports that may capture provider-private heap data', () => {
    const report = process.report;
    const previous = report
      ? {
          reportOnFatalError: report.reportOnFatalError,
          reportOnSignal: report.reportOnSignal,
          reportOnUncaughtException: report.reportOnUncaughtException,
        }
      : undefined;

    try {
      configureSafeCrashCapture();
      if (report) {
        expect(report.reportOnFatalError).toBe(false);
        expect(report.reportOnSignal).toBe(false);
        expect(report.reportOnUncaughtException).toBe(false);
      }
    } finally {
      if (report && previous) {
        report.reportOnFatalError = previous.reportOnFatalError;
        report.reportOnSignal = previous.reportOnSignal;
        report.reportOnUncaughtException = previous.reportOnUncaughtException;
      }
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

  itIfCanSpawn('exits after one crash report even when printing the report throws EPIPE', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'xiaok-crash-broken-stderr-'));
    tempDirs.push(configDir);
    const entry = join(process.cwd(), '.test-dist', 'src', 'utils', 'crash-reporter.js');
    const script = `
      import { installGlobalCrashHandlers } from ${JSON.stringify(entry)};
      installGlobalCrashHandlers();
      process.stderr.write = () => { throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }); };
      process.emit('uncaughtException', new Error('initial failure'));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, XIAOK_CONFIG_DIR: configDir }, encoding: 'utf8', timeout: 1500,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(readdirSync(join(configDir, 'crashes'))).toHaveLength(1);
  });

  itIfCanSpawn('records only allowlisted command context for a failing top-level CLI command', async () => {
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
    expect(report.context).toEqual({ command: 'diagnose' });
  }, 10_000);

  it('keeps safe Windows startup diagnostics without storing messages or absolute paths', async () => {
    const configDir=mkdtempSync(join(tmpdir(),'xiaok-startup-diagnostics-'));
    tempDirs.push(configDir);
    const previous=process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR=configDir;
    try {
      setCrashContext({command:'chat',startupPhase:'transcript'} as Parameters<typeof setCrashContext>[0] & {startupPhase:string});
      const error=new Error('PRIVATE_KEY_AND_REASONING', {cause:Object.assign(new Error('PRIVATE_CAUSE'),{code:'EPERM'})});
      error.stack='Error: PRIVATE_KEY_AND_REASONING\n    at secretFunction (C:\\Users\\private-name\\node_modules\\xiaokcode\\dist\\ui\\transcript-storage.js:67:15)\n    at secretFunction (C:\\private-project\\custom.js:2:1)';
      const raw=readFileSync(await reportCrash(error),'utf8');
      const report=JSON.parse(raw);
      expect(report.context).toMatchObject({command:'chat',startupPhase:'transcript'});
      expect(report.error.frames).toEqual([{module:'ui/transcript-storage.js',line:67,column:15}]);
      expect(report.error.causeCodes).toEqual(['EPERM']);
      expect(report.version).not.toBe('unknown');
      for(const secret of ['PRIVATE','private-name','private-project','secretFunction','custom.js'])expect(raw).not.toContain(secret);
    } finally {
      if(previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previous;
      setCrashContext({command:'unknown'});
    }
  });

  it('identifies the literal ordinary save guard without recording arbitrary messages', async () => {
    const configDir=mkdtempSync(join(tmpdir(),'xiaok-save-diagnostics-'));
    tempDirs.push(configDir);
    const previous=process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR=configDir;
    try {
      const error=new Error('ordinary_source_route');
      error.stack='Error: ordinary_source_route\n at privateName (C:\\Users\\private\\dist\\ai\\runtime\\session-store\\file-store.js:864:9)\n at privateName (C:\\Users\\private\\dist\\runtime\\verification\\windows-installation-absence.js:10:1)';
      const raw=readFileSync(await reportCrash(error),'utf8');
      expect(JSON.parse(raw).error).toEqual({type:'Error',code:'ordinary_source_route',frames:[{module:'ai/runtime/session-store/file-store.js',line:864,column:9},{module:'runtime/verification/windows-installation-absence.js',line:10,column:1}]});
      expect(raw).not.toContain('private');
      const spoofed=readFileSync(await reportCrash(new Error('ordinary_source_route PRIVATE_KEY')),'utf8');
      expect(JSON.parse(spoofed).error.code).toBe('UNCLASSIFIED_ERROR');
      expect(spoofed).not.toContain('PRIVATE_KEY');
    } finally {
      if(previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previous;
    }
  });

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

  it('never persists raw error, cause, stack, cwd, args, session IDs, or non-Error values', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'xiaok-crash-reporter-redaction-'));
    tempDirs.push(configDir);
    const previousConfigDir = process.env.XIAOK_CONFIG_DIR;
    process.env.XIAOK_CONFIG_DIR = configDir;
    const canary = 'PRIVATE_REASONING_CANARY_7f29';

    try {
      setCrashContext({
        command: 'chat',
        args: ['chat', canary],
        sessionId: `sess_${canary}`,
        cwd: join(configDir, canary),
      });
      const error = new Error(canary, {
        cause: new Error(`cause-${canary}`),
      });
      error.stack = `Error: ${canary}\n at ${canary}:1:1`;

      const filePath = await reportCrash(error);
      const persisted = readFileSync(filePath, 'utf8');
      expect(persisted).not.toContain(canary);
      expect(JSON.parse(persisted)).toMatchObject({
        context: { command: 'chat' },
        error: { type: 'Error', code: 'UNCLASSIFIED_ERROR' },
      });

      const nonErrorPath = await reportCrash({ value: canary });
      expect(readFileSync(nonErrorPath, 'utf8')).not.toContain(canary);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.XIAOK_CONFIG_DIR;
      } else {
        process.env.XIAOK_CONFIG_DIR = previousConfigDir;
      }
    }
  });
});
