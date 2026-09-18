import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { queryXiaokDaemonStatus, stopXiaokDaemon } from '../runtime/daemon/control.js';
import { spawnXiaokDaemonDetached, waitForXiaokDaemon } from '../runtime/daemon/launcher.js';
import { resolveXiaokDaemonSocketPath } from '../runtime/reminder/ipc.js';

const PACKAGE_SPEC = 'xiaokcode@latest';
const DAEMON_STOP_TIMEOUT_MS = 5_000;
const DAEMON_STOP_POLL_MS = 100;

export interface UpdateProcessInvocation {
  command: string;
  args: string[];
  shell: boolean;
  stdio: 'pipe' | 'inherit';
}

export interface UpdateProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type UpdateProcessRunner = (
  invocation: UpdateProcessInvocation,
) => Promise<UpdateProcessResult>;

export interface UpdateDaemonController {
  isRunning(): Promise<boolean>;
  stop(): Promise<boolean>;
  start(): Promise<void>;
}

interface UpdateDependencies {
  run?: UpdateProcessRunner;
  log?: (message: string) => void;
  platform?: NodeJS.Platform;
  daemon?: UpdateDaemonController;
}

export type UpdateResult = {
  status: 'current' | 'newer' | 'updated';
  currentVersion: string;
  latestVersion: string;
};

interface ParsedSemver {
  core: [number, number, number];
  prerelease: string[];
}

function parseSemver(version: string): ParsedSemver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) throw new Error(`无法比较版本：${left} / ${right}`);

  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) - Number(bPart);
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return aPart.localeCompare(bPart);
  }
  return 0;
}

export function parseLatestVersion(output: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    throw new Error('npm registry 返回了无法解析的 JSON');
  }
  const version = typeof parsed === 'string'
    ? parsed
    : Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'string'
      ? parsed[0]
      : null;
  if (!version || !parseSemver(version)) {
    throw new Error('npm registry 返回的版本无效');
  }
  return version;
}

export function buildNpmUpdateInvocation(
  kind: 'view' | 'install',
  platform: NodeJS.Platform = process.platform,
): UpdateProcessInvocation {
  const windows = platform === 'win32';
  return {
    command: windows ? 'npm.cmd' : 'npm',
    args: kind === 'view'
      ? ['view', PACKAGE_SPEC, 'version', '--json']
      : ['install', '--global', PACKAGE_SPEC],
    shell: windows,
    stdio: kind === 'view' ? 'pipe' : 'inherit',
  };
}

