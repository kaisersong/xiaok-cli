import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

export interface CrashContext {
  command?: string;
  args?: string[];
  sessionId?: string;
  cwd?: string;
}

let crashContext: CrashContext = {};

export function setCrashContext(ctx: CrashContext): void {
  crashContext = { ...crashContext, ...ctx };
}

export async function reportCrash(error: unknown): Promise<string> {
  const crashDir = join(getConfigDir(), 'crashes');
  await mkdir(crashDir, { recursive: true });

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

export function installGlobalCrashHandlers(): void {
  const handle = async (label: string, error: unknown) => {
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
