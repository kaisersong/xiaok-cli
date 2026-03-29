import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
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

export async function loadConfig(): Promise<Config> {
  const path = getConfigPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    renameSync(path, path + '.bak');
    return { ...DEFAULT_CONFIG };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    renameSync(path, path + '.bak');
    return { ...DEFAULT_CONFIG };
  }

  // 校验 defaultModel，防止脏数据
  if (obj.defaultModel !== undefined && !isValidProvider(obj.defaultModel)) {
    renameSync(path, path + '.bak');
    return { ...DEFAULT_CONFIG };
  }

  return { ...DEFAULT_CONFIG, ...(obj as Partial<Config>), schemaVersion: 1 };
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