const defaultRunner: UpdateProcessRunner = async (invocation) => new Promise((resolve, reject) => {
  const child = spawn(invocation.command, invocation.args, {
    shell: invocation.shell,
    stdio: invocation.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  child.once('error', (error) => reject(new Error(`无法启动 npm：${error.message}`)));
  child.once('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// npm 需要替换整个全局包目录。Windows 上运行中的 daemon 持有原生模块文件
// （如 onnxruntime.dll），会让移动/复制旧包目录的步骤以 EBUSY 失败，
// 留下半新半旧的安装目录，所以更新前先停、更新后按新版本重启。
const defaultDaemonController: UpdateDaemonController = {
  async isRunning() {
    const status = await queryXiaokDaemonStatus(resolveXiaokDaemonSocketPath());
    return status?.running === true;
  },
  async stop() {
    const socketPath = resolveXiaokDaemonSocketPath();
    await stopXiaokDaemon(socketPath);
    // shutdown RPC 先返回，daemon 进程随后才退出并释放文件句柄；
    // 确认 socket 不再可达（即进程已退出）再继续，避免 npm 仍撞上 EBUSY。
    const deadline = Date.now() + DAEMON_STOP_TIMEOUT_MS;
    do {
      if ((await queryXiaokDaemonStatus(socketPath)) === null) return true;
      await delay(DAEMON_STOP_POLL_MS);
    } while (Date.now() < deadline);
    return false;
  },
  async start() {
    const socketPath = resolveXiaokDaemonSocketPath();
    await spawnXiaokDaemonDetached(socketPath);
    await waitForXiaokDaemon(socketPath);
  },
};

async function readDaemonRunning(
  daemon: UpdateDaemonController,
  log: (message: string) => void,
): Promise<boolean> {
  try {
    return await daemon.isRunning();
  } catch {
    log('警告：无法确认 xiaok daemon 状态，跳过 daemon 处理。');
    return false;
  }
}

async function stopDaemonForUpdate(
  daemon: UpdateDaemonController,
  log: (message: string) => void,
): Promise<void> {
  log('检测到 xiaok daemon 正在运行，先停止以避免安装目录文件被占用...');
  try {
    if (await daemon.stop()) {
      log('xiaok daemon 已停止。');
      return;
    }
  } catch {
    // 落到下面的统一告警
  }
  log('警告：未能确认 xiaok daemon 已停止，npm 可能因文件占用（EBUSY）失败。');
}

async function startDaemonAfterUpdate(
  daemon: UpdateDaemonController,
  log: (message: string) => void,
  reason: 'restart' | 'recover',
): Promise<void> {
  try {
    await daemon.start();
    log(reason === 'restart' ? 'xiaok daemon 已按新版本重启。' : 'xiaok daemon 已恢复运行。');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`警告：xiaok daemon 未能自动启动（${detail}），请运行 xiaok daemon start 恢复。`);
  }
}

export async function runUpdateCommand(
  currentVersion: string,
  dependencies: UpdateDependencies = {},
): Promise<UpdateResult> {
  const run = dependencies.run ?? defaultRunner;
  const log = dependencies.log ?? console.log;
  const platform = dependencies.platform ?? process.platform;
  const daemon = dependencies.daemon ?? defaultDaemonController;

  log(`正在检查 xiaok 更新（当前 ${currentVersion}）...`);
  const lookup = await run(buildNpmUpdateInvocation('view', platform));
  if (lookup.exitCode !== 0) {
    const detail = lookup.stderr.trim() || `npm exited with code ${lookup.exitCode}`;
    throw new Error(`查询 npm registry 失败：${detail}`);
  }

  const latestVersion = parseLatestVersion(lookup.stdout);
  const comparison = compareSemver(currentVersion, latestVersion);
  if (comparison === 0) {
    log(`xiaok ${currentVersion} 已经是最新版。`);
    return { status: 'current', currentVersion, latestVersion };
  }
  if (comparison > 0) {
    log(`当前版本 ${currentVersion} 高于 npm latest ${latestVersion}，不会自动降级。`);
    return { status: 'newer', currentVersion, latestVersion };
  }

  log(`发现新版本 ${latestVersion}，正在更新 xiaok...`);
  const daemonWasRunning = await readDaemonRunning(daemon, log);
  if (daemonWasRunning) {
    await stopDaemonForUpdate(daemon, log);
  }

  const install = await run(buildNpmUpdateInvocation('install', platform));
  if (install.exitCode !== 0) {
    const detail = install.stderr.trim() || `npm exited with code ${install.exitCode}`;
    if (daemonWasRunning) {
      await startDaemonAfterUpdate(daemon, log, 'recover');
    }
    if (/EACCES|EPERM|permission/i.test(detail)) {
      throw new Error(`更新失败：npm 全局目录无写权限。请修复 npm prefix 或目录权限后重试。${detail}`);
    }
    if (/EBUSY|resource busy or locked/i.test(detail)) {
      throw new Error(`更新失败：安装目录文件被占用（EBUSY）。请先运行 xiaok daemon stop，确认占用进程退出后重试。${detail}`);
    }
    throw new Error(`更新失败：${detail}`);
  }

  if (daemonWasRunning) {
    await startDaemonAfterUpdate(daemon, log, 'restart');
  }

  log(`更新命令已完成：${currentVersion} → latest（查询时为 ${latestVersion}）。请运行 xiaok --version 验证。`);
  return { status: 'updated', currentVersion, latestVersion };
}

export function registerUpdateCommand(
  program: Command,
  currentVersion: string,
  dependencies: UpdateDependencies = {},
): void {
  program
    .command('update')
    .description('将 xiaok CLI 更新到 npm 上的最新版')
    .action(async () => {
      try {
        await runUpdateCommand(currentVersion, dependencies);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
