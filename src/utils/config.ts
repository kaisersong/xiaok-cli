import {ProtectedJsonFile} from './protected-json.js';
import {readProtectedJsonVersioned,readProtectedJsonVersionedSync,saveProtectedJson,updateProtectedJson,updateProtectedAutomationSync} from './protected-json-async.js';
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, existsSync, chmodSync, statSync, lstatSync } from 'fs';
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

/** config.json 里有模型 API Key，只允许当前用户读写。只处理文件本身，不动整个配置目录。 */
const CONFIG_FILE_MODE = 0o600;
const credentialConfigVersions=new WeakMap<Config,string>();

export class ConfigPermissionError extends Error {
  constructor(path: string, cause?: unknown) {
    super(`无法把 ${path} 的权限收紧为仅本人可读写，为避免 API Key 被其他用户读到，已停止写入。请检查文件所有者和权限（Mac/Linux 可运行 chmod 600 ${path}）。`);
    this.name = 'ConfigPermissionError';
    this.cause = cause;
  }
}

/** 读取时尽力收紧老版本留下的 644 文件，失败不阻断读取。Windows 不使用 POSIX 权限位。 */
function tightenBestEffort(path: string): void {
  if (process.platform === 'win32') return;
  try {
    if(existsSync(path)&&lstatSync(path).isSymbolicLink())return;
    if (existsSync(path) && (statSync(path).mode & 0o777) !== CONFIG_FILE_MODE) chmodSync(path, CONFIG_FILE_MODE);
  } catch {
    // 读取路径上不报错；真正写入 Key 前会严格检查
  }
}

/** 写入 Key 前必须把文件收紧到 600；做不到就抛错，绝不把 Key 写进别人可读的文件。 */
function tightenOrThrow(path: string): void {
  if (process.platform === 'win32') return;
  try {
    if(lstatSync(path).isSymbolicLink())throw Error('credential_path_unsafe');
    if ((statSync(path).mode & 0o777) !== CONFIG_FILE_MODE) chmodSync(path, CONFIG_FILE_MODE);
    if ((statSync(path).mode & 0o777) !== CONFIG_FILE_MODE) throw new Error('mode unchanged after chmod');
  } catch (error) {
    throw new ConfigPermissionError(path, error);
  }
}

/** Rename path to path+'.bak', removing any stale .bak first (Windows EPERM guard). */
function backupAndRemove(path: string): void {
  const bak = path + '.bak';
  if (existsSync(bak)) rmSync(bak, { force: true });
  renameSync(path, bak);
  tightenBestEffort(bak);
}

/** 深拷贝 DEFAULT_CONFIG，避免浅拷贝导致 models 引用共享 */
function cloneDefaultConfig(): Config {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
}

export async function loadConfig(): Promise<Config> {
  const path=getConfigPath();tightenBestEffort(path);tightenBestEffort(path+'.bak');const raw=await readProtectedJsonVersioned(path);const result=normalizeLoadedConfig(raw.value);if(!credentialConfigVersions.has(result))credentialConfigVersions.set(result,raw.digest);return result;
}

/** Shared normalized read for synchronous Store construction and async callers. */
export function loadConfigSync(): Config {
  const path = getConfigPath();
  // 老版本写出的是 644：不管 config.json 是否存在，都顺手收紧它和 .bak，老用户升级后自动修复。
  tightenBestEffort(path);
  tightenBestEffort(path + '.bak');
  if (!existsSync(path)) return cloneDefaultConfig();

  const raw=readProtectedJsonVersionedSync(path);const result=normalizeLoadedConfig(raw.value);if(!credentialConfigVersions.has(result))credentialConfigVersions.set(result,raw.digest);return result;
}

function normalizeLoadedConfig(parsed:Record<string,unknown>|undefined):Config {
  if(!parsed)return cloneDefaultConfig();
  const path=getConfigPath();
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1 && obj.schemaVersion !== 2) {
    backupAndRemove(path);
    const fallback=cloneDefaultConfig();credentialConfigVersions.set(fallback,'missing');return fallback;
  }

  if (obj.schemaVersion === 1 && obj.defaultModel !== undefined && !isValidLegacyProvider(obj.defaultModel)) {
    backupAndRemove(path);
    const fallback=cloneDefaultConfig();credentialConfigVersions.set(fallback,'missing');return fallback;
  }

  return normalizeConfig(obj as unknown as LegacyConfig | Config);
}

export async function saveConfig(config: Config): Promise<void> {
  const path=getConfigPath();if(existsSync(path))tightenOrThrow(path);await saveProtectedJson(path,config,credentialConfigVersions.get(config));tightenOrThrow(path);
}

function saveConfigSync(config: Config): void {
  mkdirSync(getConfigDir(), { recursive: true });
  const path = getConfigPath();
  // 老文件可能是 644：先收紧再写入，收紧失败就中止，避免新 Key 写进别人可读的文件。
  if (existsSync(path)) tightenOrThrow(path);
  // mode 只在新建文件时生效；写完再确认一次。
  new ProtectedJsonFile(path).save(config,credentialConfigVersions.get(config));
  tightenOrThrow(path);
}

/** One synchronous semantic edit; does not make unrelated whole-config writers transactional. */
export function updateGlobalBackgroundAutoRun(enabled: unknown, requestSource?: 'user' | 'agent' | 'scheduler'): void {
  if (requestSource !== 'user') throw Error('automation_config_request_source_forbidden');
  if (typeof enabled !== 'boolean') throw Error('automation_config_input_invalid');
  const config = loadConfigSync();
  config.automations = { ...(config.automations ?? {}), globalBackgroundAutoRunEnabled: enabled };
  if ((process as NodeJS.Process & {type?:string}).type==='browser') {
    updateProtectedAutomationSync(getConfigPath(),enabled,cloneDefaultConfig() as unknown as Record<string,unknown>);
  } else saveConfigSync(config);
}
/** Fixed Main consumer can update a bound credential without a stale whole-config write. */
export async function updateConfigCredential(update:(config:Config)=>Config,signal?:AbortSignal):Promise<void>{await updateProtectedJson(getConfigPath(),value=>update(normalizeLoadedConfig(value)) as unknown as Record<string,unknown>,signal);}
