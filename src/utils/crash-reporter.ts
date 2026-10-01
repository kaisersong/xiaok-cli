import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { getConfigDir } from './config.js';

export interface CrashContext {
  command?: string;
  args?: string[];
  sessionId?: string;
  cwd?: string;
  startupPhase?: string;
}

export type StreamErrorHandler = (error: unknown, stream: NodeJS.WriteStream) => boolean;

let crashContext: CrashContext = {};
let handlersInstalled = false;
let streamErrorHandler: StreamErrorHandler | null = null;
let pipeBrokenFromStream = false;

const CRASH_REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SAFE_COMMANDS = new Set([
  'chat',
  'commit',
  'context',
  'diagnose',
  'doctor',
  'init',
  'pr',
  'review',
  'settings',
]);
const SAFE_ERROR_CODES = new Set([
  'EACCES',
  'EADDRINUSE',
  'ECONNREFUSED',
  'ECONNRESET',
  'EEXIST',
  'EIO',
  'EINVAL',
  'ENOENT',
  'ENOMEM',
  'ENOSPC',
  'EPERM',
  'EPIPE',
  'ETIMEDOUT',
  'transcript_lock_identity_unreadable',
  'transcript_busy',
  'ordinary_source_route',
]);
const SAFE_STARTUP_PHASES = new Set(['adapter','memory','credentials','platform','transcript','agent','ready']);
const SAFE_STACK_MODULES = new Set([
  'commands/chat.js','commands/chat-login-bootstrap.js','commands/login.js',
  'ui/transcript-storage.js','ui/transcript.js','ui/input.js','ui/input-mode.js',
  'platform/runtime/context.js','platform/provider-store/process-identity.js',
  'platform/provider-store/plugin-claim-lock.js','ai/memory/store.js',
  'ai/models.js','ai/providers/control-plane.js','ai/providers/model-harness-profile.js',
  'ai/runtime/session-store/file-store.js','ai/runtime/session-store/store.js',
  'ai/runtime/session-store/mutation-lock.js','ai/runtime/session-store/execution-authority.js',
  'runtime/verification/ordinary-source-writer-observation.js',
  'runtime/verification/windows-installation-absence.js','runtime/verification/migration-markers.js',
]);
const packageVersion = (() => {
  try {return (JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {version:string}).version;}
  catch {return 'unknown';}
})();

/**
 * Provider-private task-local reasoning must never be copied into a Node
 * diagnostic report. Xiaok's structured crash report below is the only
 * supported crash artifact and is intentionally allowlist-only.
 */
export function configureSafeCrashCapture(): void {
  if (!process.report) {
    return;
  }
  process.report.reportOnFatalError = false;
  process.report.reportOnSignal = false;
  process.report.reportOnUncaughtException = false;
}

export function setCrashContext(ctx: CrashContext): void {
  if (ctx.command !== undefined) crashContext = {};
  crashContext = { ...crashContext, ...ctx };
}

export function setStreamErrorHandler(handler: StreamErrorHandler | null): void {
  streamErrorHandler = handler;
}

export async function reportCrash(error: unknown): Promise<string> {
  const crashDir = join(getConfigDir(), 'crashes');
  await mkdir(crashDir, { recursive: true });
  await cleanupExpiredCrashReports(crashDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `crash-${timestamp}.json`;
  const filePath = join(crashDir, fileName);

  const report = {
    time: new Date().toISOString(),
    version: packageVersion,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    context: serializeCrashContext(crashContext),
    error: serializeError(error),
  };

  await writeFile(filePath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return filePath;
}

async function cleanupExpiredCrashReports(crashDir: string): Promise<void> {
  try {
    const entries = await readdir(crashDir, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.startsWith('crash-') || !entry.name.endsWith('.json')) {
        return;
      }

      const filePath = join(crashDir, entry.name);
      try {
        const info = await stat(filePath);
        if (now - info.mtimeMs > CRASH_REPORT_RETENTION_MS) {
          await unlink(filePath);
        }
      } catch {
        // Cleanup must never mask the crash that is currently being reported.
      }
    }));
  } catch {
    // Cleanup must never mask the crash that is currently being reported.
  }
}

