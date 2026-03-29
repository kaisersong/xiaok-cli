import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Config } from '../types.js';
import { DEFAULT_CONFIG, isValidProvider } from '../types.js';

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
  if (obj.schemaVersion !== 1) {
    backupAndRemove(path);
    return cloneDefaultConfig();
  }

  // 校验 defaultModel，防止脏数据
  if (obj.defaultModel !== undefined && !isValidProvider(obj.defaultModel)) {
    backupAndRemove(path);
    return cloneDefaultConfig();
  }

  const defaults = cloneDefaultConfig();
  const parsedConfig = obj as Partial<Config>;
  const mergedModels: Config['models'] = {};

  if (defaults.models.claude || parsedConfig.models?.claude) {
    mergedModels.claude = {
      ...(defaults.models.claude ?? { model: 'claude-opus-4-6' }),
      ...(parsedConfig.models?.claude ?? {}),
    };
  }

  if (defaults.models.openai || parsedConfig.models?.openai) {
    const openaiModel = {
      ...(defaults.models.openai ?? {}),
      ...(parsedConfig.models?.openai ?? {}),
    };
    if (openaiModel.model) {
      mergedModels.openai = openaiModel as NonNullable<Config['models']['openai']>;
    }
  }

  if (defaults.models.custom || parsedConfig.models?.custom) {
    const customModel = {
      ...(defaults.models.custom ?? {}),
      ...(parsedConfig.models?.custom ?? {}),
    };
    if (customModel.baseUrl) {
      mergedModels.custom = customModel as NonNullable<Config['models']['custom']>;
    }
  }

  return {
    ...defaults,
    ...parsedConfig,
    models: mergedModels,
    schemaVersion: 1,
  };
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
