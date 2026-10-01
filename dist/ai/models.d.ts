import type { ModelAdapter } from '../types.js';
import type { Config, LegacyConfig } from '../types.js';
import { SystemOneAdapter } from './adapters/system-one.js';
import { type ResolvedModelBinding } from './providers/control-plane.js';
import { type OpenAIAdapterInit } from './providers/model-harness-profile.js';
export declare function resolveOpenAICompatibilityHeaders(binding: ResolvedModelBinding): {
    resolvedHeaders: Record<string, string | null>;
    kimiCodingHeadersApplied: boolean;
};
export declare function buildOpenAIAdapterInit(binding: ResolvedModelBinding, env?: Readonly<Record<string, string | undefined>>): OpenAIAdapterInit;
export declare function createAdapterFromBinding(binding: ResolvedModelBinding): ModelAdapter;
export declare function createAdapter(rawConfig: Config | LegacyConfig): ModelAdapter;
/**
 * 构造 System One（Jev）辅助决策模型适配器。
 *
 * Jev 不参与 `config.models` / `config.defaultModelId` 的推理模型选择，
 * 所以这里直接从 `config.systemOne` 解析，而不是走 `createAdapterFromBinding`
 * —— 后者要求 provider 出现在 first-party registry 里。
 */
export declare function createSystemOneAdapter(config: Pick<Config, 'systemOne'> | undefined, env?: NodeJS.ProcessEnv): SystemOneAdapter;
