import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, existsSync, chmodSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Config, LegacyConfig } from '../types.js';
import { DEFAULT_CONFIG, isValidLegacyProvider } from '../types.js';
import { normalizeConfig } from '../ai/providers/normalize.js';

export function getConfigDir(subdir?: string): string {
  const base = process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
  return subdir ? join(base, subdir) : base;
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

/** config.json 里有模型 API Key，只允许当前用户读写。 */
const CONFIG_FILE_MODE = 0o600;
const CONFIG_DIR_MODE = 0o700;

/**
 * 把文件或目录收紧到指定权限。Windows 不使用 POSIX 权限位，直接跳过；
 * 收紧失败（只读文件系统、文件属于别人等）不应阻断读写配置。
 */
function restrictMode(path: string, mode: number): void {
  if (process.platform === 'win32') return;
  try {
    if ((statSync(path).mode & 0o777) !== mode) chmodSync(path, mode);
  } catch {
    // best effort
  }
}

/** Rename path to path+'.bak', removing any stale .bak first (Windows EPERM guard). */
function backupAndRemove(path: string): void {
  const bak = path + '.bak';
  if (existsSync(bak)) rmSync(bak, { force: true });
  renameSync(path, bak);
  restrictMode(bak, CONFIG_FILE_MODE);
}

/** 深拷贝 DEFAULT_CONFIG，避免浅拷贝导致 models 引用共享 */
function cloneDefaultConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

export async function loadConfig(): Promise<Config> {
  const path = getConfigPath();
  if (!existsSync(path)) return cloneDefaultConfig();
  // 老版本写出的是 644 / 755，读取时顺手收紧，老用户升级后自动修复。
  restrictMode(getConfigDir(), CONFIG_DIR_MODE);
  restrictMode(path, CONFIG_FILE_MODE);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return cloneDefaultConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backupAndRemove(path);
    return cloneDefaultConfig();
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1 && obj.schemaVersion !== 2) {
    backupAndRemove(path);
    return cloneDefaultConfig();
  }

  if (obj.schemaVersion === 1 && obj.defaultModel !== undefined && !isValidLegacyProvider(obj.defaultModel)) {
    backupAndRemove(path);
    return cloneDefaultConfig();
  }

  return normalizeConfig(obj as unknown as LegacyConfig | Config);
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true, mode: CONFIG_DIR_MODE });
  restrictMode(dir, CONFIG_DIR_MODE);
  const path = getConfigPath();
  // 已有的老文件可能是 644：先收紧再写入，避免新 Key 在写入和 chmod 之间短暂可读。
  if (existsSync(path)) restrictMode(path, CONFIG_FILE_MODE);
  // mode 只在新建文件时生效，写完再确认一次。
  writeFileSync(path, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: CONFIG_FILE_MODE });
  restrictMode(path, CONFIG_FILE_MODE);
}
