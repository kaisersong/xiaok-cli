import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Config, LegacyConfig } from '../types.js';
import { DEFAULT_CONFIG, isValidLegacyProvider } from '../types.js';
import { normalizeConfig } from '../ai/providers/normalize.js';

export function getConfigDir(): string {
  return process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

/** Rename path to path+'.bak', removing any stale .bak first (Windows EPERM guard). */
function backupAndRemove(path: string): void {
  const bak = path + '.bak';
  if (existsSync(bak)) rmSync(bak, { force: true });
  renameSync(path, bak);
}

/** 深拷贝 DEFAULT_CONFIG，避免浅拷贝导致 models 引用共享 */
function cloneDefaultConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

export async function loadConfig(): Promise<Config> {
  const path = getConfigPath();
  if (!existsSync(path)) return cloneDefaultConfig();

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
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
