import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

export interface CrashContext {
  command?: string;
  args?: string[];
  sessionId?: string;
  cwd?: string;
}

export type StreamErrorHandler = (error: unknown, stream: NodeJS.WriteStream) => boolean;

let crashContext: CrashContext = {};
let handlersInstalled = false;
let streamErrorHandler: StreamErrorHandler | null = null;

const CRASH_REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function setCrashContext(ctx: CrashContext): void {
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
    version: process.env.npm_package_version ?? 'unknown',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    context: crashContext,
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
  if (error instanceof Error) {
    return {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause,
    };
  }
  return { type: typeof error, value: String(error) };
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

    if (isBrokenPipeError(error) && shouldSilentlyExitOnBrokenPipe()) {
      process.exit(0);
      return;
    }

    try {
      const path = await reportCrash(error);
      console.error(`\n[xiaok] ${label} — 崩溃报告已保存: ${path}`);
    } catch {
      console.error(`\n[xiaok] ${label} — 保存崩溃报告失败`);
      console.error(error);
    }
    process.exit(1);
  };

  process.on('uncaughtException', (err) => handle('未捕获的异常', err));
  process.on('unhandledRejection', (reason) => handle('未处理的 Promise 拒绝', reason));
}
