import type { Config } from '../../types.js';
export interface ResolvedProviderTransport {
    providerId: string;
    apiKey: string;
    baseUrl?: string;
    headers: Record<string, string>;
}
export interface CandidateApiKey {
    source: 'xiaok_env' | 'standard_env' | 'config';
    /** 环境变量名（source 为 config 时为空） */
    envVarName?: string;
    apiKey: string;
}
export declare function resolveProviderApiKey(config: Config, providerId: string): string;
/**
 * 枚举某个 provider 所有可能来源的候选 Key（不去重、不做网络验证），
 * 按 resolveProviderApiKey 的优先级顺序排列：XIAOK_ 前缀 > 标准环境变量 > 配置文件。
 * 用于 `xiaok doctor --check-keys` 等场景，向用户展示「发现了哪些候选」再逐个验证。
 */
export declare function listCandidateApiKeys(config: Config, providerId: string): CandidateApiKey[];
export declare function resolveProviderTransport(config: Config, providerId: string): ResolvedProviderTransport;
