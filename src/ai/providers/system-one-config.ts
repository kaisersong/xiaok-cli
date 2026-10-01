import type { Config, SystemOneConfig } from '../../types.js';

/**
 * TypeSafe System One（Jev）的配置读取层。
 *
 * Jev 是辅助决策模型，不是 xiaok 的推理模型：它不参与 `config.models` 与
 * `config.defaultModelId` 的模型选择，也不出现在 `config.providers` 里。
 * 它独占 `config.systemOne` 一个块，所有默认值、环境变量回退和端点拼装
 * 都收敛在这里，避免适配器、探活和 CLI 各自硬编码一份。
 */

export const SYSTEM_ONE_DEFAULT_BASE_URL = 'https://api.typesafe.ai';
export const SYSTEM_ONE_DEFAULT_MODEL = 'jev-latest';
export const SYSTEM_ONE_ENDPOINT_PATH = '/v1/systemone';
/** 单次调用预算 64,000 token（见 https://docs.typesafe.ai/api）。 */
export const SYSTEM_ONE_CONTEXT_LIMIT = 64_000;

/**
 * 候选环境变量，按优先级排列。
 * 沿用其它 provider 的 `${PREFIX}_API_KEY` 约定，另留 xiaok 命名空间前缀。
 */
export const SYSTEM_ONE_KEY_ENV_VARS = ['XIAOK_TYPESAFE_API_KEY', 'TYPESAFE_API_KEY'] as const;

export type SystemOneKeySource = 'config' | 'env' | 'none';

export interface ResolvedSystemOneConfig {
  /** 明文 Key；未配置时为 null。 */
  apiKey: string | null;
  /** Key 来自哪个来源，供 UI 区分「本机已配置」与「靠环境变量」。 */
  keySource: SystemOneKeySource;
  /** 命中环境变量时的变量名，供诊断输出指明来源；否则为 null。 */
  keyEnvVar: string | null;
  baseUrl: string;
  model: string;
  configured: boolean;
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return (trimmed || SYSTEM_ONE_DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function firstEnvKey(env: NodeJS.ProcessEnv): { name: string; value: string } | null {
  for (const name of SYSTEM_ONE_KEY_ENV_VARS) {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return { name, value: value.trim() };
  }
  return null;
}

/** System One 端点 URL：`<baseUrl>/v1/systemone`。 */
export function systemOneEndpointUrl(baseUrl: string | undefined): string {
  return `${normalizeBaseUrl(baseUrl)}${SYSTEM_ONE_ENDPOINT_PATH}`;
}

/**
 * 解析出实际生效的 System One 配置。
 *
 * Key 优先级：`config.systemOne.apiKey` > 环境变量。配置文件里显式写下的 Key
 * 先赢，因为它代表用户在 UI 里的最新操作，环境变量只是无配置时的兜底。
 */
export function resolveSystemOneConfig(
  config: Pick<Config, 'systemOne'> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSystemOneConfig {
  const stored = config?.systemOne;
  const configKey = typeof stored?.apiKey === 'string' && stored.apiKey.trim()
    ? stored.apiKey.trim()
    : null;
  const envKey = configKey ? null : firstEnvKey(env);
  const apiKey = configKey ?? envKey?.value ?? null;

  return {
    apiKey,
    keySource: configKey ? 'config' : envKey ? 'env' : 'none',
    keyEnvVar: envKey?.name ?? null,
    baseUrl: normalizeBaseUrl(stored?.baseUrl),
    model: typeof stored?.model === 'string' && stored.model.trim()
      ? stored.model.trim()
      : SYSTEM_ONE_DEFAULT_MODEL,
    configured: Boolean(apiKey),
  };
}

/**
 * 就地应用 patch 到 `config.systemOne`，返回同一个 config 对象。
 *
 * 字段语义与 desktop IPC 契约一致：`undefined` = 不变更，空串 = 清除该字段。
 * 三个字段都被清空后整块删除，避免 config.json 里留下空对象。
 */
export function setSystemOneConfig(
  config: Config,
  patch: SystemOneConfig,
): Config {
  const next: SystemOneConfig = { ...(config.systemOne ?? {}) };

  for (const field of ['apiKey', 'baseUrl', 'model'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed) next[field] = trimmed;
    else delete next[field];
  }

  if (Object.keys(next).length === 0) delete config.systemOne;
  else config.systemOne = next;

  return config;
}