function serializeError(error: unknown): Record<string, unknown> {
  const type = error instanceof Error
    ? (
        error instanceof DOMException
          ? 'DOMException'
          : error instanceof TypeError
            ? 'TypeError'
            : error instanceof RangeError
              ? 'RangeError'
              : 'Error'
      )
    : 'NonError';
  let rawCode = typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
  // One fixed internal sentinel only; never serialize arbitrary error messages.
  if (rawCode === undefined && error instanceof Error && error.message === 'ordinary_source_route') rawCode = 'ordinary_source_route';
  const frames: Array<{module:string;line:number;column:number}> = [];
  if (error instanceof Error) {
    for (const line of (error.stack ?? '').split('\n').slice(1,30)) {
      const match = line.replace(/\\/g,'/').match(/(?:\/dist\/|\/src\/)([a-zA-Z0-9_./-]+\.js):(\d+):(\d+)\)?$/);
      if (match && SAFE_STACK_MODULES.has(match[1]!)) {
        frames.push({module:match[1]!,line:Number(match[2]),column:Number(match[3])});
        if (frames.length >= 8) break;
      }
    }
  }
  const causeCodes: string[] = [];
  const seen = new Set<object>();
  let cause: unknown = error instanceof Error ? error.cause : undefined;
  while (cause && typeof cause === 'object' && !seen.has(cause) && seen.size < 8) {
    seen.add(cause);
    const record = cause as {code?:unknown;cause?:unknown};
    if (typeof record.code === 'string' && SAFE_ERROR_CODES.has(record.code)) causeCodes.push(record.code);
    cause = record.cause;
  }
  return {
    type,
    code: rawCode && SAFE_ERROR_CODES.has(rawCode)
      ? rawCode
      : 'UNCLASSIFIED_ERROR',
    ...(frames.length ? {frames} : {}),
    ...(causeCodes.length ? {causeCodes} : {}),
  };
}

function serializeCrashContext(context: CrashContext): Record<string, string> {
  const command = context.command && SAFE_COMMANDS.has(context.command)
    ? context.command
    : 'unknown';
  return { command, ...(context.startupPhase && SAFE_STARTUP_PHASES.has(context.startupPhase) ? {startupPhase:context.startupPhase} : {}) };
}

function isBrokenPipeError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'EPIPE';
}

function shouldSilentlyExitOnBrokenPipe(stream?: NodeJS.WriteStream): boolean {
  if (stream) {
    return stream.isTTY !== true;
  }
  return process.stdout.isTTY !== true;
}

function installBrokenPipeExit(stream: NodeJS.WriteStream): void {
  stream.on('error', (error) => {
    if (streamErrorHandler?.(error, stream)) {
      return;
    }

    if (isBrokenPipeError(error)) {
      pipeBrokenFromStream = true;
      if (shouldSilentlyExitOnBrokenPipe(stream)) {
        process.exit(0);
        return;
      }

      setImmediate(() => {
        throw error;
      });
      return;
    }

    setImmediate(() => {
      throw error;
    });
  });
}

export function installGlobalCrashHandlers(): void {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;

  installBrokenPipeExit(process.stdout);
  installBrokenPipeExit(process.stderr);

  const handle = async (label: string, error: unknown) => {
    if (
      isBrokenPipeError(error)
      && streamErrorHandler?.(error, process.stdout)
    ) {
      return;
    }

    if (
      isBrokenPipeError(error)
      && pipeBrokenFromStream
      && shouldSilentlyExitOnBrokenPipe()
    ) {
      process.exit(0);
      return;
    }

    try {
      const path = await reportCrash(error);
      console.error(`\n[xiaok] ${label} — 崩溃报告已保存: ${path}`);
    } catch {
      console.error(`\n[xiaok] ${label} — 保存崩溃报告失败`);
    }
    process.exit(1);
  };

  process.on('uncaughtException', (err) => handle('未捕获的异常', err));
  process.on('unhandledRejection', (reason) => handle('未处理的 Promise 拒绝', reason));
}
