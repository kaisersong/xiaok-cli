import { constants, copyFileSync, chmodSync, lstatSync, linkSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getConfigDir } from '../utils/config.js';

interface YzjCliOptions {
  configDir?: string;
  packageRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

export interface BundledYzjCli {
  binaryPath: string;
  binDir: string;
}

export function getYzjCliLaunchArgs(cli: BundledYzjCli, packageRoot?: string): string[] {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...(resources ? [join(resources, 'yzj-cli', 'runner.cjs')] : []),
    ...['../..', '../../..', '../../../../..'].map(up => resolve(here, up, 'data', 'yzj-cli', 'runner.cjs')),
  ];
  const runner = candidates.find(candidate => existsSync(candidate));
  if (!runner) throw new Error('云之家 CLI runner 缺失，请重新安装 xiaok');
  const root = packageRoot ?? dirname(createRequire(import.meta.url).resolve('@yunzhijia/cli/package.json'));
  return [runner, cli.binaryPath, join(root, 'scripts', 'install.js')];
}

function prepareLauncher(cli: BundledYzjCli, packageRoot?: string): string {
  const windows = cli.binaryPath.endsWith('.exe');
  const args = [process.execPath, ...getYzjCliLaunchArgs(cli, packageRoot)];
  if (args.some(arg => /[\r\n\0]/.test(arg))) throw new Error('云之家 CLI launcher 路径无效');
  const command = windows
    ? args.map(arg => `"${arg.replace(/%/g, '%%')}"`).join(' ')
    : args.map(arg => `'${arg.replace(/'/g, `'"'"'`)}'`).join(' ');
  const content = windows
    ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset ELECTRON_RUN_AS_NODE=1\r\n${command} %*\r\nexit /b %errorlevel%\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${command} "$@"\n`;
  const id = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const directory = join(cli.binDir, 'launchers', id);
  const launcher = join(directory, windows ? 'yzj-cli.cmd' : 'yzj-cli');
  if (!regularFile(launcher)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const staged = join(directory, `.launcher-${randomUUID()}`);
    try {
      writeFileSync(staged, content, { flag: 'wx', mode: 0o755 });
      try { linkSync(staged, launcher); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !regularFile(launcher)) throw error; }
    } finally { rmSync(staged, { force: true }); }
  }
  return directory;
}

function regularFile(path: string): boolean {
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error(`yzj-cli: 拒绝符号链接 ${path}`);
    if (!info.isFile()) throw new Error(`yzj-cli: 不是普通文件 ${path}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Seed once. The native CLI updates this user copy, never the signed app or npm package. */
export function ensureBundledYzjCli(options: YzjCliOptions = {}): BundledYzjCli {
  const platform = options.platform ?? process.platform;
  const binDir = resolve(options.configDir ?? getConfigDir(), 'tools', 'yzj-cli', `${platform}-${options.arch ?? process.arch}`);
  const binaryPath = join(binDir, platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli');
  if (regularFile(binaryPath)) return { binaryPath, binDir };

  // On Windows a self-update can leave only .old after an interrupted rename.
  // Retain that recovery source, and never replace an existing user binary.
  const old = binaryPath + '.old';
  const recover = platform === 'win32' && regularFile(old);
  const packageRoot = recover ? '' : options.packageRoot
    ?? dirname(createRequire(import.meta.url).resolve('@yunzhijia/cli/package.json'));
  const source = recover ? old : join(packageRoot, 'bin', platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli');
  if (!regularFile(source)) throw new Error('云之家 CLI 二进制缺失，请运行 npm rebuild @yunzhijia/cli；Desktop 请重新安装完整安装包。');
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const staged = join(binDir, `.seed-${randomUUID()}`);
  try {
    copyFileSync(source, staged, constants.COPYFILE_EXCL);
    if (platform !== 'win32') chmodSync(staged, 0o755);
    try {
      // Both paths are in the same directory/volume. Hard-link publication is
      // atomic and exclusive on POSIX and NTFS; unsupported filesystems fail safely.
      linkSync(staged, binaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !regularFile(binaryPath)) throw error;
    }
  } finally {
    rmSync(staged, { force: true });
  }
  return { binaryPath, binDir };
}

/** Process-local PATH only: no shell startup files, registry, credentials or permissions. */
export function configureBundledYzjCli(options: YzjCliOptions & {
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
} = {}): BundledYzjCli | null {
  try {
    const seeded = ensureBundledYzjCli(options);
    const cli = { ...seeded, binDir: prepareLauncher(seeded, options.packageRoot) };
    const env = options.env ?? process.env;
    const windows = (options.platform ?? process.platform) === 'win32';
    const key = windows ? Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH' : 'PATH';
    const delimiter = windows ? ';' : ':';
    const normalize = (value: string) => windows ? value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : value;
    const previous = env[key];
    const entries = previous === undefined ? [] : previous.split(delimiter);
    env[key] = [cli.binDir, ...entries.filter(entry => normalize(entry) !== normalize(cli.binDir))].join(delimiter);
    if (windows) for (const other of Object.keys(env)) if (other !== key && other.toLowerCase() === 'path') delete env[other];
    return cli;
  } catch (error) {
    (options.warn ?? console.warn)(`[xiaok] 云之家 CLI 不可用：${error instanceof Error ? error.message : String(error)}。可运行 npm rebuild @yunzhijia/cli 修复。`);
    return null;
  }
}
