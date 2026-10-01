import type { Config, SystemOneConfig } from '../../types.js';
/**
 * TypeSafe System One（Jev）的配置读取层。
 *
 * Jev 是辅助决策模型，不是 xiaok 的推理模型：它不参与 `config.models` 与
 * `config.defaultModelId` 的模型选择，也不出现在 `config.providers` 里。
 * 它独占 `config.systemOne` 一个块，所有默认值、环境变量回退和端点拼装
 * 都收敛在这里，避免适配器、探活和 CLI 各自硬编码一份。
 */
export declare const SYSTEM_ONE_DEFAULT_BASE_URL = "https://api.typesafe.ai";
export declare const SYSTEM_ONE_DEFAULT_MODEL = "jev-latest";
export declare const SYSTEM_ONE_ENDPOINT_PATH = "/v1/systemone";
/** 单次调用预算 64,000 token（见 https://docs.typesafe.ai/api）。 */
export declare const SYSTEM_ONE_CONTEXT_LIMIT = 64000;
/**
 * 候选环境变量，按优先级排列。
 * 沿用其它 provider 的 `${PREFIX}_API_KEY` 约定，另留 xiaok 命名空间前缀。
 */
export declare const SYSTEM_ONE_KEY_ENV_VARS: readonly ["XIAOK_TYPESAFE_API_KEY", "TYPESAFE_API_KEY"];
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
/** System One 端点 URL：`<baseUrl>/v1/systemone`。 */
export declare function systemOneEndpointUrl(baseUrl: string | undefined): string;
/**
 * 解析出实际生效的 System One 配置。
 *
 * Key 优先级：`config.systemOne.apiKey` > 环境变量。配置文件里显式写下的 Key
 * 先赢，因为它代表用户在 UI 里的最新操作，环境变量只是无配置时的兜底。
 */
export declare function resolveSystemOneConfig(config: Pick<Config, 'systemOne'> | undefined, env?: NodeJS.ProcessEnv): ResolvedSystemOneConfig;
/**
 * 就地应用 patch 到 `config.systemOne`，返回同一个 config 对象。
 *
 * 字段语义与 desktop IPC 契约一致：`undefined` = 不变更，空串 = 清除该字段。
 * 三个字段都被清空后整块删除，避免 config.json 里留下空对象。
 */
export declare function setSystemOneConfig(config: Config, patch: SystemOneConfig): Config;
